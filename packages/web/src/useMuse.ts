import { useCallback, useRef, useState } from 'react';
import { MuseClient } from 'muse-js';

const SAMPLE_RATE = 256;
const DISPLAY_SECONDS = 4;
export const BUFFER_SIZE = SAMPLE_RATE * DISPLAY_SECONDS;
export const CHANNEL_NAMES = ['TP9', 'AF7', 'AF8', 'TP10'] as const;

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

export interface MuseState {
  status: 'idle' | 'pairing' | 'streaming' | 'error';
  error: string | null;
  battery: number | null;
  temperature: number | null;
  mode: 'ble' | 'ws' | null;
}

const DEFAULT_WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/?role=consumer`;

export function useMuse() {
  const [state, setState] = useState<MuseState>({
    status: 'idle',
    error: null,
    battery: null,
    temperature: null,
    mode: null,
  });

  const clientRef = useRef<MuseClient | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const buffersRef = useRef(CHANNEL_NAMES.map(() => new Float64Array(BUFFER_SIZE)));
  const writePosRef = useRef(new Uint32Array(4));
  const totalSamplesRef = useRef(0);
  const accelRef = useRef<XYZ>({ x: 0, y: 0, z: 0 });
  const gyroRef = useRef<XYZ>({ x: 0, y: 0, z: 0 });

  // Shared EEG sample writer
  const pushEeg = (ch: number, samples: number[]) => {
    if (ch >= 4) return;
    const buf = buffersRef.current[ch];
    for (const sample of samples) {
      buf[writePosRef.current[ch] % BUFFER_SIZE] = sample;
      writePosRef.current[ch]++;
      totalSamplesRef.current++;
    }
  };

  // --- BLE connect (direct to Muse via Web Bluetooth) ---
  const connectBLE = useCallback(async () => {
    try {
      setState({ status: 'pairing', error: null, battery: null, temperature: null, mode: 'ble' });

      const client = new MuseClient();
      clientRef.current = client;

      await client.connect();
      await client.start();

      client.eegReadings.subscribe((r) => pushEeg(r.electrode, r.samples));
      client.accelerometerData.subscribe((d) => {
        accelRef.current = d.samples[d.samples.length - 1];
      });
      client.gyroscopeData.subscribe((d) => {
        gyroRef.current = d.samples[d.samples.length - 1];
      });
      client.telemetryData.subscribe((t) => {
        setState((s) => ({ ...s, battery: Math.round(t.batteryLevel), temperature: t.temperature }));
      });
      client.connectionStatus.subscribe((connected) => {
        if (!connected) {
          setState({ status: 'idle', error: null, battery: null, temperature: null, mode: null });
        }
      });

      setState((s) => ({ ...s, status: 'streaming' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', error: msg, battery: null, temperature: null, mode: null });
    }
  }, []);

  // --- WebSocket connect (via ESP32 → server relay) ---
  const connectWS = useCallback((url?: string) => {
    const wsUrl = url ?? DEFAULT_WS_URL;
    setState({ status: 'pairing', error: null, battery: null, temperature: null, mode: 'ws' });

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, status: 'streaming' }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case 'eeg':
            pushEeg(msg.ch, msg.samples);
            break;
          case 'accel':
            accelRef.current = { x: msg.x, y: msg.y, z: msg.z };
            break;
          case 'gyro':
            gyroRef.current = { x: msg.x, y: msg.y, z: msg.z };
            break;
          case 'telemetry':
            setState((s) => ({ ...s, battery: Math.round(msg.battery), temperature: msg.temp }));
            break;
        }
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      setState({ status: 'idle', error: null, battery: null, temperature: null, mode: null });
    };

    ws.onerror = () => {
      setState({ status: 'error', error: 'WebSocket connection failed', battery: null, temperature: null, mode: null });
    };
  }, []);

  return {
    ...state,
    connectBLE,
    connectWS,
    buffers: buffersRef.current,
    writePos: writePosRef.current,
    totalSamples: totalSamplesRef,
    accel: accelRef,
    gyro: gyroRef,
  };
}
