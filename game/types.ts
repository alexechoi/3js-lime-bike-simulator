// Shape of public/data/soho.json (written by pipeline/build_map.py).
// Coordinates are metres from Oxford Circus: +x east, +z south.

export type Ring = number[]; // flat [x, z, x, z, ...]
export type Poly = Ring[]; // outer ring, then holes

export interface BuildingData {
  p: Ring;
  h: number;
  mh: number;
  lv: number;
  f: string; // per-edge "1" when the wall faces open space
  /** inset roof outline (flat x,z pairs) followed by the inset distance; empty for a flat roof */
  ri: number[];
  mat: string;
  col: string;
  use: string;
  name: string;
  arch: string;
  dm: number; // distance to Oxford St / Regent St
  dr: number; // distance to Regent St
  play: boolean;
  s: number; // seed 0..1
}

export interface SignData {
  n: string;
  k: string;
  x: number;
  z: number;
  nx: number;
  nz: number;
  w: number;
  b: number;
  e: number;
  brand: string;
  dest: [number, number] | null;
  dm: number;
}

export interface SignalData {
  x: number;
  z: number;
  tx: number;
  tz: number;
  hw: number;
  j: number;
  ph: number;
  name: string;
  solo: boolean;
}

export interface ZebraData {
  x: number;
  z: number;
  tx: number;
  tz: number;
  hw: number;
}

export interface RoadData {
  n: string;
  k: string;
  w: number;
  o: number;
  p: Ring;
}

export interface SceneData {
  play: [number, number, number, number];
  scene: [number, number, number, number];
  pavement: Poly[];
  zone: Poly[];
  zoneRoad: Poly[];
  zoneCentre: [number, number][];
  zoneEast: number;
  ped: Poly[];
  green: Poly[];
  roads: RoadData[];
  buildings: BuildingData[];
  signs: SignData[];
  signals: SignalData[];
  zebras: ZebraData[];
  busRoutes: { street: string; pts: [number, number][]; routes: string[] }[];
  graph: { nodes: [number, number][]; edges: { a: number; b: number; p: [number, number][] }[] };
  plates: { n: string; x: number; z: number; nx: number; nz: number }[];
  lamps: [number, number, number, number][];
  props: Record<string, [number, number, string?][]>;
  kerbs: { m: number; p: Ring }[];
  attribution: string;
}

export const SURFACE_ROAD = 0;
export const SURFACE_PAVEMENT = 1;
export const SURFACE_BUILDING = 2;

export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
