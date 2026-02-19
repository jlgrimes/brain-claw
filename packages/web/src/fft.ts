/** In-place radix-2 Cooley-Tukey FFT. Arrays must be power-of-2 length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wR = Math.cos(ang),
      wI = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cR = 1,
        cI = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const a = i + j,
          b = a + half;
        const tR = re[b] * cR - im[b] * cI;
        const tI = re[b] * cI + im[b] * cR;
        re[b] = re[a] - tR;
        im[b] = im[a] - tI;
        re[a] += tR;
        im[a] += tI;
        const nR = cR * wR - cI * wI;
        cI = cR * wI + cI * wR;
        cR = nR;
      }
    }
  }
}

/** Compute average power (µV²) in a frequency band from raw time-domain samples. */
export function bandPower(
  samples: Float64Array,
  sampleRate: number,
  lowHz: number,
  highHz: number,
): number {
  const n = samples.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);

  // Hanning window
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    re[i] = samples[i] * w;
  }

  fft(re, im);

  const binHz = sampleRate / n;
  const lo = Math.ceil(lowHz / binHz);
  const hi = Math.floor(highHz / binHz);

  let power = 0;
  for (let k = lo; k <= hi; k++) {
    power += re[k] * re[k] + im[k] * im[k];
  }
  return power / (hi - lo + 1);
}
