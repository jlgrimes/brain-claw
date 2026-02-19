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
}

export function useMuse() {
  const [state, setState] = useState<MuseState>({
    status: 'idle',
    error: null,
    battery: null,
    temperature: null,
  });

  const clientRef = useRef<MuseClient | null>(null);
  const buffersRef = useRef(CHANNEL_NAMES.map(() => new Float64Array(BUFFER_SIZE)));
  const writePosRef = useRef(new Uint32Array(4));
  const totalSamplesRef = useRef(0);
  const accelRef = useRef<XYZ>({ x: 0, y: 0, z: 0 });
  const gyroRef = useRef<XYZ>({ x: 0, y: 0, z: 0 });

  const connect = useCallback(async () => {
    try {
      setState({ status: 'pairing', error: null, battery: null, temperature: null });

      const client = new MuseClient();
      clientRef.current = client;

      await client.connect();
      await client.start();

      // EEG
      client.eegReadings.subscribe((reading) => {
        const ch = reading.electrode;
        if (ch >= 4) return;
        const buf = buffersRef.current[ch];
        for (const sample of reading.samples) {
          buf[writePosRef.current[ch] % BUFFER_SIZE] = sample;
          writePosRef.current[ch]++;
          totalSamplesRef.current++;
        }
      });

      // Accelerometer
      client.accelerometerData.subscribe((data) => {
        const s = data.samples[data.samples.length - 1];
        accelRef.current = s;
      });

      // Gyroscope
      client.gyroscopeData.subscribe((data) => {
        const s = data.samples[data.samples.length - 1];
        gyroRef.current = s;
      });

      // Telemetry
      client.telemetryData.subscribe((t) => {
        setState((s) => ({
          ...s,
          battery: Math.round(t.batteryLevel),
          temperature: t.temperature,
        }));
      });

      // Disconnect
      client.connectionStatus.subscribe((connected) => {
        if (!connected) {
          setState({ status: 'idle', error: null, battery: null, temperature: null });
        }
      });

      setState((s) => ({ ...s, status: 'streaming' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', error: msg, battery: null, temperature: null });
    }
  }, []);

  return {
    ...state,
    connect,
    buffers: buffersRef.current,
    writePos: writePosRef.current,
    totalSamples: totalSamplesRef,
    accel: accelRef,
    gyro: gyroRef,
  };
}
