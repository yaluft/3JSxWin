// theme.js — "Globule", an OPTIONAL scene theme lazy-loaded by theme-catalog.js.
// A globular star cluster: dense twinkling core, two orbiting cores/suns, a
// pulsar sweep, three meteors, and a halo of ~8 lit worlds (rings, moons).
// Pure fragment shader — no three.js objects, just a fullscreen quad.

// id MUST equal the folder name (themes/globule/) and the "id" in themes/index.json.
// theme-catalog's loadTheme() builds the import path from this same string, and
// resolveSceneId() checks the catalog entry — a mismatch means the theme never loads.
export const id = 'globule';

// meta feeds the scene menu. label + blurb are shown in the picker (they also live
// in index.json so the menu can name the theme before this module is imported;
// loadTheme() then lets this copy win). silent:true = quiet by design — the
// space engine keeps this scene to a deep drone and rare, paired phrases.
export const meta = {
  label: 'Globule',
  blurb: 'A globular cluster — twin cores, a halo of worlds, meteors, pulsar sweep',
  silent: true,
};

// kind:'shader' tells scenes.js to treat `fragment` as a GLSL main() + helpers,
// concatenate it after shader-lib's COMMON (all the uniforms + hash/noise/fbm +
// finish()), and run the result on a single -1..1 PlaneGeometry(2,2) quad.
export const kind = 'shader';

export const fragment = /* glsl */ `
  // hash22: 2D -> 2D noise. hash21 (from COMMON) only gives one random float, but
  // we need a random XY offset to scatter a star inside its grid cell. Feed the
  // first result back in with an odd multiplier so the two components decorrelate.
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  // rot2: rotate a 2D point by angle a. Standard 2x2 rotation matrix written out.
  // Used to slowly spin the whole cluster and to orient the star-spike glints.
  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  // starSheet: one layer of the star field. Chop space into a grid, and for each
  // of the 9 cells around the current pixel maybe place one star, drawn as a soft
  // dot plus (for bright ones) a diffraction cross. Call it several times at
  // different scales/seeds and sum to get depth. size = dot radius in cell units,
  // density = fraction of cells that contain a star.
  float starSheet(vec2 p, float t, float seed, float density, float size) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float acc = 0.0;
    // Walk the 3x3 block of cells around this pixel so a star near a cell edge
    // still lights pixels in the neighbouring cell.
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        // present: 1 if this cell won the density lottery, else 0. step() with a
        // per-cell random keeps the pattern stable frame to frame.
        float present = step(1.0 - density, hash21(cell + seed * 3.7));
        // Random position inside the cell, and a magnitude 0..1 that we square so
        // most stars are dim and a few are bright (a rough luminosity function).
        vec2 pos = o + hash22(cell + seed);
        float mag = hash21(cell + seed * 7.1);
        mag *= mag;
        // Twinkle: brighter stars flicker faster. sin() term is a 0.1..1 pulse.
        float tw = 0.55 + 0.45 * sin(t * (0.8 + mag * 3.4) + mag * 31.0);
        float d = length(f - pos);
        // core: the round star body. smoothstep from radius down to 0 = soft disc,
        // bigger for brighter stars.
        float core = smoothstep(size * (0.9 + mag * 1.6), 0.0, d);
        // spike: the four-point diffraction cross, only on the brightest stars.
        // Two crossed exponential ridges — sharp along one axis (90), soft across
        // the other (14) — so it reads as a lens glint, not a plus sign.
        float spike = 0.0;
        if (mag > 0.55) {
          vec2 sp = abs(f - pos);
          spike = exp(-sp.x * 90.0) * exp(-sp.y * 14.0) * mag
                + exp(-sp.y * 90.0) * exp(-sp.x * 14.0) * mag;
        }
        acc += present * (0.28 + mag * 1.15) * tw * (core + spike * 0.35);
      }
    }
    return acc;
  }

  // body: draw one lit sphere (a planet or moon). Returns rgb + coverage alpha so
  // main() can composite it with mix(). It fakes 3D from a flat disc — no
  // raymarch: reconstruct a hemisphere normal from the 2D offset, do one Lambert
  // light term, add fbm surface detail, latitude bands, and a rim/atmosphere glow.
  //   c = centre, r = radius, lightXY = where the light comes from (screen space)
  //   baseCol/bandCol = surface colours, bands = 0 for a plain body / >0 for
  //   striped gas giants, atmo = strength of the fresnel atmosphere ring.
  vec4 body(vec2 p, vec2 c, float r, vec2 lightXY, vec3 baseCol, vec3 bandCol, float bands, float atmo) {
    vec2 off = p - c;
    float d = length(off);
    // Cheap bounding-circle reject: nothing to draw well outside the disc.
    if (d > r * 1.65) return vec4(0.0);
    // Anti-aliased edge: 1 inside, 0 outside, a ~0.003-wide soft ring between.
    float mask = 1.0 - smoothstep(r - 0.0016, r + 0.0016, d);
    if (mask <= 0.0) return vec4(0.0);
    // Rebuild a unit sphere normal: n2 is the in-plane part, z = sqrt(1 - |n2|^2)
    // is the bulge toward the viewer. This is the whole "3D from a circle" trick.
    vec2 n2 = off / max(r, 1e-4);
    float z = sqrt(max(0.0, 1.0 - dot(n2, n2)));
    vec3 n = vec3(n2, z);
    // Light direction: toward lightXY, tilted 0.28 out of the screen so the
    // terminator sits at a nice angle instead of dead-on.
    vec3 light = normalize(vec3(lightXY - c, 0.28));
    float diff = pow(clamp(dot(n, light), 0.0, 1.0), 0.82);
    // Surface: one fbm octave-stack for mottling, plus a sine in latitude for the
    // gas-giant bands (only mixed in when bands > 0.4).
    float surf = fbm(n2 * 6.2 + vec2(0.4, 0.1));
    float band = sin((n2.y + surf * 0.12) * bands * 11.0) * 0.5 + 0.5;
    vec3 surface = mix(baseCol, bandCol, band * step(0.4, bands));
    surface = mix(surface, surface * (0.78 + 0.44 * surf), 0.55);
    // Lambert shading with a 5% ambient floor so the night side isn't pure black.
    vec3 lit = surface * (0.05 + 0.95 * diff);
    // Fresnel rim: pow(1 - facing, 2.4) peaks at the silhouette edge. Tinted
    // toward uFrost and gated by diff so only the lit limb glows (an atmosphere).
    float fres = pow(1.0 - n.z, 2.4) * atmo;
    lit += mix(surface, uFrost, 0.45) * fres * (0.18 + 0.82 * diff);
    return vec4(lit, mask);
  }

  // meteor: one shooting star. cycle is a 0..1 sawtooth on time; the meteor is
  // only alive for the first ~third of it (life ramps up fast, fades by 0.38),
  // then it's dark until the cycle wraps and it streaks again from a new-ish spot.
  float meteor(vec2 p, float t, float seed) {
    float cycle = fract(t * 0.17 + seed);
    float life = smoothstep(0.0, 0.08, cycle) * (1.0 - smoothstep(0.22, 0.38, cycle));
    if (life <= 0.0) return 0.0;
    // Random start near the top edge, travelling down-and-right. head marches
    // along dir as cycle advances.
    vec2 origin = vec2(-0.95 + hash21(vec2(seed, 1.1)) * 1.9, 0.72 - hash21(vec2(seed, 2.2)) * 0.35);
    vec2 dir = normalize(vec2(0.55 + hash21(vec2(seed, 3.3)) * 0.4, -0.82));
    vec2 head = origin + dir * cycle * 2.4;
    // Distance from the pixel to the trail: project onto -dir to get how far
    // BEHIND the head we are (clamped to a 0.26 tail length), then measure the
    // perpendicular offset from that line. The slightly longer, softer tail
    // (14 -> 11 falloff) is the refinement: streaks linger a beat instead of
    // snapping shut.
    vec2 pa = p - head;
    float along = clamp(dot(pa, -dir), 0.0, 0.26);
    vec2 closest = pa + dir * along;
    float d = length(closest);
    // Tight bright head + a longer tail that also fades with distance behind.
    float headGlow = exp(-d * 140.0);
    float tail = exp(-d * 50.0) * exp(-along * 11.0);
    return (headGlow * 1.6 + tail) * life;
  }

  void main() {
    // Screen setup. vUv is 0..1 from the vertex shader; recentre to -0.5..0.5 and
    // multiply x by aspect so circles stay round on a wide monitor. t is the scene
    // clock — uSpeed (a slider) scales it so one knob retunes every motion below.
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.07 + uSpeed * 0.55);

    // The cluster sits slightly off-centre and rotates very slowly as a whole.
    // pc = pixel position in the cluster's own rotating frame; r = distance from
    // the cluster centre, the master falloff variable for everything cluster-y.
    vec2 cluster = vec2(0.06, 0.04);
    vec2 pc = rot2(p - cluster, t * 0.045);
    float r = length(pc);

    // Base sky: a vertical gradient from deep uVoid at the bottom to a faint
    // uTide wash higher up. Everything else is added on top of this.
    vec3 col = mix(uVoid * 1.15, uTide * 0.35, smoothstep(-0.85, 0.4, p.y));

    // Nebular dust halo. Domain-warped fbm (fbm of position + fbm of position)
    // gives billowy, non-repeating cloud. envelope is a soft radial mask,
    // pow(r,1.35) so it fills the middle and fades out; uHeight lifts the whole
    // halo's brightness. Colour blends warm orange into uIris / green uVerdant.
    vec2 q = pc * 2.05 + vec2(t * 0.025, -t * 0.016);
    float dust = fbm(q + fbm(q * 2.4 + vec2(2.1, 4.7)));
    vec3 haloCol = mix(mix(uIris, vec3(1.0, 0.68, 0.36), 0.35), uVerdant * 0.55, dust);
    float envelope = exp(-pow(r * 1.05, 1.35)) * (0.5 + 0.5 * uHeight);
    col += haloCol * pow(dust, 1.85) * envelope * 0.55 * uIntensity;

    // Dark dust lane cutting across the cluster — a wavy horizontal band where we
    // multiply the colour DOWN, like the obscuring lanes in a real galaxy photo.
    float lane = abs(pc.y * 0.85 + 0.22 * sin(pc.x * 2.8 + t * 0.35));
    col *= 1.0 - smoothstep(0.16, 0.03, lane) * envelope * 0.28;

    // Packed core is stars, not a sun disc. Just a warm exponential glow that
    // gently pulses (the sin term) to suggest the unresolved crush of stars at
    // the cluster centre; the actual star dots come next. The colour leans warm
    // at the very centre and melts toward uIris by mid-radius so the core isn't
    // a flat amber blob.
    float coreGlow = exp(-r * 3.8) * (0.55 + 0.08 * sin(t * 1.4));
    col += mix(vec3(1.0, 0.82, 0.55), uIris, clamp(r * 1.6, 0.0, 1.0)) * coreGlow * 0.42 * uIntensity;

    // The star field: 7 starSheet layers summed. dens makes cells far more likely
    // to hold a star near the centre (exp(-r*r)) — that radial concentration is
    // what makes it read as a globular CLUSTER and not a flat sky. pack biases the
    // two finest, densest layers even harder toward the core. The last layer uses
    // plain p (not pc) at low density = a sparse background field that ignores the
    // cluster. Colour shifts warm-white in the core to cool uFrost at the edge.
    float dens = clamp(exp(-r * r * 2.6) * 1.9 + 0.14, 0.14, 1.0);
    float pack = exp(-r * 1.15);
    float stars = starSheet(pc * 16.0, t, 1.2, 0.78 * dens, 0.032) * 1.05
                + starSheet(pc * 32.0 + vec2(t * 0.015, 0.0), t, 4.8, 0.70 * dens, 0.024) * 0.9
                + starSheet(pc * 58.0, t, 9.1, 0.58 * dens, 0.018) * 0.72
                + starSheet(pc * 96.0, t, 11.6, 0.50 * dens, 0.016) * 0.55
                + starSheet(pc * 150.0, t, 17.2, 0.82 * dens, 0.028) * pack * 1.35
                + starSheet(pc * 230.0, t, 21.5, 0.74 * dens, 0.024) * pack * 0.95
                + starSheet(p * 120.0, t, 13.4, 0.20, 0.014) * 0.28;
    col += mix(uFrost, vec3(1.0, 0.9, 0.68), clamp(1.0 - r * 1.1, 0.0, 1.0)) * stars * uStars;

    // Twin cores: two bright points (a and b) orbiting the cluster centre a half
    // turn apart (the +3.14159 = +pi). One warm/gold, one cool/blue. exp(-d*90)
    // is a tight star glow around each.
    vec2 a = cluster + vec2(cos(t * 0.55) * 0.045, sin(t * 0.55) * 0.028);
    vec2 b = cluster + vec2(cos(t * 0.55 + 3.14159) * 0.045, sin(t * 0.55 + 3.14159) * 0.028);
    float da = length(p - a);
    float db = length(p - b);
    col += vec3(1.0, 0.88, 0.55) * exp(-da * 90.0) * 0.85 * uIntensity;
    col += vec3(0.7, 0.84, 1.0) * exp(-db * 90.0) * 0.75 * uIntensity;
    // A faint bridge of light between the two cores: classic point-to-segment
    // distance (project pa onto ba, clamp to the segment, measure the gap).
    vec2 ba = b - a;
    vec2 pa = p - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
    float beam = exp(-length(pa - ba * h) * 90.0);
    col += vec3(1.0, 0.9, 0.7) * beam * 0.45 * uIntensity;

    // Pulsar sweep: a lighthouse beam. atan gives the pixel's angle around the
    // core as 0..1; t*0.08 rotates that value so sweep==0.5 (a thin band) walks
    // around. Masked to the inner cluster (exp(-r) and a smoothstep cap) so the
    // beam fades out before it reaches the edge.
    float sweep = fract(atan(pc.y, pc.x) / 6.28318 + t * 0.08);
    float pulsar = smoothstep(0.018, 0.0, abs(sweep - 0.5) - 0.003) * exp(-r * 1.4) * (1.0 - smoothstep(0.04, 0.72, r));
    col += mix(uIris, uFrost, 0.5) * pulsar * 0.38 * uIntensity;

    // Nova flash: pow(sin, 64) is ~0 almost always and spikes to 1 for a brief
    // moment each cycle — a supernova going off deep in the core, then gone.
    float nova = pow(max(0.0, sin(t * 0.27)), 64.0);
    col += vec3(1.0, 0.94, 0.82) * nova * exp(-r * 5.5) * 0.35;

    // Three meteors, staggered in time (+1.7, +3.1) and seeded differently so
    // they never streak together. Each a different colour: frost, iris, warm.
    col += uFrost * meteor(p, t, 0.11) * 1.1;
    col += mix(uIris, uFrost, 0.4) * meteor(p, t + 1.7, 0.62) * 0.85;
    col += vec3(1.0, 0.78, 0.45) * meteor(p, t + 3.1, 0.33) * 0.7;

    // One shared light position for every planet below: the midpoint of the twin
    // cores, so all the worlds are lit from the same place and read as one system.
    vec2 light = mix(a, b, 0.5);

    // The halo of worlds. Each planet is an ellipse orbit around the cluster
    // centre: cos(t*speed + phase) for x, sin(...)*squash for y, so orbits look
    // tilted away from us. Different speed + phase per world keeps them spread
    // out. body() returns premultiplied colour + alpha; mix() composites it, and
    // later worlds are drawn last so they paint over nearer ones.

    // World 0 — blue-green banded planet with a strong atmosphere, plus a tiny
    // fast moon on its own little orbit.
    vec2 p0 = cluster + vec2(cos(t * 0.19 + 0.2) * 0.62, sin(t * 0.19 + 0.2) * 0.34);
    vec4 w0 = body(p, p0, 0.048, light, vec3(0.22, 0.42, 0.78), vec3(0.18, 0.62, 0.38), 1.4, 0.9);
    col = mix(col, w0.rgb, w0.a);
    vec2 m0 = p0 + vec2(cos(t * 2.4) * 0.055, sin(t * 2.4) * 0.028);
    vec4 moon0 = body(p, m0, 0.008, light, vec3(0.72, 0.7, 0.66), vec3(0.5), 0.0, 0.05);
    col = mix(col, moon0.rgb, moon0.a);

    // World 1 — the ringed gas giant. ring1 is an annulus in a y-squashed space
    // (ro.y / 0.36) so the ring reads as a tilted ellipse; the second smoothstep
    // term punches the Cassini-style gap into it. We draw the ring's BACK half
    // before the planet (p.y < p1.y, additive) and the FRONT half after (on top),
    // so the planet correctly sits between the two ring arcs.
    vec2 p1 = cluster + vec2(cos(t * 0.13 + 2.1) * 0.78, sin(t * 0.13 + 2.1) * 0.40);
    vec4 w1 = body(p, p1, 0.062, light, vec3(0.82, 0.62, 0.42), vec3(0.62, 0.38, 0.18), 3.5, 0.45);
    float ring1 = 0.0;
    {
      vec2 ro = p - p1;
      float rd = length(vec2(ro.x, ro.y / 0.36));
      ring1 = smoothstep(0.062, 0.068, rd) * (1.0 - smoothstep(0.098, 0.108, rd));
      ring1 *= 1.0 - smoothstep(0.082, 0.086, rd) * (1.0 - smoothstep(0.086, 0.090, rd));
    }
    if (p.y < p1.y) col += vec3(0.86, 0.76, 0.52) * ring1 * 0.65;
    col = mix(col, w1.rgb, w1.a);
    if (p.y >= p1.y) col = mix(col, vec3(0.86, 0.76, 0.52), ring1 * 0.8);

    // World 2 — small rusty rock, faint atmosphere.
    vec2 p2 = cluster + vec2(cos(t * 0.11 + 4.0) * 0.92, sin(t * 0.11 + 4.0) * 0.42);
    vec4 w2 = body(p, p2, 0.030, light, vec3(0.78, 0.32, 0.18), vec3(0.48, 0.18, 0.1), 0.8, 0.3);
    col = mix(col, w2.rgb, w2.a);

    // World 3 — cyan ice giant with its own retrograde moon (negative t = orbits
    // the other way).
    vec2 p3 = cluster + vec2(cos(t * 0.09 + 5.4) * 1.05, sin(t * 0.09 + 5.4) * 0.48);
    vec4 w3 = body(p, p3, 0.040, light, vec3(0.32, 0.72, 0.82), vec3(0.18, 0.48, 0.7), 1.2, 0.7);
    col = mix(col, w3.rgb, w3.a);
    vec2 m3 = p3 + vec2(cos(-t * 1.8) * 0.048, sin(-t * 1.8) * 0.022);
    vec4 moon3 = body(p, m3, 0.007, light, vec3(0.85, 0.82, 0.7), vec3(0.55), 0.0, 0.0);
    col = mix(col, moon3.rgb, moon3.a);

    // World 4 — tiny bare grey moon-world on a close, quick orbit.
    vec2 p4 = cluster + vec2(cos(t * 0.16 + 1.3) * 0.70, sin(t * 0.16 + 1.3) * 0.32);
    vec4 w4 = body(p, p4, 0.020, light, vec3(0.62, 0.55, 0.5), vec3(0.4, 0.36, 0.32), 0.0, 0.1);
    col = mix(col, w4.rgb, w4.a);

    // World 5 — deep-blue banded planet on the widest, slowest orbit.
    vec2 p5 = cluster + vec2(cos(t * 0.07 + 3.6) * 1.18, sin(t * 0.07 + 3.6) * 0.52);
    vec4 w5 = body(p, p5, 0.050, light, vec3(0.18, 0.28, 0.72), vec3(0.12, 0.18, 0.5), 2.2, 0.75);
    col = mix(col, w5.rgb, w5.a);

    // World 6 — the big golden foreground world. NOT orbiting the cluster: it
    // hangs at a fixed lower-left spot with only a small wobble, so it feels
    // close to the viewer, in front of everything.
    vec2 p6 = vec2(-0.72, -0.38) + vec2(cos(t * 0.08) * 0.06, sin(t * 0.08) * 0.03);
    vec4 w6 = body(p, p6, 0.072, light, vec3(0.92, 0.78, 0.42), vec3(0.72, 0.5, 0.22), 0.5, 0.55);
    col = mix(col, w6.rgb, w6.a);

    // finish() (from COMMON) applies the shared vignette + film grain, then we
    // pack to a fully opaque pixel.
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio: Tone.js space bed. Globule plays it DEEP: an F-root drone with
// paired phrases, echoing the twin cores on screen.
export function buildAudio(api) {
  return api.interstellar({
    root: 43.65,
    scale: [87.31, 98.00, 116.54, 130.81, 174.61, 196.00, 233.08],
    color: 'deep',
    density: 0.32,
    sparkle: 0.40,
    wind: 0.45,
    echo: true,
  });
}
