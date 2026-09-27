// theme.js (nircam) - an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time it is picked. A per-image replica of NASA Webb's FS Tau release
// ("Stars Sparking to Life in Cosmic Celebration"): a NIRCam-style field where
// a handful of HERO stars dominate the frame with enormous golden six-ray
// diffraction spikes that cross the entire image, floating over the young
// system's light-blue gas ridges and violet cirrus, rust dust around the FS
// Tau B protostar, and hundreds of tiny golden galaxy smudges fading into the
// dark - the whole frame veiled in faint gas.

// id must match BOTH the folder name (themes/nircam/) and the "id" field of
// this theme's row in themes/index.json. theme-catalog.js builds the import()
// path from the folder name and cross-checks it against the manifest, so any
// mismatch means the theme silently never loads.
export const id = 'nircam';

// meta is merged into SCENE_META (scenes-meta.js) so the scene menu can show a
// name/blurb before this module is ever imported. label = the dropdown text,
// blurb = the one-line description under it. silent:true = the space engine
// supplies its own quiet reading.
export const meta = {
  label: 'FS Tau',
  blurb: 'Protostars sparking to life - golden spike heroes, blue gas ridges, rust dust, a galaxy field behind gas',
  silent: true,
};

// kind:'shader' means "this theme is only a fragment". scenes.js pastes the
// COMMON preamble from shader-lib.js (precision, all the uXxx uniforms,
// hash21/vnoise/fbm/finish) in front of the string below, then runs the result
// on one full-screen PlaneGeometry(2,2) quad.
export const kind = 'shader';

export const fragment = /* glsl */ `
  // hash22: 2D -> 2D random, for scattering smudges inside their grid cell.
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  // galaxyColor: 0..1 roll onto the reference palette - gold dominates, amber
  // and rust follow, a rare few cool to blue-white.
  vec3 galaxyColor(float r) {
    if (r < 0.55) {
      return mix(vec3(1.00, 0.82, 0.44), vec3(0.95, 0.62, 0.26), r / 0.55);
    } else if (r < 0.85) {
      return mix(vec3(0.95, 0.62, 0.26), vec3(0.74, 0.40, 0.20), (r - 0.55) / 0.30);
    }
    return mix(vec3(0.74, 0.40, 0.20), vec3(0.78, 0.84, 1.00), (r - 0.85) / 0.15);
  }

  // galaxySheet: one layer of tiny elliptical galaxy smudges (same construct
  // as webbmirror, tuned a touch smaller and denser for this reference).
  vec3 galaxySheet(vec2 p, float t, float seed, float density) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec3 acc = vec3(0.0);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        float present = step(1.0 - density, hash21(cell + seed * 5.17));
        if (present <= 0.0) continue;
        vec2 pos = o + hash22(cell + seed);
        float roll = hash21(cell + seed * 9.31);
        float mag = hash21(cell + seed * 3.7);
        mag *= mag;
        vec2 q = rot2(f - pos, roll * 6.2831 + t * 0.06 * (roll - 0.5));
        q.y /= mix(1.0, 3.0, hash21(cell + seed * 13.7));
        float d = length(q);
        float size = 0.040 + mag * 0.09;
        float body = exp(-d * d / (size * size));
        float grain = 0.85 + 0.15 * vnoise(q * 24.0 + seed);
        acc += galaxyColor(roll) * body * mag * grain * (0.55 + 0.45 * sin(t * 1.1 + roll * 20.0));
      }
    }
    return acc;
  }

  // heroStar: the signature of this reference. Unlike webbmirror's cell-random
  // stars these are FIXED lighthouses at hand-placed positions, and the hero
  // magnitude gets spikes that run the whole frame: perpendicular falloff is
  // very thin, the along-axis decay is slow enough (2.0) that the blades reach
  // past the edges. A fine sin() grating across each blade mimics the parallel
  // micro-structure of NIRCam's diffraction pattern.
  vec3 heroStar(vec2 p, vec2 pos, float mag, float t) {
    vec2 q = p - pos;
    vec3 acc = vec3(0.0);
    // Round, white-hot core with a faint round halo (the reference stars read
    // as intense points, not hex bokeh). mag 1.0 is the hero; companions keep
    // smaller cores so the hierarchy reads at a glance. The core PULSES so
    // the scene is unmistakably alive even from across the room.
    float r = length(q);
    float coreR = 0.012 + mag * 0.012;
    float pulse = 0.90 + 0.10 * sin(t * 1.3 + mag * 17.0);
    acc += mix(vec3(1.0, 0.98, 0.92), vec3(1.0, 0.84, 0.48), smoothstep(0.0, coreR, r))
         * exp(-r * r / (coreR * coreR)) * (0.55 + mag * 1.7) * pulse;
    acc += vec3(0.72, 0.62, 0.50) * exp(-r * 22.0) * 0.35;
    // Six rays: three axes at 30 + k*60 degrees, each contributing both ways.
    // Spike length scales HARD with mag: only the true hero crosses the frame,
    // companions get short blades (the reference has ONE dominant star).
    float spikeGain = 0.05 + mag * mag * 1.05;
    for (int k = 0; k < 3; k++) {
      float ang = 0.5235988 + float(k) * 1.0471976;
      vec2 d = vec2(cos(ang), sin(ang));
      float along = abs(dot(q, d));
      float perp = abs(dot(q, vec2(-d.y, d.x)));
      float ray = exp(-perp * (150.0 - mag * 40.0)) * exp(-along * mix(7.5, 2.0, mag));
      // Grating: fine parallel striations across the blade width.
      ray *= 0.80 + 0.20 * sin(perp * 480.0 + float(k) * 1.7);
      // Slow shimmer per blade.
      ray *= 0.85 + 0.15 * sin(t * 1.6 + float(k) * 2.1 + mag * 27.0);
      acc += vec3(1.0, 0.87, 0.55) * ray * spikeGain;
    }
    return acc;
  }

  // nebula: the dusty blue-violet mass right of center. Domain-warped fbm
  // (two warp passes) makes the filaments curl; a soft radial window masks it
  // into one irregular cloud. Dust lanes carve darkness and rim the cloud in
  // rust where the mask edge meets the warp.
  vec3 nebula(vec2 p, float t) {
    vec2 c = vec2(0.16, -0.03);            // cloud center, right of frame center
    vec2 q = p - c;
    float r = length(q / vec2(1.25, 1.0)); // slightly wide
    // window: soft-edged blob, one big lobe plus a smaller curl above.
    float win = exp(-r * r * 7.0);
    win += 0.5 * exp(-dot(q - vec2(-0.10, 0.14), q - vec2(-0.10, 0.14)) * 20.0);
    // curl warp - the nebula's filaments FLOW, and the whole window breathes.
    vec2 w = vec2(fbm(q * 3.0 + vec2(0.0, t * 0.18)), fbm(q * 3.0 + vec2(5.2, -t * 0.14)));
    float body = fbm(q * 4.2 + (w - 0.5) * 1.8 + vec2(t * 0.10, 0.0));
    body = pow(max(body, 0.0), 1.5);
    win *= 0.92 + 0.08 * sin(t * 0.22);
    // periwinkle body toward the core, blue-grey at the fringes
    vec3 tint = mix(vec3(0.54, 0.56, 0.75), vec3(0.33, 0.36, 0.58), smoothstep(0.2, 0.8, r));
    // dust: same field high-passed -> dark filaments + rust rims
    float dust = smoothstep(0.42, 0.62, fbm(q * 6.5 + (w - 0.5) * 2.4 + 9.7));
    vec3 col = tint * body * win * 1.30;
    col *= 1.0 - dust * 0.55;
    col += vec3(0.72, 0.46, 0.28) * dust * win * body * 0.55;   // rust rim
    return col;
  }

  // dustSlab: the hard-edged rust band across the upper left. A rotated
  // coordinate's band with ONE hard edge (step) and one soft one, mottled by
  // fbm so it reads as a corrugated sheet of dust, not a gradient.
  vec3 dustSlab(vec2 p, float t) {
    vec2 q = rot2(p - vec2(-0.22, 0.20), 0.35);   // slab frame, tilted
    float band = smoothstep(0.0, 0.045, q.y) * (1.0 - smoothstep(0.055, 0.16, q.y));
    float win = (1.0 - smoothstep(-0.05, 0.30, q.x)) * smoothstep(-0.34, -0.05, q.x);
    float mott = 0.45 + 0.55 * fbm(q * vec2(6.0, 14.0) + vec2(t * 0.07, 0.0));
    float edge = step(0.0, q.y);                  // the hard lower edge
    vec3 rust = mix(vec3(0.78, 0.48, 0.29), vec3(0.55, 0.28, 0.16), mott);
    return rust * band * win * mott * (0.78 + 0.45 * edge);
  }

  // gasVeil: the reference's frame-wide faint cirrus - but as DISCRETE CLOUDS,
  // not a fog: a low-frequency sheet reshaped hard (wide smoothstep window) so
  // individual cloud masses appear with genuinely dark gaps between them.
  // A haze reading here flattens the whole field; clumps keep the depth.
  vec3 gasVeil(vec2 p, float t) {
    // the whole veil slowly ROLLS around the frame center - the most visible
    // motion in the scene, so the clouds migrate like weather.
    vec2 gp = rot2(p, t * 0.012);
    vec2 w = vec2(vnoise(gp * 1.3 + vec2(t * 0.045, 0.0)),
                  vnoise(gp * 1.3 + vec2(4.4, t * 0.035)));
    float gas = fbm(gp * 1.9 + (w - 0.5) * 1.1);
    // hard reshape: big bright clumps, near-zero floor between them.
    gas = smoothstep(0.46, 0.72, gas);
    // density gradient: strongest lower-right, thinnest upper-right corner.
    float dens = 0.30 + 0.70 * smoothstep(-0.6, 0.9, gp.x - 0.8 * gp.y);
    // rust threads: a higher-frequency sheet gated by the same warp.
    float rustTh = smoothstep(0.55, 0.75, fbm(gp * 4.4 + (w - 0.5) * 1.8 + 7.7));
    vec3 col = vec3(0.36, 0.38, 0.55) * gas * gas * dens * 0.85;     // blue-grey clumps
    col += vec3(0.62, 0.40, 0.26) * rustTh * gas * dens * 0.24;      // rust filaments
    return col;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.15 + uSpeed * 1.2);

    // iconZone: dims the left strip where desktop icons live.
    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.6, iconZone);

    // Background: near-black indigo, only a whisper of lift low in the frame
    // (kept dark so the gas clumps sit against true void).
    vec3 col = mix(uVoid * 0.85, uVoid * 1.25, smoothstep(-0.55, 0.75, -p.y) * 0.5);

    // The frame-wide gas veil first, so every layer above it reads as seen
    // THROUGH the gas.
    col += gasVeil(p, t) * quiet;

    // Patchy dust extinction: the veil's dark pockets swallow parts of the
    // galaxy field (the reference's clouds occlude the smudges in places).
    float extinct = smoothstep(0.62, 0.80, fbm(p * 3.4 + 2.2 + vec2(t * 0.030, 0.0)));

    // The galaxy field: fine layers only - this reference's smudges are small
    // and dense; the eye should find new ones the longer it looks.
    vec3 field =
        galaxySheet(p * 26.0 + vec2(t * 0.050, 0.0), t, 2.9, 0.86) * 0.7
      + galaxySheet(p * 52.0 + vec2(t * 0.080, -t * 0.024), t, 7.3, 0.90) * 0.42;
    col += field * (1.0 - extinct * 0.35) * uStars * quiet;

    // The nebula and dust slab sit between the field and the stars.
    col += nebula(p, t) * mix(1.0, 1.5, uHeight) * quiet;
    col += dustSlab(p, t) * quiet;

    // Hero stars: one true hero right of center whose blades cross the frame,
    // companions at hand-placed spots with short blades. Intensity owns
    // these - they are the marquee item of the reference.
    vec3 heroes =
        heroStar(p, vec2(0.185, 0.045), 1.0, t)
      + heroStar(p, vec2(-0.315, -0.205), 0.55, t)
      + heroStar(p, vec2(-0.05, 0.315), 0.42, t)
      + heroStar(p, vec2(0.34, -0.24), 0.36, t)
      + heroStar(p, vec2(0.02, -0.33), 0.50, t);
    col += heroes * uIntensity * quiet;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) - Tone.js space bed. Grand and still: D-root drone under a
// golden scale, with high sparkle like starlight leaving a spike tip.
export function buildAudio(api) {
  return api.interstellar({
    root: 73.42,
    scale: [146.83, 174.61, 220.00, 293.66, 329.63, 440.00],
    color: 'gold',
    density: 0.40,
    sparkle: 0.55,
    wind: 0.25,
  });
}
