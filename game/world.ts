import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { makeFacadeMaterial, STYLE } from "./facade";
import { GeoBuilder, Path, polysToGeometry, ringToPairs, SurfaceGrid } from "./geo";
import { buildProps } from "./props";
import { buildSigns } from "./signs";
import { buildTrees } from "./trees";
import { hash01, SURFACE_PAVEMENT, type BuildingData, type SceneData } from "./types";

export const KERB = 0.13;

export interface World {
  group: THREE.Group;
  grid: SurfaceGrid;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  sky: Sky;
  setSignal: (index: number, state: number) => void; // 0 green, 1 amber, 2 red
  /** true when a circle of radius r at (x, z) touches a bollard, bin, lamp post, planter... */
  solid: (x: number, z: number, r: number) => boolean;
  update: (time: number) => void;
  dispose: () => void;
}

const COLOR_NAMES: Record<string, string> = {
  brown: "#8a6a50",
  light_brown: "#b89a78",
  "yellow-brown": "#b99a62",
  white: "#e9e6de",
  grey: "#9a9a98",
  gray: "#9a9a98",
  lightgrey: "#c4c3bf",
  lightgray: "#c4c3bf",
  black: "#2a2a2c",
  red: "#9c4a3a",
  beige: "#d8cbb0",
  cream: "#e6dcc4",
  yellow: "#d6c078",
};

function parseColour(s: string): THREE.Color | null {
  if (!s) return null;
  const k = s.trim().toLowerCase();
  const named = COLOR_NAMES[k];
  if (named) return new THREE.Color(named);
  if (/^#[0-9a-f]{3,6}$/.test(k)) return new THREE.Color(k);
  return null;
}

/** Pick a facade style and tint from the OSM tags, or from where the building stands. */
function styleFor(b: BuildingData): { style: number; tint: THREE.Color } {
  const s = b.s;
  const s2 = hash01(s * 91.7 + b.h);
  const col = parseColour(b.col);
  const mat = b.mat;
  const vary = 0.9 + 0.2 * s2;
  const white = new THREE.Color(1, 1, 1).multiplyScalar(vary);
  const stoneTint = new THREE.Color(0xd2c19c).multiplyScalar(0.92 + 0.14 * s2); // Portland stone in sun: warm buff
  if (b.arch === "mock_tudor" || mat === "timber_framing") return { style: STYLE.TUDOR, tint: white };
  if (mat === "glass") return { style: STYLE.GLASS, tint: new THREE.Color(0.4, 0.43, 0.46) };
  if (mat === "stone" || mat === "sandstone") {
    const t = col ? col.clone().lerp(stoneTint, 0.75) : stoneTint;
    // Portland stone is never paper white once London has been at it
    const peak = Math.max(t.r, t.g, t.b);
    if (peak > 0.72) t.multiplyScalar(0.72 / peak);
    t.lerp(new THREE.Color(0xcbb893), 0.35);
    return { style: STYLE.STONE, tint: t };
  }
  if (mat === "concrete") return { style: STYLE.CONCRETE, tint: (col ?? new THREE.Color(0.66, 0.65, 0.62)).clone() };
  if (mat === "plaster") {
    return { style: STYLE.STUCCO, tint: (col ?? new THREE.Color(0.9, 0.87, 0.8)).clone().multiplyScalar(0.95 + 0.08 * s2) };
  }
  if (mat === "brick") {
    const c = (b.col || "").toLowerCase();
    if (c === "white" || c === "lightgrey" || c === "grey") {
      return { style: STYLE.STUCCO, tint: (col ?? white).clone().multiplyScalar(0.96) };
    }
    if (c === "brown" || c === "#776655") return { style: s2 < 0.6 ? STYLE.BRICK_BROWN : STYLE.BRICK_RED, tint: white };
    if (c.includes("light") || c.includes("yellow") || c === "#9d8c71" || c === "#bca365" || c === "#d8be70" || c === "#d2b48c") {
      return { style: STYLE.BRICK_STOCK, tint: white };
    }
    if (c === "#ff7f50" || c === "red") return { style: STYLE.BRICK_RED, tint: white };
    return { style: s < 0.4 ? STYLE.BRICK_STOCK : s < 0.75 ? STYLE.BRICK_RED : STYLE.BRICK_BROWN, tint: white };
  }
  // untagged: guess from the street
  if (b.dr < 34) return { style: STYLE.STONE, tint: stoneTint };
  if (b.dm < 34) {
    if (s < 0.55) return { style: STYLE.STONE, tint: stoneTint };
    if (s < 0.72) return { style: STYLE.CONCRETE, tint: new THREE.Color(0.7, 0.69, 0.65).multiplyScalar(vary) };
    if (s < 0.82) return { style: STYLE.GLASS, tint: new THREE.Color(0.36, 0.4, 0.44) };
    return { style: STYLE.BRICK_RED, tint: white };
  }
  if (s < 0.3) return { style: STYLE.BRICK_STOCK, tint: white };
  if (s < 0.52) return { style: STYLE.BRICK_RED, tint: white };
  if (s < 0.64) return { style: STYLE.BRICK_BROWN, tint: white };
  if (s < 0.82) {
    const pal = [0xe6e1d4, 0xd9d2bf, 0xcfd3d0, 0xe4d3c0, 0xc9d2d8, 0xdcd9d2];
    return { style: STYLE.STUCCO, tint: new THREE.Color(pal[Math.floor(s2 * pal.length) % pal.length]) };
  }
  if (s < 0.9) return { style: STYLE.STONE, tint: stoneTint };
  return { style: s2 < 0.5 ? STYLE.CONCRETE : STYLE.GLASS, tint: new THREE.Color(0.6, 0.6, 0.58).multiplyScalar(vary) };
}

function buildBuildings(data: SceneData, mat: THREE.Material, trimMat: THREE.Material, group: THREE.Group) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], info: number[] = [], col: number[] = [], flag: number[] = [];
  const idx: number[] = [];
  const lay: number[] = [];
  let curLay = [2.8, 0.27, 0, 0.2];
  const trim = new GeoBuilder();
  // protruding stonework (sills, hoods, pilasters, balconies) as instanced boxes
  const relief: number[] = []; // cx, cy, cz, sx, sy, sz, yaw, r, g, b
  const [px0, pz0, px1, pz1] = data.play;
  const addRelief = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw: number, c: THREE.Color) => {
    relief.push(cx, cy, cz, sx, sy, sz, yaw, c.r, c.g, c.b);
  };
  const IRON = new THREE.Color(0x101113);
  let n = 0;
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number,
    L: number, H: number, style: number, seed: number, c: THREE.Color, f: number) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    uv.push(u, v);
    info.push(L, H, style, seed);
    col.push(c.r, c.g, c.b);
    flag.push(f);
    lay.push(curLay[0], curLay[1], curLay[2], curLay[3]);
    return n++;
  };
  const noShop = new Set(["church", "school", "university", "house", "residential", "semidetached_house", "terrace", "service", "construction"]);
  for (const b of data.buildings) {
    const { style, tint } = styleFor(b);
    const ring = b.p;
    const cnt = ring.length / 2;
    const H = b.h - b.mh;
    const seed = b.s * 10 + 0.37;
    const canShop = !noShop.has(b.use) && b.mh < 1 && b.h > 7.5;
    for (let i = 0; i < cnt; i++) {
      const ax = ring[i * 2], az = ring[i * 2 + 1];
      const j = (i + 1) % cnt;
      const bx = ring[j * 2], bz = ring[j * 2 + 1];
      const dx = bx - ax, dz = bz - az;
      const L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      const nx = dz / L, nz = -dx / L;
      const facing = b.f[i] === "1";
      let f = facing ? 1 : 0;
      if (facing && canShop && L >= 3.2) f = 2;
      if (facing && L < 1.6) f = 0;
      const wseed = seed + i * 0.013;
      const y0 = b.mh, y1 = b.h;
      // facade layout, decided here so the shader and the real stonework agree
      const modernS = style === STYLE.CONCRETE || style === STYLE.GLASS;
      const hh = (k: number) => hash01(wseed * k + k);
      const target = modernS ? 1.5 : style === STYLE.TUDOR ? 2.2 : 2.3 + hh(1.7);
      const ww = 0.22 + 0.1 * hh(4.1);
      const fMansard = hh(2.3) > 0.42, fPil = hh(6.7) > 0.4, fArch = hh(7.9) > 0.55, fRail = hh(5.5) > 0.45;
      const recess = modernS ? 0.1 : 0.16 + 0.12 * hh(3.7);
      curLay = [target, ww, (fMansard ? 1 : 0) + (fPil ? 2 : 0) + (fArch ? 4 : 0), recess];
      const i0 = push(bx, y0, bz, nx, 0, nz, L, 0, L, H, style, wseed, tint, f);
      push(ax, y0, az, nx, 0, nz, 0, 0, L, H, style, wseed, tint, f);
      push(ax, y1, az, nx, 0, nz, 0, H, L, H, style, wseed, tint, f);
      push(bx, y1, bz, nx, 0, nz, L, H, L, H, style, wseed, tint, f);
      idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
      const cxm = (ax + bx) / 2, czm = (az + bz) / 2;
      if (f >= 1 && L > 2.6 && cxm > px0 - 10 && cxm < px1 + 10 && czm > pz0 - 10 && czm < pz1 + 10 && !modernS && style !== STYLE.TUDOR && b.mh < 1) {
        const yawR = Math.atan2(-dz, dx);
        const tx = dx / L, tz = dz / L;
        const grand = style === STYLE.STONE || style === STYLE.STUCCO;
        const stoneC = style === STYLE.STONE ? tint.clone().multiplyScalar(0.95) : style === STYLE.STUCCO ? tint.clone().multiplyScalar(0.98) : new THREE.Color(0.7, 0.67, 0.6);
        const wallC = grand ? stoneC : new THREE.Color([0x8a4a3a, 0x9a875f, 0x6b5444][style - 1] ?? 0x8a7a66);
        const gH = f === 2 ? 4.35 : 0;
        const top = H - 0.9;
        const span = Math.max(top - gH, 2);
        const nF = Math.max(1, Math.floor(span / 3.35 + 0.5));
        const fh = span / nF;
        const nB = Math.max(1, Math.floor(L / target + 0.5));
        const bw = L / nB;
        const mansardTop = fMansard && nF > 2.5;
        const at = (u: number, out: number): [number, number] => [ax + tx * u + nx * out, az + tz * u + nz * out];
        for (let fi = 0; fi < nF; fi++) {
          const isM = mansardTop && fi === nF - 1;
          let lo = 0.17, hi = 0.8, w2 = ww;
          const nobile = fi === 0 && nF > 1;
          if (nobile) { lo = 0.1; hi = 0.84; }
          if (fi === nF - 1 && nF > 2) { lo = 0.24; hi = 0.76; }
          if (isM) { w2 = ww * 0.72; lo = 0.16; hi = 0.7; }
          const yb = gH + fi * fh;
          const wWide = w2 * 2 * bw;
          for (let bi = 0; bi < nB; bi++) {
            const u = (bi + 0.5) * bw;
            if (isM) {
              // dormer: a little house standing out of the mansard
              const [x, z] = at(u, 0.22);
              addRelief(x, yb + (lo + hi) / 2 * fh, z, wWide + 0.3, (hi - lo) * fh + 0.3, 0.44, yawR, new THREE.Color(0.8, 0.8, 0.77));
              addRelief(x, yb + hi * fh + 0.2, z, wWide + 0.5, 0.1, 0.56, yawR, new THREE.Color(0.3, 0.32, 0.35));
              continue;
            }
            // sill
            const [sx, sz] = at(u, 0.09);
            addRelief(sx, yb + lo * fh - 0.05, sz, wWide + 0.3, 0.1, 0.24, yawR, stoneC);
            // hood / lintel over the opening
            const arched = grand && nobile && fArch;
            if (!arched && (grand || nobile)) {
              const [hx, hz] = at(u, 0.07);
              addRelief(hx, yb + hi * fh + 0.2, hz, wWide + 0.36, 0.12, grand ? 0.26 : 0.16, yawR, stoneC);
            }
            // balconette on the first floor of the terraces
            if (nobile && fRail && !grand) {
              const [fx2, fz2] = at(u, 0.2);
              const fy = yb + lo * fh + 0.04;
              addRelief(fx2, fy, fz2, wWide + 0.34, 0.07, 0.44, yawR, stoneC);
              const [rx, rz] = at(u, 0.4);
              addRelief(rx, fy + 0.92, rz, wWide + 0.34, 0.04, 0.04, yawR, IRON);
              addRelief(rx, fy + 0.12, rz, wWide + 0.34, 0.03, 0.03, yawR, IRON);
              for (const q of [-0.42, -0.14, 0.14, 0.42]) {
                const [qx, qz] = at(u + q * (wWide + 0.34), 0.4);
                addRelief(qx, fy + 0.5, qz, 0.03, 0.86, 0.03, yawR, IRON);
              }
            }
          }
        }
        // giant-order pilasters between the bays
        if (grand && fPil) {
          const ph = (mansardTop ? nF - 1 : nF) * fh;
          for (let bi = 0; bi <= nB; bi++) {
            const [x, z] = at(bi * bw, 0.07);
            addRelief(x, gH + ph / 2, z, 0.44, ph, 0.18, yawR, stoneC);
            addRelief(x, gH + ph - 0.18, z, 0.56, 0.3, 0.26, yawR, stoneC);
            addRelief(x, gH + 0.2, z, 0.54, 0.4, 0.24, yawR, stoneC);
          }
        }
        // shopfront: piers between the units, plinths, a fascia board that stands proud
        if (f === 2) {
          const nS = Math.max(1, Math.floor(L / 5.6 + 0.5));
          const sw = L / nS;
          for (let si = 0; si <= nS; si++) {
            const [x, z] = at(Math.min(L - 0.18, Math.max(0.18, si * sw)), 0.08);
            // piers stop under the fascia so they never stand in front of a shop sign
            addRelief(x, 1.74, z, 0.5, 3.48, 0.22, yawR, wallC);
            addRelief(x, 0.3, z, 0.58, 0.5, 0.3, yawR, wallC.clone().multiplyScalar(0.7));
            addRelief(x, 3.4, z, 0.58, 0.16, 0.28, yawR, stoneC);
          }
          for (let si = 0; si < nS; si++) {
            const [x, z] = at((si + 0.5) * sw, 0.09);
            addRelief(x, 3.9, z, sw + 0.02, 0.72, 0.2, yawR, new THREE.Color(0x17181a));
            addRelief(x, 0.3, z, sw - 0.66, 0.12, 0.16, yawR, new THREE.Color(0x202124)); // stall-riser cill
          }
        }
      }
      // real ledges where the street can see them: shop cornice and roof cornice
      if (b.play && facing && L > 2.2) {
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const yaw = Math.atan2(-dz, dx);
        const modern = style === STYLE.CONCRETE || style === STYLE.GLASS;
        const tc = modern ? tint.clone().multiplyScalar(0.7) : style === STYLE.STONE ? tint.clone().multiplyScalar(0.92) : new THREE.Color(0.74, 0.71, 0.64);
        const dark = tc.clone().multiplyScalar(0.82);
        if (f === 2) {
          // shop cornice with a lead flashing on top
          trim.box(mx + nx * 0.2, 4.27, mz + nz * 0.2, L + 0.4, 0.18, 0.42, yaw, tc);
          trim.box(mx + nx * 0.12, 4.4, mz + nz * 0.12, L + 0.24, 0.08, 0.26, yaw, dark);
        }
        if (!modern && H > 9) {
          // stepped main cornice: bed mould, corona, cyma
          const cy = b.h - 0.9;
          trim.box(mx + nx * 0.12, cy + 0.08, mz + nz * 0.12, L + 0.24, 0.16, 0.26, yaw, dark);
          trim.box(mx + nx * 0.26, cy + 0.26, mz + nz * 0.26, L + 0.52, 0.2, 0.54, yaw, tc);
          trim.box(mx + nx * 0.32, cy + 0.4, mz + nz * 0.32, L + 0.64, 0.08, 0.66, yaw, dark);
          // first-floor band
          if (f === 2 && (style === STYLE.STONE || style === STYLE.STUCCO)) trim.box(mx + nx * 0.08, 7.75, mz + nz * 0.08, L + 0.16, 0.14, 0.18, yaw, tc);
        }
        trim.box(mx + nx * 0.06, b.h + 0.07, mz + nz * 0.06, L + 0.12, 0.14, 0.44, yaw, dark);
        // cast-iron downpipe at the party wall
        if (!modern && L > 4.5 && hash01(wseed * 31.0) > 0.35) {
          const px = ax + (dx / L) * 0.28 + nx * 0.09, pz = az + (dz / L) * 0.28 + nz * 0.09;
          trim.box(px, (b.h - 1.0) / 2 + 0.1, pz, 0.1, b.h - 1.2, 0.1, yaw, 0x1b1c1e);
          trim.box(px, b.h - 1.05, pz, 0.2, 0.22, 0.16, yaw, 0x1b1c1e);
        }
        // burglar alarm box / projecting clock of every London terrace
        if (f === 2 && hash01(wseed * 17.0) > 0.55) {
          const t = 0.2 + 0.6 * hash01(wseed * 5.0);
          trim.box(ax + dx * t + nx * 0.08, 5.3, az + dz * t + nz * 0.08, 0.28, 0.34, 0.14, yaw, [0xd9b21c, 0xb3261e, 0xe9e6dc, 0x23486b][Math.floor(hash01(wseed * 3.0) * 4)]);
        }
      }
    }
    // roofscape: chimney stacks on the old houses, plant on the modern blocks
    if (b.play && b.mh < 1) {
      let cx = 0, cz = 0;
      for (let i = 0; i < cnt; i++) { cx += ring[i * 2]; cz += ring[i * 2 + 1]; }
      cx /= cnt;
      cz /= cnt;
      const modern = style === STYLE.CONCRETE || style === STYLE.GLASS;
      if (modern) {
        trim.box(cx, b.h + 1.1, cz, 3.2 + b.s * 3, 2.2, 2.6 + b.s * 2, b.s * 3, 0x6f7376);
      } else {
        const nst = 1 + Math.floor(hash01(seed * 3.3) * 2.2);
        for (let k = 0; k < nst; k++) {
          const vi = Math.floor(hash01(seed * 7.7 + k * 1.9) * cnt);
          const vx = ring[vi * 2], vz = ring[vi * 2 + 1];
          const sx = vx + (cx - vx) * 0.22, sz = vz + (cz - vz) * 0.22;
          const yaw = hash01(seed + k) * 0.6;
          const brick = style === STYLE.STONE || style === STYLE.STUCCO ? 0xa39a86 : [0x7a4a38, 0x8c7a56, 0x5e4636][style - 1] ?? 0x7a4a38;
          trim.box(sx, b.h + 0.9, sz, 1.3, 1.8, 0.62, yaw, brick);
          trim.box(sx, b.h + 1.84, sz, 1.42, 0.1, 0.74, yaw, 0x9a958a);
          const c = Math.cos(yaw), sn = Math.sin(yaw);
          for (const e of [-0.4, 0, 0.4]) trim.box(sx + e * c, b.h + 2.1, sz - e * sn, 0.2, 0.42, 0.2, yaw, 0xa5583c);
        }
      }
    }
    // roof
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < cnt; i++) pts.push(new THREE.Vector2(ring[i * 2], ring[i * 2 + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const base = n;
    for (const p of pts) push(p.x, b.h, p.y, 0, 1, 0, p.x, p.y, 1, H, style, seed, tint, 3);
    for (const t of tris) {
      const a = pts[t[0]], bb = pts[t[1]], c = pts[t[2]];
      const cross = (bb.x - a.x) * (c.y - a.y) - (bb.y - a.y) * (c.x - a.x);
      if (cross > 0) idx.push(base + t[0], base + t[2], base + t[1]);
      else idx.push(base + t[0], base + t[1], base + t[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("aUv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aInfo", new THREE.Float32BufferAttribute(info, 4));
  g.setAttribute("aCol", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("aFlag", new THREE.Float32BufferAttribute(flag, 1));
  g.setAttribute("aLay", new THREE.Float32BufferAttribute(lay, 4));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  {
    const count = relief.length / 10;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.82 }), count);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const k = i * 10;
      o.position.set(relief[k], relief[k + 1], relief[k + 2]);
      o.scale.set(relief[k + 3], relief[k + 4], relief[k + 5]);
      o.rotation.set(0, relief[k + 6], 0);
      o.updateMatrix();
      inst.setMatrixAt(i, o.matrix);
      inst.setColorAt(i, c.setRGB(relief[k + 7], relief[k + 8], relief[k + 9]));
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    group.add(inst);
    console.info(`[soho] facade relief pieces: ${count}`);
  }
  const tm = new THREE.Mesh(trim.build(), trimMat);
  tm.castShadow = true;
  tm.receiveShadow = true;
  tm.frustumCulled = false;
  group.add(tm);
}


/** Blurred building mask: darkens the ground where walls crowd in (baked ambient occlusion). */
function bakeGroundAO(data: SceneData): THREE.CanvasTexture {
  const [x0, z0, x1, z1] = data.scene;
  const w = Math.ceil(x1 - x0), h = Math.ceil(z1 - z0);
  // draw the footprints once, sharp, then blur that image (a filter on the
  // context would blur every single fill)
  const mask = document.createElement("canvas");
  mask.width = w;
  mask.height = h;
  const m = mask.getContext("2d")!;
  m.fillStyle = "#fff";
  m.fillRect(0, 0, w, h);
  m.fillStyle = "#000";
  m.beginPath();
  for (const b of data.buildings) {
    const r = b.p;
    m.moveTo(r[0] - x0, r[1] - z0);
    for (let i = 2; i < r.length; i += 2) m.lineTo(r[i] - x0, r[i + 1] - z0);
    m.closePath();
  }
  m.fill("nonzero");
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#fff";
  c.fillRect(0, 0, w, h);
  c.filter = "blur(5px)";
  c.drawImage(mask, 0, 0);
  c.filter = "blur(1.6px)";
  c.globalAlpha = 0.6;
  c.drawImage(mask, 0, 0);
  c.globalAlpha = 1;
  c.filter = "none";
  const t = new THREE.CanvasTexture(cv);
  t.flipY = false;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

type GroundKind = "road" | "pave" | "zone" | "paint";

/**
 * Ground realism: baked AO from the buildings, post-rain damp and puddles,
 * and wear (trench repairs and ironwork on roads; gum, stains and slab
 * tone on pavements).
 */
function groundify(mat: THREE.MeshStandardMaterial, kind: GroundKind, damp: number, puddle: number, ao: THREE.Texture, box: THREE.Vector4, dir?: THREE.Vector3) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDir = { value: dir ?? new THREE.Vector3(1, 0, 0) };
    sh.uniforms.tAO = { value: ao };
    sh.uniforms.uAOBox = { value: box };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;");
    const paint = `
          // Oxford Street's painted carriageway: one giant shape every 16 m
          vec2 q = vec2(dot(p, uDir.xy), -p.x * uDir.y + p.y * uDir.x - uDir.z);
          float cell = floor(q.x / 16.0);
          vec2 c = vec2(fract(q.x / 16.0) * 16.0 - 8.0, q.y);
          float hsh = wh(vec2(cell, 3.0));
          float sd;
          if (hsh < 0.25) sd = abs(length(c) - 3.3) - 1.0;
          else if (hsh < 0.48) sd = min(abs(c.x - c.y * 0.95), abs(c.x + c.y * 0.95)) * 0.72 - 0.75;
          else if (hsh < 0.66) sd = max(abs(c.x) - 5.6, abs(c.y) - 1.05);
          else if (hsh < 0.84) sd = max(length(c) - 3.7, -c.y);
          else sd = max(-c.y - 2.6, max(c.y * 0.62 + c.x - 2.9, c.y * 0.62 - c.x - 2.9));
          sd = max(sd, abs(c.y) - 4.6);
          float lum = dot(diffuseColor.rgb, vec3(0.333));
          float worn = 0.8 + 0.35 * wn(p * 1.3) * wn(p * 0.31 + 5.0);
          vec3 paintC = mix(vec3(0.4, 0.72, 0.34), vec3(0.012, 0.06, 0.03), smoothstep(0.0, 0.07, sd));
          fDamp *= 0.25;
          diffuseColor.rgb = paintC * (0.6 + lum * 1.4) * worn;`;
    const wear =
      kind === "paint"
        ? paint
        : kind === "road"
        ? `
          // utility trench repairs: long darker strips with a tar edge
          vec2 tc = p / vec2(9.0, 2.6);
          vec2 ti = floor(tc), tf = fract(tc);
          float th = wh(ti);
          if (th > 0.8) {
            float inside = step(0.08, tf.x) * step(tf.x, 0.2 + th * 0.7) * step(0.25, tf.y) * step(tf.y, 0.62);
            float edge = inside * (1.0 - step(0.3, tf.y) * step(tf.y, 0.57) * step(0.1, tf.x) * step(tf.x, 0.18 + th * 0.7));
            diffuseColor.rgb *= mix(1.0, 0.86, inside) * mix(1.0, 0.7, edge);
          }
          // ironwork
          vec2 mc = p / 13.0;
          vec2 mi = floor(mc);
          if (wh(mi + 3.7) > 0.72) {
            vec2 mo = (fract(mc) - 0.5) * 13.0 - (vec2(wh(mi), wh(mi + 9.1)) - 0.5) * 6.0;
            float r = length(mo);
            float lid = 1.0 - smoothstep(0.33, 0.35, r);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.075, 0.07) * (0.8 + 0.4 * step(0.5, fract(mo.x * 9.0)) * step(0.5, fract(mo.y * 9.0))), lid);
            fGloss += lid * 0.6;
            diffuseColor.rgb *= 1.0 - 0.3 * (smoothstep(0.35, 0.37, r) - smoothstep(0.43, 0.5, r));
          }
          // tyre-polished wheel tracks and oil along the crown
          diffuseColor.rgb *= 0.9 + 0.2 * wn(p * vec2(0.6, 0.6) + 11.0);`
        : `
          // chewing gum and old stains: every London pavement
          vec2 gc = p / 0.42;
          vec2 gi = floor(gc);
          float gh = wh(gi);
          if (gh > 0.9) {
            vec2 go = fract(gc) - 0.5 - (vec2(wh(gi + 1.3), wh(gi + 4.1)) - 0.5) * 0.6;
            float spot = 1.0 - smoothstep(0.05, 0.085, length(go));
            diffuseColor.rgb = mix(diffuseColor.rgb, gh > 0.96 ? vec3(0.62, 0.6, 0.56) : vec3(0.13, 0.12, 0.11), spot * 0.7);
          }
          float stain = wn(p * 0.55 + 4.0) * 0.6 + wn(p * 1.7) * 0.4;
          diffuseColor.rgb *= 0.8 + 0.26 * stain;
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.9, 0.84, 0.74), smoothstep(0.62, 0.8, wn(p * 0.23 + 19.0)) * 0.5);`;
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWPos;
        uniform sampler2D tAO;
        uniform vec4 uAOBox;
        uniform vec3 uDir;
        float fDamp; float fPuddle; float fGloss;
        float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), f.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), f.x), f.y); }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          vec2 p = vWPos.xz;
          fGloss = 0.0;
          float f = wn(p * 0.07) * 0.5 + wn(p * 0.19 + 7.3) * 0.3 + wn(p * 0.63 + 3.1) * 0.14 + wn(p * 2.1) * 0.06;
          fDamp = smoothstep(${damp.toFixed(3)}, ${(damp + 0.12).toFixed(3)}, f);
          fPuddle = smoothstep(${puddle.toFixed(3)}, ${(puddle + 0.03).toFixed(3)}, f);
          ${wear}
          diffuseColor.rgb *= mix(1.0, 0.66, fDamp) * mix(1.0, 0.7, fPuddle);
          float ao = texture2D(tAO, (p - uAOBox.xy) * uAOBox.zw).r;
          diffuseColor.rgb *= mix(0.42, 1.0, smoothstep(0.3, 0.98, ao));
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, 0.72, fDamp), 0.05, fPuddle);\nroughnessFactor = mix(roughnessFactor, 0.3, clamp(fGloss, 0.0, 1.0));",
      )
      .replace(
        "#include <normal_fragment_maps>",
        "#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, max(fPuddle, fDamp * 0.55)));",
      );
  };
  mat.customProgramCacheKey = () => `ground-${kind}-${damp}-${puddle}`;
}

/** White and yellow paint: centre lines, stop lines, crossings, double yellows. */
function buildMarkings(data: SceneData, grid: SurfaceGrid): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const Y = 0.015;
  const WHITE = 0xe8e8e2, YELLOW = 0xd9b21c;
  const nearSignal = (x: number, z: number, r: number) => {
    for (const s of data.signals) if (Math.hypot(s.x - x, s.z - z) < r) return true;
    for (const s of data.zebras) if (Math.hypot(s.x - x, s.z - z) < r) return true;
    return false;
  };
  const dashes = (pts: [number, number][], dash: number, gap: number, w: number) => {
    const path = new Path(pts);
    const a = { x: 0, z: 0, tx: 0, tz: 0 }, b = { x: 0, z: 0, tx: 0, tz: 0 };
    for (let s = 3; s < path.length - dash - 3; s += dash + gap) {
      path.at(s, a);
      path.at(s + dash, b);
      if (nearSignal(a.x, a.z, 9) || nearSignal(b.x, b.z, 9)) continue;
      if (grid.at(a.x, a.z) !== 0 || grid.at(b.x, b.z) !== 0) continue;
      if (grid.inZone(a.x, a.z) || grid.inZone(b.x, b.z)) continue;
      g.strip(a.x, a.z, b.x, b.z, w, Y, WHITE);
    }
  };
  for (const r of data.busRoutes) dashes(r.pts, 4, 5, 0.15);
  for (const r of data.roads) {
    if (r.o || r.w < 6.5 || r.k === "primary" || r.k === "pedestrian" || r.k === "footway" || r.k === "service") continue;
    dashes(ringToPairs(r.p), 2, 4, 0.1);
  }
  // signal-controlled crossings: stop lines and two rows of studs
  for (const s of data.signals) {
    const px = -s.tz, pz = s.tx;
    if (grid.inZone(s.x, s.z)) continue;
    for (const side of [-1, 1]) {
      // stop line across the approach lane only (traffic keeps left)
      const ox = s.x + s.tx * side * 3.4, oz = s.z + s.tz * side * 3.4;
      const narrow = s.hw < 3.2;
      const a0 = narrow ? -s.hw + 0.25 : 0.1, a1 = s.hw - 0.25;
      g.strip(ox + px * a0 * side, oz + pz * a0 * side, ox + px * a1 * side, oz + pz * a1 * side, 0.28, Y, WHITE);
      // two rows of studs mark the crossing itself
      const sx = s.x + s.tx * side * 1.6, sz = s.z + s.tz * side * 1.6;
      for (let d = -s.hw + 0.35; d < s.hw - 0.3; d += 0.62) {
        g.strip(sx + px * d, sz + pz * d, sx + px * (d + 0.14), sz + pz * (d + 0.14), 0.14, Y, WHITE);
      }
    }
  }
  // zebras
  for (const s of data.zebras) {
    const px = -s.tz, pz = s.tx;
    for (let d = -s.hw + 0.3; d < s.hw - 0.5; d += 1.2) {
      const cx = s.x + px * (d + 0.3), cz = s.z + pz * (d + 0.3);
      g.strip(cx - s.tx * 1.5, cz - s.tz * 1.5, cx + s.tx * 1.5, cz + s.tz * 1.5, 0.6, Y, WHITE);
    }
    for (const side of [-1, 1]) {
      const ox = s.x + s.tx * side * 2.6, oz = s.z + s.tz * side * 2.6;
      for (let d = -s.hw + 0.3; d < s.hw - 0.4; d += 0.9) {
        g.strip(ox + px * d, oz + pz * d, ox + px * (d + 0.5), oz + pz * (d + 0.5), 0.2, Y, WHITE);
      }
    }
  }
  // Oxford Circus diagonal crossing
  {
    let c = { x: 0, z: 0, n: 0 };
    let ax = 1, az = 0;
    for (const s of data.signals) {
      if (Math.hypot(s.x + 5, s.z + 5) < 32) {
        c = { x: c.x + s.x, z: c.z + s.z, n: c.n + 1 };
        if (s.name === "Oxford Street") { ax = s.tx; az = s.tz; }
      }
    }
    if (c.n >= 3) {
      const cx = c.x / c.n, cz = c.z / c.n;
      for (const rot of [Math.PI / 4, -Math.PI / 4]) {
        const dx = ax * Math.cos(rot) - az * Math.sin(rot), dz = ax * Math.sin(rot) + az * Math.cos(rot);
        for (const off of [-1.9, 1.9]) {
          const ox = cx - dz * off, oz = cz + dx * off;
          for (let d = -13; d < 13; d += 0.6) {
            const x0 = ox + dx * d, z0 = oz + dz * d;
            if (grid.at(x0, z0) !== 0 || grid.inZone(x0, z0)) continue;
            g.strip(x0, z0, x0 + dx * 0.16, z0 + dz * 0.16, 0.16, Y, WHITE);
          }
        }
      }
    }
  }
  // double yellow lines down the side streets
  for (const k of data.kerbs) {
    if (k.m) continue;
    const p = k.p;
    const cnt = p.length / 2;
    if (cnt < 2) continue;
    // which side is the road?
    const mi = Math.floor(cnt / 2) - 1 >= 0 ? Math.floor(cnt / 2) - 1 : 0;
    const mdx = p[mi * 2 + 2] - p[mi * 2], mdz = p[mi * 2 + 3] - p[mi * 2 + 1];
    const ml = Math.hypot(mdx, mdz) || 1;
    const mx = (p[mi * 2] + p[mi * 2 + 2]) / 2, mz = (p[mi * 2 + 1] + p[mi * 2 + 3]) / 2;
    const side = grid.at(mx - (mdz / ml) * 0.8, mz + (mdx / ml) * 0.8) === 0 ? 1 : -1;
    for (const off of [0.28, 0.5]) {
      for (let i = 0; i < cnt - 1; i++) {
        const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[i * 2 + 2], z1 = p[i * 2 + 3];
        const l = Math.hypot(x1 - x0, z1 - z0);
        if (l < 0.01) continue;
        const ox = (-(z1 - z0) / l) * off * side, oz = ((x1 - x0) / l) * off * side;
        if (nearSignal((x0 + x1) / 2, (z0 + z1) / 2, 5)) continue;
        g.strip(x0 + ox, z0 + oz, x1 + ox, z1 + oz, 0.08, Y, YELLOW);
      }
    }
  }
  return g.build();
}

export async function buildWorld(data: SceneData, renderer: THREE.WebGLRenderer, scene: THREE.Scene): Promise<World> {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const loader = new THREE.TextureLoader();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (name: string, srgb: boolean) =>
    new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(
        `/tex/${name}.jpg`,
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = maxAniso;
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          disposables.push(t);
          resolve(t);
        },
        undefined,
        reject,
      );
    });
  const [asphalt, asphaltN, asphaltR, pavers, paversN, stone, brickR, brickY, brickB, slate, bark] = await Promise.all([
    load("asphalt_diff", true), load("asphalt_nor", false), load("asphalt_rough", false),
    load("pavers_diff", true), load("pavers_nor", false),
    load("stone_diff", true), load("brick_red_diff", true), load("brick_yellow_diff", true), load("brick_brown_diff", true),
    load("slate_diff", true), load("bark_diff", true),
  ]);

  const grid = new SurfaceGrid(data);
  const [sx0, sz0, sx1, sz1] = data.scene;

  // ---- sky, sun, fog -------------------------------------------------
  const sunDir = new THREE.Vector3(-0.42, 0.74, 0.52).normalize(); // mid-afternoon, from the south-west
  const sky = new Sky();
  sky.scale.setScalar(6000);
  const su = sky.material.uniforms;
  su.turbidity.value = 5.5;
  su.rayleigh.value = 1.35;
  su.mieCoefficient.value = 0.006;
  su.mieDirectionalG.value = 0.82;
  su.sunPosition.value.copy(sunDir);
  if (su.cloudCoverage) {
    su.cloudCoverage.value = 0.46;
    su.cloudDensity.value = 0.55;
    su.cloudElevation.value = 0.55;
    if (su.cloudScale) su.cloudScale.value = 0.00022;
    if (su.cloudSpeed) su.cloudSpeed.value = 0.00004;
  }
  sky.material.fragmentShader = sky.material.fragmentShader.replace("gl_FragColor = vec4( texColor, 1.0 );", "gl_FragColor = vec4( texColor * 0.33, 1.0 );");
  group.add(sky);
  disposables.push(sky.geometry, sky.material);

  // environment for the glass: the sky plus a dark street-level horizon
  {
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(900);
    for (const k of Object.keys(su)) {
      const v = su[k].value;
      const dst = envSky.material.uniforms[k];
      if (!dst) continue;
      if (v && typeof v === "object" && "copy" in dst.value) dst.value.copy(v);
      else dst.value = v;
    }
    if (envSky.material.uniforms.showSunDisc) envSky.material.uniforms.showSunDisc.value = 0;
    envScene.add(envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(800, 32), new THREE.MeshBasicMaterial({ color: 0x4a4a48 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    envScene.add(ground);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const tones = [0x8a8274, 0x6e6558, 0x9a917f, 0x5c574f, 0x7d6a58];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const m = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: tones[i % tones.length] }));
      const r = 60 + hash01(i * 3.1) * 30;
      m.scale.set(26, 26 + hash01(i * 7.7) * 34, 12);
      m.position.set(Math.cos(a) * r, m.scale.y / 2 - 2, Math.sin(a) * r);
      m.lookAt(0, m.position.y, 0);
      envScene.add(m);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(envScene, 0.02, 1, 2000);
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.7;
    disposables.push(rt, pmrem, envSky.geometry, envSky.material, ground.geometry, boxGeo);
  }
  scene.fog = new THREE.Fog(0xb4c2d0, 300, 1700);

  const sun = new THREE.DirectionalLight(0xffeccf, 3.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -85; sc.right = 85; sc.top = 85; sc.bottom = -85; sc.near = 1; sc.far = 320;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.35;
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xdfe0df, 0x8a8172, 0.82);
  group.add(hemi);

  // ---- ground --------------------------------------------------------
  const asphaltMat = new THREE.MeshStandardMaterial({ map: asphalt, normalMap: asphaltN, roughnessMap: asphaltR, color: 0x8a8885, roughness: 1 });
  asphaltMat.normalScale.set(0.7, 0.7);
  asphaltMat.envMapIntensity = 0.3;
  const aoTex = bakeGroundAO(data);
  disposables.push(aoTex);
  const aoBox = new THREE.Vector4(sx0, sz0, 1 / Math.ceil(sx1 - sx0), 1 / Math.ceil(sz1 - sz0));
  groundify(asphaltMat, "road", 0.5, 0.6, aoTex, aoBox);
  const roadGeo = new THREE.PlaneGeometry(sx1 - sx0, sz1 - sz0);
  roadGeo.rotateX(-Math.PI / 2);
  roadGeo.translate((sx0 + sx1) / 2, 0, (sz0 + sz1) / 2);
  {
    const p = roadGeo.attributes.position, u = roadGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) u.setXY(i, p.getX(i) / 5, p.getZ(i) / 5);
  }
  const road = new THREE.Mesh(roadGeo, asphaltMat);
  road.receiveShadow = true;
  group.add(road);

  const paveMat = new THREE.MeshStandardMaterial({ map: pavers, normalMap: paversN, color: 0xb9b09e, roughness: 0.9 });
  paveMat.envMapIntensity = 0.7;
  groundify(paveMat, "pave", 0.47, 0.69, aoTex, aoBox);
  const pave = new THREE.Mesh(polysToGeometry(data.pavement, KERB, 3.2), paveMat);
  pave.receiveShadow = true;
  group.add(pave);

  const pedMat = new THREE.MeshStandardMaterial({ map: pavers, normalMap: paversN, color: 0xcbbfa6, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  groundify(pedMat, "zone", 0.5, 0.72, aoTex, aoBox);
  const pedMesh = new THREE.Mesh(polysToGeometry(data.ped, KERB + 0.006, 2.1), pedMat);
  pedMesh.receiveShadow = true;
  group.add(pedMesh);

  // the traffic-free stretch of Oxford Street: repaved carriageway
  const zoneMat = new THREE.MeshStandardMaterial({ map: asphalt, normalMap: asphaltN, roughnessMap: asphaltR, color: 0xffffff, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  zoneMat.normalScale.set(0.5, 0.5);
  zoneMat.envMapIntensity = 0.15;
  {
    // the carriageway here is painted: dark green with giant pale-green shapes
    const zc = data.zoneCentre ?? [];
    const a = zc[0] ?? [0, 0], b = zc[zc.length - 1] ?? [1, 0];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l;
    const m = zc[Math.floor(zc.length * 0.75)] ?? a;
    groundify(zoneMat, "paint", 0.5, 0.66, aoTex, aoBox, new THREE.Vector3(dx, dz, -m[0] * dz + m[1] * dx));
  }
  const zoneMesh = new THREE.Mesh(polysToGeometry(data.zoneRoad ?? [], 0.008, 5), zoneMat);
  zoneMesh.receiveShadow = true;
  group.add(zoneMesh);

  const grassMat = new THREE.MeshStandardMaterial({ color: 0x55793a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const grass = new THREE.Mesh(polysToGeometry(data.green, KERB + 0.012, 4), grassMat);
  grass.receiveShadow = true;
  group.add(grass);

  // kerb faces and a granite kerbstone band
  {
    const kb = new GeoBuilder();
    for (const poly of data.pavement) {
      for (const r of poly) {
        const cnt = r.length / 2;
        for (let i = 0; i < cnt; i++) {
          const j = (i + 1) % cnt;
          const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
          if (Math.abs(ax - bx) + Math.abs(az - bz) < 0.01) continue;
          kb.quad([ax, 0, az], [bx, 0, bz], [bx, KERB, bz], [ax, KERB, az], 0x66645f);
          // top band, pushed in from the edge on whichever side is pavement
          const l = Math.hypot(bx - ax, bz - az);
          const nx = -(bz - az) / l, nz = (bx - ax) / l;
          const mx = (ax + bx) / 2, mz = (az + bz) / 2;
          const s = grid.at(mx + nx * 0.6, mz + nz * 0.6) === SURFACE_PAVEMENT ? 1 : -1;
          const ox = nx * 0.1 * s, oz = nz * 0.1 * s;
          kb.strip(ax + ox, az + oz, bx + ox, bz + oz, 0.2, KERB + 0.004, 0x7b7973);
        }
      }
    }
    const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const kerb = new THREE.Mesh(kb.build(), kerbMat);
    kerb.receiveShadow = true;
    group.add(kerb);
  }

  const markMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const marks = new THREE.Mesh(buildMarkings(data, grid), markMat);
  marks.receiveShadow = true;
  group.add(marks);

  // ---- buildings -----------------------------------------------------
  const facadeMat = makeFacadeMaterial({ stone, brickR, brickY, brickB, slate });
  const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  buildBuildings(data, facadeMat, trimMat, group);

  // ---- signs, street furniture --------------------------------------
  buildSigns(data, group, maxAniso);
  let treeTick: (t: number) => void = () => {};
  const props = buildProps(data, group, grid, { bark });
  try {
    const trees = await buildTrees(props.treeSpots, group);
    disposables.push(trees);
    treeTick = trees.update;
  } catch (e) {
    console.warn("trees unavailable", e);
  }

  scene.add(group);

  // spatial hash of solid street furniture, 2 m cells
  const cells = new Map<number, number[]>();
  const keyOf = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
  for (let k = 0; k < props.solids.length; k += 3) {
    const key = keyOf(Math.floor(props.solids[k] / 2), Math.floor(props.solids[k + 1] / 2));
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(props.solids[k], props.solids[k + 1], props.solids[k + 2]);
  }
  const solid = (x: number, z: number, r: number) => {
    const ci = Math.floor(x / 2), cj = Math.floor(z / 2);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = cells.get(keyOf(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 3) {
          const dx = list[k] - x, dz = list[k + 1] - z, rr = list[k + 2] + r;
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
    }
    return false;
  };

  return {
    group,
    grid,
    sun,
    sunDir,
    sky,
    setSignal: props.setSignal,
    solid,
    update(time: number) {
      if (su.time) su.time.value = time;
      treeTick(time);
    },
    dispose() {
      scene.remove(group);
      scene.environment = null;
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => disposeMaterial(x));
        else if (mat) disposeMaterial(mat);
      });
      disposables.forEach((d) => d.dispose());
    },
  };
}

export function disposeMaterial(m: THREE.Material) {
  for (const v of Object.values(m)) {
    if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
  }
  m.dispose();
}
