// theme.js (starnode) — an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time the user picks it. Pure fragment shader: a handful of suns drawn as
// linked graph nodes, one of them a textured star at the centre with a little
// planetary system orbiting it, all over a drifting starfield. buildAudio()
// gives it a space reading: each phrase answered by a soft echo, like a
// signal passing between the nodes.

// id must match BOTH the folder name (themes/starnode/) and the "id" field of this
// theme's row in themes/index.json. theme-catalog.js builds the import() path from
// the folder name and cross-checks it against the manifest, so any mismatch means
// the theme silently never loads.
export const id = 'starnode';

// meta is merged into SCENE_META (scenes-meta.js) so the scene menu can show a
// name/blurb before this module is ever imported. label = the dropdown text,
// blurb = the one-line description under it. silent:true = quiet by design; the
// space engine keeps this scene to a drone and sparse, echoed phrases.
export const meta = {
  label: 'Star Node',
  blurb: 'A stellar neighborhood — suns as linked nodes, one local system turning among them',
  silent: true,
};

// kind:'shader' means "this theme is only a fragment". scenes.js pastes the COMMON
// preamble from shader-lib.js (precision, all the uXxx uniforms, hash21/vnoise/fbm/
// finish) in front of the string below, then runs the result on a single full-screen
// PlaneGeometry(2,2) quad. So everything here can assume hash21/fbm/finish and every
// uniform (uVoid, uTide, uTime, uIntensity, ...) already exist.
export const kind = 'shader';

export const fragment = /* glsl */ `
  // 2D rotation by angle a. Only used to spin the central star's surface texture
  // over time so its fbm noise drifts instead of sitting frozen.
  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  // Multi-scale twinkling starfield, the same cellular-noise trick every space
  // theme here uses: chop the plane into a grid, maybe drop one star per cell,
  // and for the 3x3 cells around the current fragment sum a soft core dot.
  //   density  — 0..1 chance a given cell holds a star (higher = busier sky)
  //   seed     — offsets every hash so stacked calls don't line up
  //   mag      — per-star brightness / size, also detunes its twinkle rate
  //   tw       — slow sine twinkle, 0.6..1.0, so stars breathe rather than blink
  // Called three times in main() at rising frequencies for a mix of star sizes.
  float starLayer(vec2 p, float t, float seed, float density) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float acc = 0.0;
    // Walk the 3x3 block of cells around this fragment. A star can sit anywhere in
    // its cell, so a star near a cell edge still lights pixels in the neighbour.
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        // present: 1 only for cells whose hash clears the density threshold.
        // mag / pos: this star's brightness and its jittered position in the cell.
        float present = step(1.0 - density, hash21(cell + seed * 5.17));
        float mag = hash21(cell + seed * 9.31);
        vec2 pos = o + vec2(hash21(cell + seed), hash21(cell + seed * 2.7));
        float tw = 0.6 + 0.4 * sin(t * (1.2 + mag * 3.0) + mag * 6.28);
        // core: smoothstep from a tiny radius down to 0 = a soft round dot,
        // brighter stars (mag) drawn slightly larger. No halo here, unlike the
        // brighter space themes — Star Node keeps its background restrained.
        float d = length(f - pos);
        float core = smoothstep(0.03 + mag * 0.03, 0.0, d);
        acc += present * mag * tw * core;
      }
    }
    return acc;
  }

  // Distance-field line segment from a to b, returned as a 0..1 mask that is 1 on
  // the line and fades to 0 at 'thick'. h projects p onto the segment (clamped to
  // its ends), then we measure how far p is from that closest point. This is what
  // draws the glowing links between the star nodes.
  float segment(vec2 p, vec2 a, vec2 b, float thick) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
    return smoothstep(thick, 0.0, length(pa - ba * h));
  }

  // A cheap lit sphere for a node (a sun or an orbiting planet). We never store a
  // real z — reconstruct the hemisphere normal from the 2D offset: z = sqrt(1 - x^2
  // - y^2), so the fake normal bulges toward the viewer at the centre of the disc.
  // Lambert term (n dot light), raised to 0.85 to soften the terminator, then a
  // small 0.08 ambient floor so the dark side isn't pure black. Alpha is the disc
  // mask with a ~1.5px smoothstep edge for anti-aliasing.
  vec4 nodeBody(vec2 p, vec2 c, float r, vec3 col, vec3 light) {
    vec2 off = p - c;
    float d = length(off);
    float mask = 1.0 - smoothstep(r - 0.0015, r + 0.0015, d);
    vec2 n2 = off / max(r, 1e-4);
    float z = sqrt(max(0.0, 1.0 - dot(n2, n2)));
    vec3 n = vec3(n2, z);
    float diff = pow(clamp(dot(n, light), 0.0, 1.0), 0.85);
    vec3 lit = col * (0.08 + 0.92 * diff);
    return vec4(lit, mask);
  }

  // Position of node i at time t. Node 0 is the local sun, pinned at the origin;
  // nodes 1-5 are the neighbouring suns, each on its own slow near-circular orbit
  // (different radius, speed and phase). 'tilt' squashes the y axis so every orbit
  // reads as an ellipse seen at an angle rather than face-on. GLSL ES 2.0 can't
  // index an array by a non-constant, hence the if-ladder (same pattern as nodeCol
  // / nodeRad below).
  vec2 nodePos(int i, float t, float tilt) {
    if (i == 0) return vec2(0.0, 0.0);
    if (i == 1) return vec2(0.42 * cos(t * 0.11 + 0.4), 0.42 * sin(t * 0.11 + 0.4) * tilt);
    if (i == 2) return vec2(0.58 * cos(t * 0.07 + 2.1), 0.58 * sin(t * 0.07 + 2.1) * tilt);
    if (i == 3) return vec2(-0.50 * cos(t * 0.09 + 3.6), 0.50 * sin(t * 0.09 + 3.6) * tilt);
    if (i == 4) return vec2(0.72 * cos(t * 0.05 + 5.2), 0.72 * sin(t * 0.05 + 5.2) * tilt);
    return vec2(-0.68 * cos(t * 0.06 + 1.2), -0.62 * sin(t * 0.06 + 1.2) * tilt);
  }

  // Per-node colour. Warm gold for the home sun (0), then a cool blue, orange,
  // green and violet for the neighbours so the graph reads as a real stellar mix
  // rather than one repeated dot. These are literal RGB, not palette uniforms, so
  // the star colours stay stable across palette swaps.
  vec3 nodeCol(int i) {
    if (i == 0) return vec3(1.00, 0.86, 0.52);
    if (i == 1) return vec3(0.72, 0.82, 1.00);
    if (i == 2) return vec3(1.00, 0.62, 0.42);
    if (i == 3) return vec3(0.62, 0.92, 0.78);
    if (i == 4) return vec3(0.82, 0.70, 1.00);
    return vec3(0.95, 0.78, 0.58);
  }

  // Per-node radius in the same -0.5..0.5 space as p. Node 0 (the home sun) is the
  // biggest at 0.048; the neighbour suns are much smaller dots so the local system
  // stays the focus.
  float nodeRad(int i) {
    if (i == 0) return 0.048;
    if (i == 1) return 0.018;
    if (i == 2) return 0.022;
    if (i == 3) return 0.016;
    if (i == 4) return 0.020;
    return 0.015;
  }

  void main() {
    // p: centred, aspect-corrected coords, roughly -0.5..0.5 on the short axis and
    // wider on x. Everything (nodes, orbits, links) is authored in this space.
    // t: scene clock. The 0.08 floor keeps the graph drifting even at uSpeed 0.
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.08 + uSpeed * 0.55);
    // tilt < 1 squashes y so circular orbits look like ellipses viewed at an angle.
    // pt is p with that squash undone, so length(pt) is a true radius — used for the
    // concentric orbit rings around the home sun.
    float tilt = 0.52;
    vec2 pt = vec2(p.x, p.y / tilt);

    // Background: a faint vertical gradient from uVoid up into uTide, knocked down
    // to 55% so the sky stays dark and the nodes pop.
    vec3 col = mix(uVoid, uTide, 0.18 + 0.10 * uv.y) * 0.55;

    // Three starfield layers at rising frequency, each drifting slightly on x at a
    // different rate for a weak parallax. The finest layer leans faintly toward
    // uIris so the far field has a colour shift, not just a size shift. uStars
    // (from config) scales the lot; uFrost tints the near layers to the palette's
    // highlight colour.
    float stars0 = starLayer(p * 26.0 + vec2(t * 0.01, 0.0), t, 1.3, 0.28) * 0.55;
    float stars1 = starLayer(p * 52.0 - vec2(t * 0.02, 0.0), t, 4.7, 0.32) * 0.38;
    float stars2 = starLayer(p * 90.0, t, 8.2, 0.36) * 0.22;
    col += (uFrost * (stars0 + stars1) + mix(uFrost, uIris, 0.3) * stars2) * uStars;

    // Sample all six node positions once up front so the link segments and the
    // node-draw loop below share the exact same coordinates this frame.
    vec2 n0 = nodePos(0, t, tilt);
    vec2 n1 = nodePos(1, t, tilt);
    vec2 n2 = nodePos(2, t, tilt);
    vec2 n3 = nodePos(3, t, tilt);
    vec2 n4 = nodePos(4, t, tilt);
    vec2 n5 = nodePos(5, t, tilt);

    // The graph edges. Six hand-picked links: the home sun (n0) is the hub with
    // three spokes, then a couple of node-to-node links form a loose web. Each
    // segment() returns a thin mask; we sum them and tint with an iris->frost mix,
    // scaled by uIntensity so the "brightness" slider dims the whole network.
    // The whole web breathes on a slow sine (0.85..1.0, ~7 s period) so the
    // network feels like it's carrying traffic without any one link flickering.
    float link = 0.0;
    link += segment(p, n0, n1, 0.0024);
    link += segment(p, n0, n2, 0.0020);
    link += segment(p, n0, n3, 0.0020);
    link += segment(p, n1, n4, 0.0016);
    link += segment(p, n2, n5, 0.0016);
    link += segment(p, n3, n5, 0.0014);
    col += mix(uIris, uFrost, 0.35) * link * 0.55 * uIntensity * (0.85 + 0.15 * sin(t * 0.9));

    // Four concentric orbit rings around the home sun. abs(radius - r) is the
    // distance to a ring of radius r; smoothstep turns that into a hairline circle.
    // Drawn in the un-squashed pt space so the rings themselves stay circular even
    // though the planets riding them (below) move on tilted ellipses. The inner
    // rings are a touch brighter than the outer ones — they read as nearer.
    for (int i = 0; i < 4; i++) {
      float r = 0.10 + float(i) * 0.045;
      float dOrbit = abs(length(pt) - r);
      col += mix(uIris, uFrost, 0.4) * smoothstep(0.0032, 0.0, dOrbit) * (0.26 - float(i) * 0.025) * uIntensity;
    }

    // Fixed key light, pointing up-left and toward the viewer, shared by every lit
    // body so the whole scene is consistently shaded.
    vec3 light = normalize(vec3(-0.15, 0.20, 0.70));

    // Draw the six star nodes. uHeight nudges every node radius +/-15%.
    for (int i = 0; i < 6; i++) {
      vec2 c = nodePos(i, t, tilt);
      float rad = nodeRad(i) * (0.85 + 0.15 * uHeight);
      vec3 base = nodeCol(i);
      if (i == 0) {
        // Node 0 is the home sun: not a lit sphere but a flat emissive disc with an
        // fbm surface texture that slowly rotates (rot2 by t*0.25), mixing a deep
        // orange into a pale yellow so it churns like a real star's photosphere.
        // A restrained exp() halo (a quarter the strength of Solar System's
        // corona) warms the space just around the disc — enough to feel like a
        // star, not enough to count as "glow".
        float d = length(p - c);
        float disc = 1.0 - smoothstep(rad - 0.003, rad + 0.003, d);
        vec2 suv = rot2(p - c, t * 0.25) * 16.0;
        vec3 coreCol = mix(vec3(1.0, 0.70, 0.28), vec3(1.0, 0.94, 0.72), fbm(suv));
        col = mix(col, coreCol, disc);
        col += vec3(1.0, 0.82, 0.45) * exp(-d * 34.0) * 0.22 * uIntensity;
      } else {
        // Neighbour suns: a small lit sphere via nodeBody, then a travelling
        // "data packet" bead. packet is a 0..1 sawtooth (fract of time) that we
        // lerp from the hub n0 to this node, so a dot slides along the link and
        // loops; pulse gives it a per-node brightness throb.
        vec4 body = nodeBody(p, c, rad, base, light);
        col = mix(col, body.rgb, body.a);
        float pulse = 0.55 + 0.45 * sin(t * (1.4 + float(i) * 0.7) + float(i));
        float packet = fract(t * 0.35 + float(i) * 0.17);
        vec2 from = n0;
        vec2 to = c;
        vec2 along = mix(from, to, packet);
        float bead = smoothstep(0.012, 0.0, length(p - along)) * pulse;
        col += base * bead * 0.65;
      }
    }

    // The local planetary system: four little worlds orbiting the home sun on the
    // rings drawn earlier. Inner planets move faster (spd falls with i). Each gets
    // its own colour pulled mostly from the palette (verdant / iris / tide / frost
    // mixes) with one hard-coded rusty world, then is drawn as a tiny lit sphere.
    for (int i = 0; i < 4; i++) {
      float r = 0.10 + float(i) * 0.045;
      float spd = 1.35 - float(i) * 0.22;
      float a = t * spd + float(i) * 1.9;
      vec2 c = vec2(cos(a) * r, sin(a) * r * tilt);
      vec3 pc = mix(uTide, uFrost, 0.35 + 0.15 * float(i));
      if (i == 1) pc = mix(uVerdant, uTide, 0.4);
      if (i == 2) pc = mix(uIris, uTide, 0.35);
      if (i == 3) pc = vec3(0.78, 0.48, 0.28);
      vec4 pl = nodeBody(p, c, 0.010 + float(i) * 0.003, pc, light);
      col = mix(col, pl.rgb, pl.a);
    }

    // finish() (from shader-lib COMMON) applies the shared vignette + film grain
    // and clamps, then we write an opaque pixel.
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) — Tone.js space bed. C-root drone with echoed phrases, the
// audio shadow of a packet crossing a link.
export function buildAudio(api) {
  return api.interstellar({
    root: 65.41,
    scale: [130.81, 146.83, 174.61, 196.00, 220.00, 261.63, 293.66],
    color: 'violet',
    density: 0.38,
    sparkle: 0.28,
    wind: 0.30,
    echo: true,
  });
}
