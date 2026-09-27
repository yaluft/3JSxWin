// theme.js (lensfield) - an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time it is picked. A tribute to JWST's frontier fields (SMACS 0723 and
// friends): a massive galaxy cluster sits foreground-center, and the deep field
// behind it is seen THROUGH curved spacetime. The lensing is real math, not a
// painted effect - background galaxy positions are sampled through the
// point-mass deflection formula, so near the Einstein radius they stretch into
// tangential arcs, and inside it their images flip, exactly like the real thing.

// id must match BOTH the folder name (themes/lensfield/) and the "id" field of
// this theme's row in themes/index.json. theme-catalog.js builds the import()
// path from the folder name and cross-checks it against the manifest, so any
// mismatch means the theme silently never loads.
export const id = 'lensfield';

// meta is merged into SCENE_META (scenes-meta.js) so the scene menu can show a
// name/blurb before this module is ever imported. label = the dropdown text,
// blurb = the one-line description under it. silent:true = quiet by design: the
// space engine keeps this scene deep and slow.
export const meta = {
  label: 'Gravitational Lens',
  blurb: 'A JWST frontier field - a cluster warping spacetime, galaxies smeared into Einstein arcs',
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

  // rot2: standard 2D rotation by angle a. Gives each galaxy its own position
  // angle on the sky.
  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  // lens: THE physics. Given screen point p and a cluster at c with Einstein
  // radius thetaE, return the point on the sky whose light reaches p. The
  // point-mass/SIS deflection: alpha = thetaE^2 / r, aimed back at the mass.
  //   r >> thetaE  -> deflection is tiny, sky looks flat.
  //   r ~ thetaE   -> sources at that ring are stretched into tangential arcs.
  //   r < thetaE   -> the deflection exceeds r: the sampled point crosses the
  //                   center and images MIRROR - the inverted second image real
  //                   lenses produce inside the Einstein radius.
  vec2 lens(vec2 p, vec2 c, float thetaE) {
    vec2 q = p - c;
    float r = max(length(q), 1e-4);
    return p - (q / r) * (thetaE * thetaE / r);
  }

  // galaxyColor: deep-field palette. Background sources are cooler and dimmer
  // than Webb Mirror's field (they are the far, lensed crowd): blue-white to
  // gold, with rust rare.
  vec3 galaxyColor(float r) {
    if (r < 0.4) {
      return mix(vec3(0.62, 0.72, 1.00), vec3(0.85, 0.85, 0.95), r / 0.4);   // blue-white
    } else if (r < 0.8) {
      return mix(vec3(0.85, 0.85, 0.95), vec3(1.00, 0.80, 0.42), (r - 0.4) / 0.4); // -> gold
    }
    return mix(vec3(1.00, 0.80, 0.42), vec3(0.72, 0.40, 0.20), (r - 0.8) / 0.2);   // gold -> rust
  }

  // bgField: one layer of the background deep field. Note it takes PRE-WARPED
  // coordinates - main() samples it through lens(), which is the whole trick.
  // Elongated gaussian smudges like webbmirror's galaxySheet, but smaller and
  // dimmer; the warp does the arc-making.
  vec3 bgField(vec2 p, float t, float seed, float density) {
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
        vec2 q = rot2(f - pos, roll * 6.2831 + t * 0.03 * (roll - 0.5));
        q.y /= mix(1.0, 3.6, hash21(cell + seed * 13.7));
        float d = length(q);
        float size = 0.035 + mag * 0.085;
        float body = exp(-d * d / (size * size));
        acc += galaxyColor(roll) * body * mag * (0.5 + 0.5 * sin(t * 0.35 + roll * 20.0));
      }
    }
    return acc;
  }

  // clusterGalaxy: one big elliptical of the foreground cluster. Smooth golden
  // blob with fbm mottling and a soft de Vaucouleurs-ish fall-off (exp of sqrt),
  // no sharp edge, no glow - just a luminous old population. Returns rgb.
  vec3 clusterGalaxy(vec2 p, vec2 c, float r, float a, vec3 tint, float t, float seed) {
    vec2 q = rot2(p - c, a);
    q.y /= 1.45;                                   // ellipticity
    float d = length(q) / max(r, 1e-4);
    if (d > 2.2) return vec3(0.0);
    float profile = exp(-pow(d, 0.62) * 2.6);      // steep core, long tail
    float mottle = 0.9 + 0.1 * fbm(q * 14.0 + seed * 7.0 + vec2(t * 0.02, 0.0));
    return tint * profile * mottle;
  }

  void main() {
    // p: aspect-corrected coordinates, roughly -0.5..0.5 on the short axis.
    // t: scene clock; the 0.04 floor keeps the field drifting at uSpeed 0.
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.04 + uSpeed * 0.45);

    // iconZone: dims the left strip where desktop icons live.
    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.62, iconZone);

    // The cluster sits right-of-centre (away from the icon column) and drifts
    // a hair over minutes. thetaE is its Einstein radius in screen units.
    vec2 cluster = vec2(aspect * 0.28 + 0.010 * sin(t * 0.05), 0.02 + 0.008 * cos(t * 0.04));
    float thetaE = 0.17 + uHeight * 0.05;

    // Background: near-void with a slight tide lift.
    vec3 col = mix(uVoid, uTide * 0.28, smoothstep(-0.6, 0.9, p.y));

    // The lensed deep field: sample the background layers at DEFLECTED
    // coordinates. Every arc you see near the cluster is the cell noise being
    // genuinely bent by the lens() term - nothing here draws an arc by hand.
    vec2 lp = lens(p, cluster, thetaE);
    vec3 field =
        bgField(lp * 15.0 + vec2(t * 0.010, 0.0), t, 1.3, 0.85) * 0.9
      + bgField(lp * 31.0 + vec2(t * 0.018, -t * 0.005), t, 4.7, 0.88) * 0.62
      + bgField(lp * 60.0 + vec2(t * 0.028, 0.0), t, 9.2, 0.90) * 0.4;
    col += field * uStars * quiet;

    // Faint critical-curve sheen: a whisper of light along the Einstein radius
    // where the arcs pile up. Barely there - the arcs themselves carry the idea.
    float rLens = length(p - cluster);
    col += vec3(1.0, 0.88, 0.62) * exp(-abs(rLens - thetaE) * 26.0) * 0.05 * uIntensity;

    // The foreground cluster: a brightest-cluster-galaxy at the mass centre
    // plus seven satellites scattered around it, each on its own slow wobble
    // (they are bound, not drifting away). Golden old populations throughout.
    vec3 clusterLight = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      vec2 c = cluster + vec2(
        (hash21(vec2(fi, 3.1)) - 0.5) * 0.46,
        (hash21(vec2(fi, 7.7)) - 0.5) * 0.30
      ) + vec2(cos(t * 0.05 + fi * 1.7), sin(t * 0.05 + fi * 1.7)) * 0.006;
      float rad = (i == 0) ? 0.075 : 0.014 + hash21(vec2(fi, 11.3)) * 0.030;
      float ang = hash21(vec2(fi, 15.9)) * 6.2831 + t * 0.02 * (hash21(vec2(fi, 19.3)) - 0.5);
      float warm = hash21(vec2(fi, 23.7));
      vec3 tint = mix(vec3(1.00, 0.86, 0.55), vec3(0.95, 0.66, 0.32), warm);
      float gain = (i == 0) ? 1.0 : 0.55 + 0.45 * hash21(vec2(fi, 27.5));
      clusterLight += clusterGalaxy(p, c, rad, ang, tint, t, fi) * gain;
    }
    col += clusterLight * uIntensity * quiet;

    // A few far background stars, untouched by the lens tweak at their scale -
    // tiny pinpricks so the void between galaxies is not empty.
    vec2 sp = p;
    vec2 ip = floor(sp * 90.0), fp = fract(sp * 90.0);
    vec3 pin = vec3(0.0);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = ip + o;
        float present = step(0.93, hash21(cell + 31.7));
        vec2 pos = o + hash22(cell + 2.4);
        float mag = hash21(cell + 8.8);
        pin += present * (0.3 + 0.7 * mag) * (0.6 + 0.4 * sin(t * 1.3 + mag * 31.0))
             * vec3(0.85, 0.88, 1.0) * smoothstep(0.05 + mag * 0.05, 0.0, length(fp - pos));
      }
    }
    col += pin * uStars * 0.5 * quiet;

    // finish() (from COMMON) applies the shared vignette + film grain and
    // clamps. Opaque pixel.
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) - Tone.js space bed. Deep D-root drone; phrases answered by
// their own "lensed image" an octave down.
export function buildAudio(api) {
  return api.interstellar({
    root: 73.42,
    scale: [146.83, 174.61, 220.00, 293.66, 349.23],
    color: 'violet',
    density: 0.33,
    sparkle: 0.35,
    wind: 0.28,
    echo: true,
  });
}
