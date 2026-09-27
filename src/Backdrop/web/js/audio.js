// audio.js — the wallpaper's ambient sound engine, built on Tone.js.
// One export, createLowVibe(), starts a calm interstellar bed per scene: a
// breathing drone, cosmic wind, a slow pad, and sparse phrases, all through a
// long reverb. main.js owns the instance; the panel's volume slider and the
// scene switcher call into it. There is no audio file anywhere and no network:
// Tone.js is vendored next to three.js, and every sound is synthesised live.
//
// The sound brief: "space noises with calm interstellar music". That means
//   DRONE  — a near-subliminal root + fifth that breathes on a slow LFO.
//   WIND   — filtered brown/pink noise, cutoff wandering like solar wind.
//   PAD    — stacked sine AM voices holding two-note intervals for many seconds.
//   PHRASE — three-note motifs on the scene's scale, minutes of rest between.
//   SPACE  — rare whooshes, telemetry chirps, and high pings, never a beat.
//
// Chromium refuses to start an AudioContext before a user gesture. Tone.start()
// is called from start(), which main.js only invokes from a key/pointer handler.
// The Tone.js module itself is dynamically imported on first start so preview
// iframes never pay for it.

const LEVEL = 0.2;

const COLORS = {
  cold:    { cutoff: 1600, detune: 6,  harmonicity: 1.5, noise: 'brown' },
  warm:    { cutoff: 900,  detune: 12, harmonicity: 1.2, noise: 'brown' },
  gold:    { cutoff: 2000, detune: 4,  harmonicity: 2.0, noise: 'pink'  },
  violet:  { cutoff: 1200, detune: 9,  harmonicity: 1.8, noise: 'brown' },
  deep:    { cutoff: 620,  detune: 14, harmonicity: 1.1, noise: 'brown' },
  bright:  { cutoff: 2400, detune: 5,  harmonicity: 2.2, noise: 'pink'  },
  verdant: { cutoff: 1100, detune: 8,  harmonicity: 1.4, noise: 'brown' },
};

// Fallback beds for core scenes (no theme module) and for a theme whose
// buildAudio() throws. Optional themes usually pass their own options into
// api.interstellar() instead of relying on this table.
const PRESETS = {
  aurora:      { root: 73.42, scale: [146.83, 174.61, 196.00, 220.00, 261.63, 293.66, 349.23], color: 'verdant', density: 0.38, sparkle: 0.30, wind: 0.32 },
  terrascii:   { root: 49.00, scale: [ 98.00, 116.54, 130.81, 146.83, 174.61, 196.00, 233.08], color: 'warm',    density: 0.30, sparkle: 0.15, wind: 0.40 },
  warpscii:    { root: 55.00, scale: [110.00, 130.81, 146.83, 164.81, 196.00, 220.00, 261.63], color: 'violet',  density: 0.45, sparkle: 0.25, wind: 0.35 },
  ion:         { root: 43.65, scale: [ 87.31, 103.83, 116.54, 130.81, 155.56, 174.61, 207.65], color: 'cold',    density: 0.28, sparkle: 0.40, wind: 0.30 },
  blobscii:    { root: 65.41, scale: [130.81, 155.56, 174.61, 196.00, 233.08, 261.63, 311.13], color: 'warm',    density: 0.36, sparkle: 0.20, wind: 0.28 },
  glyphfall:   { root: 82.41, scale: [164.81, 196.00, 220.00, 246.94, 293.66, 329.63, 392.00], color: 'gold',    density: 0.34, sparkle: 0.50, wind: 0.22 },
  'night-field': { root: 55.00, scale: [110.00, 130.81, 146.83, 196.00, 220.00, 261.63], color: 'deep', density: 0.28, sparkle: 0.22, wind: 0.35 },
  farfield:    { root: 61.74, scale: [123.47, 146.83, 164.81, 185.00, 220.00, 246.94], color: 'cold', density: 0.18, sparkle: 0.15, wind: 0.25 },
  solarsystem: { root: 49.00, scale: [ 98.00, 123.47, 146.83, 164.81, 196.00, 246.94, 293.66], color: 'warm', density: 0.42, sparkle: 0.20, wind: 0.30 },
  starnode:    { root: 65.41, scale: [130.81, 146.83, 174.61, 196.00, 220.00, 261.63, 293.66], color: 'violet', density: 0.38, sparkle: 0.28, wind: 0.30, echo: true },
  globule:     { root: 43.65, scale: [ 87.31,  98.00, 116.54, 130.81, 174.61, 196.00, 233.08], color: 'deep', density: 0.32, sparkle: 0.40, wind: 0.45, echo: true },
  webbmirror:  { root: 82.41, scale: [164.81, 207.65, 246.94, 329.63, 369.99, 415.30], color: 'gold', density: 0.40, sparkle: 0.70, wind: 0.22 },
  lensfield:   { root: 73.42, scale: [146.83, 174.61, 220.00, 293.66, 349.23], color: 'violet', density: 0.33, sparkle: 0.35, wind: 0.28, echo: true },
  nircam:      { root: 73.42, scale: [146.83, 174.61, 220.00, 293.66, 329.63, 440.00], color: 'gold', density: 0.40, sparkle: 0.55, wind: 0.25 },
  starburst:   { root: 110.00, scale: [220.00, 261.63, 329.63, 392.00, 440.00], color: 'violet', density: 0.50, sparkle: 0.35, wind: 0.55 },
  saucer:      { root: 98.00, scale: [196.00, 220.00, 246.94, 293.66, 329.63, 392.00], color: 'warm', density: 0.28, sparkle: 0.20, wind: 0.22, echo: true },
  lionshead:   { root: 73.42, scale: [146.83, 174.61, 220.00, 261.63, 293.66, 349.23], color: 'warm', density: 0.30, sparkle: 0.40, wind: 0.40 },
  eclipsepair: { root: 55.00, scale: [110.00, 130.81, 146.83, 164.81, 196.00, 220.00], color: 'gold', density: 0.22, sparkle: 0.25, wind: 0.20, echo: true },
  spikehero:   { root: 130.81, scale: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25], color: 'bright', density: 0.40, sparkle: 0.80, wind: 0.25 },
  coldlens:    { root: 87.31, scale: [174.61, 196.00, 233.08, 261.63, 293.66, 349.23], color: 'cold', density: 0.30, sparkle: 0.45, wind: 0.35, echo: true },
  orionhall:   { root: 73.42, scale: [146.83, 164.81, 196.00, 220.00, 246.94, 293.66], color: 'deep', density: 0.20, sparkle: 0.30, wind: 0.50 },
};

const DEFAULT_PRESET = PRESETS.aurora;

export function createLowVibe(volume = LEVEL, sceneId = 'aurora') {
  let Tone = null;
  let master = null;
  let current = sceneId;
  let nodes = [];
  let cancels = [];
  let playing = false;
  let target = Math.min(Math.max(volume, 0), 1);
  let themeMod = null;
  let buildToken = 0;
  let toneReady = null;

  function loadTone() {
    toneReady ??= import('tone').catch((error) => {
      console.warn('Tone.js failed to load', error);
      return null;
    });
    return toneReady;
  }

  function track(node) {
    if (node) nodes.push(node);
    return node;
  }

  function later(ms, fn) {
    const id = setTimeout(fn, ms);
    cancels.push(() => clearTimeout(id));
    return id;
  }

  function everyRandom(minMs, maxMs, fn) {
    let id = 0;
    const loop = () => {
      if (!playing) { id = setTimeout(loop, 500); return; }
      fn();
      id = setTimeout(loop, minMs + Math.random() * (maxMs - minMs));
    };
    id = setTimeout(loop, minMs + Math.random() * (maxMs - minMs));
    cancels.push(() => clearTimeout(id));
  }

  function masterDb() {
    if (!Tone || target <= 0) return -Infinity;
    return Tone.gainToDb(target);
  }

  // Tone.Param.cancelScheduledValues(time) asserts a finite time — calling it
  // with no argument throws and used to abort the fade, leaving the master at
  // -Infinity (silent graph, running context).
  function fadeMaster(db, seconds) {
    if (!master || !Tone) return;
    const now = Tone.getContext().currentTime;
    master.volume.cancelScheduledValues(now);
    let from = master.volume.value;
    if (!Number.isFinite(from)) from = -80;
    master.volume.setValueAtTime(from, now);
    master.volume.rampTo(Number.isFinite(db) ? db : -Infinity, seconds);
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function clearGraph() {
    for (const cancel of cancels) cancel();
    cancels = [];
    for (const node of nodes) {
      try { node.stop?.(); } catch { /* already stopped */ }
      try { node.dispose?.(); } catch { /* already gone */ }
      try { node.disconnect?.(); } catch { /* already gone */ }
    }
    nodes = [];
  }

  // Shared FX bus: chorus + delay into a long hall, then the master fader.
  // Everything a theme builds should land on `verb` (or chorus/delay) so the
  // wallpaper always has that distant-space tail, even if a theme only hums.
  async function makeBus() {
    const { Volume, Chorus, FeedbackDelay, Reverb } = Tone;
    const verb = track(new Reverb({ decay: 7, preDelay: 0.07, wet: 0.62 }));
    verb.connect(master);
    await verb.ready.catch(() => verb.generate?.());

    const chorus = track(new Chorus({ frequency: 0.07, delayTime: 6, depth: 0.4, wet: 0.32, spread: 180 }));
    chorus.connect(verb);
    chorus.start();

    const delay = track(new FeedbackDelay({ delayTime: 0.68, feedback: 0.28, wet: 0.2 }));
    delay.connect(verb);

    return { verb, chorus, delay };
  }

  function makeDrone(root, color, chorus) {
    const { Oscillator, Gain, Filter, LFO } = Tone;
    const a = track(new Oscillator(root, 'sine'));
    const b = track(new Oscillator(root * 1.498, 'sine'));
    const lp = track(new Filter(color.cutoff * 0.35, 'lowpass'));
    const g = track(new Gain(0.07));
    const breath = track(new LFO({ frequency: 0.045, min: 0.04, max: 0.1 }));
    const drift = track(new LFO({ frequency: 0.03, min: root * 0.994, max: root * 1.006 }));
    a.connect(lp);
    b.connect(lp);
    lp.connect(g);
    g.connect(chorus);
    breath.connect(g.gain);
    drift.connect(a.frequency);
    breath.start();
    drift.start();
    a.start();
    b.start();
    return g;
  }

  function makeWind(amount, color, verb) {
    if (amount <= 0) return null;
    const { Noise, AutoFilter, Gain, Filter } = Tone;
    const src = track(new Noise(color.noise));
    const sweep = track(new AutoFilter({
      frequency: 0.028,
      baseFrequency: 160,
      octaves: 2.6,
      type: 'sine',
      wet: 1,
    }));
    const air = track(new Filter(4200, 'highpass'));
    const g = track(new Gain(0.045 * amount));
    const shimmer = track(new Gain(0.012 * amount));
    src.connect(sweep);
    sweep.connect(g);
    g.connect(verb);
    src.connect(air);
    air.connect(shimmer);
    shimmer.connect(verb);
    sweep.start();
    src.start();
    return src;
  }

  function makePad(scale, color, chorus) {
    const { PolySynth, AMSynth, Filter } = Tone;
    const pad = track(new PolySynth(AMSynth, {
      harmonicity: color.harmonicity,
      detune: color.detune,
      oscillator: { type: 'sine' },
      envelope: { attack: 4.2, decay: 1.8, sustain: 0.55, release: 8 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 2.5, decay: 0.4, sustain: 0.25, release: 5 },
    }));
    pad.maxPolyphony = 4;
    pad.volume.value = -22;
    const lp = track(new Filter(color.cutoff, 'lowpass'));
    pad.connect(lp);
    lp.connect(chorus);
    return pad;
  }

  function makeVoice(volumeDb, delay) {
    const { Synth, Panner } = Tone;
    const voice = track(new Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.03, decay: 3.4, sustain: 0.08, release: 4.5 },
    }));
    voice.volume.value = volumeDb;
    const pan = track(new Panner(0));
    voice.connect(pan);
    pan.connect(delay);
    return { voice, pan };
  }

  async function interstellar(opts = {}) {
    const preset = { ...DEFAULT_PRESET, ...opts };
    const color = COLORS[preset.color] ?? COLORS.verdant;
    const scale = preset.scale?.length ? preset.scale : DEFAULT_PRESET.scale;
    const { verb, chorus, delay } = await makeBus();

    makeDrone(preset.root ?? scale[0] / 2, color, chorus);
    makeWind(preset.wind ?? 0.3, color, verb);
    const pad = makePad(scale, color, chorus);
    const lead = makeVoice(-18, delay);
    const sparkle = makeVoice(-28, verb);

    // Slow two-note holds — the "music" bed, not a performance.
    const holdPad = () => {
      const a = pick(scale);
      let b = pick(scale);
      if (b === a) b = scale[(scale.indexOf(a) + 2) % scale.length];
      pad.triggerAttackRelease([a, b], 11);
    };
    holdPad();
    everyRandom(14000, 24000, () => playing && holdPad());

    // Sparse phrases: two or three notes walking the scale, then a long rest.
    const density = Math.min(Math.max(preset.density ?? 0.35, 0), 1);
    const minGap = 7000 + (1 - density) * 9000;
    const maxGap = 12000 + (1 - density) * 14000;
    let step = Math.floor(scale.length / 3);
    everyRandom(minGap, maxGap, () => {
      if (!playing) return;
      const count = Math.random() < 0.4 ? 2 : 3;
      let t = 0;
      for (let i = 0; i < count; i++) {
        const move = [-2, -1, 1, 1, 2][Math.floor(Math.random() * 5)];
        step = (step + move + scale.length * 4) % scale.length;
        const freq = scale[step];
        const when = t;
        later(when, () => {
          if (!playing) return;
          lead.pan.pan.rampTo(Math.random() * 1.0 - 0.5, 0.05);
          lead.voice.triggerAttackRelease(freq, 2.6);
          if (preset.echo) {
            later(520, () => playing && lead.voice.triggerAttackRelease(freq * 0.5, 3.2));
          }
        });
        t += 1600 + Math.random() * 1200;
      }
    });

    // High dust — like distant stars catching the light.
    const spark = Math.min(Math.max(preset.sparkle ?? 0.25, 0), 1);
    if (spark > 0) {
      everyRandom(5000 / Math.max(spark, 0.15), 14000 / Math.max(spark, 0.15), () => {
        if (!playing) return;
        const f = scale[scale.length - 1] * (1.5 + Math.random() * 1.8);
        sparkle.pan.pan.rampTo(Math.random() * 1.6 - 0.8, 0.02);
        sparkle.voice.triggerAttackRelease(f, 0.35);
      });
    }

    // Space noises: solar-wind whoosh, satellite ping, faint telemetry.
    everyRandom(18000, 38000, () => playing && whoosh(verb, color));
    everyRandom(22000, 48000, () => playing && ping(delay));
    everyRandom(30000, 70000, () => playing && chirp(delay));
  }

  function whoosh(verb, color) {
    const { Noise, Filter, Gain, Panner } = Tone;
    const src = new Noise(color.noise ?? 'brown');
    const bp = new Filter({ type: 'bandpass', frequency: 200, Q: 1.1 });
    const g = new Gain(0.0001);
    const p = new Panner(Math.random() * 1.2 - 0.6);
    src.connect(bp);
    bp.connect(g);
    g.connect(p);
    p.connect(verb);
    src.start();
    const now = Tone.getContext().currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.07, now + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 4.8);
    bp.frequency.setValueAtTime(160, now);
    bp.frequency.exponentialRampToValueAtTime(780, now + 2.0);
    bp.frequency.exponentialRampToValueAtTime(120, now + 4.8);
    later(5200, () => {
      try { src.stop(); } catch { /* already */ }
      try { src.dispose(); bp.dispose(); g.dispose(); p.dispose(); } catch { /* already */ }
    });
  }

  function ping(delay) {
    const { Synth } = Tone;
    const s = new Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.002, decay: 1.6, sustain: 0, release: 1.1 },
    });
    s.volume.value = -27;
    s.connect(delay);
    s.triggerAttackRelease(1180 + Math.random() * 520, 0.28);
    later(3500, () => { try { s.dispose(); } catch { /* already */ } });
  }

  function chirp(delay) {
    const { Synth, Panner } = Tone;
    const s = new Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.004, decay: 0.07, sustain: 0, release: 0.04 },
    });
    s.volume.value = -34;
    const p = new Panner(Math.random() * 1.6 - 0.8);
    s.connect(p);
    p.connect(delay);
    const base = 740 + Math.random() * 680;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      later(i * 95, () => playing && s.triggerAttackRelease(base * (i % 2 ? 1.14 : 1), 0.05));
    }
    later(n * 95 + 500, () => { try { s.dispose(); p.dispose(); } catch { /* already */ } });
  }

  // Compatibility wrappers so a theme that still talks in hum/strike doesn't
  // go silent if we miss a rewrite. Both ride the same FX bus.
  function hum(rootFreq) {
    const color = COLORS.deep;
    if (!nodes.some((n) => n.name === 'Chorus')) {
      // Bus not built yet — themes should call interstellar(); this is a last resort.
      makeDrone(rootFreq, color, master);
      return;
    }
    makeDrone(rootFreq, color, nodes.find((n) => n.name === 'Chorus') ?? master);
  }

  function strike(freq, { level = 0.14, decay = 5 } = {}) {
    if (!Tone || !playing) return;
    const { Synth, Panner } = Tone;
    const s = new Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: decay * 0.55, sustain: 0.05, release: decay * 0.45 },
    });
    s.volume.value = Tone.gainToDb(Math.max(level, 0.0001)) - 6;
    const p = new Panner(Math.random() * 0.9 - 0.45);
    const sink = nodes.find((n) => n.name === 'FeedbackDelay') ?? master;
    s.connect(p);
    p.connect(sink);
    s.triggerAttackRelease(freq, decay * 0.4);
    later((decay + 0.4) * 1000, () => { try { s.dispose(); p.dispose(); } catch { /* already */ } });
  }

  function themeApi() {
    return {
      Tone,
      ctx: Tone?.getContext?.()?.rawContext,
      master,
      interstellar,
      hum,
      strike,
      everyRandom,
      whoosh: () => {
        const verb = nodes.find((n) => n.name === 'Reverb') ?? master;
        whoosh(verb, COLORS.cold);
      },
      ping: () => ping(nodes.find((n) => n.name === 'FeedbackDelay') ?? master),
      chirp: () => chirp(nodes.find((n) => n.name === 'FeedbackDelay') ?? master),
    };
  }

  async function buildFor(id) {
    const token = ++buildToken;
    clearGraph();
    if (!Tone || !master) return;
    const preset = PRESETS[id] ?? DEFAULT_PRESET;
    try {
      if (themeMod?.buildAudio) {
        const result = themeMod.buildAudio(themeApi());
        if (result && typeof result.then === 'function') await result;
      } else {
        await interstellar(preset);
      }
    } catch (error) {
      console.warn('theme audio failed', id, error);
      if (token !== buildToken) return;
      try { clearGraph(); await interstellar(preset); } catch { /* stay silent */ }
    }
    if (token !== buildToken) clearGraph();
  }

  return {
    async start() {
      if (playing) return;
      try {
        Tone = await loadTone();
        if (!Tone) return;
        await Tone.start();
        if (Tone.getContext().state !== 'running') return;
        if (!master) {
          master = new Tone.Volume(-80);
          master.connect(Tone.getDestination());
        }
        if (nodes.length === 0) await buildFor(current);
      } catch (error) {
        console.warn('audio start failed', error);
        return;
      }
      fadeMaster(masterDb(), 1.8);
      playing = true;
    },
    stop() {
      if (!playing || !master) return;
      fadeMaster(-Infinity, 0.5);
      playing = false;
    },
    setThemeModule(mod) {
      themeMod = mod ?? null;
    },
    setScene(id) {
      const next = id || 'aurora';
      if (next === current && !themeMod) return;
      current = next;
      if (!Tone || !master) return;
      master.volume.cancelScheduledValues(Tone.getContext().currentTime);
      master.volume.value = -80;
      void buildFor(current).then(() => {
        if (playing && master) fadeMaster(masterDb(), 0.7);
      });
    },
    setVolume(v) {
      target = Math.min(Math.max(v, 0), 1);
      if (playing && master) fadeMaster(masterDb(), 0.2);
    },
    setEnabled(on) {
      if (!on) this.stop();
    },
    dispose() {
      for (const cancel of cancels) cancel();
      cancels = [];
      clearGraph();
      try { master?.dispose(); } catch { /* already */ }
      try { Tone?.getContext?.()?.dispose(); } catch { /* already closed */ }
      master = null;
      Tone = null;
      playing = false;
    },
  };
}
