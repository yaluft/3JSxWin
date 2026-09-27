// theme.js — "Night Field", an OPTIONAL scene lazy-loaded by theme-catalog.js.
// A cold, dark sky: four parallax layers of hard pinprick stars, a soft
// procedural nebula, a fast "sprinkle" shimmer, and three tiny lit planets.
// Deliberately no bloom/halo anywhere — the brief was "sprinkling, no glow".

// export const id — the theme's identity. theme-catalog.js builds the dynamic
// import path from this ("../themes/<id>/theme.js"), so it MUST match the folder
// name AND the { "id": "night-field" } entry in themes/index.json. A mismatch
// means the manifest advertises a theme whose module can never be found.
export const id = 'night-field';

// export const meta — what the scene menu shows before the module is even
// imported. loadCatalog() seeds label/blurb from index.json first; once the
// module loads, mergeSceneMeta() lets THIS object win.
//   label  — the human name in the dropdown.
//   blurb  — one-line description under it.
//   silent — true means this theme is quiet by design: the space engine keeps
//            it to a low drone and sparse, distant phrases.
export const meta = {
  label: 'Night Field',
  blurb: 'A dark sky of sharp stars, distant nebulae and planets — sprinkling, no glow',
  silent: true,
};

// export const kind — 'shader' tells scenes.js to treat `fragment` as raw GLSL:
// it does COMMON + fragment (COMMON from shader-lib.js brings precision, all the
// uniform declarations, and hash21/vnoise/fbm/finish) and runs the result as the
// fragment shader on one full-screen PlaneGeometry(2,2) quad. So everything below
// only needs to define helper functions and main().
export const kind = 'shader';

// export const fragment — the GLSL body. Pasted AFTER COMMON, so hash21(),
// vnoise(), fbm() and finish() are already in scope, as are every uNNN uniform.
export const fragment = /* glsl */ `
  // hash22: 2D -> 2D random. COMMON only gives us the scalar hash21; we need a
  // 2D offset to jitter each star inside its grid cell, so build one by hashing
  // twice (the second seed is perturbed by the first result so x and y decorrelate).
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  // rot2: standard 2D rotation by angle a. Used to spin planet surface UVs so the
  // fbm banding doesn't sit axis-aligned.
  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  // starSheet: one parallax layer of the star field. Classic cell-noise pattern —
  // chop space into a grid, look at the 3x3 neighbourhood so a star near a cell
  // edge still lights the current pixel. Hard pinpricks only: no halo, no bloom,
  // which is the whole point of this theme.
  float starSheet(vec2 p, float t, float seed, float density) {
    vec2 i = floor(p);              // integer cell coordinate
    vec2 f = fract(p);              // position within the cell, 0..1
    float acc = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        // Only some cells hold a star: keep it if its random value clears the
        // (1 - density) threshold. Higher density -> lower bar -> more stars.
        float present = step(1.0 - density, hash21(cell + seed * 3.7));
        vec2 pos = o + hash22(cell + seed);          // jittered star position
        float mag = hash21(cell + seed * 7.1);
        mag *= mag;                                  // square -> mostly dim, a few bright
        // Twinkle: brighter stars twinkle faster (the 2.4 * mag term) and the
        // 31.0 * mag phase offset keeps neighbouring stars out of sync.
        float tw = 0.62 + 0.38 * sin(t * (0.7 + mag * 2.4) + mag * 31.0);
        float d = length(f - pos);
        // core: a tight dot. smoothstep(edge, 0, d) is 1 at the centre and fades
        // to 0 by radius (0.032 + mag*0.05), so brighter stars are a touch larger.
        float core = smoothstep(0.032 + mag * 0.05, 0.0, d);
        acc += present * (0.35 + mag * 1.05) * tw * core;
      }
    }
    return acc;
  }

  // sprinkle: the fast shimmer layer — a sparse scatter of tiny lights that
  // pulse quickly (the "sprinkling" in the blurb). Same cell-noise machinery as
  // starSheet, but only ~5% of cells are lit (step at 0.948) and the whole grid
  // scrolls upward fast (t * 1.15 on y) so it reads as drifting dust, not stars.
  float sprinkle(vec2 p, float t) {
    vec2 q = p * 62.0 + vec2(t * 0.04, t * 1.15);
    vec2 i = floor(q);
    vec2 f = fract(q);
    float acc = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        float id = hash21(cell + 19.4);
        float present = step(0.948, id);            // ~5% of cells
        vec2 pos = o + hash22(cell + 4.2);
        float d = length(f - pos);
        // life: a fast per-particle pulse (2.1..3.7 Hz-ish), phase-scrambled by
        // id so they blink independently. Dips to 0.40, never fully off.
        float life = 0.40 + 0.60 * sin(t * (2.1 + id * 1.6) + id * 40.0);
        acc += present * life * smoothstep(0.038, 0.0, d);
      }
    }
    return acc;
  }

  // planet: draws one small sphere at centre c, radius r, and returns its lit
  // colour in .rgb and a coverage mask in .a (so main() can composite it with a
  // single mix). No atmosphere glow — flat terminator, matching the theme.
  //   baseCol/bandCol — surface colour and the colour of its cloud bands
  //   bands           — band frequency; 0.0 means "no bands" (see step(0.4,...))
  //   light           — world-space light direction, same for all three planets
  vec4 planet(vec2 p, vec2 c, float r, vec3 baseCol, vec3 bandCol, float bands, vec3 light) {
    vec2 off = p - c;
    float d = length(off);
    // Anti-aliased disc edge: 1 inside the sphere, 0 outside, ~2px of blend.
    float mask = 1.0 - smoothstep(r - 0.0012, r + 0.0012, d);
    // Reconstruct a sphere normal from screen position: n2 is x/y in -1..1 across
    // the disc, z = sqrt(1 - x^2 - y^2) is the front-facing hemisphere. This is
    // the cheap way to fake 3D shading on a 2D circle.
    vec2 n2 = off / max(r, 1e-4);
    float z = sqrt(max(0.0, 1.0 - dot(n2, n2)));
    vec3 n = vec3(n2, z);
    // Surface detail: fbm (from COMMON) over slightly-rotated UVs gives mottling.
    vec2 surfUv = rot2(n2, 0.35);
    float noise = fbm(surfUv * 4.2);
    // Horizontal cloud bands: a sine across the y axis, warped a little by the
    // noise. step(0.4, bands) zeroes the band mix entirely when bands < 0.4, so
    // passing bands = 0.0 gives a clean bandless moon.
    float band = sin((n2.y + noise * 0.12) * bands * 10.0) * 0.5 + 0.5;
    vec3 surface = mix(baseCol, bandCol, band * step(0.4, bands));
    surface = mix(surface, surface * (0.82 + 0.28 * noise), 0.55);   // darken by noise
    // Lambert diffuse, pow(...,0.9) to lift the mid-tones slightly. The 0.09
    // floor is a faint ambient term so the night side is a dark hemisphere, not
    // a cut-out — a touch softer than it used to be, which reads better against
    // the hard pinprick stars.
    float diff = pow(clamp(dot(n, light), 0.0, 1.0), 0.9);
    vec3 lit = surface * (0.09 + 0.91 * diff);
    return vec4(lit, mask);
  }

  // main() — runs once per screen pixel. Builds the sky back-to-front:
  // background gradient -> nebula -> four star layers -> sprinkle -> planets.
  void main() {
    vec2 uv = vUv;                                   // 0..1 across the quad (from VERTEX)
    // aspect-correct so circles are round: sp.x is stretched by width/height,
    // sp.y left alone. All the star/planet math works in this sp space.
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 sp = vec2(uv.x * aspect, uv.y);
    // Scene clock. uSpeed (a per-theme slider) retunes everything from one knob;
    // the 0.18 base keeps it drifting even at uSpeed 0.
    float t = uTime * (0.18 + uSpeed * 1.4);

    // iconZone: a mask that ramps to 1 down the left edge of the screen, where
    // the Windows desktop icons sit. quiet then dims that strip to 72% so the
    // wallpaper never fights the icon labels for contrast.
    float iconZone = 1.0 - smoothstep(0.14, 0.40, uv.x);
    float quiet = mix(1.0, 0.72, iconZone);

    // Background: a vertical gradient from uVoid (deep sky) at the bottom to a
    // dim uTide at the top. smoothstep with out-of-range edges (-0.08, 1.10)
    // keeps the gradient from clamping flat before it reaches screen edges.
    vec3 col = mix(uVoid, uTide * 0.40, smoothstep(-0.08, 1.10, uv.y));

    // --- Nebula --------------------------------------------------------------
    // Domain-warped fbm: run fbm once to get an offset vector w, then sample fbm
    // again at a position pushed by w. That warp is what turns smooth noise blobs
    // into the wispy, curdled look of a real nebula. Two octaves of it are mixed
    // 72/28. q scrolls very slowly so the cloud breathes over minutes, not seconds.
    vec2 q = sp * 1.45 + vec2(t * 0.012, t * 0.004);
    vec2 w = vec2(fbm(q + vec2(2.1, 7.4)), fbm(q + vec2(6.8, 1.9)));
    float n = fbm(q + 1.8 * w) * 0.72 + fbm(q * 2.4 + 3.1 * w) * 0.28;
    // lobe: confine the nebula to one diagonal region (upper area, biased right)
    // so it isn't a uniform fog over the whole sky.
    float lobe = smoothstep(0.08, 1.12, uv.x * 0.55 + uv.y * 0.62)
               * (0.45 + 0.55 * smoothstep(0.08, 0.82, uv.y));
    // dens: threshold the noise (n*1.62 - 0.38) so only the denser cores show,
    // then pow(...,1.45) for a slightly rounder falloff than the old 1.55 — the
    // wisps keep more of their ragged edge. uIntensity is the per-theme
    // brightness slider; lobe and quiet localise and dim it.
    float dens = pow(clamp(n * 1.62 - 0.38, 0.0, 1.0), 1.45) * uIntensity * 0.52 * lobe * quiet;
    // Colour the cloud: dim uTide in the thin parts, shifting toward a blend of
    // uIris and uVerdant in the dense parts. Palette slots come from COMMON.
    vec3 neb = mix(uTide * 0.85, mix(uIris, uVerdant, 0.42), smoothstep(0.06, 0.58, n));
    col += neb * dens;

    // A faint second lobe, low and left — the counterweight that keeps the
    // composition asymmetric. Same cloud field, mirrored mask, greener hue mix
    // and only a quarter of the strength, so it reads as a distant companion
    // cloud rather than a second subject.
    float lobe2 = smoothstep(1.02, 0.15, uv.x * 0.8 + uv.y * 0.55)
                * (0.45 + 0.55 * smoothstep(0.55, 0.05, uv.y));
    float dens2 = pow(clamp(n * 1.7 - 0.5, 0.0, 1.0), 1.45) * uIntensity * 0.14 * lobe2 * quiet;
    vec3 neb2 = mix(uTide * 0.7, mix(uVerdant, uIris, 0.3), smoothstep(0.1, 0.62, n));
    col += neb2 * dens2;

    // --- Star field ---------------------------------------------------------
    // Four starSheet layers at rising grid frequency (28 -> 118) and falling
    // weight (0.85 -> 0.24). Nearer layers (low frequency) are bigger, brighter,
    // and scroll slower; far layers scroll faster in x — that speed difference is
    // the parallax that gives the sky depth. Each layer gets a different seed so
    // the patterns don't line up, and the two deepest layers lean slightly toward
    // uIris so the far field isn't a flat copy of the near one.
    float st0 = starSheet(sp * 28.0  + vec2(t * 0.03,  0.0), t, 1.0, 0.46) * 0.85;
    float st1 = starSheet(sp * 48.0  + vec2(t * 0.06, -t * 0.01), t, 2.2, 0.40) * 0.58;
    float st2 = starSheet(sp * 76.0  + vec2(t * 0.10,  0.0), t, 3.1, 0.36) * 0.40;
    float st3 = starSheet(sp * 118.0 + vec2(t * 0.16,  0.0), t, 4.4, 0.32) * 0.24;
    vec3 st = uFrost * (st0 + st1)
            + mix(uFrost, uIris, 0.22) * st2
            + mix(uFrost, uIris, 0.35) * st3;
    // Scale by the uStars density slider, and pull the stars down to 70% over
    // the icon strip.
    col += st * uStars * mix(0.70, 1.0, 1.0 - iconZone);

    // Sprinkle shimmer on top. uTwinkle (0..1 slider, forced to 0 under
    // prefers-reduced-motion by config.js) crossfades between a calm 0.40 floor
    // and full 1.0 pulse depth.
    col += uFrost * sprinkle(sp, t) * 0.85 * quiet * (0.40 + uTwinkle * 0.60);

    // --- Planets -----------------------------------------------------------
    // One shared light direction (up-left, toward the viewer) so all three read
    // as lit by the same off-screen sun. Each centre cN drifts on a tiny
    // sin/cos wobble (amplitude ~0.01-0.018) so the planets are never quite
    // static but don't visibly move either.
    vec3 light = normalize(vec3(-0.55, 0.25, 0.78));
    vec2 c0 = vec2(aspect * 0.78 + 0.012 * sin(t * 0.07), 0.68 + 0.018 * sin(t * 0.05));
    vec2 c1 = vec2(aspect * 0.58 + 0.010 * sin(t * 0.04 + 1.7), 0.22 + 0.012 * cos(t * 0.06));
    vec2 c2 = vec2(aspect * 0.88 + 0.008 * cos(t * 0.05 + 0.8), 0.36 + 0.010 * sin(t * 0.08 + 2.2));

    // Three worlds, all in the right two-thirds of the screen (away from icons):
    //   p0 — largest, blue-grey, banded. uHeight (per-theme slider) nudges its radius.
    //   p1 — mid, rusty/orange, faint bands.
    //   p2 — smallest, pale grey, bandless (bands = 0.0 -> the step() kills the mix).
    vec4 p0 = planet(sp, c0, 0.038 + uHeight * 0.008, vec3(0.42, 0.46, 0.52), vec3(0.28, 0.32, 0.40), 2.2, light);
    vec4 p1 = planet(sp, c1, 0.022, vec3(0.50, 0.32, 0.22), vec3(0.38, 0.22, 0.14), 1.4, light);
    vec4 p2 = planet(sp, c2, 0.014, vec3(0.55, 0.58, 0.62), vec3(0.40, 0.42, 0.48), 0.0, light);

    // Composite each planet over the sky using its coverage mask (.a), further
    // scaled by quiet so a planet drifting into the icon strip dims too.
    col = mix(col, p0.rgb, p0.a * quiet);
    col = mix(col, p1.rgb, p1.a * quiet);
    col = mix(col, p2.rgb, p2.a * quiet);

    // finish() (from COMMON) applies the shared vignette + film grain and clamps
    // the low end. Alpha 1.0 — the wallpaper is fully opaque.
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// export function buildAudio(api) — Tone.js space bed. Night Field stays LOW
// and sparse: an A-root drone and distant phrases.
export function buildAudio(api) {
  return api.interstellar({
    root: 55.00,
    scale: [110.00, 130.81, 146.83, 196.00, 220.00, 261.63],
    color: 'deep',
    density: 0.28,
    sparkle: 0.22,
    wind: 0.35,
  });
}
