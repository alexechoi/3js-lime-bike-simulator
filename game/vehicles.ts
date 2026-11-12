import * as THREE from "three";

// London double-decker and a Met Police area car. Both face +Z; with the
// scene's axes the nearside (kerb side, left-hand traffic) is +X.

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

const RED = "#c8161d"; // London bus red
const RED_DARK = "#9d1016";
const BLACK = "#0b0c0e";

function glassFill(c: CanvasRenderingContext2D, y: number, h: number) {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#2b3944");
  g.addColorStop(0.45, "#141b21");
  g.addColorStop(1, "#0b0f13");
  return g;
}

/**
 * Side of a New Routemaster-style double-decker: long shallow upper-deck
 * glazing, black lower saloon glass, and the dark ribbon that climbs the
 * rear staircase. 125 px per metre; `frontLeft` puts the front at the left.
 */
function busSide(nearside: boolean, frontLeft: boolean, advert: number): THREE.CanvasTexture {
  const W = 1400, H = 548;
  const [cv, c] = canvas(W, H);
  const X = (m: number) => (frontLeft ? m : BUS.length - m) * 125;
  const span = (m0: number, m1: number): [number, number] => {
    const a = X(m0), b = X(m1);
    return [Math.min(a, b), Math.abs(b - a)];
  };
  c.fillStyle = RED;
  c.fillRect(0, 0, W, H);
  // white roof and the shadow line of the gutter
  c.fillStyle = "#ecebe6";
  c.fillRect(0, 0, W, 22);
  c.fillStyle = "rgba(0,0,0,0.28)";
  c.fillRect(0, 22, W, 3);
  // upper deck: one long band of glass with slim pillars
  const [ux, uw] = span(0.35, BUS.length - 0.5);
  c.fillStyle = BLACK;
  rr(c, ux - 6, 58, uw + 12, 112, 30);
  c.fillStyle = glassFill(c, 64, 100);
  rr(c, ux, 64, uw, 100, 26);
  c.fillStyle = BLACK;
  for (let m = 1.75; m < BUS.length - 1.0; m += 1.48) c.fillRect(X(m) - 5, 58, 10, 112);
  // cant rail: body colour between the decks, with the advert frame
  const [abg, afg, atext] = ADVERTS[advert % ADVERTS.length];
  const [ax, aw] = span(2.4, 8.6);
  c.fillStyle = "#1a1a1c";
  c.fillRect(ax - 4, 190, aw + 8, 66);
  c.fillStyle = abg;
  c.fillRect(ax, 194, aw, 58);
  c.fillStyle = afg;
  c.font = `700 30px ${SANS}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(atext, ax + aw / 2, 224, aw - 30);
  // lower saloon glazing
  const lowFrom = nearside ? 1.95 : 1.25, lowTo = nearside ? 8.9 : 9.3;
  const [lx, lw] = span(lowFrom, lowTo);
  c.fillStyle = BLACK;
  rr(c, lx - 6, 274, lw + 12, 142, 22);
  c.fillStyle = glassFill(c, 280, 130);
  rr(c, lx, 280, lw, 130, 18);
  c.fillStyle = BLACK;
  for (let m = lowFrom + 1.4; m < lowTo - 0.6; m += 1.48) c.fillRect(X(m) - 5, 274, 10, 142);
  // the glazed ribbon up the rear staircase: lower window line to upper, rising towards the back
  c.fillStyle = BLACK;
  c.beginPath();
  c.moveTo(X(lowTo - 0.4), 416);
  c.lineTo(X(lowTo - 0.4), 274);
  c.lineTo(X(BUS.length - 0.55), 64);
  c.lineTo(X(BUS.length - 0.3), 64);
  c.lineTo(X(BUS.length - 0.3), 250);
  c.lineTo(X(lowTo + 0.75), 416);
  c.closePath();
  c.fill();
  c.fillStyle = "#18222a";
  c.beginPath();
  c.moveTo(X(lowTo - 0.25), 404);
  c.lineTo(X(lowTo - 0.25), 290);
  c.lineTo(X(BUS.length - 0.6), 84);
  c.lineTo(X(BUS.length - 0.42), 84);
  c.lineTo(X(BUS.length - 0.42), 240);
  c.lineTo(X(lowTo + 0.6), 404);
  c.closePath();
  c.fill();
  if (nearside) {
    // three sets of doors: front, centre, rear platform
    for (const [d0, d1] of [[0.6, 1.8], [5.0, 6.3], [9.35, 10.55]]) {
      const [dx, dw] = span(d0, d1);
      c.fillStyle = BLACK;
      rr(c, dx - 7, 262, dw + 14, 240, 10);
      c.fillStyle = glassFill(c, 270, 222);
      c.fillRect(dx, 270, dw / 2 - 4, 222);
      c.fillRect(dx + dw / 2 + 4, 270, dw / 2 - 4, 222);
      c.fillStyle = "#e9c400";
      c.fillRect(dx, 484, dw, 8);
      c.fillStyle = "rgba(255,255,255,0.5)";
      c.fillRect(dx + dw / 2 - 16, 330, 6, 110);
      c.fillRect(dx + dw / 2 + 10, 330, 6, 110);
    }
  } else {
    // driver's cab side window, dropping lower than the saloon glass
    const [dx, dw] = span(0.3, 1.15);
    c.fillStyle = BLACK;
    rr(c, dx - 6, 256, dw + 12, 190, 14);
    c.fillStyle = glassFill(c, 262, 178);
    rr(c, dx, 262, dw, 178, 10);
    // emergency door outline and filler flaps
    c.strokeStyle = "rgba(0,0,0,0.3)";
    c.lineWidth = 2;
    const [ex, ew] = span(9.5, 10.5);
    c.strokeRect(ex, 300, ew, 180);
    const [fx, fw] = span(3.4, 3.9);
    c.strokeRect(fx, 440, fw, 44);
  }
  // skirt panels with seams, wheel arches
  c.fillStyle = RED_DARK;
  c.fillRect(0, 500, W, 48);
  c.strokeStyle = "rgba(0,0,0,0.28)";
  c.lineWidth = 2;
  for (let m = 0.9; m < BUS.length; m += 1.48) {
    c.beginPath();
    c.moveTo(X(m), 424);
    c.lineTo(X(m), 548);
    c.stroke();
  }
  for (const m of [2.35, 8.55]) {
    const cx = X(m);
    c.fillStyle = BLACK;
    c.beginPath();
    c.arc(cx, 548, 82, Math.PI, 0);
    c.fill();
    c.strokeStyle = "rgba(0,0,0,0.35)";
    c.lineWidth = 5;
    c.beginPath();
    c.arc(cx, 548, 88, Math.PI, 0);
    c.stroke();
  }
  // roundel and legal lettering
  const rx = X(nearside ? 3.6 : 4.4);
  c.strokeStyle = "#ffffff";
  c.lineWidth = 7;
  c.beginPath();
  c.arc(rx, 462, 19, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = "#ffffff";
  c.fillRect(rx - 32, 456, 64, 12);
  c.fillStyle = RED;
  c.font = `700 9px ${SANS}`;
  c.textAlign = "center";
  c.fillText("LONDON BUSES", rx, 462.5);
  c.fillStyle = "rgba(255,255,255,0.92)";
  c.font = `700 20px ${SANS}`;
  c.fillText("LT 159", X(nearside ? 7.4 : 2.6), 462);
  // road dirt thrown up along the skirt
  const g = c.createLinearGradient(0, 420, 0, H);
  g.addColorStop(0, "rgba(50,35,25,0)");
  g.addColorStop(1, "rgba(50,35,25,0.42)");
  c.fillStyle = g;
  c.fillRect(0, 420, W, H - 420);
  return finish(cv);
}

function busEnd(front: boolean, route: string): THREE.CanvasTexture {
  const W = 320, H = 548;
  const [cv, c] = canvas(W, H);
  c.fillStyle = RED;
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#ecebe6";
  c.fillRect(0, 0, W, 22);
  const white = "#f4f1e6";
  if (front) {
    // upper-deck windscreen, wrapping round the corners
    c.fillStyle = BLACK;
    rr(c, 8, 44, W - 16, 126, 30);
    c.fillStyle = glassFill(c, 50, 114);
    rr(c, 14, 50, W - 28, 114, 26);
    // destination blind: number, then where it is going
    c.fillStyle = BLACK;
    rr(c, 22, 184, W - 44, 74, 10);
    c.fillStyle = white;
    c.textBaseline = "middle";
    c.textAlign = "left";
    c.font = `800 54px ${SANS}`;
    c.fillText(route, 34, 223);
    const nw = c.measureText(route).width;
    c.font = `700 24px ${SANS}`;
    const dest = DESTINATIONS[route] ?? "Oxford Circus";
    const words = dest.split(" ");
    if (words.length > 1 && c.measureText(dest).width > W - 80 - nw) {
      const half = Math.ceil(words.length / 2);
      c.fillText(words.slice(0, half).join(" "), 46 + nw, 208, W - 84 - nw);
      c.fillText(words.slice(half).join(" "), 46 + nw, 238, W - 84 - nw);
    } else c.fillText(dest, 46 + nw, 223, W - 84 - nw);
    // driver's windscreen: asymmetric, sweeping lower on the nearside (viewer's right)
    c.fillStyle = BLACK;
    c.beginPath();
    c.moveTo(10, 272);
    c.lineTo(W - 10, 272);
    c.lineTo(W - 10, 452);
    c.quadraticCurveTo(W - 14, 470, W - 40, 470);
    c.lineTo(150, 440);
    c.lineTo(34, 428);
    c.quadraticCurveTo(10, 426, 10, 404);
    c.closePath();
    c.fill();
    c.fillStyle = glassFill(c, 280, 180);
    c.beginPath();
    c.moveTo(18, 280);
    c.lineTo(W - 18, 280);
    c.lineTo(W - 18, 446);
    c.quadraticCurveTo(W - 20, 460, W - 42, 460);
    c.lineTo(152, 431);
    c.lineTo(38, 419);
    c.quadraticCurveTo(18, 417, 18, 400);
    c.closePath();
    c.fill();
    c.strokeStyle = "#05070a";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(70, 440);
    c.lineTo(120, 300);
    c.moveTo(210, 452);
    c.lineTo(250, 310);
    c.stroke(); // wipers
    // light clusters and the roundel
    for (const x of [40, W - 40]) {
      c.fillStyle = BLACK;
      c.beginPath();
      c.arc(x, 492, 24, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#fff8dc";
      c.beginPath();
      c.arc(x, 492, 15, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#ffb020";
      c.beginPath();
      c.arc(x + (x < 160 ? 30 : -30), 500, 8, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = white;
    c.lineWidth = 6;
    c.beginPath();
    c.arc(W / 2, 482, 15, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = white;
    c.fillRect(W / 2 - 26, 477, 52, 10);
    c.fillStyle = "#f4f4f0";
    c.fillRect(W / 2 - 50, 512, 100, 24);
    c.fillStyle = "#111";
    c.font = `700 18px ${SANS}`;
    c.textAlign = "center";
    c.fillText("LTZ 1159", W / 2, 525);
  } else {
    // rear: upper window, the stair ribbon coming round the offside corner, engine doors
    c.fillStyle = BLACK;
    rr(c, 8, 44, W - 16, 126, 30);
    c.fillStyle = glassFill(c, 50, 114);
    rr(c, 14, 50, W - 28, 114, 26);
    c.fillStyle = BLACK;
    c.beginPath();
    c.moveTo(W - 8, 60);
    c.lineTo(W - 96, 60);
    c.lineTo(W - 150, 410);
    c.lineTo(W - 8, 410);
    c.closePath();
    c.fill();
    c.fillStyle = "#18222a";
    c.beginPath();
    c.moveTo(W - 18, 176);
    c.lineTo(W - 104, 176);
    c.lineTo(W - 136, 398);
    c.lineTo(W - 18, 398);
    c.closePath();
    c.fill();
    c.fillStyle = BLACK;
    rr(c, 26, 188, 120, 66, 8);
    c.fillStyle = white;
    c.font = `800 50px ${SANS}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(route, 86, 223);
    // engine cover with louvres
    c.fillStyle = RED_DARK;
    rr(c, 22, 276, 132, 180, 8);
    c.strokeStyle = "rgba(0,0,0,0.4)";
    c.lineWidth = 3;
    for (let y = 296; y < 446; y += 13) {
      c.beginPath();
      c.moveTo(34, y);
      c.lineTo(142, y);
      c.stroke();
    }
    for (const x of [16, W - 16]) {
      c.fillStyle = "#ff2a1a";
      rr(c, x - 9, 420, 18, 64, 8);
      c.fillStyle = "#ffa000";
      rr(c, x - 9, 394, 18, 22, 6);
    }
    c.fillStyle = "#f2d600";
    c.fillRect(W / 2 - 50, 500, 100, 24);
    c.fillStyle = "#111";
    c.font = `700 18px ${SANS}`;
    c.fillText("LTZ 1159", W / 2, 513);
  }
  const g = c.createLinearGradient(0, 440, 0, H);
  g.addColorStop(0, "rgba(50,35,25,0)");
  g.addColorStop(1, "rgba(50,35,25,0.35)");
  c.fillStyle = g;
  c.fillRect(0, 440, W, H - 440);
  return finish(cv);
}

/**
 * The body shell: a rounded cross-section lofted along the bus, pinched and
 * tucked in at both ends so nothing about it is a flat box.
 * Groups: 0 nearside (+x), 1 offside (-x), 2 front, 3 rear.
 */
function busShell(): THREE.BufferGeometry {
  const W = BUS.width / 2, y0 = 0.3, y1 = BUS.height, L = BUS.length / 2;
  // half profile from bottom centre up the +x side to top centre
  const prof: [number, number][] = [];
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      prof.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  prof.push([0, y0]);
  arc(W - 0.1, y0 + 0.1, 0.1, -Math.PI / 2, 0, 3);
  prof.push([W + 0.012, y0 + 1.2]); // slight tumblehome: widest at the waist
  prof.push([W, 2.35]);
  prof.push([W - 0.03, 3.4]);
  arc(W - 0.03 - 0.34, y1 - 0.34, 0.34, 0, Math.PI / 2, 6);
  prof.push([0, y1 + 0.03]); // crowned roof
  // stations: [z, width scale, height offset at the top]
  const st: [number, number][] = [
    [-L, 0.9], [-L + 0.1, 0.955], [-L + 0.3, 0.99], [-L + 0.7, 1],
    [L - 0.8, 1], [L - 0.35, 0.985], [L - 0.12, 0.95], [L, 0.89],
  ];
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const groups: number[][] = [[], [], [], []];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (const [z, sc] of st) {
      for (const [x, y] of prof) {
        pos.push(x * sc * side, y, z);
        const u = side > 0 ? (L - z) / (2 * L) : (z + L) / (2 * L);
        uv.push(u, (y - y0) / (y1 - y0));
      }
    }
    const n = prof.length;
    for (let i = 0; i < st.length - 1; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = base + i * n + j, b = a + 1, c2 = a + n, d = c2 + 1;
        if (side > 0) groups[0].push(a, b, c2, b, d, c2);
        else groups[1].push(a, c2, b, b, c2, d);
      }
    }
  }
  // end caps
  for (const end of [1, -1]) {
    const sc = end > 0 ? st[st.length - 1][1] : st[0][1];
    const z = end * L;
    const base = pos.length / 3;
    const ring: [number, number][] = [...prof, ...prof.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])];
    pos.push(0, (y0 + y1) / 2, z + end * 0.06);
    uv.push(0.5, 0.5);
    for (const [x, y] of ring) {
      pos.push(x * sc, y, z);
      // seen from outside: at the front +x (nearside) is on the viewer's right
      uv.push(end > 0 ? 0.5 + (x * sc) / (2 * W) : 0.5 - (x * sc) / (2 * W), (y - y0) / (y1 - y0));
    }
    for (let i = 0; i < ring.length; i++) {
      const a = base + 1 + i, b = base + 1 + ((i + 1) % ring.length);
      if (end > 0) groups[2].push(base, a, b);
      else groups[3].push(base, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  let off = 0;
  groups.forEach((gr, i) => {
    idx.push(...gr);
    g.addGroup(off, gr.length, i);
    off += gr.length;
  });
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class VehicleFactory {
  private disposables: { dispose: () => void }[] = [];
  private sideMats: THREE.Material[][] = [];
  private endMats = new Map<string, [THREE.Material, THREE.Material]>();
  private roof: THREE.Material;
  private under: THREE.Material;
  private busGeo: THREE.BufferGeometry;
  private unitBox!: THREE.BufferGeometry;
  private lampGeo!: THREE.BufferGeometry;
  private lampMat!: THREE.Material;
  private glass!: THREE.Material;
  private steel!: THREE.Material;
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
    this.busGeo = busShell();
    this.unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.lampGeo = new THREE.SphereGeometry(0.13, 12, 8);
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 0.9, roughness: 0.2 });
    this.glass = new THREE.MeshPhysicalMaterial({ color: 0x8fa3b3, roughness: 0.04, metalness: 1, envMapIntensity: 1.5, transparent: true, opacity: 0.32, depthWrite: false });
    this.steel = new THREE.MeshStandardMaterial({ color: 0x9a9da0, roughness: 0.35, metalness: 0.8 });
    this.wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 18);
    this.wheelGeo.rotateZ(Math.PI / 2);
    this.wheelMat = new THREE.MeshStandardMaterial({ color: 0x101011, roughness: 0.95 });
    this.hubMat = new THREE.MeshStandardMaterial({ color: 0xa3141a, roughness: 0.45, metalness: 0.2 });
    this.disposables.push(this.busGeo, this.wheelGeo, this.unitBox, this.lampGeo, this.lampMat, this.glass, this.steel);
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
      return [sides[0], sides[1], f, b]; // shell groups: nearside, offside, front, rear
    };
    const body = new THREE.Mesh(this.busGeo, mats(route));
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const L = BUS.length / 2, W = BUS.width / 2;
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      group.add(m);
      return m;
    };
    // undertray, so the wheels sit in shadowed arches rather than under a floating box
    part(this.unitBox, this.under, 0, 0.42, 0, BUS.width - 0.5, 0.3, BUS.length - 0.6);
    for (const z of [L - 2.35, L - 8.55]) {
      for (const x of [-1, 1]) {
        part(this.wheelGeo, this.wheelMat, x * (W - 0.19), 0.5, z);
        part(this.wheelGeo, this.hubMat, x * (W - 0.02), 0.5, z, 0.12, 0.62, 0.62);
        part(this.wheelGeo, this.steel, x * (W + 0.005), 0.5, z, 0.1, 0.22, 0.22);
      }
    }
    // glass that actually reflects the street: both decks, both sides, both ends
    for (const x of [-1, 1]) {
      part(this.unitBox, this.glass, x * (W - 0.005), 3.42, -0.05, 0.03, 0.72, BUS.length - 1.5);
      part(this.unitBox, this.glass, x * (W + 0.008), 1.76, x > 0 ? 0.15 : 0.35, 0.03, 0.9, x > 0 ? 2.9 : 7.6);
      if (x > 0) part(this.unitBox, this.glass, x * (W + 0.008), 1.76, -2.1, 0.03, 0.9, 2.3);
      // mirrors on their arms
      part(this.unitBox, this.under, x * (W + 0.16), 3.0, L - 0.05, 0.32, 0.05, 0.05);
      part(this.unitBox, this.under, x * (W + 0.32), 2.72, L - 0.02, 0.07, 0.56, 0.24);
    }
    part(this.unitBox, this.glass, 0, 3.42, L - 0.03, BUS.width - 0.5, 0.74, 0.05);
    part(this.unitBox, this.glass, 0.05, 1.72, L - 0.02, BUS.width - 0.42, 1.0, 0.05);
    part(this.unitBox, this.glass, 0, 3.42, -L + 0.03, BUS.width - 0.5, 0.74, 0.05);
    // bumper, tow-eye cover, rooftop pods
    part(this.unitBox, this.under, 0, 0.47, L + 0.03, BUS.width - 0.36, 0.26, 0.16);
    part(this.unitBox, this.under, 0, 0.47, -L - 0.03, BUS.width - 0.36, 0.26, 0.16);
    part(this.unitBox, this.roof, 0, BUS.height + 0.1, -1.2, 1.5, 0.16, 2.6);
    part(this.unitBox, this.roof, 0, BUS.height + 0.08, 2.6, 1.3, 0.12, 1.2);
    // headlights that glow a little
    for (const x of [-1, 1]) part(this.lampGeo, this.lampMat, x * (W - 0.34), 0.82, L - 0.02, 1, 1, 0.35);
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
