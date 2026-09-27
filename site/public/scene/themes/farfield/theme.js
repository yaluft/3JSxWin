// theme.js (farfield) — an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time it's picked. It's the calm cousin of Deep Field / Night Field: a
// plain dark star sky with a handful of tiny still planets and NO nebula, NO
// bloom. Every export below is what the host reads: id, meta, kind, fragment,
// and an optional buildAudio().

// id MUST match the folder name (web/themes/farfield/) AND the "id" in
// themes/index.json — theme-catalog.js keys the cache and the install list on it,
// so a mismatch means the theme silently never loads.
export const id = 'farfield';

// meta feeds the scene menu. label + blurb are shown in the picker (the catalog
// manifest seeds them early, then this object overrides once theme.js is
// imported). silent:true = this theme is quiet by design — the space engine
// keeps it to a thin drone with only rare, distant phrases.
export const meta = {
  label: 'Farfield',
  blurb: 'A quiet star field — small worlds adrift, no nebula, no glow',
  silent: true,
};

// kind:'shader' tells scenes.js this theme is a single fragment shader. The host
// pastes `fragment` right after COMMON from shader-lib.js and runs the whole
// thing as one fullscreen quad (PlaneGeometry(2,2), no depth). So `fragment`
// only needs its own helpers + main(); hash21/vnoise/fbm/finish and every
// uniform come from COMMON already.
export const kind = 'shader';

// The GLSL. Prepended with COMMON at load time. Walk it top-down: two small
// helper functions, then main().
export const fragment = /* glsl */ `
  // hash22: 2D -> 2D pseudo-random. COMMON only gives us hash21 (2D -> 1D), so we
  // roll a second scalar off the first (offset by n * 17.13 to decorrelate the
  // two channels) and pack them. Used below to jitter a star's position inside
  // its grid cell so the field doesn't land on a visible lattice.
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  // Same multi-layer twinkling star sheet Deep Field uses — it's the one thing this
  // theme keeps, since it was already exactly "twinkle, don't glow".
  //
  // Cell-noise star layer. Snap p to a grid, then for the 3x3 block of cells
  // around it decide per cell whether a star lives there and draw it. Called
  // several times at different scales in main() and summed, which is what makes
  // the field look like it has depth instead of one flat size of dot.
  float starSheet(vec2 p, float t, float seed) {
    vec2 i = floor(p);          // integer cell we're in
    vec2 f = fract(p);          // position within the cell, 0..1
    float acc = 0.0;
    // Loop the 3x3 neighbourhood so a star near a cell edge still lights the
    // fragments in the next cell over (no hard clipping at cell borders).
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        // step(0.74, ...) = only ~26% of cells get a star. seed shifts the hash
        // so each layer lights a different set of cells.
        float present = step(0.74, hash21(cell + seed * 3.7));
        // Jitter the star off the cell centre so the grid never shows.
        vec2 pos = o + hash22(cell + seed);
        // mag is the star's brightness class; squaring it makes bright stars
        // rare and most stars dim, like a real magnitude distribution.
        float mag = hash21(cell + seed * 7.1);
        mag *= mag;
        // Twinkle: a slow sine on time, rate and phase keyed off mag so stars
        // don't pulse in unison. Range 0.24..1.0, never fully off.
        float tw = 0.62 + 0.38 * sin(t * (0.9 + mag * 2.2) + mag * 31.0);
        float d = length(f - pos);
        // core = the hard pinprick; halo = a tiny soft ring, only 10% strength
        // and only on bright stars. This is the deliberately-restrained "glow" —
        // way smaller than Deep Field's, matching the "no glow" ask.
        float core = smoothstep(0.028 + mag * 0.05, 0.0, d);
        float halo = smoothstep(0.09 + mag * 0.20, 0.0, d) * 0.10 * mag;
        acc += present * (0.30 + mag * 0.90) * tw * (core + halo);
      }
    }
    return acc;
  }

  // A small, flat, soft-edged disc — brightness twinkles slowly, position never
  // moves. No exponential limb glow: that's the "less glowy" part of the ask.
  //
  // Returns a 0..1 mask for one planet centred at c, radius r. Compare with
  // Night Field's planet(): that one builds a lit sphere with fbm bands and a
  // fresnel rim. This stays a fuzzy circle, but with a soft offset highlight —
  // a gentle brightening toward lightDir — so each world reads as lit from the
  // same off-screen sun while keeping the flat, distant-dot character.
  float distantPlanet(vec2 p, vec2 c, float r, float t, float seed) {
    float d = length(p - c);
    // 1 - smoothstep = solid in the middle, feathered at the edge.
    float disc = 1.0 - smoothstep(r * 0.82, r, d);
    // Very slow brightness breathing (0.56..1.0), phase per-planet via seed, so
    // the worlds feel alive without appearing to move.
    float tw = 0.78 + 0.22 * sin(t * (0.12 + seed * 0.05) + seed * 22.0);
    // Offset highlight: a smoothstep on the projection onto the light direction
    // (up-left, matching every other world in this sky). Kept subtle (0.75..1.0)
    // so the dot stays flat, not spherical.
    float lit = 0.75 + 0.25 * smoothstep(-r, r, dot(normalize(p - c + vec2(1e-4)), normalize(vec2(-0.6, 0.8))) * r);
    return disc * tw * lit;
  }

  void main() {
    // vUv is 0..1 across the quad (from COMMON's vertex shader). aspect-correct
    // it into sp so circles stay circular on a wide monitor — without the
    // uv.x * aspect the planets would be ellipses on a 16:9 span.
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 sp = vec2(uv.x * aspect, uv.y);
    // Our own time. uSpeed (a per-theme slider) retunes everything at once; the
    // 0.10 floor keeps a trickle of motion even at uSpeed 0.
    float t = uTime * (0.10 + uSpeed * 0.6);

    // Desktop icons live down the left edge, so dim everything there. iconZone is
    // 1 at the far left, fading to 0 past x=0.44; quiet maps that to a 1.0..0.55
    // brightness multiplier used on the planets below.
    float iconZone = 1.0 - smoothstep(0.16, 0.44, uv.x);
    float quiet = mix(1.0, 0.55, iconZone);

    // Background: near-black uVoid at the bottom, lerped a little toward uTide
    // going up. The * 0.5 caps the blend at halfway so the top never gets bright
    // — this is a night sky, not a horizon glow. A whisper of large-scale fbm
    // (±4%) breaks the perfect linear ramp so the sky reads as air, not a
    // gradient fill.
    float skyWash = smoothstep(-0.10, 1.05, uv.y) * 0.5;
    skyWash *= 0.96 + 0.08 * fbm(sp * 1.7);
    vec3 col = mix(uVoid, uTide, skyWash);

    // Four star layers at increasing scale (30 -> 120) and decreasing weight
    // (0.60 -> 0.18): the coarse layer is the big foreground stars, the fine one
    // is faint background dust. Each layer scrolls sideways at a slightly
    // different rate (the vec2(t*..., ...) offset) for a gentle parallax drift,
    // and each is tinted a touch differently — near layers the palette's frost,
    // the deepest layers leaning faintly verdant — so the field has colour depth
    // instead of four copies of one grey.
    float st0 = starSheet(sp * 30.0  + vec2(t * 0.02,  0.0), t, 1.0) * 0.60;
    float st1 = starSheet(sp * 52.0  + vec2(t * 0.035, -t * 0.01), t, 2.2) * 0.42;
    float st2 = starSheet(sp * 80.0  + vec2(t * 0.05,  0.0), t, 3.1) * 0.30;
    float st3 = starSheet(sp * 120.0 + vec2(t * 0.07,  0.0), t, 4.4) * 0.18;
    vec3 st = uFrost * (st0 + st1)
            + mix(uFrost, uVerdant, 0.22) * st2
            + mix(uFrost, uVerdant, 0.35) * st3;
    // Scale by the uStars density knob, and pull the stars down to 45% over the
    // icon column.
    col += st * uStars * mix(0.45, 1.0, 1.0 - iconZone);

    // Seven still planets. GLSL ES 2.0 needs a constant loop bound, hence the
    // fixed 7. Everything about planet i is derived from hash21(vec2(i, k)) for
    // different k, so the layout is fixed per session but looks scattered:
    //   c.x — spread across the (aspect-scaled) width, nudged slightly off-left
    //   c.y — 0.08..0.88 up the screen
    //   r   — 0.010..0.032, and uHeight (a slider) scales the size spread
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      vec2 c = vec2(
        hash21(vec2(fi, 4.1)) * aspect * 1.15 - aspect * 0.03,
        0.08 + hash21(vec2(fi, 9.7)) * 0.8
      );
      float r = 0.010 + hash21(vec2(fi, 15.3)) * 0.022 * (0.7 + uHeight * 0.6);
      float body = distantPlanet(sp, c, r, t, fi);
      // Colour each world somewhere between uIris and uFrost, scale by uIntensity
      // and the 0.7 house level, and dim by quiet if it's over the icons.
      col += mix(uIris, uFrost, hash21(vec2(fi, 27.4))) * body * uIntensity * 0.7 * quiet;
    }

    // finish() (from COMMON) adds the shared vignette + moving film grain and
    // clamps the low end. Alpha 1 — the wallpaper is fully opaque.
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) — optional. audio.js calls this instead of its stock bed.
// api.interstellar() is the Tone.js space kit: drone, wind, pad, sparse phrases.
export function buildAudio(api) {
  return api.interstellar({
    root: 61.74,
    scale: [123.47, 146.83, 164.81, 185.00, 220.00, 246.94],
    color: 'cold',
    density: 0.18,
    sparkle: 0.15,
    wind: 0.25,
  });
}
