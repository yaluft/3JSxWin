// theme.js (eclipsepair) - an OPTIONAL scene, lazy-loaded by theme-catalog.js
// the first time it is picked. A per-image replica of a two-panel eclipse
// composite (assets/images/EclipsePair.jpg).
//
// The reference is a vertical diptych, but this theme deliberately fuses it into
// ONE composition: the two bodies sit on a shared horizontal axis facing each
// other across a gap, with no panel masks and no seam, so their light sums in
// the space between them.
//   RIGHT - the eclipsed Sun. A black lunar disc, a white-gold corona with long
//           uneven streamers, two red prominences, and the blazing diamond ring
//           placed on the INNER limb so the frame's brightest point sits in the
//           gap and throws light at its partner.
//   LEFT  - the eclipsed Moon. Mare texture, a copper umbra whose terminator is
//           oriented so the lit limb FACES the Sun, plus a warm rim on that limb
//           picking up light from across the gap.
//   BETWEEN - a bridge of light strung along the axis (warm at the Sun end, cool
//           at the Moon end), one wide halo enclosing both, and a cloud bank lit
//           by both bodies at once.
//
// Nothing from the JPEG is loaded at runtime - the image was a visual reference
// and every structure below is procedural. See CREDITS.md.

// id must match BOTH the folder name (themes/eclipsepair/) and the "id" field of
// this theme's row in themes/index.json. theme-catalog.js builds the import()
// path from the folder name and cross-checks it against the manifest, so any
// mismatch means the theme silently never loads.
export const id = 'eclipsepair';

// meta is merged into SCENE_META (scenes-meta.js) so the scene menu can show a
// name/blurb before this module is ever imported.
export const meta = {
  label: 'Eclipse Pair',
  blurb: 'Two eclipses facing each other - a streaming corona and diamond ring meeting a copper-shadowed Moon across a bridge of light',
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
  // TOP PANEL - totality
  // ---------------------------------------------------------------------------

  // corona: the Sun's outer atmosphere. Two components, which is what stops it
  // reading as a plain radial blur: a smooth 1/r falloff for the inner glow,
  // and long angular STREAMERS - a function of angle, windowed in radius - for
  // the uneven spikes that reach far out on the left and lower right.
  float corona(vec2 q, float rMoon, float t, float life) {
    float r = length(q);
    float ang = atan(q.y, q.x);

    // Inner glow: bright right at the limb, falling off as roughly 1/r^1.6.
    float inner = pow(rMoon / max(r, rMoon * 0.999), 1.6);
    inner *= smoothstep(rMoon * 0.985, rMoon * 1.02, r);   // nothing inside the disc

    // Streamers. The angular noise now advances ~25x faster AND the whole
    // pattern rotates, so the rays visibly sweep around the disc like real
    // coronal streamers rather than sitting frozen.
    float spin = t * 0.09 * life;
    float s0 = vnoise(vec2(ang * 3.1 + spin, t * 0.36 * life));
    float s1 = vnoise(vec2(ang * 7.3 + 4.2 - spin * 1.7, t * 0.27 * life));
    float rays = s0 * 0.62 + s1 * 0.38;
    // The cutoff breathes, so individual streamers flare out and retract.
    float lo = 0.34 - 0.13 * sin(t * 0.62) * life;
    rays = pow(smoothstep(lo, lo + 0.58, rays), 1.7);
    // Streamers live outside the limb and reach much further than the inner glow.
    float reach = smoothstep(rMoon * 0.99, rMoon * 1.30, r) * exp(-(r - rMoon) * 5.2);

    return inner * 0.85 + rays * reach * 1.5;
  }

  // diamondRing: the single blazing point where the last sliver of photosphere
  // shows through a lunar valley. A very hot small core plus a short four-blade
  // flare, sitting exactly on the limb.
  vec3 diamondRing(vec2 q, vec2 dir, float rMoon, float t, float life) {
    vec2 pos = dir * rMoon;
    vec2 d = q - pos;
    float r = length(d);
    // Core: tiny and extremely bright - this is the brightest thing in the frame.
    vec3 acc = vec3(1.0, 0.98, 0.92) * exp(-r * r / 0.000030) * 3.2;
    // Bloom around it.
    acc += vec3(1.0, 0.93, 0.76) * exp(-r * r / 0.00042) * 0.85;
    // Four short blades.
    for (int k = 0; k < 2; k++) {
      vec2 bd = k == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      float along = abs(dot(d, bd));
      float perp  = abs(dot(d, vec2(-bd.y, bd.x)));
      float ray = exp(-perp * 420.0) * exp(-along * 26.0);
      acc += vec3(1.0, 0.95, 0.82) * ray * 0.55;
    }
    // A strong shimmer - the bead is the brightest point in the frame and now
    // clearly scintillates rather than sitting flat.
    return acc * (1.0 + 0.42 * sin(t * 2.4) * life + 0.18 * sin(t * 5.3 + 1.1) * life);
  }

  // prominences: the small red-pink flames of chromosphere just past the limb.
  // Placed by angle, each a narrow arc hugging the disc edge.
  vec3 prominences(vec2 q, float rMoon, float t, float life) {
    float r = length(q);
    float ang = atan(q.y, q.x);
    vec3 acc = vec3(0.0);
    // Two of them, at hand-picked angles matching the reference.
    for (int i = 0; i < 2; i++) {
      float a0 = i == 0 ? -2.55 : -0.62;
      float da = ang - a0;
      // Wrap the angular difference into -PI..PI.
      da = mod(da + 3.14159265, 6.2831853) - 3.14159265;
      // The flames now writhe: the arc wanders along the limb and swells.
      float wander = sin(t * 0.5 + float(i) * 1.9) * 0.12 * life;
      float arc = exp(-(da - wander) * (da - wander) / (0.0020 * (1.0 + 0.6 * sin(t * 0.8 + float(i)) * life)));
      float lift = rMoon * (1.012 + 0.010 * sin(t * 0.9 + float(i) * 2.2) * life);
      float band = exp(-(r - lift) * (r - lift) / 0.0000085);
      // Much deeper flicker - they visibly leap.
      float flick = 0.45 + 0.55 * (0.5 + 0.5 * sin(t * 2.1 + float(i) * 2.7));
      flick = mix(1.0, flick, life);
      acc += vec3(1.00, 0.28, 0.30) * arc * band * flick * 0.85;
    }
    return acc;
  }

  // ---------------------------------------------------------------------------
  // BOTTOM PANEL - the eclipsed Moon
  // ---------------------------------------------------------------------------

  // moonSurface: mare blotches and crater speckle, so the disc is not a flat
  // circle. Two noise scales - broad dark seas, fine bright pocking.
  float moonSurface(vec2 d, float rad) {
    vec2 n = d / rad;
    float mare = fbm(n * 2.3 + vec2(4.7, 1.9));
    mare = smoothstep(0.38, 0.72, mare);
    float pock = vnoise(n * 15.0 + vec2(9.1, 3.3));
    return 1.0 - mare * 0.30 + (pock - 0.5) * 0.13;
  }

  // clouds: the lit cloud banks across the bottom of the frame. fbm advected
  // sideways, reshaped hard so there is clear sky between the banks, and
  // windowed so they only occupy the lower strip.
  float clouds(vec2 p, float t, float yTop, float life) {
    // The warp field and the bank itself now advect ~15x faster, so the cloud
    // visibly rolls across the frame and boils internally.
    vec2 w = vec2(vnoise(p * 1.7 + vec2(t * 0.30 * life, t * 0.08 * life)),
                  vnoise(p * 1.7 + vec2(2.7, -t * 0.22 * life)));
    float g = fbm(p * vec2(2.2, 4.4) + (w - 0.5) * 1.4 + vec2(t * 0.38 * life, 0.0));
    // Breathing density threshold: banks build and dissipate.
    float lo = 0.44 - 0.10 * sin(t * 0.44) * life;
    g = smoothstep(lo, lo + 0.36, g);
    // Only in the lower strip, densest at the very bottom.
    float win = smoothstep(yTop, yTop - 0.16, p.y);
    return g * win;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    // Time base - see lionshead: the old mapping was far too slow to read as
    // motion. This spans "drifting" to "clearly moving" across the Speed slider.
    float t = uTime * (0.20 + uSpeed * 6.0);

    // life: master motion amount on the Twinkle slider (0..1, live).
    float life = 0.25 + uTwinkle * 1.55;

    // breath: the shared pulse both bodies and the light between them ride on.
    float breath = sin(t * 0.48) * 0.62 + sin(t * 0.29 + 2.1) * 0.38;

    // iconZone: dims the left strip where desktop icons live.
    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.6, iconZone);

    // ONE composition, not two panels. The two bodies sit on a shared
    // horizontal axis facing each other across a gap: the eclipsed Sun on the
    // right, the eclipsed Moon on the left. Nothing is masked - both are
    // summed into the same frame, so their light genuinely overlaps in the gap
    // between them. uHeight opens and closes that gap.
    // The gap itself breathes: the two bodies drift toward and away from each
    // other, so the whole composition slowly opens and closes.
    float gap = (0.150 + (uHeight - 0.85) * 0.10) * (1.0 + breath * 0.16 * life);
    // Each body also bobs on its own slow path.
    vec2 sunPos  = vec2( gap, 0.030) + vec2(sin(t * 0.21), cos(t * 0.27)) * 0.020 * life;
    vec2 moonPos = vec2(-gap, -0.020) + vec2(cos(t * 0.19 + 1.4), sin(t * 0.24 + 1.4)) * 0.020 * life;
    // The axis running between the two, used to bias the shared glow.
    vec2 axis = normalize(sunPos - moonPos);

    vec3 col = uVoid * 0.5;

    // A few stars across the whole frame (one composition, one sky).
    vec2 sp = p * 22.0;
    vec2 si = floor(sp), sf = fract(sp);
    float sPresent = step(0.90, hash21(si + 3.9));
    if (sPresent > 0.0) {
      vec2 spos = hash22(si + 3.9);
      float sd = length(sf - spos);
      col += vec3(0.85, 0.87, 0.95) * exp(-sd * sd / 0.00035) * 0.5 * uStars * quiet;
    }

    // === The eclipsed Sun (right) ===========================================
    vec2 sc = p - sunPos;
    float rMoon = 0.082;
    float rs = length(sc);

    // Corona first, so the disc can punch a hole through it.
    float cor = corona(sc, rMoon, t, life) * uIntensity;
    // The corona is white at the limb, warming to gold as it reaches out.
    vec3 corTint = mix(vec3(1.00, 0.97, 0.90), vec3(0.98, 0.80, 0.48),
                       smoothstep(rMoon, rMoon * 2.6, rs));
    vec3 sun = corTint * cor * 0.62;

    // Prominences on the limb, then the diamond ring - moved to the INNER limb
    // (facing the Moon) so the brightest point in the frame sits in the gap and
    // throws its light across at its partner.
    sun += prominences(sc, rMoon, t, life);
    // The bead now slides along the limb, as the alignment shifts through totality.
    float beadAng = -2.79 + sin(t * 0.13) * 0.30 * life;
    sun += diamondRing(sc, vec2(cos(beadAng), sin(beadAng)), rMoon, t, life) * uIntensity;

    // The lunar disc occulting the Sun: hard black. A slightly soft edge keeps
    // it from aliasing.
    float disc = smoothstep(rMoon, rMoon - 0.0016, rs);
    sun *= 1.0 - disc;
    // The faintest earthshine on the disc so it is not a dead hole.
    sun += vec3(0.05, 0.045, 0.055) * disc;

    col += sun * quiet;

    // === The eclipsed Moon (left) ===========================================
    vec2 mc = p - moonPos;
    float rLunar = 0.098;
    float rm = length(mc);

    // The broad soft glow this body casts into the haze around it.
    vec3 moon = vec3(0.62, 0.63, 0.70) * exp(-rm * rm / 0.055) * 0.30;
    moon += vec3(0.70, 0.71, 0.78) * exp(-rm * rm / 0.0075) * 0.32;

    // The disc itself.
    float lunar = smoothstep(rLunar, rLunar - 0.0022, rm);
    float surf = moonSurface(mc, rLunar);
    // Umbra: the shadow now falls AWAY from its partner, so the Moon's lit limb
    // faces the Sun across the gap - the two bodies read as lighting each other.
    float shadow = smoothstep(-0.050, 0.050, dot(mc, -axis));
    vec3 litSide    = vec3(0.86, 0.87, 0.90) * surf;
    vec3 shadowSide = vec3(0.52, 0.24, 0.15) * surf;
    vec3 moonCol = mix(litSide, shadowSide, shadow);
    // A warm rim on the limb that faces the Sun - light picked up from across
    // the gap, the "infusion" that ties the pair together.
    float facing = smoothstep(0.35, 1.0, dot(normalize(mc + 1e-5), axis));
    float rim = smoothstep(rLunar * 0.82, rLunar, rm) * facing;
    moonCol += vec3(1.00, 0.72, 0.42) * rim * 0.55;
    // Limb darkening.
    moonCol *= 0.80 + 0.20 * smoothstep(rLunar, rLunar * 0.45, rm);
    moon = mix(moon, moonCol, lunar);

    col += moon * quiet;

    // === The infusion: shared light in the gap ==============================
    // Where the Sun's corona and the Moon's glow overlap they add rather than
    // butt together. A soft lens of light strung between the two centres sells
    // that: brightest midway, tapering into each body.
    vec2 mid = (sunPos + moonPos) * 0.5;
    vec2 d = p - mid;
    float sep = gap;                                    // half the centre separation
    float along = dot(d, axis) / max(sep, 1e-4);        // -1 at Moon, +1 at Sun
    float across = length(d - axis * dot(d, axis));
    // The bridge pulses and its width undulates along its length, so the light
    // between the two bodies visibly flows rather than sitting as a static bar.
    float ripple = 1.0 + 0.55 * sin(along * 5.0 - t * 1.6) * life;
    float wide = 0.0042 * (1.0 + 0.45 * sin(t * 0.7) * life);
    float bridge = exp(-across * across / wide) * exp(-along * along * 1.15) * ripple;
    bridge *= 0.70 + 0.30 * (0.5 + 0.5 * breath) * life + (1.0 - life) * 0.30;
    // Warm at the Sun end, cool at the Moon end - the two lights meeting.
    vec3 bridgeTint = mix(vec3(0.72, 0.76, 0.90), vec3(1.00, 0.84, 0.55),
                          smoothstep(-0.6, 0.8, along));
    col += bridgeTint * bridge * 0.30 * uIntensity * quiet;

    // A single wide halo enclosing BOTH bodies, so the frame reads as one
    // lit space rather than two separate glows sitting near each other.
    float encl = exp(-dot(d, d) / (0.16 + gap * gap * 2.0));
    col += vec3(0.34, 0.33, 0.42) * encl * 0.22 * quiet;

    // === Cloud, lit from both ===============================================
    // The cloud bank stays low in the frame but is now lit by BOTH bodies, so
    // the glow infuses across the whole lower edge instead of under one panel.
    float cl = clouds(p, t, -0.20, life);
    float litSun  = exp(-length(p - sunPos)  * 1.9);
    float litMoon = exp(-length(p - moonPos) * 1.9);
    vec3 cloudTint = vec3(0.20, 0.23, 0.30)
                   + vec3(0.62, 0.50, 0.34) * litSun
                   + vec3(0.48, 0.52, 0.60) * litMoon;
    col += cloudTint * cl * 0.55 * quiet;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) - Tone.js space bed. An eclipse is a held breath: low A
// drone, sparse phrases, echoed as the pair of discs.
export function buildAudio(api) {
  return api.interstellar({
    root: 55.00,
    scale: [110.00, 130.81, 146.83, 164.81, 196.00, 220.00],
    color: 'gold',
    density: 0.22,
    sparkle: 0.25,
    wind: 0.20,
    echo: true,
  });
}
