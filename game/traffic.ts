import * as THREE from "three";
import { Path, type SurfaceGrid } from "./geo";
import { hash01, SURFACE_ROAD, type SceneData } from "./types";
import type { VehicleFactory } from "./vehicles";

// Black cabs, vans and cars working their way round the open streets.
// They keep left, queue at red lights and brake for whatever is in front,
// but they will not swerve for a courier who rides into their side.

export interface Car {
  group: THREE.Group;
  kind: "taxi" | "van" | "car";
  length: number;
  width: number;
  edge: number;
  s: number;
  dir: 1 | -1;
  v: number;
  x: number;
  z: number;
  fx: number;
  fz: number;
  h: number;
  cruise: number;
  halt: boolean;
  stuck: number;
}

export interface Blocker {
  x: number;
  z: number;
  r: number;
}

const COLOURS = [0xb9bcc0, 0x2c3037, 0xe6e6e2, 0x1f3f73, 0x7a1418, 0x5d6166, 0x10100f, 0x3d5a4a];

export class Traffic {
  cars: Car[] = [];
  private paths: Path[];
  private ok: boolean[];
  private lane: number[];
  private adj: { e: number; to: number }[][];
  private sigs: { s: number; i: number }[][];
  private tmp = { x: 0, z: 0, tx: 0, tz: 0 };

  constructor(
    private data: SceneData,
    private grid: SurfaceGrid,
    factory: VehicleFactory,
    scene: THREE.Scene,
    count: number,
  ) {
    const g = data.graph;
    this.paths = g.edges.map((e) => new Path(e.p));
    this.adj = g.nodes.map(() => []);
    g.edges.forEach((e, i) => {
      this.adj[e.a].push({ e: i, to: e.b });
      this.adj[e.b].push({ e: i, to: e.a });
    });
    // an edge is drivable when all of it is open carriageway outside the traffic-free zone
    this.ok = this.paths.map((p) => {
      if (p.length < 6) return false;
      for (let s = 0; s <= p.length; s += 3) {
        const a = p.at(s, this.tmp);
        if (grid.at(a.x, a.z) !== SURFACE_ROAD || grid.inZone(a.x, a.z)) return false;
      }
      return true;
    });
    // how far left of the centre line there is room to drive
    this.lane = this.paths.map((p, i) => {
      if (!this.ok[i]) return 0;
      let best = 1.5;
      for (let s = 2; s < p.length - 2; s += 4) {
        const a = p.at(s, this.tmp);
        for (const side of [1, -1]) {
          let d = 0;
          while (d < 5 && grid.at(a.x + a.tz * side * (d + 0.3), a.z - a.tx * side * (d + 0.3)) === SURFACE_ROAD) d += 0.3;
          best = Math.min(best, Math.max(0, d - 1.15));
        }
      }
      return best;
    });
    this.sigs = this.paths.map(() => []);
    data.signals.forEach((sg, i) => {
      this.paths.forEach((p, e) => {
        if (!this.ok[e]) return;
        const pr = p.project(sg.x, sg.z);
        if (pr.d > 3.5) return;
        const a = p.at(pr.s, this.tmp);
        if (Math.abs(a.tx * sg.tx + a.tz * sg.tz) < 0.7) return;
        this.sigs[e].push({ s: pr.s, i });
      });
    });
    const kinds: Car["kind"][] = ["taxi", "car", "van", "taxi", "car", "taxi", "van", "car"];
    for (let i = 0; i < count; i++) {
      const kind = kinds[i % kinds.length];
      const colour = kind === "taxi" ? 0x0c0c0d : kind === "van" ? [0xe9e9e4, 0xdfe1e3, 0x2d3540][i % 3] : COLOURS[(i * 5) % COLOURS.length];
      const m = factory.makeCar(kind, colour);
      scene.add(m.group);
      this.cars.push({
        group: m.group, kind, length: m.length, width: m.width, edge: 0, s: 0, dir: 1, v: 0, x: 0, z: 0, fx: 0, fz: 1, h: 0,
        cruise: kind === "taxi" ? 7.4 : kind === "van" ? 6.2 : 6.8, halt: false, stuck: 0,
      });
    }
  }

  reset(px: number, pz: number) {
    const drivable = this.ok.map((o, i) => (o && this.paths[i].length > 18 ? i : -1)).filter((i) => i >= 0);
    if (!drivable.length) {
      for (const c of this.cars) c.group.visible = false;
      return;
    }
    const used: number[] = [];
    this.cars.forEach((c, i) => {
      let pick = drivable[0];
      for (let t = 0; t < 40; t++) {
        const e = drivable[Math.floor(hash01(i * 17.3 + t * 5.1 + px * 0.01) * drivable.length)];
        const m = this.paths[e].at(this.paths[e].length / 2, this.tmp);
        if (Math.hypot(m.x - px, m.z - pz) < 55 || used.includes(e)) continue;
        pick = e;
        break;
      }
      used.push(pick);
      c.edge = pick;
      c.dir = i % 2 ? 1 : -1;
      c.s = this.paths[pick].length * (0.3 + 0.4 * hash01(i * 3.3));
      c.v = 4;
      c.halt = false;
      c.stuck = 0;
      const a = this.paths[pick].at(c.s, this.tmp);
      c.fx = a.tx * c.dir;
      c.fz = a.tz * c.dir;
      c.x = a.x + c.fz * this.lane[pick];
      c.z = a.z - c.fx * this.lane[pick];
      c.h = Math.atan2(c.fx, c.fz);
    });
  }

  private relocate(c: Car, px: number, pz: number, time: number) {
    for (let t = 0; t < 30; t++) {
      const e = Math.floor(hash01(time * 1.7 + t * 9.1 + c.x) * this.paths.length);
      if (!this.ok[e] || this.paths[e].length < 18) continue;
      const m = this.paths[e].at(this.paths[e].length / 2, this.tmp);
      if (Math.hypot(m.x - px, m.z - pz) < 90) continue;
      if (this.cars.some((o) => o !== c && o.edge === e)) continue;
      c.edge = e;
      c.dir = 1;
      c.s = this.paths[e].length / 2;
      c.v = 3;
      c.stuck = 0;
      c.x = m.x + m.tz * this.lane[e];
      c.z = m.z - m.tx * this.lane[e];
      c.h = Math.atan2(m.tx, m.tz);
      return;
    }
    c.stuck = 0;
  }

  update(dt: number, time: number, sigState: Uint8Array, blockers: Blocker[], px: number, pz: number) {
    const g = this.data.graph;
    for (const c of this.cars) {
      let atLight = false;
      const path = this.paths[c.edge];
      const half = c.length / 2;
      let target = c.halt ? 0 : c.cruise;
      const toEnd = c.dir > 0 ? path.length - c.s : c.s;
      target = Math.min(target, 2.6 + toEnd * 0.55);
      for (const sg of this.sigs[c.edge]) {
        if (sigState[sg.i] === 0) continue;
        const dist = (sg.s - c.s) * c.dir - half - 3.8;
        if (dist < -1 || dist > 24) continue;
        if (sigState[sg.i] === 1 && dist < 5) continue;
        atLight = true;
        target = Math.min(target, Math.sqrt(2 * 3 * Math.max(0, dist - 0.3)));
      }
      // brake for anything in the lane ahead
      const look = half + 4 + c.v * 1.3;
      const brakeFor = (ox: number, oz: number, r: number) => {
        const rx = ox - c.x, rz = oz - c.z;
        const ahead = rx * c.fx + rz * c.fz;
        if (ahead < 0.2 || ahead > look + r) return;
        const lat = Math.abs(rx * c.fz - rz * c.fx);
        if (lat > c.width / 2 + r + 0.35) return;
        target = Math.min(target, Math.sqrt(2 * 4 * Math.max(0, ahead - half - r - 1.6)));
      };
      for (const o of this.cars) {
        if (o === c) continue;
        // oncoming traffic in its own lane is not an obstacle
        if (o.fx * c.fx + o.fz * c.fz < -0.6 && this.lane[c.edge] > 0.9) continue;
        brakeFor(o.x - o.fx * 1.2, o.z - o.fz * 1.2, 1.5);
      }
      for (const b of blockers) brakeFor(b.x, b.z, b.r);
      c.v += Math.max(-9 * dt, Math.min(2.2 * dt, target - c.v));
      if (c.v < 0.03) c.v = 0;
      // gridlock (two cars nose to nose in a lane): the one out of sight slips away to another street
      c.stuck = c.v < 0.2 && !atLight && !c.halt ? c.stuck + dt : 0;
      if (c.stuck > 7 && Math.hypot(c.x - px, c.z - pz) > 70) {
        this.relocate(c, px, pz, time);
        continue;
      }
      c.s += c.dir * c.v * dt;
      if (c.s >= path.length || c.s <= 0) {
        const e = g.edges[c.edge];
        const node = c.dir > 0 ? e.b : e.a;
        // narrow streets are treated as one-way (a to b) so cars do not meet head-on in them
        const opts = this.adj[node].filter((o) => o.e !== c.edge && this.ok[o.e] && (this.lane[o.e] > 0.9 || g.edges[o.e].a === node));
        if (opts.length) {
          const next = opts[Math.floor(hash01(time * 2.7 + node + c.x) * opts.length)].e;
          c.edge = next;
          c.dir = g.edges[next].a === node ? 1 : -1;
          c.s = c.dir > 0 ? 0.01 : this.paths[next].length - 0.01;
        } else {
          // dead end: three-point turn, in spirit
          c.dir = (c.dir * -1) as 1 | -1;
          c.s = Math.max(0.01, Math.min(path.length - 0.01, c.s));
        }
      }
      const a = this.paths[c.edge].at(c.s, this.tmp);
      const fx = a.tx * c.dir, fz = a.tz * c.dir;
      const tx = a.x + fz * this.lane[c.edge], tz = a.z - fx * this.lane[c.edge];
      const k = Math.min(1, dt * 4);
      c.x += (tx - c.x) * k;
      c.z += (tz - c.z) * k;
      const want = Math.atan2(fx, fz);
      c.h += Math.atan2(Math.sin(want - c.h), Math.cos(want - c.h)) * Math.min(1, dt * 4.5);
      c.fx = Math.sin(c.h);
      c.fz = Math.cos(c.h);
      c.group.position.set(c.x, 0, c.z);
      c.group.rotation.y = c.h;
    }
  }
}
