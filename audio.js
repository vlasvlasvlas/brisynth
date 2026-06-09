// audio.js - Sintesis de cuerdas con escalas y timbres configurables

import soundBank from './sounds/templates.json';

let audioCtx;
let master;
let masterMix;
let limiter;
let dryBus;
let reverbBus;
let reverbConvolver;
let reverbWet;
let delayBus;
let delayWet;
let noiseBuffer;
let tensionVoice;
let windDrone = null;
let muted = false;
let masterVolume = 0.7;
let masterReverb = 0.24;
let masterDelay = 0.18;
let lastPreview = 0;
const hoverCooldowns = {};
const activeVoices = new Set();
const MAX_POLYPHONY = 28;
const OSCILLATOR_TYPES = new Set(['sine', 'triangle', 'square', 'sawtooth']);
const FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass', 'notch']);

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeTemplate(template, index) {
  if (!template || typeof template !== 'object') return null;
  const partials = Array.isArray(template.partials)
    ? template.partials
      .filter(partial => finiteNumber(partial?.ratio, 0) > 0 && finiteNumber(partial?.gain, 0) > 0)
      .map(partial => ({
        ratio: finiteNumber(partial.ratio, 1),
        gain: finiteNumber(partial.gain, 0.5),
        decay: Math.max(0.05, finiteNumber(partial.decay, 1)),
        detune: finiteNumber(partial.detune, 0),
        wave: OSCILLATOR_TYPES.has(partial.wave) ? partial.wave : 'sine',
      }))
    : [];
  if (!partials.length) return null;

  const envelope = template.envelope || {};
  const filter = template.filter || {};
  const sends = template.sends || {};
  const noise = template.noise;
  const fm = template.fm;
  const pitchEnvelope = template.pitchEnvelope;
  const lfo = template.lfo;
  return {
    ...template,
    id: String(template.id || `sound-${index + 1}`),
    name: String(template.name || template.id || `Sound ${index + 1}`),
    description: String(template.description || ''),
    level: Math.max(0.05, finiteNumber(template.level, 0.7)),
    transpose: finiteNumber(template.transpose, 0),
    envelope: {
      attack: Math.max(0.001, finiteNumber(envelope.attack, 0.008)),
      duration: Math.max(0.08, finiteNumber(envelope.duration, 2.5)),
      curve: Math.max(0.1, finiteNumber(envelope.curve, 1)),
    },
    filter: {
      type: FILTER_TYPES.has(filter.type) ? filter.type : 'lowpass',
      frequency: Math.max(20, finiteNumber(filter.frequency, 1800)),
      toneAmount: finiteNumber(filter.toneAmount, 2200),
      q: Math.max(0.0001, finiteNumber(filter.q, 0.7)),
    },
    partials,
    sends: {
      dry: Math.max(0, finiteNumber(sends.dry, 0.82)),
      reverb: Math.max(0, finiteNumber(sends.reverb, 0.2)),
      delay: Math.max(0, finiteNumber(sends.delay, 0)),
    },
    noise: finiteNumber(noise?.amount, 0) > 0 ? {
      amount: finiteNumber(noise.amount, 0),
      duration: Math.max(0.005, finiteNumber(noise.duration, 0.02)),
      frequency: Math.max(20, finiteNumber(noise.frequency, 1400)),
      q: Math.max(0.0001, finiteNumber(noise.q, 0.8)),
    } : null,
    fm: finiteNumber(fm?.index, 0) > 0 ? {
      ratio: Math.max(0.01, finiteNumber(fm.ratio, 2)),
      index: finiteNumber(fm.index, 0),
    } : null,
    pitchEnvelope: finiteNumber(pitchEnvelope?.semitones, 0) !== 0 ? {
      semitones: finiteNumber(pitchEnvelope.semitones, 0),
      duration: Math.max(0.005, finiteNumber(pitchEnvelope.duration, 0.06)),
    } : null,
    lfo: ['pitch', 'gain', 'filter'].includes(lfo?.target) ? {
      target: lfo.target,
      frequency: Math.max(0.01, finiteNumber(lfo.frequency, 1)),
      amount: finiteNumber(lfo.amount, 0),
    } : null,
  };
}

const FALLBACK_TEMPLATE = normalizeTemplate({
  id: 'basic',
  name: 'Basic',
  level: 0.7,
  envelope: { attack: 0.006, duration: 2.5, curve: 1 },
  filter: { type: 'lowpass', frequency: 1800, toneAmount: 2200, q: 0.7 },
  partials: [
    { ratio: 1, wave: 'sine', gain: 1, decay: 1 },
    { ratio: 2, wave: 'triangle', gain: 0.28, decay: 0.65 },
  ],
  sends: { dry: 0.82, reverb: 0.2, delay: 0.08 },
}, 0);

const normalizedTemplates = (Array.isArray(soundBank.templates) ? soundBank.templates : [])
  .map(normalizeTemplate)
  .filter(Boolean);
const seenTemplateIds = new Set();
const SOUND_TEMPLATES = normalizedTemplates.filter(template => {
  if (seenTemplateIds.has(template.id)) return false;
  seenTemplateIds.add(template.id);
  return true;
});
if (!SOUND_TEMPLATES.length) SOUND_TEMPLATES.push(FALLBACK_TEMPLATE);
const SOUND_TEMPLATE_MAP = new Map(SOUND_TEMPLATES.map(template => [template.id, template]));

export function getSoundTemplates() {
  return SOUND_TEMPLATES.map(({ id, name, description }) => ({ id, name, description }));
}

export function randomSoundTemplate() {
  return SOUND_TEMPLATES[Math.floor(Math.random() * SOUND_TEMPLATES.length)]?.id || 'rhodes';
}

function getSoundTemplate(id) {
  return SOUND_TEMPLATE_MAP.get(id) || SOUND_TEMPLATES[0];
}

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
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decay);
      data[i] = (Math.random() * 2 - 1) * env * (0.65 + Math.random() * 0.35);
      peak = Math.max(peak, Math.abs(data[i]));
    }
  }
  const normalization = peak > 0 ? 0.82 / peak : 1;
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] *= normalization;
  }
  return impulse;
}

function createSoftClipCurve(drive = 1.35) {
  const samples = 2048;
  const curve = new Float32Array(samples);
  const normalization = Math.tanh(drive);
  for (let i = 0; i < samples; i++) {
    const x = i * 2 / (samples - 1) - 1;
    curve[i] = Math.tanh(x * drive) / normalization;
  }
  return curve;
}

function volumeToGain(value) {
  return Math.pow(Math.max(0, Math.min(1, value)), 1.4) * 0.58;
}

function createNoiseBuffer() {
  const duration = 1.5;
  const buffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * duration), audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'interactive',
    });
    master    = audioCtx.createGain();
    masterMix = audioCtx.createGain();
    limiter   = audioCtx.createDynamicsCompressor();
    dryBus    = audioCtx.createGain();
    reverbBus = audioCtx.createGain();
    reverbConvolver = audioCtx.createConvolver();
    reverbWet = audioCtx.createGain();
    delayBus  = audioCtx.createDelay(2);
    delayWet  = audioCtx.createGain();
    const dcBlocker = audioCtx.createBiquadFilter();
    const softClipper = audioCtx.createWaveShaper();
    const reverbPreDelay = audioCtx.createDelay(0.2);
    const delayFeedback = audioCtx.createGain();
    const delayFilter = audioCtx.createBiquadFilter();
    const masterReverbSend = audioCtx.createGain();
    const masterDelaySend = audioCtx.createGain();

    master.gain.value        = volumeToGain(masterVolume);
    masterMix.gain.value     = 0.88;
    dryBus.gain.value        = 0.82;
    reverbWet.gain.value     = masterReverb;
    delayBus.delayTime.value = 0.34;
    delayWet.gain.value      = masterDelay;
    delayFeedback.gain.value = 0.34;
    masterReverbSend.gain.value = 0.16;
    masterDelaySend.gain.value = 0.10;
    reverbPreDelay.delayTime.value = 0.018;
    delayFilter.type         = 'lowpass';
    delayFilter.frequency.value = 2800;
    dcBlocker.type           = 'highpass';
    dcBlocker.frequency.value = 24;
    dcBlocker.Q.value        = 0.707;
    limiter.threshold.value  = -11;
    limiter.knee.value       = 8;
    limiter.ratio.value      = 7;
    limiter.attack.value     = 0.003;
    limiter.release.value    = 0.18;
    softClipper.curve        = createSoftClipCurve();
    softClipper.oversample   = '4x';
    reverbConvolver.buffer   = createImpulse();
    noiseBuffer              = createNoiseBuffer();

    dryBus.connect(masterMix);
    dryBus.connect(masterReverbSend);
    masterReverbSend.connect(reverbBus);
    dryBus.connect(masterDelaySend);
    masterDelaySend.connect(delayBus);
    reverbBus.connect(reverbPreDelay);
    reverbPreDelay.connect(reverbConvolver);
    reverbConvolver.connect(reverbWet);
    reverbWet.connect(masterMix);
    delayBus.connect(delayFilter);
    delayFilter.connect(delayWet);
    delayWet.connect(masterMix);
    delayFilter.connect(delayFeedback);
    delayFeedback.connect(delayBus);
    masterMix.connect(dcBlocker);
    dcBlocker.connect(limiter);
    limiter.connect(softClipper);
    softClipper.connect(master);
    master.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

export function setMuted(value) {
  muted = value;
  if (!audioCtx || !master) return;
  const now = audioCtx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(muted ? 0 : volumeToGain(masterVolume), now, 0.025);
}

export function setMasterVolume(value) {
  masterVolume = Math.max(0, Math.min(1, value));
  if (!audioCtx || !master || muted) return;
  master.gain.setTargetAtTime(volumeToGain(masterVolume), audioCtx.currentTime, 0.035);
}

export function setMasterReverb(value) {
  masterReverb = Math.max(0, Math.min(1, value));
  if (!audioCtx || !reverbWet) return;
  reverbWet.gain.setTargetAtTime(masterReverb, audioCtx.currentTime, 0.04);
}

export function setMasterDelay(value) {
  masterDelay = Math.max(0, Math.min(1, value));
  if (!audioCtx || !delayWet) return;
  delayWet.gain.setTargetAtTime(masterDelay, audioCtx.currentTime, 0.04);
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

function routeWithPan(source, pan, dry = 1, wet = 0.2, delay = 0) {
  const panner  = audioCtx.createStereoPanner();
  const dryGain = audioCtx.createGain();
  const wetGain = audioCtx.createGain();
  const delayGain = audioCtx.createGain();
  panner.pan.value   = Math.max(-0.85, Math.min(0.85, pan));
  dryGain.gain.value = dry;
  wetGain.gain.value = wet;
  delayGain.gain.value = delay;
  source.connect(panner);
  panner.connect(dryGain);
  panner.connect(wetGain);
  panner.connect(delayGain);
  dryGain.connect(dryBus);
  wetGain.connect(reverbBus);
  delayGain.connect(delayBus);
  return [panner, dryGain, wetGain, delayGain];
}

function cleanupVoice(voice) {
  if (voice.cleaned) return;
  voice.cleaned = true;
  activeVoices.delete(voice);
  window.clearTimeout(voice.cleanupTimer);
  voice.nodes.forEach(node => {
    try { node.disconnect(); } catch {}
  });
}

function releaseVoice(voice, release = 0.035) {
  if (voice.cleaned || voice.releasing) return;
  voice.releasing = true;
  activeVoices.delete(voice);
  const now = audioCtx.currentTime;
  voice.output.gain.cancelScheduledValues(now);
  voice.output.gain.setTargetAtTime(0.0001, now, release / 3);
  voice.sources.forEach(source => {
    try { source.stop(now + release); } catch {}
  });
  window.setTimeout(() => cleanupVoice(voice), (release + 0.08) * 1000);
}

function registerVoice(voice, lifetime) {
  while (activeVoices.size >= MAX_POLYPHONY) {
    const oldest = activeVoices.values().next().value;
    releaseVoice(oldest);
  }
  activeVoices.add(voice);
  voice.cleanupTimer = window.setTimeout(() => cleanupVoice(voice), (lifetime + 0.3) * 1000);
}

function createNoiseBurst(now, level, tone, template, durationScale, destination, voice) {
  const settings = template.noise;
  if (!settings?.amount) return;
  const noiseDuration = Math.max(0.008, settings.duration * durationScale);
  const noise = audioCtx.createBufferSource();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  noise.buffer = noiseBuffer;
  filter.type = 'bandpass';
  filter.frequency.value = Math.min(
    audioCtx.sampleRate * 0.45,
    settings.frequency * (0.72 + tone * 0.65),
  );
  filter.Q.value = Math.max(0.0001, Math.min(20, settings.q || 0.8));
  gain.gain.setValueAtTime(level * settings.amount, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDuration);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  const maxOffset = Math.max(0, noiseBuffer.duration - noiseDuration - 0.01);
  noise.start(now, Math.random() * maxOffset, noiseDuration);
  voice.sources.push(noise);
  voice.nodes.push(noise, filter, gain);
}

function playTemplateVoice({
  frequency,
  velocity,
  tone,
  resonance,
  pan,
  soundId,
  durationScale = 1,
  brightnessScale = 1,
}) {
  const template = getSoundTemplate(soundId);
  const now = audioCtx.currentTime;
  const envelope = template.envelope || {};
  const attack = Math.max(0.002, (envelope.attack || 0.006) * durationScale);
  const duration = Math.max(
    0.12,
    (envelope.duration || 3) * durationScale * (0.72 + resonance * 0.5),
  );
  const level = (0.012 + Math.pow(Math.min(1, velocity), 0.78) * 0.064) * (template.level || 1);
  const transposedFrequency = frequency * Math.pow(2, (template.transpose || 0) / 12);
  const sends = template.sends || {};
  const voiceFilter = audioCtx.createBiquadFilter();
  const voiceOutput = audioCtx.createGain();
  const filterSettings = template.filter || {};
  const filterFrequency = Math.max(
    30,
    Math.min(
      audioCtx.sampleRate * 0.45,
      (filterSettings.frequency || 1800) + tone * (filterSettings.toneAmount || 2200),
    ),
  );
  const partialEnergy = Math.sqrt(
    template.partials.reduce((sum, partial) => sum + partial.gain * partial.gain, 0),
  );
  const normalization = Math.min(1, 1.08 / Math.max(0.01, partialEnergy));
  const maxPartialDecay = Math.max(...template.partials.map(partial => partial.decay || 1));
  const lifetime = duration * maxPartialDecay + 0.12;
  const routing = routeWithPan(
    voiceOutput,
    pan,
    sends.dry ?? 0.82,
    (sends.reverb ?? 0.2) * (0.72 + resonance * 0.4),
    sends.delay ?? 0,
  );
  const voice = {
    createdAt: now,
    output: voiceOutput,
    sources: [],
    nodes: [voiceFilter, voiceOutput, ...routing],
    cleanupTimer: null,
    cleaned: false,
    releasing: false,
  };
  const oscillators = [];

  voiceFilter.type = filterSettings.type || 'lowpass';
  voiceFilter.frequency.value = filterFrequency;
  voiceFilter.Q.value = Math.max(0.0001, Math.min(20, filterSettings.q || 0.7));
  voiceOutput.gain.value = 1;
  voiceFilter.connect(voiceOutput);
  registerVoice(voice, lifetime);

  template.partials.forEach((partial, index) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const partialDuration = Math.max(0.08, duration * (partial.decay || 1));
    const harmonicBrightness = Math.pow(0.24 + tone * 0.76, index * 0.52);
    const amp = Math.max(
      0.00011,
      level * partial.gain * harmonicBrightness * brightnessScale * normalization,
    );
    const baseFrequency = transposedFrequency * partial.ratio;
    if (baseFrequency >= audioCtx.sampleRate * 0.46) return;

    osc.type = partial.wave || 'sine';
    osc.frequency.setValueAtTime(baseFrequency, now);
    osc.detune.value = (partial.detune || 0) + (Math.random() - 0.5) * 1.4;
    if (template.pitchEnvelope?.semitones) {
      osc.frequency.setValueAtTime(
        baseFrequency * Math.pow(2, template.pitchEnvelope.semitones / 12),
        now,
      );
      osc.frequency.exponentialRampToValueAtTime(
        baseFrequency,
        now + template.pitchEnvelope.duration,
      );
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(amp, now + attack);
    const decayCurve = new Float32Array(32);
    const curveShape = envelope.curve || 1;
    for (let point = 0; point < decayCurve.length; point++) {
      const progress = point / (decayCurve.length - 1);
      decayCurve[point] = Math.max(0.0001, amp * Math.pow(1 - progress, curveShape));
    }
    gain.gain.setValueCurveAtTime(
      decayCurve,
      now + attack,
      Math.max(0.02, partialDuration - attack),
    );
    osc.connect(gain);
    gain.connect(voiceFilter);
    osc.start(now);
    osc.stop(now + partialDuration + 0.06);
    oscillators.push({ osc, baseFrequency, partialDuration });
    voice.sources.push(osc);
    voice.nodes.push(osc, gain);
  });

  if (template.fm?.index && oscillators.length) {
    const mod = audioCtx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = transposedFrequency * template.fm.ratio;
    oscillators.forEach(({ osc, baseFrequency, partialDuration }) => {
      const modGain = audioCtx.createGain();
      modGain.gain.setValueAtTime(baseFrequency * template.fm.index, now);
      modGain.gain.exponentialRampToValueAtTime(0.0001, now + partialDuration);
      mod.connect(modGain);
      modGain.connect(osc.frequency);
      voice.nodes.push(modGain);
    });
    mod.start(now);
    mod.stop(now + lifetime);
    voice.sources.push(mod);
    voice.nodes.push(mod);
  }

  if (template.lfo?.target && oscillators.length) {
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.frequency.value = template.lfo.frequency;
    lfoGain.gain.value = template.lfo.amount;
    lfo.connect(lfoGain);
    if (template.lfo.target === 'pitch') {
      oscillators.forEach(({ osc }) => lfoGain.connect(osc.detune));
    } else if (template.lfo.target === 'gain') {
      lfoGain.gain.value = Math.min(0.45, template.lfo.amount);
      lfoGain.connect(voiceOutput.gain);
    } else if (template.lfo.target === 'filter') {
      lfoGain.connect(voiceFilter.frequency);
    }
    lfo.start(now);
    lfo.stop(now + lifetime);
    voice.sources.push(lfo);
    voice.nodes.push(lfo, lfoGain);
  }

  createNoiseBurst(now, level, tone, template, durationScale, voiceFilter, voice);
}

export function pluckString(length, tension = 0.65, velocity = 0.7, tone = 0.45, resonance = 0.7, pan = 0, variant = 0, soundId = 'rhodes') {
  if (!audioCtx || muted) return;
  const { frequency } = describeString(length, tension, variant);
  playTemplateVoice({ frequency, velocity, tone, resonance, pan, soundId });
}

// ── Arpa: hover — bien fuerte y presente ─────────────────────────────────────
export function hoverString(ropeId, length, tension, variant = 0, pan = 0, velocity = 0.5, soundId = 'rhodes', tone = 0.45, resonance = 0.7) {
  if (!audioCtx || muted) return;
  const now = performance.now();
  if (hoverCooldowns[ropeId] && now - hoverCooldowns[ropeId] < 90) return;
  hoverCooldowns[ropeId] = now;

  const { frequency } = describeString(length, tension, variant);
  playTemplateVoice({
    frequency,
    velocity,
    tone,
    resonance,
    pan,
    soundId,
    durationScale: 0.72,
    brightnessScale: 0.82,
  });
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

export function playTension(length, tension, tone = 0.45, variant = 0, soundId = 'rhodes') {
  if (!audioCtx || muted) return;
  const nowMs = performance.now();
  if (nowMs - lastPreview < 90) return;
  lastPreview = nowMs;
  pluckString(length, tension, 0.18, tone * 0.7, 0.25, 0, variant, soundId);
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
  if (!audioCtx || windDrone) return;

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

  out.gain.setTargetAtTime(0.045 + speed * 0.085, audioCtx.currentTime, 0.7);

  windDrone = { src, f1, f2, g1, g2, out };
}

export function updateWindDrone(speed) {
  if (!audioCtx || !windDrone) return;
  const now  = audioCtx.currentTime;
  const freq = 80 + speed * 300;
  windDrone.f1.frequency.setTargetAtTime(freq,        now, 0.3);
  windDrone.f2.frequency.setTargetAtTime(freq * 1.62, now, 0.3);
  windDrone.out.gain.setTargetAtTime(0.045 + speed * 0.085, now, 0.2);
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
export function rainDropSound(length, tension, variant = 0, pan = 0, soundId = 'rhodes', tone = 0.45) {
  if (!audioCtx || muted) return;
  const { frequency } = describeString(length, tension, variant);
  playTemplateVoice({
    frequency: frequency * (1.18 + Math.random() * 0.28),
    velocity: 0.12,
    tone,
    resonance: tension * 0.5,
    pan,
    soundId,
    durationScale: 0.22,
    brightnessScale: 0.72,
  });
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
