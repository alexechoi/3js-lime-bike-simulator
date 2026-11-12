import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { makeBike, type BikeModel } from "./bike";
import { Path, ringToPairs, type SurfaceGrid } from "./geo";
import { Crowd } from "./peds";
import { hash01, SURFACE_PAVEMENT, SURFACE_ROAD, type SceneData, type SignData } from "./types";
import { BUS, VehicleFactory } from "./vehicles";
import { buildWorld, KERB, type World } from "./world";

export type Phase = "loading" | "menu" | "playing" | "over" | "error";

export interface HudState {
  phase: Phase;
  time: number;
  battery: number;
  deliveries: number;
  speed: number; // km/h
  destName: string;
  destStreet: string;
  destDist: number;
  arrow: number; // degrees clockwise from straight ahead
  chase: number; // seconds left, 0 when not chased
  street: string;
  outOfZone: boolean;
  inZone: boolean;
  guards: number; // security guards giving chase
  toast: { id: number; text: string; tone: "good" | "bad" | "info" } | null;
  cause: string;
  causeDetail: string;
  /** false while the crash is still playing out */
  overReady: boolean;
  loading: string;
}

interface Bus {
  group: THREE.Group;
  setRoute: (r: string) => void;
  route: string;
  r: number; // route index
  dir: 1 | -1;
  s: number;
  v: number;
  x: number;
  z: number;
  fx: number;
  fz: number;
  halt: boolean;
}

interface BusRoute {
  path: Path;
  routes: string[];
  street: string;
  lane: number;
  sigs: { s: number; i: number }[];
}

const START_TIME = 90;
const MAX_SPEED = 9.6;
const TWO_PI = Math.PI * 2;

function angDiff(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

class Sfx {
  private ctx: AudioContext | null = null;
  private siren: { osc: OscillatorNode; gain: GainNode } | null = null;

  private ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  unlock() {
    this.ensure();
  }

  tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.12, delay = 0, slide = 0) {
    const c = this.ensure();
    if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    const t = c.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  bell() {
    this.tone(1320, 0.7, "sine", 0.14);
    this.tone(1980, 0.5, "sine", 0.06);
    this.tone(1760, 0.8, "sine", 0.1, 0.16);
  }

  pickup() {
    this.tone(660, 0.12, "triangle", 0.12);
    this.tone(990, 0.2, "triangle", 0.12, 0.09);
  }

  whistle() {
    this.tone(2300, 0.16, "square", 0.05);
    this.tone(2500, 0.3, "square", 0.05, 0.18);
  }

  crash() {
    this.tone(140, 0.5, "sawtooth", 0.2, 0, -100);
    this.tone(70, 0.6, "square", 0.14, 0.03, -30);
  }

  setSiren(on: boolean) {
    const c = this.ctx;
    if (on && !this.siren) {
      const cc = this.ensure();
      if (!cc) return;
      const osc = cc.createOscillator(), gain = cc.createGain();
      osc.type = "square";
      gain.gain.value = 0.035;
      const lfo = cc.createOscillator(), lg = cc.createGain();
      lfo.type = "square";
      lfo.frequency.value = 1.6;
      lg.gain.value = 120;
      osc.frequency.value = 760;
      lfo.connect(lg).connect(osc.frequency);
      osc.connect(gain).connect(cc.destination);
      osc.start();
      lfo.start();
      this.siren = { osc, gain };
    } else if (!on && this.siren && c) {
      this.siren.gain.gain.setTargetAtTime(0, c.currentTime, 0.1);
      this.siren.osc.stop(c.currentTime + 0.4);
      this.siren = null;
    }
  }

  dispose() {
    this.setSiren(false);
    void this.ctx?.close();
    this.ctx = null;
  }
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.3, 7000);
  private clock = new THREE.Timer();
  private raf = 0;
  private disposed = false;
  private ro: ResizeObserver;
  private keys = new Set<string>();
  private sfx = new Sfx();
  private quality = 2;
  private perfT = 0;
  private perfN = 0;

  private data!: SceneData;
  private world!: World;
  private grid!: SurfaceGrid;
  private crowd: Crowd | null = null;
  private vehicles = new VehicleFactory();
  private bike!: BikeModel;
  private ready = false;

  // simulation state
  private phase: Phase = "loading";
  private time = 0; // sim clock
  private px = 0;
  private pz = 0;
  private py = 0;
  private heading = 0;
  private speed = 0;
  private steer = 0;
  private lean = 0;
  private spin = 0;
  private pedal = 0;
  private bump = 0;
  private fall = 0;
  private battery = 100;
  private timeLeft = START_TIME;
  private deliveries = 0;
  private spawn = { x: 0, z: 0, h: 0 };
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camYaw = 0;
  private overT = 0;
  private overReal = 0;
  private crashKind: "bus" | "ped" | "police" | "guard" | "time" = "time";
  private riderPivot = new THREE.Group();
  private riderOff = false;
  private riderV = new THREE.Vector3();
  private riderW = new THREE.Vector3();
  private bikeV = new THREE.Vector3();
  private bikeSpin = 0;
  private bikeHop = 0;
  private bikeHopV = 0;
  private debris: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3; live: boolean }[] = [];
  private shake = 0;
  private crashAngle = 0;

  private routes: BusRoute[] = [];
  private buses: Bus[] = [];
  private sigState!: Uint8Array;
  private sigRedLeft!: Float32Array;
  private sigPrev!: Float32Array;
  private junctions: { off: number; solo: boolean }[] = [];

  private police!: { group: THREE.Group; setLights: (on: boolean, t: number) => void };
  private cop = { x: 0, z: 0, h: 0, v: 0, edge: 0, s: 0, dir: 1 as 1 | -1, mode: "patrol" as "patrol" | "direct" | "rejoin", chase: 0, plan: [] as number[], replan: 0, tx: 0, tz: 0, te: 0, ts: 0 };
  private edgePaths: Path[] = [];
  private adj: { e: number; to: number }[][] = [];

  private dest: SignData | null = null;
  private destFrom = 0;
  private marker = new THREE.Group();
  private pickups: { g: THREE.Group; x: number; z: number; ph: number }[] = [];
  private roadSegs: { x0: number; z0: number; x1: number; z1: number; n: string }[] = [];
  private street = "";
  private streetT = 0;
  private inZone = false;
  private guardsChasing = 0;
  private guardNear = 999;

  private hudT = 0;
  private toast: HudState["toast"] = null;
  private toastId = 0;
  private toastT = 0;
  private cause = "";
  private causeDetail = "";
  private loadingMsg = "Fetching the map of Soho…";
  private mapStatic: HTMLCanvasElement | null = null;
  private mapScale = 1.5;
  private mapFrame = 0;
  private tmpA = { x: 0, z: 0, tx: 0, tz: 0 };

  constructor(
    private container: HTMLElement,
    private minimap: HTMLCanvasElement,
    private onHud: (s: HudState) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = "block";
    container.appendChild(this.renderer.domElement);
    // HDR pipeline: multisampled float target -> bloom -> ACES + sRGB
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.09, 0.4, 2.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.emit(true);
    void this.init();
  }

  // ------------------------------------------------------------------ setup
  private async init() {
    try {
      const res = await fetch("/data/soho.json");
      if (!res.ok) throw new Error("map " + res.status);
      const data = (await res.json()) as SceneData;
      if (this.disposed) return;
      this.data = data;
      this.loadingMsg = "Laying kerbs, hanging shop signs…";
      this.emit(true);
      this.world = await buildWorld(data, this.renderer, this.scene);
      if (this.disposed) {
        this.world.dispose();
        return;
      }
      this.grid = this.world.grid;
      this.setupSignals();
      this.setupRoads();
      this.setupBuses();
      this.setupPolice();
      this.setupPlayer();
      this.setupPickups();
      this.setupMarker();
      this.buildMinimap();
      this.loadingMsg = "Waking the pedestrians…";
      this.emit(true);
      try {
        const crowd = await Crowd.load(data, this.grid, 120, 32);
        if (this.disposed) {
          crowd.dispose();
          return;
        }
        this.crowd = crowd;
        this.scene.add(crowd.group);
        crowd.reset(this.px, this.pz);
      } catch (e) {
        console.warn("pedestrians unavailable", e);
      }
      this.ready = true;
      this.phase = "menu";
      this.resetRun();
      this.renderer.compile(this.scene, this.camera);
      this.loop();
    } catch (e) {
      console.error(e);
      this.phase = "error";
      this.loadingMsg = "Could not load the map. " + String(e);
      this.emit(true);
    }
  }

  private setupSignals() {
    const { signals } = this.data;
    this.sigState = new Uint8Array(signals.length);
    this.sigRedLeft = new Float32Array(signals.length);
    this.sigPrev = new Float32Array(signals.length).fill(NaN);
    const nj = signals.reduce((m, s) => Math.max(m, s.j), -1) + 1;
    for (let j = 0; j < nj; j++) {
      const solo = signals.some((s) => s.j === j && s.solo);
      this.junctions.push({ off: hash01(j * 7.13 + 1) * 31, solo });
    }
    this.sigState.fill(255);
  }

  private updateSignals() {
    const { signals } = this.data;
    for (let i = 0; i < signals.length; i++) {
      const s = signals[i];
      const j = this.junctions[s.j];
      let st: number, left = 0;
      if (j.solo) {
        // pelican crossing: long green, short red for people on foot
        const t = (this.time + j.off) % 27;
        if (t < 15) st = 0;
        else if (t < 17.5) st = 1;
        else { st = 2; left = 27 - t; }
      } else {
        const t = (this.time + j.off) % 31;
        if (s.ph === 0) {
          if (t < 13) st = 0;
          else if (t < 15.5) st = 1;
          else { st = 2; left = 31 - t; }
        } else if (t < 17) { st = 2; left = 17 - t; }
        else if (t < 27) st = 0;
        else if (t < 29.5) st = 1;
        else { st = 2; left = 31 - t + 17; }
      }
      this.sigRedLeft[i] = left;
      if (this.sigState[i] !== st) {
        this.sigState[i] = st;
        this.world.setSignal(i, st);
      }
    }
  }

  private setupRoads() {
    const [x0, z0, x1, z1] = this.data.play;
    for (const r of this.data.roads) {
      if (!r.n || r.k === "footway") continue;
      for (let i = 0; i < r.p.length - 2; i += 2) {
        const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3];
        if (Math.max(ax, bx) < x0 - 40 || Math.min(ax, bx) > x1 + 40 || Math.max(az, bz) < z0 - 40 || Math.min(az, bz) > z1 + 40) continue;
        this.roadSegs.push({ x0: ax, z0: az, x1: bx, z1: bz, n: r.n });
      }
    }
    const g = this.data.graph;
    this.adj = g.nodes.map(() => []);
    g.edges.forEach((e, i) => {
      this.edgePaths.push(new Path(e.p));
      this.adj[e.a].push({ e: i, to: e.b });
      this.adj[e.b].push({ e: i, to: e.a });
    });
  }

  private streetAt(x: number, z: number): string {
    let best = 40, name = "";
    for (const s of this.roadSegs) {
      const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / l2));
      const d = Math.hypot(x - (s.x0 + dx * t), z - (s.z0 + dz * t));
      if (d < best) {
        best = d;
        name = s.n;
      }
    }
    return name;
  }

  private setupBuses() {
    const { busRoutes, signals } = this.data;
    busRoutes.forEach((br, ri) => {
      const path = new Path(br.pts);
      const sigs: { s: number; i: number }[] = [];
      signals.forEach((sg, i) => {
        const pr = path.project(sg.x, sg.z);
        if (pr.d > 8) return;
        const a = path.at(pr.s, this.tmpA);
        if (Math.abs(a.tx * sg.tx + a.tz * sg.tz) < 0.7) return;
        sigs.push({ s: pr.s, i });
      });
      this.routes.push({ path, routes: br.routes, street: br.street, lane: ri === 0 ? 2.05 : 2.5, sigs });
      const perDir = 3;
      for (const dir of [1, -1] as const) {
        for (let k = 0; k < perDir; k++) {
          const route = br.routes[(k * 2 + (dir > 0 ? 0 : 1)) % br.routes.length];
          const b = this.vehicles.makeBus(route, k + ri);
          this.scene.add(b.group);
          this.buses.push({
            group: b.group, setRoute: b.setRoute, route, r: ri, dir,
            s: ((k + (dir > 0 ? 0.15 : 0.55)) / perDir) * path.length, v: 6, x: 0, z: 0, fx: 0, fz: 1, halt: false,
          });
        }
      }
    });
  }

  private updateBuses(dt: number) {
    const a = this.tmpA;
    for (const b of this.buses) {
      const R = this.routes[b.r];
      let target = b.halt ? 0 : 7.6;
      const half = BUS.length / 2;
      for (const sg of R.sigs) {
        const st = this.sigState[sg.i];
        if (st === 0) continue;
        const dist = b.dir > 0 ? sg.s - 4.6 - (b.s + half) : b.s - half - (sg.s + 4.6);
        if (dist < -1.2 || dist > 34) continue;
        if (st === 1 && dist < 7) continue; // too late to stop on amber
        target = Math.min(target, Math.sqrt(2 * 2.4 * Math.max(0, dist - 0.4)));
      }
      for (const o of this.buses) {
        if (o === b || o.r !== b.r || o.dir !== b.dir) continue;
        const gap = (o.s - b.s) * b.dir - BUS.length;
        if (gap > -2 && gap < 30) target = Math.min(target, Math.sqrt(2 * 2.4 * Math.max(0, gap - 4)));
      }
      const dv = target - b.v;
      b.v += Math.max(-4.2 * dt, Math.min(1.5 * dt, dv));
      if (b.v < 0.02) b.v = 0;
      b.s += b.dir * b.v * dt;
      if (b.s > R.path.length || b.s < 0) {
        b.s = b.dir > 0 ? 0 : R.path.length;
        b.route = R.routes[Math.floor(hash01(this.time + b.s) * R.routes.length)];
        b.setRoute(b.route);
      }
      R.path.at(b.s, a);
      const fx = a.tx * b.dir, fz = a.tz * b.dir;
      b.fx = fx;
      b.fz = fz;
      b.x = a.x + fz * R.lane;
      b.z = a.z - fx * R.lane;
      b.group.position.set(b.x, 0, b.z);
      b.group.rotation.y = Math.atan2(fx, fz);
    }
  }

  private setupPolice() {
    this.police = this.vehicles.makePolice();
    this.scene.add(this.police.group);
  }

  private resetPolice() {
    // start it well away from the rider
    const c = this.cop;
    let best = 0, bd = -1;
    this.edgePaths.forEach((p, i) => {
      const m = p.at(p.length / 2, this.tmpA);
      const d = Math.hypot(m.x - this.px, m.z - this.pz);
      const score = d > 160 && d < 330 ? 1000 - Math.abs(d - 220) : d * 0.1;
      if (score > bd && p.length > 20) {
        bd = score;
        best = i;
      }
    });
    c.edge = best;
    c.s = this.edgePaths[best].length / 2;
    c.dir = 1;
    c.mode = "patrol";
    c.chase = 0;
    c.v = 5;
    c.plan = [];
    const m = this.edgePaths[best].at(c.s, this.tmpA);
    c.x = m.x;
    c.z = m.z;
    c.h = Math.atan2(m.tx, m.tz);
  }

  private nearestNode(x: number, z: number): number {
    let best = 0, bd = Infinity;
    const n = this.data.graph.nodes;
    for (let i = 0; i < n.length; i++) {
      const d = (n[i][0] - x) * (n[i][0] - x) + (n[i][1] - z) * (n[i][1] - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Dijkstra over the junction graph; returns the edges to follow. */
  private planRoute(from: number, to: number): number[] {
    const n = this.data.graph.nodes.length;
    const dist = new Float32Array(n).fill(Infinity);
    const prevE = new Int32Array(n).fill(-1);
    const prevN = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    dist[from] = 0;
    for (;;) {
      let u = -1, ud = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < ud) { ud = dist[i]; u = i; }
      if (u < 0 || u === to) break;
      done[u] = 1;
      for (const { e, to: v } of this.adj[u]) {
        const nd = ud + this.edgePaths[e].length;
        if (nd < dist[v]) {
          dist[v] = nd;
          prevE[v] = e;
          prevN[v] = u;
        }
      }
    }
    const out: number[] = [];
    let cur = to;
    while (cur !== from && prevE[cur] >= 0) {
      out.unshift(prevE[cur]);
      cur = prevN[cur];
    }
    return out;
  }

  private updatePolice(dt: number) {
    const c = this.cop;
    const g = this.data.graph;
    const chasing = c.chase > 0 && this.phase === "playing";
    const dxp = this.px - c.x, dzp = this.pz - c.z;
    const dp = Math.hypot(dxp, dzp);
    const cruise = chasing ? 10.6 : 6.2;
    const steerTo = (tx: number, tz: number, speed: number) => {
      const want = Math.atan2(tx - c.x, tz - c.z);
      c.h += Math.max(-2.6 * dt, Math.min(2.6 * dt, angDiff(want, c.h)));
      c.v += Math.max(-8 * dt, Math.min(4 * dt, speed - c.v));
      const nx = c.x + Math.sin(c.h) * c.v * dt, nz = c.z + Math.cos(c.h) * c.v * dt;
      if (!this.grid.blocked(nx, nz)) {
        c.x = nx;
        c.z = nz;
        return true;
      }
      c.v = 0;
      return false;
    };
    const rejoin = () => {
      // closest point of the road graph that can be driven to in a straight line
      let be = -1, bs = 0, bd = Infinity;
      this.edgePaths.forEach((p, i) => {
        const pr = p.project(c.x, c.z);
        if (pr.d < bd) {
          const q = p.at(pr.s, this.tmpA);
          if (pr.d < 4 || this.grid.clear(c.x, c.z, q.x, q.z)) {
            bd = pr.d;
            be = i;
            bs = pr.s;
          }
        }
      });
      if (be < 0) {
        be = c.edge;
        bs = c.s;
      }
      c.te = be;
      c.ts = bs;
      const q = this.edgePaths[be].at(bs, this.tmpA);
      c.tx = q.x;
      c.tz = q.z;
      c.mode = "rejoin";
    };

    if (c.mode === "direct") {
      const los = dp < 34 && this.grid.clear(c.x, c.z, this.px, this.pz);
      if (!chasing || !los || !steerTo(this.px, this.pz, cruise)) rejoin();
    } else if (c.mode === "rejoin") {
      if (chasing && dp < 26 && this.grid.clear(c.x, c.z, this.px, this.pz)) c.mode = "direct";
      else {
        const ok = steerTo(c.tx, c.tz, Math.min(cruise, 6));
        if (!ok || Math.hypot(c.tx - c.x, c.tz - c.z) < 1.2) {
          c.edge = c.te;
          c.s = c.ts;
          c.x = c.tx;
          c.z = c.tz;
          c.mode = "patrol";
          c.plan = [];
          c.replan = 0;
        }
      }
    } else {
      if (chasing && dp < 26 && this.grid.clear(c.x, c.z, this.px, this.pz)) {
        c.mode = "direct";
      } else {
        const path = this.edgePaths[c.edge];
        // ease off into the junctions
        const toEnd = c.dir > 0 ? path.length - c.s : c.s;
        const sp = Math.min(cruise, 3.2 + toEnd * 0.6);
        c.v += Math.max(-9 * dt, Math.min(4 * dt, sp - c.v));
        c.s += c.dir * c.v * dt;
        if (c.s >= path.length || c.s <= 0) {
          const e = g.edges[c.edge];
          const node = c.dir > 0 ? e.b : e.a;
          let next = -1;
          if (chasing) {
            c.replan -= 1;
            if (c.plan.length === 0 || c.replan <= 0) {
              c.plan = this.planRoute(node, this.nearestNode(this.px, this.pz));
              c.replan = 2;
            }
            if (c.plan.length) next = c.plan.shift()!;
          }
          if (next < 0) {
            const opts = this.adj[node].filter((o) => o.e !== c.edge);
            const pickFrom = opts.length ? opts : this.adj[node];
            next = pickFrom[Math.floor(hash01(this.time * 3.7 + node) * pickFrom.length)].e;
          }
          const ne = g.edges[next];
          c.edge = next;
          c.dir = ne.a === node ? 1 : -1;
          c.s = c.dir > 0 ? 0 : this.edgePaths[next].length;
        }
        const q = this.edgePaths[c.edge].at(c.s, this.tmpA);
        // keep left of the centre line
        const fx = q.tx * c.dir, fz = q.tz * c.dir;
        const tx = q.x + fz * 1.3, tz = q.z - fx * 1.3;
        c.x += (tx - c.x) * Math.min(1, dt * 6);
        c.z += (tz - c.z) * Math.min(1, dt * 6);
        c.h += angDiff(Math.atan2(fx, fz), c.h) * Math.min(1, dt * 5);
      }
    }
    this.police.group.position.set(c.x, this.grid.at(c.x, c.z) === SURFACE_PAVEMENT ? KERB : 0, c.z);
    this.police.group.rotation.y = c.h;
    this.police.setLights(chasing, this.time);
    this.sfx.setSiren(chasing);
    if (chasing) {
      c.chase -= dt;
      if (dp < 2.4) {
        this.gameOver("Nicked by the Met", `Jumping a red on ${this.street || "Oxford Street"} is still illegal on a hire bike.`, "police", Math.sin(c.h), Math.cos(c.h));
      } else if (c.chase <= 0) {
        c.chase = 0;
        this.say("Lost them. Keep it legal.", "good");
      }
    }
  }

  private setupPlayer() {
    this.bike = makeBike(true);
    this.scene.add(this.bike.group);
    // what is in the bag, for when it all goes wrong
    const tubGeo = new THREE.BoxGeometry(0.2, 0.09, 0.15);
    const bagGeo = new THREE.BoxGeometry(0.2, 0.26, 0.12);
    const cupGeo = new THREE.CylinderGeometry(0.045, 0.035, 0.13, 10);
    const mats = [0xf2efe6, 0xb98d5a, 0xf2efe6, 0xd8402f, 0xb98d5a, 0xffffff].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(i % 3 === 0 ? bagGeo : i % 3 === 1 ? tubGeo : cupGeo, mats[i % mats.length]);
      m.castShadow = true;
      m.visible = false;
      this.scene.add(m);
      this.debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), live: false });
    }
    // spawn on a side street near Oxford Circus, clear of the bus routes
    let best = -1, bd = Infinity;
    this.edgePaths.forEach((p, i) => {
      if (p.length < 30) return;
      const m = p.at(p.length / 2, this.tmpA);
      if (this.routes.some((r) => r.path.project(m.x, m.z).d < 26)) return;
      if (this.grid.at(m.x, m.z) !== SURFACE_ROAD) return;
      const d = Math.hypot(m.x - 95, m.z - 45);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    const p = this.edgePaths[Math.max(0, best)];
    const m = p.at(p.length / 2, this.tmpA);
    this.spawn = { x: m.x + m.tz * 1.2, z: m.z - m.tx * 1.2, h: Math.atan2(m.tx, m.tz) };
  }

  private randomRoadPoint(minD: number, maxD: number): { x: number; z: number } | null {
    for (let i = 0; i < 40; i++) {
      const e = Math.floor(Math.random() * this.edgePaths.length);
      const p = this.edgePaths[e];
      const a = p.at(Math.random() * p.length, this.tmpA);
      const side = Math.random() < 0.5 ? 1 : -1;
      const x = a.x + a.tz * 1.6 * side, z = a.z - a.tx * 1.6 * side;
      const d = Math.hypot(x - this.px, z - this.pz);
      if (d < minD || d > maxD) continue;
      if (this.grid.at(x, z) !== SURFACE_ROAD && this.grid.at(x, z) !== SURFACE_PAVEMENT) continue;
      if (this.pickups.some((q) => Math.hypot(q.x - x, q.z - z) < 40)) continue;
      return { x, z };
    }
    return null;
  }

  private setupPickups() {
    const body = new THREE.MeshStandardMaterial({ color: 0x1fd655, roughness: 0.35, emissive: 0x1fd655, emissiveIntensity: 0.55 });
    const cap = new THREE.MeshStandardMaterial({ color: 0xe8ffe8, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.3 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x7dff5a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    const bodyGeo = new THREE.BoxGeometry(0.5, 0.78, 0.26);
    const nubGeo = new THREE.BoxGeometry(0.2, 0.09, 0.14);
    const barGeo = new THREE.BoxGeometry(0.3, 0.085, 0.3);
    const ringGeo = new THREE.RingGeometry(0.62, 0.8, 28);
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      const inner = new THREE.Group();
      const b = new THREE.Mesh(bodyGeo, body);
      const nub = new THREE.Mesh(nubGeo, cap);
      nub.position.y = 0.43;
      const h = new THREE.Mesh(barGeo, cap);
      const v = new THREE.Mesh(barGeo, cap);
      v.rotation.z = Math.PI / 2;
      inner.add(b, nub, h, v);
      inner.position.y = 1.0;
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.16;
      g.add(inner, ring);
      g.userData.inner = inner;
      this.scene.add(g);
      this.pickups.push({ g, x: 0, z: 0, ph: i * 0.7 });
    }
  }

  private placePickup(p: { g: THREE.Group; x: number; z: number }, near: boolean) {
    const pt = this.randomRoadPoint(near ? 30 : 70, near ? 420 : 380) ?? { x: this.px + 60, z: this.pz };
    p.x = pt.x;
    p.z = pt.z;
    p.g.position.set(pt.x, this.grid.at(pt.x, pt.z) === SURFACE_PAVEMENT ? KERB : 0, pt.z);
  }

  private setupMarker() {
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x7dff5a, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 60, 24, 1, true), beamMat);
    beam.position.y = 30;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xd4ffc2, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    core.position.y = 30;
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.3, 3.9, 48), new THREE.MeshBasicMaterial({ color: 0x7dff5a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.3, 48), new THREE.MeshBasicMaterial({ color: 0x7dff5a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.19;
    const pin = new THREE.Group();
    const pinMat = new THREE.MeshStandardMaterial({ color: 0x32d24a, emissive: 0x32d24a, emissiveIntensity: 0.9, roughness: 0.3 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 16), pinMat);
    head.position.y = 1.2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.15, 20), pinMat);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.42;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    dot.position.set(0, 1.2, 0);
    dot.scale.set(1, 1, 2.6);
    pin.add(head, tip, dot);
    pin.position.y = 4.4;
    this.marker.add(beam, core, ring, disc, pin);
    this.marker.userData = { ring, pin };
    this.marker.renderOrder = 4;
    this.scene.add(this.marker);
  }

  private pickDestination() {
    const c = this.data.signs.filter((s) => s.dest && s !== this.dest);
    const scored = c.map((s) => ({ s, d: Math.hypot(s.dest![0] - this.px, s.dest![1] - this.pz) }));
    let pool = scored.filter((o) => o.d > 140 && o.d < 330);
    if (!pool.length) pool = scored.filter((o) => o.d > 90);
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? scored[0];
    this.dest = pick.s;
    this.destFrom = pick.d;
    this.marker.position.set(pick.s.dest![0], 0, pick.s.dest![1]);
    this.marker.visible = true;
  }

  private resetRun() {
    this.px = this.spawn.x;
    this.pz = this.spawn.z;
    this.heading = this.spawn.h;
    this.py = 0;
    this.speed = 0;
    this.steer = 0;
    this.lean = 0;
    this.fall = 0;
    this.battery = 100;
    this.timeLeft = START_TIME;
    this.deliveries = 0;
    this.cause = "";
    this.overT = 0;
    this.overReal = 0;
    this.shake = 0;
    this.bikeHop = 0;
    this.bikeHopV = 0;
    this.bikeV.set(0, 0, 0);
    if (this.riderOff) {
      this.bike.remount();
      this.scene.remove(this.riderPivot);
      this.riderOff = false;
    }
    for (const d of this.debris) {
      d.live = false;
      d.m.visible = false;
    }
    for (const b of this.buses) b.halt = false;
    this.sigPrev.fill(NaN);
    for (const p of this.pickups) p.x = p.z = 1e6;
    for (const p of this.pickups) this.placePickup(p, true);
    this.pickDestination();
    this.resetPolice();
    this.crowd?.reset(this.px, this.pz);
    this.crowd?.resetGuards();
    this.inZone = false;
    this.camYaw = this.heading;
    this.camPos.set(this.px - Math.sin(this.heading) * 7, 3.4, this.pz - Math.cos(this.heading) * 7);
    this.camLook.set(this.px, 1.3, this.pz);
  }

  // ---------------------------------------------------------------- control
  start() {
    if (!this.ready) return;
    this.sfx.unlock();
    this.resetRun();
    this.phase = "playing";
    this.say(`Deliver to ${this.dest?.n ?? "the pin"}`, "info");
    this.emit(true);
  }

  private say(text: string, tone: "good" | "bad" | "info") {
    this.toast = { id: ++this.toastId, text, tone };
    this.toastT = 2.6;
  }

  private gameOver(cause: string, detail: string, kind: "bus" | "ped" | "police" | "guard" | "time" = "time", ix = 0, iz = 0, power = 0) {
    if (this.phase !== "playing") return;
    this.phase = "over";
    this.cause = cause;
    this.causeDetail = detail;
    this.overT = 0;
    this.overReal = 0;
    this.crashKind = kind;
    // watch from beside the action: side-on to a bus so it never blocks the view
    this.crashAngle = kind === "bus" ? Math.atan2(ix, iz) + Math.PI * 0.62 : this.camYaw + Math.PI + 0.9;
    this.sfx.setSiren(false);
    this.cop.chase = 0;
    if (kind !== "time") this.startCrash(kind, ix, iz, power);
    this.emit(true);
  }

  /** Throw the rider off, send the bike skidding and spill the order. */
  private startCrash(kind: "bus" | "ped" | "police" | "guard", ix: number, iz: number, power: number) {
    this.sfx.crash();
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const sp = Math.abs(this.speed);
    const rv = this.riderV, bv = this.bikeV;
    if (kind === "bus") {
      rv.set(ix * (power + 5.5), 7.5, iz * (power + 5.5));
      bv.set(ix * (power + 2.5) + fz * 2, 0, iz * (power + 2.5) - fx * 2);
      this.bikeHopV = 5.5;
      this.riderW.set(7, 2, 3);
      this.bikeSpin = 6;
      this.shake = 0.6;
    } else if (kind === "ped") {
      rv.set(fx * (sp * 0.85 + 1), 4.6, fz * (sp * 0.85 + 1)); // over the handlebars
      bv.set(fx * sp * 0.35, 0, fz * sp * 0.35);
      this.bikeHopV = 2;
      this.riderW.set(8, 0, 1);
      this.bikeSpin = 2.5;
      this.shake = 0.3;
    } else {
      // dragged off sideways
      const sx = ix || fz, sz = iz || -fx;
      rv.set(sx * 3.2 + fx * sp * 0.4, 2.6, sz * 3.2 + fz * sp * 0.4);
      bv.set(fx * sp * 0.5, 0, fz * sp * 0.5);
      this.bikeHopV = 0.5;
      this.riderW.set(2.5, 0, 4);
      this.bikeSpin = 1.5;
      this.shake = 0.2;
    }
    // detach the rider and tumble them about their middle
    const piv = this.riderPivot;
    piv.position.set(this.px, this.py + 1.15, this.pz);
    piv.rotation.set(0, this.heading, 0);
    this.scene.add(piv);
    piv.add(this.bike.rider);
    this.bike.rider.position.set(0, -1.15, 0);
    this.bike.rider.rotation.set(0, 0, 0);
    this.riderOff = true;
    // the order goes everywhere
    this.debris.forEach((d, i) => {
      d.live = true;
      d.m.visible = true;
      d.m.position.set(this.px, this.py + 1.4, this.pz);
      const a = (i / this.debris.length) * Math.PI * 2 + i;
      d.v.set(rv.x * 0.6 + Math.cos(a) * 2.6, 3 + (i % 3) * 1.6, rv.z * 0.6 + Math.sin(a) * 2.6);
      d.w.set(6 + i, 3 + i * 2, 5);
    });
    this.crowd?.panic(this.px, this.pz, kind === "bus" ? 22 : 15);
  }

  private updateCrash(dt: number) {
    const g = 16;
    if (this.riderOff) {
      const p = this.riderPivot, v = this.riderV, w = this.riderW;
      v.y -= g * dt;
      const nx = p.position.x + v.x * dt, nz = p.position.z + v.z * dt;
      if (this.grid.blocked(nx, nz)) {
        v.x *= -0.25;
        v.z *= -0.25;
      } else {
        p.position.x = nx;
        p.position.z = nz;
      }
      p.position.y += v.y * dt;
      const floor = (this.grid.at(p.position.x, p.position.z) === SURFACE_PAVEMENT ? KERB : 0) + 0.26;
      if (p.position.y <= floor) {
        p.position.y = floor;
        if (v.y < -2.5) {
          v.y *= -0.32;
          this.sfx.tone(90, 0.12, "square", 0.07);
        } else v.y = 0;
        const f = Math.max(0, 1 - dt * 3.2);
        v.x *= f;
        v.z *= f;
        w.multiplyScalar(Math.max(0, 1 - dt * 5));
        // settle flat on the ground
        p.rotation.x += (Math.round((p.rotation.x - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2 - p.rotation.x) * Math.min(1, dt * 6);
        p.rotation.z += (0 - p.rotation.z) * Math.min(1, dt * 6);
      } else {
        p.rotation.x += w.x * dt;
        p.rotation.z += w.z * dt;
      }
      p.rotation.y += w.y * dt;
    }
    // the bike skids on, spinning
    const bv = this.bikeV;
    const nx = this.px + bv.x * dt, nz = this.pz + bv.z * dt;
    if (this.grid.blocked(nx, nz)) {
      bv.multiplyScalar(-0.2);
    } else {
      this.px = nx;
      this.pz = nz;
    }
    bv.multiplyScalar(Math.max(0, 1 - dt * 1.8));
    this.heading += this.bikeSpin * dt;
    this.bikeSpin *= Math.max(0, 1 - dt * 1.6);
    this.bikeHopV -= g * dt;
    this.bikeHop = Math.max(0, this.bikeHop + this.bikeHopV * dt);
    if (this.bikeHop === 0 && this.bikeHopV < -2) this.bikeHopV *= -0.3;
    for (const d of this.debris) {
      if (!d.live) continue;
      d.v.y -= g * dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt;
      d.m.rotation.y += d.w.y * dt;
      if (d.m.position.y < 0.12) {
        d.m.position.y = 0.12;
        if (d.v.y < -2) d.v.y *= -0.35;
        else d.v.y = 0;
        d.v.x *= 0.6;
        d.v.z *= 0.6;
        d.w.multiplyScalar(0.5);
        if (d.v.lengthSq() < 0.05) d.live = false;
      }
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    this.keys.add(k);
    if ((k === "enter" || k === "r") && (this.phase === "menu" || (this.phase === "over" && this.overReal > 1.2)) && !e.repeat) this.start();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = () => this.keys.clear();

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------- loop
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.clock.update();
    const raw = this.clock.getDelta();
    const dt = Math.min(0.05, raw);
    // adaptive quality: if the first few seconds run slow, shed pixels, then bloom
    if (this.quality > 0 && raw < 0.5) {
      this.perfT += raw;
      this.perfN++;
      if (this.perfT > 3) {
        const avg = this.perfT / this.perfN;
        if (avg > 1 / 42) {
          this.quality--;
          if (this.quality === 1) this.renderer.setPixelRatio(1);
          else {
            this.bloom.enabled = false;
            this.world.sun.shadow.mapSize.set(1024, 1024);
            this.world.sun.shadow.map?.dispose();
            this.world.sun.shadow.map = null;
          }
          this.resize();
        }
        this.perfT = 0;
        this.perfN = 0;
      }
    }
    // crashes play out in slow motion so nobody misses them
    let scale = 1;
    if (this.phase === "over" && this.crashKind !== "time") {
      this.overReal += raw;
      scale = this.overReal < 1.7 ? 0.28 : this.overReal < 2.3 ? 0.28 + ((this.overReal - 1.7) / 0.6) * 0.72 : 1;
    } else if (this.phase === "over") this.overReal += raw;
    this.step(dt * scale);
    this.composer.render(dt);
  };

  /** Advance the simulation; exposed so tests can drive it deterministically. */
  step(dt: number) {
    this.time += dt;
    this.updateSignals();
    this.updateBuses(dt);
    if (this.phase === "playing") this.updatePlayer(dt);
    else if (this.phase === "over") {
      this.overT += dt;
      this.speed *= Math.max(0, 1 - dt * 4);
      this.fall = Math.min(1, this.fall + dt * 3.5);
      if (this.crashKind !== "time") this.updateCrash(dt);
    }
    this.updatePolice(dt);
    this.crowd?.update(dt, this.px, this.pz, this.sigState, this.sigRedLeft, this.time);
    if (this.crowd) {
      const g = this.crowd.updateGuards(dt, this.px, this.pz, this.inZone, this.phase === "playing");
      this.guardsChasing = g.chasing;
      this.guardNear = g.nearest;
      if (g.spotted && this.phase === "playing") {
        this.say("“Oi! No cycling!” — security is after you", "bad");
        this.sfx.whistle();
      }
      if (g.caught) this.gameOver("Tackled by Oxford Street security", "Cycling has been banned on this stretch since it went traffic-free on 26 October 2026.", "guard");
    }
    if (this.phase === "playing") this.checkHazards();
    this.updateBikeModel(dt);
    this.updateProps(dt);
    this.updateCamera(dt);
    this.world.update(this.time);
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toast = null;
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.08;
      this.emit(false);
    }
    if ((this.mapFrame++ & 1) === 0) this.drawMinimap();
  }

  private updatePlayer(dt: number) {
    const k = this.keys;
    const up = k.has("arrowup") || k.has("w");
    const down = k.has("arrowdown") || k.has("s");
    const left = k.has("arrowleft") || k.has("a");
    const right = k.has("arrowright") || k.has("d");
    const brake = k.has(" ");
    const [x0, z0, x1, z1] = this.data.play;
    const outside = this.px < x0 || this.px > x1 || this.pz < z0 || this.pz > z1;

    let maxV = MAX_SPEED;
    if (this.battery <= 0) maxV *= 0.4;
    else if (this.battery < 20) maxV *= 0.55 + 0.45 * (this.battery / 20);
    if (outside) maxV = Math.min(maxV, 2.2);

    if (up && !brake) this.speed += 5.6 * Math.max(0, 1 - this.speed / maxV) * dt;
    if (down) {
      if (this.speed > 0.3) this.speed -= 7.5 * dt;
      else this.speed = Math.max(-2, this.speed - 3 * dt);
    }
    if (brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 13 * dt);
    // rolling resistance and drag
    const drag = 0.45 + 0.012 * this.speed * this.speed;
    if (!up || brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), drag * dt);
    if (this.speed > maxV) this.speed = Math.max(maxV, this.speed - 7 * dt);

    const input = (left ? 1 : 0) - (right ? 1 : 0);
    this.steer += (input - this.steer) * Math.min(1, dt * 9);
    const grip = Math.min(1, Math.abs(this.speed) / 1.4);
    const rate = (2.7 / (1 + Math.abs(this.speed) * 0.115)) * grip * Math.sign(this.speed || 1);
    this.heading += this.steer * rate * dt;

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const step = this.speed * dt;
    const tryMove = (nx: number, nz: number) => {
      const g = this.grid;
      return !(g.blocked(nx, nz) || g.blocked(nx + fx * 0.8, nz + fz * 0.8) || g.blocked(nx - fx * 0.6, nz - fz * 0.6));
    };
    let nx = this.px + fx * step, nz = this.pz + fz * step;
    if (!tryMove(nx, nz)) {
      if (tryMove(nx, this.pz)) { nz = this.pz; this.speed *= 1 - Math.min(1, dt * 5); }
      else if (tryMove(this.px, nz)) { nx = this.px; this.speed *= 1 - Math.min(1, dt * 5); }
      else {
        nx = this.px;
        nz = this.pz;
        if (Math.abs(this.speed) > 3) this.sfx.tone(110, 0.15, "square", 0.08);
        this.speed *= -0.25;
      }
    }
    // hard stop a little way beyond the service zone
    nx = Math.max(x0 - 45, Math.min(x1 + 45, nx));
    nz = Math.max(z0 - 45, Math.min(z1 + 45, nz));
    this.px = nx;
    this.pz = nz;

    const surf = this.grid.at(this.px, this.pz);
    const ty = surf === SURFACE_PAVEMENT ? KERB : 0;
    if (Math.abs(ty - this.py) > 0.05 && Math.abs(this.speed) > 2.5 && this.bump < 0.05) {
      this.bump = 1;
      this.speed *= 0.96;
    }
    this.py += (ty - this.py) * Math.min(1, dt * 18);

    // battery and clock
    const dist = Math.abs(step);
    this.battery = Math.max(0, this.battery - dist * 0.034 - (up ? 0.16 * dt : 0));
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.gameOver("Out of time", `${this.dest?.n ?? "The customer"} gave up waiting and ordered from somewhere else.`);
      return;
    }
    if (outside && this.toastT <= 0) this.say("Outside the Lime service zone — motor cut", "bad");
    const zoneNow = this.grid.inZone(this.px, this.pz);
    if (zoneNow && !this.inZone) this.say("Pedestrian zone — no cycling. Security is watching.", "bad");
    this.inZone = zoneNow;

    // deliveries
    if (this.dest?.dest) {
      const d = Math.hypot(this.dest.dest[0] - this.px, this.dest.dest[1] - this.pz);
      if (d < 5.2) {
        const bonus = Math.round(14 + this.destFrom * 0.12);
        this.deliveries += 1;
        this.timeLeft = Math.min(150, this.timeLeft + bonus);
        const name = this.dest.n;
        this.sfx.bell();
        this.pickDestination();
        this.say(`Delivered to ${name}  +${bonus}s`, "good");
      }
    }
    // battery pickups
    for (const p of this.pickups) {
      if (Math.hypot(p.x - this.px, p.z - this.pz) < 2.1) {
        this.battery = Math.min(100, this.battery + 35);
        this.sfx.pickup();
        this.say("+35% battery", "good");
        this.placePickup(p, false);
      }
    }
    // jumping red lights
    const sig = this.data.signals;
    for (let i = 0; i < sig.length; i++) {
      const s = sig[i];
      const rx = this.px - s.x, rz = this.pz - s.z;
      if (Math.abs(rx) > 30 || Math.abs(rz) > 30) {
        this.sigPrev[i] = NaN;
        continue;
      }
      const along = rx * s.tx + rz * s.tz;
      const lat = Math.abs(-rx * s.tz + rz * s.tx);
      const prev = this.sigPrev[i];
      this.sigPrev[i] = along;
      if (Number.isNaN(prev) || lat > s.hw + 0.4) continue;
      if (prev * along < 0 && this.sigState[i] === 2 && Math.abs(this.speed) > 1.5) this.ranRed();
    }

    this.streetT -= dt;
    if (this.streetT <= 0) {
      this.streetT = 0.4;
      this.street = this.streetAt(this.px, this.pz);
    }
  }

  private ranRed() {
    const c = this.cop;
    const d = Math.hypot(c.x - this.px, c.z - this.pz);
    if (d < 85 && this.grid.clear(c.x, c.z, this.px, this.pz)) {
      const fresh = c.chase <= 0;
      c.chase = 10;
      c.plan = [];
      c.replan = 0;
      if (fresh) this.say("Ran a red — the police saw that!", "bad");
    } else if (c.chase <= 0) {
      this.say("Ran a red. Nobody saw… this time.", "info");
    }
  }

  private checkHazards() {
    for (const b of this.buses) {
      const rx = this.px - b.x, rz = this.pz - b.z;
      if (Math.abs(rx) > 9 || Math.abs(rz) > 9) continue;
      const lz = rx * b.fx + rz * b.fz;
      const lx = rx * b.fz - rz * b.fx;
      if (Math.abs(lz) < BUS.length / 2 + 0.55 && Math.abs(lx) < BUS.width / 2 + 0.3) {
        b.halt = true;
        this.gameOver(`Flattened by the ${b.route}`, `${this.routes[b.r].street}. It had right of way, a timetable and twelve tonnes.`, "bus", b.fx, b.fz, b.v);
        return;
      }
    }
    if (this.crowd && Math.abs(this.speed) > 1.0) {
      for (const p of this.crowd.peds) {
        const d = Math.hypot(p.x - this.px, p.z - this.pz);
        if (d < 0.78) {
          const where = this.street ? ` on ${this.street}` : "";
          const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
          this.crowd.fling(p, fx * (Math.abs(this.speed) * 0.9 + 2) + fz * 1.5, fz * (Math.abs(this.speed) * 0.9 + 2) - fx * 1.5);
          this.gameOver("Took out a pedestrian", p.crossing ? `They had a green man${where}. You had a red light.` : `Pavements are for walking${where}.`, "ped");
          return;
        }
      }
    }
  }

  private updateBikeModel(dt: number) {
    const wheelR = 0.335;
    this.spin += (this.speed * dt) / wheelR;
    const pedalling = this.phase === "playing" && (this.keys.has("arrowup") || this.keys.has("w"));
    if (pedalling || Math.abs(this.speed) > 6) this.pedal += Math.min(9, 2 + Math.abs(this.speed) * 0.7) * dt;
    const targetLean = -this.steer * Math.min(0.42, Math.abs(this.speed) * 0.05);
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 7);
    this.bump = Math.max(0, this.bump - dt * 5);
    const g = this.bike.group;
    g.position.set(this.px, this.py + Math.sin(this.bump * Math.PI) * 0.05 + this.bikeHop, this.pz);
    g.rotation.set(0, this.heading, 0);
    g.rotation.x = -Math.sin(this.bump * Math.PI) * 0.06;
    this.bike.pose(this.steer * 0.5, this.spin, this.pedal, -this.lean + this.fall * 1.35);
  }

  private updateProps(dt: number) {
    for (const p of this.pickups) {
      const inner = p.g.userData.inner as THREE.Group;
      inner.rotation.y += dt * 1.8;
      inner.position.y = 1.0 + Math.sin(this.time * 2.4 + p.ph) * 0.13;
    }
    const { ring, pin } = this.marker.userData as { ring: THREE.Mesh; pin: THREE.Group };
    const pulse = 1 + Math.sin(this.time * 3.2) * 0.07;
    ring.scale.set(pulse, pulse, 1);
    pin.position.y = 4.4 + Math.sin(this.time * 2.2) * 0.35;
    pin.rotation.y += dt * 1.2;
    this.marker.visible = this.phase !== "menu" || true;
  }

  private freeCam = false;

  private updateCamera(dt: number) {
    const cam = this.camera;
    if (this.freeCam) return;
    let tx: number, ty: number, tz: number, lx: number, ly: number, lz: number;
    if (this.phase === "menu" || this.phase === "over") {
      const crashed = this.phase === "over" && this.riderOff;
      // watch the rider, not the bike, once they have parted company
      const cx = crashed ? (this.riderPivot.position.x + this.px) / 2 : this.px;
      const cz = crashed ? (this.riderPivot.position.z + this.pz) / 2 : this.pz;
      const a = this.phase === "menu" ? this.time * 0.16 + this.heading + Math.PI * 0.8 : this.crashAngle + this.overReal * 0.16;
      const spread = crashed ? Math.hypot(this.riderPivot.position.x - this.px, this.riderPivot.position.z - this.pz) : 0;
      const r = this.phase === "menu" ? 8.5 : 7.5 + spread * 0.55;
      tx = cx + Math.sin(a) * r;
      tz = cz + Math.cos(a) * r;
      ty = this.phase === "menu" ? 2.6 : 3.0 + spread * 0.12;
      lx = crashed ? this.riderPivot.position.x * 0.6 + this.px * 0.4 : this.px;
      ly = crashed ? Math.max(0.8, this.riderPivot.position.y * 0.7) : 1.15;
      lz = crashed ? this.riderPivot.position.z * 0.6 + this.pz * 0.4 : this.pz;
    } else {
      this.camYaw += angDiff(this.heading, this.camYaw) * Math.min(1, dt * 4.2);
      const back = 6.4 + Math.abs(this.speed) * 0.16;
      tx = this.px - Math.sin(this.camYaw) * back;
      tz = this.pz - Math.cos(this.camYaw) * back;
      ty = this.py + 3.1;
      lx = this.px + Math.sin(this.heading) * 4.5;
      ly = this.py + 1.45;
      lz = this.pz + Math.cos(this.heading) * 4.5;
    }
    // don't let walls swallow the camera: pull it in along the line to the bike
    for (let t = 1; t > 0.25; t -= 0.08) {
      const cx = this.px + (tx - this.px) * t, cz = this.pz + (tz - this.pz) * t;
      const g = this.grid;
      if (!g.blocked(cx, cz) && !g.blocked(cx + 0.7, cz) && !g.blocked(cx - 0.7, cz) && !g.blocked(cx, cz + 0.7) && !g.blocked(cx, cz - 0.7)) {
        tx = cx;
        tz = cz;
        break;
      }
    }
    const k = Math.min(1, dt * (this.phase === "playing" ? 7 : 3));
    this.camPos.x += (tx - this.camPos.x) * k;
    this.camPos.y += (ty - this.camPos.y) * k;
    this.camPos.z += (tz - this.camPos.z) * k;
    this.camLook.x += (lx - this.camLook.x) * Math.min(1, dt * 9);
    this.camLook.y += (ly - this.camLook.y) * Math.min(1, dt * 9);
    this.camLook.z += (lz - this.camLook.z) * Math.min(1, dt * 9);
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.2);
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.35;
    }
    cam.lookAt(this.camLook);
    const fov = 58 + Math.min(10, Math.abs(this.speed) * 0.9);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
    // sun shadows follow the rider
    const sun = this.world.sun;
    sun.target.position.set(this.px, 0, this.pz);
    sun.position.copy(sun.target.position).addScaledVector(this.world.sunDir, 160);
    this.world.sky.position.copy(cam.position);
  }

  // -------------------------------------------------------------------- HUD
  private emit(force: boolean) {
    if (this.disposed && !force) return;
    let destDist = 0, arrow = 0;
    if (this.dest?.dest) {
      const dx = this.dest.dest[0] - this.px, dz = this.dest.dest[1] - this.pz;
      destDist = Math.hypot(dx, dz);
      arrow = (-angDiff(Math.atan2(dx, dz), this.camYaw) * 180) / Math.PI;
    }
    const [x0, z0, x1, z1] = this.data?.play ?? [0, 0, 0, 0];
    this.onHud({
      phase: this.phase,
      time: this.timeLeft,
      battery: this.battery,
      deliveries: this.deliveries,
      speed: Math.abs(this.speed) * 3.6,
      destName: this.dest?.n ?? "",
      destStreet: this.dest?.dest ? this.streetAt(this.dest.dest[0], this.dest.dest[1]) : "",
      destDist,
      arrow,
      chase: this.cop.chase,
      street: this.street,
      outOfZone: !!this.data && (this.px < x0 || this.px > x1 || this.pz < z0 || this.pz > z1),
      inZone: this.inZone && this.phase === "playing",
      guards: this.guardsChasing,
      toast: this.toast,
      cause: this.cause,
      causeDetail: this.causeDetail,
      overReady: this.phase === "over" && this.overReal > (this.crashKind === "time" ? 0.5 : 3.0),
      loading: this.loadingMsg,
    });
  }

  private buildMinimap() {
    const [x0, z0, x1, z1] = this.data.play;
    const m = 90, s = this.mapScale;
    const cv = document.createElement("canvas");
    cv.width = Math.ceil((x1 - x0 + m * 2) * s);
    cv.height = Math.ceil((z1 - z0 + m * 2) * s);
    const c = cv.getContext("2d")!;
    const X = (x: number) => (x - x0 + m) * s, Z = (z: number) => (z - z0 + m) * s;
    c.fillStyle = "#2b2f36";
    c.fillRect(0, 0, cv.width, cv.height);
    const trace = (r: number[]) => {
      c.moveTo(X(r[0]), Z(r[1]));
      for (let i = 2; i < r.length; i += 2) c.lineTo(X(r[i]), Z(r[i + 1]));
      c.closePath();
    };
    c.fillStyle = "#59616b";
    for (const poly of this.data.pavement) {
      c.beginPath();
      for (const r of poly) trace(r);
      c.fill("evenodd");
    }
    c.fillStyle = "#6f7a66";
    for (const poly of this.data.green) {
      c.beginPath();
      trace(poly[0]);
      c.fill();
    }
    c.fillStyle = "#7b848f";
    for (const b of this.data.buildings) {
      if (!b.play) continue;
      c.beginPath();
      trace(b.p);
      c.fill();
    }
    // zone edge
    c.strokeStyle = "rgba(125,255,90,0.8)";
    c.lineWidth = 3;
    c.setLineDash([10, 6]);
    c.strokeRect(X(x0), Z(z0), (x1 - x0) * s, (z1 - z0) * s);
    c.setLineDash([]);
    this.mapStatic = cv;
  }

  private drawMinimap() {
    const cv = this.minimap;
    const st = this.mapStatic;
    if (!st || !cv.isConnected) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(cv.clientWidth * dpr) || 200;
    if (cv.width !== size) cv.width = cv.height = size;
    const c = cv.getContext("2d")!;
    const [x0, z0] = this.data.play;
    const m = 90, s = this.mapScale;
    const zoom = (size / 190) * 0.62; // screen px per static px
    const h = this.camYaw;
    c.save();
    c.clearRect(0, 0, size, size);
    c.beginPath();
    c.arc(size / 2, size / 2, size / 2, 0, TWO_PI);
    c.clip();
    c.fillStyle = "#23262c";
    c.fillRect(0, 0, size, size);
    c.translate(size / 2, size * 0.6);
    c.rotate(h + Math.PI);
    c.scale(zoom, zoom);
    c.translate(-(this.px - x0 + m) * s, -(this.pz - z0 + m) * s);
    c.drawImage(st, 0, 0);
    const X = (x: number) => (x - x0 + m) * s, Z = (z: number) => (z - z0 + m) * s;
    for (const p of this.pickups) {
      c.fillStyle = "#7dff5a";
      c.beginPath();
      c.arc(X(p.x), Z(p.z), 4.5, 0, TWO_PI);
      c.fill();
    }
    for (const b of this.buses) {
      c.save();
      c.translate(X(b.x), Z(b.z));
      c.rotate(-Math.atan2(b.fx, b.fz));
      c.fillStyle = "#ff3b30";
      c.fillRect(-3.4, -9, 6.8, 18);
      c.restore();
    }
    for (const gd of this.crowd?.guards ?? []) {
      c.fillStyle = gd.chasing && Math.floor(this.time * 6) % 2 ? "#ffffff" : "#facc15";
      c.beginPath();
      c.arc(X(gd.x), Z(gd.z), gd.chasing ? 7 : 4.5, 0, TWO_PI);
      c.fill();
    }
    const cop = this.cop;
    c.fillStyle = cop.chase > 0 && Math.floor(this.time * 6) % 2 ? "#ffffff" : "#3b82f6";
    c.beginPath();
    c.arc(X(cop.x), Z(cop.z), 7, 0, TWO_PI);
    c.fill();
    c.restore();
    // destination: pin, clamped to the rim when it is off the map
    if (this.dest?.dest && this.phase !== "menu") {
      const dx = this.dest.dest[0] - this.px, dz = this.dest.dest[1] - this.pz;
      const a = h + Math.PI;
      let sx = (dx * Math.cos(a) - dz * Math.sin(a)) * s * zoom;
      let sy = (dx * Math.sin(a) + dz * Math.cos(a)) * s * zoom;
      const cx = size / 2, cy = size * 0.6;
      const lim = size / 2 - 9 * dpr;
      const ox = cx + sx - size / 2, oy = cy + sy - size / 2;
      const r = Math.hypot(ox, oy);
      if (r > lim) {
        sx = (ox / r) * lim + size / 2 - cx;
        sy = (oy / r) * lim + size / 2 - cy;
      }
      c.fillStyle = "#7dff5a";
      c.strokeStyle = "#0b1a0b";
      c.lineWidth = 2 * dpr;
      c.beginPath();
      c.arc(cx + sx, cy + sy, 6 * dpr, 0, TWO_PI);
      c.fill();
      c.stroke();
    }
    // rider
    c.save();
    c.translate(size / 2, size * 0.6);
    c.rotate(-(this.heading - h));
    c.fillStyle = "#ffffff";
    c.strokeStyle = "#0b1a0b";
    c.lineWidth = 1.5 * dpr;
    c.beginPath();
    c.moveTo(0, -9 * dpr);
    c.lineTo(6 * dpr, 7 * dpr);
    c.lineTo(0, 3.5 * dpr);
    c.lineTo(-6 * dpr, 7 * dpr);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  getPhase(): Phase {
    return this.phase;
  }

  /** Test / screenshot hooks. */
  debug() {
    return {
      teleport: (x: number, z: number, heading: number) => {
        this.px = x;
        this.pz = z;
        this.heading = heading;
        this.camYaw = heading;
        this.sigPrev.fill(NaN);
        this.camPos.set(x - Math.sin(heading) * 7, 3.2, z - Math.cos(heading) * 7);
        this.camLook.set(x, 1.3, z);
        this.crowd?.reset(x, z);
      },
      state: () => ({
        phase: this.phase, x: this.px, z: this.pz, heading: this.heading, speed: this.speed, battery: this.battery, time: this.timeLeft,
        deliveries: this.deliveries, dest: this.dest, cop: { ...this.cop }, cause: this.cause,
        buses: this.buses.map((b) => ({ x: b.x, z: b.z, route: b.route, v: b.v })),
        peds: this.crowd?.peds.map((p) => ({ x: p.x, z: p.z, crossing: p.crossing })) ?? [],
        signals: Array.from(this.sigState), info: this.renderer.info.render, pickups: this.pickups.map((p) => ({ x: p.x, z: p.z })),
      }),
      set: (o: Partial<{ battery: number; time: number; speed: number; chase: number }>) => {
        if (o.battery !== undefined) this.battery = o.battery;
        if (o.time !== undefined) this.timeLeft = o.time;
        if (o.speed !== undefined) this.speed = o.speed;
        if (o.chase !== undefined) this.cop.chase = o.chase;
      },
      camera: (x: number, y: number, z: number, lx: number, ly: number, lz: number) => {
        this.freeCam = true;
        const sun = this.world.sun;
        sun.target.position.set(lx, 0, lz);
        sun.position.copy(sun.target.position).addScaledVector(this.world.sunDir, 160);
        this.camPos.set(x, y, z);
        this.camLook.set(lx, ly, lz);
        this.camera.position.copy(this.camPos);
        this.camera.lookAt(this.camLook);
        this.world.sky.position.copy(this.camera.position);
        this.composer.render(0.016);
      },
      step: (dt: number, n = 1) => {
        for (let i = 0; i < n; i++) this.step(dt);
      },
      data: this.data,
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.sfx.dispose();
    this.crowd?.dispose();
    this.world?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    this.vehicles.dispose();
    this.scene.clear();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

export { ringToPairs };
