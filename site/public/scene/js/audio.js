// Soft low-vibe drone. No files — two detuned oscillators and filtered noise.
// Default gain is 20% so it sits under the wallpaper instead of filling the room.

const LEVEL = 0.2;

export function createLowVibe(volume = LEVEL) {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) return { start() {}, stop() {}, dispose() {} };

  const ctx = new AudioCtx();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const oscA = ctx.createOscillator();
  oscA.type = 'sine';
  oscA.frequency.value = 55;
  const oscB = ctx.createOscillator();
  oscB.type = 'sine';
  oscB.frequency.value = 82.4;
  const oscC = ctx.createOscillator();
  oscC.type = 'triangle';
  oscC.frequency.value = 110;

  const oscGain = ctx.createGain();
  oscGain.gain.value = 0.55;
  oscA.connect(oscGain);
  oscB.connect(oscGain);
  const pad = ctx.createGain();
  pad.gain.value = 0.08;
  oscC.connect(pad);

  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < data.length; i++) {
    brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.98;
    data[i] = brown;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 180;
  filter.Q.value = 0.7;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.35;
  noise.connect(filter);
  filter.connect(noiseGain);

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 40;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);

  oscGain.connect(master);
  pad.connect(master);
  noiseGain.connect(master);

  oscA.start();
  oscB.start();
  oscC.start();
  noise.start();
  lfo.start();

  let playing = false;
  const target = Math.min(Math.max(volume, 0), 1);

  return {
    async start() {
      if (playing) return;
      try { await ctx.resume(); } catch { return; }
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(target, now + 1.8);
      playing = true;
    },
    stop() {
      if (!playing) return;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.5);
      playing = false;
    },
    dispose() {
      try { ctx.close(); } catch { /* already closed */ }
    },
  };
}
