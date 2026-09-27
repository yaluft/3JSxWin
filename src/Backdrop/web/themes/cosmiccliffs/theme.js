// theme.js (cosmiccliffs) - an OPTIONAL scene, lazy-loaded by theme-catalog.js
// the first time it is picked. A per-image replica of NASA Webb's "Cosmic Cliffs"
// in NGC 3324 (Carina), NIRCam: an orange-amber wall of gas, a left-hand thumb
// peak, cyan steam lifting off the ridge, and a deep-blue starfield of NIRCam
// eight-spike suns. Nothing from the JPEG is loaded at runtime - the image was
// a visual reference and every structure below is procedural. See CREDITS.md.

export const id = 'cosmiccliffs';

export const meta = {
  label: 'Cosmic Cliffs',
  blurb: 'NGC 3324 Carina - an amber gas escarpment, a thumb peak, steam off the ridge, NIRCam spike stars',
  silent: true,
};

export const kind = 'shader';

export const fragment = /* glsl */ `
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  // camP: a slow look-around. depth 0 is the far sky, 1 is the cliff face;
  // nearer layers slide more, which is the whole 3D read.
  vec2 camP(vec2 p, float depth, float t) {
    vec2 sway = vec2(sin(t * 0.19) * 0.040, cos(t * 0.15) * 0.024);
    float roll = sin(t * 0.11) * 0.012;
    vec2 q = rot2(p, roll);
    q -= sway * (0.22 + 0.78 * depth);
    q *= 1.0 + 0.012 * sin(t * 0.09) * depth;
    return q;
  }

  // webbStar: NIRCam eight-spike. Spikes stay short - the cliffs are the subject,
  // not the diffraction. Only the brighter class gets blades at all.
  vec3 webbStar(vec2 p, vec2 pos, float mag, float t) {
    vec2 q = p - pos;
    float r = length(q);
    float coreR = 0.0032 + mag * 0.007;
    float pulse = 0.92 + 0.08 * sin(t * 1.15 + mag * 19.0);
    vec3 acc = mix(vec3(1.00, 0.97, 0.92), vec3(0.78, 0.82, 1.00), mag * 0.25)
             * exp(-r * r / (coreR * coreR)) * (0.40 + mag * 1.15) * pulse;
    acc += vec3(0.70, 0.62, 0.85) * exp(-r * 36.0) * mag * 0.22;
    if (mag > 0.50) {
      float spikeGain = (mag - 0.50) * 0.70;
      for (int k = 0; k < 4; k++) {
        float ang = k < 3 ? 0.5235988 + float(k) * 1.0471976 : 0.0;
        vec2 d = vec2(cos(ang), sin(ang));
        float along = abs(dot(q, d));
        float perp  = abs(dot(q, vec2(-d.y, d.x)));
        float thin  = k < 3 ? 210.0 - mag * 40.0 : 260.0;
        float reach = k < 3 ? mix(12.0, 5.2, mag) : mix(14.0, 6.5, mag);
        float ray = exp(-perp * thin) * exp(-along * reach);
        ray *= 0.86 + 0.14 * sin(t * 1.4 + float(k) * 1.9 + mag * 23.0);
        acc += vec3(1.00, 0.90, 0.72) * ray * spikeGain * (k < 3 ? 1.0 : 0.50);
      }
    }
    return acc;
  }

  float pinSheet(vec2 p, float t, float seed, float density) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float acc = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        float present = step(1.0 - density, hash21(cell + seed * 3.7));
        if (present <= 0.0) continue;
        vec2 pos = o + hash22(cell + seed);
        float mag = hash21(cell + seed * 7.1);
        float d = length(f - pos);
        float tw = 0.55 + 0.45 * sin(t * (0.9 + mag * 2.4) + mag * 31.0);
        acc += present * (0.40 + mag * 0.80) * tw * smoothstep(0.036 + mag * 0.04, 0.0, d);
      }
    }
    return acc;
  }

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
        acc += webbStar(f, pos, mag, t) * present;
      }
    }
    return acc;
  }

  // ridgeY: the silhouette of the escarpment. Large rolling + the left thumb
  // peak that makes this frame instantly readable as the Cosmic Cliffs.
  float ridgeY(float x, float t) {
    float h = 0.00;
    h += 0.090 * sin(x * 1.45 + 0.40);
    h += 0.055 * sin(x * 3.20 + 1.55);
    h += 0.095 * (fbm(vec2(x * 2.6 + t * 0.018, 0.35)) - 0.40);
    h += 0.040 * (fbm(vec2(x * 7.0 + 2.2, 1.1)) - 0.45);
    float thumb = exp(-pow((x + 0.52) / 0.090, 2.0));
    h += thumb * 0.230;
    float right = exp(-pow((x - 0.58) / 0.30, 2.0));
    h += right * 0.110;
    return h;
  }

  // wallH: height of the cliff FACE (not the silhouette) - cavities and folds
  // used for Lambert lighting so the wall reads as a 3D volume, not a flat fill.
  float wallH(vec2 p, float t) {
    vec2 q = p * vec2(3.2, 5.2) + vec2(t * 0.016, t * 0.006);
    float n = fbm(q + vec2(fbm(q * 2.4 + 3.7), 0.0) * 0.85);
    n = pow(clamp(n, 0.0, 1.0), 1.35);
    return n;
  }

  vec3 steam(vec2 p, float ridge, float t) {
    float rise = p.y - ridge;
    if (rise < -0.02) return vec3(0.0);
    vec2 q = vec2(p.x * 2.8, rise * 3.6 - t * 0.22);
    vec2 w = vec2(vnoise(q + vec2(t * 0.05, 0.0)), vnoise(q + vec2(4.1, -t * 0.04)));
    float n = fbm(q + (w - 0.5) * 1.35);
    n = smoothstep(0.36, 0.68, n);
    float fade = exp(-max(rise, 0.0) * 2.6) * smoothstep(-0.02, 0.06, rise);
    fade *= 0.50 + 0.50 * smoothstep(-0.7, 0.5, p.x);
    return vec3(0.48, 0.68, 0.98) * n * fade * 0.95;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p0 = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.08 + uSpeed * 0.50);

    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.62, iconZone);

    vec2 pFar  = camP(p0, 0.12, t);
    vec2 pMid  = camP(p0, 0.55, t);
    vec2 pNear = camP(p0, 1.00, t);

    // Deep blue cavity above the wall - the unseen hot stars light this from
    // above the frame, so the sky is brightest just over the ridge.
    float sky = smoothstep(-0.15, 0.55, pFar.y);
    vec3 col = mix(vec3(0.012, 0.016, 0.040), vec3(0.05, 0.12, 0.32), sky);
    col = mix(col, vec3(0.10, 0.28, 0.52), sky * sky * 0.55);

    col += vec3(0.80, 0.86, 1.00) * pinSheet(pFar * 42.0 + vec2(t * 0.012, 0.0), t, 1.2, 0.88) * 0.85 * uStars * quiet;
    col += vec3(0.95, 0.90, 0.75) * pinSheet(pFar * 70.0 + vec2(t * 0.018, -t * 0.005), t, 5.5, 0.90) * 0.48 * uStars * quiet;
    col += starSheet(pFar * 18.0 + vec2(t * 0.012, 0.0), t, 2.1, 0.48) * 0.32 * uStars * quiet;

    col += steam(pMid, ridgeY(pMid.x, t), t) * quiet;

    float ridge = ridgeY(pNear.x, t);
    float below = ridge - pNear.y;
    if (below > -0.03) {
      float h = wallH(pNear, t);
      float e = 0.010;
      float hx = wallH(pNear + vec2(e, 0.0), t) - h;
      float hy = wallH(pNear + vec2(0.0, e), t) - h;
      vec3 n = normalize(vec3(-hx / e, 0.55, 1.0 - hy / e * 0.35));
      vec3 light = normalize(vec3(0.12, 0.92, 0.32));
      float diff = pow(clamp(dot(n, light), 0.0, 1.0), 0.85);

      vec3 dark  = vec3(0.12, 0.06, 0.04);
      vec3 rust  = vec3(0.74, 0.32, 0.12);
      vec3 amber = vec3(0.95, 0.52, 0.22);
      vec3 gold  = vec3(0.98, 0.78, 0.42);
      vec3 albedo = mix(dark, rust, smoothstep(0.14, 0.46, h));
      albedo = mix(albedo, amber, smoothstep(0.40, 0.68, h));
      albedo = mix(albedo, gold,  smoothstep(0.62, 0.88, h) * 0.70);
      float cavity = smoothstep(0.52, 0.22, h);
      albedo *= 1.0 - cavity * 0.55;
      float lane = smoothstep(0.58, 0.78, fbm(pNear * vec2(8.0, 14.0) + 4.4));
      albedo *= 1.0 - lane * 0.40;

      vec3 lit = albedo * (0.16 + 0.84 * diff);
      float rim = exp(-below * below / 0.0032);
      lit += vec3(0.98, 0.76, 0.46) * rim * 0.50 * diff;
      float recede = exp(-max(below, 0.0) * 1.55);
      lit *= 0.42 + 0.58 * recede;
      // Translucent fringes so embedded stars still glitter through thin gas.
      float op = smoothstep(-0.025, 0.050, below) * (0.58 + 0.42 * h);
      op = min(op, 0.94);
      col = mix(col, lit, op * quiet);
    }

    // Hero suns: a handful of fixed NIRCam lighthouses, matching the reference
    // layout - one over the ridge, companions in the blue and in the wall.
    vec3 heroes =
        webbStar(pFar,  vec2( 0.06,  0.34), 0.72, t)
      + webbStar(pFar,  vec2( 0.48,  0.28), 0.62, t)
      + webbStar(pFar,  vec2(-0.38,  0.22), 0.58, t)
      + webbStar(pNear, vec2(-0.62, -0.18), 0.50, t)
      + webbStar(pNear, vec2( 0.58, -0.32), 0.68, t)
      + webbStar(pMid,  vec2( 0.22, -0.08), 0.42, t);
    col += heroes * uIntensity * quiet;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  return api.interstellar({
    root: 82.41,
    scale: [164.81, 196.00, 220.00, 246.94, 329.63, 392.00],
    color: 'gold',
    density: 0.32,
    sparkle: 0.48,
    wind: 0.42,
  });
}
