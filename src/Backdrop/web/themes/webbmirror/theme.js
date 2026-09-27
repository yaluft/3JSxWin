// theme.js (webbmirror) — an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time it is picked. A tribute to the James Webb Space Telescope's deep
// field imagery: a sky packed with tens of thousands of tiny golden galaxies,
// and bright stars rendered the way Webb renders them — HEXAGONAL bokeh with six
// long diffraction spikes, the fingerprint of its 18 gold-coated hexagonal
// mirror segments. A whisper of the honeycomb primary mirrors the whole frame.

// id must match BOTH the folder name (themes/webbmirror/) and the "id" field of
// this theme's row in themes/index.json. theme-catalog.js builds the import()
// path from the folder name and cross-checks it against the manifest, so any
// mismatch means the theme silently never loads.
export const id = 'webbmirror';

// meta is merged into SCENE_META (scenes-meta.js) so the scene menu can show a
// name/blurb before this module is ever imported. label = the dropdown text,
// blurb = the one-line description under it. silent:true = quiet by design: the
// space engine gives this scene a golden, glinting reading.
export const meta = {
  label: 'Webb Mirror',
  blurb: 'A JWST deep field - hex-bokeh stars, six diffraction spikes, ten thousand golden galaxies',
  silent: true,
};

// kind:'shader' means "this theme is only a fragment". scenes.js pastes the
// COMMON preamble from shader-lib.js (precision, all the uXxx uniforms,
// hash21/vnoise/fbm/finish) in front of the string below, then runs the result
// on one full-screen PlaneGeometry(2,2) quad. So everything here can assume
// hash21/fbm/finish and every uniform (uVoid, uTide, uTime, uIntensity, ...)
// already exist.
export const kind = 'shader';

export const fragment = /* glsl */ `
  // hash22: 2D -> 2D random. hash21 (from COMMON) only gives one random float,
  // but we need a random XY offset to scatter things inside their grid cell.
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  // rot2: standard 2D rotation by angle a. Used to give each galaxy its own
  // position angle on the sky.
  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  // hexDist: the hexagon signed distance, flat-top convention. max of the three
  // half-plane distances; evaluate on |p| so all six sides are covered. This one
  // function is the whole "Webb look" - star cores drawn with it come out as the
  // telescope's hexagonal bokeh, and the honeycomb overlay is its edge set.
  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, vec2(0.5, 0.8660254)), p.x);
  }

  // galaxyColor: maps a 0..1 random onto the Webb deep-field galaxy palette.
  // Most galaxies are warm (gold -> amber -> rust, the redshifted crowd); a
  // lucky few roll cool blue-white (the nearby, bright ones). The mix chain is
  // tuned so gold dominates roughly 2/3 of the time.
  vec3 galaxyColor(float r) {
    if (r < 0.55) {
      return mix(vec3(1.00, 0.80, 0.38), vec3(0.95, 0.60, 0.22), r / 0.55);      // gold -> amber
    } else if (r < 0.85) {
      return mix(vec3(0.95, 0.60, 0.22), vec3(0.72, 0.36, 0.16), (r - 0.55) / 0.30); // amber -> rust
    }
    return mix(vec3(0.72, 0.36, 0.16), vec3(0.72, 0.80, 1.00), (r - 0.85) / 0.15);   // rust -> blue-white
  }

  // galaxySheet: one layer of the deep field. Cell noise like the star sheets in
  // the other themes, but every present cell is a GALAXY: an elliptical gaussian
  // smudge with its own rotation, elongation, size and palette roll. At the
  // finest scales this reads as the uncountable sprinkle of the Webb deep
  // field; at the coarse scale, individual smudges resolve.
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
        float roll = hash21(cell + seed * 9.31);      // palette roll
        float mag = hash21(cell + seed * 3.7);        // brightness class
        mag *= mag;                                    // mostly dim, a few bright
        // Shape: each galaxy is an ellipse - rotate the offset into the
        // galaxy's own frame, then squash one axis. scale 0.6..1.0 keeps them
        // smudges, not blobs.
        vec2 q = rot2(f - pos, roll * 6.2831 + t * 0.02 * (roll - 0.5));
        q.y /= mix(1.0, 3.2, hash21(cell + seed * 13.7));   // elongation
        float d = length(q);
        float size = 0.045 + mag * 0.10;
        float body = exp(-d * d / (size * size));
        // Slow surface shimmer via fbm keyed to the galaxy (cheap: one octave
        // of vnoise in COMMON rather than full fbm).
        float grain = 0.85 + 0.15 * vnoise(q * 24.0 + seed);
        // Faint disk halo on the brightest only - Webb galaxies have no bloom.
        acc += galaxyColor(roll) * body * mag * grain * (0.55 + 0.45 * sin(t * 0.4 + roll * 20.0));
      }
    }
    return acc;
  }

  // webbStar: the signature. One bright star as Webb draws it:
  //   - a HEXAGONAL core (hexDist mask), gold-white,
  //   - SIX diffraction spikes: three axes (at 30/90/150 degrees, matching the
  //     hexagon's edges) each contributing two opposite rays, thin exponential
  //     blades that fade with distance from the star,
  //   - a tiny inner highlight dot for the "hot" center.
  // Returns the additive light of the star at this pixel.
  vec3 webbStar(vec2 f, vec2 pos, float mag, float t) {
    vec2 q = f - pos;
    vec3 acc = vec3(0.0);
    // Hexagonal bokeh core. mag scales the radius; 0.5 is hexDist's in-radius.
    float hr = 0.030 + mag * 0.055;
    float hex = 1.0 - smoothstep(hr * 0.86, hr, hexDist(q));
    // Gold-white body: hottest at the center, gold at the rim.
    vec3 core = mix(vec3(1.0, 0.95, 0.82), vec3(1.0, 0.72, 0.28), smoothstep(0.0, hr, hexDist(q)));
    acc += core * hex * (0.35 + mag * 0.9);
    // The six spikes: axis directions at 30 + k*60 degrees. For each axis the
    // ray runs BOTH ways (abs(along)), thin in the perpendicular (exp falloff),
    // long along itself, and only for brighter stars (mag > 0.45).
    if (mag > 0.45) {
      float spikeGain = (mag - 0.45) / 0.55;            // 0..1
      for (int k = 0; k < 3; k++) {
        float ang = 0.5235988 + float(k) * 1.0471976;   // 30deg + k*60deg
        vec2 d = vec2(cos(ang), sin(ang));
        float along = abs(dot(q, d));
        float perp = abs(dot(q, vec2(-d.y, d.x)));
        float ray = exp(-perp * 130.0) * exp(-along * 3.2);
        // Slight taper asymmetry via a slow twinkle so the blades shimmer.
        ray *= 0.8 + 0.2 * sin(t * 0.9 + float(k) * 2.1 + mag * 31.0);
        acc += vec3(1.0, 0.85, 0.55) * ray * spikeGain * 0.55;
      }
    }
    return acc;
  }

  // starSheetWebb: cell layer where present cells are WEBB STARS - the coarse
  // layers get the full hex+spike treatment; a per-cell magnitude decides who
  // is bright enough to spike.
  vec3 starSheetWebb(vec2 p, float t, float seed, float density) {
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
        acc += webbStar(f, pos, mag, t) * present;
      }
    }
    return acc;
  }

  // honey: the faint honeycomb of the 18-segment primary mirror. Standard
  // hex-grid trick: two interleaved rectangular sublattices, pick the nearer
  // cell center, measure hexDist - near an edge means near a segment seam.
  // Returned as a 0..1 seam mask to be tinted gold at whisper level.
  float honey(vec2 p, float scale) {
    p *= scale;
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    float d = hexDist(gv);
    return smoothstep(0.46, 0.5, d);   // 1 at the seam, 0 inside a segment
  }

  void main() {
    // p: aspect-corrected coordinates, roughly -0.5..0.5 on the short axis.
    // t: scene clock; the 0.05 floor keeps the field drifting at uSpeed 0.
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.05 + uSpeed * 0.5);

    // iconZone: dims the left strip where desktop icons live.
    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.6, iconZone);

    // Background: near-void with a barely-there tide lift toward the top.
    vec3 col = mix(uVoid, uTide * 0.30, smoothstep(-0.6, 0.9, p.y));

    // The deep field: three galaxy layers, near/coarse to far/fine, each with
    // its own parallax drift. uStars scales the lot, uIntensity is carried by
    // the star layer below so the brightness slider reads on the marquee item.
    vec3 field =
        galaxySheet(p * 14.0 + vec2(t * 0.012, 0.0), t, 1.3, 0.85) * 0.85
      + galaxySheet(p * 30.0 + vec2(t * 0.020, -t * 0.006), t, 4.7, 0.88) * 0.6
      + galaxySheet(p * 58.0 + vec2(t * 0.032, 0.0), t, 9.2, 0.90) * 0.38;
    col += field * uStars * quiet;

    // The Webb stars: two layers. Coarse (rare, big, full hex+spikes) and mid
    // (more, smaller). This is what the intensity slider should own.
    vec3 stars =
        starSheetWebb(p * 9.0 + vec2(t * 0.006, 0.0), t, 2.2, 0.16) * 1.0
      + starSheetWebb(p * 17.0 + vec2(t * 0.010, 0.0), t, 6.6, 0.22) * 0.55;
    col += stars * uIntensity * quiet;

    // The honeycomb whisper: gold segment seams over everything, faint enough
    // to read as texture rather than pattern, drifting a touch slower than the
    // field so the mirror feels like it is in front of the sky.
    col += vec3(1.0, 0.78, 0.38) * honey(p + vec2(t * 0.004, 0.0), 9.0) * 0.030;

    // finish() (from COMMON) applies the shared vignette + film grain and
    // clamps. Opaque pixel.
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) - Tone.js space bed. Webb Mirror plays it GOLDEN: E-root
// drone, bright phrases, lots of high sparkle like starlight off a mirror.
export function buildAudio(api) {
  return api.interstellar({
    root: 82.41,
    scale: [164.81, 207.65, 246.94, 329.63, 369.99, 415.30],
    color: 'gold',
    density: 0.40,
    sparkle: 0.70,
    wind: 0.22,
  });
}
