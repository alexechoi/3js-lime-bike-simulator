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
const swayTime = { value: 0 };

export async function buildTrees(spots: TreeSpot[], group: THREE.Group): Promise<{ dispose: () => void; update: (t: number) => void }> {
  if (!spots.length) return { dispose: () => {}, update: () => {} };
  const { Tree } = await import("@dgreenheck/ez-tree");
  const recipes: [string, number][] = [["Ash Medium", 4711], ["Ash Large", 1203], ["Ash Medium", 90210]];
  const disposables: { dispose: () => void }[] = [];
  const buckets: TreeSpot[][] = recipes.map(() => []);
  spots.forEach((s, i) => buckets[Math.floor(hash01(i * 12.9 + 3) * 3) % 3].push(s));
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
    // ez-tree's own leaf material sways in the wind with a shader that ignores instancing,
    // which would draw every tree's leaves in one clump at the origin: use a plain one
    const src = tree.leavesMesh.material as THREE.MeshPhongMaterial;
    const lm = new THREE.MeshStandardMaterial({
      map: src.map, color: 0xe6f2c0, alphaTest: 0.18, side: THREE.DoubleSide, roughness: 0.75,
    });
    lm.onBeforeCompile = (sh) => {
      // gentle sway that respects each instance's own transform
      sh.uniforms.uTime = swayTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n#ifdef USE_INSTANCING\nfloat ph = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.21;\n#else\nfloat ph = 0.0;\n#endif\nfloat sw = smoothstep(8.0, 60.0, position.y);\ntransformed.x += sin(uTime * 1.3 + ph + position.y * 0.08) * 0.5 * sw;\ntransformed.z += cos(uTime * 1.1 + ph * 1.3 + position.x * 0.07) * 0.4 * sw;",
        );
    };
    disposables.push(src);
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
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: lm.map, alphaTest: 0.18 });
    leaves.customDepthMaterial = depth;
    disposables.push(bg, lg, bm, lm, depth);
    console.info(`[soho] ${preset}: ${list.length} trees, ${(bg.index ? bg.index.count : bg.attributes.position.count) / 3 | 0} + ${(lg.index ? lg.index.count : lg.attributes.position.count) / 3 | 0} tris each`);
  });
  return { dispose: () => disposables.forEach((d) => d.dispose()), update: (t: number) => { swayTime.value = t; } };
}
