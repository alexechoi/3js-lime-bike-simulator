import * as THREE from "three";
import { hash01 } from "./types";

export interface TreeSpot {
  x: number;
  y: number;
  z: number;
  h: number; // target height in metres
}

/**
 * Street trees grown with ez-tree (github.com/dgreenheck/ez-tree, MIT):
 * a handful of procedurally branched specimens, instanced along the streets.
 */
export async function buildTrees(spots: TreeSpot[], group: THREE.Group): Promise<{ dispose: () => void }> {
  if (!spots.length) return { dispose: () => {} };
  const { Tree } = await import("@dgreenheck/ez-tree");
  const recipes: [string, number][] = [["Ash Medium", 4711], ["Oak Medium", 1203], ["Ash Medium", 90210], ["Ash Medium", 77]];
  const disposables: { dispose: () => void }[] = [];
  const buckets: TreeSpot[][] = recipes.map(() => []);
  spots.forEach((s, i) => buckets[s.h < 6.5 ? 3 : Math.floor(hash01(i * 12.9 + 3) * 3)].push(s));
  const o = new THREE.Object3D();
  recipes.forEach(([preset, seed], vi) => {
    const list = buckets[vi];
    if (!list.length) return;
    const tree = new Tree();
    tree.loadPreset(preset);
    const opt = tree.options;
    opt.seed = seed;
    // keep the wood light: these are seen from a bike, not a macro lens
    opt.branch.levels = Math.min(opt.branch.levels, 3);
    for (const k of [0, 1, 2, 3] as const) {
      opt.branch.segments[k] = Math.max(3, Math.round(opt.branch.segments[k] * 0.6));
      opt.branch.sections[k] = Math.max(3, Math.round(opt.branch.sections[k] * 0.7));
    }
    opt.leaves.tint = 0xb8cc8a; // late-summer plane, not spring lime
    tree.generate();
    const bg = tree.branchesMesh.geometry, lg = tree.leavesMesh.geometry;
    bg.computeBoundingBox();
    lg.computeBoundingBox();
    const top = Math.max(bg.boundingBox!.max.y, lg.boundingBox!.max.y) || 1;
    const bm = tree.branchesMesh.material as THREE.Material;
    const lm = tree.leavesMesh.material as THREE.MeshPhongMaterial;
    const branches = new THREE.InstancedMesh(bg, bm, list.length);
    const leaves = new THREE.InstancedMesh(lg, lm, list.length);
    list.forEach((s, i) => {
      const sc = s.h / top;
      o.position.set(s.x, s.y, s.z);
      o.rotation.set(0, hash01(s.x * 3.7 + s.z) * Math.PI * 2, 0);
      o.scale.set(sc * (0.9 + 0.25 * hash01(s.x + s.z * 7.1)), sc, sc * (0.9 + 0.25 * hash01(s.z + s.x * 5.3)));
      o.updateMatrix();
      branches.setMatrixAt(i, o.matrix);
      leaves.setMatrixAt(i, o.matrix);
    });
    for (const m of [branches, leaves]) {
      m.instanceMatrix.needsUpdate = true;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      group.add(m);
    }
    // leaf cards cast leaf-shaped shadows
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: lm.map, alphaTest: 0.5 });
    leaves.customDepthMaterial = depth;
    disposables.push(bg, lg, bm, lm, depth);
    console.info(`[soho] ${preset}: ${list.length} trees, ${(bg.index ? bg.index.count : bg.attributes.position.count) / 3 | 0} + ${(lg.index ? lg.index.count : lg.attributes.position.count) / 3 | 0} tris each`);
  });
  return { dispose: () => disposables.forEach((d) => d.dispose()) };
}
