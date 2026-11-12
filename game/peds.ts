import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { Path, ringToPairs, type SurfaceGrid } from "./geo";
import { hash01, SURFACE_BUILDING, SURFACE_PAVEMENT, SURFACE_ROAD, type SceneData, type SignalData } from "./types";

// Rigged CC0 Quaternius characters. Some stroll the pavements; others wait
// at the signals and cross when the traffic is held on red.

const MODELS = ["Casual_2", "Casual_Hoodie", "Suit", "W_Casual", "W_Formal", "W_Suit", "Worker", "W_Worker"];
const SKIN = new Set(["Skin", "Skin_Darker"]);
const HAIR = new Set(["Hair", "Hair_Brown", "Hair_Blond"]);
const KEEP = new Set(["Eye", "Eyebrows", "Moustache", "White", "Black"]);
const SKINS = [0xe2b891, 0xc8956d, 0xa87550, 0x7d5234, 0x5a3a24, 0xedc6a4];
const HAIRS = [0x1a1512, 0x3a2a1c, 0x5c4028, 0x8a6a3c, 0x2a2a2c, 0x9c9a94, 0x6a2a1c];
// London in autumn: navy, black, camel, grey, the odd bright scarf of a coat
const CLOTHES = [0x1c2433, 0x15171b, 0x2f3238, 0x6b5a45, 0xb89a6a, 0x4a4f57, 0x7d2b2b, 0x23402f, 0xd9d4c8, 0x35507a, 0x8a8f96, 0x3b2f4a, 0xc86a2a, 0x1f5c6b];

const KERB = 0.13;

interface Ped {
  obj: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction;
  idle: THREE.AnimationAction;
  run: THREE.AnimationAction;
  mode: number; // 0 normal, 1 fleeing, 2 airborne, 3 down
  modeT: number;
  vx: number;
  vy: number;
  vz: number;
  y: number;
  tumble: number;
  walking: boolean;
  meshes: THREE.SkinnedMesh[];
  shadow: boolean;
  idx: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  radius: number;
  // stroller
  path: number;
  s: number;
  dir: number;
  lat: number;
  // crosser
  sig: number;
  side: number;
  along: number;
  crossing: boolean;
  t: number;
  onRoad: boolean;
}

interface Kerb {
  path: Path;
  side: number;
  main: boolean;
  zone?: boolean;
}

interface Guard {
  obj: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction;
  run: THREE.AnimationAction;
  running: boolean;
  x: number;
  z: number;
  heading: number;
  home: number; // distance along the zone centreline
  s: number;
  dir: number;
  chasing: boolean;
  chaseT: number;
  mark: THREE.Sprite;
}

export class Crowd {
  group = new THREE.Group();
  peds: Ped[] = [];
  private strollers: Ped[] = [];
  private crossers: Ped[] = [];
  private kerbs: Kerb[] = [];
  private mainKerbs: number[] = [];
  private tmp = { x: 0, z: 0, tx: 0, tz: 0 };
  private rngState = 12345;
  private mats: THREE.Material[] = [];
  guards: Guard[] = [];
  private zonePath: Path | null = null;
  private tick = 0;
  private frame = 0;

  private constructor(private data: SceneData, private grid: SurfaceGrid) {}

  static async load(data: SceneData, grid: SurfaceGrid, strollers: number, crossers: number): Promise<Crowd> {
    const c = new Crowd(data, grid);
    const loader = new GLTFLoader();
    const gltfs = await Promise.all(MODELS.map((m) => loader.loadAsync(`/models/${m}.glb`)));
    c.init(gltfs, strollers, crossers);
    return c;
  }

  private rnd() {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  private init(gltfs: GLTF[], nStroll: number, nCross: number) {
    const { data, grid } = this;
    const [x0, z0, x1, z1] = data.play;
    for (const k of data.kerbs) {
      const pts = ringToPairs(k.p).filter((p) => p[0] > x0 - 20 && p[0] < x1 + 20 && p[1] > z0 - 20 && p[1] < z1 + 20);
      if (pts.length < 2) continue;
      const path = new Path(pts);
      if (path.length < 18) continue;
      const m = path.at(path.length / 2, this.tmp);
      const side = grid.at(m.x - m.tz * 1.2, m.z + m.tx * 1.2) === SURFACE_PAVEMENT ? 1 : -1;
      this.kerbs.push({ path, side, main: !!k.m });
      if (k.m) this.mainKerbs.push(this.kerbs.length - 1);
    }
    // the traffic-free stretch of Oxford Street: people walk down the middle of the road
    const zc = (data.zoneCentre ?? []).filter((p) => p[0] > x0 - 25 && p[0] < x1);
    if (zc.length > 2) {
      this.zonePath = new Path(zc);
      this.kerbs.push({ path: this.zonePath, side: 1, main: true, zone: true });
      for (let i = 0; i < 14; i++) this.mainKerbs.push(this.kerbs.length - 1);
      this.makeGuards(gltfs);
    }
    const total = nStroll + nCross;
    for (let i = 0; i < total; i++) {
      // hard hats are for the odd contractor, not every third person
      const mi = i % 23 === 7 ? 6 + (i % 2) : i % 6;
      const src = gltfs[mi];
      const obj = SkeletonUtils.clone(src.scene);
      const top = CLOTHES[Math.floor(this.rnd() * CLOTHES.length)];
      const bottom = [0x15171b, 0x1c2433, 0x2f3238, 0x3a3630, 0x2a3b55, 0x4a4f57][Math.floor(this.rnd() * 6)];
      const skin = SKINS[Math.floor(this.rnd() * SKINS.length)];
      const hair = HAIRS[Math.floor(this.rnd() * HAIRS.length)];
      const cache = new Map<string, THREE.Material>();
      const meshes: THREE.SkinnedMesh[] = [];
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = false;
        meshes.push(m as THREE.SkinnedMesh);
        const remap = (mat: THREE.Material) => {
          const std = mat as THREE.MeshStandardMaterial;
          if (KEEP.has(mat.name)) return mat;
          const key = mat.name + "|" + m.name;
          let out = cache.get(key);
          if (!out) {
            const c = std.clone();
            c.roughness = 0.85;
            c.metalness = 0;
            if (SKIN.has(mat.name)) c.color.setHex(skin);
            else if (HAIR.has(mat.name)) c.color.setHex(hair);
            else if (/Legs/i.test(m.name)) c.color.setHex(bottom);
            else if (/Feet/i.test(m.name)) c.color.setHex(0x1a1a1c);
            else if (/Body/i.test(m.name)) c.color.setHex(top);
            out = c;
            cache.set(key, out);
            this.mats.push(out);
          }
          return out;
        };
        m.material = Array.isArray(m.material) ? m.material.map(remap) : remap(m.material);
      });
      obj.scale.setScalar(0.9 + this.rnd() * 0.09);
      for (const m of meshes) {
        // cull against a generous bind-pose sphere so off-screen walkers cost nothing
        if (m.isSkinnedMesh) {
          m.computeBoundingSphere();
          if (m.boundingSphere) m.boundingSphere.radius *= 1.6;
        }
        m.frustumCulled = true;
      }
      const mixer = new THREE.AnimationMixer(obj);
      const clip = (n: string) => src.animations.find((a) => a.name === n)!;
      const walk = mixer.clipAction(clip("Walk"));
      const idle = mixer.clipAction(clip("Idle"));
      const run = mixer.clipAction(clip("Run"));
      walk.play();
      walk.time = this.rnd() * 2;
      const p: Ped = {
        obj, mixer, walk, idle, run, mode: 0, modeT: 0, vx: 0, vy: 0, vz: 0, y: 0, tumble: 0, walking: true, meshes, shadow: false, idx: i, x: 0, z: 0, heading: 0, speed: 1.15 + this.rnd() * 0.5, radius: 0.36,
        path: -1, s: 0, dir: 1, lat: 0, sig: -1, side: 1, along: 0, crossing: false, t: this.rnd() * 3, onRoad: false,
      };
      walk.timeScale = p.speed / 1.3;
      this.peds.push(p);
      (i < nStroll ? this.strollers : this.crossers).push(p);
      this.group.add(obj);
    }
  }

  private makeGuards(gltfs: GLTF[]) {
    const zp = this.zonePath!;
    const n = Math.max(3, Math.round(zp.length / 46));
    for (let i = 0; i < n; i++) {
      const src = gltfs[i % 2 ? 7 : 6]; // the two hi-vis worker models
      const obj = SkeletonUtils.clone(src.scene);
      const cache = new Map<string, THREE.Material>();
      obj.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.frustumCulled = false;
        const remap = (mat: THREE.Material) => {
          if (KEEP.has(mat.name) || SKIN.has(mat.name) || HAIR.has(mat.name)) return mat;
          const key = mat.name + "|" + m.name;
          let out = cache.get(key);
          if (!out) {
            const c = (mat as THREE.MeshStandardMaterial).clone();
            if (/Legs|Feet/i.test(m.name)) c.color.setHex(0x111214);
            else if (/Body/i.test(m.name)) {
              c.color.setHex(0xd8ff2a);
              c.emissive = new THREE.Color(0xd8ff2a);
              c.emissiveIntensity = 0.25;
            }
            out = c;
            cache.set(key, out);
            this.mats.push(out);
          }
          return out;
        };
        m.material = Array.isArray(m.material) ? m.material.map(remap) : remap(m.material);
      });
      obj.scale.setScalar(1.0);
      const mixer = new THREE.AnimationMixer(obj);
      const clip = (nm: string) => src.animations.find((a) => a.name === nm)!;
      const walk = mixer.clipAction(clip("Walk"));
      const run = mixer.clipAction(clip("Run"));
      walk.play();
      const home = ((i + 0.5) / n) * zp.length;
      const a = zp.at(home, this.tmp);
      const mark = new THREE.Sprite(this.alertMaterial());
      mark.scale.set(0.9, 0.9, 1);
      mark.visible = false;
      this.group.add(mark);
      this.guards.push({ obj, mixer, walk, run, running: false, x: a.x, z: a.z, heading: 0, home, s: home, dir: i % 2 ? 1 : -1, chasing: false, chaseT: 0, mark });
      this.group.add(obj);
    }
  }

  private alertMat: THREE.SpriteMaterial | null = null;
  private alertMaterial() {
    if (!this.alertMat) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 128;
      const c = cv.getContext("2d")!;
      c.fillStyle = "#e11d2a";
      c.beginPath();
      c.arc(64, 64, 58, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#fff";
      c.font = "900 96px Arial, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("!", 64, 70);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      this.alertMat = new THREE.SpriteMaterial({ map: t, depthTest: false, fog: false });
      this.mats.push(this.alertMat);
    }
    return this.alertMat;
  }

  /** Someone has been hit: send them flying. */
  fling(p: Ped, vx: number, vz: number) {
    p.mode = 2;
    p.vx = vx;
    p.vz = vz;
    p.vy = 5.5;
    p.y = 0.2;
    p.tumble = 0;
    p.crossing = false;
  }

  /** Everyone nearby legs it. */
  panic(x: number, z: number, radius: number) {
    for (const p of this.peds) {
      if (p.mode !== 0) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > radius || d < 0.01) continue;
      p.mode = 1;
      p.modeT = 2.5 + this.rnd() * 2.5;
      p.vx = ((p.x - x) / d) * (3.6 + this.rnd() * 1.6);
      p.vz = ((p.z - z) / d) * (3.6 + this.rnd() * 1.6);
      p.walk.stop();
      p.idle.stop();
      p.run.reset().play();
    }
  }

  private updateSpecial(p: Ped, dt: number): boolean {
    if (p.mode === 0) return false;
    if (p.mode === 1) {
      p.modeT -= dt;
      const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
      if (!this.grid.blocked(nx, nz)) {
        p.x = nx;
        p.z = nz;
      } else {
        // dodge along the wall
        const t = p.vx;
        p.vx = -p.vz;
        p.vz = t;
      }
      p.heading = Math.atan2(p.vx, p.vz);
      p.onRoad = this.grid.at(p.x, p.z) === SURFACE_ROAD;
      if (p.modeT <= 0) {
        p.mode = 3;
        p.run.stop();
        p.idle.reset().play();
        p.tumble = 0;
      }
    } else if (p.mode === 2) {
      p.vy -= 16 * dt;
      p.y += p.vy * dt;
      const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
      if (!this.grid.blocked(nx, nz)) {
        p.x = nx;
        p.z = nz;
      } else {
        p.vx *= -0.3;
        p.vz *= -0.3;
      }
      p.tumble += dt * 9;
      if (p.y <= 0.25 && p.vy < 0) {
        if (p.vy < -3) {
          p.vy *= -0.3;
          p.vx *= 0.5;
          p.vz *= 0.5;
          p.y = 0.25;
        } else {
          p.mode = 3;
          p.y = 0.25;
          p.tumble = -Math.PI / 2; // flat on their back
          p.walk.stop();
          p.run.stop();
        }
      }
    }
    return true;
  }

  resetGuards() {
    if (!this.zonePath) return;
    for (const g of this.guards) {
      g.s = g.home;
      g.chasing = false;
      g.chaseT = 0;
      g.mark.visible = false;
      const a = this.zonePath.at(g.home, this.tmp);
      g.x = a.x;
      g.z = a.z;
    }
  }

  /** Security patrols the zone and sprints at anyone cycling in it. */
  updateGuards(dt: number, px: number, pz: number, riderInZone: boolean, active: boolean): { chasing: number; caught: boolean; spotted: boolean; nearest: number } {
    const zp = this.zonePath;
    let chasing = 0, caught = false, spotted = false, nearest = 999;
    if (!zp) return { chasing, caught, spotted, nearest };
    for (const g of this.guards) {
      const dx = px - g.x, dz = pz - g.z;
      const d = Math.hypot(dx, dz);
      if (!g.chasing && active && riderInZone && d < 36 && d > 6 && this.grid.clear(g.x, g.z, px, pz)) {
        g.chasing = true;
        g.chaseT = 0;
        spotted = true;
      }
      if (g.chasing && (!active || d > 60 || (!riderInZone && d > 13))) g.chasing = false;
      let speed: number, tx: number, tz: number;
      if (g.chasing) {
        chasing++;
        g.chaseT += dt;
        nearest = Math.min(nearest, d);
        speed = 7.1;
        tx = dx / (d || 1);
        tz = dz / (d || 1);
        // only a guard who has visibly run you down can make the tackle
        if (d < 1.25 && g.chaseT > 0.9) caught = true;
      } else {
        // amble up and down their beat
        const pr = zp.project(g.x, g.z);
        if (pr.d > 3) {
          const a = zp.at(pr.s, this.tmp);
          const l = Math.hypot(a.x - g.x, a.z - g.z) || 1;
          tx = (a.x - g.x) / l;
          tz = (a.z - g.z) / l;
          g.s = pr.s;
          speed = 2.4;
        } else {
          if (g.s > g.home + 14) g.dir = -1;
          else if (g.s < g.home - 14) g.dir = 1;
          g.s = Math.max(1, Math.min(zp.length - 1, pr.s + g.dir * 1.1 * dt));
          const a = zp.at(g.s, this.tmp);
          tx = a.tx * g.dir;
          tz = a.tz * g.dir;
          speed = 1.1;
        }
      }
      const nx = g.x + tx * speed * dt, nz = g.z + tz * speed * dt;
      if (!this.grid.blocked(nx, nz)) {
        g.x = nx;
        g.z = nz;
      }
      const want = Math.atan2(tx, tz);
      g.heading += Math.atan2(Math.sin(want - g.heading), Math.cos(want - g.heading)) * Math.min(1, dt * 8);
      if (g.running !== g.chasing) {
        g.running = g.chasing;
        const from = g.chasing ? g.walk : g.run, to = g.chasing ? g.run : g.walk;
        to.reset().play();
        from.crossFadeTo(to, 0.2, false);
      }
      const vis = d < 130;
      g.obj.visible = vis;
      if (vis) {
        g.obj.position.set(g.x, this.grid.at(g.x, g.z) === SURFACE_ROAD ? 0 : KERB, g.z);
        g.obj.rotation.y = g.heading;
        g.mixer.update(dt);
      }
      g.mark.visible = vis && g.chasing;
      if (g.mark.visible) g.mark.position.set(g.x, 2.75 + Math.sin(g.chaseT * 9) * 0.08, g.z);
    }
    return { chasing, caught, spotted, nearest };
  }

  private setWalking(p: Ped, w: boolean) {
    if (p.walking === w) return;
    p.walking = w;
    const from = w ? p.idle : p.walk, to = w ? p.walk : p.idle;
    to.reset().play();
    from.crossFadeTo(to, 0.25, false);
  }

  private placeStroller(p: Ped, px: number, pz: number, far: boolean) {
    for (let tries = 0; tries < 30; tries++) {
      // Oxford Street and Regent Street are where the crowds are
      const ki = this.mainKerbs.length && this.rnd() < 0.45
        ? this.mainKerbs[Math.floor(this.rnd() * this.mainKerbs.length)]
        : Math.floor(this.rnd() * this.kerbs.length);
      const k = this.kerbs[ki];
      const s = this.rnd() * k.path.length;
      const lat = k.zone ? (this.rnd() - 0.5) * 13 : 0.9 + this.rnd() * (k.main ? 3.6 : 2.2);
      const a = k.path.at(s, this.tmp);
      const x = a.x - a.tz * lat * k.side, z = a.z + a.tx * lat * k.side;
      const d = Math.hypot(x - px, z - pz);
      if (d > 118 || (far && d < 60) || d < 9) continue;
      if (k.zone ? !this.grid.inZone(x, z) || this.grid.blocked(x, z) : this.grid.at(x, z) !== SURFACE_PAVEMENT) continue;
      p.path = ki;
      p.s = s;
      p.lat = lat;
      p.dir = this.rnd() < 0.5 ? 1 : -1;
      p.x = x;
      p.z = z;
      return;
    }
  }

  private waitPoint(s: SignalData, side: number, along: number, out: { x: number; z: number }) {
    const px = -s.tz, pz = s.tx;
    out.x = s.x + px * side * (s.hw + 1.1) + s.tx * along;
    out.z = s.z + pz * side * (s.hw + 1.1) + s.tz * along;
    return out;
  }

  /** Spread the crossing groups over the signals nearest the rider. */
  private assignCrossers(px: number, pz: number, force: boolean) {
    const sigs = this.data.signals;
    const order = sigs.map((s, i) => ({ i, d: Math.hypot(s.x - px, s.z - pz) })).sort((a, b) => a.d - b.d);
    const per = 4;
    const want = order.slice(0, Math.ceil(this.crossers.length / per)).map((o) => o.i);
    const have = new Map<number, number>();
    for (const p of this.crossers) if (want.includes(p.sig)) have.set(p.sig, (have.get(p.sig) ?? 0) + 1);
    const pt = { x: 0, z: 0 };
    for (const p of this.crossers) {
      if (!force && want.includes(p.sig)) continue;
      if (!force && (p.crossing || p.mode !== 0)) continue;
      const target = want.find((w) => (have.get(w) ?? 0) < per);
      if (target === undefined) break;
      have.set(target, (have.get(target) ?? 0) + 1);
      p.sig = target;
      p.side = this.rnd() < 0.5 ? 1 : -1;
      p.along = (this.rnd() - 0.5) * 2.6;
      p.crossing = false;
      const w = this.waitPoint(sigs[target], p.side, p.along, pt);
      p.x = w.x;
      p.z = w.z;
      p.heading = Math.atan2(-(-sigs[target].tz) * p.side, -sigs[target].tx * p.side);
    }
  }

  reset(px: number, pz: number) {
    for (const p of this.peds) {
      if (p.mode !== 0) {
        p.mode = 0;
        p.run.stop();
        p.idle.stop();
        p.walk.reset().play();
        p.walking = true;
      }
    }
    for (const p of this.strollers) this.placeStroller(p, px, pz, false);
    for (const p of this.crossers) { p.sig = -1; p.crossing = false; }
    this.assignCrossers(px, pz, true);
  }

  /**
   * @param signalState 0 green, 1 amber, 2 red (for vehicles) per signal
   * @param redLeft seconds of red remaining per signal
   */
  update(dt: number, px: number, pz: number, signalState: Uint8Array, redLeft: Float32Array, time: number) {
    const { grid } = this;
    const a = this.tmp;
    for (const p of this.strollers) {
      if (p.path < 0) continue;
      if (this.updateSpecial(p, dt)) continue;
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d > 128) {
        this.placeStroller(p, px, pz, true);
        continue;
      }
      const k = this.kerbs[p.path];
      let ns = p.s + p.dir * p.speed * dt;
      if (ns < 0.5 || ns > k.path.length - 0.5) {
        p.dir *= -1;
        ns = p.s;
      }
      k.path.at(ns, a);
      const x = a.x - a.tz * p.lat * k.side, z = a.z + a.tx * p.lat * k.side;
      const surf = grid.at(x, z);
      if (k.zone) {
        if (surf === SURFACE_BUILDING || !grid.inZone(x, z)) {
          p.dir *= -1;
          continue;
        }
      } else if (surf === SURFACE_BUILDING || surf === SURFACE_ROAD) {
        // pavement pinches: tuck in towards the kerb, or turn round
        if (p.lat > 0.7) p.lat -= 0.25;
        else p.dir *= -1;
        continue;
      }
      p.s = ns;
      p.x = x;
      p.z = z;
      const th = Math.atan2(a.tx * p.dir, a.tz * p.dir);
      p.heading = th;
      p.onRoad = surf === SURFACE_ROAD;
    }

    if (Math.floor(time * 2) !== Math.floor((time - dt) * 2)) this.assignCrossers(px, pz, false);
    const pt = { x: 0, z: 0 };
    for (const p of this.crossers) {
      if (p.sig < 0) continue;
      if (this.updateSpecial(p, dt)) continue;
      const s = this.data.signals[p.sig];
      if (!p.crossing) {
        this.setWalking(p, false);
        p.t -= dt;
        const need = (s.hw * 2 + 2.4) / p.speed + 1.0;
        if (signalState[p.sig] === 2 && redLeft[p.sig] > need && p.t <= 0) {
          p.crossing = true;
          this.setWalking(p, true);
        }
        // face the road while waiting
        const fx = -(-s.tz) * p.side, fz = -s.tx * p.side;
        const want = Math.atan2(fx, fz);
        let dh = want - p.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        p.heading += dh * Math.min(1, dt * 4);
        p.onRoad = false;
      } else {
        const goal = this.waitPoint(s, -p.side, p.along, pt);
        const dx = goal.x - p.x, dz = goal.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.25) {
          p.crossing = false;
          p.side = -p.side;
          p.t = 1.5 + hash01(time + p.along) * 4;
        } else {
          p.x += (dx / dist) * p.speed * dt;
          p.z += (dz / dist) * p.speed * dt;
          p.heading = Math.atan2(dx, dz);
        }
        p.onRoad = grid.at(p.x, p.z) === SURFACE_ROAD;
      }
    }

    this.tick++;
    for (const p of this.peds) {
      const d2 = (p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz);
      const visible = d2 < 112 * 112;
      p.obj.visible = visible;
      if (!visible) continue;
      if (p.mode >= 2) {
        p.obj.position.set(p.x, p.y, p.z);
        p.obj.rotation.set(p.tumble, p.heading, 0, "YXZ");
      } else {
        p.obj.position.set(p.x, p.onRoad ? 0 : KERB, p.z);
        p.obj.rotation.set(0, p.heading, 0);
      }
      const shadow = d2 < 26 * 26;
      if (shadow !== p.shadow) {
        p.shadow = shadow;
        for (const m of p.meshes) m.castShadow = shadow;
      }
      // animate the far ones on alternate frames, the furthest on every third
      this.frame++;
      if (d2 < 38 * 38) p.mixer.update(dt);
      else if (d2 < 75 * 75) { if (((this.tick + p.idx) & 1) === 0) p.mixer.update(dt * 2); }
      else if ((this.tick + p.idx) % 3 === 0) p.mixer.update(dt * 3);
    }
  }

  dispose() {
    for (const p of this.peds) p.mixer.stopAllAction();
    this.mats.forEach((m) => m.dispose());
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
