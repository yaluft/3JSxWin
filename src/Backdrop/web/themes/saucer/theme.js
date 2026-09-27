// theme.js (saucer) - an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time it is picked. A per-image replica of the Chandra + Hubble +
// Webb composite of Messier 104, the Sombrero Galaxy (posted Aug 2026): a
// spiral seen almost perfectly edge-on, reading as a wide thin saucer - a
// lavender halo, a pale cream nucleus, a disk brighter in two arcs along its
// length with a darker lane just inside them, a fringe of dust on the lower
// edge, tapered wispy tips, the frame veiled in faint cirrus with vertical
// strands lifted off the plane, teal X-ray point sources scattered above and
// below (Chandra's contribution), and one four-spike anchor star low right.

// id must match BOTH the folder name (themes/saucer/) and the "id" field of
// this theme's row in themes/index.json. theme-catalog.js builds the import()
// path from the folder name and cross-checks it against the manifest, so any
// mismatch means the theme silently never loads.
export const id = 'saucer';

// meta is merged into SCENE_META (scenes-meta.js) so the scene menu can show a
// name/blurb before this module is ever imported.
export const meta = {
  label: 'Sombrero',
  blurb: 'Messier 104 edge-on - thin ring-gap lavender disk, cream nucleus, X-ray teal sources in a dusty veil',
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

  // alongX: the disk's brightness ALONG its length. Beyond the base taper it
  // carries the reference's ring-gap structure: a darker lane at |x| ~ 0.20
  // and a brighter annulus straddling |x| ~ 0.29, which is what makes the
  // saucer read as a disk with a gap instead of a smear of light.
  float alongX(float x) {
    float ax = abs(x);
    float taper = smoothstep(0.50, 0.16, ax);            // fades toward the tips
    float g = ax - 0.195;                               // gap center (squared: pow base must stay >= 0)
    float a = ax - 0.295;                               // annulus center
    float gap = 1.0 - 0.52 * exp(-g * g / 0.0032);
    float ring = 1.0 + 1.30 * exp(-a * a / 0.0042);
    return taper * gap * ring;
  }

  // saucer: the galaxy body. Across the plane (y) it is a very thin gaussian
  // whose width itself tapers, so the tips run out into wisps; a noise chain
  // along x roughens the tips into streaks. The dust fringe shaves the lower
  // edge (y < 0) the way the reference's dust lane does.
  float saucer(float x, float y, float t) {
    float ax = abs(x);
    float w = 0.017 * (1.0 - 0.55 * smoothstep(0.15, 0.50, ax));
    float body = exp(-y * y / (w * w)) * alongX(x);
    // wisps: ragged streaks at the tips only.
    float wispMask = smoothstep(0.24, 0.44, ax);
    body *= 1.0 - wispMask * 0.45 * (0.5 + 0.5 * vnoise(vec2(x * 16.0, t * 0.05)));
    // dust fringe on the lower edge.
    body *= 1.0 - 0.42 * smoothstep(0.004, -0.016, y) * smoothstep(0.36, 0.10, ax);
    return body;
  }

  // cluster: one teal star-cluster bokeh - a soft round gaussian patch, gently
  // pulsing, slightly varied in tint. The reference's clusters are diffuse
  // coin-shaped glows, not points.
  vec3 cluster(vec2 p, vec2 pos, float rad, float t, float phase) {
    float d = length(p - pos);
    float glow = exp(-d * d / (rad * rad));
    glow *= 0.8 + 0.2 * sin(t * 0.5 + phase);
    vec3 tint = mix(vec3(0.50, 0.91, 0.85), vec3(0.35, 0.82, 0.80), 0.5 + 0.5 * sin(phase * 2.3));
    return tint * glow * 0.40;
  }

  // anchorStar: the single four-spike star low right. A hot white-gold core
  // plus exactly two axes - vertical and horizontal - thin blades, the calm
  // counterpart to the JWST six-spike stars elsewhere in the library.
  vec3 anchorStar(vec2 p, vec2 pos, float t) {
    vec2 q = p - pos;
    float r = length(q);
    vec3 acc = mix(vec3(1.0, 0.97, 0.88), vec3(1.0, 0.88, 0.62), smoothstep(0.0, 0.02, r))
             * exp(-r * r / 0.00012) * 1.6;
    for (int k = 0; k < 2; k++) {
      vec2 d = k == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      float along = abs(dot(q, d));
      float perp = abs(dot(q, vec2(-d.y, d.x)));
      float ray = exp(-perp * 260.0) * exp(-along * 8.5);
      ray *= 0.85 + 0.15 * sin(t * 0.6 + float(k) * 1.9);
      acc += vec3(1.0, 0.92, 0.70) * ray * 0.55;
    }
    return acc;
  }

  // farSheet: sparse far-field - a mix of pinpoint stars and tiny neutral
  // galaxy smudges so the saucer has depth behind it.
  vec3 farSheet(vec2 p, float t, float seed, float density) {
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
        float size = 0.010 + mag * 0.028;
        vec3 tint = mix(vec3(0.80, 0.76, 0.92), vec3(0.94, 0.86, 0.72),
                        hash21(cell + seed * 3.3));
        acc += tint * exp(-d * d / (size * size)) * mag
             * (0.7 + 0.3 * sin(t * 0.7 + mag * 37.0));
      }
    }
    return acc;
  }

  // cirrus: the reference's frame-wide faint gas - as DISCRETE lavender-grey
  // cloud masses above and below the disk (hard reshape so real dark sky
  // shows between clumps), slightly teal-tinted high above the plane.
  vec3 cirrus(vec2 p, float t) {
    vec2 w = vec2(vnoise(p * 1.4 + vec2(t * 0.008, 0.0)),
                  vnoise(p * 1.4 + vec2(3.3, -t * 0.007)));
    float g = fbm(p * 2.0 + (w - 0.5) * 1.0);
    g = smoothstep(0.45, 0.76, g);
    // vertical reach: strong near the plane, gone by the frame edges.
    float reach = exp(-p.y * p.y / 0.16);
    // along-disk bias: fullest over the disk's outer half, not just the core.
    float ob = abs(p.x) - 0.30;                          // (squared: pow base must stay >= 0)
    float alongBias = 0.35 + 0.65 * exp(-ob * ob / 0.16);
    vec3 tint = mix(vec3(0.42, 0.37, 0.54), vec3(0.34, 0.46, 0.50),
                    smoothstep(0.05, 0.42, p.y));   // teal lean high above
    return tint * g * g * reach * alongBias * 0.70;
  }

  // wisps: thin vertical filaments rising off the disk - JWST's view of this
  // galaxy shows dust and gas strands lifted perpendicular to the plane.
  // fbm stretched along y (compressed x) makes tall, narrow strands.
  float wisps(float x, float y, float t) {
    float strand = fbm(vec2(x * 9.0, y * 2.6) + vec2(0.0, t * 0.01));
    strand = smoothstep(0.48, 0.78, strand);
    float win = exp(-abs(y) * 5.5) * smoothstep(0.02, 0.09, abs(y))
              * smoothstep(0.50, 0.16, abs(x));
    return strand * win;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.05 + uSpeed * 0.5);

    // iconZone: dims the left strip where desktop icons live.
    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.6, iconZone);

    // Background: purple-black, gently lifted toward the galaxy plane.
    vec3 col = mix(uVoid * 0.95, uVoid * 1.8,
                   exp(-abs(p.y) * 5.0) * exp(-pow(abs(p.x) / 0.62, 2.0)) * 0.55);

    // Far field behind the saucer.
    col += farSheet(p * 19.0 + vec2(t * 0.008, 0.0), t, 2.6, 0.32) * 0.5 * uStars * quiet;
    col += farSheet(p * 34.0 + vec2(t * 0.014, -t * 0.006), t, 7.8, 0.36) * 0.28 * uStars * quiet;

    // The halo: a wide elliptical lavender-grey envelope around the whole
    // disk (it breathes a touch - uHeight widens it), then the frame-wide
    // cirrus veil and the vertical wisps lifted off the plane.
    float hax = abs(p.x) / (0.52 + uHeight * 0.10);
    float halo = exp(-p.y * p.y / (0.085 + uHeight * 0.02)) * exp(-pow(hax, 1.7));
    col += vec3(0.42, 0.36, 0.52) * halo * 0.16 * quiet;
    col += cirrus(p, t) * quiet;
    col += vec3(0.66, 0.62, 0.78) * wisps(p.x, p.y, t) * 0.24 * quiet;

    // The saucer: lavender disk glow first (wider), then the crisp thin band.
    float bodyWide = exp(-p.y * p.y / 0.0028) * alongX(p.x);
    col += vec3(0.79, 0.72, 0.91) * bodyWide * 0.38 * quiet;
    float body = saucer(p.x, p.y, t);
    vec3 diskTint = mix(vec3(0.88, 0.82, 0.98), vec3(0.96, 0.94, 1.0),
                        exp(-p.x * p.x * 22.0));
    col += diskTint * body * 1.05 * quiet;

    // The nucleus: pale cream, modest - this reference's core is a calm
    // center, not a flare - plus a faint cross-shaped bleed.
    float rn = length(p);
    col += vec3(0.96, 0.94, 0.78) * exp(-rn * rn / 0.00035) * 1.25 * quiet;
    float cross = exp(-abs(p.x) * 46.0) * exp(-abs(p.y) * 9.0)
                + exp(-abs(p.y) * 46.0) * exp(-abs(p.x) * 9.0);
    col += vec3(0.90, 0.86, 0.96) * cross * 0.10 * quiet;

    // Teal clusters: seven hand-placed coin glows above and below the plane,
    // clear of the icon strip.
    vec3 clusters =
        cluster(p, vec2(-0.235,  0.205), 0.020, t, 0.0)
      + cluster(p, vec2(-0.075,  0.300), 0.014, t, 1.3)
      + cluster(p, vec2( 0.150,  0.235), 0.017, t, 2.6)
      + cluster(p, vec2( 0.315,  0.140), 0.012, t, 4.1)
      + cluster(p, vec2(-0.150, -0.225), 0.016, t, 5.5)
      + cluster(p, vec2( 0.085, -0.305), 0.019, t, 6.9)
      + cluster(p, vec2( 0.245, -0.185), 0.013, t, 8.3);
    col += clusters * quiet;

    // The anchor star: one four-spike star low right, the frame's counterweight.
    col += anchorStar(p, vec2(aspect * 0.38, -0.27), t) * uIntensity * quiet;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) - Tone.js space bed. The saucer is the calmest replica:
// a G-root drone, open scale, rare phrases with a low octave answer.
export function buildAudio(api) {
  return api.interstellar({
    root: 98.00,
    scale: [196.00, 220.00, 246.94, 293.66, 329.63, 392.00],
    color: 'warm',
    density: 0.28,
    sparkle: 0.20,
    wind: 0.22,
    echo: true,
  });
}
