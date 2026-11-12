import * as THREE from "three";
import { SURFACE_BUILDING, SURFACE_PAVEMENT, SURFACE_ROAD, type Poly, type SceneData } from "./types";

/** Accumulates coloured triangles into one BufferGeometry. */
export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  private c = new THREE.Color();

  get count() {
    return this.pos.length / 3;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, color: THREE.ColorRepresentation) {
    this.c.set(color);
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(this.c.r, this.c.g, this.c.b);
    return this.count - 1;
  }

  /** Quad a-b-c-d (counter-clockwise seen from the normal side). */
  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.ColorRepresentation, uvs?: number[][]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const t = uvs ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    const i = this.vert(a[0], a[1], a[2], nx, ny, nz, t[0][0], t[0][1], color);
    this.vert(b[0], b[1], b[2], nx, ny, nz, t[1][0], t[1][1], color);
    this.vert(c[0], c[1], c[2], nx, ny, nz, t[2][0], t[2][1], color);
    this.vert(d[0], d[1], d[2], nx, ny, nz, t[3][0], t[3][1], color);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** Flat strip on the ground between two points, `w` wide. */
  strip(x0: number, z0: number, x1: number, z1: number, w: number, y: number, color: THREE.ColorRepresentation) {
    const dx = x1 - x0, dz = z1 - z0;
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return;
    const px = (-dz / l) * w * 0.5, pz = (dx / l) * w * 0.5;
    this.quad([x0 + px, y, z0 + pz], [x1 + px, y, z1 + pz], [x1 - px, y, z1 - pz], [x0 - px, y, z0 - pz], color);
  }

  /** Axis-aligned box in a local frame: centre (cx,cy,cz), yaw about y. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw: number, color: THREE.ColorRepresentation) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x: number, y: number, z: number) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const v = [
      P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz),
      P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz),
    ];
    this.quad(v[1], v[0], v[3], v[2], color);
    this.quad(v[4], v[5], v[6], v[7], color);
    this.quad(v[0], v[4], v[7], v[3], color);
    this.quad(v[5], v[1], v[2], v[6], color);
    this.quad(v[3], v[7], v[6], v[2], color);
    this.quad(v[0], v[1], v[5], v[4], color);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/** Triangulate polygons-with-holes into a flat, upward-facing mesh at height y. */
export function polysToGeometry(polys: Poly[], y: number, uvScale: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const poly of polys) {
    const rings = poly.map((r) => {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < r.length; i += 2) pts.push(new THREE.Vector2(r[i], r[i + 1]));
      return pts;
    });
    const outer = rings[0];
    const holes = rings.slice(1);
    const tris = THREE.ShapeUtils.triangulateShape(outer, holes);
    const all = outer.concat(...holes);
    const base = pos.length / 3;
    for (const p of all) {
      pos.push(p.x, y, p.y);
      uv.push(p.x / uvScale, p.y / uvScale);
    }
    for (const t of tris) {
      const a = all[t[0]], b = all[t[1]], c = all[t[2]];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      // (x, z) -> y-up: a triangle that is CCW in x/z faces down, so flip it
      if (cross > 0) idx.push(base + t[0], base + t[2], base + t[1]);
      else idx.push(base + t[0], base + t[1], base + t[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 0.5 m raster of the scene: road / pavement / building. */
export class SurfaceGrid {
  readonly res = 0.5;
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly h: number;
  readonly cells: Uint8Array;
  /** 1 inside the traffic-free stretch of Oxford Street */
  readonly zoneCells: Uint8Array;

  constructor(data: SceneData) {
    const [sx0, sz0, sx1, sz1] = data.scene;
    this.x0 = sx0;
    this.z0 = sz0;
    this.w = Math.ceil((sx1 - sx0) / this.res);
    this.h = Math.ceil((sz1 - sz0) / this.res);
    const cv = document.createElement("canvas");
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.w, this.h);
    const s = 1 / this.res;
    const trace = (r: number[]) => {
      ctx.moveTo((r[0] - sx0) * s, (r[1] - sz0) * s);
      for (let i = 2; i < r.length; i += 2) ctx.lineTo((r[i] - sx0) * s, (r[i + 1] - sz0) * s);
      ctx.closePath();
    };
    ctx.fillStyle = "#f00";
    for (const poly of data.pavement) {
      ctx.beginPath();
      for (const r of poly) trace(r);
      ctx.fill("evenodd");
    }
    ctx.fillStyle = "#0f0";
    ctx.globalCompositeOperation = "lighter";
    for (const poly of data.zone ?? []) {
      ctx.beginPath();
      for (const r of poly) trace(r);
      ctx.fill("evenodd");
    }
    ctx.fillStyle = "#00f";
    for (const b of data.buildings) {
      if (b.mh > 2.6) continue; // oversails the street: ride underneath
      ctx.beginPath();
      trace(b.p);
      ctx.fill();
    }
    const img = ctx.getImageData(0, 0, this.w, this.h).data;
    this.cells = new Uint8Array(this.w * this.h);
    this.zoneCells = new Uint8Array(this.w * this.h);
    for (let i = 0; i < this.cells.length; i++) {
      const r = img[i * 4], b = img[i * 4 + 2];
      this.zoneCells[i] = img[i * 4 + 1] > 127 ? 1 : 0;
      this.cells[i] = b > 110 ? SURFACE_BUILDING : r > 127 ? SURFACE_PAVEMENT : SURFACE_ROAD;
    }
  }

  at(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.res);
    const j = Math.floor((z - this.z0) / this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return SURFACE_BUILDING;
    return this.cells[j * this.w + i];
  }

  inZone(x: number, z: number): boolean {
    const i = Math.floor((x - this.x0) / this.res);
    const j = Math.floor((z - this.z0) / this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return false;
    return this.zoneCells[j * this.w + i] === 1;
  }

  blocked(x: number, z: number): boolean {
    return this.at(x, z) === SURFACE_BUILDING;
  }

  /** True when no building lies on the straight line between the two points. */
  clear(x0: number, z0: number, x1: number, z1: number): boolean {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(d / 0.9));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.blocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }
}

/** Polyline with arc-length lookup. */
export class Path {
  pts: [number, number][];
  cum: number[] = [0];
  length: number;

  constructor(pts: [number, number][]) {
    this.pts = pts;
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  /** Position and unit tangent at distance s. */
  at(s: number, out: { x: number; z: number; tx: number; tz: number }) {
    const c = this.cum;
    s = Math.max(0, Math.min(this.length, s));
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (c[m] <= s) lo = m;
      else hi = m;
    }
    const a = this.pts[lo], b = this.pts[lo + 1] ?? a;
    const l = c[lo + 1] - c[lo] || 1;
    const t = (s - c[lo]) / l;
    out.x = a[0] + (b[0] - a[0]) * t;
    out.z = a[1] + (b[1] - a[1]) * t;
    out.tx = (b[0] - a[0]) / l;
    out.tz = (b[1] - a[1]) / l;
    return out;
  }

  /** Closest point: returns distance along the path and the offset from it. */
  project(x: number, z: number): { s: number; d: number } {
    let best = Infinity, bs = 0;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
      if (d < best) {
        best = d;
        bs = this.cum[i] + Math.sqrt(l2) * t;
      }
    }
    return { s: bs, d: best };
  }
}

export function ringToPairs(r: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < r.length; i += 2) out.push([r[i], r[i + 1]]);
  return out;
}
