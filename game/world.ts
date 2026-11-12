import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { makeFacadeMaterial, STYLE } from "./facade";
import { GeoBuilder, Path, polysToGeometry, ringToPairs, SurfaceGrid } from "./geo";
import { buildProps } from "./props";
import { buildSigns } from "./signs";
import { hash01, SURFACE_PAVEMENT, type BuildingData, type SceneData } from "./types";

export const KERB = 0.13;

export interface World {
  group: THREE.Group;
  grid: SurfaceGrid;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  sky: Sky;
  setSignal: (index: number, state: number) => void; // 0 green, 1 amber, 2 red
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
  const stoneTint = new THREE.Color(0.9, 0.85, 0.74).multiplyScalar(0.92 + 0.12 * s2);
  if (b.arch === "mock_tudor" || mat === "timber_framing") return { style: STYLE.TUDOR, tint: white };
  if (mat === "glass") return { style: STYLE.GLASS, tint: new THREE.Color(0.4, 0.43, 0.46) };
  if (mat === "stone" || mat === "sandstone") {
    const t = col ? col.clone().lerp(stoneTint, 0.6) : stoneTint;
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
  const trim = new GeoBuilder();
  let n = 0;
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number,
    L: number, H: number, style: number, seed: number, c: THREE.Color, f: number) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    uv.push(u, v);
    info.push(L, H, style, seed);
    col.push(c.r, c.g, c.b);
    flag.push(f);
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
      const i0 = push(bx, y0, bz, nx, 0, nz, L, 0, L, H, style, wseed, tint, f);
      push(ax, y0, az, nx, 0, nz, 0, 0, L, H, style, wseed, tint, f);
      push(ax, y1, az, nx, 0, nz, 0, H, L, H, style, wseed, tint, f);
      push(bx, y1, bz, nx, 0, nz, L, H, L, H, style, wseed, tint, f);
      idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
      // real ledges where the street can see them: shop cornice and roof cornice
      if (b.play && facing && L > 2.2) {
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const yaw = Math.atan2(-dz, dx);
        const modern = style === STYLE.CONCRETE || style === STYLE.GLASS;
        const tc = modern ? tint.clone().multiplyScalar(0.7) : style === STYLE.STONE ? tint.clone().multiplyScalar(0.92) : new THREE.Color(0.74, 0.71, 0.64);
        if (f === 2) trim.box(mx + nx * 0.16, 4.27, mz + nz * 0.16, L + 0.3, 0.16, 0.34, yaw, tc);
        if (!modern && H > 9) trim.box(mx + nx * 0.2, b.h - 0.72, mz + nz * 0.2, L + 0.4, 0.24, 0.44, yaw, tc);
        trim.box(mx + nx * 0.06, b.h + 0.06, mz + nz * 0.06, L + 0.12, 0.12, 0.42, yaw, tc.clone().multiplyScalar(0.85));
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
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  const tm = new THREE.Mesh(trim.build(), trimMat);
  tm.castShadow = true;
  tm.receiveShadow = true;
  tm.frustumCulled = false;
  group.add(tm);
}


/** Post-rain sheen: damp stains and mirror-smooth puddles laid over a ground material. */
function wetify(mat: THREE.MeshStandardMaterial, damp: number, puddle: number, key: string) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWPos;
        float fDamp; float fPuddle;
        float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), f.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), f.x), f.y); }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          vec2 p = vWPos.xz;
          float f = wn(p * 0.07) * 0.5 + wn(p * 0.19 + 7.3) * 0.3 + wn(p * 0.63 + 3.1) * 0.14 + wn(p * 2.1) * 0.06;
          fDamp = smoothstep(${damp.toFixed(3)}, ${(damp + 0.12).toFixed(3)}, f);
          fPuddle = smoothstep(${puddle.toFixed(3)}, ${(puddle + 0.03).toFixed(3)}, f);
          diffuseColor.rgb *= mix(1.0, 0.66, fDamp) * mix(1.0, 0.7, fPuddle);
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, 0.46, fDamp), 0.03, fPuddle);",
      )
      .replace(
        "#include <normal_fragment_maps>",
        "#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, max(fPuddle, fDamp * 0.55)));",
      );
  };
  mat.customProgramCacheKey = () => "wet-" + key;
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
      const ox = s.x + s.tx * side * 3.6, oz = s.z + s.tz * side * 3.6;
      g.strip(ox - px * s.hw, oz - pz * s.hw, ox + px * s.hw, oz + pz * s.hw, 0.3, Y, WHITE);
      const sx = s.x + s.tx * side * 1.7, sz = s.z + s.tz * side * 1.7;
      for (let d = -s.hw + 0.3; d < s.hw - 0.2; d += 0.55) {
        g.strip(sx + px * d, sz + pz * d, sx + px * (d + 0.16), sz + pz * (d + 0.16), 0.16, Y, WHITE);
      }
      // zig-zags on the approach
      for (const lane of [-1, 1]) {
        const lx = px * (s.hw - 0.35) * lane, lz = pz * (s.hw - 0.35) * lane;
        for (let k = 0; k < 5; k++) {
          const d0 = 4.4 + k * 2, d1 = d0 + 2;
          const o0 = k % 2 ? 0.25 : -0.25, o1 = -o0;
          g.strip(
            s.x + s.tx * side * d0 + lx + px * o0, s.z + s.tz * side * d0 + lz + pz * o0,
            s.x + s.tx * side * d1 + lx + px * o1, s.z + s.tz * side * d1 + lz + pz * o1, 0.1, Y, WHITE,
          );
        }
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
  const [asphalt, asphaltN, asphaltR, pavers, paversN, granite, graniteN, stone, brickR, brickY, brickB, slate, bark] = await Promise.all([
    load("asphalt_diff", true), load("asphalt_nor", false), load("asphalt_rough", false),
    load("pavers_diff", true), load("pavers_nor", false),
    load("granite_diff", true), load("granite_nor", false),
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
  sky.material.fragmentShader = sky.material.fragmentShader.replace("gl_FragColor = vec4( texColor, 1.0 );", "gl_FragColor = vec4( texColor * 0.4, 1.0 );");
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
    scene.environmentIntensity = 0.85;
    disposables.push(rt, pmrem, envSky.geometry, envSky.material, ground.geometry, boxGeo);
  }
  scene.fog = new THREE.Fog(0xc3ced8, 260, 1500);

  const sun = new THREE.DirectionalLight(0xffeed6, 3.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -85; sc.right = 85; sc.top = 85; sc.bottom = -85; sc.near = 1; sc.far = 320;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.35;
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xe4e6e8, 0x7a7468, 0.9);
  group.add(hemi);

  // ---- ground --------------------------------------------------------
  const asphaltMat = new THREE.MeshStandardMaterial({ map: asphalt, normalMap: asphaltN, roughnessMap: asphaltR, color: 0x6b6a68, roughness: 1 });
  asphaltMat.normalScale.set(0.7, 0.7);
  asphaltMat.envMapIntensity = 1.0;
  wetify(asphaltMat, 0.4, 0.585, "road");
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

  const paveMat = new THREE.MeshStandardMaterial({ map: pavers, normalMap: paversN, color: 0xb9b6ae, roughness: 0.9 });
  paveMat.envMapIntensity = 1.3;
  wetify(paveMat, 0.47, 0.69, "pave");
  const pave = new THREE.Mesh(polysToGeometry(data.pavement, KERB, 3.2), paveMat);
  pave.receiveShadow = true;
  group.add(pave);

  const pedMat = new THREE.MeshStandardMaterial({ map: pavers, normalMap: paversN, color: 0xcbbfa6, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pedMesh = new THREE.Mesh(polysToGeometry(data.ped, KERB + 0.006, 2.1), pedMat);
  pedMesh.receiveShadow = true;
  group.add(pedMesh);

  // the traffic-free stretch of Oxford Street: repaved carriageway
  const zoneMat = new THREE.MeshStandardMaterial({ map: pavers, normalMap: paversN, color: 0xd6ccb6, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  zoneMat.envMapIntensity = 1.3;
  wetify(zoneMat, 0.45, 0.66, "zone");
  const zoneMesh = new THREE.Mesh(polysToGeometry(data.zoneRoad ?? [], 0.008, 1.9), zoneMat);
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
          kb.quad([ax, 0, az], [bx, 0, bz], [bx, KERB, bz], [ax, KERB, az], 0x7f7d77);
          // top band, pushed in from the edge on whichever side is pavement
          const l = Math.hypot(bx - ax, bz - az);
          const nx = -(bz - az) / l, nz = (bx - ax) / l;
          const mx = (ax + bx) / 2, mz = (az + bz) / 2;
          const s = grid.at(mx + nx * 0.6, mz + nz * 0.6) === SURFACE_PAVEMENT ? 1 : -1;
          const ox = nx * 0.1 * s, oz = nz * 0.1 * s;
          kb.strip(ax + ox, az + oz, bx + ox, bz + oz, 0.2, KERB + 0.004, 0x94918a);
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
  const props = buildProps(data, group, grid, { bark });

  scene.add(group);

  return {
    group,
    grid,
    sun,
    sunDir,
    sky,
    setSignal: props.setSignal,
    update(time: number) {
      if (su.time) su.time.value = time;
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
