#include <Arduino.h>
#include <WiFi.h>
#include <NimBLEDevice.h>
#include <WebSocketsClient.h>
#include "config.h"
#include "muse_parse.h"

// ── State ──────────────────────────────────────────────────────────────────────

static WebSocketsClient ws;
static NimBLEClient* bleClient = nullptr;
static volatile bool wsConnected = false;
static volatile bool bleConnected = false;
static bool museStreaming = false;

// ── Thread-safe message queue (BLE task → main loop) ─────────────────────────
// BLE notification callbacks run on the NimBLE FreeRTOS task, but the WebSockets
// library is not thread-safe.  Queue JSON here and drain from loop().

struct WsMsg {
    char json[320];
};

static QueueHandle_t wsQueue = nullptr;
static const int WS_QUEUE_SIZE = 64;

// Channel index lookup for EEG characteristic UUIDs
static const char* eegUUIDs[] = {
    MUSE_EEG_TP9_UUID,
    MUSE_EEG_AF7_UUID,
    MUSE_EEG_AF8_UUID,
    MUSE_EEG_TP10_UUID
};

// ── Forward declarations ───────────────────────────────────────────────────────

void connectWiFi();
bool connectMuse();
void startMuseStream();
void sendJSON(const char* json);

// ── BLE Notification Callbacks ─────────────────────────────────────────────────

static void onEegNotify(NimBLERemoteCharacteristic* pChar, uint8_t* data, size_t len, bool isNotify) {
    if (len < 20 || !wsConnected) return;

    // Determine channel index from UUID
    int ch = -1;
    std::string uuidStr = pChar->getUUID().toString();
    for (int i = 0; i < 4; i++) {
        if (uuidStr == eegUUIDs[i]) { ch = i; break; }
    }
    if (ch < 0) return;

    uint16_t seq = ((uint16_t)data[0] << 8) | data[1];

    float samples[EEG_SAMPLES_PER_PACKET];
    decodeEegSamples(data + 2, samples);

    char buf[320];
    int pos = snprintf(buf, sizeof(buf), "{\"type\":\"eeg\",\"ch\":%d,\"seq\":%u,\"samples\":[", ch, seq);
    for (int i = 0; i < EEG_SAMPLES_PER_PACKET; i++) {
        pos += snprintf(buf + pos, sizeof(buf) - pos, "%.2f%s", samples[i], i < 11 ? "," : "");
    }
    pos += snprintf(buf + pos, sizeof(buf) - pos, "]}");
    sendJSON(buf);
}

static void onAccelNotify(NimBLERemoteCharacteristic* pChar, uint8_t* data, size_t len, bool isNotify) {
    if (len < 8 || !wsConnected) return;
    // Accel data: skip 2 byte header, then 3x int16 big-endian, scale /16384.0 for g
    uint16_t seq = ((uint16_t)data[0] << 8) | data[1];
    (void)seq;
    int16_t ax = (int16_t)(((uint16_t)data[2] << 8) | data[3]);
    int16_t ay = (int16_t)(((uint16_t)data[4] << 8) | data[5]);
    int16_t az = (int16_t)(((uint16_t)data[6] << 8) | data[7]);
    float scale = 1.0f / 16384.0f;

    char buf[128];
    snprintf(buf, sizeof(buf), "{\"type\":\"accel\",\"x\":%.4f,\"y\":%.4f,\"z\":%.4f}",
             ax * scale, ay * scale, az * scale);
    sendJSON(buf);
}

static void onGyroNotify(NimBLERemoteCharacteristic* pChar, uint8_t* data, size_t len, bool isNotify) {
    if (len < 8 || !wsConnected) return;
    int16_t gx = (int16_t)(((uint16_t)data[2] << 8) | data[3]);
    int16_t gy = (int16_t)(((uint16_t)data[4] << 8) | data[5]);
    int16_t gz = (int16_t)(((uint16_t)data[6] << 8) | data[7]);
    float scale = 1.0f / 16.4f; // degrees/sec for +/-2000dps range

    char buf[128];
    snprintf(buf, sizeof(buf), "{\"type\":\"gyro\",\"x\":%.2f,\"y\":%.2f,\"z\":%.2f}",
             gx * scale, gy * scale, gz * scale);
    sendJSON(buf);
}

static void onTelemetryNotify(NimBLERemoteCharacteristic* pChar, uint8_t* data, size_t len, bool isNotify) {
    if (len < 8 || !wsConnected) return;
    // Telemetry: seq(2), battery%(2), fuel_gauge(2), adc_volt(2), temp(2)
    uint16_t battery = ((uint16_t)data[2] << 8) | data[3];
    int16_t temp = (int16_t)(((uint16_t)data[8] << 8) | data[9]);

    char buf[96];
    snprintf(buf, sizeof(buf), "{\"type\":\"telemetry\",\"battery\":%u,\"temp\":%.1f}",
             battery, temp / 10.0f);
    sendJSON(buf);
}

// ── WebSocket ──────────────────────────────────────────────────────────────────

void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_CONNECTED:
            Serial.println("[WS] Connected");
            wsConnected = true;
            if (bleConnected && !museStreaming) {
                startMuseStream();
            }
            break;
        case WStype_DISCONNECTED:
            Serial.println("[WS] Disconnected");
            wsConnected = false;
            break;
        case WStype_TEXT:
            Serial.printf("[WS] Received: %s\n", payload);
            break;
        default:
            break;
    }
}

// Enqueue JSON from any task context (safe to call from BLE callbacks)
void sendJSON(const char* json) {
    if (!wsConnected || !wsQueue) return;
    WsMsg msg;
    strncpy(msg.json, json, sizeof(msg.json) - 1);
    msg.json[sizeof(msg.json) - 1] = '\0';
    xQueueSend(wsQueue, &msg, 0); // drop if full — better than blocking BLE task
}

// ── WiFi ───────────────────────────────────────────────────────────────────────

void connectWiFi() {
    Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.printf("\n[WiFi] Connected, IP: %s\n", WiFi.localIP().toString().c_str());
}

// ── BLE ────────────────────────────────────────────────────────────────────────

class ClientCallbacks : public NimBLEClientCallbacks {
    void onConnect(NimBLEClient* client) override {
        Serial.println("[BLE] Connected to Muse");
        bleConnected = true;
    }
    void onDisconnect(NimBLEClient* client) override {
        Serial.println("[BLE] Disconnected");
        bleConnected = false;
        museStreaming = false;
    }
};

static ClientCallbacks clientCB;

bool subscribeChar(NimBLERemoteService* svc, const char* uuid, notify_callback cb) {
    NimBLERemoteCharacteristic* c = svc->getCharacteristic(uuid);
    if (!c) {
        Serial.printf("[BLE] Characteristic %s not found\n", uuid);
        return false;
    }
    if (!c->subscribe(true, cb)) {
        Serial.printf("[BLE] Subscribe failed: %s\n", uuid);
        return false;
    }
    Serial.printf("[BLE] Subscribed: %s\n", uuid);
    return true;
}

void sendMuseCommand(NimBLERemoteCharacteristic* ctrl, const char* cmd) {
    uint8_t buf[32];
    int len = encodeMuseCommand(cmd, buf, sizeof(buf));
    if (len > 0) {
        ctrl->writeValue(buf, len, false);
        Serial.printf("[Muse] Sent command: %s\n", cmd);
        delay(100);
    }
}

void startMuseStream() {
    NimBLERemoteService* svc = bleClient->getService(MUSE_SERVICE_UUID);
    if (!svc) {
        Serial.println("[BLE] Muse service not found");
        return;
    }

    NimBLERemoteCharacteristic* ctrl = svc->getCharacteristic(MUSE_CONTROL_UUID);
    if (!ctrl) {
        Serial.println("[BLE] Control characteristic not found");
        return;
    }

    // Subscribe to data characteristics first
    for (int i = 0; i < 4; i++) {
        subscribeChar(svc, eegUUIDs[i], onEegNotify);
    }
    subscribeChar(svc, MUSE_ACCEL_UUID, onAccelNotify);
    subscribeChar(svc, MUSE_GYRO_UUID, onGyroNotify);
    subscribeChar(svc, MUSE_TELEMETRY_UUID, onTelemetryNotify);

    // Send Muse start sequence: halt, preset, start
    sendMuseCommand(ctrl, "h");
    sendMuseCommand(ctrl, "p21");
    sendMuseCommand(ctrl, "s");

    museStreaming = true;
    Serial.println("[Muse] Streaming started");
}

bool connectMuse() {
    Serial.println("[BLE] Scanning for Muse...");
    NimBLEScan* scan = NimBLEDevice::getScan();
    scan->setActiveScan(true);
    NimBLEScanResults results = scan->start(10);

    NimBLEAdvertisedDevice* museDevice = nullptr;
    for (int i = 0; i < results.getCount(); i++) {
        NimBLEAdvertisedDevice dev = results.getDevice(i);
        if (dev.isAdvertisingService(NimBLEUUID(MUSE_SERVICE_UUID)) ||
            dev.getName().find("Muse") != std::string::npos) {
            museDevice = new NimBLEAdvertisedDevice(dev);
            Serial.printf("[BLE] Found Muse: %s (%s)\n",
                          dev.getName().c_str(), dev.getAddress().toString().c_str());
            break;
        }
    }

    if (!museDevice) {
        Serial.println("[BLE] Muse not found");
        return false;
    }

    bleClient = NimBLEDevice::createClient();
    bleClient->setClientCallbacks(&clientCB);
    bleClient->setConnectionParams(6, 6, 0, 200); // fast connection interval

    if (!bleClient->connect(museDevice)) {
        Serial.println("[BLE] Connection failed");
        delete museDevice;
        return false;
    }
    delete museDevice;

    // Request higher MTU for 20-byte EEG packets
    NimBLEDevice::setMTU(185);

    return true;
}

// ── Setup & Loop ───────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n=== Brain Claw - Muse 2 Bridge ===");

    wsQueue = xQueueCreate(WS_QUEUE_SIZE, sizeof(WsMsg));

    // Init BLE
    NimBLEDevice::init("BrainClaw");
    NimBLEDevice::setPower(ESP_PWR_LVL_P9);

    // Connect WiFi
    connectWiFi();

    // Connect WebSocket
    ws.begin(WS_HOST, WS_PORT, WS_PATH);
    ws.onEvent(wsEvent);
    ws.setReconnectInterval(3000);

    // Connect to Muse
    while (!connectMuse()) {
        Serial.println("[BLE] Retrying in 5s...");
        delay(5000);
    }

    // If WS is already connected, start streaming
    if (wsConnected) {
        startMuseStream();
    }
}

void loop() {
    ws.loop();

    // Drain queued messages from BLE callbacks (runs on main task → thread-safe)
    WsMsg msg;
    while (xQueueReceive(wsQueue, &msg, 0) == pdTRUE) {
        if (wsConnected) {
            ws.sendTXT(msg.json);
        }
    }

    // Reconnect BLE if disconnected
    if (!bleConnected) {
        Serial.println("[BLE] Reconnecting...");
        delay(2000);
        if (connectMuse() && wsConnected) {
            startMuseStream();
        }
    }

    delay(1);
}
