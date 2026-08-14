import anime from '../vendor/anime.es.js';

export function createPulse(config) {
  let canvas = document.getElementById('pulse');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'pulse';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '1' });
    document.body.appendChild(canvas);
  }
  const ctx = canvas.getContext('2d');
  const state = { open: 0.2, spin: 0, glow: 0.4 };
  let palette = { ...config.palette };
  let anim;

  function play() {
    anim?.pause();
    anim = anime({
      targets: state,
      open: [0.12, 0.55],
      glow: [0.25, 0.8],
      spin: state.spin + Math.PI * 2,
      duration: 5200,
      easing: 'easeInOutSine',
      direction: 'alternate',
      loop: true,
    });
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
  }

  function hex(c) { return c || '#35e3a0'; }

  return {
    show() { canvas.hidden = false; play(); },
    hide() { canvas.hidden = true; anim?.pause(); },
    apply(cfg) {
      if (cfg.palette) palette = { ...palette, ...cfg.palette };
    },
    setSize() { resize(); },
    update() {
      if (canvas.hidden) return;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w * 0.5;
      const cy = h * 0.5;
      const m = Math.min(w, h);
      ctx.fillStyle = hex(palette.void);
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(state.spin * 0.15);
      for (let i = 8; i >= 1; i--) {
        const r = m * state.open * (0.18 + i * 0.09);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.strokeStyle = i % 2 ? hex(palette.verdant) : hex(palette.iris);
        ctx.globalAlpha = 0.12 + state.glow * 0.08;
        ctx.lineWidth = Math.max(1, m * 0.004);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, m * 0.04 * (0.7 + state.glow), 0, Math.PI * 2);
      ctx.fillStyle = hex(palette.frost);
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    },
    dispose() {
      anim?.pause();
      canvas.remove();
    },
  };
}
