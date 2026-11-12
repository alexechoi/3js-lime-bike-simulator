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

/** One cross-section of a lofted body: a rounded trapezoid. */
interface Station {
  z: number;
  wb: number; // half-width at the bottom
  wt: number; // half-width at the top
  y0: number;
  y1: number;
  r: number; // top corner radius
}

/** Skin a row of cross-sections into a smooth closed shell (front is +z). */
function loft(st: Station[]): THREE.BufferGeometry {
  const N = 5; // points per rounded corner
  const ring = (s: Station): [number, number][] => {
    const pts: [number, number][] = [];
    const r = Math.min(s.r, (s.y1 - s.y0) * 0.49, s.wt * 0.9);
    const rb = Math.min(0.05, (s.y1 - s.y0) * 0.3);
    pts.push([0, s.y0]);
    pts.push([s.wb - rb, s.y0]);
    pts.push([s.wb, s.y0 + rb]);
    const lean = (s.wt - s.wb);
    pts.push([s.wb + lean * 0.5, (s.y0 + s.y1) / 2]);
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * (Math.PI / 2);
      pts.push([s.wt - r + Math.cos(a) * r, s.y1 - r + Math.sin(a) * r]);
    }
    pts.push([0, s.y1 + 0.012]);
    return pts;
  };
  const pos: number[] = [], idx: number[] = [];
  const half = ring(st[0]).length;
  const per = half * 2 - 2;
  for (const s of st) {
    const h = ring(s);
    const full = [...h, ...h.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])];
    for (const [x, y] of full) pos.push(x, y, s.z);
  }
  for (let i = 0; i < st.length - 1; i++) {
    for (let j = 0; j < per; j++) {
      const a = i * per + j, b = i * per + ((j + 1) % per), c = a + per, d = b + per;
      idx.push(a, b, c, b, d, c);
    }
  }
  // close both ends with a fan
  for (const end of [0, st.length - 1]) {
    const s = st[end];
    const ci = pos.length / 3;
    pos.push(0, (s.y0 + s.y1) / 2, s.z + (end ? 0.03 : -0.03));
    for (let j = 0; j < per; j++) {
      const a = end * per + j, b = end * per + ((j + 1) % per);
      if (end) idx.push(ci, a, b);
      else idx.push(ci, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

type CarKind = "taxi" | "van" | "car" | "estate";

interface CarSpec {
  length: number;
  width: number;
  wheelR: number;
  axles: [number, number]; // z of rear and front axle
  body: Station[];
  cabin: Station[]; // glazed
  roof: Station[]; // painted lid on the cabin
  pillars: number[]; // z positions of the painted pillars
  belt: number; // waistline height
  top: number;
}

const S = (z: number, wb: number, wt: number, y0: number, y1: number, r: number): Station => ({ z, wb, wt, y0, y1, r });

const CAR_SPECS: Record<CarKind, CarSpec> = {
  // five-door hatchback
  car: {
    length: 4.15, width: 1.78, wheelR: 0.31, axles: [-1.28, 1.3], belt: 0.95, top: 1.46, pillars: [-1.25, -0.25, 0.62],
    body: [S(-2.07, 0.6, 0.56, 0.42, 0.74, 0.1), S(-1.98, 0.84, 0.8, 0.3, 0.93, 0.14), S(-1.3, 0.89, 0.86, 0.27, 0.97, 0.12), S(0.2, 0.89, 0.86, 0.27, 0.96, 0.12),
      S(1.05, 0.88, 0.85, 0.27, 0.92, 0.14), S(1.7, 0.85, 0.8, 0.28, 0.83, 0.16), S(1.98, 0.76, 0.7, 0.32, 0.72, 0.14), S(2.07, 0.58, 0.52, 0.4, 0.62, 0.1)],
    cabin: [S(-1.86, 0.78, 0.62, 0.9, 0.96, 0.03), S(-1.5, 0.8, 0.66, 0.92, 1.4, 0.12), S(-0.5, 0.81, 0.68, 0.92, 1.44, 0.12), S(0.35, 0.81, 0.67, 0.92, 1.41, 0.12), S(1.08, 0.79, 0.63, 0.9, 0.96, 0.03)],
    roof: [S(-1.56, 0.67, 0.64, 1.38, 1.43, 0.04), S(-0.5, 0.7, 0.67, 1.42, 1.47, 0.04), S(0.42, 0.68, 0.65, 1.39, 1.44, 0.04)],
  },
  // London black cab: tall, upright, long glasshouse, stubby bonnet
  taxi: {
    length: 4.6, width: 1.86, wheelR: 0.33, axles: [-1.45, 1.45], belt: 1.08, top: 1.84, pillars: [-1.5, -0.35, 0.72],
    body: [S(-2.3, 0.66, 0.6, 0.45, 0.9, 0.1), S(-2.2, 0.88, 0.84, 0.32, 1.04, 0.12), S(-1.4, 0.92, 0.89, 0.28, 1.09, 0.1), S(0.5, 0.92, 0.89, 0.28, 1.08, 0.1),
      S(1.2, 0.9, 0.86, 0.28, 1.04, 0.14), S(1.9, 0.86, 0.8, 0.3, 0.98, 0.18), S(2.2, 0.78, 0.7, 0.34, 0.88, 0.16), S(2.3, 0.6, 0.52, 0.42, 0.74, 0.1)],
    cabin: [S(-2.12, 0.82, 0.74, 1.02, 1.1, 0.03), S(-1.95, 0.84, 0.78, 1.04, 1.74, 0.16), S(-0.6, 0.85, 0.8, 1.04, 1.8, 0.16), S(0.55, 0.85, 0.79, 1.04, 1.78, 0.16), S(1.18, 0.82, 0.72, 1.0, 1.08, 0.03)],
    roof: [S(-2.0, 0.79, 0.76, 1.71, 1.77, 0.05), S(-0.6, 0.81, 0.78, 1.77, 1.84, 0.05), S(0.62, 0.8, 0.77, 1.75, 1.81, 0.05)],
  },
  // panel van: cargo box behind a raked cab
  van: {
    length: 5.1, width: 2.0, wheelR: 0.35, axles: [-1.55, 1.75], belt: 1.2, top: 2.02, pillars: [0.72],
    body: [S(-2.55, 0.9, 0.84, 0.36, 1.94, 0.12), S(-2.45, 0.98, 0.93, 0.3, 2.0, 0.14), S(0.7, 0.98, 0.93, 0.3, 2.02, 0.14), S(0.95, 0.98, 0.9, 0.3, 1.98, 0.16),
      S(1.55, 0.96, 0.84, 0.3, 1.26, 0.2), S(2.2, 0.92, 0.82, 0.3, 1.1, 0.2), S(2.46, 0.84, 0.74, 0.34, 0.92, 0.16), S(2.55, 0.66, 0.56, 0.42, 0.76, 0.1)],
    cabin: [S(0.92, 0.9, 0.82, 1.22, 1.94, 0.14), S(1.3, 0.9, 0.8, 1.22, 1.6, 0.12), S(1.62, 0.89, 0.78, 1.2, 1.26, 0.03)],
    roof: [],
  },
  // estate car, for the police
  estate: {
    length: 4.75, width: 1.86, wheelR: 0.33, axles: [-1.42, 1.48], belt: 0.98, top: 1.5, pillars: [-1.75, -0.6, 0.45],
    body: [S(-2.37, 0.62, 0.58, 0.42, 0.78, 0.1), S(-2.27, 0.88, 0.84, 0.3, 0.96, 0.14), S(-1.4, 0.93, 0.9, 0.27, 1.0, 0.12), S(0.3, 0.93, 0.9, 0.27, 0.99, 0.12),
      S(1.2, 0.92, 0.88, 0.27, 0.94, 0.14), S(1.95, 0.88, 0.82, 0.28, 0.85, 0.16), S(2.27, 0.78, 0.7, 0.32, 0.74, 0.14), S(2.37, 0.6, 0.52, 0.4, 0.64, 0.1)],
    cabin: [S(-2.25, 0.82, 0.7, 0.94, 1.0, 0.03), S(-2.02, 0.84, 0.72, 0.95, 1.42, 0.12), S(-0.6, 0.85, 0.73, 0.95, 1.48, 0.12), S(0.35, 0.85, 0.72, 0.95, 1.45, 0.12), S(1.15, 0.82, 0.66, 0.92, 0.99, 0.03)],
    roof: [S(-2.06, 0.73, 0.7, 1.4, 1.45, 0.04), S(-0.6, 0.75, 0.72, 1.46, 1.51, 0.04), S(0.42, 0.73, 0.7, 1.43, 1.48, 0.04)],
  },
};

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
  private carGeos = new Map<string, { body: THREE.BufferGeometry; cabin: THREE.BufferGeometry; roof: THREE.BufferGeometry | null }>();
  private seam!: THREE.Material;
  private amber!: THREE.Material;
  private reverse!: THREE.Material;
  private taxiText!: THREE.Material;
  private taxiLicence!: THREE.Material;
  private serial = 0;
  private arch!: THREE.Material;
  private grille!: THREE.Material;
  private plateF!: THREE.Material;
  private plateR!: THREE.Material;
  private carGlass!: THREE.Material;
  private taxiLight!: THREE.Material;
  private tailMat!: THREE.Material;
  private stripeMats: THREE.Material[] = [];
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
    this.carGlass = new THREE.MeshPhysicalMaterial({ color: 0x55636e, roughness: 0.04, metalness: 1, envMapIntensity: 1.7, emissive: 0x141d25, emissiveIntensity: 0.7 });
    this.taxiLight = new THREE.MeshBasicMaterial({ color: 0xffb21a });
    this.seam = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 });
    this.arch = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 1 });
    this.grille = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.5, metalness: 0.4 });
    this.plateF = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 });
    this.plateR = new THREE.MeshStandardMaterial({ color: 0xe9c800, roughness: 0.5 });
    this.disposables.push(this.seam, this.arch, this.grille, this.plateF, this.plateR);
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0xd0100c, emissive: 0xff1a10, emissiveIntensity: 0.9, roughness: 0.25 });
    this.amber = new THREE.MeshStandardMaterial({ color: 0xff9a1a, emissive: 0xff8a00, emissiveIntensity: 0.35, roughness: 0.3 });
    this.reverse = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.3 });
    this.taxiText = this.decal(["TAXI"], "#ffb21a", "#111111", 256, 72);
    this.taxiLicence = this.decal(["TfL", "LICENSED"], "#f4f4ee", "#0b1a4a", 128, 116);
    this.disposables.push(this.amber, this.reverse, this.plane);
    this.stripeMats = [0x1d5fa8, 0xd9861a, 0x1f7a4a, 0x7a1f2b].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    this.disposables.push(this.carGlass, this.taxiLight, this.tailMat, ...this.stripeMats);
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

  private plateMats = new Map<string, THREE.Material>();
  private plane = new THREE.PlaneGeometry(1, 1);

  /** UK registration plate: white at the front, yellow at the rear, black characters. */
  private plate(reg: string, rear: boolean): THREE.Material {
    const key = reg + (rear ? "r" : "f");
    let m = this.plateMats.get(key);
    if (!m) {
      const [cv, c] = canvas(260, 56);
      c.fillStyle = rear ? "#f6d200" : "#f7f7f3";
      rr(c, 0, 0, 260, 56, 7);
      c.strokeStyle = "rgba(0,0,0,0.55)";
      c.lineWidth = 2;
      c.strokeRect(3, 3, 254, 50);
      c.fillStyle = "#1e3a8a";
      c.fillRect(4, 4, 24, 48);
      c.fillStyle = "#ffffff";
      c.font = `700 11px ${SANS}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("UK", 16, 40);
      c.fillStyle = "#0b0b0b";
      c.font = `800 42px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
      c.fillText(reg, 144, 31, 220);
      const t = finish(cv);
      m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.45 });
      this.plateMats.set(key, m);
      this.disposables.push(t, m);
    }
    return m;
  }

  /** Lettering or livery painted on a body panel. */
  private decal(lines: string[], bg: string | null, fg: string, w = 512, h = 128): THREE.Material {
    const [cv, c] = canvas(w, h);
    if (bg) {
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
    }
    c.fillStyle = fg;
    c.textAlign = "center";
    c.textBaseline = "middle";
    lines.forEach((ln, i) => {
      const big = i === 0;
      c.font = `${big ? 800 : 600} ${big ? h * 0.42 : h * 0.2}px ${SANS}`;
      c.fillText(ln, w / 2, big ? h * (lines.length > 1 ? 0.38 : 0.52) : h * 0.78, w - 24);
    });
    const t = finish(cv);
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, transparent: !bg, alphaTest: bg ? 0 : 0.3 });
    this.disposables.push(t, m);
    return m;
  }

  private carParts(kind: CarKind) {
    let p = this.carGeos.get(kind);
    if (!p) {
      const spec = CAR_SPECS[kind];
      p = { body: loft(spec.body), cabin: loft(spec.cabin), roof: spec.roof.length ? loft(spec.roof) : null };
      this.carGeos.set(kind, p);
      this.disposables.push(p.body, p.cabin);
      if (p.roof) this.disposables.push(p.roof);
    }
    return p;
  }

  /** A complete car: painted shell, glazed cabin, pillars, arches, wheels, lamps, grille, plates. */
  private buildCar(kind: CarKind, paint: THREE.Material, reg: string): THREE.Group {
    const spec = CAR_SPECS[kind];
    const parts = this.carParts(kind);
    const group = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, shadow = false) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = shadow;
      group.add(m);
      return m;
    };
    const body = add(parts.body, paint, 0, 0, 0, 1, 1, 1, true);
    body.receiveShadow = true;
    add(parts.cabin, this.carGlass, 0, 0, 0, 1, 1, 1, true);
    if (parts.roof) add(parts.roof, paint, 0, 0, 0);
    const hw = spec.width / 2, half = spec.length / 2;
    // pillars and the door shut lines
    for (const z of spec.pillars) {
      for (const s of [-1, 1]) {
        const p = add(this.unitBox, paint, s * (hw - 0.115), (spec.belt + spec.top) / 2 - 0.03, z, 0.05, spec.top - spec.belt - 0.04, 0.09);
        p.rotation.z = s * 0.2;
        add(this.unitBox, this.seam, s * (hw + 0.004), spec.belt * 0.62, z, 0.012, spec.belt * 0.62, 0.012);
      }
    }
    // black sill and bumpers ground the body
    add(this.unitBox, this.under, 0, 0.3, 0, spec.width - 0.1, 0.14, spec.length - 1.0);
    add(this.unitBox, this.under, 0, 0.4, half - 0.06, spec.width - 0.5, 0.18, 0.12);
    add(this.unitBox, this.under, 0, 0.42, -half + 0.06, spec.width - 0.5, 0.18, 0.12);
    // wheels in dark arches
    for (const az of spec.axles) {
      for (const s of [-1, 1]) {
        add(this.wheelGeo, this.arch, s * (hw - 0.1), spec.wheelR + 0.02, az, 0.5, (spec.wheelR + 0.09) / 0.5, (spec.wheelR + 0.09) / 0.5);
        add(this.wheelGeo, this.wheelMat, s * (hw - 0.07), spec.wheelR, az, 0.62, spec.wheelR / 0.5, spec.wheelR / 0.5, true);
        add(this.wheelGeo, this.steel, s * (hw + 0.03), spec.wheelR, az, 0.06, (spec.wheelR * 0.62) / 0.5, (spec.wheelR * 0.62) / 0.5);
      }
    }
    // face: lamps, indicators, grille, plate
    const noseY = kind === "van" ? 0.86 : kind === "taxi" ? 0.8 : 0.66;
    const tall = kind === "van" || kind === "taxi";
    for (const s of [-1, 1]) {
      add(this.lampGeo, this.lampMat, s * (hw - 0.36), noseY, half - 0.1, 1.25, 0.62, 0.5);
      add(this.unitBox, this.amber, s * (hw - 0.16), noseY - 0.02, half - 0.2, 0.1, 0.08, 0.16);
      // tail-light cluster: red, with amber indicator and white reversing lamp
      const ty = kind === "van" ? 1.2 : spec.belt - 0.16;
      const th = tall ? 0.46 : 0.16, tw = tall ? 0.13 : 0.3;
      add(this.unitBox, this.tailMat, s * (hw - 0.2), ty, -half + 0.015, tw, th, 0.07);
      add(this.unitBox, this.amber, s * (hw - 0.2), ty + (tall ? th / 2 + 0.06 : 0), -half + 0.012, tall ? tw : 0.09, tall ? 0.1 : th * 0.7, 0.07).position.x += tall ? 0 : s * -0.2;
      add(this.unitBox, this.reverse, s * (hw - 0.2), ty - (tall ? th / 2 + 0.05 : 0), -half + 0.012, tall ? tw : 0.07, tall ? 0.08 : th * 0.6, 0.07).position.x += tall ? 0 : s * -0.29;
      // door mirrors and handles
      const mz = kind === "van" ? 1.5 : spec.cabin[spec.cabin.length - 1].z - 0.12;
      add(this.unitBox, paint, s * (hw + 0.1), spec.belt + 0.06, mz, 0.2, 0.11, 0.07);
      add(this.unitBox, this.amber, s * (hw + 0.2), spec.belt + 0.06, mz + 0.03, 0.02, 0.03, 0.05);
      for (const z of spec.pillars) add(this.unitBox, this.steel, s * (hw + 0.012), spec.belt - 0.13, z - 0.22, 0.02, 0.03, 0.14);
      // rubbing strip along the doors
      add(this.unitBox, this.seam, s * (hw + 0.006), spec.belt * 0.52, 0, 0.012, 0.045, spec.length * 0.52);
      // bright trim along the waistline
      if (kind !== "van") add(this.unitBox, this.steel, s * (hw - 0.03), spec.belt - 0.005, (spec.cabin[0].z + spec.cabin[spec.cabin.length - 1].z) / 2, 0.02, 0.018, (spec.cabin[spec.cabin.length - 1].z - spec.cabin[0].z) * 0.9);
    }
    // high-level brake light, rear wiper, exhaust
    add(this.unitBox, this.tailMat, 0, kind === "van" ? spec.top - 0.1 : spec.top - 0.09, kind === "van" ? -half + 0.02 : spec.cabin[0].z + 0.2, 0.3, 0.03, 0.04);
    add(this.unitBox, this.steel, hw - 0.42, 0.26, -half + 0.02, 0.07, 0.05, 0.12);
    add(this.unitBox, this.grille, 0, noseY - (kind === "taxi" ? 0.02 : 0.1), half - 0.04, kind === "taxi" ? 0.62 : 0.86, kind === "taxi" ? 0.34 : 0.14, 0.06);
    if (kind === "taxi") {
      add(this.unitBox, this.steel, 0, noseY - 0.02, half - 0.02, 0.68, 0.4, 0.03);
      for (let k = -2; k <= 2; k++) add(this.unitBox, this.grille, k * 0.11, noseY - 0.02, half - 0.002, 0.03, 0.32, 0.03);
    } else {
      add(this.unitBox, this.steel, 0, noseY + 0.02, half - 0.015, 0.16, 0.07, 0.02); // badge
    }
    if (kind === "van") {
      // rear doors: split line, hinges and handle
      add(this.unitBox, this.seam, 0, 1.15, -half + 0.03, 0.014, 1.5, 0.02);
      add(this.unitBox, this.steel, 0.09, 1.05, -half + 0.02, 0.04, 0.16, 0.03);
    }
    const pf = new THREE.Mesh(this.plane, this.plate(reg, false));
    pf.scale.set(0.52, 0.112, 1);
    pf.position.set(0, 0.5, half + 0.012);
    group.add(pf);
    const pr = new THREE.Mesh(this.plane, this.plate(reg, true));
    pr.scale.set(0.52, 0.112, 1);
    pr.position.set(0, kind === "van" ? 0.62 : 0.7, -half - 0.012);
    pr.rotation.y = Math.PI;
    group.add(pr);
    return group;
  }

  /** Ordinary traffic: black cab, panel van or hatchback. */
  makeCar(kind: "taxi" | "van" | "car", colour: number): { group: THREE.Group; length: number; width: number } {
    const spec = CAR_SPECS[kind];
    const paint = new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.3, metalness: kind === "van" ? 0.1 : 0.45, clearcoat: 1, clearcoatRoughness: 0.05 });
    this.disposables.push(paint);
    const L = "ABCDEFGHJKLMNOPRSTUVWXY";
    const pick = (n: number) => L[Math.floor(Math.abs(Math.sin(colour * 0.001 + n * 12.9898 + this.serial * 78.233) * 43758.5453) % L.length)];
    this.serial++;
    const year = ["26", "75", "25", "74", "24", "73", "23", "72", "21", "69"][(this.serial * 7) % 10];
    const reg = `${kind === "taxi" ? "L" : pick(1)}${pick(2)}${year} ${pick(3)}${pick(4)}${pick(5)}`;
    const group = this.buildCar(kind, paint, reg);
    const hw = spec.width / 2;
    const half = spec.length / 2;
    if (kind === "taxi") {
      const light = new THREE.Mesh(this.unitBox, this.taxiLight);
      light.scale.set(0.4, 0.12, 0.16);
      light.position.set(0, spec.top + 0.07, 0.5);
      group.add(light);
      for (const f of [1, -1]) {
        const txt = new THREE.Mesh(this.plane, this.taxiText);
        txt.scale.set(0.36, 0.1, 1);
        txt.position.set(0, spec.top + 0.07, 0.5 + f * 0.082);
        txt.rotation.y = f > 0 ? 0 : Math.PI;
        group.add(txt);
      }
      // hackney carriage licence plate on the boot
      const lic = new THREE.Mesh(this.plane, this.taxiLicence);
      lic.scale.set(0.22, 0.2, 1);
      lic.position.set(0.42, 0.98, -half - 0.012);
      lic.rotation.y = Math.PI;
      group.add(lic);
    } else if (kind === "van") {
      // livery band and a roof rack so the vans are not all the same
      for (const s of [-1, 1]) {
        const st = new THREE.Mesh(this.unitBox, this.stripeMats[(colour >> 3) % this.stripeMats.length]);
        st.scale.set(0.015, 0.42, 2.7);
        st.position.set(s * (hw - 0.012), 1.2, -0.9);
        group.add(st);
      }
      // signwriting on both flanks
      const firms: [string, string][] = [["SOHO COURIERS", "same-day · W1 · 020 7946 0123"], ["BERWICK ST. FRUIT & VEG", "market traders since 1778"], ["WARDOUR PLUMBING", "heating · drains · 24 hours"], ["CARNABY SCAFFOLDING", "est. 1984"], ["GOLDEN SQUARE FLORIST", "weddings · events · daily deliveries"]];
      const firm = firms[this.serial % firms.length];
      const dark = (colour & 0xff) < 0x80;
      const sign = this.decal(firm, null, dark ? "#f2f2ee" : "#1b2a4a");
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(this.plane, sign);
        m.scale.set(2.5, 0.62, 1);
        m.position.set(s * (hw - 0.004), 1.62, -0.9);
        m.rotation.y = (s * Math.PI) / 2;
        group.add(m);
      }
      for (const z of [-1.8, -0.6, 0.5]) {
        const bar = new THREE.Mesh(this.unitBox, this.steel);
        bar.scale.set(spec.width - 0.3, 0.04, 0.05);
        bar.position.set(0, spec.top + 0.1, z);
        group.add(bar);
      }
    }
    return { group, length: spec.length, width: spec.width };
  }

  makePolice(): { group: THREE.Group; setLights: (on: boolean, t: number) => void } {
    const spec = CAR_SPECS.estate;
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xe6e9ec, roughness: 0.28, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 });
    this.disposables.push(paint);
    const group = this.buildCar("estate", paint, "BX26 MET");
    const hw = spec.width / 2, half = spec.length / 2;
    // Battenburg down each flank, chevrons on the tail, POLICE on the bonnet
    const flank = (frontLeft: boolean) => {
      const [cv, c] = canvas(900, 110);
      const n = 6, bw = 900 / n;
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < 2; r++) {
          c.fillStyle = (i + r) % 2 ? "#0b3fa8" : "#eaf000";
          c.fillRect(i * bw, r * 55, bw, 55);
        }
      }
      c.fillStyle = "#06143a";
      c.font = `800 30px ${SANS}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "#ffffff";
      c.fillRect(frontLeft ? 180 : 540, 36, 180, 38);
      c.fillStyle = "#06143a";
      c.fillText("POLICE", frontLeft ? 270 : 630, 56);
      return finish(cv);
    };
    const tl = flank(true), tr = flank(false);
    const [rc, rcx] = canvas(256, 64);
    for (let i = -2; i < 12; i++) {
      rcx.fillStyle = i % 2 ? "#e30613" : "#eaf000";
      rcx.beginPath();
      rcx.moveTo(i * 36, 64);
      rcx.lineTo(i * 36 + 36, 64);
      rcx.lineTo(i * 36 + 68, 0);
      rcx.lineTo(i * 36 + 32, 0);
      rcx.fill();
    }
    const tb = finish(rc);
    const [bc, bcx] = canvas(256, 64);
    bcx.fillStyle = "#e6e9ec";
    bcx.fillRect(0, 0, 256, 64);
    bcx.fillStyle = "#06143a";
    bcx.font = `800 44px ${SANS}`;
    bcx.textAlign = "center";
    bcx.textBaseline = "middle";
    bcx.fillText("POLICE", 128, 34);
    const tbn = finish(bc);
    this.disposables.push(tl, tr, tb, tbn);
    const decal = (t: THREE.Texture) => {
      const m = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
      this.disposables.push(m);
      return m;
    };
    const plane = this.plane;
    for (const [s, t] of [[1, tl], [-1, tr]] as const) {
      const m = new THREE.Mesh(plane, decal(t));
      m.scale.set(3.3, 0.42, 1);
      m.position.set(s * (hw + 0.004), 0.68, -0.05);
      m.rotation.y = (s * Math.PI) / 2;
      group.add(m);
    }
    const rear = new THREE.Mesh(plane, decal(tb));
    rear.scale.set(1.5, 0.34, 1);
    rear.position.set(0, 0.72, -half - 0.012);
    rear.rotation.y = Math.PI;
    group.add(rear);
    const bonnet = new THREE.Mesh(plane, decal(tbn));
    bonnet.scale.set(1.0, 0.26, 1);
    bonnet.position.set(0, 0.905, 1.72);
    bonnet.rotation.x = -Math.PI / 2 + 0.12;
    group.add(bonnet);
    // light bar
    const bar = new THREE.Mesh(this.unitBox, this.under);
    bar.scale.set(1.16, 0.09, 0.28);
    bar.position.set(0, spec.top + 0.07, -0.35);
    group.add(bar);
    const blueMat = [0, 1].map(() => new THREE.MeshBasicMaterial({ color: 0x0a1a66 }));
    blueMat.forEach((m, i) => {
      this.disposables.push(m);
      const l = new THREE.Mesh(this.unitBox, m);
      l.scale.set(0.5, 0.11, 0.3);
      l.position.set(i ? 0.32 : -0.32, spec.top + 0.09, -0.35);
      group.add(l);
    });
    const glow = new THREE.PointLight(0x2a5cff, 0, 26, 1.6);
    glow.position.set(0, 2.1, 0);
    group.add(glow);
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
