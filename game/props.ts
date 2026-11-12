import * as THREE from "three";
import { GeoBuilder, Path, type SurfaceGrid } from "./geo";
import type { TreeSpot } from "./trees";
import { hash01, SURFACE_PAVEMENT, SURFACE_ROAD, type SceneData } from "./types";

const KERB = 0.13;

function cyl(g: GeoBuilder, x: number, z: number, y0: number, y1: number, r0: number, r1: number, color: THREE.ColorRepresentation, seg = 8, cap = true) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const b = g.count;
    // smooth normals around the barrel
    g.vert(x + c0 * r0, y0, z + s0 * r0, c0, 0, s0, 0, 0, color);
    g.vert(x + c1 * r0, y0, z + s1 * r0, c1, 0, s1, 1, 0, color);
    g.vert(x + c1 * r1, y1, z + s1 * r1, c1, 0, s1, 1, 1, color);
    g.vert(x + c0 * r1, y1, z + s0 * r1, c0, 0, s0, 0, 1, color);
    g.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    if (cap) {
      const t = g.count;
      g.vert(x, y1, z, 0, 1, 0, 0.5, 0.5, color);
      g.vert(x + c0 * r1, y1, z + s0 * r1, 0, 1, 0, 0, 0, color);
      g.vert(x + c1 * r1, y1, z + s1 * r1, 0, 1, 0, 1, 0, color);
      g.idx.push(t, t + 2, t + 1);
    }
  }
}

const ICO = new THREE.IcosahedronGeometry(1, 1);

function blob(g: GeoBuilder, cx: number, cy: number, cz: number, rx: number, ry: number, seed: number, dark: THREE.Color, light: THREE.Color) {
  const p = ICO.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const b = g.count;
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      const j = 0.82 + 0.36 * hash01(Math.round(x * 31) + Math.round(y * 17) * 7 + Math.round(z * 13) * 3 + seed * 5);
      c.copy(dark).lerp(light, Math.max(0, Math.min(1, y * 0.5 + 0.5)) * (0.6 + 0.4 * hash01(seed + i)));
      g.vert(cx + x * rx * j, cy + y * ry * j, cz + z * rx * j, x, y * 0.8 + 0.2, z, 0, 0, c);
    }
    g.idx.push(b, b + 1, b + 2);
  }
}

function roundelTexture(kind: "tube" | "bus"): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const c = cv.getContext("2d")!;
  c.clearRect(0, 0, 256, 256);
  if (kind === "bus") {
    c.fillStyle = "#f4f4f2";
    c.fillRect(0, 0, 256, 256);
  }
  c.beginPath();
  c.arc(128, 128, 104, 0, Math.PI * 2);
  c.fillStyle = "#dc241f";
  c.fill();
  c.beginPath();
  c.arc(128, 128, 70, 0, Math.PI * 2);
  c.fillStyle = "#ffffff";
  c.fill();
  c.fillStyle = kind === "tube" ? "#0019a8" : "#dc241f";
  c.fillRect(4, 100, 248, 56);
  c.fillStyle = "#ffffff";
  c.font = `700 ${kind === "tube" ? 30 : 34}px "Helvetica Neue", Arial, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(kind === "tube" ? "UNDERGROUND" : "BUS STOP", 128, 130, 236);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildProps(data: SceneData, group: THREE.Group, grid: SurfaceGrid, tex: { bark: THREE.Texture }) {
  const g = new GeoBuilder();
  const metal = new GeoBuilder();
  const treeSpots: TreeSpot[] = [];
  // things a bike cannot ride through: x, z, radius
  const solids: number[] = [];

  /** Unit vector from a point towards the nearest carriageway. */
  const toRoad = (x: number, z: number): [number, number] => {
    for (let r = 0.8; r < 9; r += 0.8) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        if (grid.at(x + Math.cos(a) * r, z + Math.sin(a) * r) === SURFACE_ROAD) return [Math.cos(a), Math.sin(a)];
      }
    }
    const a = hash01(x * 3.3 + z) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  };

  // ---- street lamps ---------------------------------------------------
  const busPaths = data.busRoutes.map((r) => new Path(r.pts));
  const BLACKP = 0x15171a;
  const bannerPos: number[] = [], bannerUv: number[] = [], bannerIdx: number[] = [], bannerNor: number[] = [];
  for (const [x, z, ax, az] of data.lamps) {
    const zoneNear = grid.inZone(x + ax * 3, z + az * 3) || grid.inZone(x + ax * 6, z + az * 6);
    const main = zoneNear || busPaths.some((p) => p.project(x, z).d < 16);
    const yaw = Math.atan2(-az, ax);
    if (main) {
      solids.push(x, z, 0.2);
      // tall black column with a swan-neck arm
      cyl(metal, x, z, KERB, KERB + 1.1, 0.15, 0.12, BLACKP, 8, false);
      cyl(metal, x, z, KERB + 1.1, KERB + 1.22, 0.16, 0.16, BLACKP, 8, false);
      cyl(metal, x, z, KERB + 1.22, 8.6, 0.09, 0.06, BLACKP, 6, false);
      metal.box(x + ax * 0.75, 8.55, z + az * 0.75, 1.6, 0.06, 0.06, yaw, BLACKP);
      metal.box(x + ax * 1.5, 8.42, z + az * 1.5, 0.62, 0.16, 0.32, yaw, BLACKP);
      g.box(x + ax * 1.5, 8.33, z + az * 1.5, 0.5, 0.03, 0.24, yaw, 0xfaf6e6);
      if (zoneNear) {
        // "OXFORD ST" banner on a bracket
        const tx = -az, tz = ax;
        const bx = x + tx * 0.5, bz = z + tz * 0.5;
        metal.box(x + tx * 0.3, 6.5, z + tz * 0.3, 0.05, 0.05, 0.7, yaw, BLACKP);
        metal.box(x + tx * 0.3, 4.2, z + tz * 0.3, 0.05, 0.05, 0.7, yaw, BLACKP);
        const b = bannerPos.length / 3;
        bannerPos.push(bx - tx * 0.34, 4.2, bz - tz * 0.34, bx + tx * 0.34, 4.2, bz + tz * 0.34, bx + tx * 0.34, 6.5, bz + tz * 0.34, bx - tx * 0.34, 6.5, bz - tz * 0.34);
        for (let k = 0; k < 4; k++) bannerNor.push(ax, 0, az);
        bannerUv.push(0, 0, 1, 0, 1, 1, 0, 1);
        bannerIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    } else {
      // side streets: black post with a lantern, as on Berwick Street
      solids.push(x, z, 0.16);
      cyl(metal, x, z, KERB, KERB + 0.9, 0.12, 0.09, BLACKP, 8, false);
      cyl(metal, x, z, KERB + 0.9, 5.3, 0.06, 0.05, BLACKP, 6, false);
      cyl(g, x, z, 5.3, 5.75, 0.13, 0.2, 0xf3ecd2, 6, false);
      cyl(metal, x, z, 5.75, 5.95, 0.24, 0.05, BLACKP, 6);
      cyl(metal, x, z, 5.22, 5.3, 0.1, 0.14, BLACKP, 6, false);
    }
  }
  if (bannerPos.length) {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 432;
    const c = cv.getContext("2d")!;
    c.fillStyle = "#1f4a34";
    c.fillRect(0, 0, 128, 432);
    c.save();
    c.translate(64, 216);
    c.rotate(-Math.PI / 2);
    c.fillStyle = "#b9e59a";
    c.font = `800 74px "Helvetica Neue", Arial, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("OXFORD ST", 0, 4, 400);
    c.restore();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(bannerPos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(bannerNor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(bannerUv, 2));
    geo.setIndex(bannerIdx);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.8 }));
    m.frustumCulled = false;
    m.castShadow = true;
    group.add(m);
  }

  // ---- Union flags strung across Regent Street -------------------------
  {
    const cv = document.createElement("canvas");
    cv.width = 240;
    cv.height = 144;
    const c = cv.getContext("2d")!;
    c.fillStyle = "#012169";
    c.fillRect(0, 0, 240, 144);
    c.lineCap = "butt";
    const diag = (w: number, col: string) => {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(0, 0); c.lineTo(240, 144);
      c.moveTo(240, 0); c.lineTo(0, 144);
      c.stroke();
    };
    diag(29, "#ffffff");
    diag(10, "#c8102e");
    c.fillStyle = "#ffffff";
    c.fillRect(96, 0, 48, 144);
    c.fillRect(0, 48, 240, 48);
    c.fillStyle = "#c8102e";
    c.fillRect(105.6, 0, 28.8, 144);
    c.fillRect(0, 57.6, 240, 28.8);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [], nor: number[] = [];
    const regent = busPaths[1];
    const a = { x: 0, z: 0, tx: 0, tz: 0 };
    const [px0, pz0, px1, pz1] = data.play;
    if (regent) {
      for (let s = 12; s < regent.length - 12; s += 21) {
        regent.at(s, a);
        if (a.x < px0 - 30 || a.x > px1 + 30 || a.z < pz0 - 30 || a.z > pz1 + 30) continue;
        if (grid.inZone(a.x, a.z)) continue;
        const px = -a.tz, pz = a.tx;
        // span from wall to wall
        let l = 6, r = 6;
        while (l < 20 && !grid.blocked(a.x - px * (l + 1), a.z - pz * (l + 1))) l++;
        while (r < 20 && !grid.blocked(a.x + px * (r + 1), a.z + pz * (r + 1))) r++;
        const y = 13.5;
        metal.box(a.x + px * (r - l) / 2, y, a.z + pz * (r - l) / 2, l + r, 0.025, 0.025, Math.atan2(-pz, px), 0x2a2c2e);
        for (const off of [-0.58, 0, 0.58]) {
          const cx = a.x + px * ((r - l) / 2 + off * (l + r) * 0.5), cz = a.z + pz * ((r - l) / 2 + off * (l + r) * 0.5);
          const hw = 1.5, hh = 2.9 * 0.6;
          const sag = Math.abs(off) > 0.1 ? 0 : -0.25;
          const b = pos.length / 3;
          pos.push(cx - px * hw, y - 0.05 + sag - hh * 1.0, cz - pz * hw, cx + px * hw, y - 0.05 + sag - hh, cz + pz * hw, cx + px * hw, y - 0.05 + sag, cz + pz * hw, cx - px * hw, y - 0.05 + sag, cz - pz * hw);
          for (let k = 0; k < 4; k++) nor.push(a.tx, 0, a.tz);
          uv.push(0, 0, 1, 0, 1, 1, 0, 1);
          idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
      }
    }
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.85 }));
      m.frustumCulled = false;
      m.castShadow = true;
      group.add(m);
    }
  }

  // ---- traffic signals -------------------------------------------------
  const lampGeo = new THREE.CircleGeometry(0.095, 12);
  const perSignal = 2 * (2 * 3 + 1);
  const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), data.signals.length * perSignal);
  const dummy = new THREE.Object3D();
  const BLACK = 0x161718;
  data.signals.forEach((s, si) => {
    const px = -s.tz, pz = s.tx;
    let n = si * perSignal;
    for (const side of [-1, 1]) {
      const x = s.x + px * side * (s.hw + 0.55) + s.tx * side * 2.9;
      const z = s.z + pz * side * (s.hw + 0.55) + s.tz * side * 2.9;
      cyl(metal, x, z, KERB, 3.75, 0.065, 0.065, 0x2a2c2e, 6);
      solids.push(x, z, 0.14);
      const yaw = Math.atan2(-s.tz, s.tx);
      for (const face of [-1, 1]) {
        const hx = x + s.tx * face * 0.2, hz = z + s.tz * face * 0.2;
        metal.box(hx, 3.15, hz, 0.24, 1.02, 0.36, yaw, BLACK);
        metal.box(hx - s.tx * face * 0.1, 3.15, hz - s.tz * face * 0.1, 0.03, 1.2, 0.52, yaw, BLACK); // backing board
        for (let k = 0; k < 3; k++) {
          dummy.position.set(hx + s.tx * face * 0.125, 3.47 - k * 0.32, hz + s.tz * face * 0.125);
          dummy.lookAt(dummy.position.x + s.tx * face, dummy.position.y, dummy.position.z + s.tz * face);
          dummy.updateMatrix();
          lamps.setMatrixAt(n++, dummy.matrix);
        }
      }
      // pedestrian aspect, facing across the road
      const fx = -px * side, fz = -pz * side;
      metal.box(x + fx * 0.16, 2.25, z + fz * 0.16, 0.3, 0.5, 0.22, Math.atan2(-fx, fz) + Math.PI / 2, BLACK);
      dummy.position.set(x + fx * 0.28, 2.25, z + fz * 0.28);
      dummy.scale.set(1.3, 1.3, 1.3);
      dummy.lookAt(dummy.position.x + fx, 2.25, dummy.position.z + fz);
      dummy.updateMatrix();
      dummy.scale.set(1, 1, 1);
      lamps.setMatrixAt(n++, dummy.matrix);
      // push-button box
      g.box(x + fx * 0.1, 1.15, z + fz * 0.1, 0.14, 0.22, 0.1, yaw, 0xd9b21c);
    }
  });
  lamps.instanceMatrix.needsUpdate = true;
  lamps.frustumCulled = false;
  const ON = [new THREE.Color(0.1, 1.0, 0.35), new THREE.Color(1.0, 0.62, 0.05), new THREE.Color(1.0, 0.1, 0.06)];
  const OFF = [new THREE.Color(0.02, 0.09, 0.04), new THREE.Color(0.1, 0.06, 0.01), new THREE.Color(0.11, 0.015, 0.01)];
  const setSignal = (si: number, state: number) => {
    let n = si * perSignal;
    for (let side = 0; side < 2; side++) {
      for (let face = 0; face < 2; face++) {
        // lamps top to bottom: red, amber, green
        lamps.setColorAt(n++, state === 2 ? ON[2] : OFF[2]);
        lamps.setColorAt(n++, state === 1 ? ON[1] : OFF[1]);
        lamps.setColorAt(n++, state === 0 ? ON[0] : OFF[0]);
      }
      lamps.setColorAt(n++, state === 2 ? ON[0] : ON[2]); // green man when traffic is held
    }
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  };
  for (let i = 0; i < data.signals.length; i++) setSignal(i, 0);
  group.add(lamps);

  // ---- belisha beacons -------------------------------------------------
  for (const s of data.zebras) {
    const px = -s.tz, pz = s.tx;
    for (const side of [-1, 1]) {
      const x = s.x + px * side * (s.hw + 0.5), z = s.z + pz * side * (s.hw + 0.5);
      for (let k = 0; k < 6; k++) cyl(g, x, z, KERB + k * 0.4, KERB + (k + 1) * 0.4, 0.045, 0.045, k % 2 ? 0xf2f2f2 : 0x111111, 6, false);
      blob(g, x, KERB + 2.55, z, 0.17, 0.17, 1, new THREE.Color(1.0, 0.55, 0.05), new THREE.Color(1.0, 0.7, 0.1));
    }
  }

  // ---- small furniture -------------------------------------------------
  const P = data.props;
  const RED = 0xb5121b;
  for (const [x, z] of P.postbox ?? []) {
    cyl(g, x, z, KERB, KERB + 0.12, 0.26, 0.26, 0x111111, 10, false);
    solids.push(x, z, 0.3);
    cyl(g, x, z, KERB + 0.12, KERB + 1.32, 0.225, 0.225, RED, 10, false);
    cyl(g, x, z, KERB + 1.32, KERB + 1.4, 0.26, 0.24, RED, 10, false);
    cyl(g, x, z, KERB + 1.4, KERB + 1.52, 0.24, 0.08, RED, 10);
    const [dx, dz] = toRoad(x, z);
    g.box(x + dx * 0.22, KERB + 1.12, z + dz * 0.22, 0.03, 0.035, 0.2, Math.atan2(-dz, dx), 0x111111);
  }
  for (const [x, z] of P.phone ?? []) {
    const [dx, dz] = toRoad(x, z);
    const yaw = Math.atan2(-dz, dx);
    g.box(x, KERB + 1.2, z, 0.9, 2.4, 0.9, yaw, RED);
    solids.push(x, z, 0.6);
    g.box(x, KERB + 2.46, z, 0.8, 0.12, 0.8, yaw, RED);
    g.box(x, KERB + 2.16, z, 0.93, 0.16, 0.93, yaw, 0xf0ead8);
    for (const [ox, oz, sx, sz] of [[0.451, 0, 0.012, 0.66], [-0.451, 0, 0.012, 0.66], [0, 0.451, 0.66, 0.012]] as const) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      g.box(x + ox * c + oz * s, KERB + 1.2, z - ox * s + oz * c, sx, 1.6, sz, yaw, 0x1c2428);
    }
  }
  for (const [x, z] of P.bin ?? []) {
    cyl(g, x, z, KERB, KERB + 0.95, 0.27, 0.29, 0x18191a, 8, false);
    solids.push(x, z, 0.34);
    cyl(g, x, z, KERB + 0.62, KERB + 0.7, 0.295, 0.295, 0xc9a227, 8, false);
    cyl(g, x, z, KERB + 0.95, KERB + 1.08, 0.3, 0.16, 0x18191a, 8);
  }
  for (const [x, z] of P.bench ?? []) {
    const [dx, dz] = toRoad(x, z);
    const yaw = Math.atan2(-dz, dx) + Math.PI / 2;
    g.box(x, KERB + 0.45, z, 1.7, 0.06, 0.46, yaw, 0x6b4a2e);
    g.box(x - dx * 0.24, KERB + 0.78, z - dz * 0.24, 1.7, 0.36, 0.05, yaw, 0x6b4a2e);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const e of [-0.72, 0.72]) g.box(x + e * c, KERB + 0.22, z - e * s, 0.06, 0.45, 0.44, yaw, 0x1a1a1a);
  }
  for (const [x, z] of P.rack ?? []) {
    const [dx, dz] = toRoad(x, z);
    const yaw = Math.atan2(-dz, dx);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const e of [-0.35, 0.35]) metal.box(x + e * c, KERB + 0.4, z - e * s, 0.045, 0.8, 0.045, yaw, 0x9aa0a4);
    metal.box(x, KERB + 0.8, z, 0.75, 0.045, 0.045, yaw, 0x9aa0a4);
  }
  for (const [x, z] of P.dock ?? []) {
    const [dx, dz] = toRoad(x, z);
    const tx = -dz, tz = dx;
    const yaw = Math.atan2(-tz, tx);
    for (let k = -4; k <= 4; k++) {
      g.box(x + tx * k * 0.75, KERB + 0.4, z + tz * k * 0.75, 0.22, 0.8, 0.34, yaw, 0x3b4046);
      g.box(x + tx * k * 0.75, KERB + 0.82, z + tz * k * 0.75, 0.24, 0.05, 0.36, yaw, 0xcf1e2c);
    }
    g.box(x + tx * 4.2, KERB + 1.1, z + tz * 4.2, 0.4, 2.2, 0.25, yaw, 0x14234a);
  }

  // ---- roundels: tube entrances and bus stop flags ---------------------
  const flag = (list: [number, number, string?][], kind: "tube" | "bus", size: number, height: number) => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [], nor: number[] = [];
    for (const [x, z] of list) {
      const [dx, dz] = toRoad(x, z);
      const tx = dx, tz = dz; // plane spans towards the road so traffic sees it face-on
      cyl(metal, x, z, KERB, height + size * 0.6, 0.05, 0.05, kind === "tube" ? 0x20242a : 0x8d9296, 6);
      const cx = x + tx * (size / 2 + 0.06), cz = z + tz * (size / 2 + 0.06);
      const h = size / 2;
      const b = pos.length / 3;
      pos.push(cx - tx * h, height - h, cz - tz * h, cx + tx * h, height - h, cz + tz * h, cx + tx * h, height + h, cz + tz * h, cx - tx * h, height + h, cz - tz * h);
      for (let k = 0; k < 4; k++) nor.push(-tz, 0, tx);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      if (kind === "tube") {
        // stairwell railings
        const yaw = Math.atan2(-tz, tx);
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const wx = x - tx * 1.6, wz = z - tz * 1.6;
        for (const [ox, oz, sx, sz] of [[0, 1.1, 3.2, 0.06], [0, -1.1, 3.2, 0.06], [-1.6, 0, 0.06, 2.2]] as const) {
          metal.box(wx + ox * c + oz * s, KERB + 1.05, wz - ox * s + oz * c, sx, 0.06, sz, yaw, 0x20242a);
          metal.box(wx + ox * c + oz * s, KERB + 0.5, wz - ox * s + oz * c, sx, 0.9, sz * 0.5, yaw, 0x2b3036);
        }
        g.box(wx, KERB + 0.02, wz, 3.1, 0.04, 2.1, yaw, 0x0c0d0e);
      }
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: roundelTexture(kind), transparent: kind === "tube", alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5,
      emissive: 0xffffff, emissiveIntensity: 0.12,
    }));
    (m.material as THREE.MeshStandardMaterial).emissiveMap = (m.material as THREE.MeshStandardMaterial).map;
    m.frustumCulled = false;
    group.add(m);
  };
  flag(P.tube ?? [], "tube", 1.0, 3.6);
  flag(P.busstop ?? [], "bus", 0.5, 2.9);

  // ---- trees (London planes) -------------------------------------------
  const trunks = new GeoBuilder();
  const leaves = new GeoBuilder();
  (P.tree ?? []).forEach(([x, z], i) => {
    const base = grid.at(x, z) === SURFACE_ROAD ? 0 : KERB;
    treeSpots.push({ x, y: base, z, h: 9 + hash01(i * 3.7) * 5 });
    solids.push(x, z, 0.32);
    // tree pit
    g.box(x, base + 0.012, z, 1.3, 0.02, 1.3, 0, 0x4a4037);
  });
  // ---- bollards, bins, A-boards, cafe tables: the stuff pavements are full of ----
  {
    const [px0, pz0, px1, pz1] = data.play;
    const inPlay = (x: number, z: number, m: number) => x > px0 - m && x < px1 + m && z > pz0 - m && z < pz1 + m;
    const BOLL = 0x121314;
    const tmp = { x: 0, z: 0, tx: 0, tz: 0 };
    data.kerbs.forEach((k, ki) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < k.p.length; i += 2) pts.push([k.p[i], k.p[i + 1]]);
      if (pts.length < 2) return;
      const path = new Path(pts);
      const mid = path.at(path.length / 2, tmp);
      const side = grid.at(mid.x - mid.tz * 1.0, mid.z + mid.tx * 1.0) === SURFACE_PAVEMENT ? 1 : -1;
      for (let s = 1.2; s < path.length - 1; s += 2.7) {
        const chunk = Math.floor(s / 32);
        const run = hash01(ki * 13.7 + chunk * 3.1);
        const a = path.at(s, tmp);
        if (!inPlay(a.x, a.z, 50)) continue;
        const x = a.x - a.tz * 0.5 * side, z = a.z + a.tx * 0.5 * side;
        if (grid.at(x, z) !== SURFACE_PAVEMENT) continue;
        if (run < 0.5) {
          cyl(metal, x, z, KERB, KERB + 0.92, 0.075, 0.06, BOLL, 6, false);
          solids.push(x, z, 0.16);
          cyl(metal, x, z, KERB + 0.92, KERB + 1.0, 0.085, 0.03, BOLL, 6);
          cyl(g, x, z, KERB + 0.74, KERB + 0.8, 0.078, 0.076, 0xd8d8d2, 6, false);
        } else if (run > 0.93 && Math.floor(s / 2.7) % 9 === 4) {
          // Westminster litter bin
          cyl(g, x - a.tz * 0.25 * side, z + a.tx * 0.25 * side, KERB, KERB + 0.95, 0.27, 0.29, 0x18191a, 8, false);
          solids.push(x - a.tz * 0.25 * side, z + a.tx * 0.25 * side, 0.34);
          cyl(g, x - a.tz * 0.25 * side, z + a.tx * 0.25 * side, KERB + 0.62, KERB + 0.7, 0.295, 0.295, 0xc9a227, 8, false);
          cyl(g, x - a.tz * 0.25 * side, z + a.tx * 0.25 * side, KERB + 0.95, KERB + 1.08, 0.3, 0.16, 0x18191a, 8);
        } else if (run > 0.8 && run < 0.86 && Math.floor(s / 2.7) % 4 === 0) {
          // a rank of cycle stands
          const yaw = Math.atan2(-a.tz, a.tx) + Math.PI / 2;
          const c = Math.cos(yaw), sn = Math.sin(yaw);
          const bx = x - a.tz * 0.5 * side, bz = z + a.tx * 0.5 * side;
          for (const e of [-0.35, 0.35]) metal.box(bx + e * c, KERB + 0.4, bz - e * sn, 0.045, 0.8, 0.045, yaw, 0x9aa0a4);
          metal.box(bx, KERB + 0.8, bz, 0.75, 0.045, 0.045, yaw, 0x9aa0a4);
        }
      }
    });
    // outside the shops
    for (const s of data.signs) {
      const h = hash01(s.x * 7.1 + s.z * 3.3);
      const tx = -s.nz, tz = s.nx;
      const food = s.k === "cafe" || s.k === "restaurant" || s.k === "pub" || s.k === "bar";
      if (food && h < 0.62) {
        // tables and chairs against the frontage
        const n = Math.max(1, Math.min(3, Math.floor(s.w / 1.9)));
        for (let i = 0; i < n; i++) {
          const o = (i - (n - 1) / 2) * 1.9;
          const x = s.x + s.nx * 1.15 + tx * o, z = s.z + s.nz * 1.15 + tz * o;
          if (grid.at(x, z) !== SURFACE_PAVEMENT || grid.at(x + s.nx * 0.8, z + s.nz * 0.8) !== SURFACE_PAVEMENT) continue;
          cyl(metal, x, z, KERB, KERB + 0.72, 0.03, 0.03, 0x2a2b2d, 5, false);
          solids.push(x, z, 0.42);
          cyl(g, x, z, KERB + 0.72, KERB + 0.75, 0.34, 0.34, h < 0.3 ? 0x6b4a2e : 0xd9d6ce, 10);
          cyl(metal, x, z, KERB, KERB + 0.03, 0.2, 0.2, 0x2a2b2d, 8);
          for (const e of [-1, 1]) {
            const cx = x + tx * e * 0.6, cz = z + tz * e * 0.6;
            const yaw = Math.atan2(-tz, tx);
            g.box(cx, KERB + 0.45, cz, 0.4, 0.04, 0.4, yaw, h < 0.3 ? 0x8a6a45 : 0x3a3c40);
            g.box(cx + tx * e * 0.19, KERB + 0.68, cz + tz * e * 0.19, 0.04, 0.44, 0.4, yaw, h < 0.3 ? 0x8a6a45 : 0x3a3c40);
            for (const lx of [-0.17, 0.17]) for (const lz of [-0.17, 0.17]) {
              metal.box(cx + tx * lx - tz * lz, KERB + 0.22, cz + tz * lx + tx * lz, 0.03, 0.44, 0.03, yaw, 0x2a2b2d);
            }
          }
        }
      }
      if (h > 0.55 && h < 0.82) {
        // A-board
        const x = s.x + s.nx * (2.3 + h) + tx * (h - 0.7) * 6, z = s.z + s.nz * (2.3 + h) + tz * (h - 0.7) * 6;
        if (grid.at(x, z) !== SURFACE_PAVEMENT) continue;
        const yaw = Math.atan2(-tz, tx) + (h - 0.68) * 2.0;
        const c = Math.cos(yaw), sn = Math.sin(yaw);
        const col = [0x16171a, 0x7a1f2b, 0x1f3a2d, 0xe8e4d8, 0x14213d][Math.floor(h * 97) % 5];
        for (const e of [-1, 1]) {
          // two leaning panels
          const ox = -sn * 0.13 * e, oz = -c * 0.13 * e;
          const b0 = [x - c * 0.3 + ox * 1.9, KERB, z + sn * 0.3 + oz * 1.9], b1 = [x + c * 0.3 + ox * 1.9, KERB, z - sn * 0.3 + oz * 1.9];
          const t0 = [x - c * 0.3, KERB + 0.95, z + sn * 0.3], t1 = [x + c * 0.3, KERB + 0.95, z - sn * 0.3];
          if (e > 0) g.quad(b1, b0, t0, t1, col);
          else g.quad(b0, b1, t1, t0, col);
          const i0 = [x - c * 0.24 + ox * 1.55, KERB + 0.16, z + sn * 0.24 + oz * 1.55], i1 = [x + c * 0.24 + ox * 1.55, KERB + 0.16, z - sn * 0.24 + oz * 1.55];
          const j0 = [x - c * 0.24 + ox * 0.25, KERB + 0.84, z + sn * 0.24 + oz * 0.25], j1 = [x + c * 0.24 + ox * 0.25, KERB + 0.84, z - sn * 0.24 + oz * 0.25];
          const lift = (p: number[]) => [p[0] + ox * 0.08, p[1], p[2] + oz * 0.08];
          const paper = col === 0xe8e4d8 ? 0x23262b : 0xe9e6dc;
          if (e > 0) g.quad(lift(i1), lift(i0), lift(j0), lift(j1), paper);
          else g.quad(lift(i0), lift(i1), lift(j1), lift(j0), paper);
        }
      }
    }
    // furniture down the middle of the traffic-free street
    const zc = (data.zoneCentre ?? []).filter((p) => inPlay(p[0], p[1], 30));
    if (zc.length > 2) {
      const zp = new Path(zc);
      let n = 0;
      for (let s = 10; s < zp.length - 6; s += 13, n++) {
        const a = zp.at(s, tmp);
        const lat = ((n % 3) - 1) * 2.4;
        const x = a.x - a.tz * lat, z = a.z + a.tx * lat;
        if (!grid.inZone(x, z) || grid.at(x, z) !== SURFACE_ROAD) continue;
        const yaw = Math.atan2(-a.tz, a.tx);
        if (n % 2 === 0) {
          // tree in a big square planter with a timber seat round it
          g.box(x, 0.3, z, 2.0, 0.6, 2.0, yaw, 0x4b4e52);
          solids.push(x, z, 1.25);
          g.box(x, 0.63, z, 2.3, 0.07, 2.3, yaw, 0x7a5a3a);
          g.box(x, 0.68, z, 1.6, 0.06, 1.6, yaw, 0x2a241e);
          treeSpots.push({ x, y: 0.66, z, h: 5.2 + hash01(n * 3.1) * 1.2 });
        } else {
          // back-to-back benches
          solids.push(x + a.tx * 0.55, z + a.tz * 0.55, 0.6, x - a.tx * 0.55, z - a.tz * 0.55, 0.6);
          for (const e of [-1, 1]) {
            const bx = x - a.tz * 0.32 * e, bz = z + a.tx * 0.32 * e;
            g.box(bx, 0.45, bz, 2.0, 0.06, 0.5, yaw, 0x7a5a3a);
            g.box(bx, 0.22, bz, 1.8, 0.44, 0.4, yaw, 0x55585c);
          }
          g.box(x, 0.72, z, 2.0, 0.5, 0.08, yaw, 0x7a5a3a);
        }
      }
    }
  }

  // ---- pedestrian-zone gateways: planters across the carriageway + signs ----
  {
    const signPos: number[] = [], signUv: number[] = [], signIdx: number[] = [], signNor: number[] = [];
    let lastSign: [number, number] | null = null;
    for (const poly of data.zoneRoad ?? []) {
      for (const r of poly) {
        const cnt = r.length / 2;
        for (let i = 0; i < cnt; i++) {
          const j = (i + 1) % cnt;
          const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
          const L = Math.hypot(bx - ax, bz - az);
          if (L < 2.5) continue;
          const tx = (bx - ax) / L, tz = (bz - az) / L;
          // open boundary: carriageway continues on the far side of this edge
          let ox = -tz, oz = tx;
          const mx = (ax + bx) / 2, mz = (az + bz) / 2;
          const open = (sx: number, sz: number) => grid.at(mx + sx * 1.6, mz + sz * 1.6) === SURFACE_ROAD && !grid.inZone(mx + sx * 1.6, mz + sz * 1.6);
          if (!open(ox, oz)) {
            ox = -ox;
            oz = -oz;
            if (!open(ox, oz)) continue;
          }
          const yaw = Math.atan2(-tz, tx);
          const n = Math.max(1, Math.floor(L / 3.1));
          for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n;
            const x = ax + tx * L * t - ox * 0.9, z = az + tz * L * t - oz * 0.9;
            g.box(x, 0.36, z, 1.7, 0.72, 0.72, yaw, 0x55585c);
            solids.push(x + tx * 0.45, z + tz * 0.45, 0.5, x - tx * 0.45, z - tz * 0.45, 0.5);
            g.box(x, 0.74, z, 1.5, 0.05, 0.56, yaw, 0x2e2a25);
            for (const e of [-0.5, 0, 0.5]) {
              blob(leaves, x + tx * e, 1.02, z + tz * e, 0.36, 0.34, i * 7 + k * 3 + e, new THREE.Color(0x24451c), new THREE.Color(0x6f9a3c));
            }
          }
          // one sign per gateway
          if (!lastSign || Math.hypot(lastSign[0] - mx, lastSign[1] - mz) > 18) {
            lastSign = [mx, mz];
            const sx = ax - ox * 0.9, sz = az - oz * 0.9;
            cyl(metal, sx, sz, 0, 3.0, 0.045, 0.045, 0x8d9296, 6);
            const h = 0.55;
            const b = signPos.length / 3;
            signPos.push(sx - tx * h, 1.9, sz - tz * h, sx + tx * h, 1.9, sz + tz * h, sx + tx * h, 3.0, sz + tz * h, sx - tx * h, 3.0, sz - tz * h);
            for (let q = 0; q < 4; q++) signNor.push(ox, 0, oz);
            signUv.push(1, 0, 0, 0, 0, 1, 1, 1);
            signIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
          }
        }
      }
    }
    if (signPos.length) {
      const cv = document.createElement("canvas");
      cv.width = 256;
      cv.height = 256;
      const c = cv.getContext("2d")!;
      c.fillStyle = "#f6f6f2";
      c.fillRect(0, 0, 256, 256);
      c.strokeStyle = "#d1121c";
      c.lineWidth = 15;
      c.beginPath();
      c.arc(128, 82, 58, 0, Math.PI * 2);
      c.stroke();
      // bicycle glyph
      c.strokeStyle = "#111";
      c.lineWidth = 5;
      for (const x of [104, 152]) {
        c.beginPath();
        c.arc(x, 94, 15, 0, Math.PI * 2);
        c.stroke();
      }
      c.beginPath();
      c.moveTo(104, 94); c.lineTo(120, 68); c.lineTo(144, 68); c.lineTo(152, 94);
      c.moveTo(120, 68); c.lineTo(130, 94); c.lineTo(144, 68);
      c.moveTo(114, 62); c.lineTo(126, 62);
      c.stroke();
      c.fillStyle = "#111";
      c.textAlign = "center";
      c.font = `800 25px "Arial Narrow", Arial, sans-serif`;
      c.fillText("PEDESTRIAN ZONE", 128, 182);
      c.font = `700 19px "Arial Narrow", Arial, sans-serif`;
      c.fillText("No cycling · No vehicles", 128, 210);
      c.fillStyle = "#d1121c";
      c.font = `700 15px "Arial Narrow", Arial, sans-serif`;
      c.fillText("OXFORD STREET · SECURITY PATROLS", 128, 236);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(signPos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(signNor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(signUv, 2));
      geo.setIndex(signIdx);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.5 }));
      m.frustumCulled = false;
      group.add(m);
    }
  }

  const trunkMesh = new THREE.Mesh(trunks.build(), new THREE.MeshStandardMaterial({ map: tex.bark, color: 0x8f8777, roughness: 1 }));
  trunkMesh.castShadow = true;
  const leafMesh = new THREE.Mesh(leaves.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  leafMesh.castShadow = true;
  leafMesh.receiveShadow = true;
  group.add(trunkMesh, leafMesh);

  const painted = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  painted.castShadow = true;
  painted.receiveShadow = true;
  const metalMesh = new THREE.Mesh(metal.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.5 }));
  metalMesh.castShadow = true;
  group.add(painted, metalMesh);
  for (const m of [painted, metalMesh, trunkMesh, leafMesh]) m.frustumCulled = false;

  // ---- Lime service-zone boundary --------------------------------------
  {
    const cv = document.createElement("canvas");
    cv.width = 64;
    cv.height = 128;
    const c = cv.getContext("2d")!;
    const grad = c.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "rgba(120,255,60,0)");
    grad.addColorStop(0.7, "rgba(120,255,60,0.07)");
    grad.addColorStop(1, "rgba(160,255,80,0.3)");
    c.fillStyle = grad;
    c.fillRect(0, 0, 64, 128);
    c.strokeStyle = "rgba(200,255,120,0.22)";
    c.lineWidth = 5;
    for (let i = -2; i < 4; i++) {
      c.beginPath();
      c.moveTo(i * 32, 128);
      c.lineTo(i * 32 + 40, 88);
      c.stroke();
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    const [x0, z0, x1, z1] = data.play;
    const H = 3.2;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const wall = (ax: number, az: number, bx: number, bz: number) => {
      const b = pos.length / 3;
      const l = Math.hypot(bx - ax, bz - az) / 4;
      pos.push(ax, 0.02, az, bx, 0.02, bz, bx, H, bz, ax, H, az);
      uv.push(0, 0, l, 0, l, 1, 0, 1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    wall(x0, z0, x1, z0);
    wall(x1, z0, x1, z1);
    wall(x1, z1, x0, z1);
    wall(x0, z1, x0, z0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    m.renderOrder = 5;
    m.frustumCulled = false;
    group.add(m);
  }

  return { setSignal, treeSpots, solids };
}
