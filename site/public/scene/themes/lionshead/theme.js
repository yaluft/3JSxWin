// theme.js (lionshead) - an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time it is picked. A per-image replica of the JWST view of a planetary
// nebula (assets/images/lions_head_nebula.jpg): a dying star at dead centre, a
// bright pink-white inner shell of overlapping lobes, a much wider blue-lavender
// outer halo, hundreds of fine radial spokes combing outward through the halo,
// a scatter of yellow-gold knots on the shell, and a deep-black field behind it
// all speckled with orange background galaxies and a handful of six-spike stars.
//
// Nothing from the JPEG is loaded at runtime - the image was a visual reference
// and every structure below is procedural. See CREDITS.md.

// id must match BOTH the folder name (themes/lionshead/) and the "id" field of
// this theme's row in themes/index.json. theme-catalog.js builds the import()
// path from the folder name and cross-checks it against the manifest, so any
// mismatch means the theme silently never loads.
export const id = 'lionshead';

// meta is merged into SCENE_META (scenes-meta.js) so the scene menu can show a
// name/blurb before this module is ever imported.
export const meta = {
  label: "Lion's Head",
  blurb: 'A planetary nebula - pink inner lobes, a combed blue halo, gold knots, an orange galaxy field',
  silent: true,
};

// kind:'shader' means "this theme is only a fragment". scenes.js pastes the
// COMMON preamble from shader-lib.js (precision, all the uXxx uniforms,
// hash21/vnoise/fbm/finish) in front of the string below, then runs the result
// on one full-screen PlaneGeometry(2,2) quad.
export const kind = 'shader';

export const fragment = /* glsl */ `
  // hash22: 2D -> 2D random, for scattering pinpoints inside their grid cell.
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  // ---------------------------------------------------------------------------
  // The nebula is built in polar coordinates around its centre: every layer is a
  // function of radius (how far out) and angle (which spoke). Working in polar
  // is what makes the radial comb and the round shells cheap.
  // ---------------------------------------------------------------------------

  // spokes: the fine radial filaments combing outward through the outer halo.
  // A high-frequency function of ANGLE ONLY, so each filament runs perfectly
  // radially; multiplied by a radial window so they only exist in the halo band
  // and fade before they reach the inner shell. The slow angular drift keeps
  // them from looking like a frozen texture.
  float spokes(float ang, float r, float t, float life) {
    // Two incommensurate angular frequencies so the comb never visibly repeats.
    // The time coefficients are ~15x the original: the filaments now visibly
    // writhe and sweep rather than shimmering in place.
    float a = vnoise(vec2(ang * 34.0, t * 0.45 * life));
    float b = vnoise(vec2(ang * 71.0 + 9.7, t * 0.32 * life));
    float comb = a * 0.65 + b * 0.35;
    // The threshold itself breathes, so filaments bloom in and fade out instead
    // of holding a fixed shape - the single strongest "alive" cue here.
    float thresh = 0.46 - 0.14 * sin(t * 0.7) * life;
    comb = smoothstep(thresh, thresh + 0.40, comb);
    // Radial window: absent inside the shell, peaks mid-halo, gone by the rim.
    float win = smoothstep(0.085, 0.150, r) * smoothstep(0.310, 0.170, r);
    // Filaments thin out as they travel, like the reference's fraying tips.
    return comb * win * (1.0 - 0.35 * smoothstep(0.15, 0.30, r));
  }

  // halo: the wide blue-lavender envelope. A soft annulus - not a disc - with a
  // gently turbulent edge so the rim reads as gas rather than a drawn circle.
  float halo(vec2 q, float r, float ang, float t, float life) {
    // Turbulence displaces the rim radius per-angle. The churn now advances ~20x
    // faster and swings 2.5x wider, so the shell's edge visibly boils.
    float churn = fbm(vec2(cos(ang), sin(ang)) * 2.6 + vec2(t * 0.30 * life, t * 0.42 * life));
    float rim = 0.268 + (churn - 0.5) * 0.115 * life;
    // Body: full inside the rim, falling off quickly outside it.
    float body = smoothstep(rim + 0.030, rim - 0.055, r);
    // Hollow the very centre - the halo is a shell, the inner lobes sit inside it.
    body *= smoothstep(0.055, 0.135, r);
    // Limb brightening: a shell seen edge-on is brightest just inside its rim.
    float limb = exp(-(r - rim + 0.030) * (r - rim + 0.030) / 0.0016);
    return body * (0.55 + 0.85 * limb);
  }

  // innerLobes: the bright pink-white core structure. The reference shows a few
  // overlapping near-circular lobes rather than one smooth ball, so this sums
  // three offset gaussians and then bites a soft cavity out of the middle where
  // the central star's wind has cleared the gas.
  float innerLobes(vec2 q, float t, float life) {
    float acc = 0.0;
    // Three lobes orbiting their own centres - now ~6x faster and 3x wider, so
    // they visibly swirl around each other instead of trembling.
    float sw = 0.62 * life;                       // orbit rate
    float rad = 0.030 * life;                     // orbit radius
    vec2 c0 = vec2(cos(t * sw), sin(t * sw * 0.85)) * rad;
    vec2 c1 = vec2(-0.020, 0.016) + vec2(cos(t * sw * 0.7 + 2.1), sin(t * sw * 0.9 + 2.1)) * rad * 0.8;
    vec2 c2 = vec2( 0.019, -0.014) + vec2(cos(t * sw * 0.8 + 4.3), sin(t * sw * 0.6 + 4.3)) * rad * 0.8;
    // Each lobe also throbs in size on its own phase.
    float b0 = 1.0 + 0.30 * sin(t * 0.9) * life;
    float b1 = 1.0 + 0.30 * sin(t * 1.1 + 2.0) * life;
    float b2 = 1.0 + 0.30 * sin(t * 0.8 + 4.0) * life;
    acc += exp(-dot(q - c0, q - c0) / (0.00170 * b0));
    acc += exp(-dot(q - c1, q - c1) / (0.00120 * b1)) * 0.85;
    acc += exp(-dot(q - c2, q - c2) / (0.00125 * b2)) * 0.85;
    // Filamentary texture, now flowing across the lobes rather than sitting still.
    float fil = fbm(q * 26.0 + vec2(t * 0.55 * life, -t * 0.38 * life));
    acc *= 0.72 + 0.48 * fil;
    // Central cavity: darker right at the star, edges bright (a blown bubble).
    float rr = length(q);
    acc *= 0.35 + 0.65 * smoothstep(0.006, 0.030, rr);
    return acc;
  }

  // knots: the small yellow-gold clumps scattered on and just outside the inner
  // shell. Hand-free - placed on a jittered ring by hashing an index - each one
  // a tiny gaussian with its own slow flicker.
  vec3 knots(vec2 q, float t, float life) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 14; i++) {
      float fi = float(i);
      float h0 = hash21(vec2(fi, 3.7));
      float h1 = hash21(vec2(fi, 9.1));
      // The knots now ORBIT the core at their own rates and drift outward and
      // back, so they read as material moving through the shell.
      float ang = h0 * 6.2831853 + t * (0.10 + h1 * 0.18) * life;
      float rad = (0.062 + h1 * 0.052) * (1.0 + 0.16 * sin(t * 0.6 + fi) * life);
      vec2 pos = vec2(cos(ang), sin(ang)) * rad;
      float d = length(q - pos);
      float size = 0.0032 + hash21(vec2(fi, 15.3)) * 0.0042;
      // Deeper flicker: knots now nearly extinguish and re-light.
      float pulse = 0.30 + 0.70 * (0.5 + 0.5 * sin(t * 1.6 + fi * 2.4));
      pulse = mix(1.0, pulse, life);
      acc += vec3(1.00, 0.86, 0.42) * exp(-d * d / (size * size)) * pulse;
    }
    return acc;
  }

  // galaxySheet: the background field. Unlike a plain starfield this mixes two
  // populations, which is what makes a JWST frame read correctly: warm orange
  // elliptical smudges (slightly oval, soft) and cooler faint pinpoints.
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
        float mag = hash21(cell + seed * 7.1);
        mag *= mag;
        vec2 d = f - pos;
        // Is this cell a galaxy smudge or a pinpoint star?
        float isGal = step(0.55, hash21(cell + seed * 11.9));
        // Galaxies: oval, squashed on a per-cell random axis.
        float rot = hash21(cell + seed * 2.7) * 6.2831853;
        vec2 dr = vec2(d.x * cos(rot) - d.y * sin(rot), d.x * sin(rot) + d.y * cos(rot));
        dr.y *= 1.0 + hash21(cell + seed * 4.4) * 1.6;
        float galSize = 0.020 + mag * 0.038;
        float gal = exp(-dot(dr, dr) / (galSize * galSize));
        // Stars: tight, and they twinkle; galaxies do not.
        float starSize = 0.008 + mag * 0.016;
        float star = exp(-dot(d, d) / (starSize * starSize))
                   * (0.75 + 0.25 * sin(t * 0.9 + mag * 41.0));
        vec3 galTint  = mix(vec3(0.92, 0.62, 0.31), vec3(0.86, 0.72, 0.46),
                            hash21(cell + seed * 3.3));
        vec3 starTint = mix(vec3(0.86, 0.84, 0.96), vec3(0.98, 0.92, 0.82),
                            hash21(cell + seed * 6.6));
        acc += mix(starTint * star, galTint * gal, isGal) * mag;
      }
    }
    return acc;
  }

  // spikeStar: a JWST six-spike star. Three blades at 60 degrees (each blade is
  // symmetric, so three axes give six spikes) over a hot core.
  vec3 spikeStar(vec2 p, vec2 pos, float scale, float t, float phase, float life) {
    vec2 q = p - pos;
    // The whole star slowly rotates, so its spikes sweep like a beacon.
    float sr = t * 0.06 * life + phase * 0.3;
    q = vec2(q.x * cos(sr) - q.y * sin(sr), q.x * sin(sr) + q.y * cos(sr));
    float r = length(q);
    // The core throbs noticeably.
    float core = 1.0 + 0.45 * sin(t * 1.2 + phase) * life;
    vec3 acc = vec3(1.0, 0.95, 0.90) * exp(-r * r / (0.00009 * scale * core)) * 1.5;
    for (int k = 0; k < 3; k++) {
      float a = float(k) * 1.0471976 + 0.5236;
      vec2 d = vec2(cos(a), sin(a));
      float along = abs(dot(q, d));
      float perp  = abs(dot(q, vec2(-d.y, d.x)));
      float ray = exp(-perp * (300.0 / scale)) * exp(-along * (10.0 / scale));
      // Each blade pulses independently and much harder than before.
      ray *= 0.55 + 0.45 * sin(t * 1.4 + phase + float(k) * 1.7) * life;
      acc += vec3(0.95, 0.90, 1.00) * ray * 0.50;
    }
    return acc;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    // Time base. The old mapping (0.05 + uSpeed * 0.5) topped out near 0.20 even
    // with Speed maxed, which read as a still image with a faint shimmer. This
    // one starts where the old one ended and scales up hard, so the Speed slider
    // spans "drifting" to "clearly turning".
    float t = uTime * (0.20 + uSpeed * 6.0);

    // life: the master motion amount, driven by the Twinkle slider (0..1, live).
    // Every animated term below is scaled by this, so one control takes the scene
    // from nearly still (0) to strongly breathing (1).
    float life = 0.25 + uTwinkle * 1.55;

    // breath: the global pulse - space itself expanding and contracting. Two
    // detuned sines so it never feels like a metronome.
    float breath = sin(t * 0.55) * 0.62 + sin(t * 0.31 + 1.7) * 0.38;
    // Radial scale factor applied to the whole nebula: it inhales and exhales.
    float pulse = 1.0 + breath * 0.085 * life;

    // iconZone: dims the left strip where desktop icons live.
    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.6, iconZone);

    // The nebula sits slightly right of centre so it clears the icon strip. It
    // also drifts on a slow lissajous path, so the whole object moves in frame
    // rather than sitting nailed to one spot.
    vec2 drift = vec2(sin(t * 0.23), cos(t * 0.17)) * 0.022 * life;
    vec2 q = p - vec2(aspect * 0.055, 0.0) - drift;
    // The breath: dividing the sample position by the pulse factor inflates and
    // deflates the entire nebula around its centre.
    q /= pulse;
    // Slow rotation, so the spokes visibly sweep instead of shimmering in place.
    float spin = t * 0.075 * life;
    q = vec2(q.x * cos(spin) - q.y * sin(spin), q.x * sin(spin) + q.y * cos(spin));
    float r = length(q);
    float ang = atan(q.y, q.x);

    // Background: this reference is very nearly pure black. Resist the urge to
    // lift it - the black is what makes the halo glow.
    vec3 col = uVoid * 0.55;

    // Background galaxies and stars, two sheets at different scales for depth.
    // Parallax: the two sheets drift at clearly different rates, which reads as
    // depth and is far more visible than the old near-static crawl.
    col += galaxySheet(p * 16.0 + vec2(t * 0.075, t * 0.020) * life, t, 2.1, 0.30) * 0.60 * uStars * quiet;
    col += galaxySheet(p * 29.0 + vec2(t * 0.155, -t * 0.055) * life, t, 8.3, 0.34) * 0.34 * uStars * quiet;

    // --- The nebula, painted outside-in ---

    // Outer halo: blue-lavender, tinted cooler toward its rim.
    float h = halo(q, r, ang, t, life) * (0.85 + uHeight * 0.25);
    vec3 haloTint = mix(vec3(0.62, 0.71, 0.92), vec3(0.45, 0.58, 0.86),
                        smoothstep(0.10, 0.28, r));
    col += haloTint * h * 0.52 * quiet;

    // Radial spokes combing through the halo, slightly brighter than it.
    float sp = spokes(ang, r, t, life);
    col += vec3(0.78, 0.84, 0.98) * sp * 0.30 * quiet;

    // A faint magenta wash bridging halo and core, so the colour transition is
    // gradual rather than a hard edge between blue and pink.
    float bridge = exp(-(r - 0.085) * (r - 0.085) / 0.0022);
    col += vec3(0.72, 0.46, 0.74) * bridge * 0.30 * quiet;

    // Inner lobes: the bright pink-white shell.
    float lobes = innerLobes(q, t, life);
    vec3 lobeTint = mix(vec3(1.00, 0.86, 0.94), vec3(0.98, 0.72, 0.86),
                        smoothstep(0.010, 0.055, r));
    col += lobeTint * lobes * 0.95 * uIntensity * quiet;

    // Gold knots on the shell.
    col += knots(q, t, life) * 0.55 * quiet;

    // The central star: small, hot, white. It now pulses strongly - the engine
    // driving the whole nebula, visibly beating.
    float beat = 1.0 + 0.55 * sin(t * 1.05) * life;
    col += vec3(1.00, 0.96, 0.99) * exp(-r * r / (0.000035 * beat)) * 1.7 * uIntensity * quiet;
    col += vec3(0.96, 0.80, 0.92) * exp(-r * r / (0.00060 * beat)) * 0.40 * (0.7 + 0.5 * beat) * quiet;

    // Three six-spike foreground stars, placed like the reference's: one upper
    // left, one lower right, one small mid right. Kept off the icon strip.
    col += spikeStar(p, vec2(-aspect * 0.30,  0.33), 1.25, t, 0.0, life) * uIntensity * quiet;
    col += spikeStar(p, vec2( aspect * 0.36, -0.30), 1.00, t, 2.2, life) * uIntensity * quiet;
    col += spikeStar(p, vec2( aspect * 0.24,  0.14), 0.55, t, 4.6, life) * uIntensity * quiet;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) - Tone.js space bed. A planetary nebula is a slow exhalation:
// low D drone, warm color, long phrases, the shell answering the core.
export function buildAudio(api) {
  return api.interstellar({
    root: 73.42,
    scale: [146.83, 174.61, 220.00, 261.63, 293.66, 349.23],
    color: 'warm',
    density: 0.30,
    sparkle: 0.40,
    wind: 0.40,
  });
}
