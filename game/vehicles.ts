import * as THREE from "three";

// London double-decker and a Met Police area car. Both face +Z; with the
// scene's axes the nearside (kerb side, left-hand traffic) is +X.

const TFL_RED = "#d81e1e";
const SANS = `"Helvetica Neue", Helvetica, Arial, sans-serif`;

export const BUS = { length: 11.2, width: 2.55, height: 4.38 };

const DESTINATIONS: Record<string, string> = {
  "55": "Walthamstow Central",
  "73": "Stoke Newington",
  "98": "Willesden",
  "390": "Archway",
  "139": "Golders Green",
  N207: "Uxbridge",
  "88": "Parliament Hill Fields",
  "12": "Dulwich Library",
  "94": "Acton Green",
  "453": "Deptford Bridge",
  "159": "Streatham Station",
};

const ADVERTS: [string, string, string][] = [
  ["#f3ead7", "#1a1a1a", "SOHO  ·  EST. 1685  ·  STILL OPEN LATE"],
  ["#101820", "#7dff5a", "UNLOCK. RIDE. PARK NICELY."],
  ["#143a5a", "#ffffff", "THE WEST END  —  EVERY NIGHT AT 7.30"],
];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
}

function glassGrad(c: CanvasRenderingContext2D, y: number, h: number) {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#3b4c59");
  g.addColorStop(0.5, "#1a242c");
  g.addColorStop(1, "#10161b");
  return g;
}

/** Side elevation. `frontLeft`: the front of the bus is at the left of the canvas. */
function busSide(nearside: boolean, frontLeft: boolean, advert: number): THREE.CanvasTexture {
  const W = 1400, H = 548; // 125 px per metre
  const [cv, c] = canvas(W, H);
  const X = (m: number) => (frontLeft ? m : BUS.length - m) * 125; // metres from the front
  const span = (m0: number, m1: number): [number, number] => {
    const a = X(m0), b = X(m1);
    return [Math.min(a, b), Math.abs(b - a)];
  };
  c.fillStyle = TFL_RED;
  c.fillRect(0, 0, W, H);
  // roof edge
  c.fillStyle = "#f1f1ee";
  c.fillRect(0, 0, W, 16);
  c.fillStyle = "rgba(0,0,0,0.25)";
  c.fillRect(0, 16, W, 3);
  // upper deck glazing: one long band broken by slim pillars
  c.fillStyle = glassGrad(c, 44, 120);
  rr(c, 28, 44, W - 56, 120, 26);
  c.fillStyle = "#0a0d10";
  for (let m = 1.6; m < BUS.length - 0.6; m += 1.42) c.fillRect(X(m) - 4, 44, 8, 120);
  // advert panel between decks
  const [abg, afg, atext] = ADVERTS[advert % ADVERTS.length];
  const [ax, aw] = span(2.6, 9.6);
  c.fillStyle = abg;
  c.fillRect(ax, 188, aw, 62);
  c.fillStyle = afg;
  c.font = `700 30px ${SANS}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(atext, ax + aw / 2, 220, aw - 30);
  // lower deck glazing
  c.fillStyle = glassGrad(c, 272, 130);
  const [lx, lw] = span(nearside ? 2.1 : 1.3, BUS.length - 0.5);
  rr(c, lx, 272, lw, 130, 18);
  c.fillStyle = "#0a0d10";
  for (let m = 2.9; m < BUS.length - 0.8; m += 1.42) c.fillRect(X(m) - 4, 272, 8, 130);
  if (nearside) {
    // front and centre doors
    for (const [d0, d1] of [[0.55, 1.75], [5.3, 6.6]]) {
      const [dx, dw] = span(d0, d1);
      c.fillStyle = "#0a0d10";
      c.fillRect(dx - 5, 262, dw + 10, 236);
      c.fillStyle = glassGrad(c, 270, 220);
      c.fillRect(dx, 270, dw / 2 - 3, 220);
      c.fillRect(dx + dw / 2 + 3, 270, dw / 2 - 3, 220);
      c.fillStyle = "#e7c400";
      c.fillRect(dx, 482, dw, 8);
    }
  } else {
    // driver's cab window
    const [dx, dw] = span(0.35, 1.15);
    c.fillStyle = glassGrad(c, 262, 150);
    rr(c, dx, 262, dw, 150, 10);
  }
  // skirt, wheel arches, wheels
  c.fillStyle = "#b01717";
  c.fillRect(0, 500, W, 48);
  for (const m of [2.35, 8.55]) {
    const cx = X(m);
    c.fillStyle = "#0c0c0d";
    c.beginPath();
    c.arc(cx, 548, 76, Math.PI, 0);
    c.fill();
  }
  // roundel and fleet number
  const rx = X(nearside ? 9.9 : 10.2);
  c.fillStyle = "#ffffff";
  c.beginPath();
  c.arc(rx, 450, 22, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = TFL_RED;
  c.beginPath();
  c.arc(rx, 450, 14, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#ffffff";
  c.fillRect(rx - 30, 444, 60, 12);
  c.font = `600 15px ${SANS}`;
  c.fillStyle = "rgba(255,255,255,0.9)";
  c.textAlign = "center";
  c.fillText("LONDON BUSES", X(4.4), 462);
  // grime along the bottom
  const g = c.createLinearGradient(0, 430, 0, H);
  g.addColorStop(0, "rgba(40,20,10,0)");
  g.addColorStop(1, "rgba(40,20,10,0.35)");
  c.fillStyle = g;
  c.fillRect(0, 430, W, H - 430);
  return finish(cv);
}

function busEnd(front: boolean, route: string): THREE.CanvasTexture {
  const W = 320, H = 548;
  const [cv, c] = canvas(W, H);
  c.fillStyle = TFL_RED;
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#f1f1ee";
  c.fillRect(0, 0, W, 16);
  const blind = (y: number, h: number, big: boolean) => {
    c.fillStyle = "#070707";
    rr(c, 26, y, W - 52, h, 8);
    c.fillStyle = "#ffb000";
    c.textBaseline = "middle";
    if (big) {
      c.textAlign = "left";
      c.font = `800 ${h * 0.72}px ${SANS}`;
      c.fillText(route, 38, y + h / 2 + 2);
      const nw = c.measureText(route).width;
      c.font = `600 ${h * 0.34}px ${SANS}`;
      c.fillText(DESTINATIONS[route] ?? "Oxford Circus", 38 + nw + 12, y + h / 2 + 2, W - 90 - nw);
    } else {
      c.textAlign = "center";
      c.font = `800 ${h * 0.8}px ${SANS}`;
      c.fillText(route, W / 2, y + h / 2 + 2);
    }
  };
  if (front) {
    c.fillStyle = glassGrad(c, 34, 110);
    rr(c, 22, 34, W - 44, 110, 20);
    blind(160, 64, true);
    c.fillStyle = glassGrad(c, 240, 170);
    rr(c, 18, 240, W - 36, 170, 16);
    c.fillStyle = "#0a0d10";
    c.fillRect(W / 2 - 3, 240, 6, 170);
    c.fillStyle = "#111";
    c.fillRect(0, 440, W, 50);
    for (const x of [44, W - 44]) {
      c.fillStyle = "#fff7d6";
      c.beginPath();
      c.arc(x, 465, 17, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "#f4d000";
    c.fillRect(W / 2 - 52, 500, 104, 26);
    c.fillStyle = "#111";
    c.font = `700 19px ${SANS}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("LK26 LME", W / 2, 514);
  } else {
    c.fillStyle = glassGrad(c, 40, 110);
    rr(c, 30, 40, W - 60, 110, 18);
    blind(176, 70, false);
    c.fillStyle = "#b01717";
    c.fillRect(30, 270, W - 60, 190);
    c.strokeStyle = "rgba(0,0,0,0.3)";
    c.lineWidth = 2;
    for (let y = 286; y < 450; y += 14) {
      c.beginPath();
      c.moveTo(44, y);
      c.lineTo(W - 44, y);
      c.stroke();
    }
    for (const x of [22, W - 22]) {
      c.fillStyle = "#ff2a1a";
      c.fillRect(x - 10, 300, 20, 60);
      c.fillStyle = "#ffa000";
      c.fillRect(x - 10, 366, 20, 26);
    }
    c.fillStyle = "#f4d000";
    c.fillRect(W / 2 - 52, 486, 104, 26);
    c.fillStyle = "#111";
    c.font = `700 19px ${SANS}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("LK26 LME", W / 2, 500);
  }
  return finish(cv);
}

export class VehicleFactory {
  private disposables: { dispose: () => void }[] = [];
  private sideMats: THREE.Material[][] = [];
  private endMats = new Map<string, [THREE.Material, THREE.Material]>();
  private roof: THREE.Material;
  private under: THREE.Material;
  private busGeo: THREE.BufferGeometry;
  private wheelGeo: THREE.BufferGeometry;
  private wheelMat: THREE.Material;
  private hubMat: THREE.Material;

  constructor() {
    for (let a = 0; a < ADVERTS.length; a++) {
      const near = busSide(true, true, a);
      const off = busSide(false, false, a);
      this.disposables.push(near, off);
      this.sideMats.push([
        new THREE.MeshPhysicalMaterial({ map: near, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 }),
        new THREE.MeshPhysicalMaterial({ map: off, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 }),
      ]);
    }
    this.roof = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.6 });
    this.under = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 });
    this.busGeo = new THREE.BoxGeometry(BUS.width, BUS.height - 0.3, BUS.length);
    this.wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 18);
    this.wheelGeo.rotateZ(Math.PI / 2);
    this.wheelMat = new THREE.MeshStandardMaterial({ color: 0x101011, roughness: 0.95 });
    this.hubMat = new THREE.MeshStandardMaterial({ color: 0x8c1414, roughness: 0.5 });
    this.disposables.push(this.busGeo, this.wheelGeo);
  }

  private ends(route: string): [THREE.Material, THREE.Material] {
    let e = this.endMats.get(route);
    if (!e) {
      const f = busEnd(true, route), b = busEnd(false, route);
      this.disposables.push(f, b);
      e = [
        new THREE.MeshPhysicalMaterial({ map: f, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06, emissiveMap: f, emissive: 0xffffff, emissiveIntensity: 0.12 }),
        new THREE.MeshPhysicalMaterial({ map: b, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 }),
      ];
      this.endMats.set(route, e);
    }
    return e;
  }

  makeBus(route: string, variant: number): { group: THREE.Group; setRoute: (r: string) => void } {
    const group = new THREE.Group();
    const sides = this.sideMats[variant % this.sideMats.length];
    const mats = (r: string) => {
      const [f, b] = this.ends(r);
      // BoxGeometry groups: +x, -x, +y, -y, +z, -z
      return [sides[0], sides[1], this.roof, this.under, f, b];
    };
    const body = new THREE.Mesh(this.busGeo, mats(route));
    body.position.y = 0.3 + (BUS.height - 0.3) / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    for (const z of [BUS.length / 2 - 2.35, BUS.length / 2 - 8.55]) {
      for (const x of [-1, 1]) {
        const w = new THREE.Mesh(this.wheelGeo, this.wheelMat);
        w.position.set(x * (BUS.width / 2 - 0.2), 0.5, z);
        group.add(w);
        const hub = new THREE.Mesh(this.wheelGeo, this.hubMat);
        hub.scale.set(0.3, 0.5, 0.5);
        hub.position.set(x * (BUS.width / 2 - 0.06), 0.5, z);
        group.add(hub);
      }
    }
    // mirrors
    for (const x of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.2), this.under);
      m.position.set(x * (BUS.width / 2 + 0.2), 2.5, BUS.length / 2 - 0.25);
      group.add(m);
      this.disposables.push(m.geometry);
    }
    return { group, setRoute: (r) => { body.material = mats(r); } };
  }

  makePolice(): { group: THREE.Group; setLights: (on: boolean, t: number) => void } {
    const group = new THREE.Group();
    const L = 4.7, W = 1.86;
    const side = (frontLeft: boolean) => {
      const [cv, c] = canvas(940, 150);
      c.fillStyle = "#e9ecee";
      c.fillRect(0, 0, 940, 150);
      // Battenburg: two rows of blue / yellow blocks
      const n = 7, bw = 940 / n;
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < 2; r++) {
          c.fillStyle = (i + r) % 2 ? "#0047ab" : "#f2e400";
          c.fillRect(i * bw, 34 + r * 42, bw, 42);
        }
      }
      c.fillStyle = "#0a1a3a";
      c.font = `800 26px ${SANS}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("POLICE", frontLeft ? 250 : 690, 18);
      c.fillStyle = "#0c0c0d";
      for (const m of [0.82, 3.72]) {
        const x = (frontLeft ? m : L - m) * 200;
        c.beginPath();
        c.arc(x, 150, 72, Math.PI, 0);
        c.fill();
      }
      return finish(cv);
    };
    const end = (front: boolean) => {
      const [cv, c] = canvas(372, 150);
      c.fillStyle = "#e9ecee";
      c.fillRect(0, 0, 372, 150);
      if (front) {
        c.fillStyle = "#101214";
        c.fillRect(110, 70, 152, 40);
        for (const x of [50, 322]) {
          c.fillStyle = "#fffbe6";
          rr(c, x - 34, 58, 68, 30, 10);
        }
      } else {
        for (let i = 0; i < 12; i++) {
          c.fillStyle = i % 2 ? "#e30613" : "#f2e400";
          c.beginPath();
          c.moveTo(i * 36 - 30, 150);
          c.lineTo(i * 36 + 6, 150);
          c.lineTo(i * 36 + 50, 40);
          c.lineTo(i * 36 + 14, 40);
          c.fill();
        }
        for (const x of [36, 336]) {
          c.fillStyle = "#e30613";
          rr(c, x - 28, 10, 56, 24, 6);
        }
      }
      c.fillStyle = "#f4d000";
      c.fillRect(136, 118, 100, 24);
      c.fillStyle = "#111";
      c.font = `700 17px ${SANS}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("BX26 MET", 186, 131);
      return finish(cv);
    };
    const tl = side(true), tr = side(false), tf = end(true), tb = end(false);
    this.disposables.push(tl, tr, tf, tb);
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xe9ecee, roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
    const M = (t: THREE.Texture) => new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });
    const lowerGeo = new THREE.BoxGeometry(W, 0.72, L);
    const lower = new THREE.Mesh(lowerGeo, [M(tl), M(tr), paint, this.under, M(tf), M(tb)]);
    lower.position.y = 0.62;
    lower.castShadow = true;
    group.add(lower);
    const glass = new THREE.MeshStandardMaterial({ color: 0x10171c, roughness: 0.08, metalness: 0.9 });
    const cabinGeo = new THREE.BoxGeometry(W - 0.22, 0.56, 2.7);
    const cabin = new THREE.Mesh(cabinGeo, glass);
    cabin.position.set(0, 1.26, -0.35);
    cabin.castShadow = true;
    group.add(cabin);
    const roofGeo = new THREE.BoxGeometry(W - 0.2, 0.06, 2.5);
    const roof = new THREE.Mesh(roofGeo, paint);
    roof.position.set(0, 1.57, -0.4);
    group.add(roof);
    const pillarGeo = new THREE.BoxGeometry(W - 0.2, 0.56, 0.1);
    for (const z of [0.98, -0.3, -1.68]) {
      const p = new THREE.Mesh(pillarGeo, paint);
      p.position.set(0, 1.26, z);
      p.scale.x = 1.005;
      group.add(p);
    }
    const barGeo = new THREE.BoxGeometry(1.2, 0.12, 0.3);
    const bar = new THREE.Mesh(barGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.4 }));
    bar.position.set(0, 1.66, -0.2);
    group.add(bar);
    const blueMat = [0, 1].map(() => new THREE.MeshBasicMaterial({ color: 0x0a1a66 }));
    const lightGeo = new THREE.BoxGeometry(0.5, 0.13, 0.31);
    blueMat.forEach((m, i) => {
      const l = new THREE.Mesh(lightGeo, m);
      l.position.set(i ? 0.34 : -0.34, 1.67, -0.2);
      group.add(l);
    });
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const z of [L / 2 - 0.82, L / 2 - 3.72]) {
      for (const x of [-1, 1]) {
        const w = new THREE.Mesh(wheelGeo, this.wheelMat);
        w.position.set(x * (W / 2 - 0.12), 0.34, z);
        group.add(w);
      }
    }
    const glow = new THREE.PointLight(0x2a5cff, 0, 26, 1.6);
    glow.position.set(0, 2.1, 0);
    group.add(glow);
    this.disposables.push(lowerGeo, cabinGeo, roofGeo, pillarGeo, barGeo, lightGeo, wheelGeo);
    const setLights = (on: boolean, t: number) => {
      const ph = Math.floor(t * 9) % 2;
      blueMat[0].color.setHex(on && ph === 0 ? 0x4d8bff : 0x0a1a66);
      blueMat[1].color.setHex(on && ph === 1 ? 0x4d8bff : 0x0a1a66);
      glow.intensity = on ? 60 : 0;
    };
    return { group, setLights };
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    for (const pair of this.sideMats) pair.forEach((m) => m.dispose());
    this.endMats.forEach((p) => p.forEach((m) => m.dispose()));
    this.roof.dispose();
    this.under.dispose();
    this.wheelMat.dispose();
    this.hubMat.dispose();
  }
}
