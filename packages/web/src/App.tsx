import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useMuse, BUFFER_SIZE, CHANNEL_NAMES, type XYZ } from './useMuse.ts';
import { useBrainState, type BrainState } from './useBrainState.ts';

const EEG_COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f7dc6f'];
const BAND_COLORS: Record<string, string> = {
  delta: '#636efa',
  theta: '#ab63fa',
  alpha: '#00cc96',
  beta: '#ffa15a',
  gamma: '#ef553b',
};
const BAND_LABELS: Record<string, string> = {
  delta: 'δ Delta',
  theta: 'θ Theta',
  alpha: 'α Alpha',
  beta: 'β Beta',
  gamma: 'γ Gamma',
};

export function App() {
  const muse = useMuse();
  const brain = useBrainState(muse.buffers, muse.writePos, muse.status === 'streaming');
  const streaming = muse.status === 'streaming';

  const hasBluetooth = typeof navigator !== 'undefined' && !!navigator.bluetooth;
  const busy = muse.status === 'pairing' || streaming;

  return (
    <div style={s.root}>
      <header style={s.header}>
        <h1 style={s.title}>BRAIN CLAW</h1>
        <div style={s.controls}>
          <ConnStatus status={muse.status} error={muse.error} mode={muse.mode} />
          {hasBluetooth && (
            <button
              onClick={muse.connectBLE}
              disabled={busy}
              style={{ ...s.btn, ...(busy ? s.btnOff : {}) }}
            >
              {streaming && muse.mode === 'ble' ? 'BLE Connected' : 'BLE Direct'}
            </button>
          )}
          <button
            onClick={() => muse.connectWS()}
            disabled={busy}
            style={{ ...s.btn, ...s.btnWs, ...(busy ? s.btnOff : {}) }}
          >
            {streaming && muse.mode === 'ws' ? 'WS Connected' : 'ESP32 Server'}
          </button>
        </div>
      </header>

      {streaming && brain.calibrating && <CalibrationBar progress={brain.calibrationProgress} />}

      <div style={s.grid}>
        {/* Left: Brain States */}
        <div style={s.panel}>
          <FocusIndicator brain={brain} />
          <Section title="BAND POWER">
            {(['delta', 'theta', 'alpha', 'beta', 'gamma'] as const).map((b) => (
              <Bar key={b} label={BAND_LABELS[b]} value={brain[b]} color={BAND_COLORS[b]} />
            ))}
          </Section>
          <Section title="EVENTS">
            <div style={s.evRow}>
              <span style={s.evLabel}>Blinks</span>
              <span style={s.evVal}>{brain.blinks}</span>
            </div>
            <div style={s.evRow}>
              <span style={s.evLabel}>Jaw clenches</span>
              <span style={s.evVal}>{brain.clenches}</span>
            </div>
          </Section>
          <Section title="CALM">
            <Bar label="α Calm" value={brain.calm} color="#00cc96" />
          </Section>
        </div>

        {/* Center: EEG + Motion */}
        <div style={s.center}>
          <EEGCanvas buffers={muse.buffers} writePos={muse.writePos} streaming={streaming} />
          <div style={s.motionRow}>
            <MotionPanel label="ACCELEROMETER" data={muse.accel} unit="g" />
            <MotionPanel label="GYROSCOPE" data={muse.gyro} unit="°/s" />
            <HeadTilt accel={muse.accel} />
          </div>
        </div>
      </div>

      <footer style={s.footer}>
        <div style={s.stats}>
          <span>Samples: <span style={s.statVal}>{muse.totalSamples.current.toLocaleString()}</span></span>
          <span>Battery: <span style={s.statVal}>{muse.battery != null ? `${muse.battery}%` : '—'}</span></span>
          <span>Temp: <span style={s.statVal}>{muse.temperature != null ? `${muse.temperature}°C` : '—'}</span></span>
        </div>
        <span>Muse 2 — all sensors active</span>
      </footer>
    </div>
  );
}

// ---- Sub-components ----

function ConnStatus({ status, error, mode }: { status: string; error: string | null; mode: string | null }) {
  const color = status === 'streaming' ? '#4ecdc4' : status === 'error' ? '#ff6b6b' : '#888';
  const tag = mode ? ` [${mode.toUpperCase()}]` : '';
  const text =
    status === 'streaming' ? `Streaming${tag}` :
    status === 'pairing' ? 'Connecting...' :
    status === 'error' ? `Error: ${error}` : 'Disconnected';
  return <span style={{ fontSize: 12, color }}>{text}</span>;
}

function CalibrationBar({ progress }: { progress: number }) {
  return (
    <div style={s.calBar}>
      <span style={{ color: '#888', fontSize: 12 }}>CALIBRATING — sit still and relax</span>
      <div style={s.calTrack}>
        <div style={{ ...s.calFill, width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  );
}

function FocusIndicator({ brain }: { brain: BrainState }) {
  if (brain.calibrating) return null;
  const color = brain.focused ? '#4ecdc4' : '#ff6b6b';
  return (
    <div style={{ ...s.focusBox, borderColor: color }}>
      <span style={{ color, fontSize: 24, fontWeight: 700, letterSpacing: 2 }}>
        {brain.focused ? 'TRUE' : 'FALSE'}
      </span>
      <span style={{ color: '#555', fontSize: 10 }}>{brain.focused ? 'focused' : 'relaxed'}</span>
      <div style={{ ...s.calTrack, marginTop: 6, height: 6 }}>
        <div style={{ ...s.calFill, width: `${Math.round(brain.focus * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={s.section}>
      <div style={s.secTitle}>{title}</div>
      {children}
    </div>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(value * 100);
  return (
    <div style={s.barRow}>
      <span style={{ ...s.barLabel, color }}>{label}</span>
      <div style={s.barTrack}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.1s' }} />
      </div>
      <span style={s.barPct}>{pct}%</span>
    </div>
  );
}

function MotionPanel({ label, data, unit }: { label: string; data: RefObject<XYZ>; unit: string }) {
  const [xyz, setXyz] = useState<XYZ>({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    const iv = setInterval(() => setXyz({ ...data.current }), 100);
    return () => clearInterval(iv);
  }, [data]);

  return (
    <div style={s.motionPanel}>
      <div style={s.motionTitle}>{label}</div>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <div key={axis} style={s.motionAxis}>
          <span style={{ color: axis === 'x' ? '#ff6b6b' : axis === 'y' ? '#4ecdc4' : '#45b7d1', width: 14 }}>
            {axis.toUpperCase()}
          </span>
          <span style={s.motionVal}>{xyz[axis].toFixed(2)} {unit}</span>
        </div>
      ))}
    </div>
  );
}

function HeadTilt({ accel }: { accel: RefObject<XYZ> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf: number;
    const draw = () => {
      const cvs = canvasRef.current;
      if (!cvs) return;
      const ctx = cvs.getContext('2d');
      if (!ctx) return;

      const size = 80;
      cvs.width = size * devicePixelRatio;
      cvs.height = size * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);

      const cx = size / 2, cy = size / 2, r = size / 2 - 4;
      const { x, y } = accel.current;

      // Rotate 90° CW to match Muse 2 orientation on forehead
      const dx = Math.max(-1, Math.min(1, -y)) * r * 0.7;
      const dy = Math.max(-1, Math.min(1, x)) * r * 0.7;

      ctx.clearRect(0, 0, size, size);

      // Outer ring
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // Crosshair
      ctx.strokeStyle = '#1a1a2e';
      ctx.beginPath();
      ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
      ctx.stroke();

      // Dot
      ctx.fillStyle = '#4ecdc4';
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, 5, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [accel]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={s.motionTitle}>HEAD TILT</div>
      <canvas ref={canvasRef} style={{ width: 80, height: 80 }} />
    </div>
  );
}

function EEGCanvas({
  buffers, writePos, streaming,
}: {
  buffers: Float64Array[];
  writePos: Uint32Array;
  streaming: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<() => void>(undefined);

  drawRef.current = () => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    const dpr = devicePixelRatio;
    const w = cvs.clientWidth;
    const h = cvs.clientHeight;

    if (cvs.width !== w * dpr || cvs.height !== h * dpr) {
      cvs.width = w * dpr;
      cvs.height = h * dpr;
      ctx.scale(dpr, dpr);
    }

    const rowH = h / 4;
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    for (let ch = 0; ch < 4; ch++) {
      const y0 = ch * rowH;
      const mid = y0 + rowH / 2;

      if (ch > 0) {
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y0); ctx.lineTo(w, y0);
        ctx.stroke();
      }

      ctx.strokeStyle = '#1a1a2e';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(40, mid); ctx.lineTo(w, mid);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = EEG_COLORS[ch];
      ctx.font = '12px monospace';
      ctx.fillText(CHANNEL_NAMES[ch], 6, y0 + 16);

      const buf = buffers[ch];
      const pos = writePos[ch];
      const count = Math.min(pos, BUFFER_SIZE);
      if (count < 2) continue;

      ctx.strokeStyle = EEG_COLORS[ch];
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const xStep = w / count;
      for (let i = 0; i < count; i++) {
        const idx = (pos - count + i + BUFFER_SIZE) % BUFFER_SIZE;
        const x = i * xStep;
        const y = mid - (buf[idx] / 500) * (rowH * 0.4);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  };

  useEffect(() => {
    if (!streaming) return;
    let raf: number;
    const loop = () => { drawRef.current?.(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [streaming]);

  return <canvas ref={canvasRef} style={{ flex: 1, width: '100%', display: 'block', minHeight: 0 }} />;
}

// ---- Styles ----

const s: Record<string, CSSProperties> = {
  root: {
    background: '#0a0a1a', color: '#e0e0e0',
    fontFamily: "'SF Mono','Fira Code',Consolas,monospace",
    height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 0,
  },
  noBt: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    height: '100vh', fontFamily: 'monospace', color: '#ff6b6b', background: '#0a0a1a',
    textAlign: 'center', padding: 20,
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', background: '#111128', borderBottom: '1px solid #222',
  },
  title: { fontSize: 15, fontWeight: 600, letterSpacing: 1, margin: 0 },
  controls: { display: 'flex', gap: 12, alignItems: 'center' },
  btn: {
    background: '#4ecdc4', color: '#0a0a1a', border: 'none', padding: '7px 18px',
    borderRadius: 4, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  btnWs: { background: '#636efa' },
  btnOff: { background: '#333', color: '#666', cursor: 'default' },
  grid: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 },
  panel: {
    width: 220, background: '#0d0d1e', borderRight: '1px solid #1a1a2e',
    overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12,
  },
  center: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  section: { display: 'flex', flexDirection: 'column', gap: 5 },
  secTitle: { fontSize: 10, fontWeight: 600, color: '#555', letterSpacing: 1, marginBottom: 2 },
  barRow: { display: 'flex', alignItems: 'center', gap: 6 },
  barLabel: { fontSize: 11, width: 66, flexShrink: 0 },
  barTrack: {
    flex: 1, height: 6, background: '#1a1a2e', borderRadius: 3, overflow: 'hidden',
  },
  barPct: { fontSize: 10, color: '#666', width: 30, textAlign: 'right' },
  evRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  evLabel: { fontSize: 11, color: '#888' },
  evVal: { fontSize: 14, fontWeight: 600, color: '#e0e0e0' },
  focusBox: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    border: '2px solid', borderRadius: 8, padding: '10px 16px',
  },
  calBar: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '10px 20px', background: '#0d0d20', borderBottom: '1px solid #1a1a2e',
  },
  calTrack: {
    flex: 1, height: 5, background: '#1a1a2e', borderRadius: 3, overflow: 'hidden',
  },
  calFill: {
    height: '100%', background: '#4ecdc4', borderRadius: 3, transition: 'width 0.3s',
  },
  motionRow: {
    display: 'flex', gap: 16, padding: '10px 14px',
    background: '#0d0d1e', borderTop: '1px solid #1a1a2e', alignItems: 'flex-start',
  },
  motionPanel: { display: 'flex', flexDirection: 'column', gap: 3 },
  motionTitle: { fontSize: 10, fontWeight: 600, color: '#555', letterSpacing: 1, marginBottom: 2 },
  motionAxis: { display: 'flex', gap: 8, fontSize: 11 },
  motionVal: { color: '#aaa', fontVariantNumeric: 'tabular-nums' },
  footer: {
    display: 'flex', justifyContent: 'space-between', padding: '7px 20px',
    background: '#111128', borderTop: '1px solid #222', fontSize: 11, color: '#555',
  },
  stats: { display: 'flex', gap: 20 },
  statVal: { color: '#aaa' },
};
