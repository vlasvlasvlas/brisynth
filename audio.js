// audio.js — Síntesis de cuerdas con escalas configurables

let audioCtx;
let master;
let limiter;
let dryBus;
let reverbBus;
let tensionVoice;
let windDrone = null;
let muted = false;
let lastPreview = 0;
const hoverCooldowns = {};

// ── Escalas musicales ─────────────────────────────────────────────────────────
const SCALES = {
  pentatonicMinor: [0, 3, 5, 7, 10],
  major:           [0, 2, 4, 5, 7, 9, 11],
  blues:           [0, 3, 5, 6, 7, 10],
  arabic:          [0, 1, 4, 5, 7, 8, 11],
  japanese:        [0, 2, 5, 7, 9],
  chromatic:       [0,1,2,3,4,5,6,7,8,9,10,11],
};
let SCALE = SCALES.pentatonicMinor;

export function setScale(name) {
  SCALE = SCALES[name] || SCALES.pentatonicMinor;
}

const NOTE_NAMES = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];

function createImpulse(seconds = 2.8, decay = 3.8) {
  const length = Math.floor(audioCtx.sampleRate * seconds);
  const impulse = audioCtx.createBuffer(2, length, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decay);
      data[i] = (Math.random() * 2 - 1) * env * (0.65 + Math.random() * 0.35);
    }
  }
  return impulse;
}

export function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    master    = audioCtx.createGain();
    limiter   = audioCtx.createDynamicsCompressor();
    dryBus    = audioCtx.createGain();
    reverbBus = audioCtx.createConvolver();
    const wet = audioCtx.createGain();

    master.gain.value        = 0.32;
    dryBus.gain.value        = 0.9;
    wet.gain.value           = 0.24;
    limiter.threshold.value  = -18;
    limiter.knee.value       = 12;
    limiter.ratio.value      = 10;
    limiter.attack.value     = 0.004;
    limiter.release.value    = 0.20;
    reverbBus.buffer         = createImpulse();

    dryBus.connect(master);
    reverbBus.connect(wet);
    wet.connect(master);
    master.connect(limiter);
    limiter.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

export function setMuted(value) {
  muted = value;
  if (!audioCtx || !master) return;
  master.gain.setTargetAtTime(muted ? 0.0001 : 0.32, audioCtx.currentTime, 0.035);
}

function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

function quantizeMidi(raw) {
  let best = 38, dist = Infinity;
  for (let midi = 38; midi <= 82; midi++) {
    const pc = ((midi - 2) % 12 + 12) % 12;
    if (!SCALE.includes(pc)) continue;
    const d = Math.abs(midi - raw);
    if (d < dist) { best = midi; dist = d; }
  }
  return best;
}

export function describeString(length, tension, variant = 0) {
  const raw  = 43 + tension * 19 + Math.max(-2, (15 - length) * 1.7) + variant;
  const midi = quantizeMidi(raw);
  return { midi, frequency: midiToFreq(midi), note: `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}` };
}

function routeWithPan(source, pan, dry = 1, wet = 0.2) {
  const panner  = audioCtx.createStereoPanner();
  const dryGain = audioCtx.createGain();
  const wetGain = audioCtx.createGain();
  panner.pan.value   = Math.max(-0.85, Math.min(0.85, pan));
  dryGain.gain.value = dry;
  wetGain.gain.value = wet;
  source.connect(panner);
  panner.connect(dryGain);
  panner.connect(wetGain);
  dryGain.connect(dryBus);
  wetGain.connect(reverbBus);
  return [panner, dryGain, wetGain];
}

export function pluckString(length, tension = 0.65, velocity = 0.7, tone = 0.45, resonance = 0.7, pan = 0, variant = 0) {
  if (!audioCtx || muted) return;
  const now        = audioCtx.currentTime;
  const { frequency } = describeString(length, tension, variant);
  const duration   = 0.75 + resonance * 4.2;
  const brightness = 0.18 + tone * 0.82;
  const level      = 0.025 + Math.min(1, velocity) * 0.088;
  const partials   = [1, 2, 3, 4.03, 5.08, 6.15];
  const nodes      = [];

  partials.forEach((ratio, index) => {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const amp  = level * Math.pow(brightness, index * 0.7) / Math.pow(index + 1, 0.72);
    const dur  = duration / (1 + index * (0.2 + (1 - tone) * 0.18));

    osc.type = index < 2 ? 'sine' : 'triangle';
    osc.frequency.value = frequency * ratio;
    osc.detune.value    = (Math.random() - 0.5) * (1.5 + index);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(amp, now + 0.006 + index * 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    const r = routeWithPan(gain, pan, 0.88, 0.12 + resonance * 0.16);
    osc.start(now); osc.stop(now + dur + 0.08);
    nodes.push(osc, gain, ...r);
  });

  // Ruido de ataque
  const noiseLen  = Math.floor(audioCtx.sampleRate * 0.028);
  const noiseBuf  = audioCtx.createBuffer(1, noiseLen, audioCtx.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) noiseData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / noiseLen, 3);
  const noise       = audioCtx.createBufferSource();
  const noiseFilter = audioCtx.createBiquadFilter();
  const noiseGain   = audioCtx.createGain();
  noise.buffer            = noiseBuf;
  noiseFilter.type        = 'bandpass';
  noiseFilter.frequency.value = 900 + tone * 2100;
  noiseFilter.Q.value     = 0.7;
  noiseGain.gain.value    = level * 0.13;
  noise.connect(noiseFilter); noiseFilter.connect(noiseGain);
  const nr = routeWithPan(noiseGain, pan, 0.75, 0.1);
  noise.start(now);
  nodes.push(noise, noiseFilter, noiseGain, ...nr);

  window.setTimeout(() => nodes.forEach(n => { try { n.disconnect(); } catch {} }), (duration + 1) * 1000);
}

// ── Arpa: hover — bien fuerte y presente ─────────────────────────────────────
export function hoverString(ropeId, length, tension, variant = 0, pan = 0, velocity = 0.5) {
  if (!audioCtx || muted) return;
  const now = performance.now();
  if (hoverCooldowns[ropeId] && now - hoverCooldowns[ropeId] < 90) return;
  hoverCooldowns[ropeId] = now;

  const { frequency } = describeString(length, tension, variant);
  const dur = 1.0 + tension * 2.8;
  // Nivel bastante más alto que antes
  const lev = 0.032 + velocity * 0.072;
  const nodes = [];

  [1, 2, 3, 4].forEach((ratio, i) => {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = i === 0 ? 'sine' : 'triangle';
    osc.frequency.value = frequency * ratio;
    osc.detune.value    = (Math.random() - 0.5) * 2.5;
    const amp  = lev / Math.pow(i + 1, 0.85);
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(amp, audioCtx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.connect(gain);
    // Más reverb (0.55) para el efecto arpa
    const r = routeWithPan(gain, pan, 0.38, 0.55);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + dur + 0.06);
    nodes.push(osc, gain, ...r);
  });

  window.setTimeout(() => nodes.forEach(n => { try { n.disconnect(); } catch {} }), (dur + 0.5) * 1000);
}

export function playTieSound(side = 'left') {
  if (!audioCtx || muted) return;
  const now = audioCtx.currentTime;
  const osc    = audioCtx.createOscillator();
  const gain   = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(side === 'left' ? 164 : 220, now);
  osc.frequency.exponentialRampToValueAtTime(side === 'left' ? 122 : 164, now + 0.16);
  filter.type = 'lowpass'; filter.frequency.value = 680;
  gain.gain.setValueAtTime(0.025, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  osc.connect(filter); filter.connect(gain);
  const routing = routeWithPan(gain, side === 'left' ? -0.7 : 0.7, 0.8, 0.2);
  osc.start(now); osc.stop(now + 0.2);
  window.setTimeout(() => [osc, filter, gain, ...routing].forEach(n => { try { n.disconnect(); } catch {} }), 500);
}

export function playTension(length, tension, tone = 0.45, variant = 0) {
  if (!audioCtx || muted) return;
  const nowMs = performance.now();
  if (nowMs - lastPreview < 90) return;
  lastPreview = nowMs;
  pluckString(length, tension, 0.18, tone * 0.7, 0.25, 0, variant);
}

export function startTensionSound(baseFreq = 90) {
  if (!audioCtx || tensionVoice || muted) return;
  const bufLen = Math.floor(audioCtx.sampleRate * 2.0);
  const buffer = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
  const data   = buffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < data.length; i++) {
    brown  = brown * 0.992 + (Math.random() * 2 - 1) * 0.008;
    data[i] = brown * 2.5;
  }
  const source = audioCtx.createBufferSource();
  const filter = audioCtx.createBiquadFilter();
  const gain   = audioCtx.createGain();
  source.buffer = buffer; source.loop = true;
  filter.type = 'bandpass'; filter.frequency.value = 240; filter.Q.value = 0.6;
  gain.gain.value = 0.0001;
  source.connect(filter); filter.connect(gain); gain.connect(dryBus);
  source.start();

  const osc     = audioCtx.createOscillator();
  const oscFilt = audioCtx.createBiquadFilter();
  const oscGain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = baseFreq * 0.5;
  oscFilt.type = 'bandpass'; oscFilt.Q.value = 10;
  oscFilt.frequency.value = baseFreq * 0.5;
  oscGain.gain.value = 0.0001;
  osc.connect(oscFilt); oscFilt.connect(oscGain); oscGain.connect(dryBus);
  osc.start();
  tensionVoice = { source, filter, gain, osc, oscFilt, oscGain };
}

export function updateTensionSound(tension, speed = 0, targetFreq = null) {
  if (!audioCtx || !tensionVoice || muted) return;
  const now      = audioCtx.currentTime;
  const movement = Math.min(1, speed * 0.04);
  const noiseVol = Math.min(0.0038, Math.max(0, tension - 0.1) * 0.003 + movement * 0.0004);
  tensionVoice.filter.frequency.setTargetAtTime(200 + tension * 480, now, 0.1);
  tensionVoice.gain.gain.setTargetAtTime(Math.max(0.0001, noiseVol), now, 0.1);
  if (targetFreq && tension > 0.04) {
    const sweepFreq = targetFreq * (0.28 + tension * 0.82);
    tensionVoice.osc.frequency.setTargetAtTime(sweepFreq, now, 0.06);
    tensionVoice.oscFilt.frequency.setTargetAtTime(sweepFreq, now, 0.06);
    tensionVoice.oscGain.gain.setTargetAtTime(0.0002 + tension * 0.0007, now, 0.08);
  } else {
    tensionVoice.oscGain.gain.setTargetAtTime(0.0001, now, 0.12);
  }
}

// ── Dron de viento ────────────────────────────────────────────────────────────
export function startWindDrone(speed = 0.3) {
  if (!audioCtx || windDrone || muted) return;

  // Ruido marrón con más energía
  const bufLen = Math.floor(audioCtx.sampleRate * 3.0);
  const buffer = audioCtx.createBuffer(2, bufLen, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let b = 0;
    for (let i = 0; i < bufLen; i++) {
      b = b * 0.993 + (Math.random() * 2 - 1) * 0.007;
      data[i] = Math.max(-1, Math.min(1, b * 3.5));
    }
  }

  const src = audioCtx.createBufferSource();
  src.buffer = buffer; src.loop = true;

  const freq1 = 80 + speed * 300;
  const freq2 = freq1 * 1.62; // áurea

  // Dos filtros resonantes en paralelo — silbido de viento en dos armónicos
  const f1 = audioCtx.createBiquadFilter();
  const f2 = audioCtx.createBiquadFilter();
  f1.type = 'bandpass'; f1.frequency.value = freq1; f1.Q.value = 4.5;
  f2.type = 'bandpass'; f2.frequency.value = freq2; f2.Q.value = 2.8;

  const g1 = audioCtx.createGain(); g1.gain.value = 0.65;
  const g2 = audioCtx.createGain(); g2.gain.value = 0.40;

  const out = audioCtx.createGain(); out.gain.value = 0.0001;

  src.connect(f1); f1.connect(g1); g1.connect(out);
  src.connect(f2); f2.connect(g2); g2.connect(out);
  out.connect(dryBus);
  src.start();

  // Fade-in con nivel audible real
  out.gain.setTargetAtTime(0.22 + speed * 0.28, audioCtx.currentTime, 0.7);

  windDrone = { src, f1, f2, g1, g2, out };
}

export function updateWindDrone(speed) {
  if (!audioCtx || !windDrone) return;
  const now  = audioCtx.currentTime;
  const freq = 80 + speed * 300;
  windDrone.f1.frequency.setTargetAtTime(freq,        now, 0.3);
  windDrone.f2.frequency.setTargetAtTime(freq * 1.62, now, 0.3);
  windDrone.out.gain.setTargetAtTime(0.22 + speed * 0.28, now, 0.2);
}

export function stopWindDrone() {
  if (!audioCtx || !windDrone) return;
  const v = windDrone; windDrone = null;
  v.out.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.5);
  window.setTimeout(() => {
    try { v.src.stop(); } catch {}
    [v.src, v.f1, v.f2, v.g1, v.g2, v.out].forEach(n => { try { n.disconnect(); } catch {} });
  }, 1800);
}

// ── Gota de lluvia sobre cuerda ───────────────────────────────────────────────
export function rainDropSound(length, tension, variant = 0, pan = 0) {
  if (!audioCtx || muted) return;
  const now = audioCtx.currentTime;
  const { frequency } = describeString(length, tension, variant);
  const freq = frequency * (1.2 + Math.random() * 0.4);
  const dur  = 0.18 + tension * 0.28;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, now + dur * 0.7);
  gain.gain.setValueAtTime(0.012 + Math.random() * 0.008, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(gain);
  const r = routeWithPan(gain, pan, 0.45, 0.52);
  osc.start(now); osc.stop(now + dur + 0.05);
  window.setTimeout(() => [osc, gain, ...r].forEach(n => { try { n.disconnect(); } catch {} }), (dur + 0.4) * 1000);
}

export function stopTensionSound() {
  if (!audioCtx || !tensionVoice) return;
  const v = tensionVoice;
  tensionVoice = null;
  const now = audioCtx.currentTime;
  v.gain.gain.setTargetAtTime(0.0001, now, 0.04);
  v.oscGain.gain.setTargetAtTime(0.0001, now, 0.04);
  window.setTimeout(() => {
    try { v.source.stop(); } catch {}
    try { v.osc.stop();    } catch {}
    [v.source, v.filter, v.gain, v.osc, v.oscFilt, v.oscGain].forEach(n => { try { n.disconnect(); } catch {} });
  }, 350);
}
