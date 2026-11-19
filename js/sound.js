// Sound, off unless Sound is switched on in the game's menu: a rattle as dice are thrown, louder and busier the more of
// them there are, and a pencil scratch as a score is written in. Both are made here, from noise and a few tones, each
// time they play, so no two throws sound quite alike and there are no sound files. A short buzz as you hold a die is in
// js/app.js (navigator.vibrate, which only some phones have).

let ctx = null;

// The browser's sound, made the first time it's wanted. A phone only lets a page make sound once it's been tapped, so
// every tap that leads to a sound (Roll, a box, the switch itself) wakes it again in case it has been put to sleep.
function audio() {
  if (!ctx) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    try { ctx = new Context(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
export const wake = () => { audio(); };

function play(samples, volume) {
  const c = audio();
  if (!c) return;
  try {
    const buffer = c.createBuffer(1, samples.length, c.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = c.createBufferSource(), gain = c.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain).connect(c.destination);
    source.start();
  } catch { /* no sound this time */ }
}

// Dice thrown into the felt tray: `n` of them, landing in `tumble` seconds (--tumble in css/app.css). Each die lands as
// its hop does, a thud on the felt at about half way and a softer one as it settles, and with more than one, dice click
// off each other on the way. More dice, more hits: louder and busier.
export function rattle(n, tumble = 0.7) {
  const c = audio();
  if (!c || n < 1) return;
  play(rattleSamples(n, tumble, c.sampleRate), 0.8);
}

// A number written in pencil: two or three short strokes of grainy, high noise.
export function scratch() {
  const c = audio();
  if (!c) return;
  play(scratchSamples(c.sampleRate), 0.12); // soft: a pencil, under the dice
}

// The hits a throw of `n` dice makes, in seconds from the throw, each with how hard it is (0 to 1) and what it is.
export function rattleHits(n, tumble, rand = Math.random) {
  const hits = [], at = (a, b) => tumble * (a + (b - a) * rand());
  for (let i = 0; i < n; i++) {
    hits.push({ t: at(0.48, 0.6), v: 0.75 + 0.25 * rand(), kind: 'felt' }); // lands
    hits.push({ t: at(0.62, 0.78), v: 0.3 + 0.2 * rand(), kind: 'felt' }); // bounces
    hits.push({ t: at(0.9, 1.02), v: 0.2 + 0.15 * rand(), kind: 'felt' }); // settles
    if (n > 1) hits.push({ t: at(0.15, 0.9), v: 0.35 + 0.35 * rand(), kind: 'click' }); // off another die
    if (rand() < 0.2) hits.push({ t: at(0.45, 0.8), v: 0.4 + 0.3 * rand(), kind: 'wood' }); // off the frame
  }
  return hits.sort((a, b) => a.t - b.t);
}

function rattleSamples(n, tumble, rate) {
  const out = new Float32Array(Math.ceil(rate * (tumble * 1.05 + 0.12)));
  for (const { t, v, kind } of rattleHits(n, tumble)) {
    const start = Math.floor(t * rate);
    if (kind === 'felt') {
      // A muffled thud: noise through a soft low-pass, with a low knock under it.
      const knock = 170 + 90 * Math.random(), len = Math.floor(rate * 0.05);
      let low = 0;
      for (let k = 0; k < len && start + k < out.length; k++) {
        const s = k / rate, env = Math.exp(-s / 0.012);
        low += 0.22 * ((Math.random() * 2 - 1) - low);
        out[start + k] += v * env * (0.9 * low + 0.35 * Math.sin(2 * Math.PI * knock * s) * Math.exp(-s / 0.02));
      }
    } else {
      // Die on die, or on the wooden frame: a short ring of a few tones, brighter for a die.
      const tones = kind === 'click' ? [2300 + 500 * Math.random(), 3900 + 700 * Math.random(), 5600 + 800 * Math.random()] : [420 + 120 * Math.random(), 980 + 200 * Math.random()];
      const decay = kind === 'click' ? 0.006 : 0.025, len = Math.floor(rate * decay * 7);
      for (let k = 0; k < len && start + k < out.length; k++) {
        const s = k / rate, env = Math.exp(-s / decay);
        let ring = 0;
        for (const f of tones) ring += Math.sin(2 * Math.PI * f * s);
        out[start + k] += v * env * (0.3 * ring / tones.length + 0.15 * (Math.random() * 2 - 1));
      }
    }
  }
  for (let k = 0; k < out.length; k++) out[k] = Math.tanh(out[k]); // five dice landing at once stay round, not clipped
  return out;
}

function scratchSamples(rate) {
  const out = new Float32Array(Math.ceil(rate * 0.5));
  const strokes = 2 + Math.floor(Math.random() * 2);
  let t = 0.01, hp = 0, last = 0, grain = 0;
  for (let i = 0; i < strokes; i++) {
    const len = 0.08 + 0.08 * Math.random(), v = 0.6 + 0.4 * Math.random();
    const a = Math.floor(t * rate), b = Math.min(out.length, Math.floor((t + len) * rate));
    for (let k = a; k < b; k++) {
      const s = (k - a) / rate, env = Math.min(1, s / 0.012) * Math.min(1, (len - s) / 0.03);
      const x = Math.random() * 2 - 1;
      hp = 0.85 * (hp + x - last); // high-pass: the hiss of graphite on paper, not a rumble
      last = x;
      if (k % 64 === 0) grain = 0.5 + Math.random(); // the paper's tooth
      out[k] = v * env * grain * hp * 0.5;
    }
    t += len + 0.02 + 0.04 * Math.random();
  }
  return out;
}
