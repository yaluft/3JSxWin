// theme.js (solarsystem) — an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time the user selects it. Pure fragment shader: a lit central sun, eight
// tilted orbits with planets, Saturn's rings, an asteroid belt, Earth's moon, all
// over a nebula-and-starfield deep-space backdrop. buildAudio() adds a synth pad.

// id must match BOTH the folder name (themes/solarsystem/) and the "id" field of
// this theme's row in themes/index.json — theme-catalog.js builds the import path
// from it and cross-checks it against the manifest, so a mismatch = theme never loads.
export const id = 'solarsystem';

// meta is merged into SCENE_META (scenes-meta.js) so the scene menu can show a
// name/blurb before this module is ever imported. label = dropdown text,
// blurb = the one-line description under it. silent:true = quiet by design: the
// space engine gives this scene a warm drone with slow, orbital-paced phrases.
export const meta = {
  label: 'Solar System',
  blurb: 'A glowing central star with orbiting worlds, planetary rings, and asteroid belt',
  silent: true,
};

// kind:'shader' means "this theme is just a fragment". scenes.js pastes the COMMON
// preamble from shader-lib.js (precision, uniforms, hash21/vnoise/fbm/finish) in
// front of the string below and runs the result on one full-screen PlaneGeometry(2,2)
// quad. So everything here can assume hash21/fbm/finish and every uXxx uniform exist.
export const kind = 'shader';

export const fragment = /* glsl */ `
  // 2D rotation by angle a. Used to spin planet/sun surface texture over time so
  // the fbm noise on each body drifts instead of sitting frozen.
  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  // Multi-scale twinkling starfield.
  // Cellular-noise stars: chop space into a grid, maybe drop one star per cell,
  // and sum a core dot + a soft halo for the cells near the current fragment.
  // Called several times at different scales/seeds in main() to stack star sizes.
  float starLayer(vec2 p, float t, float seed, float density) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float acc = 0.0;
    // Scan the 3x3 block of cells around this fragment. A star can sit anywhere in
    // its cell, so its dot may spill into a neighbour — checking 9 cells covers that.
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        // present: 1 only if this cell won the density lottery (higher density =>
        // lower threshold => more cells lit). mag: this star's brightness/size roll.
        float present = step(1.0 - density, hash21(cell + seed * 5.17));
        float mag = hash21(cell + seed * 9.31);
        // Random sub-cell position, then a per-star twinkle: a sine whose rate and
        // phase depend on mag so stars pulse out of sync.
        vec2 pos = o + vec2(hash21(cell + seed), hash21(cell + seed * 2.7));
        float tw = 0.6 + 0.4 * sin(t * (1.2 + mag * 3.0) + mag * 6.28);
        float d = length(f - pos);
        // core = tight bright dot, halo = wide faint bloom. smoothstep(edge,0,d)
        // is 1 at the centre and fades to 0 at the edge radius.
        float core = smoothstep(0.04 + mag * 0.03, 0.0, d);
        float halo = smoothstep(0.18 + mag * 0.15, 0.0, d) * 0.15;
        acc += present * mag * tw * (core + halo);
      }
    }
    return acc;
  }

  // Draw a 3D lit sphere representing a planet.
  // Fakes a sphere from a flat disc: rebuild the surface normal from the 2D offset,
  // shade it with one directional light aimed from the sun, add fbm surface detail,
  // optional horizontal bands (gas giants), and a fresnel atmosphere rim.
  // returns vec4(col.rgb, alpha) — alpha is the disc coverage mask, 0 outside.
  vec4 renderBody(vec2 p, vec2 center, float radius, vec2 sunPos, vec3 baseCol, vec3 bandCol, float bands, float atmosphere, float t) {
    // Cheap early-out: skip all the sphere math for fragments well outside the disc.
    vec2 offset = p - center;
    float d = length(offset);
    if (d > radius * 1.5) return vec4(0.0);

    // Anti-aliased disc edge (1px-ish feather). Bail if we're fully outside.
    float bodyMask = 1.0 - smoothstep(radius - 0.0015, radius + 0.0015, d);
    if (bodyMask <= 0.0) return vec4(0.0);

    // Spherical normal: on a unit sphere, x/y come straight from the normalised
    // screen offset and z is whatever's left to make it unit length. This is the
    // standard "billboard impostor" trick — no geometry, just a per-pixel normal.
    vec2 norm2 = offset / max(radius, 1e-4);
    float z = sqrt(max(0.0, 1.0 - dot(norm2, norm2)));
    vec3 normal = vec3(norm2, z);

    // Light direction from the Sun. The 0.25 z-component tilts the light slightly
    // toward the viewer so the lit side isn't a perfectly flat half-disc.
    vec2 toSun = sunPos - center;
    vec3 lightDir = normalize(vec3(toSun, 0.25));

    // Surface details: rotate the sample coords over time (planet spin), take fbm
    // for mottling, and for banded worlds add a sine stripe pattern in latitude.
    // step(0.5, bands) gates banding on only when bands >= 0.5 (0 = rocky world).
    vec2 rotCoord = rot2(norm2, t * 0.8);
    float surfNoise = fbm(rotCoord * 5.0);
    float bandPattern = sin((norm2.y + surfNoise * 0.15) * bands * 12.0) * 0.5 + 0.5;
    vec3 surface = mix(baseCol, bandCol, bandPattern * step(0.5, bands));
    surface = mix(surface, surface * (0.8 + 0.4 * surfNoise), 0.6);

    // Diffuse (Lambert) term with the day/night terminator. pow(diff, 0.85) lifts
    // the mid-tones a touch so the lit hemisphere reads fuller.
    float diff = clamp(dot(normal, lightDir), 0.0, 1.0);
    diff = pow(diff, 0.85);

    // Keep 4% ambient on the night side so it's a dark planet, not a black hole.
    vec3 litColor = surface * (0.04 + 0.96 * diff);

    // Atmospheric rim glow: fresnel = bright where the normal faces away from the
    // viewer (grazing angle, normal.z near 0), i.e. the planet's edge. Tinted
    // toward uFrost and scaled by the per-planet atmosphere amount, and by diff
    // so only the daylit limb glows.
    float fresnel = pow(1.0 - normal.z, 2.5) * atmosphere;
    vec3 atmoCol = mix(surface, uFrost, 0.5);
    litColor += atmoCol * fresnel * (0.2 + 0.8 * diff);

    return vec4(litColor, bodyMask);
  }

  // GLSL ES 2.0 can't index an array with a loop variable reliably, so the three
  // per-planet property tables (orbit radius, body radius, angular speed) are
  // written as if-ladders keyed on the planet index 0..7 (Mercury..Neptune).

  // Orbit radius in the tilted plane, 0 = sun. Roughly log-spaced like the real
  // system, with the gap after i==3 (Mars) where the asteroid belt goes.
  float orbitR(int i) {
    if (i == 0) return 0.12;
    if (i == 1) return 0.18;
    if (i == 2) return 0.26;
    if (i == 3) return 0.34;
    if (i == 4) return 0.52;
    if (i == 5) return 0.68;
    if (i == 6) return 0.82;
    return 0.95;
  }
  // Rendered radius of each planet's disc. Not to scale with reality, just tuned
  // so Jupiter/Saturn (i==4/5) read as the big ones and the inner rocks stay tiny.
  float bodyR(int i) {
    if (i == 0) return 0.009;
    if (i == 1) return 0.015;
    if (i == 2) return 0.017;
    if (i == 3) return 0.012;
    if (i == 4) return 0.038;
    if (i == 5) return 0.030;
    if (i == 6) return 0.022;
    return 0.021;
  }
  // Angular speed along the orbit, normalised so Earth (i==2) == 1.0. Inner
  // planets sweep faster, outer ones crawl — a loose nod to Kepler's third law so
  // the orbits don't all move as a rigid disc.
  float bodySpeed(int i) {
    if (i == 0) return 1.60;
    if (i == 1) return 1.18;
    if (i == 2) return 1.00;
    if (i == 3) return 0.80;
    if (i == 4) return 0.44;
    if (i == 5) return 0.32;
    if (i == 6) return 0.23;
    return 0.18;
  }

  void main() {
    // Screen setup: centre the origin and correct for aspect so circles stay
    // circular. p is in a roughly -0.5..0.5 space with x widened by the aspect
    // ratio. t is scene time; the 0.08 floor keeps everything drifting even at
    // uSpeed 0, and uSpeed scales the whole animation from one slider.
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.08 + uSpeed * 0.6);

    // 1. Cosmic deep-space & nebula background.
    // Vertical gradient from uVoid (bottom) to uTide (top), knocked down to 40%
    // so it stays a dark ground for the bright bodies on top.
    vec3 col = mix(uVoid, uTide, smoothstep(-0.6, 0.6, p.y * 1.5)) * 0.4;

    // Nebula dust wisps: domain-warped fbm (fbm of a point that was itself offset
    // by fbm) for curdled cloud shapes, coloured between uIris and uVerdant. The
    // pow(nebNoise, 2.0) crushes the low values so it's sparse glowing filaments,
    // not a uniform haze (2.2 before — a touch more presence now). The thin end
    // of the cloud leans toward uIris so the curtain shifts hue, not just
    // brightness, as it thins. uIntensity scales the whole thing.
    vec2 q = p * 2.2 + vec2(t * 0.02, -t * 0.01);
    float nebNoise = fbm(q + fbm(q * 1.8 + vec2(1.7, 3.4)));
    vec3 nebulaCol = mix(mix(uIris, uVerdant, 0.2), uVerdant, nebNoise);
    col += nebulaCol * pow(nebNoise, 2.0) * 0.35 * uIntensity;

    // Multi-tier starfield: four starLayer() calls at rising density and scale
    // give near/mid/far/deep star sizes. Each pans at a slightly different rate
    // for a weak parallax; the deepest tier leans faintly toward uIris so the
    // background isn't one flat colour. Tinted uFrost and gated by the uStars
    // density uniform.
    float stars0 = starLayer(p * 28.0 + vec2(t * 0.01, 0.0), t, 1.3, 0.22) * 0.65;
    float stars1 = starLayer(p * 55.0 - vec2(t * 0.02, 0.0), t, 4.7, 0.28) * 0.45;
    float stars2 = starLayer(p * 95.0, t, 8.2, 0.35) * 0.3;
    float stars3 = starLayer(p * 150.0, t, 12.9, 0.3) * 0.18;
    col += (uFrost * (stars0 + stars1 + stars2) + mix(uFrost, uIris, 0.3) * stars3) * uStars;

    // Perspective / orbital tilt.
    // We can't do real 3D here, so squash the y axis: pt is p with y stretched by
    // 1/tilt, so a true circle drawn in pt space shows on screen as an ellipse —
    // a fake isometric view of the orbital plane. Orbit rings and belt use pt;
    // the sun and body discs stay in un-squashed p so they render round.
    float tilt = 0.55;
    vec2 pt = vec2(p.x, p.y / tilt);

    // 2. Central sun. Sits at the origin; disc radius nudged by uHeight.
    vec2 sunPos = vec2(0.0, 0.0);
    float sunDist = length(p - sunPos);
    float sunRad = 0.065 + uHeight * 0.015;

    // Corona & radiant flares: two exp() falloffs (a tight hot core glow and a
    // wide soft one) plus angular ripples — two sines in the polar angle spinning
    // opposite directions — so the outer glow has moving spokes, not a clean
    // ring. The refinement: the spokes are gentler than before (0.2/0.16 vs
    // 0.25/0.2) and the wide falloff cools toward a frost tint at the edges, so
    // the corona melts into the sky instead of ending in an amber ring.
    float angle = atan(p.y, p.x);
    float rays = sin(angle * 14.0 + t * 2.5) * 0.2 + sin(angle * 7.0 - t * 1.8) * 0.16;
    float corona = exp(-sunDist * 16.0) * 1.8 + exp(-sunDist * 5.5) * (0.6 + rays * 0.2);

    // Sun surface convection: rotating fbm mixed between deep orange and pale
    // yellow for a churning-plasma look on the disc itself. sunDisc is the
    // feathered mask of the disc, used at the very end to stamp the core colour.
    vec2 sunUV = rot2(p - sunPos, t * 0.3) * 18.0;
    float sunNoise = fbm(sunUV + vec2(t * 0.4, -t * 0.2));
    vec3 sunCoreCol = mix(vec3(1.0, 0.65, 0.15), vec3(1.0, 0.95, 0.75), sunNoise);
    float sunDisc = 1.0 - smoothstep(sunRad - 0.004, sunRad + 0.004, sunDist);

    // 3. Orbit rings.
    // For each of the 8 planets, draw a faint elliptical guide line at its orbit
    // radius: distance from the ring is abs(radius_of_this_fragment - r) in the
    // squashed pt space, smoothstepped to a thin bright band.
    for (int i = 0; i < 8; i++) {
      float r = orbitR(i);
      float dOrbit = abs(length(pt) - r);
      float orbitLine = smoothstep(0.0035, 0.0, dOrbit) * 0.25;
      col += mix(uIris, uFrost, 0.4) * orbitLine * uIntensity;
    }

    // Asteroid belt (between Mars and Jupiter, pt radius 0.38..0.46).
    // Quantise the polar angle and radius into a grid, hash each cell, and only
    // the top 8% of cells (step(0.92,...)) become a speck. The two smoothsteps
    // fade the belt out at its inner and outer edges so it has soft borders.
    float rBelt = length(pt);
    if (rBelt > 0.38 && rBelt < 0.46) {
      float beltNoise = hash21(floor(vec2(atan(pt.y, pt.x) * 120.0, rBelt * 250.0)));
      float asteroid = step(0.92, beltNoise) * smoothstep(0.46, 0.42, rBelt) * smoothstep(0.38, 0.42, rBelt);
      col += uFrost * asteroid * 0.45;
    }

    // 4. Render the planets, inner to outer.
    vec3 planetLayer = vec3(0.0);
    float planetAlpha = 0.0;

    // Earth's centre is captured during the loop (i==2) so the moon can orbit it
    // afterwards. Declared here because GLSL scopes it out of the loop body.
    vec2 earthPos = vec2(0.0);

    for (int i = 0; i < 8; i++) {
      // Position on the ellipse: angle advances with per-planet speed, plus a
      // fixed phase offset per index so they don't all start on the +x axis.
      // y is scaled by tilt to match the squashed orbit rings.
      float rad = orbitR(i);
      float a = t * bodySpeed(i) + float(i) * 1.73;
      vec2 center = vec2(cos(a) * rad, sin(a) * rad * tilt);

      if (i == 2) earthPos = center;

      // Per-planet look: base colour, band colour, band count (0 = rocky, no
      // stripes), and atmosphere rim strength. Set by index below.
      vec3 bCol = vec3(0.5);
      vec3 bandCol = vec3(0.5);
      float bands = 0.0;
      float atmo = 0.2;

      if (i == 0) { // Mercury
        bCol = vec3(0.68, 0.65, 0.62);
        bandCol = vec3(0.45, 0.42, 0.40);
      } else if (i == 1) { // Venus
        bCol = vec3(0.92, 0.78, 0.45);
        bandCol = vec3(0.85, 0.60, 0.28);
        atmo = 0.7;
      } else if (i == 2) { // Earth
        bCol = vec3(0.12, 0.38, 0.78);
        bandCol = vec3(0.18, 0.58, 0.32);
        bands = 1.0;
        atmo = 0.85;
      } else if (i == 3) { // Mars
        bCol = vec3(0.82, 0.35, 0.15);
        bandCol = vec3(0.55, 0.20, 0.08);
        atmo = 0.3;
      } else if (i == 4) { // Jupiter
        bCol = vec3(0.82, 0.65, 0.48);
        bandCol = vec3(0.62, 0.38, 0.22);
        bands = 4.0;
        atmo = 0.4;
      } else if (i == 5) { // Saturn
        bCol = vec3(0.88, 0.76, 0.52);
        bandCol = vec3(0.72, 0.58, 0.38);
        bands = 3.0;
        atmo = 0.4;
      } else if (i == 6) { // Uranus
        bCol = vec3(0.42, 0.75, 0.85);
        bandCol = vec3(0.30, 0.60, 0.72);
        atmo = 0.6;
      } else if (i == 7) { // Neptune
        bCol = vec3(0.20, 0.35, 0.85);
        bandCol = vec3(0.12, 0.22, 0.65);
        atmo = 0.65;
      }

      // Saturn's rings, drawn in two passes so the planet sits between them.
      // Back half FIRST (before the disc), front half AFTER, split on the sign of
      // ringOff.y. ringDist is an ellipse: y divided by 0.38 squashes the ring to
      // the same tilt as everything else. The cassini term carves the dark
      // Cassini division by notching out a thin band of the ring's alpha, and the
      // fade term brightens the inner edge and lets the outer edge trail off —
      // real rings have a luminosity gradient across their width.
      if (i == 5) {
        vec2 ringOff = (p - center);
        float ringDist = length(vec2(ringOff.x, ringOff.y / 0.38));
        float ring = smoothstep(0.042, 0.046, ringDist) * (1.0 - smoothstep(0.070, 0.075, ringDist));
        float cassini = 1.0 - smoothstep(0.057, 0.060, ringDist) * (1.0 - smoothstep(0.060, 0.063, ringDist));
        ring *= cassini;
        ring *= 1.0 - smoothstep(0.060, 0.075, ringDist) * 0.45;
        if (ringOff.y < 0.0) { // top/far side of the ring — passes behind the globe
          col += vec3(0.78, 0.70, 0.52) * ring * 0.7;
        }
      }

      // Composite the planet disc over the background. mix by planet.a so the
      // feathered edge blends instead of hard-cutting.
      vec4 planet = renderBody(p, center, bodyR(i), sunPos, bCol, bandCol, bands, atmo, t);
      col = mix(col, planet.rgb, planet.a);

      // Saturn's rings, front half — recomputed identically, drawn over the disc.
      if (i == 5) {
        vec2 ringOff = (p - center);
        float ringDist = length(vec2(ringOff.x, ringOff.y / 0.38));
        float ring = smoothstep(0.042, 0.046, ringDist) * (1.0 - smoothstep(0.070, 0.075, ringDist));
        float cassini = 1.0 - smoothstep(0.057, 0.060, ringDist) * (1.0 - smoothstep(0.060, 0.063, ringDist));
        ring *= cassini;
        ring *= 1.0 - smoothstep(0.060, 0.075, ringDist) * 0.45;
        if (ringOff.y >= 0.0) { // bottom/near side of the ring — passes in front
          col = mix(col, vec3(0.78, 0.70, 0.52), ring * 0.85);
        }
      }
    }

    // Earth's moon: a tiny grey body on a fast tight orbit around the Earth
    // centre captured in the loop. No atmosphere (atmo 0), no bands.
    float moonA = t * 6.0;
    vec2 moonPos = earthPos + vec2(cos(moonA) * 0.032, sin(moonA) * 0.032 * tilt);
    vec4 moon = renderBody(p, moonPos, 0.0045, sunPos, vec3(0.75), vec3(0.55), 0.0, 0.0, t);
    col = mix(col, moon.rgb, moon.a);

    // Sun glow and disc go on LAST so they read as the brightest thing and bloom
    // over any planet that passes in front. corona + a very tight extra core
    // highlight are added (scaled by uIntensity); then the plasma disc colour is
    // stamped in over the feathered sunDisc mask.
    col += (vec3(1.0, 0.55, 0.1) * corona + vec3(1.0, 0.85, 0.4) * exp(-sunDist * 28.0)) * uIntensity;
    col = mix(col, sunCoreCol, sunDisc);

    // finish() from shader-lib.js applies the shared vignette + film grain grade.
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) — Tone.js space bed. Warm G-root drone, slow orbital phrases.
export function buildAudio(api) {
  return api.interstellar({
    root: 49.00,
    scale: [98.00, 123.47, 146.83, 164.81, 196.00, 246.94, 293.66],
    color: 'warm',
    density: 0.42,
    sparkle: 0.20,
    wind: 0.30,
  });
}
