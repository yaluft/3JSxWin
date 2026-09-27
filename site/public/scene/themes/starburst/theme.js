// theme.js (starburst) - an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time it is picked. A per-image replica of NASA Webb's 4th-anniversary
// MIRI view of Centaurus A ("Unusual Galaxy Shaped by Cosmic Collision"): a
// luminous edge-on dust lane cutting the frame diagonally lower-left to
// upper-right, white-hot at the middle, beaded into knots along its length,
// with violent filamentary dust-and-gas structures blowing above and below,
// rose-tinted loops near the core, all of it in a violet-on-black palette
// with a few six-spike JWST stars in the foreground.

// id must match BOTH the folder name (themes/starburst/) and the "id" field of
// this theme's row in themes/index.json. theme-catalog.js builds the import()
// path from the folder name and cross-checks it against the manifest, so any
// mismatch means the theme silently never loads.
export const id = 'starburst';

// meta is merged into SCENE_META (scenes-meta.js) so the scene menu can show a
// name/blurb before this module is ever imported.
export const meta = {
  label: 'Centaurus A',
  blurb: 'Webb MIRI on a collision-shaped galaxy - beaded violet dust lane, blown-out shells, rose loops',
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

  // Disk frame: the cigar runs lower-left -> upper-right. u = along the disk,
  // v = across it; both measured from the nucleus, which sits just below the
  // frame center the way it does in the reference.
  const vec2 DSK_DIR = vec2(0.878, 0.478);   // normalized-ish; fixed on purpose
  const vec2 DSK_PRP = vec2(-0.478, 0.878);
  void diskFrame(vec2 p, out float u, out float v) {
    vec2 q = p - vec2(0.0, -0.10);
    u = dot(q, DSK_DIR);
    v = dot(q, DSK_PRP);
  }

  // diskLight: the galaxy body. A thin lens: gaussian across (v), tapering
  // profile along (u) that dies before the ends, then BEADED - modulated by a
  // noise chain so the band reads as chained knots of light, the signature
  // texture of Centaurus A's dust lane in the mid-infrared.
  float diskLight(float u, float v, float t) {
    float au = abs(u);
    float len = smoothstep(0.46, 0.10, au);              // fades toward the tips
    float w = 0.030 * (1.0 - 0.45 * au / 0.46);          // thins toward the tips
    float lens = exp(-v * v / (w * w)) * len;
    float knots = 0.60 + 0.40 * vnoise(vec2(u * 26.0 + t * 0.45, 3.7));
    knots *= 0.80 + 0.20 * vnoise(vec2(u * 61.0 - t * 0.28, 9.1));
    return lens * knots;
  }

  // wind: the superwind. Chaotic filaments blowing PERPENDICULAR to the disk,
  // strongest over the inner half of the galaxy but reaching well out - in
  // the reference the plumes span roughly a quarter to a third of the frame
  // above and below the plane before smoothing into a diffuse halo. fbm
  // stretched along the flow direction (v compressed, u stretched) and
  // domain-warped so strands curl away from the disk plane; the filament
  // sharpening fades with distance so far gas reads smooth, near gas reads
  // filamentary.
  vec3 wind(float u, float v, float t) {
    float au = abs(u);
    float av = abs(v);
    // outflow window: starts just off the plane, decays slowly with distance
    // from it, and extends along most of the cigar.
    float win = smoothstep(0.012, 0.09, av) * exp(-av * 2.5)
              * exp(-au * au / 0.10);
    // flow-stretched coords, advected AWAY from the disk so gas streams outward
    vec2 fc = vec2(u * 3.6, (v - sign(v) * t * 0.30) * 7.5);
    vec2 warp = vec2(fbm(fc + vec2(0.0, t * 0.22)), fbm(fc + vec2(4.1, -t * 0.16)));
    float fil = fbm(fc + (warp - 0.5) * 1.6);
    // filaments only near the plane; smooth wash far out.
    float sharp = 1.7 - 1.1 * smoothstep(0.10, 0.34, av);
    fil = pow(max(fil, 0.0), sharp);
    // palette: rose-pink at the launch point -> violet -> cold blue-grey as
    // the material leaves the galaxy.
    float outv = smoothstep(0.02, 0.34, av);
    vec3 tint = mix(vec3(0.82, 0.54, 0.66), vec3(0.48, 0.37, 0.66), outv);
    tint = mix(tint, vec3(0.29, 0.30, 0.50), smoothstep(0.5, 0.9, outv));
    return tint * fil * win * 1.05;
  }

  // gasWash: the reference's faint background nebulosity - as discrete violet
  // cloud masses around the galaxy (the wind's far halo), NOT a uniform fog:
  // a hard reshape keeps dark sky between the clumps so the field keeps depth.
  vec3 gasWash(vec2 p, float t) {
    float g = fbm(p * 1.8 + vec2(t * 0.040, -t * 0.030));
    g = smoothstep(0.45, 0.78, g);
    // stronger toward the galaxy, thinning toward the corners.
    float d = exp(-dot(p, p) * 1.6);
    return vec3(0.30, 0.26, 0.44) * g * g * (0.25 + 0.75 * d) * 0.55;
  }

  // loop: one rose-tinted arc of the near-core loops - a ring of radius R
  // around the nucleus, visible only inside an angular window centered at
  // angle a0 (so loops read as partial, nested, asymmetric).
  vec3 loop(vec2 p, float R, float a0, float spread, float t) {
    float r = length(p);
    float ang = atan(p.y, p.x) + t * 0.03;   // loops slowly rotate
    float dAng = ang - a0;
    dAng = mod(dAng + 3.14159265, 6.2831853) - 3.14159265;   // wrap to -pi..pi
    float win = exp(-dAng * dAng / (spread * spread)) * (0.92 + 0.08 * sin(t * 0.5 + R * 31.0));
    float arc = exp(-abs(r - R) * 60.0) * win;
    vec3 rose = mix(vec3(0.88, 0.56, 0.50), vec3(0.70, 0.42, 0.52), 0.5 + 0.5 * sin(t * 0.3));
    return rose * arc * 0.30;
  }

  // fgStar: a foreground JWST star - small hot core plus six thin diffraction
  // rays (30deg + k*60deg), modest reach, the way the reference's field stars
  // overlay the galaxy.
  vec3 fgStar(vec2 p, vec2 pos, float mag, float t) {
    vec2 q = p - pos;
    float r = length(q);
    vec3 acc = mix(vec3(1.0, 0.98, 0.94), vec3(0.92, 0.86, 1.0), 0.4)
             * exp(-r * r / (0.00018 + mag * 0.00022)) * (0.9 + mag);
    for (int k = 0; k < 3; k++) {
      float ang = 0.5235988 + float(k) * 1.0471976;
      vec2 d = vec2(cos(ang), sin(ang));
      float along = abs(dot(q, d));
      float perp = abs(dot(q, vec2(-d.y, d.x)));
      float ray = exp(-perp * 220.0) * exp(-along * 9.0);
      ray *= 0.85 + 0.15 * sin(t * 1.5 + float(k) * 2.3 + mag * 19.0);
      acc += vec3(0.90, 0.84, 1.0) * ray * mag * 0.5;
    }
    return acc;
  }

  // pinSheet: sparse violet-tinted pinpoint field for the background depth.
  vec3 pinSheet(vec2 p, float t, float seed, float density) {
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
        acc += mix(vec3(0.75, 0.72, 1.0), vec3(1.0, 0.95, 0.9), hash21(cell + seed * 3.3))
             * exp(-d * d / (0.006 + mag * 0.010)) * mag
             * (0.7 + 0.3 * sin(t * 1.8 + mag * 40.0));
      }
    }
    return acc;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.15 + uSpeed * 1.2);

    // iconZone: dims the left strip where desktop icons live.
    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.6, iconZone);

    // Background: deep purple-black with a restrained lift toward the galaxy
    // (kept dark so clumps and band stay punchy).
    float u, v;
    diskFrame(p, u, v);
    vec3 col = mix(uVoid * 0.85, uVoid * 1.45, exp(-dot(p, p) * 2.4) * 0.6);

    // Sparse violet pinpoints behind everything, then the frame-wide gas wash.
    col += pinSheet(p * 22.0 + vec2(t * 0.010, 0.0), t, 3.1, 0.30) * 0.55 * uStars * quiet;
    col += pinSheet(p * 38.0 + vec2(t * 0.016, -t * 0.007), t, 8.4, 0.34) * 0.30 * uStars * quiet;
    col += gasWash(p, t) * quiet;

    // The wind plumes go UNDER the disk light (they launch from its plane).
    col += wind(u, v, t) * mix(0.9, 1.35, uHeight) * quiet;

    // The rose loops hug the nucleus - two nested, asymmetric windows.
    vec2 pc = p - vec2(0.0, -0.10);
    col += loop(pc, 0.105, 1.1, 1.5, t) * quiet;
    col += loop(pc, 0.158, -1.9, 1.9, t) * 0.7 * quiet;

    // The disk: violet body -> white-hot nucleus.
    float disk = diskLight(u, v, t);
    vec3 diskTint = mix(vec3(0.62, 0.48, 0.80), vec3(0.88, 0.76, 0.98), exp(-u * u * 8.0));
    col += diskTint * disk * 1.15 * quiet;
    // nucleus: white-cream hot core + a wide violet bloom.
    float rn = length(pc);
    col += vec3(1.0, 0.95, 0.85) * exp(-rn * rn / 0.0012) * 1.5 * (0.94 + 0.06 * sin(t * 0.8)) * quiet;
    col += vec3(0.72, 0.55, 0.92) * exp(-rn * 9.0) * 0.45 * quiet;

    // Foreground JWST stars at hand-placed spots clear of the disk.
    vec3 fgs =
        fgStar(p, vec2(-0.315, 0.235), 0.95, t)
      + fgStar(p, vec2(0.345, -0.135), 0.70, t)
      + fgStar(p, vec2(0.02, 0.355), 0.50, t);
    col += fgs * uIntensity * quiet;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) - Tone.js space bed. Centaurus A is more wind and slightly
// denser phrases than the deep fields - the collision was busy.
export function buildAudio(api) {
  return api.interstellar({
    root: 110.00,
    scale: [220.00, 261.63, 329.63, 392.00, 440.00],
    color: 'violet',
    density: 0.50,
    sparkle: 0.35,
    wind: 0.55,
  });
}
