// Soft wallpaper soundscapes. No files — oscillators and filtered noise.
// Default gain is 20% so it sits under the wallpaper instead of filling the room.
//
// Chromium refuses to start an AudioContext before a user gesture (and logs five
// identical warnings if we call oscillator.start() while the context is suspended).
// The graph is built only after resume() actually leaves the context running.
// Nature scenes swap the graph; everything else keeps the original low-vibe drone.

const LEVEL = 0.2;

function fillNoise(data, kind) {
  if (kind === 'brown') {
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.98;
      data[i] = brown;
    }
    return;
  }
  if (kind === 'pink') {
    let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0; let b4 = 0; let b5 = 0; let b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return;
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

export function createLowVibe(volume = LEVEL, sceneId = 'aurora') {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) return { start() {}, stop() {}, dispose() {}, setScene() {}, setVolume() {}, setEnabled() {}, setThemeModule() {} };

  let ctx = null;
  let master = null;
  let current = sceneId;
  let nodes = [];
  let cancels = [];
  let playing = false;
  let target = Math.min(Math.max(volume, 0), 1);
  let themeMod = null;

  function track(node) {
    nodes.push(node);
    return node;
  }

  function noise(kind = 'white') {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    fillNoise(buf.getChannelData(0), kind);
    const src = track(ctx.createBufferSource());
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  function osc(type, freq) {
    const o = track(ctx.createOscillator());
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  function gain(value) {
    const g = track(ctx.createGain());
    g.gain.value = value;
    return g;
  }

  function filter(type, freq, q = 0.7) {
    const f = track(ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  function lfo(freq, depth, dest) {
    const o = osc('sine', freq);
    const g = gain(depth);
    o.connect(g);
    g.connect(dest);
    return o;
  }

  function everyRandom(minMs, maxMs, fn) {
    let id = 0;
    const loop = () => {
      if (!playing) return;
      fn();
      id = setTimeout(loop, minMs + Math.random() * (maxMs - minMs));
    };
    id = setTimeout(loop, minMs + Math.random() * (maxMs - minMs));
    cancels.push(() => clearTimeout(id));
  }

  function clearGraph() {
    for (const cancel of cancels) cancel();
    cancels = [];
    for (const node of nodes) {
      try { node.stop?.(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already gone */ }
    }
    nodes = [];
  }

  function startTracked() {
    for (const node of nodes) {
      try { node.start?.(); } catch { /* not a source, or already started */ }
    }
  }

  function buildDrone() {
    const oscA = osc('sine', 55);
    const oscB = osc('sine', 82.4);
    const oscC = osc('triangle', 110);
    const oscGain = gain(0.55);
    oscA.connect(oscGain);
    oscB.connect(oscGain);
    const pad = gain(0.08);
    oscC.connect(pad);

    const src = noise('brown');
    const lp = filter('lowpass', 180, 0.7);
    const noiseGain = gain(0.35);
    src.connect(lp);
    lp.connect(noiseGain);
    lfo(0.07, 40, lp.frequency);

    oscGain.connect(master);
    pad.connect(master);
    noiseGain.connect(master);
    startTracked();
  }

  function buildKelp() {
    const a = osc('sine', 36.7);
    const b = osc('sine', 48.9);
    const pad = gain(0.11);
    a.connect(pad);
    b.connect(pad);
    const padLp = filter('lowpass', 190, 0.7);
    pad.connect(padLp);
    padLp.connect(master);

    const wash = noise('brown');
    const washLp = filter('lowpass', 260, 0.8);
    const washGain = gain(0.28);
    wash.connect(washLp);
    washLp.connect(washGain);
    washGain.connect(master);
    lfo(0.05, 70, washLp.frequency);

    startTracked();

    everyRandom(380, 2200, () => {
      if (!ctx || !playing) return;
      const now = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      const startF = 620 + Math.random() * 520;
      o.frequency.setValueAtTime(startF, now);
      o.frequency.exponentialRampToValueAtTime(140 + Math.random() * 80, now + 0.18);
      g.gain.setValueAtTime(0.07, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      o.connect(g);
      g.connect(master);
      o.start(now);
      o.stop(now + 0.28);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* */ } };
    });
  }

  function buildMurmur() {
    const air = noise('pink');
    const airHp = filter('highpass', 900, 0.6);
    const rustle = filter('bandpass', 1750, 1.1);
    const rustleGain = gain(0.14);
    air.connect(airHp);
    airHp.connect(rustle);
    rustle.connect(rustleGain);
    rustleGain.connect(master);

    const trem = osc('sine', 9.2);
    const tremGain = gain(0.09);
    trem.connect(tremGain);
    tremGain.connect(rustleGain.gain);
    lfo(0.13, 1.6, trem.frequency);

    const loft = noise('white');
    const loftBp = filter('bandpass', 2600, 0.9);
    const loftGain = gain(0.05);
    loft.connect(loftBp);
    loftBp.connect(loftGain);
    loftGain.connect(master);

    const bed = osc('sine', 61.7);
    const bedGain = gain(0.05);
    bed.connect(bedGain);
    bedGain.connect(master);

    startTracked();
  }

  function buildEmber() {
    const hiss = noise('pink');
    const hp = filter('highpass', 900, 0.7);
    const bp = filter('bandpass', 1800, 0.8);
    const g = gain(0.12);
    hiss.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(master);
    lfo(0.21, 0.04, g.gain);

    const bed = osc('sine', 46);
    const bedG = gain(0.05);
    bed.connect(bedG);
    bedG.connect(master);
    startTracked();

    everyRandom(180, 900, () => {
      if (!ctx || !playing) return;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
      fillNoise(buf.getChannelData(0), 'white');
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1200 + Math.random() * 2400;
      f.Q.value = 2.2;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.08, now);
      gg.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      src.connect(f);
      f.connect(gg);
      gg.connect(master);
      src.start(now);
      src.stop(now + 0.1);
    });
  }

  function buildIon() {
    const a = osc('sine', 73.4);
    const b = osc('sine', 110.1);
    const g = gain(0.09);
    a.connect(g);
    b.connect(g);
    g.connect(master);
    lfo(0.11, 8, a.frequency);

    const hiss = noise('white');
    const bp = filter('bandpass', 2400, 4);
    const hg = gain(0.04);
    hiss.connect(bp);
    bp.connect(hg);
    hg.connect(master);
    startTracked();
  }

  function buildStarwell() {
    const a = osc('sawtooth', 55);
    const lp = filter('lowpass', 240, 0.8);
    const g = gain(0.06);
    a.connect(lp);
    lp.connect(g);
    g.connect(master);
    lfo(0.04, 18, a.frequency);

    const wash = noise('brown');
    const wlp = filter('lowpass', 160, 0.6);
    const wg = gain(0.18);
    wash.connect(wlp);
    wlp.connect(wg);
    wg.connect(master);
    startTracked();
  }

  function themeApi() {
    return { ctx, master, osc, noise, filter, gain, lfo, startTracked, everyRandom };
  }

  function buildFor(id) {
    clearGraph();
    if (themeMod?.buildAudio) {
      themeMod.buildAudio(themeApi());
      return;
    }
    if (id === 'kelp') buildKelp();
    else if (id === 'murmur') buildMurmur();
    else if (id === 'ember') buildEmber();
    else if (id === 'ion') buildIon();
    else if (id === 'starwell' || id === 'warpscii') buildStarwell();
    else buildDrone();
  }

  return {
    async start() {
      if (playing) return;
      try {
        ctx ??= new AudioCtx();
        if (ctx.state === 'suspended') await ctx.resume();
        if (ctx.state !== 'running') return;
        if (!master) {
          master = ctx.createGain();
          master.gain.value = 0;
          master.connect(ctx.destination);
        }
        if (nodes.length === 0) buildFor(current);
      } catch {
        return;
      }
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(target, now + 1.8);
      playing = true;
    },
    stop() {
      if (!playing || !master) return;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.5);
      playing = false;
    },
    setThemeModule(mod) {
      themeMod = mod ?? null;
    },
    setScene(id) {
      const next = id || 'aurora';
      if (next === current && !themeMod) return;
      current = next;
      if (!ctx || !master) return;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(0, now);
      buildFor(current);
      if (playing) master.gain.linearRampToValueAtTime(target, now + 0.7);
    },
    setVolume(v) {
      target = Math.min(Math.max(v, 0), 1);
      if (playing && master) {
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(target, now + 0.2);
      }
    },
    setEnabled(on) {
      if (!on) this.stop();
    },
    dispose() {
      for (const cancel of cancels) cancel();
      cancels = [];
      try { ctx?.close(); } catch { /* already closed */ }
      ctx = null;
      master = null;
      nodes = [];
      playing = false;
    },
  };
}
