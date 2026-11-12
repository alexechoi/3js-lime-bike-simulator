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
attribute vec4 aLay;
varying vec2 vFUv;
flat varying vec4 vInfo;
flat varying vec3 vFCol;
flat varying float vFlag;
flat varying vec4 vLay;
varying vec3 vViewTS;
`;

const VERT_BODY = /* glsl */ `
vFUv = aUv;
vInfo = aInfo;
vFCol = aCol;
vFlag = aFlag;
vLay = aLay;
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
flat varying vec4 vLay;
varying vec3 vViewTS;
bool layBit(float n) { return mod(floor(vLay.z / n + 0.01), 2.0) > 0.5; }
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

// Shelving, rails and stock on a wall, in metres.
vec3 shelfWall(vec2 q, float seed, vec3 wall) {
  vec2 g = q * vec2(2.3, 2.7);
  vec2 id = floor(g);
  vec2 f = fract(g);
  float item = h2(id + seed * 7.0);
  vec3 ic = mix(vec3(0.42), hue(item + seed), 0.4) * (0.45 + 0.55 * h2(id * 1.7 + 3.0));
  float fill = step(0.1, f.x) * step(f.x, 0.92) * step(0.14, f.y) * step(f.y, 0.22 + 0.72 * h2(id + 11.0));
  vec3 c = mix(wall * 0.4, ic, fill * step(0.2, item));
  c *= 1.0 - 0.65 * step(f.y, 0.1);
  return c;
}

// A room behind the glass, ray-marched against a box: three shop layouts
// (fashion, food counter, general store) with their own fittings and light.
vec3 interior(vec2 p, float W, float Ht, vec3 dir, float seed) {
  float D = 4.5 + 4.0 * h1(seed);
  float shopKind = h1(seed * 2.9);
  dir.z = max(dir.z, 0.06);
  float tb = D / dir.z;
  float tx = dir.x > 0.0 ? (W - p.x) / dir.x : (dir.x < 0.0 ? -p.x / dir.x : 1e5);
  float ty = dir.y > 0.0 ? (Ht - p.y) / dir.y : (dir.y < 0.0 ? -p.y / dir.y : 1e5);
  float t = min(tb, min(tx, ty));
  vec3 hp = vec3(p, 0.0) + dir * t;
  vec3 lightC = mix(vec3(1.0, 0.84, 0.62), vec3(0.9, 0.95, 1.0), step(0.55, h1(seed * 4.7)));
  vec3 wallC = shopKind < 0.36 ? vec3(0.74, 0.72, 0.68)
    : shopKind < 0.68 ? mix(vec3(0.42, 0.34, 0.26), hue(h1(seed * 3.1)) * 0.5, 0.25) : vec3(0.72, 0.72, 0.69);
  vec3 c;
  if (t == tb) {
    c = shelfWall(hp.xy, seed, wallC);
    if (shopKind >= 0.36 && shopKind < 0.68) {
      float bx = fract(hp.x / 1.4);
      float board = step(2.05, hp.y) * step(hp.y, 2.95) * step(0.07, bx) * step(bx, 0.93);
      vec3 bc = vec3(0.04) + 0.55 * step(0.62, fract(hp.y * 9.0)) * step(h2(floor(vec2(hp.x * 3.0, hp.y * 9.0))), 0.6);
      c = mix(c, bc, board);
    }
  } else if (t == ty) {
    vec2 q = fract(hp.xz / vec2(1.3, 1.5));
    if (dir.y > 0.0) {
      float lamp = 1.0 - smoothstep(0.05, 0.11, length(q - 0.5));
      c = mix(vec3(0.5, 0.5, 0.5), vec3(2.6), lamp);
      if (shopKind >= 0.68) c = mix(c, vec3(2.2), step(abs(q.x - 0.5), 0.06));
    } else {
      float plank = h2(floor(hp.xz / vec2(0.18, 1.3)));
      c = (shopKind < 0.68 ? vec3(0.3, 0.21, 0.14) : vec3(0.44, 0.44, 0.42)) * (0.7 + 0.3 * plank) * step(0.03, fract(hp.x / 0.18));
      c += 0.22 * (1.0 - smoothstep(0.0, 0.55, length(q - 0.5))); // pools of light under the downlights
    }
  } else {
    c = wallC * 0.75;
    float fz = fract(hp.z / 1.9);
    if (fz < 0.6 && hp.y > 1.0 && hp.y < 2.3) c = mix(c, hue(h1(floor(hp.z / 1.9) + seed)) * 0.4 + 0.15, 0.6 * step(0.05, fz) * step(fz, 0.55));
  }
  float lightAmt = (0.95 + 0.5 * h1(seed * 5.3)) * exp(-t * 0.045);
  c *= lightAmt * lightC;

  if (shopKind < 0.36) {
    // window display: dressed figures on plinths, 0.7 m behind the glass
    float tm = 0.7 / dir.z;
    if (tm < t) {
      vec2 m = p + dir.xy * tm;
      float cell = floor(m.x / 1.15);
      float pick = h2(vec2(cell, seed * 3.7));
      if (pick > 0.3) {
        float cx = (fract(m.x / 1.15) - 0.5) * 1.15;
        float taper = 0.2 - 0.05 * smoothstep(0.9, 1.5, m.y) + 0.03 * step(m.y, 0.95);
        float body = step(abs(cx), taper) * step(0.55, m.y) * step(m.y, 1.5);
        float arms = step(abs(abs(cx) - 0.25), 0.045) * step(0.85, m.y) * step(m.y, 1.45);
        float head = step(length(vec2(cx, m.y - 1.64) * vec2(1.0, 0.85)), 0.1);
        float plinth = step(abs(cx), 0.32) * step(m.y, 0.55) * step(0.34, m.y);
        vec3 cloth = mix(mix(vec3(0.3), hue(pick * 7.0), 0.45), vec3(0.06), step(0.6, h1(pick * 31.0)));
        float shade = 0.75 + 0.25 * smoothstep(-0.2, 0.2, cx);
        vec3 lit = lightC * (0.95 + 0.4 * h1(seed * 5.3));
        c = mix(c, cloth * shade * lit, max(body, arms));
        c = mix(c, vec3(0.62, 0.6, 0.57) * shade * lit, head);
        c = mix(c, vec3(0.8) * lit, plinth * 0.9);
      }
    }
  } else if (shopKind < 0.68) {
    // counter across the shop, pendant lamps over it
    float tm = 2.4 / dir.z;
    if (tm < t) {
      vec2 m = p + dir.xy * tm;
      float fx = m.x / W;
      if (m.y < 1.08 && fx > 0.12 && fx < 0.95) {
        vec3 cc = m.y > 1.0 ? vec3(0.5, 0.48, 0.44) : vec3(0.16, 0.11, 0.07) * (0.8 + 0.2 * step(0.5, fract(m.x / 0.6)));
        c = cc * lightAmt * lightC * 1.3;
      }
    }
    float tl = 1.5 / dir.z;
    if (tl < t) {
      vec2 m = p + dir.xy * tl;
      float cx = (fract(m.x / 1.25) - 0.5) * 1.25;
      float glow = 1.0 - smoothstep(0.05, 0.13, length(vec2(cx, m.y - 2.3)));
      float flex = step(abs(cx), 0.008) * step(2.3, m.y);
      c = mix(c, vec3(0.03), flex);
      c += lightC * 1.8 * glow;
    }
  } else {
    // gondola shelving running into the shop
    float tm = 1.7 / dir.z;
    if (tm < t) {
      vec2 m = p + dir.xy * tm;
      if (m.y < 1.5 && fract(m.x / 2.6) < 0.72) c = shelfWall(m, seed + 3.0, vec3(0.5)) * lightC * (0.55 + 0.4 * h1(seed * 5.3));
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
  // vinyl on the glass: sale banners, frosted privacy bands, door furniture
  float deco = 0.0;
  vec3 decoC = vec3(0.0);
  if (door) {
    float hx = su - dpos;
    if (abs(hx - 0.95) < 0.025 && v > 0.9 && v < 1.5) { col = vec3(0.6, 0.6, 0.58); fRough = 0.25; fGlass = 0.6; return; }
    if (hx > 0.3 && hx < 0.75 && v > 1.45 && v < 1.75) { deco = 0.85; decoC = vec3(0.9) * step(0.35, fract(v * 14.0)) + vec3(0.05); }
  } else {
    float gx = su - pil;
    float pane = floor(gx / 1.7);
    float pu = fract(gx / 1.7);
    float ph = h1(sid * 2.1 + pane * 3.3);
    if (ph > 0.9 && pu > 0.14 && pu < 0.86 && v > 1.25 && v < 2.25) {
      float txt = step(0.25, fract(v * 2.9)) * step(0.2, pu) * step(pu, 0.8) * step(h2(floor(vec2(pu * 9.0, v * 2.9)) + sid), 0.75);
      deco = 0.92;
      decoC = mix(ph > 0.95 ? vec3(0.7, 0.04, 0.06) : mix(vec3(0.08), hue(ph * 40.0) * 0.5, 0.5), vec3(0.95), txt);
    } else if (h1(sid * 1.3) > 0.62 && v > 0.95 && v < 1.22) {
      deco = 0.55;
      decoC = vec3(0.8, 0.82, 0.84);
    } else if (ph < 0.12 && pu > 0.3 && pu < 0.7 && v > 1.6 && v < 2.5) {
      deco = 0.9;
      decoC = mix(hue(ph * 8.0) * 0.6, vec3(0.9), step(0.5, fract(v * 5.0)) * 0.6);
    }
  }
  float cosv = abs(vViewTS.z) / max(length(vViewTS), 1e-3);
  float frn = pow(1.0 - cosv, 4.0);
  float upv = vViewTS.y / max(length(vViewTS), 1e-3);
  vec3 refl = mix(vec3(0.1, 0.1, 0.095), vec3(0.5, 0.6, 0.74), smoothstep(0.0, 0.45, upv));
  col = mix(vec3(0.015), vec3(0.6, 0.66, 0.72), frn);
  vec3 through = mix(room * 0.62, decoC * 0.6, deco);
  // darker towards the pavement: less light reaches the bottom of the window
  through *= 0.75 + 0.25 * smoothstep(0.5, 2.2, v);
  fEmis = through * (1.0 - frn) + refl * (0.1 + 0.55 * frn) * (1.0 - deco * 0.6);
  fGlass = 0.3 + 0.7 * frn;
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
    float joint = max(step(jy, 0.04), step(fract(bxs), 0.016)) * clamp(1.0 - fwidth(v) * 9.0, 0.0, 1.0);
    float tone = 1.0 + 0.07 * (h2(vec2(floor(bxs), course)) - 0.5) * clamp(1.0 - fwidth(u) * 4.0, 0.0, 1.0);
    base = tint * tone * mix(1.0, lum * 2.0, 0.1) * (1.0 - 0.2 * joint);
    base *= 0.9 + 0.2 * vnoise(tuv * 0.35); // weathering in broad patches
    fHeight = (1.0 - joint) * 0.45 + lum * 0.12;
    trim = base * 1.06;
  } else if (style < 1.5) {
    vec3 t = texture2D(tBrickR, tuv / 0.95).rgb;
    base = t * tint * vec3(1.75, 1.42, 1.25); // Soho red brick runs warm and orange
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
    if (modern) { col = base * (kk < 0.1 ? 0.6 : 0.85); return; }
    col = trim * (kk > 0.85 ? 1.05 : 0.96);
    if (kk < 0.1) col = trim * 0.55; // shadow under the cornice
    else if (kk < 0.3) col = trim * (0.62 + 0.38 * step(0.5, fract(u / 0.24))); // dentil course
    else if (kk < 0.4) col = trim * 1.04;
    else if (kk < 0.85 && h1(seed * 3.9) > 0.45 && (style < 0.5 || style > 3.5)) {
      // balustrade: turned balusters with daylight between them
      float bu2 = abs(fract(u / 0.3) - 0.5);
      float prof = 0.2 + 0.14 * sin((kk - 0.4) / 0.45 * 9.4);
      float pier = step(fract(u / 3.0), 0.12);
      col = mix(vec3(0.16, 0.17, 0.2), trim * (0.85 + 0.3 * (0.5 - bu2)), max(step(bu2, prof), pier));
    }
    fHeight = 0.5;
    return;
  }
  float span = max(top - gH, 2.0);
  float nF = max(1.0, floor(span / (modern ? 3.7 : 3.35) + 0.5));
  float fh = span / nF;
  float fy = (v - gH) / fh;
  float fi = floor(fy);
  float fv = fract(fy);
  float target = vLay.x; // bay width, chosen on the CPU so real stonework can line up with it
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
    // halfW-timbering
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

  bool mansard = layBit(1.0) && nF > 2.5 && fi > nF - 1.5;
  bool grand = style < 0.5 || style > 3.5; // stone and stucco fronts get the classical kit
  float ww = vLay.y;
  float lo = 0.17, hi = 0.8;
  bool nobile = fi < 0.5 && nF > 1.5;
  if (nobile) { lo = 0.1; hi = 0.84; }
  if (fi > nF - 1.5 && nF > 2.5) { lo = 0.24; hi = 0.76; }
  col = base;
  if (mansard) {
    ww *= 0.72;
    lo = 0.16;
    hi = 0.7;
    vec3 sl = texture2D(tSlate, tuv / 2.6).rgb;
    col = sl * vec3(0.5, 0.55, 0.62) * (0.9 + 0.2 * grime);
    fHeight = dot(sl, vec3(0.4));
    if (fv * fh < 0.34) {
      float ck = fv * fh;
      col = trim * (ck < 0.07 ? 0.55 : ck < 0.2 ? (0.64 + 0.36 * step(0.5, fract(u / 0.24))) : 1.02); // cornice under the roof
    }
  } else {
    if (style < 0.5 && fi < 0.5) col *= 1.0 - 0.22 * step(fract(v / 0.5), 0.06); // rusticated piano nobile
    if (fv * fh < 0.22 && (grand || fi < 0.5)) col = trim * (fv * fh < 0.05 ? 0.6 : fv * fh > 0.17 ? 1.05 : 0.97); // string course
    // pilaster strips on the grander fronts
    if (grand && layBit(2.0) && abs(bu - 0.5) * bw > bw * 0.5 - 0.24) {
      float pe = (bw * 0.5 - abs(bu - 0.5) * bw) / 0.24;
      col = trim * (0.9 + 0.16 * pe);
      if (fi > nF - 1.5 && fv > 0.86) col = trim * (0.7 + 0.4 * step(0.5, fract(v / 0.09))); // capital
    }
    // quoins at the ends of the wall
    float ed = min(u, L - u);
    if (grand && L > 5.0 && ed < 0.5) {
      float q = fract(v / 0.76);
      if (ed < (q < 0.5 ? 0.5 : 0.32)) col = trim * (step(q, 0.04) + step(abs(q - 0.5), 0.02) > 0.5 ? 0.7 : 1.04);
    }
  }
  bool arched = grand && nobile && !mansard && layBit(4.0);
  float dx = (abs(bu - 0.5) - ww) * bw;
  float dy = max(lo - fv, fv - hi) * fh;
  if (arched) {
    // round-headed opening: the top is a semicircle of the window's halfW-width
    float r = ww * bw;
    float cy = hi * fh - r;
    float py = fv * fh;
    if (py > cy) dy = max(dy, length(vec2((bu - 0.5) * bw, py - cy)) - r);
    if (py > cy) dx = min(dx, 0.0) + max(0.0, length(vec2((bu - 0.5) * bw, py - cy)) - r);
  }
  float d = max(dx, dy);
  // the glass sits back from the wall face: march the view ray to that depth
  vec2 rsh = clamp(vViewTS.xy * (vLay.w / max(-vViewTS.z, 1e-3)), vec2(-0.7), vec2(0.7));
  float bu2 = bu + rsh.x / bw;
  float fv2 = fv + rsh.y / fh;
  float dx2 = (abs(bu2 - 0.5) - ww) * bw;
  float dy2 = max(lo - fv2, fv2 - hi) * fh;
  if (d < 0.0 && max(dx2, dy2) > 0.0) {
    // we are looking at the reveal: jamb, soffit or sill
    vec3 rv = (style > 0.5 && style < 3.5 && !mansard) ? trim * 0.92 : (mansard ? vec3(0.78, 0.78, 0.75) : base * 1.04);
    float shade = dx2 > dy2 ? (bu2 > 0.5 ? 0.55 : 0.9) : (fv2 > hi ? 0.38 : 1.08);
    col = rv * shade;
    fHeight = 0.5;
  } else if (d < 0.0) {
    float fx = ww * 2.0 * bw;
    float fyh = (hi - lo) * fh;
    float wu = (bu2 - 0.5 + ww) / (2.0 * ww);
    float wv = (fv2 - lo) / (hi - lo);
    float ex = min(wu, 1.0 - wu) * fx;
    float ey = min(wv, 1.0 - wv) * fyh;
    bool frame = min(min(ex, ey), -d) < 0.075 || abs(wv - 0.5) * fyh < 0.035;
    if (style > 0.5 && style < 4.5 && abs(wu - 0.5) * fx < 0.02) frame = true;
    if (style > 0.5 && style < 3.5 && (abs(wv - 0.25) * fyh < 0.014 || abs(wv - 0.75) * fyh < 0.014)) frame = true;
    // wrought-iron balconette across the foot of the first-floor windows
    bool rail = false;
    if (rail && (step(fract(u / 0.12), 0.2) > 0.5 || abs(wv * fyh - 0.92) < 0.03 || wv * fyh < 0.05)) {
      col = vec3(0.02, 0.02, 0.022);
      fRough = 0.45;
    } else if (frame) {
      col = h1(seed * 8.3) > 0.75 ? vec3(0.05, 0.05, 0.055) : vec3(0.8, 0.79, 0.75);
      fRough = 0.5;
    } else if (wid > 0.6 && wid < 0.8 && wv > 1.0 - (wid - 0.56) * 2.6) {
      col = vec3(0.7, 0.68, 0.6) * (0.85 + 0.15 * step(0.5, fract(wv * 22.0))); // blind
    } else if (wid > 0.3 && wid < 0.42) {
      // net curtains / drawn curtains behind the glass
      glassAt(col, lit);
      fEmis += vec3(0.42, 0.4, 0.36) * (0.5 + 0.5 * abs(sin(wu * 26.0))) * step(abs(wu - 0.5), 0.5 - 0.18 * step(0.36, wid));
    } else {
      glassAt(col, lit);
    }
    // the reveal throws a shadow across the top and the sunward side of the opening
    float sh = smoothstep(0.0, 0.3, (hi - fv2) * fh) * (0.55 + 0.45 * smoothstep(0.0, 0.22, wu * fx));
    col *= 0.4 + 0.6 * sh;
    fEmis *= sh;
  } else if (d < 0.17 && !mansard && style > 0.5 && style < 3.5) {
    col = trim * (dy > dx && fv < lo ? 0.8 : 1.0); // stone dressings on brick
    if (dy > dx && fv > hi) col = mix(base * vec3(1.25, 0.95, 0.9), trim, step(0.5, h1(seed * 9.7))) * (0.85 + 0.15 * step(0.12, fract(u / 0.11))); // gauged-brick or stone lintel
    fHeight = 0.6;
  } else if (d < 0.14 && (grand || mansard)) {
    col = mansard ? vec3(0.8, 0.8, 0.77) : min(base * 1.14, vec3(1.0)); // architrave
    if (dy > dx && fv < lo) col *= 0.72;
    fHeight = 0.7;
  } else if (grand && nobile && !mansard && !arched && dx < 0.16 && fv > hi) {
    // pediment over the first-floor windows
    float py = (fv - hi) * fh - 0.14;
    float halfW = ww * bw + 0.16;
    float rise = h1(seed * 3.3) > 0.5 ? 0.32 * (1.0 - abs(bu - 0.5) * bw / halfW) : 0.14;
    if (py > 0.0 && py < rise + 0.1 && abs(bu - 0.5) * bw < halfW) col = trim * (py < 0.05 ? 0.6 : py > rise ? 1.08 : 0.96);
  } else if (!mansard && dx < 0.0 && fv < lo && (lo - fv) * fh < 0.3 && (lo - fv) * fh > 0.17) {
    col *= 0.66; // shadow under the sill
  } else if (!mansard && dx < 0.05 && fv < lo && (lo - fv) * fh < 1.6) {
    // dirt washed down from the sill
    col *= 1.0 - 0.2 * vnoise(vec2(u * 9.0, v * 0.6)) * (1.0 - (lo - fv) * fh / 1.6);
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
      .replace("#include <color_fragment>", "#include <color_fragment>\nfacade(diffuseColor.rgb);\nfBumpK = (fGlass < 0.01 && fRough < 0.0 && vFlag < 2.5) ? 0.9 : 0.0;\nif (vFlag < 2.5) { float aoV = mix(0.62, 1.0, smoothstep(0.0, 4.5, vFUv.y)) * mix(0.8, 1.0, smoothstep(0.0, 0.5, vFUv.y)); diffuseColor.rgb *= aoV; fEmis *= mix(0.8, 1.0, aoV); }")
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
