// theme.js (jetdisk) - an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time it is picked. A per-image replica of a NASA artist's concept of
// a young, accreting object launching a jet: a thick salmon-pink dust disk
// seen tilted about 30 degrees, its long axis running upper-left to lower-
// right; a white-hot center wrapped in fine concentric ripples; rust-orange
// filament veins threaded through the pink; a near-side bank of dark dust
// cloud rolling across the lower-left half; one thin cyan jet shooting up and
// right out of the frame, and its counter-jet hidden behind the dust until it
// reappears as a short cyan spark below the disk. The void is navy-black with
// a faint teal lean.

// id must match BOTH the folder name (themes/jetdisk/) and the "id" field of
// this theme's row in themes/index.json. theme-catalog.js builds the import()
// path from the folder name and cross-checks it against the manifest, so any
// mismatch means the theme silently never loads.
export const id = 'jetdisk';

// meta is merged into SCENE_META (scenes-meta.js) so the scene menu can show a
// name/blurb before this module is ever imported.
export const meta = {
  label: 'Jet Disk',
  blurb: 'A tilted salmon dust disk around a white-hot core — rust veins, a dark near-side dust bank, a cyan jet piercing the frame',
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

  // rot2: rotate a vector by angle a (radians, counter-clockwise).
  vec2 rot2(vec2 v, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
  }

  // ridge: ridged noise - a thin bright crease wherever vnoise crosses 0.5.
  // Stacked twice it draws the reference's branching rust filaments.
  float ridge(vec2 p) {
    float a = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    float b = 1.0 - abs(vnoise(p * 2.13 + 7.7) * 2.0 - 1.0);
    return pow(a, 6.0) * 0.65 + pow(b, 8.0) * 0.45;
  }

  // starSheet: sparse, dim pinpoints - the reference's sky is nearly empty,
  // so the density is low and the stars stay small.
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
        float size = 0.012 + mag * 0.022;
        vec3 tint = mix(vec3(0.72, 0.86, 1.0), vec3(1.0, 0.88, 0.80),
                        hash21(cell + seed * 3.3));
        acc += tint * exp(-d * d / (size * size)) * mag
             * (0.75 + 0.25 * sin(t * (0.8 + uTwinkle) + mag * 41.0));
      }
    }
    return acc;
  }

  // jetBeam: one jet in world space. 'along' is distance from the launch
  // point along the jet axis, 'perp' the signed offset across it. A hair-thin
  // white-cyan core, a wider cyan sheath that slowly flares, and bright knots
  // travelling outward (the reference's jet is beaded, not uniform). A slow
  // helical wobble keeps the beam from reading as a ruler line.
  vec3 jetBeam(float along, float perp, float t) {
    if (along <= 0.0) return vec3(0.0);
    perp += 0.0007 * sin(along * 38.0 - t * 3.0) * smoothstep(0.0, 0.3, along);
    float w = 0.0022 + along * 0.0045;
    float core = exp(-perp * perp / (w * w * 0.25));
    float sheath = exp(-perp * perp / (w * w * 5.0));
    float halo = exp(-abs(perp) / (0.02 + along * 0.02));
    float knots = vnoise(vec2(along * 26.0 - t * 5.0, 0.0));
    knots = 0.55 + 0.9 * smoothstep(0.45, 0.95, knots);
    float fade = smoothstep(0.0, 0.035, along) * exp(-along * 0.35);
    return (vec3(0.85, 1.0, 1.0) * core * 1.4 * knots
          + vec3(0.25, 0.92, 0.88) * sheath * 0.65 * knots
          + vec3(0.10, 0.55, 0.60) * halo * 0.10) * fade;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.05 + uSpeed * 0.5);

    // iconZone: dims the left strip where desktop icons live.
    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.6, iconZone);

    // The launch point: a touch left of center and slightly high, as framed
    // in the reference (the disk fills the left two thirds of the frame).
    vec2 c = vec2(-0.17, 0.0);
    vec2 d = p - c;

    // Background: navy-black, faint teal haze low-left where the counter-jet
    // lights the dust from behind.
    vec3 col = uVoid * 0.9;
    col += vec3(0.02, 0.07, 0.09) * exp(-length(p - vec2(-0.35, -0.45)) * 2.6);
    col += starSheet(p * 22.0 + vec2(t * 0.006, 0.0), t, 3.1, 0.18) * 0.45 * uStars * quiet;
    col += starSheet(p * 40.0 + vec2(0.0, t * 0.004), t, 8.4, 0.22) * 0.25 * uStars * quiet;

    // --- the disk -------------------------------------------------------
    // Disk frame: rotate so x runs along the long axis (tilted ~30 deg down
    // to the right), then stretch y so the tilted circle becomes round.
    // uHeight puffs the disk (thicker = more face-on).
    float tilt = 0.52;
    vec2 q = rot2(d, tilt);
    float squash = 0.60 + uHeight * 0.08;
    vec2 qc = vec2(q.x, q.y / squash);
    float r = length(qc);
    float phi = atan(qc.y, qc.x);

    // Keplerian swirl: inner material laps faster. The pattern coordinates
    // are taken in a frame rotated by -omega(r)*t, so streaks wind up gently.
    float omega = 0.16 / (0.08 + r);
    vec2 sw = rot2(qc, -t * omega - log(r + 0.02) * 1.25);

    // Puffy, ragged outline: fbm pushes the edge in and out.
    float edgeN = fbm(sw * 3.2 + vec2(t * 0.02, 0.0));
    float R = 0.52 + (edgeN - 0.5) * 0.16;
    float body = exp(-pow(r / R, 2.6));

    // Banded, wound structure inside: fbm in swirl space, stretched along
    // the orbit so it reads as concentric rings and spiral arms.
    vec2 polar = vec2(phi * 1.6 + log(r + 0.02) * 2.2 - t * omega, r * 9.0);
    float bands = fbm(vec2(polar.x * 1.3, polar.y * 1.9) + sw * 1.5);
    float mist = fbm(sw * 6.0 + 3.0);

    // Pink body: pale cream toward the center, salmon further out, a dusky
    // rose at the ragged rim.
    vec3 rim = vec3(0.62, 0.30, 0.30);
    vec3 salmon = vec3(1.00, 0.62, 0.55);
    vec3 cream = vec3(1.00, 0.90, 0.84);
    vec3 diskCol = mix(rim, salmon, smoothstep(0.62, 0.26, r));
    diskCol = mix(diskCol, cream, smoothstep(0.24, 0.05, r));
    float lum = body * (0.55 + 0.55 * bands) * (0.85 + 0.3 * mist);
    col += diskCol * lum * 1.15 * quiet;

    // Rust veins: branching ridged filaments, strongest in the middle ring
    // of the disk, darkening the pink toward burnt orange.
    float veinZone = smoothstep(0.08, 0.20, r) * smoothstep(0.60, 0.32, r);
    float veins = ridge(sw * 7.5 + vec2(bands * 1.6, 0.0));
    vec3 rust = vec3(0.70, 0.26, 0.10);
    col = mix(col, rust * body * 1.05, clamp(veins * veinZone * body * 0.75, 0.0, 0.55));
    // tiny grit: speckled darker dust along the veins.
    float grit = step(0.82, hash21(floor(sw * 180.0))) * veins * veinZone;
    col *= 1.0 - grit * 0.35 * body;

    // Center: white-hot point, a soft cream bloom, and faint concentric
    // ripples in the disk plane (the reference's little whirlpool at the core).
    float rc = length(qc);
    col += vec3(1.0, 0.98, 0.95) * exp(-rc * rc / 0.00035) * 1.6 * uIntensity;
    col += vec3(1.0, 0.86, 0.80) * exp(-rc * rc / 0.006) * 0.55;
    float ripple = 0.5 + 0.5 * sin(rc * 170.0 - t * 6.0);
    col += vec3(0.95, 0.92, 0.95) * ripple * exp(-rc / 0.035) * smoothstep(0.004, 0.015, rc) * 0.22;

    // --- near-side dust bank -------------------------------------------
    // The lower-left half of the disk is swallowed by a rolling dark cloud
    // in front of it. The mask is a soft half-plane whose edge runs a little
    // below the core, sloping gently down to the right (flatter than the
    // disk's own axis), ragged with billowing fbm.
    vec2 cl = d * 3.4 + vec2(t * 0.015, -t * 0.008);
    float billow = fbm(cl + fbm(cl * 1.7 + 4.0) * 0.8);
    float side = -(dot(d, normalize(vec2(0.26, 1.0))) + 0.02) * 5.0;
    float dust = smoothstep(0.0, 0.55, side + (billow - 0.5) * 1.7);
    dust *= 1.0 - smoothstep(0.60, 1.20, length(d - vec2(-0.05, -0.30)));
    // the dust itself catches a little pink from the disk behind it.
    vec3 dustCol = vec3(0.20, 0.10, 0.10) * (0.4 + 1.1 * billow * billow) * body;
    col = mix(col, dustCol + uVoid * 0.6, clamp(dust * 0.94, 0.0, 0.95));
    // the thin cloud tops catch the glow: a soft rose rim along the edge.
    col += vec3(0.55, 0.30, 0.30) * dust * (1.0 - dust) * 1.2 * body * quiet;

    // --- the jets -------------------------------------------------------
    // Axis: steep, leaning right (the reference's jet leaves the frame near
    // the top edge just right of center). Not perpendicular to the drawn
    // disk axis - the tilt of a thick disk foreshortens it that way.
    vec2 ja = normalize(vec2(0.40, 0.92));
    vec2 jn = vec2(-ja.y, ja.x);
    float along = dot(d, ja);
    float perp = dot(d, jn);
    float jetGain = 0.8 + 0.4 * uIntensity;
    col += jetBeam(along, perp, t) * jetGain * quiet;
    // counter-jet: same beam flipped, fully hidden by disk and dust until it
    // emerges below the cloud as a short spark near the bottom edge.
    float back = smoothstep(0.40, 0.50, -along) * (1.0 - dust * 0.8);
    col += jetBeam(-along, -perp, t + 11.0) * back * 0.9 * jetGain * quiet;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) - Tone.js space bed. A low, breathing E drone for the disk
// with a sparse, bright upper figure for the jet.
export function buildAudio(api) {
  return api.interstellar({
    root: 82.41,
    scale: [164.81, 185.00, 207.65, 246.94, 277.18, 329.63],
    color: 'warm',
    density: 0.30,
    sparkle: 0.30,
    wind: 0.26,
    echo: true,
  });
}
