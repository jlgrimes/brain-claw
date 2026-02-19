#pragma once

// WiFi
#define WIFI_SSID     "YOUR_SSID"
#define WIFI_PASS     "YOUR_PASSWORD"

// WebSocket server
#define WS_HOST       "192.168.1.100"
#define WS_PORT       8765
#define WS_PATH       "/?role=producer"

// Muse 2 BLE UUIDs
#define MUSE_SERVICE_UUID        "0000fe8d-0000-1000-8000-00805f9b34fb"
#define MUSE_CONTROL_UUID        "273e0001-4c4d-454d-96be-f03bac821358"
#define MUSE_EEG_TP9_UUID        "273e0003-4c4d-454d-96be-f03bac821358"
#define MUSE_EEG_AF7_UUID        "273e0004-4c4d-454d-96be-f03bac821358"
#define MUSE_EEG_AF8_UUID        "273e0005-4c4d-454d-96be-f03bac821358"
#define MUSE_EEG_TP10_UUID       "273e0006-4c4d-454d-96be-f03bac821358"
#define MUSE_ACCEL_UUID          "273e000a-4c4d-454d-96be-f03bac821358"
#define MUSE_GYRO_UUID           "273e0009-4c4d-454d-96be-f03bac821358"
#define MUSE_TELEMETRY_UUID      "273e000b-4c4d-454d-96be-f03bac821358"

// EEG decoding constants
#define EEG_SAMPLES_PER_PACKET   12
#define EEG_SCALE                0.48828125f  // (raw - 2048) * scale = uV
#define EEG_OFFSET               2048
