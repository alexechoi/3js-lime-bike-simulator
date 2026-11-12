import * as THREE from "three";
import { GeoBuilder } from "./geo";
import { strHash, type SceneData, type SignData } from "./types";

// Real shop names from OpenStreetMap painted onto fascia boards, plus the
// white-and-red City of Westminster street nameplates.

interface SignStyle {
  bg: string;
  fg: string;
  font: string;
  upper?: boolean;
  spacing?: number;
  weight?: string;
  italic?: boolean;
}

const SANS = `"Helvetica Neue", Helvetica, Arial, sans-serif`;
const SERIF = `Georgia, "Times New Roman", serif`;
const GROTESK = `"Arial Narrow", "Helvetica Neue", Arial, sans-serif`;

// Typography in the spirit of the high-street names, not their logos.
const BRANDS: Record<string, SignStyle> = {
  "nike": { bg: "#111111", fg: "#ffffff", font: SANS, upper: true, weight: "900", italic: true },
  "niketown": { bg: "#111111", fg: "#ffffff", font: SANS, upper: true, weight: "900", italic: true },
  "h&m": { bg: "#f4f2ee", fg: "#cc071e", font: SANS, weight: "700", italic: true },
  "zara": { bg: "#f2f0ea", fg: "#111111", font: SERIF, upper: true, spacing: 6 },
  "uniqlo": { bg: "#e60012", fg: "#ffffff", font: SANS, upper: true, weight: "800" },
  "primark": { bg: "#f2f2f2", fg: "#0099cc", font: SANS, upper: true, weight: "400", spacing: 4 },
  "boots": { bg: "#f4f4f4", fg: "#05054b", font: SERIF, italic: true, weight: "700" },
  "marks & spencer": { bg: "#101010", fg: "#c8e6c0", font: SANS, upper: true, spacing: 2 },
  "m&s": { bg: "#101010", fg: "#c8e6c0", font: SANS, upper: true },
  "pret a manger": { bg: "#7a1f2b", fg: "#ffffff", font: SERIF, upper: true, spacing: 2 },
  "starbucks": { bg: "#0b4a34", fg: "#ffffff", font: SANS, upper: true, spacing: 4 },
  "costa": { bg: "#6d1f37", fg: "#ffffff", font: SANS, upper: true, weight: "700" },
  "costa coffee": { bg: "#6d1f37", fg: "#ffffff", font: SANS, upper: true, weight: "700" },
  "caffè nero": { bg: "#111111", fg: "#6fb7e0", font: SERIF, upper: true, spacing: 3 },
  "mcdonald's": { bg: "#1f3d2b", fg: "#ffc72c", font: SANS, weight: "700" },
  "burger king": { bg: "#f5ebdc", fg: "#d62300", font: SANS, upper: true, weight: "900" },
  "kfc": { bg: "#a3080c", fg: "#ffffff", font: SANS, upper: true, weight: "900" },
  "greggs": { bg: "#00539f", fg: "#ffffff", font: SANS, upper: true, weight: "800" },
  "leon": { bg: "#f6efe0", fg: "#e2231a", font: SANS, upper: true, weight: "800" },
  "itsu": { bg: "#f7f7f7", fg: "#e6007e", font: SANS, weight: "700" },
  "wasabi": { bg: "#1a1a1a", fg: "#8cc63f", font: SANS, weight: "700" },
  "nando's": { bg: "#1a1a1a", fg: "#e4002b", font: SERIF, weight: "700" },
  "tesco express": { bg: "#f4f4f4", fg: "#00539f", font: SANS, upper: true, weight: "800" },
  "tesco": { bg: "#f4f4f4", fg: "#00539f", font: SANS, upper: true, weight: "800" },
  "sainsbury's local": { bg: "#f06c00", fg: "#ffffff", font: SANS, weight: "700" },
  "waitrose": { bg: "#5b8f22", fg: "#ffffff", font: SANS, upper: true, spacing: 3 },
  "superdrug": { bg: "#f4f4f4", fg: "#e6007e", font: SANS, weight: "800" },
  "jd sports": { bg: "#111111", fg: "#ffffff", font: SANS, upper: true, weight: "900" },
  "jd": { bg: "#111111", fg: "#ffffff", font: SANS, upper: true, weight: "900" },
  "foot locker": { bg: "#111111", fg: "#ffffff", font: SANS, weight: "800", italic: true },
  "adidas": { bg: "#111111", fg: "#ffffff", font: SANS, weight: "700" },
  "apple": { bg: "#d8d8d6", fg: "#333333", font: SANS, weight: "300" },
  "liberty": { bg: "#2a1a3a", fg: "#d9c27a", font: SERIF, upper: true, spacing: 8 },
  "hamleys": { bg: "#c8102e", fg: "#ffffff", font: SERIF, weight: "700" },
  "john lewis": { bg: "#f4f4f4", fg: "#111111", font: SANS, upper: true, spacing: 3 },
  "selfridges": { bg: "#f7d117", fg: "#111111", font: SANS, upper: true, spacing: 3 },
  "lush": { bg: "#111111", fg: "#ffffff", font: SANS, upper: true, weight: "900" },
  "the body shop": { bg: "#0b3d2e", fg: "#ffffff", font: SANS, upper: true, spacing: 3 },
  "ee": { bg: "#007b85", fg: "#ffee00", font: SANS, weight: "700" },
  "vodafone": { bg: "#f4f4f4", fg: "#e60000", font: SANS, weight: "700" },
  "o2": { bg: "#04124f", fg: "#ffffff", font: SANS, weight: "700" },
  "three": { bg: "#111111", fg: "#ffffff", font: SANS, weight: "800" },
  "barclays": { bg: "#00aeef", fg: "#ffffff", font: SERIF, upper: true, spacing: 2 },
  "hsbc": { bg: "#f4f4f4", fg: "#db0011", font: SANS, upper: true, weight: "800" },
  "natwest": { bg: "#42145f", fg: "#ffffff", font: SANS, weight: "700" },
  "lloyds bank": { bg: "#11b67a", fg: "#111111", font: SANS, upper: true, weight: "800" },
  "santander": { bg: "#ec0000", fg: "#ffffff", font: SANS, weight: "700" },
  "holland & barrett": { bg: "#00594c", fg: "#ffffff", font: SERIF, weight: "700" },
  "waterstones": { bg: "#111111", fg: "#ffffff", font: SERIF, weight: "400" },
  "levi's": { bg: "#c41230", fg: "#ffffff", font: SANS, upper: true, weight: "900" },
  "dr. martens": { bg: "#111111", fg: "#ffd200", font: SANS, weight: "800" },
  "dr martens": { bg: "#111111", fg: "#ffd200", font: SANS, weight: "800" },
  "vans": { bg: "#111111", fg: "#ffffff", font: SANS, upper: true, weight: "900" },
  "the north face": { bg: "#111111", fg: "#ffffff", font: SANS, upper: true, weight: "800" },
  "muji": { bg: "#7f0019", fg: "#ffffff", font: SANS, upper: true, weight: "700", spacing: 4 },
  "urban outfitters": { bg: "#1b1b1b", fg: "#ffffff", font: GROTESK, upper: true, spacing: 2 },
  "mango": { bg: "#f1efea", fg: "#111111", font: SANS, upper: true, spacing: 8, weight: "300" },
  "five guys": { bg: "#f4f4f4", fg: "#d21033", font: SANS, upper: true, weight: "900" },
  "honest burgers": { bg: "#111111", fg: "#ffffff", font: GROTESK, upper: true, spacing: 2 },
  "dishoom": { bg: "#f1e7d0", fg: "#1d4d3b", font: SERIF, upper: true, spacing: 4 },
  "franco manca": { bg: "#f6f0e2", fg: "#0c4b8e", font: SERIF, weight: "700" },
  "flat iron": { bg: "#1a1a1a", fg: "#e9dfc9", font: SERIF, upper: true, spacing: 5 },
  "ole & steen": { bg: "#f2ede4", fg: "#111111", font: SERIF, upper: true, spacing: 3 },
  "gail's": { bg: "#c8102e", fg: "#ffffff", font: SERIF, upper: true, spacing: 3 },
  "joe & the juice": { bg: "#f4b6c2", fg: "#111111", font: SANS, upper: true, weight: "800" },
  "the london palladium": { bg: "#1a1a1a", fg: "#e7c873", font: SERIF, upper: true, spacing: 3 },
};

const PALETTE: [string, string][] = [
  ["#111111", "#f2f2f2"],
  ["#17181a", "#ffffff"],
  ["#1c1c1e", "#e9e4d6"],
  ["#101012", "#f2f2f2"],
  ["#f3f1ec", "#151515"],
  ["#14213d", "#e8c77a"],
  ["#1f3a2d", "#efe6cf"],
  ["#5c1a22", "#f4ead8"],
  ["#ece3cf", "#3a2a1c"],
  ["#2b2b2e", "#f0c040"],
  ["#b3261e", "#ffffff"],
  ["#0e5a63", "#ffffff"],
  ["#e9e9e7", "#b3261e"],
  ["#3b2f4a", "#ffffff"],
  ["#23486b", "#ffffff"],
  ["#d9a441", "#1a1a1a"],
  ["#1b1b1b", "#ff5a5f"],
];

function styleFor(s: SignData): SignStyle {
  const key = (s.brand || s.n).toLowerCase();
  const b = BRANDS[key] ?? BRANDS[s.n.toLowerCase()];
  if (b) return b;
  const h = strHash(s.n);
  const h2 = strHash(s.n + "x");
  const [bg, fg] = PALETTE[Math.floor(h * PALETTE.length) % PALETTE.length];
  const pub = s.k === "pub" || s.k === "bar";
  const food = s.k === "restaurant" || s.k === "cafe";
  if (pub) return { bg: h2 < 0.5 ? "#16261c" : "#1a1a1a", fg: "#e2c26c", font: SERIF, upper: true, spacing: 3, weight: "700" };
  const font = food ? (h2 < 0.6 ? SERIF : SANS) : h2 < 0.3 ? SERIF : h2 < 0.55 ? GROTESK : SANS;
  return {
    bg,
    fg,
    font,
    upper: h2 > 0.35,
    spacing: h2 > 0.7 ? 5 : h2 > 0.5 ? 2 : 0,
    weight: h2 < 0.2 ? "300" : h2 < 0.6 ? "600" : "800",
    italic: food && h2 > 0.85,
  };
}

const CELL_W = 512, CELL_H = 64, COLS = 8, ROWS = 96;
const SIGN_H = 0.7;
const PX_PER_M = CELL_H / SIGN_H;

export function buildSigns(data: SceneData, group: THREE.Group, anisotropy: number) {
  // ---- fascia atlas --------------------------------------------------
  const cv = document.createElement("canvas");
  cv.width = CELL_W * COLS;
  cv.height = CELL_H * ROWS;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, cv.width, cv.height);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const awn = new GeoBuilder();
  const signs = data.signs.slice(0, COLS * ROWS);
  signs.forEach((s, i) => {
    const cx = (i % COLS) * CELL_W, cy = Math.floor(i / COLS) * CELL_H;
    const st = styleFor(s);
    const virtW = s.w * PX_PER_M; // sign width at the vertical pixel density
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, CELL_W, CELL_H);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.scale(CELL_W / virtW, 1);
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, virtW, CELL_H);
    // a little moulding so the board reads as a physical thing
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(0, 0, virtW, 3);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, CELL_H - 4, virtW, 4);
    const text = st.upper ? s.n.toUpperCase() : s.n;
    let size = 36;
    const setFont = () => {
      ctx.font = `${st.italic ? "italic " : ""}${st.weight ?? "600"} ${size}px ${st.font}`;
      (ctx as unknown as { letterSpacing: string }).letterSpacing = `${st.spacing ?? 0}px`;
    };
    setFont();
    const maxW = virtW - 26;
    let m = ctx.measureText(text).width;
    if (m > maxW) {
      size = Math.max(13, Math.floor((size * maxW) / m));
      setFont();
      m = ctx.measureText(text).width;
    }
    ctx.fillStyle = st.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, virtW / 2 + (st.spacing ?? 0) / 2, CELL_H / 2 + 2, maxW);
    ctx.restore();

    // quad on the wall
    const tx = -s.nz, tz = s.nx; // along the wall
    const hw = s.w / 2;
    const ox = s.x + s.nx * 0.24, oz = s.z + s.nz * 0.24;
    const y0 = 3.56, y1 = y0 + SIGN_H;
    const u0 = cx / cv.width, u1 = (cx + CELL_W) / cv.width;
    const v1 = 1 - cy / cv.height, v0 = 1 - (cy + CELL_H) / cv.height;
    const b = pos.length / 3;
    // seen from outside, the wall tangent (a -> b) runs right to left
    pos.push(ox + tx * hw, y0, oz + tz * hw, ox - tx * hw, y0, oz - tz * hw, ox - tx * hw, y1, oz - tz * hw, ox + tx * hw, y1, oz + tz * hw);
    for (let k = 0; k < 4; k++) nor.push(s.nx, 0, s.nz);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);

    // projecting blade sign
    const hb = strHash(s.n + "blade");
    if (hb < 0.34 && s.w > 2.2) {
      const bx = ox + tx * (hw - 0.2) * (hb < 0.17 ? 1 : -1), bz = oz + tz * (hw - 0.2) * (hb < 0.17 ? 1 : -1);
      const yb = 4.55 + hb, dep = 0.75, hh = 0.55;
      const c0 = new THREE.Color(st.bg), c1 = new THREE.Color(st.fg);
      const p0 = [bx + s.nx * 0.12, yb, bz + s.nz * 0.12], p1 = [bx + s.nx * (0.12 + dep), yb, bz + s.nz * (0.12 + dep)];
      awn.quad(p0, p1, [p1[0], yb + hh, p1[2]], [p0[0], yb + hh, p0[2]], c0);
      const q0 = [bx + s.nx * 0.24 + tx * 0.012, yb + 0.16, bz + s.nz * 0.24 + tz * 0.012], q1 = [bx + s.nx * (dep) + tx * 0.012, yb + 0.16, bz + s.nz * dep + tz * 0.012];
      awn.quad(q0, q1, [q1[0], yb + hh - 0.16, q1[2]], [q0[0], yb + hh - 0.16, q0[2]], c1);
      const r0 = [q0[0] - tx * 0.024, q0[1], q0[2] - tz * 0.024], r1 = [q1[0] - tx * 0.024, q1[1], q1[2] - tz * 0.024];
      awn.quad(r0, r1, [r1[0], yb + hh - 0.16, r1[2]], [r0[0], yb + hh - 0.16, r0[2]], c1);
      awn.quad([p0[0], yb + hh + 0.05, p0[2]], [p1[0], yb + hh + 0.05, p1[2]], [p1[0], yb + hh + 0.09, p1[2]], [p0[0], yb + hh + 0.09, p0[2]], 0x151515);
    }

    // awnings over cafes, restaurants and the odd shop
    const h = strHash(s.n + "awn");
    const wants = s.k === "cafe" || s.k === "restaurant" || s.k === "pub" ? h < 0.55 : h < 0.14;
    if (wants && s.w > 2.6) {
      const depth = 1.15, yA = 3.5, yB = 2.95;
      const a0 = [ox - tx * hw, yA, oz - tz * hw], a1 = [ox + tx * hw, yA, oz + tz * hw];
      const b0 = [a0[0] + s.nx * depth, yB, a0[2] + s.nz * depth], b1 = [a1[0] + s.nx * depth, yB, a1[2] + s.nz * depth];
      const c = new THREE.Color(st.bg);
      if (c.getHSL({ h: 0, s: 0, l: 0 }).l > 0.8) c.set(st.fg);
      awn.quad(a1, a0, b0, b1, c);
      awn.quad(b1, b0, [b0[0], yB - 0.22, b0[2]], [b1[0], yB - 0.22, b1[2]], c.clone().multiplyScalar(0.8));
    }
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.22 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  const awnMesh = new THREE.Mesh(awn.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
  awnMesh.castShadow = true;
  awnMesh.receiveShadow = true;
  awnMesh.frustumCulled = false;
  group.add(awnMesh);

  // ---- street nameplates --------------------------------------------
  const names = Array.from(new Set(data.plates.map((p) => p.n))).slice(0, 96);
  const PW = 512, PH = 128, PC = 4;
  const pc = document.createElement("canvas");
  pc.width = PW * PC;
  pc.height = PH * Math.ceil(names.length / PC);
  const p2 = pc.getContext("2d")!;
  names.forEach((n, i) => {
    const x = (i % PC) * PW, y = Math.floor(i / PC) * PH;
    p2.fillStyle = "#f5f4ef";
    p2.fillRect(x, y, PW, PH);
    p2.strokeStyle = "#1a1a1a";
    p2.lineWidth = 5;
    p2.strokeRect(x + 5, y + 5, PW - 10, PH - 10);
    const text = n.toUpperCase();
    let size = 54;
    p2.font = `700 ${size}px ${GROTESK}`;
    const mw = PW - 130;
    const m = p2.measureText(text).width;
    if (m > mw) size = Math.floor((size * mw) / m);
    p2.font = `700 ${size}px ${GROTESK}`;
    p2.fillStyle = "#151515";
    p2.textAlign = "left";
    p2.textBaseline = "middle";
    p2.fillText(text, x + 22, y + 52);
    p2.fillStyle = "#c8102e";
    p2.font = `700 44px ${GROTESK}`;
    p2.textAlign = "right";
    p2.fillText("W1", x + PW - 22, y + 52);
    p2.font = `700 19px ${GROTESK}`;
    p2.textAlign = "left";
    p2.fillText("CITY OF WESTMINSTER", x + 22, y + 102);
  });
  const ptex = new THREE.CanvasTexture(pc);
  ptex.colorSpace = THREE.SRGBColorSpace;
  ptex.anisotropy = anisotropy;
  const pp: number[] = [], pn: number[] = [], pu: number[] = [], pi: number[] = [];
  const rows = Math.ceil(names.length / PC);
  for (const pl of data.plates) {
    const i = names.indexOf(pl.n);
    if (i < 0) continue;
    const tx = -pl.nz, tz = pl.nx;
    const hw = 0.72, y0 = 4.75, y1 = y0 + 0.36;
    const ox = pl.x + pl.nx * 0.07, oz = pl.z + pl.nz * 0.07;
    const cx = i % PC, cy = Math.floor(i / PC);
    const u0 = cx / PC, u1 = (cx + 1) / PC, v1 = 1 - cy / rows, v0 = 1 - (cy + 1) / rows;
    const b = pp.length / 3;
    pp.push(ox + tx * hw, y0, oz + tz * hw, ox - tx * hw, y0, oz - tz * hw, ox - tx * hw, y1, oz - tz * hw, ox + tx * hw, y1, oz + tz * hw);
    for (let k = 0; k < 4; k++) pn.push(pl.nx, 0, pl.nz);
    pu.push(u0, v0, u1, v0, u1, v1, u0, v1);
    pi.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.Float32BufferAttribute(pp, 3));
  pg.setAttribute("normal", new THREE.Float32BufferAttribute(pn, 3));
  pg.setAttribute("uv", new THREE.Float32BufferAttribute(pu, 2));
  pg.setIndex(pi);
  const pm = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.5 }));
  pm.frustumCulled = false;
  group.add(pm);
}
