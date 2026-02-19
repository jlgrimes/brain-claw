import { useEffect, useRef, useState } from 'react';
import { bandPower } from './fft.ts';
import { BUFFER_SIZE } from './useMuse.ts';

const SR = 256;
const FFT_SIZE = 256;
const SMOOTH = 0.2;
const CAL_SECONDS = 8;
const UPDATE_HZ = 10;

// Frequency bands (Hz)
const BANDS = {
  delta: [1, 4],
  theta: [4, 8],
  alpha: [8, 12],
  beta: [13, 30],
  gamma: [30, 50],
} as const;

// Blink/clench detection
const BLINK_THRESHOLD = 400; // µV — blinks are large frontal spikes
const CLENCH_THRESHOLD = 300; // µV — clenches are temporal EMG bursts
const REFRACTORY_MS = 600;

export interface BrainState {
  // Relative band powers (0-1, sum ≈ 1)
  delta: number;
  theta: number;
  alpha: number;
  beta: number;
  gamma: number;
  // Derived scores (0-1)
  focus: number;
  calm: number;
  focused: boolean;
  // Events
  blinks: number;
  clenches: number;
  // Calibration
  calibrating: boolean;
  calibrationProgress: number;
}

const INITIAL: BrainState = {
  delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0,
  focus: 0, calm: 0, focused: false,
  blinks: 0, clenches: 0,
  calibrating: true, calibrationProgress: 0,
};

export function useBrainState(
  buffers: Float64Array[],
  writePos: Uint32Array,
  streaming: boolean,
): BrainState {
  const [state, setState] = useState<BrainState>(INITIAL);

  const smoothBands = useRef({ delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 });
  const focusRatios = useRef<number[]>([]);
  const focusThreshold = useRef(0);
  const calmBaseline = useRef(0);
  const t0 = useRef(0);
  const blinks = useRef(0);
  const clenches = useRef(0);
  const lastBlinkT = useRef(0);
  const lastClenchT = useRef(0);
  // Track previous write positions for spike scanning
  const prevPos = useRef(new Uint32Array(4));

  useEffect(() => {
    if (!streaming) return;

    t0.current = performance.now();
    smoothBands.current = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
    focusRatios.current = [];
    focusThreshold.current = 0;
    calmBaseline.current = 0;
    blinks.current = 0;
    clenches.current = 0;
    prevPos.current = new Uint32Array(writePos);

    const iv = setInterval(() => {
      const now = performance.now();

      // --- Find peak amplitude on frontal (AF7=1, AF8=2) vs temporal (TP9=0, TP10=3) ---
      let frontalPeak = 0;
      let temporalPeak = 0;

      for (const ch of [0, 1, 2, 3]) {
        const cur = writePos[ch];
        const prev = prevPos.current[ch];
        if (cur <= prev) continue;
        for (let i = prev; i < cur; i++) {
          const val = Math.abs(buffers[ch][i % BUFFER_SIZE]);
          if (ch === 1 || ch === 2) {
            if (val > frontalPeak) frontalPeak = val;
          } else {
            if (val > temporalPeak) temporalPeak = val;
          }
        }
      }

      // Blink: large frontal spike that's dominant over temporal
      if (
        frontalPeak > BLINK_THRESHOLD &&
        frontalPeak > temporalPeak * 1.5 &&
        now - lastBlinkT.current > REFRACTORY_MS
      ) {
        blinks.current++;
        lastBlinkT.current = now;
      }

      // Jaw clench: large temporal burst that's dominant over frontal
      if (
        temporalPeak > CLENCH_THRESHOLD &&
        temporalPeak > frontalPeak * 1.5 &&
        now - lastClenchT.current > REFRACTORY_MS
      ) {
        clenches.current++;
        lastClenchT.current = now;
      }

      prevPos.current = new Uint32Array(writePos);

      // --- Band powers (average across all 4 channels) ---
      const raw = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
      let validChannels = 0;

      for (let ch = 0; ch < 4; ch++) {
        const pos = writePos[ch];
        if (pos < FFT_SIZE) continue;
        validChannels++;

        const window = new Float64Array(FFT_SIZE);
        for (let i = 0; i < FFT_SIZE; i++) {
          window[i] = buffers[ch][(pos - FFT_SIZE + i + BUFFER_SIZE) % BUFFER_SIZE];
        }

        for (const [name, [lo, hi]] of Object.entries(BANDS)) {
          raw[name as keyof typeof raw] += bandPower(window, SR, lo, hi);
        }
      }

      if (validChannels === 0) return;

      for (const k of Object.keys(raw) as (keyof typeof raw)[]) {
        raw[k] /= validChannels;
      }

      // Smooth
      const sb = smoothBands.current;
      for (const k of Object.keys(raw) as (keyof typeof raw)[]) {
        sb[k] = sb[k] === 0 ? raw[k] : sb[k] * (1 - SMOOTH) + raw[k] * SMOOTH;
      }

      // Relative powers
      const total = sb.delta + sb.theta + sb.alpha + sb.beta + sb.gamma;
      const rel = {
        delta: total > 0 ? sb.delta / total : 0,
        theta: total > 0 ? sb.theta / total : 0,
        alpha: total > 0 ? sb.alpha / total : 0,
        beta: total > 0 ? sb.beta / total : 0,
        gamma: total > 0 ? sb.gamma / total : 0,
      };

      // Focus = beta/alpha on frontal channels
      const focusRatio = sb.alpha > 0 ? sb.beta / sb.alpha : 0;

      // Calibration
      const elapsed = (now - t0.current) / 1000;
      const calibrating = elapsed < CAL_SECONDS;

      if (calibrating) {
        focusRatios.current.push(focusRatio);
        setState({
          ...rel,
          focus: 0, calm: 0, focused: false,
          blinks: blinks.current, clenches: clenches.current,
          calibrating: true,
          calibrationProgress: Math.min(1, elapsed / CAL_SECONDS),
        });
        return;
      }

      // Set thresholds once
      if (focusThreshold.current === 0 && focusRatios.current.length > 0) {
        const sorted = [...focusRatios.current].sort((a, b) => a - b);
        focusThreshold.current = sorted[Math.floor(sorted.length * 0.6)];
        calmBaseline.current = rel.alpha;
      }

      const ft = focusThreshold.current;
      const focus = ft > 0 ? Math.max(0, Math.min(1, (focusRatio / ft - 0.5) * 1.2)) : 0;
      const calm = calmBaseline.current > 0
        ? Math.max(0, Math.min(1, rel.alpha / (calmBaseline.current * 2)))
        : rel.alpha;

      setState({
        ...rel,
        focus,
        calm,
        focused: focusRatio > ft,
        blinks: blinks.current,
        clenches: clenches.current,
        calibrating: false,
        calibrationProgress: 1,
      });
    }, 1000 / UPDATE_HZ);

    return () => clearInterval(iv);
  }, [streaming, buffers, writePos]);

  return state;
}
