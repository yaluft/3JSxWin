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

  // Two-oscillator low pad — world themes call api.bed(freqA, freqB, level).
  function bed(freqA, freqB, level) {
    const a = osc('sine', freqA);
    const b = osc('sine', freqB);
    const g = gain(level);
    a.connect(g);
    b.connect(g);
    g.connect(master);
    return g;
  }

  // Filtered brown-noise wash — api.tide(level).
  function tide(level) {
    const src = noise('brown');
    const lp = filter('lowpass', 220, 0.7);
    const g = gain(level);
    src.connect(lp);
    lp.connect(g);
    g.connect(master);
    lfo(0.045, 60, lp.frequency);
    return g;
  }

  const GALAXY_IDS = new Set([
    'night-field', 'farfield', 'solarsystem', 'starnode', 'globule',
  ]);
  const GALAXY_STREAMS = [
    'https://ice4.somafm.com/deepspaceone-128-mp3',
    'https://ice2.somafm.com/deepspaceone-128-mp3',
    'https://ice1.somafm.com/deepspaceone-128-mp3',
  ];
  let streamEl = null;
  let streamIdx = 0;
  let streamWanted = false;

  function stopStream() {
    streamWanted = false;
    if (!streamEl) return;
    try { streamEl.pause(); } catch { /* */ }
    try { streamEl.removeAttribute('src'); streamEl.load(); } catch { /* */ }
    streamEl.remove();
    streamEl = null;
  }

  function playStream(url) {
    streamWanted = true;
    const src = url || GALAXY_STREAMS[streamIdx % GALAXY_STREAMS.length];
    if (streamEl && streamEl.dataset.src === src) {
      streamEl.volume = target;
      if (playing) streamEl.play()?.catch(() => {});
      return;
    }
    stopStream();
    streamWanted = true;
    const el = document.createElement('audio');
    el.id = 'backdrop-galaxy-stream';
    el.dataset.src = src;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.setAttribute('playsinline', '');
    el.style.cssText = 'position:fixed;width:0;height:0;opacity:0;pointer-events:none;left:-9999px';
    el.volume = target;
    el.src = src;
    el.addEventListener('error', () => {
      if (!streamWanted) return;
      streamIdx = (streamIdx + 1) % GALAXY_STREAMS.length;
      if (GALAXY_STREAMS[streamIdx] !== src) playStream(GALAXY_STREAMS[streamIdx]);
    });
    document.body.appendChild(el);
    streamEl = el;
    if (playing) el.play()?.catch(() => {});
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


  function buildGlyphfall() {
    const bed = osc('sine', 49);
    const bedG = gain(0.04);
    bed.connect(bedG);
    bedG.connect(master);

    const rain = noise('brown');
    const hp = filter('highpass', 420, 0.6);
    const lp = filter('lowpass', 1400, 0.8);
    const rg = gain(0.09);
    rain.connect(hp);
    hp.connect(lp);
    lp.connect(rg);
    rg.connect(master);
    lfo(0.09, 0.025, rg.gain);

    const ticks = noise('white');
    const bp = filter('bandpass', 3200, 6);
    const tg = gain(0.03);
    ticks.connect(bp);
    bp.connect(tg);
    tg.connect(master);

    startTracked();

    everyRandom(260, 1400, () => {
      if (!ctx || !playing) return;
      const now = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = 880 + Math.random() * 1600;
      g.gain.setValueAtTime(0.035, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      o.connect(g);
      g.connect(master);
      o.start(now);
      o.stop(now + 0.06);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* */ } };
    });
  }

  function themeApi() {
    return { ctx, master, osc, noise, filter, gain, lfo, bed, tide, playStream, stopStream, startTracked, everyRandom };
  }

  function buildFor(id) {
    clearGraph();
    const galaxy = GALAXY_IDS.has(id) || Boolean(themeMod?.galaxyStream);
    if (!galaxy) stopStream();
    try {
      if (themeMod?.buildAudio) themeMod.buildAudio(themeApi());
      else if (id === 'ion') buildIon();
      else if (id === 'warpscii') buildStarwell();
      else if (id === 'glyphfall') buildGlyphfall();
      else buildDrone();
    } catch (error) {
      console.warn('theme audio failed', id, error);
      try { buildDrone(); } catch { /* */ }
    }
    if (galaxy) playStream(themeMod?.galaxyStream || GALAXY_STREAMS[streamIdx % GALAXY_STREAMS.length]);
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
      if (streamEl) {
        streamEl.volume = target;
        streamEl.play()?.catch(() => {});
      }
    },
    stop() {
      if (!playing || !master) return;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.5);
      playing = false;
      try { streamEl?.pause(); } catch { /* */ }
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
      if (streamEl) streamEl.volume = target;
    },
    setEnabled(on) {
      if (!on) this.stop();
    },
    dispose() {
      for (const cancel of cancels) cancel();
      cancels = [];
      stopStream();
      try { ctx?.close(); } catch { /* already closed */ }
      ctx = null;
      master = null;
      nodes = [];
      playing = false;
    },
  };
}
