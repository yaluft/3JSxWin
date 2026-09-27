// theme.js (coldlens) - an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time it is picked. A per-image replica of a wide edge-on starburst
// galaxy (assets/images/55377597821_c2549169e9_o.png): a very wide, very thin
// lens of icy blue-white dust running right across the frame, its lanes broken
// into clumps and knots, a magenta-violet core burning through the middle of the
// lens, salmon-orange filament loops arching above and below that core, dark
// dust gaps biting into the lanes on either side of centre, tapering wings that
// fray at the tips, and a dense violet-tinted star field behind everything.
//
// The reference is extremely wide (roughly 2.4:1), which suits a desktop frame:
// the lens is built to span the full width and stay thin regardless of aspect.
//
// Nothing from the PNG is loaded at runtime - the image was a visual reference
// and every structure below is procedural. See CREDITS.md.

// id must match BOTH the folder name (themes/coldlens/) and the "id" field of
// this theme's row in themes/index.json.
export const id = 'coldlens';

export const meta = {
  label: 'Cold Lens',
  blurb: 'An edge-on starburst - icy blue dust lanes spanning the frame, a magenta core, salmon filament loops',
  silent: true,
};

export const kind = 'shader';

export const fragment = /* glsl */ `
  // hash22: 2D -> 2D random, for scattering pinpoints inside their grid cell.
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  // lensProfile: how thick the lens is at a given x. Thickest at the centre,
  // tapering to frayed tips - this single function is what gives the galaxy its
  // lens (almond) silhouette.
  float lensProfile(float x) {
    float ax = abs(x);
    // Base half-thickness, falling off toward the tips.
    float th = 0.100 * exp(-ax * ax / 0.115);
    // Never quite reach zero before the frame edge, so the wings fray rather
    // than end in a point.
    return max(th, 0.012 * smoothstep(0.95, 0.30, ax));
  }

  // lanes: the clumpy dust structure inside the lens. fbm stretched hard along x
  // (so structure runs ALONG the lens, as real dust lanes do) and reshaped into
  // discrete knots, with a second finer octave for the speckle of resolved stars.
  float lanes(vec2 q, float t, float life) {
    // Stretch: low frequency across x, higher across y, so features are long
    // and thin in the direction the lens runs.
    vec2 s = vec2(q.x * 2.2, q.y * 11.0);
    // The dust now STREAMS along the disk - the lanes visibly flow left to
    // right, which is what makes an edge-on galaxy read as rotating.
    vec2 w = vec2(vnoise(s * 1.3 + vec2(t * 0.26 * life, t * 0.06 * life)),
                  vnoise(s * 1.3 + vec2(5.1, -t * 0.20 * life)));
    float g = fbm(s + (w - 0.5) * 1.9 + vec2(t * 0.32 * life, 0.0));
    float lo = 0.40 - 0.10 * sin(t * 0.5) * life;
    g = smoothstep(lo, lo + 0.38, g);
    // Finer speckle, streaming faster than the coarse structure (parallax
    // within the disk).
    float fine = vnoise(vec2(q.x * 26.0, q.y * 70.0) + vec2(t * 0.55 * life, 0.0));
    g *= 0.72 + 0.42 * fine;
    return g;
  }

  // dustGaps: the dark bites taken out of the lanes either side of the core.
  // Returns a MULTIPLIER (1 = clear, <1 = obscured).
  float dustGaps(vec2 q, float t, float life) {
    float acc = 1.0;
    // Two large gaps flanking the centre, plus a smaller one further out.
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float cx = i == 0 ? -0.115 : (i == 1 ? 0.130 : -0.300);
      float cy = i == 0 ?  0.012 : (i == 1 ? -0.016 : -0.008);
      float rx = i == 2 ? 0.055 : 0.080;
      float ry = i == 2 ? 0.016 : 0.026;
      // The gaps drift along the disk with the dust and pulse in size, so the
      // dark bites travel rather than sitting fixed.
      float slide = sin(t * 0.18 + fi * 2.1) * 0.045 * life;
      vec2 d = (q - vec2(cx + slide, cy)) / vec2(rx, ry);
      float wob = (vnoise(vec2(atan(d.y, d.x) * 2.5, t * 0.38 * life + fi)) - 0.5) * 0.95 * life;
      float g = exp(-dot(d, d) * (1.0 + wob));
      acc *= 1.0 - 0.62 * g * (0.75 + 0.35 * sin(t * 0.55 + fi * 1.7) * life);
    }
    return acc;
  }

  // coreGlow: the magenta-violet centre burning through the lens. Two nested
  // gaussians plus a vertical bleed, since the reference's core light escapes
  // perpendicular to the disk.
  vec3 coreGlow(vec2 q, float t, float life) {
    float r = length(q);
    // The core now visibly beats - a starburst nucleus flaring, not a steady lamp.
    float breathe = 0.72 + 0.48 * (0.5 + 0.5 * sin(t * 0.95));
    breathe = mix(1.0, breathe, life);
    float b0 = 1.0 + 0.40 * sin(t * 1.1) * life;
    float b1 = 1.0 + 0.32 * sin(t * 0.8 + 1.3) * life;
    vec3 acc = vec3(1.00, 0.72, 0.98) * exp(-r * r / (0.00075 * b0)) * 1.25;
    acc += vec3(0.82, 0.42, 0.92) * exp(-r * r / (0.0060 * b1)) * 0.62;
    acc += vec3(0.62, 0.30, 0.80) * exp(-r * r / 0.0260) * 0.30;
    // Vertical bleed, pumping in reach - light escaping the plane in gusts.
    float reach = 7.0 - 2.4 * sin(t * 0.7) * life;
    float bleed = exp(-q.x * q.x / 0.0022) * exp(-abs(q.y) * reach);
    acc += vec3(0.74, 0.38, 0.88) * bleed * 0.30;
    return acc * breathe;
  }

  // loops: the salmon-orange filament arcs curling around the core. Each is a
  // partial ring - a thin annulus windowed in angle - with a noisy radius.
  float loops(vec2 q, float t, float life) {
    float acc = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      // Each loop expands and contracts on its own phase - material cycling
      // out from the core and falling back.
      float rad = (0.052 + fi * 0.020) * (1.0 + 0.20 * sin(t * 0.6 + fi * 1.6) * life);
      // Each loop ROTATES at its own rate, alternating direction.
      float dir = mod(fi, 2.0) < 1.0 ? 1.0 : -1.0;
      float a0  = fi * 1.9 + 0.6 + t * (0.14 + fi * 0.05) * dir * life;
      float aw  = 1.5 - fi * 0.15;
      vec2 qs = vec2(q.x, q.y * 1.45);
      float r = length(qs);
      float ang = atan(qs.y, qs.x);
      float da = mod(ang - a0 + 3.14159265, 6.2831853) - 3.14159265;
      float win = smoothstep(aw, aw * 0.4, abs(da));
      float wob = (vnoise(vec2(ang * 2.2, t * 0.40 * life + fi * 3.1)) - 0.5) * 0.038 * life;
      float band = exp(-(r - rad - wob) * (r - rad - wob) / 0.000085);
      acc += band * win * (0.45 + 0.55 * vnoise(vec2(ang * 4.0, t * 0.50 * life)));
    }
    return acc;
  }

  // starSheet: the background field. This reference's sky is not black but a
  // deep violet dense with faint stars, so density is high and the tint cool.
  vec3 starSheet(vec2 p, float t, float seed, float density) {
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
        float d = length(f - pos);
        float size = 0.008 + mag * 0.020;
        vec3 tint = mix(vec3(0.80, 0.78, 0.94), vec3(0.95, 0.90, 0.98),
                        hash21(cell + seed * 3.3));
        acc += tint * exp(-d * d / (size * size)) * mag
             * (0.78 + 0.22 * sin(t * 0.8 + mag * 37.0));
      }
    }
    return acc;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    // Time base - see lionshead. Spans "drifting" to "clearly moving".
    float t = uTime * (0.20 + uSpeed * 6.0);

    // life: master motion amount on the Twinkle slider (0..1, live).
    float life = 0.25 + uTwinkle * 1.55;

    // breath: the galaxy's slow pulse - the disk thickens and thins.
    float breath = sin(t * 0.42) * 0.62 + sin(t * 0.27 + 2.4) * 0.38;

    // iconZone: dims the left strip where desktop icons live.
    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.6, iconZone);

    // The galaxy is centred but nudged right so its core clears the icon strip.
    vec2 q = p - vec2(aspect * 0.045, 0.0);
    // Normalise x by aspect so the lens always spans the frame width.
    q.x /= max(aspect * 0.62, 0.5);

    // Background: deep violet-black, lifted slightly toward the galaxy plane.
    vec3 col = uVoid * 0.85 + vec3(0.045, 0.030, 0.075)
             * (0.5 + 0.5 * exp(-q.y * q.y * 4.0));

    // Dense background star field, two scales.
    col += starSheet(p * 20.0 + vec2(t * 0.065, t * 0.014) * life, t, 4.2, 0.40) * 0.50 * uStars * quiet;
    col += starSheet(p * 36.0 + vec2(t * 0.135, -t * 0.042) * life, t, 11.5, 0.44) * 0.28 * uStars * quiet;

    // --- The lens -----------------------------------------------------------

    // The disk itself breathes - visibly thickening and thinning along its length.
    float th = lensProfile(q.x) * (0.85 + uHeight * 0.30)
             * (1.0 + breath * 0.22 * life)
             * (1.0 + 0.12 * sin(q.x * 4.0 - t * 0.8) * life);
    // Vertical falloff within the lens - soft, so the disk has a halo of haze.
    float within = exp(-q.y * q.y / (th * th));
    // A wider, fainter envelope of haze around the whole lens.
    float haze = exp(-q.y * q.y / (th * th * 5.5));

    // The icy dust lanes.
    float lane = lanes(q, t, life) * within;
    lane *= dustGaps(q, t, life);
    vec3 laneTint = mix(vec3(0.72, 0.82, 0.95), vec3(0.90, 0.93, 1.00),
                        smoothstep(0.0, 0.35, abs(q.x)));
    col += laneTint * lane * 0.85 * quiet;

    // The haze envelope, cooler and much fainter.
    col += vec3(0.40, 0.48, 0.72) * haze * 0.20 * quiet;

    // A brighter spine right along the plane, where the lens is densest.
    float spine = exp(-q.y * q.y / (th * th * 0.16)) * smoothstep(0.95, 0.25, abs(q.x));
    col += vec3(0.88, 0.92, 1.00) * spine * 0.34 * quiet;

    // --- The core and its filaments -----------------------------------------

    col += coreGlow(q, t, life) * uIntensity * quiet;
    col += vec3(1.00, 0.56, 0.42) * loops(q, t, life) * 0.55 * uIntensity * quiet;

    // A last warm wash tying the core into the lanes either side of it.
    float wash = exp(-q.x * q.x / 0.022) * exp(-q.y * q.y / 0.0075);
    col += vec3(0.86, 0.46, 0.62) * wash * 0.22 * quiet;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) - Tone.js space bed. Icy F-root drone, wide scale, the mass
// of the disk under its bright core as a low echo.
export function buildAudio(api) {
  return api.interstellar({
    root: 87.31,
    scale: [174.61, 196.00, 233.08, 261.63, 293.66, 349.23],
    color: 'cold',
    density: 0.30,
    sparkle: 0.45,
    wind: 0.35,
    echo: true,
  });
}
