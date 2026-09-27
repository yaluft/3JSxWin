// theme.js (southring) - an OPTIONAL scene, lazy-loaded by theme-catalog.js
// the first time it is picked. A per-image replica of NASA Webb's NIRCam
// Southern Ring Nebula (NGC 3132): a 3D hollow shell, cyan inner cavity,
// thick orange-gold rings, rust outer halo with radial spokes, a bright
// central star plus its dimmer companion, and a field of background galaxies.
// Nothing from the PNG is loaded at runtime - visual reference only.
// See CREDITS.md.

export const id = 'southring';

export const meta = {
  label: 'Southern Ring',
  blurb: 'NGC 3132 - a 3D hollow shell, cyan cavity, gold rings, radial spokes, a binary at the heart',
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

  float sdEllipsoid(vec3 p, vec3 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-4);
  }

  vec3 webbStar(vec2 p, vec2 pos, float mag, float t) {
    vec2 q = p - pos;
    float r = length(q);
    float coreR = 0.0030 + mag * 0.0075;
    float pulse = 0.92 + 0.08 * sin(t * 1.10 + mag * 18.0);
    vec3 acc = mix(vec3(1.00, 0.96, 0.98), vec3(0.72, 0.78, 1.00), mag * 0.35)
             * exp(-r * r / (coreR * coreR)) * (0.42 + mag * 1.20) * pulse;
    acc += vec3(0.70, 0.55, 0.95) * exp(-r * 32.0) * mag * 0.28;
    if (mag > 0.48) {
      float spikeGain = (mag - 0.48) * 0.75;
      for (int k = 0; k < 4; k++) {
        float ang = k < 3 ? 0.5235988 + float(k) * 1.0471976 : 0.0;
        vec2 d = vec2(cos(ang), sin(ang));
        float along = abs(dot(q, d));
        float perp  = abs(dot(q, vec2(-d.y, d.x)));
        float thin  = k < 3 ? 200.0 - mag * 40.0 : 250.0;
        float reach = k < 3 ? mix(11.0, 4.8, mag) : mix(13.0, 6.0, mag);
        float ray = exp(-perp * thin) * exp(-along * reach);
        ray *= 0.85 + 0.15 * sin(t * 1.25 + float(k) * 1.8 + mag * 20.0);
        acc += vec3(0.92, 0.82, 1.00) * ray * spikeGain * (k < 3 ? 1.0 : 0.50);
      }
    }
    return acc;
  }

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
        float roll = hash21(cell + seed * 9.31);
        float mag = hash21(cell + seed * 3.7);
        mag *= mag;
        vec2 q = rot2(f - pos, roll * 6.2831);
        q.y /= mix(1.0, 3.0, hash21(cell + seed * 13.7));
        float d = length(q);
        float size = 0.040 + mag * 0.09;
        float body = exp(-d * d / (size * size));
        vec3 tint = mix(vec3(0.95, 0.70, 0.32), vec3(0.70, 0.42, 0.18), roll);
        if (roll > 0.82) tint = vec3(0.72, 0.80, 1.00);
        acc += tint * body * mag * (0.60 + 0.40 * sin(t * 0.55 + roll * 17.0));
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
        float present = step(1.0 - density, hash21(cell + seed * 4.3));
        if (present <= 0.0) continue;
        vec2 pos = o + hash22(cell + seed);
        float mag = hash21(cell + seed * 8.1);
        mag *= mag;
        acc += webbStar(f, pos, mag * 0.85, t) * present;
      }
    }
    return acc;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.07 + uSpeed * 0.42);

    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.60, iconZone);

    // Slow 3D orbit: camera circles the shell so the cavity reads as a volume
    // you are sitting in front of, not a flat oval.
    float orbit = t * 0.075;
    vec2 sway = vec2(sin(orbit) * 0.045, cos(t * 0.11) * 0.028);
    vec2 pFar = p - sway * 0.25;
    vec2 pObj = rot2(p - vec2(0.07, 0.02) - sway * 0.85, sin(t * 0.09) * 0.04);

    vec3 col = vec3(0.008, 0.008, 0.014);
    col += galaxySheet(pFar * 22.0 + vec2(t * 0.008, 0.0), t, 2.4, 0.72) * 0.55 * uStars * quiet;
    col += galaxySheet(pFar * 44.0 + vec2(t * 0.014, -t * 0.004), t, 7.1, 0.80) * 0.32 * uStars * quiet;
    col += starSheet(pFar * 16.0, t, 3.3, 0.28) * 0.40 * uStars * quiet;

    // Volume march of a tilted ellipsoid shell. 12 steps is enough for the
    // inner cyan wall vs outer gold thickness to separate in depth.
    vec3 ro = vec3(sin(orbit) * 0.26, 0.10 + cos(t * 0.10) * 0.05, -2.20);
    vec3 rd = normalize(vec3(pObj.x, pObj.y, 1.50));
    vec3 acc = vec3(0.0);
    float trans = 1.0;
    float z = 0.55;
    for (int i = 0; i < 12; i++) {
      vec3 pos = ro + rd * z;
      pos.xz = rot2(pos.xz, t * 0.055);
      pos.xy = rot2(pos.xy, -0.22);
      float dOut = sdEllipsoid(pos, vec3(0.98, 1.18, 0.70));
      float dIn  = sdEllipsoid(pos, vec3(0.40, 0.50, 0.32));
      float n = vnoise(pos.xy * 4.2 + vec2(pos.z * 1.7, t * 0.04));
      float shell = smoothstep(0.10, -0.02, dOut) * smoothstep(-0.03, 0.07, dIn);
      if (dIn < 0.0 && dOut < 0.0) {
        float fog = 0.055 * (0.55 + 0.45 * n) * exp(dIn * 1.8);
        acc += trans * vec3(0.32, 0.72, 0.92) * fog;
        trans *= 0.975;
      }
      if (shell > 0.012) {
        float dens = shell * (0.22 + 0.78 * n);
        float innerness = smoothstep(0.14, -0.01, dIn);
        vec3 c = mix(vec3(0.68, 0.28, 0.08), vec3(0.42, 0.82, 0.98), innerness);
        c = mix(c, vec3(0.96, 0.62, 0.28), n * (1.0 - innerness) * 0.75);
        float a = dens * 0.26;
        acc += trans * c * a * 1.35;
        trans *= (1.0 - a);
      }
      z += 0.145;
    }
    col += acc * quiet;

    // 2D rim + spokes on top of the volume so the inner cavity stays crisp
    // even when the march is coarse. Polar frame of the same tilted ellipse.
    vec2 q = rot2(pObj, -0.28 + t * 0.04);
    q /= vec2(1.08, 0.86);
    float r = length(q);
    float ang = atan(q.y, q.x);
    float zFake = q.x * 0.22 + q.y * 0.14;
    float rIn  = 0.205 * (1.0 + zFake * 0.28);
    float rOut = 0.455 * (1.0 + zFake * 0.22);
    float innerLimb = exp(-pow(r - rIn, 2.0) / 0.00115);
    float innerFill = 1.0 - smoothstep(rIn - 0.04, rIn + 0.01, r);
    float innerCloud = 0.45 + 0.55 * fbm(q * 5.2 + vec2(t * 0.04, 0.0));
    float outerBand = smoothstep(rIn, rIn + 0.04, r) * smoothstep(rOut + 0.05, rOut - 0.02, r);
    float grain = 0.55 + 0.45 * fbm(q * 6.5 + vec2(t * 0.03, 0.0));
    col += vec3(0.28, 0.62, 0.82) * innerFill * innerCloud * 0.55 * quiet;
    col += vec3(0.50, 0.88, 1.00) * innerLimb * 0.95 * quiet;
    col += vec3(0.92, 0.55, 0.22) * outerBand * grain * 0.50 * quiet;

    float halo = smoothstep(rOut + 0.28, rOut, r) * smoothstep(rIn, rOut, r);
    float spoke = pow(0.55 + 0.45 * vnoise(vec2(ang * 12.0, t * 0.12)), 2.2);
    spoke *= 0.65 + 0.35 * sin(ang * 28.0 + t * 0.20);
    col += vec3(0.55, 0.18, 0.06) * halo * spoke * 0.55 * quiet;

    // Binary engine: bright NIRCam star at the cavity centre, dimmer companion
    // sitting on a spike - the NASA caption's "supporting role" star.
    vec2 heart = vec2(0.07, 0.02) + sway * 0.85;
    col += webbStar(p, heart, 0.78, t) * uIntensity * quiet;
    col += webbStar(p, heart + vec2(-0.055, -0.018), 0.38, t) * uIntensity * quiet;
    col += webbStar(p, vec2(0.62, -0.38), 0.68, t) * uIntensity * quiet;
    col += webbStar(p, vec2(-0.58, 0.32), 0.42, t) * uIntensity * quiet;
    col += webbStar(p, vec2(-0.42, -0.40), 0.36, t) * uIntensity * quiet;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  return api.interstellar({
    root: 73.42,
    scale: [146.83, 174.61, 220.00, 293.66, 329.63, 440.00],
    color: 'cold',
    density: 0.26,
    sparkle: 0.44,
    wind: 0.30,
  });
}
