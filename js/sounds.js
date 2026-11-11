// Table sounds, synthesized in code with the iPhone app's formulas (no sound files): card
// snaps, the deal, the pass, breaking glass when hearts are broken, a doom chord for the
// Q♠, and a fanfare when you win.

const RATE = 44100;
let ctx = null;
const buffers = {};
export const sound = { on: true };

/** Repeatable white noise, so each sound is the same every time. */
function noise(seed) {
  let state = BigInt(seed);
  return () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
    return Number(state >> 11n) / 2 ** 53 * 2 - 1;
  };
}

const silence = (seconds) => new Float32Array(Math.floor(seconds * RATE));

/** A card slapped on felt: a bright noise click over a soft low thump. */
function snap(seed = 7, volume = 0.5, length = 0.07) {
  const next = noise(seed), out = silence(length);
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE, n = next();
    const bright = n - last; last = n;                       // High-pass: the papery click.
    const click = bright * Math.exp(-t / 0.008);
    const thump = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t / 0.015) * 0.6;
    out[i] = volume * (click * 0.7 + thump) * Math.min(1, t / 0.0005);
  }
  return out;
}

/** Thirteen quick flicks, a card every 45 ms, a little uneven like a real deal. */
function deal() {
  const out = silence(13 * 0.045 + 0.1);
  for (let c = 0; c < 13; c++) {
    const flick = snap(c + 11, c % 3 === 1 ? 0.3 : 0.36, 0.04);
    const start = Math.floor((c * 0.045 + (c % 2 === 0 ? 0 : 0.006)) * RATE);
    for (let i = 0; i < flick.length && start + i < out.length; i++) out[start + i] += flick[i];
  }
  return out;
}

/** Three cards sliding across the table: soft noise swelling and fading. */
function swish() {
  const next = noise(3), length = 0.32, out = silence(length);
  let low = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE, shape = Math.sin(Math.PI * t / length);
    low += (0.08 + 0.35 * shape) * (next() - low);           // Low-pass that opens and closes: whoosh.
    out[i] = 0.45 * low * shape * shape;
  }
  return out;
}

/** A crack, then dozens of high glassy pings scattering and dying away. */
function glass() {
  const next = noise(99), length = 1.1, out = silence(length);
  let last = 0;
  for (let i = 0; i < Math.floor(0.05 * RATE); i++) {
    const t = i / RATE, n = next();
    out[i] += 0.55 * (n - last) * Math.exp(-t / 0.012);
    last = n;
  }
  for (let k = 0; k < 45; k++) {
    const start = ((next() + 1) / 2) ** 2 * 0.55;            // Bunched near the crack.
    const frequency = 2500 + (next() + 1) / 2 * 6000;
    const decay = 0.03 + (next() + 1) / 2 * 0.12;
    const volume = 0.05 + (next() + 1) / 2 * 0.08;
    const first = Math.floor(start * RATE);
    for (let i = 0; i < Math.floor(decay * 5 * RATE) && first + i < out.length; i++) {
      const t = i / RATE;
      const ping = Math.sin(2 * Math.PI * frequency * t) + 0.4 * Math.sin(2 * Math.PI * frequency * 2.76 * t);
      out[first + i] += volume * ping * Math.exp(-t / decay) * Math.min(1, t / 0.001);
    }
  }
  return out;
}

/** Dun… dun… DUNNN: low brassy notes falling to a long rumble. */
function doom() {
  const next = noise(13), length = 2.75, out = silence(length);
  const notes = [[0.00, 0.38, 73.42, 0.7], [0.45, 0.38, 73.42, 0.7], [0.90, 1.70, 58.27, 1.0]];   // D2 D2 B♭1
  const harmonics = [[1, 1], [2, 0.8], [3, 0.55], [4, 0.35], [5, 0.2], [6, 0.12]];
  for (const [start, len, f, vol] of notes) {
    const first = Math.floor(start * RATE);
    for (let i = 0; i < Math.floor(len * RATE) && first + i < out.length; i++) {
      const t = i / RATE;
      const envelope = Math.min(1, t / 0.02) * Math.exp(-1.6 * t / len);
      let v = 0;
      for (const [h, w] of harmonics) v += w * (Math.sin(2 * Math.PI * f * h * t) + Math.sin(2 * Math.PI * (f + 0.7) * h * t));
      out[first + i] += 0.09 * vol * envelope * v;
    }
  }
  let low = 0;
  const rumbleStart = Math.floor(0.9 * RATE);                 // Rumble under the last note.
  for (let i = rumbleStart; i < out.length; i++) {
    const t = (i - rumbleStart) / RATE;
    low += 0.02 * (next() - low);
    out[i] += 1.6 * low * Math.min(1, t / 0.1) * Math.exp(-t / 0.9);
  }
  return out;
}

function fanfare() {
  const notes = [[0, 0.16, [523.25]], [0.13, 0.16, [659.25]], [0.26, 0.16, [783.99]], [0.39, 0.22, [1046.5]],
    [0.58, 1.1, [523.25, 659.25, 783.99, 1046.5]]];
  const out = silence(1.75);
  for (const [start, length, freqs] of notes) {
    const first = Math.floor(start * RATE);
    for (let n = 0; n < Math.floor(length * RATE) && first + n < out.length; n++) {
      const t = n / RATE;
      const envelope = Math.min(1, t / 0.01) * Math.exp(-3.2 * t / length);
      let v = 0;
      for (const fr of freqs) v += Math.sin(2 * Math.PI * fr * t) + 0.35 * Math.sin(4 * Math.PI * fr * t) + 0.12 * Math.sin(6 * Math.PI * fr * t);
      out[first + n] += 0.22 * envelope * v / Math.sqrt(freqs.length);
    }
  }
  return out;
}

const MAKERS = { snap: () => snap(), deal, pass: swish, glass, doom, fanfare };

/** Browsers only allow sound after a tap: call this from one. */
export function unlockSound() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
}

export function play(name, delay = 0) {
  if (!sound.on || !ctx || ctx.state !== 'running') return;
  if (!buffers[name]) {
    const samples = MAKERS[name]();
    const buffer = ctx.createBuffer(1, samples.length, RATE);
    buffer.getChannelData(0).set(samples.map((v) => Math.max(-0.95, Math.min(0.95, v))));
    buffers[name] = buffer;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffers[name];
  source.connect(ctx.destination);
  source.start(ctx.currentTime + delay / 1000);
}
