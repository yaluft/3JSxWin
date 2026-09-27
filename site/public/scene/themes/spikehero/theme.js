// theme.js (spikehero) - an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time it is picked. A per-image replica of a JWST NIRCam star-forming
// region (assets/images/55369225127_dc150b5db0_o.jpg): one enormously bright
// hero star whose six golden diffraction spikes cross the entire frame, a second
// smaller spike star to its upper right, a pale crescent-shaped gas arc curling
// between them, blue-violet nebula sheets across the top and right, rust-orange
// dust banks lower right, a thin red filament running down the far left, and a
// dense field of orange background galaxies throughout.
//
// The spikes are the subject here - in the reference they are longer than the
// frame is wide and they are what the eye reads first, so they get the most
// care: six blades at 60 degrees, faintly banded along their length, with a
// horizontal pair that runs edge to edge.
//
// Nothing from the JPEG is loaded at runtime - the image was a visual reference
// and every structure below is procedural. See CREDITS.md.

// id must match BOTH the folder name (themes/spikehero/) and the "id" field of
// this theme's row in themes/index.json.
export const id = 'spikehero';

export const meta = {
  label: 'Spike Hero',
  blurb: 'A JWST nursery - one blazing six-spike star crossing the frame, blue gas sheets, rust dust, a crescent arc',
  silent: true,
};

export const kind = 'shader';

export const fragment = /* glsl */ `
  // hash22: 2D -> 2D random, for scattering pinpoints inside their grid cell.
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  // heroSpikes: the six-blade diffraction pattern of a very bright star on a
  // hexagonal mirror. Three axes at 60 degrees; each blade is symmetric, so
  // three axes give six spikes. Unlike the small spike stars elsewhere in the
  // library these run essentially the full width of the frame, so the along-axis
  // decay is very slow and the across-axis (perp) falloff is tight.
  vec3 heroSpikes(vec2 q, float scale, float t, float phase, float life) {
    vec3 acc = vec3(0.0);
    // The whole spike cross rotates slowly - the single most legible motion in
    // this scene, since the blades span the frame.
    float rot = t * 0.055 * life + phase * 0.2;
    q = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
    for (int k = 0; k < 3; k++) {
      float a = float(k) * 1.0471976 + 0.5236;   // 60 deg apart, offset 30
      vec2 d = vec2(cos(a), sin(a));
      float along = abs(dot(q, d));
      float perp  = abs(dot(q, vec2(-d.y, d.x)));
      // Each blade's reach now pumps in and out on its own phase, so the cross
      // visibly extends and retracts rather than holding a fixed length.
      float reach = 1.0 + 0.42 * sin(t * 0.85 + phase + float(k) * 2.1) * life;
      float blade = exp(-perp * (620.0 / scale)) * exp(-along * (2.1 / (scale * reach)));
      blade += exp(-perp * (150.0 / scale)) * exp(-along * (3.4 / (scale * reach))) * 0.30;
      // The beading now TRAVELS outward along the blade - light visibly running
      // down the spike, which reads as energy rather than texture.
      float band = 0.72 + 0.28 * sin(along * (95.0 / scale) - t * 3.2 * life + phase);
      blade *= band;
      // Strong per-blade pulse.
      blade *= 0.60 + 0.40 * sin(t * 1.3 + phase + float(k) * 1.7) * life;
      acc += vec3(1.00, 0.86, 0.55) * blade;
    }
    return acc;
  }

  // heroCore: the star itself - a small blown-out white centre inside a warm
  // golden bloom, plus a tight halo ring.
  vec3 heroCore(vec2 q, float scale, float t, float life) {
    float r = length(q);
    // The core visibly beats - each shell throbs on a slightly different phase
    // so the star swells and brightens rather than blinking uniformly.
    float b0 = 1.0 + 0.50 * sin(t * 1.15) * life;
    float b1 = 1.0 + 0.40 * sin(t * 0.95 + 0.8) * life;
    float b2 = 1.0 + 0.32 * sin(t * 0.75 + 1.9) * life;
    vec3 acc = vec3(1.00, 0.98, 0.94) * exp(-r * r / (0.000045 * scale * b0)) * 3.0;
    acc += vec3(1.00, 0.88, 0.62) * exp(-r * r / (0.00055 * scale * b1)) * 1.10;
    acc += vec3(0.98, 0.78, 0.46) * exp(-r * r / (0.0042  * scale * b2)) * 0.34;
    return acc * (0.80 + 0.35 * sin(t * 1.4) * life);
  }

  // crescentArc: the pale curved shell of gas curling between the two stars. A
  // thin annulus, windowed in angle so only one arc of the ring shows, with a
  // noisy inner edge so it reads as swept gas rather than a drawn circle.
  float crescentArc(vec2 p, vec2 c, float rad, float a0, float aw, float t, float life) {
    vec2 q = p - c;
    float r = length(q);
    float ang = atan(q.y, q.x);
    // The arc sweeps around its centre, so the shell visibly travels.
    float da = mod(ang - a0 - t * 0.10 * life + 3.14159265, 6.2831853) - 3.14159265;
    float win = smoothstep(aw, aw * 0.45, abs(da));
    // The shell expands and contracts, and its rim boils much faster.
    float grow = rad * (1.0 + 0.14 * sin(t * 0.62) * life);
    float wob = (vnoise(vec2(ang * 2.4, t * 0.42 * life)) - 0.5) * 0.045 * life;
    float band = exp(-(r - grow - wob) * (r - grow - wob) / 0.00022);
    float rough = 0.40 + 0.60 * vnoise(vec2(ang * 5.5, t * 0.55 * life));
    return band * win * rough;
  }

  // gasSheet: the broad nebula masses. Domain-warped fbm reshaped hard so there
  // is real black sky between the clouds, positioned by an elliptical window so
  // each call paints one bank rather than a frame-wide fog.
  float gasSheet(vec2 p, vec2 c, vec2 rad, float rot, float t, float seed, float life) {
    vec2 q = p - c;
    // Rotate into the bank's own frame; the frame itself now turns slowly, so
    // each cloud mass visibly wheels.
    float rr = rot + t * 0.035 * life * (0.6 + fract(seed) * 0.8);
    vec2 qr = vec2(q.x * cos(rr) - q.y * sin(rr), q.x * sin(rr) + q.y * cos(rr));
    // The warp field advects ~25x faster, so the gas churns and flows.
    vec2 w = vec2(vnoise(qr * 2.1 + vec2(seed + t * 0.30 * life, t * 0.22 * life)),
                  vnoise(qr * 2.1 + vec2(seed + 4.3, -t * 0.26 * life)));
    float g = fbm(qr * 2.8 + (w - 0.5) * 1.7 + vec2(seed * 2.0 + t * 0.14 * life, 0.0));
    // Breathing threshold: the cloud builds and thins.
    float lo = 0.44 - 0.11 * sin(t * 0.5 + seed) * life;
    g = smoothstep(lo, lo + 0.36, g);
    // Elliptical falloff.
    float win = exp(-dot(qr / rad, qr / rad));
    return g * win;
  }

  // filament: a thin bright thread of gas, used for the red streak on the far
  // left. fbm compressed hard on one axis makes a strand.
  float filament(vec2 p, vec2 c, float rot, float len, float t, float life) {
    vec2 q = p - c;
    vec2 qr = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
    // The strand now flows along its own length and ripples sideways.
    qr.x += sin(qr.y * 6.0 + t * 0.9 * life) * 0.010 * life;
    float strand = fbm(vec2(qr.x * 22.0, qr.y * 2.4) + vec2(0.0, t * 0.45 * life));
    float lo = 0.52 - 0.10 * sin(t * 0.7) * life;
    strand = smoothstep(lo, lo + 0.30, strand);
    float win = exp(-qr.x * qr.x / 0.0022) * smoothstep(len, len * 0.25, abs(qr.y));
    return strand * win;
  }

  // galaxySheet: the background field - warm orange elliptical smudges mixed
  // with cooler pinpoints, the signature of a deep JWST frame.
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
        float mag = hash21(cell + seed * 7.1);
        mag *= mag;
        vec2 d = f - pos;
        float isGal = step(0.58, hash21(cell + seed * 11.9));
        float rot = hash21(cell + seed * 2.7) * 6.2831853;
        vec2 dr = vec2(d.x * cos(rot) - d.y * sin(rot), d.x * sin(rot) + d.y * cos(rot));
        dr.y *= 1.0 + hash21(cell + seed * 4.4) * 1.7;
        float galSize = 0.018 + mag * 0.034;
        float gal = exp(-dot(dr, dr) / (galSize * galSize));
        float starSize = 0.007 + mag * 0.015;
        float star = exp(-dot(d, d) / (starSize * starSize))
                   * (0.76 + 0.24 * sin(t * 0.9 + mag * 41.0));
        vec3 galTint  = mix(vec3(0.94, 0.66, 0.34), vec3(0.88, 0.74, 0.48),
                            hash21(cell + seed * 3.3));
        vec3 starTint = mix(vec3(0.88, 0.86, 0.96), vec3(1.00, 0.94, 0.84),
                            hash21(cell + seed * 6.6));
        acc += mix(starTint * star, galTint * gal, isGal) * mag;
      }
    }
    return acc;
  }

  // minorSpikeStar: the smaller six-spike stars scattered around the frame.
  vec3 minorSpikeStar(vec2 p, vec2 pos, float scale, float t, float phase, float life) {
    vec2 q = p - pos;
    float sr = t * 0.07 * life + phase * 0.4;
    q = vec2(q.x * cos(sr) - q.y * sin(sr), q.x * sin(sr) + q.y * cos(sr));
    float r = length(q);
    float b = 1.0 + 0.45 * sin(t * 1.5 + phase) * life;
    vec3 acc = vec3(1.00, 0.96, 0.90) * exp(-r * r / (0.00007 * scale * b)) * 1.7;
    acc += vec3(1.00, 0.90, 0.68) * exp(-r * r / (0.00090 * scale * b)) * 0.42;
    for (int k = 0; k < 3; k++) {
      float a = float(k) * 1.0471976 + 0.5236;
      vec2 d = vec2(cos(a), sin(a));
      float along = abs(dot(q, d));
      float perp  = abs(dot(q, vec2(-d.y, d.x)));
      float ray = exp(-perp * (330.0 / scale)) * exp(-along * (11.0 / scale));
      ray *= 0.55 + 0.45 * sin(t * 1.7 + phase + float(k) * 1.7) * life;
      acc += vec3(1.00, 0.90, 0.66) * ray * 0.52;
    }
    return acc;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    // Time base - see lionshead. Spans "drifting" to "clearly moving".
    float t = uTime * (0.20 + uSpeed * 6.0);

    // life: master motion amount on the Twinkle slider (0..1, live).
    float life = 0.25 + uTwinkle * 1.55;

    // breath: the global pulse the gas and stars ride on.
    float breath = sin(t * 0.50) * 0.62 + sin(t * 0.33 + 1.2) * 0.38;
    float pulse = 1.0 + breath * 0.070 * life;

    // iconZone: dims the left strip where desktop icons live.
    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.6, iconZone);

    // Near-black ground - this reference has deep black between the gas.
    vec3 col = uVoid * 0.6;

    // Background galaxies, two sheets at different scales for depth.
    // Parallax drift, clearly visible rather than a crawl.
    col += galaxySheet(p * 15.0 + vec2(t * 0.070, t * 0.018) * life, t, 3.4, 0.30) * 0.62 * uStars * quiet;
    col += galaxySheet(p * 27.0 + vec2(t * 0.145, -t * 0.050) * life, t, 9.2, 0.34) * 0.34 * uStars * quiet;

    // --- Nebula, painted behind the stars -----------------------------------
    // The gas banks breathe as a group (pulse) and each churns on its own seed.
    vec2 pg = p / pulse;

    // Blue-violet sheet across the top.
    float gTop = gasSheet(pg, vec2(-0.02, 0.26), vec2(0.40, 0.20), -0.25, t, 1.7, life);
    col += vec3(0.42, 0.48, 0.86) * gTop * 0.52 * quiet;

    // Violet sheet upper right.
    float gRight = gasSheet(pg, vec2(aspect * 0.30, 0.14), vec2(0.30, 0.24), 0.5, t, 5.1, life);
    col += vec3(0.56, 0.46, 0.84) * gRight * 0.46 * quiet;

    // Cooler blue-grey sheet lower right.
    float gLowR = gasSheet(pg, vec2(aspect * 0.26, -0.24), vec2(0.30, 0.20), 0.9, t, 8.6, life);
    col += vec3(0.46, 0.54, 0.78) * gLowR * 0.38 * quiet;

    // Rust-orange dust bank, centre-right and below the hero.
    float gDust = gasSheet(pg, vec2(aspect * 0.12, -0.16), vec2(0.24, 0.17), -0.4, t, 12.3, life);
    col += vec3(0.86, 0.44, 0.20) * gDust * 0.46 * quiet;

    // A warmer golden pocket right around the hero, pulsing with its light.
    float gWarm = gasSheet(pg, vec2(-0.03, 0.02), vec2(0.20, 0.15), 0.2, t, 15.9, life);
    col += vec3(0.92, 0.66, 0.30) * gWarm * 0.40 * (0.7 + 0.6 * (0.5 + 0.5 * breath) * life) * quiet;

    // Thin red filament running down the far left.
    float fil = filament(p, vec2(-aspect * 0.36, 0.10), 0.22, 0.30, t, life);
    col += vec3(0.82, 0.30, 0.22) * fil * 0.55 * quiet;

    // The pale crescent arc curling between the two stars.
    float arc = crescentArc(p, vec2(aspect * 0.10, 0.03), 0.115, 0.35, 1.25, t, life);
    col += vec3(0.80, 0.86, 0.92) * arc * 0.60 * quiet;

    // --- The stars ----------------------------------------------------------

    // The hero: placed left of centre but clear of the icon strip. Its spikes
    // are drawn before its core so the core burns through them.
    // The hero drifts slowly through the field rather than sitting pinned.
    vec2 heroPos = vec2(-aspect * 0.05, -0.01)
                 + vec2(sin(t * 0.19), cos(t * 0.23)) * 0.018 * life;
    vec2 hq = p - heroPos;
    col += heroSpikes(hq, 1.0, t, 0.0, life) * 0.80 * uIntensity * quiet;
    col += heroCore(hq, 1.0, t, life) * uIntensity * quiet;

    // The second bright star, upper right of the hero, drifting on its own path.
    vec2 secPos = vec2(aspect * 0.13, 0.075)
                + vec2(cos(t * 0.26 + 2.0), sin(t * 0.21 + 2.0)) * 0.014 * life;
    vec2 sq = p - secPos;
    col += heroSpikes(sq, 0.45, t, 2.3, life) * 0.42 * uIntensity * quiet;
    col += heroCore(sq, 0.45, t, life) * 0.55 * uIntensity * quiet;

    // Minor spike stars scattered around the frame, as in the reference.
    col += minorSpikeStar(p, vec2( aspect * 0.34,  0.34), 1.05, t, 0.7, life) * uIntensity * quiet;
    col += minorSpikeStar(p, vec2( aspect * 0.40, -0.02), 0.80, t, 2.9, life) * uIntensity * quiet;
    col += minorSpikeStar(p, vec2( aspect * 0.22, -0.12), 0.55, t, 4.4, life) * uIntensity * quiet;
    col += minorSpikeStar(p, vec2(-aspect * 0.30, -0.30), 0.60, t, 6.1, life) * uIntensity * quiet;
    col += minorSpikeStar(p, vec2( aspect * 0.42, -0.33), 0.70, t, 7.8, life) * uIntensity * quiet;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) - Tone.js space bed. Brightest frame in the library: C-root
// drone, high sparkle standing in for the spike flare.
export function buildAudio(api) {
  return api.interstellar({
    root: 130.81,
    scale: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25],
    color: 'bright',
    density: 0.40,
    sparkle: 0.80,
    wind: 0.25,
  });
}
