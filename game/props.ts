import * as THREE from "three";
import { GeoBuilder, type SurfaceGrid } from "./geo";
import { hash01, SURFACE_ROAD, type SceneData } from "./types";

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
  const GREY = 0x5d6266;
  for (const [x, z, ax, az] of data.lamps) {
    cyl(metal, x, z, KERB, KERB + 0.9, 0.13, 0.11, GREY, 6, false);
    cyl(metal, x, z, KERB + 0.9, 8.2, 0.085, 0.06, GREY, 6, false);
    const yaw = Math.atan2(-az, ax);
    metal.box(x + ax * 0.8, 8.15, z + az * 0.8, 1.7, 0.07, 0.07, yaw, GREY);
    metal.box(x + ax * 1.55, 8.08, z + az * 1.55, 0.75, 0.12, 0.3, yaw, 0x3c4043);
    g.box(x + ax * 1.55, 8.01, z + az * 1.55, 0.6, 0.03, 0.22, yaw, 0xf4f1e4);
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
    g.box(x, KERB + 2.46, z, 0.8, 0.12, 0.8, yaw, RED);
    g.box(x, KERB + 2.16, z, 0.93, 0.16, 0.93, yaw, 0xf0ead8);
    for (const [ox, oz, sx, sz] of [[0.451, 0, 0.012, 0.66], [-0.451, 0, 0.012, 0.66], [0, 0.451, 0.66, 0.012]] as const) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      g.box(x + ox * c + oz * s, KERB + 1.2, z - ox * s + oz * c, sx, 1.6, sz, yaw, 0x1c2428);
    }
  }
  for (const [x, z] of P.bin ?? []) {
    cyl(g, x, z, KERB, KERB + 0.95, 0.27, 0.29, 0x18191a, 8, false);
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
  const dk = new THREE.Color(0x2c4a1e), lt = new THREE.Color(0x7ea044);
  (P.tree ?? []).forEach(([x, z], i) => {
    const h = 5 + hash01(i * 3.7) * 3.5;
    const base = grid.at(x, z) === SURFACE_ROAD ? 0 : KERB;
    cyl(trunks, x, z, base, base + h, 0.24, 0.13, 0xffffff, 7, false);
    const n = 5 + Math.floor(hash01(i * 9.1) * 3);
    for (let k = 0; k < n; k++) {
      const a = hash01(i * 13 + k * 7.3) * Math.PI * 2;
      const r = k === 0 ? 0 : 1.2 + hash01(i * 5 + k * 3.1) * 1.4;
      const rad = 1.7 + hash01(i * 2 + k * 11.9) * 1.3;
      blob(leaves, x + Math.cos(a) * r, base + h + 0.6 + hash01(i + k * 1.7) * 2.2, z + Math.sin(a) * r, rad, rad * 0.8, i * 10 + k, dk, lt);
    }
    // tree pit
    g.box(x, base + 0.012, z, 1.3, 0.02, 1.3, 0, 0x4a4037);
  });
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
    grad.addColorStop(0.75, "rgba(120,255,60,0.22)");
    grad.addColorStop(1, "rgba(160,255,80,0.6)");
    c.fillStyle = grad;
    c.fillRect(0, 0, 64, 128);
    c.strokeStyle = "rgba(200,255,120,0.55)";
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
    const H = 7;
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

  return { setSignal };
}
