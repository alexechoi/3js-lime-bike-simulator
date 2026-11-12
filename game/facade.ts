import * as THREE from "three";

// Procedural London facades. Every wall quad carries its length, the
// building height, a style id and a seed; the fragment shader lays out
// shopfronts (with fake interiors), sash windows, string courses, mansards
// and curtain walling on top of real brick / stone textures.

export const STYLE = {
  STONE: 0, // Portland stone (Regent Street)
  BRICK_RED: 1,
  BRICK_STOCK: 2, // London stock brick
  BRICK_BROWN: 3,
  STUCCO: 4,
  CONCRETE: 5, // post-war office, ribbon windows
  GLASS: 6, // curtain wall
  TUDOR: 7, // Liberty
} as const;

const VERT_HEAD = /* glsl */ `
attribute vec2 aUv;
attribute vec4 aInfo;
attribute vec3 aCol;
attribute float aFlag;
varying vec2 vFUv;
flat varying vec4 vInfo;
flat varying vec3 vFCol;
flat varying float vFlag;
varying vec3 vViewTS;
`;

const VERT_BODY = /* glsl */ `
vFUv = aUv;
vInfo = aInfo;
vFCol = aCol;
vFlag = aFlag;
{
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 V = wp - cameraPosition;
  vec3 T = vec3(-normal.z, 0.0, normal.x);
  vViewTS = vec3(dot(V, T), V.y, dot(V, normal));
}
`;

const FRAG_HEAD = /* glsl */ `
uniform sampler2D tStone;
uniform sampler2D tBrickR;
uniform sampler2D tBrickY;
uniform sampler2D tBrickB;
uniform sampler2D tSlate;
varying vec2 vFUv;
flat varying vec4 vInfo;
flat varying vec3 vFCol;
flat varying float vFlag;
varying vec3 vViewTS;
float fGlass;
float fRough;
vec3 fEmis;
float fHeight;
float fBumpK;

float h1(float n) { return fract(sin(n * 91.345) * 47453.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 bumpNormal(vec3 pos, vec3 n, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(pos));
  vec3 sy = normalize(dFdy(pos));
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * n - grad);
}
vec3 hue(float t) { return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67))); }

// A cheap room behind the glass: back wall with shelving, lit ceiling,
// floor and side walls, plus a row of display figures near the window.
vec3 interior(vec2 p, float W, float Ht, vec3 dir, float seed) {
  float D = 4.0 + 3.0 * h1(seed);
  dir.z = max(dir.z, 0.06);
  float tb = D / dir.z;
  float tx = dir.x > 0.0 ? (W - p.x) / dir.x : (dir.x < 0.0 ? -p.x / dir.x : 1e5);
  float ty = dir.y > 0.0 ? (Ht - p.y) / dir.y : (dir.y < 0.0 ? -p.y / dir.y : 1e5);
  float t = min(tb, min(tx, ty));
  vec3 hp = vec3(p, 0.0) + dir * t;
  vec3 accent = mix(vec3(0.78, 0.74, 0.68), hue(h1(seed * 3.1)), 0.3);
  vec3 c;
  if (t == tb) {
    vec2 q = hp.xy * vec2(1.5, 2.1);
    float shelf = step(0.1, fract(q.y));
    float item = h2(floor(q) + seed * 7.0);
    c = mix(vec3(0.2), mix(accent, hue(item), 0.5 * step(0.3, item)), shelf) * 0.85;
  } else if (t == ty) {
    if (dir.y > 0.0) {
      vec2 q = fract(hp.xz / vec2(1.7, 1.9));
      float lamp = step(abs(q.x - 0.5), 0.2) * step(abs(q.y - 0.5), 0.32);
      c = mix(vec3(0.72, 0.7, 0.66), vec3(2.6, 2.5, 2.2), lamp);
    } else {
      c = vec3(0.4, 0.34, 0.28) * (0.8 + 0.2 * step(0.5, fract(hp.x * 0.9)));
    }
  } else {
    c = accent * 0.85;
  }
  c *= exp(-t * 0.1) * (0.7 + 0.6 * h1(seed * 5.3));
  // display figures 0.7 m behind the glass
  float tm = 0.7 / dir.z;
  if (tm < t) {
    vec2 m = p + dir.xy * tm;
    float cell = floor(m.x / 1.15);
    float pick = h2(vec2(cell, seed * 3.7));
    if (pick > 0.35) {
      float cx = (fract(m.x / 1.15) - 0.5) * 1.15;
      float body = step(abs(cx), 0.2 - 0.05 * smoothstep(0.9, 1.5, m.y)) * step(0.55, m.y) * step(m.y, 1.5);
      float head = step(length(vec2(cx, m.y - 1.64)), 0.11);
      float plinth = step(abs(cx), 0.3) * step(m.y, 0.55) * step(0.3, m.y);
      vec3 cloth = mix(hue(pick * 7.0), vec3(0.12), step(0.7, h1(pick * 31.0)));
      c = mix(c, cloth * 0.9, body);
      c = mix(c, vec3(0.75, 0.72, 0.68), head);
      c = mix(c, vec3(0.9), plinth * 0.8);
    }
  }
  return c;
}

void glassAt(inout vec3 col, float lit) {
  float cosv = abs(vViewTS.z) / max(length(vViewTS), 1e-3);
  float fr = pow(1.0 - cosv, 3.0);
  col = mix(vec3(0.035, 0.045, 0.055), vec3(0.62, 0.68, 0.74), 0.3 + 0.7 * fr);
  fGlass = 1.0;
  // what a pane mirrors: the far side of the street when you look level, sky when you look up
  float upv = vViewTS.y / max(length(vViewTS), 1e-3);
  vec3 refl = mix(vec3(0.16, 0.16, 0.15), vec3(0.52, 0.63, 0.78), smoothstep(-0.05, 0.42, upv));
  fEmis = vec3(1.0, 0.82, 0.58) * lit + refl * (0.2 + 0.5 * fr);
}

void shopfront(inout vec3 col, vec3 base, vec3 trim, float L, float seed, float u, float v, float style) {
  float nS = max(1.0, floor(L / 5.6 + 0.5));
  float sw = L / nS;
  float sx = u / sw;
  float si = floor(sx);
  float su = fract(sx) * sw;
  float sid = seed * 17.0 + si;
  float k = h1(seed * 9.1 + si * 0.37);
  vec3 frame = k < 0.34 ? vec3(0.02) : k < 0.5 ? vec3(0.015, 0.06, 0.04) : k < 0.63 ? vec3(0.02, 0.035, 0.1)
    : k < 0.75 ? vec3(0.14, 0.02, 0.03) : k < 0.88 ? vec3(0.32, 0.32, 0.3) : vec3(0.78, 0.76, 0.7);
  if (v > 3.5) {
    // fascia band and the cornice strip above it
    col = v > 4.18 ? trim * (v > 4.28 ? 0.95 : 0.6) : frame;
    fRough = 0.55;
    return;
  }
  float pil = 0.3;
  if (su < pil || su > sw - pil) {
    col = base;
    if (style < 0.5) col *= 1.0 - 0.22 * step(fract(v / 0.5), 0.06);
    if (v < 0.35) col *= 0.7;
    return;
  }
  float dpos = pil + 0.25 + h1(sid) * max(0.0, sw - 2.0 * pil - 1.7);
  bool door = su > dpos && su < dpos + 1.15;
  bool fr = false;
  if (v > 3.4) fr = true;
  if (!door && v < 0.55) fr = true;
  if (door && v < 0.12) fr = true;
  if (abs(v - 2.72) < 0.04) fr = true;
  if (door) {
    if (su - dpos < 0.07 || dpos + 1.15 - su < 0.07) fr = true;
  } else {
    float gx = su - pil;
    float sp = 1.7;
    float m = fract(gx / sp) * sp;
    if (m < 0.035 || m > sp - 0.035) fr = true;
  }
  if (su - pil < 0.07 || sw - pil - su < 0.07) fr = true;
  if (fr) {
    col = frame;
    fRough = 0.4;
    return;
  }
  vec3 dir = normalize(vec3(vViewTS.x, vViewTS.y, -vViewTS.z));
  vec3 room = interior(vec2(su, v), sw, 3.5, dir, sid);
  float cosv = abs(vViewTS.z) / max(length(vViewTS), 1e-3);
  float frn = pow(1.0 - cosv, 4.0);
  col = mix(vec3(0.02), vec3(0.6, 0.66, 0.72), frn);
  fEmis = room * 0.55 * (1.0 - frn);
  fGlass = 0.2 + 0.8 * frn;
}

void facade(inout vec3 col) {
  fGlass = 0.0;
  fRough = -1.0;
  fEmis = vec3(0.0);
  fHeight = 0.0;
  fBumpK = 0.0;
  float L = vInfo.x, H = vInfo.y, style = vInfo.z, seed = floor(vInfo.w * 500.0 + 0.5) / 500.0;
  float u = vFUv.x, v = vFUv.y;
  vec3 tint = vFCol;
  if (vFlag > 2.5) {
    float n = vnoise(vFUv * 0.6) * 0.6 + vnoise(vFUv * 3.0) * 0.4;
    col = mix(vec3(0.2, 0.21, 0.22), vec3(0.34, 0.33, 0.31), n) * (0.75 + 0.5 * h1(seed));
    return;
  }
  vec2 tuv = vec2(u, v);
  vec3 base;
  vec3 trim = vec3(0.8, 0.77, 0.69);
  if (style < 0.5) {
    vec3 t = texture2D(tStone, tuv / 2.1).rgb;
    float lum = dot(t, vec3(0.333));
    // Portland stone ashlar: 38 cm courses with staggered joints
    float course = floor(v / 0.38);
    float jy = fract(v / 0.38);
    float bxs = u / 0.95 + 0.5 * mod(course, 2.0);
    float joint = max(step(jy, 0.04), step(fract(bxs), 0.016));
    float tone = 0.93 + 0.12 * h2(vec2(floor(bxs), course));
    base = tint * tone * mix(1.0, lum * 2.0, 0.14) * (1.0 - 0.2 * joint);
    fHeight = (1.0 - joint) * 0.45 + lum * 0.12;
    trim = base * 1.06;
  } else if (style < 1.5) {
    vec3 t = texture2D(tBrickR, tuv / 0.95).rgb;
    base = t * tint * 1.5;
    fHeight = dot(t, vec3(0.5));
  } else if (style < 2.5) {
    vec3 t = texture2D(tBrickY, tuv / 0.95).rgb;
    base = t * tint * 1.25;
    fHeight = dot(t, vec3(0.4));
  } else if (style < 3.5) {
    vec3 t = texture2D(tBrickB, tuv / 0.95).rgb;
    base = t * tint * 1.5;
    fHeight = dot(t, vec3(0.5));
  } else if (style < 4.5) {
    base = tint * (0.92 + 0.1 * vnoise(tuv * 1.3));
    trim = min(base * 1.08, vec3(0.95));
  } else if (style < 6.5) {
    base = tint * (0.93 + 0.08 * vnoise(tuv * 2.5));
    trim = base;
  } else {
    base = vec3(0.86, 0.84, 0.78);
  }
  // rain streaks and soot: London is not clean
  float grime = vnoise(vec2(u * 1.1, v * 0.16)) * 0.55 + vnoise(vec2(u * 3.3, v * 0.5)) * 0.45;
  base *= 0.84 + 0.22 * grime;
  if (vFlag < 0.5) {
    col = base * 0.8;
    return;
  }
  bool shop = vFlag > 1.5;
  float gH = shop ? 4.35 : 0.0;
  float top = H - 0.9;
  if (shop && v < gH) {
    shopfront(col, base, trim, L, seed, u, v, style);
    return;
  }
  bool modern = style > 4.5 && style < 6.5;
  if (v > top) {
    float kk = (v - top) / 0.9;
    col = modern ? base * 0.85 : trim * (kk < 0.22 ? 0.62 : (kk > 0.8 ? 1.05 : 0.95));
    return;
  }
  float span = max(top - gH, 2.0);
  float nF = max(1.0, floor(span / (modern ? 3.7 : 3.35) + 0.5));
  float fh = span / nF;
  float fy = (v - gH) / fh;
  float fi = floor(fy);
  float fv = fract(fy);
  float target = modern ? 1.5 : mix(2.3, 3.3, h1(seed * 1.7));
  if (style > 6.5) target = 2.2;
  float nB = max(1.0, floor(L / target + 0.5));
  float bw = L / nB;
  float bx = u / bw;
  float bi = floor(bx);
  float bu = fract(bx);
  float wid = h2(vec2(bi, fi) + seed * 13.0);
  float lit = wid > 0.86 ? 0.16 : 0.0;

  if (modern) {
    float sp = style < 5.5 ? 0.3 : 0.1;
    float mull = style < 5.5 ? 0.08 : 0.05;
    bool isGlass = fv > sp && (0.5 - abs(bu - 0.5)) * bw > mull && (1.0 - fv) * fh > 0.06;
    if (isGlass) {
      glassAt(col, lit);
      if (wid > 0.55 && wid < 0.7 && fv > 0.62) { col = vec3(0.7, 0.7, 0.66); fGlass = 0.0; fEmis = vec3(0.0); }
    } else {
      col = fv > sp ? vec3(0.1, 0.105, 0.11) : base;
      if (fv <= sp && fv > sp - 0.02) col *= 0.6;
    }
    return;
  }

  if (style > 6.5) {
    // half-timbering
    float cu = fract(u / 1.1);
    float beam = step(abs(cu - 0.5), 0.46) < 0.5 ? 1.0 : 0.0;
    if (fv * fh < 0.22 || (1.0 - fv) * fh < 0.1) beam = 1.0;
    float cid = floor(u / 1.1) + fi * 7.0;
    if (h1(cid + seed) > 0.6 && abs(cu - fv) < 0.07) beam = 1.0;
    if (h1(cid + seed) < 0.2 && abs(1.0 - cu - fv) < 0.07) beam = 1.0;
    col = mix(base * (0.9 + 0.1 * grime), vec3(0.035, 0.03, 0.028), beam);
    float dxw = (abs(bu - 0.5) - 0.3) * bw;
    float dyw = max(0.3 - fv, fv - 0.78) * fh;
    if (max(dxw, dyw) < 0.0) {
      vec2 lead = fract(vec2(u, v) / 0.16);
      if (lead.x < 0.12 || lead.y < 0.12 || max(dxw, dyw) > -0.07) { col = vec3(0.04); }
      else glassAt(col, lit);
    }
    return;
  }

  bool mansard = h1(seed * 2.3) > 0.42 && nF > 2.5 && fi > nF - 1.5;
  float ww = mix(0.22, 0.32, h1(seed * 4.1));
  float lo = 0.17, hi = 0.8;
  if (fi < 0.5 && nF > 1.5) { lo = 0.1; hi = 0.86; }
  if (fi > nF - 1.5 && nF > 2.5) { lo = 0.24; hi = 0.76; }
  col = base;
  if (mansard) {
    ww *= 0.72;
    lo = 0.16;
    hi = 0.7;
    vec3 sl = texture2D(tSlate, tuv / 2.6).rgb;
    col = sl * vec3(0.5, 0.55, 0.62) * (0.9 + 0.2 * grime);
    if (fv * fh < 0.3) col = trim * (fv * fh < 0.1 ? 0.6 : 0.95); // cornice under the roof
  } else {
    if (style < 0.5 && fi < 0.5) col *= 1.0 - 0.22 * step(fract(v / 0.5), 0.06); // rusticated piano nobile
    if (fv * fh < 0.2 && (style < 0.5 || style > 3.5 || fi < 0.5)) col = trim * (fv * fh < 0.05 ? 0.65 : 0.97); // string course
    // pilaster strips on the grander stone fronts
    if (style < 0.5 && h1(seed * 6.7) > 0.5 && abs(bu - 0.5) * bw > bw * 0.5 - 0.22) col = trim * 1.02;
  }
  float dx = (abs(bu - 0.5) - ww) * bw;
  float dy = max(lo - fv, fv - hi) * fh;
  float d = max(dx, dy);
  if (d < 0.0) {
    float fx = ww * 2.0 * bw;
    float fyh = (hi - lo) * fh;
    float wu = (bu - 0.5 + ww) / (2.0 * ww);
    float wv = (fv - lo) / (hi - lo);
    float ex = min(wu, 1.0 - wu) * fx;
    float ey = min(wv, 1.0 - wv) * fyh;
    bool frame = min(ex, ey) < 0.075 || abs(wv - 0.5) * fyh < 0.035;
    if (style > 0.5 && style < 4.5 && abs(wu - 0.5) * fx < 0.02) frame = true;
    if (style > 0.5 && style < 3.5 && (abs(wv - 0.25) * fyh < 0.014 || abs(wv - 0.75) * fyh < 0.014)) frame = true;
    if (frame) {
      col = h1(seed * 8.3) > 0.75 ? vec3(0.05, 0.05, 0.055) : vec3(0.82, 0.81, 0.78);
      fRough = 0.5;
    } else if (wid > 0.6 && wid < 0.8 && wv > 1.0 - (wid - 0.56) * 2.6) {
      col = vec3(0.74, 0.72, 0.64) * (0.85 + 0.15 * step(0.5, fract(wv * 22.0))); // blind
    } else {
      glassAt(col, lit);
    }
    // the reveal throws a shadow across the top of the opening
    float sh = smoothstep(0.0, 0.22, (hi - fv) * fh);
    col *= 0.45 + 0.55 * sh;
    fEmis *= sh;
  } else if (d < 0.17 && !mansard && style > 0.5 && style < 3.5) {
    col = trim * (dy > dx && fv < lo ? 0.8 : 1.0); // stone dressings on brick
  } else if (d < 0.13 && (style < 0.5 || style > 3.5 || mansard)) {
    col = mansard ? vec3(0.8, 0.8, 0.77) : min(base * 1.12, vec3(1.0));
    if (dy > dx && fv < lo) col *= 0.75;
  } else if (!mansard && dx < 0.0 && fv < lo && (lo - fv) * fh < 0.28 && (lo - fv) * fh > 0.17) {
    col *= 0.7; // shadow under the sill
  }
}
`;

export function makeFacadeMaterial(tex: {
  stone: THREE.Texture;
  brickR: THREE.Texture;
  brickY: THREE.Texture;
  brickB: THREE.Texture;
  slate: THREE.Texture;
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, envMapIntensity: 1.0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tStone = { value: tex.stone };
    sh.uniforms.tBrickR = { value: tex.brickR };
    sh.uniforms.tBrickY = { value: tex.brickY };
    sh.uniforms.tBrickB = { value: tex.brickB };
    sh.uniforms.tSlate = { value: tex.slate };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_HEAD)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERT_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_HEAD)
      .replace("#include <color_fragment>", "#include <color_fragment>\nfacade(diffuseColor.rgb);\nfBumpK = (fGlass < 0.01 && fRough < 0.0 && vFlag < 2.5) ? 0.9 : 0.0;")
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nif (fRough > 0.0) roughnessFactor = fRough;\nroughnessFactor = mix(roughnessFactor, 0.04, fGlass);",
      )
      .replace(
        "#include <normal_fragment_maps>",
        "#include <normal_fragment_maps>\nif (fBumpK > 0.0) normal = bumpNormal(-vViewPosition, normal, vec2(dFdx(fHeight), dFdy(fHeight)) * fBumpK, faceDirection);",
      )
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = fGlass;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmis;");
  };
  mat.customProgramCacheKey = () => "soho-facade";
  return mat;
}
