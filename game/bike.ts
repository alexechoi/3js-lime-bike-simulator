import * as THREE from "three";

// A Lime-style step-through e-bike with a courier on it. Faces +Z.

const LIME = 0x32d24a;
const UP = new THREE.Vector3(0, 1, 0);

function between(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = new THREE.Vector3().subVectors(b, a);
  const l = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.normalize());
  mesh.scale.set(1, l, 1);
}

/** Two-bone IK: where the middle joint sits, bending towards `pole`. */
function midJoint(a: THREE.Vector3, b: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const d = Math.min(ab.length(), l1 + l2 - 1e-3);
  ab.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const side = new THREE.Vector3().copy(pole).addScaledVector(ab, -pole.dot(ab)).normalize();
  return out.copy(a).addScaledVector(ab, x).addScaledVector(side, h);
}

export interface BikeModel {
  group: THREE.Group;
  /** The courier, parented to the bike until a crash throws them off. */
  rider: THREE.Group;
  /** Put the rider back in the saddle. */
  remount: () => void;
  /** Advance the animation. `steer` in radians, `spin` in radians of wheel turn, `pedal` crank angle. */
  pose: (steer: number, spin: number, pedal: number, lean: number) => void;
}

export function makeBike(withRider: boolean): BikeModel {
  const group = new THREE.Group();
  const leanGroup = new THREE.Group();
  group.add(leanGroup);

  const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f3f0, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 });
  const lime = new THREE.MeshPhysicalMaterial({ color: LIME, roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, emissive: LIME, emissiveIntensity: 0.02 });
  const black = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.7 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xa9adb0, roughness: 0.3, metalness: 0.8 });
  const unit = new THREE.CylinderGeometry(1, 1, 1, 10);
  const add = (parent: THREE.Object3D, m: THREE.Mesh) => {
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const tube = (parent: THREE.Object3D, a: [number, number, number], b: [number, number, number], r: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(unit, mat);
    between(m, new THREE.Vector3(...a), new THREE.Vector3(...b));
    m.scale.x = m.scale.z = r;
    return add(parent, m);
  };

  const R = 0.335;
  const REAR = -0.57, FRONT = 0.58;
  const BB = new THREE.Vector3(0, 0.3, -0.06);

  const wheel = () => {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(R - 0.045, 0.045, 10, 28), rubber);
    tyre.rotation.y = Math.PI / 2;
    add(w, tyre);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.085, 0.014, 6, 28), steel);
    rim.rotation.y = Math.PI / 2;
    w.add(rim);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI;
      const s = new THREE.Mesh(unit, steel);
      s.scale.set(0.004, (R - 0.09) * 2, 0.004);
      s.rotation.x = a;
      w.add(s);
    }
    const hub = new THREE.Mesh(unit, black);
    hub.scale.set(0.045, 0.1, 0.045);
    hub.rotation.z = Math.PI / 2;
    w.add(hub);
    return w;
  };

  // frame
  tube(leanGroup, [0, 0.74, 0.43], [0, 0.4, 0.2], 0.052, white);
  tube(leanGroup, [0, 0.4, 0.2], [0, 0.3, -0.06], 0.056, white);
  tube(leanGroup, [0, 0.3, -0.06], [0, 0.93, -0.27], 0.03, white);
  tube(leanGroup, [0, 0.33, -0.1], [0, 0.34, REAR], 0.022, white);
  tube(leanGroup, [0, 0.72, -0.2], [0, 0.36, REAR], 0.02, white);
  tube(leanGroup, [0, 1.02, 0.36], [0, 0.66, 0.46], 0.036, white);
  // battery pack tucked behind the seat tube
  const batt = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.1), black);
  batt.position.set(0, 0.62, -0.26);
  batt.rotation.x = -0.32;
  add(leanGroup, batt);
  // the lime rear mudguard
  const guard = new THREE.Mesh(new THREE.TorusGeometry(R + 0.035, 0.035, 6, 18, Math.PI * 0.95), lime);
  guard.rotation.set(0, Math.PI / 2, 0);
  guard.rotation.order = "YXZ";
  guard.rotation.x = 0;
  guard.rotation.z = 0.25;
  guard.scale.z = 2.0;
  guard.position.set(0, 0.34, REAR);
  add(leanGroup, guard);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.2, 0.42), lime);
  skirt.position.set(0.075, 0.47, REAR + 0.02);
  add(leanGroup, skirt);
  const skirt2 = skirt.clone();
  skirt2.position.x = -0.075;
  add(leanGroup, skirt2);
  // saddle
  const saddle = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), black);
  saddle.scale.set(0.85, 0.32, 1.25);
  saddle.position.set(0, 0.97, -0.29);
  add(leanGroup, saddle);
  // kickstand and chain guard
  const cg = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.09, 0.5), white);
  cg.position.set(0.07, 0.34, -0.32);
  add(leanGroup, cg);

  const rear = wheel();
  rear.position.set(0, R, REAR);
  leanGroup.add(rear);

  // steering assembly pivots about the head tube
  const steerPivot = new THREE.Group();
  steerPivot.position.set(0, 0.84, 0.41);
  steerPivot.rotation.x = -0.27; // head angle
  leanGroup.add(steerPivot);
  const steer = new THREE.Group();
  steerPivot.add(steer);
  const inSteer = (v: [number, number, number]): [number, number, number] => {
    const p = new THREE.Vector3(...v).sub(steerPivot.position).applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.27);
    return [p.x, p.y, p.z];
  };
  tube(steer, inSteer([0.06, 0.66, 0.46]), inSteer([0.06, R, FRONT]), 0.02, lime);
  tube(steer, inSteer([-0.06, 0.66, 0.46]), inSteer([-0.06, R, FRONT]), 0.02, lime);
  tube(steer, inSteer([0, 1.0, 0.37]), inSteer([0, 1.12, 0.33]), 0.022, black);
  tube(steer, inSteer([-0.31, 1.13, 0.31]), inSteer([0.31, 1.13, 0.31]), 0.016, black);
  tube(steer, inSteer([-0.31, 1.13, 0.31]), inSteer([-0.2, 1.13, 0.31]), 0.022, rubber);
  tube(steer, inSteer([0.2, 1.13, 0.31]), inSteer([0.31, 1.13, 0.31]), 0.022, rubber);
  const fguard = new THREE.Mesh(new THREE.TorusGeometry(R + 0.03, 0.028, 6, 14, Math.PI * 0.6), black);
  fguard.rotation.order = "YXZ";
  fguard.rotation.y = Math.PI / 2;
  fguard.rotation.z = 0.6;
  fguard.scale.z = 1.8;
  const fp = inSteer([0, R, FRONT]);
  fguard.position.set(fp[0], fp[1], fp[2]);
  add(steer, fguard);
  // basket with the green face plate
  const basket = new THREE.Group();
  const bp = inSteer([0, 0.92, 0.66]);
  basket.position.set(bp[0], bp[1], bp[2]);
  basket.rotation.x = 0.27;
  const bside = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.26), new THREE.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.6, metalness: 0.3 }));
  add(basket, bside);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.17, 0.02), lime);
  plate.position.z = 0.135;
  add(basket, plate);
  const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.03), new THREE.MeshBasicMaterial({ color: 0xfffbe0 }));
  lampMesh.position.set(0, -0.13, 0.13);
  basket.add(lampMesh);
  steer.add(basket);
  const front = wheel();
  front.position.set(fp[0], fp[1], fp[2]);
  steer.add(front);

  // cranks
  const crank = new THREE.Group();
  crank.position.copy(BB);
  leanGroup.add(crank);
  const CR = 0.17;
  tube(crank, [0.085, 0, 0], [0.085, CR, 0], 0.012, steel);
  tube(crank, [-0.085, 0, 0], [-0.085, -CR, 0], 0.012, steel);
  const pedalGeo = new THREE.BoxGeometry(0.09, 0.02, 0.07);
  const pedL = new THREE.Mesh(pedalGeo, black), pedR = new THREE.Mesh(pedalGeo, black);
  leanGroup.add(pedL, pedR);

  // ---- rider ----------------------------------------------------------
  type Limb = { upper: THREE.Mesh; lower: THREE.Mesh; l1: number; l2: number; r1: number; r2: number };
  let legs: Limb[] = [];
  let hips: THREE.Vector3[] = [];
  let feet: THREE.Mesh[] = [];
  const riderGroup = new THREE.Group();
  leanGroup.add(riderGroup);
  if (withRider) {
    const jacket = new THREE.MeshStandardMaterial({ color: 0x1d2b3a, roughness: 0.8 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc8956d, roughness: 0.7 });
    const helmet = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.35 });
    const bag = new THREE.MeshStandardMaterial({ color: 0x00ccbc, roughness: 0.65 });
    const shoes = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.7 });

    const hip = new THREE.Vector3(0, 1.03, -0.27);
    const chest = new THREE.Vector3(0, 1.5, 0.0);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 6, 12), jacket);
    between(torso, hip, chest);
    torso.scale.set(1.08, 1, 0.82);
    torso.position.y += 0.02;
    add(riderGroup, torso);
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), trousers);
    pelvis.scale.set(1.05, 0.75, 0.9);
    pelvis.position.copy(hip);
    add(riderGroup, pelvis);
    const neck = new THREE.Mesh(unit, skin);
    between(neck, new THREE.Vector3(0, 1.58, 0.05), new THREE.Vector3(0, 1.68, 0.08));
    neck.scale.x = neck.scale.z = 0.05;
    add(riderGroup, neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 12), skin);
    head.position.set(0, 1.76, 0.1);
    head.scale.set(0.95, 1.1, 1);
    add(riderGroup, head);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), helmet);
    lid.position.set(0, 1.79, 0.095);
    lid.rotation.x = -0.18;
    lid.scale.set(1, 0.95, 1.18);
    add(riderGroup, lid);
    // insulated delivery bag, Deliveroo teal with the wordmark on the back
    const bagCv = document.createElement("canvas");
    bagCv.width = 256;
    bagCv.height = 256;
    const bc = bagCv.getContext("2d")!;
    bc.fillStyle = "#00ccbc";
    bc.fillRect(0, 0, 256, 256);
    bc.fillStyle = "rgba(0,0,0,0.12)";
    bc.fillRect(0, 0, 256, 10);
    bc.fillRect(0, 246, 256, 10);
    // roo head mark
    bc.fillStyle = "#ffffff";
    bc.save();
    bc.translate(128, 96);
    bc.beginPath();
    bc.moveTo(-34, 26);
    bc.lineTo(-22, -40);
    bc.lineTo(-4, -8);
    bc.lineTo(10, -46);
    bc.lineTo(30, -6);
    bc.quadraticCurveTo(48, 6, 40, 30);
    bc.quadraticCurveTo(10, 50, -34, 26);
    bc.fill();
    bc.fillStyle = "#00ccbc";
    bc.beginPath();
    bc.arc(8, 8, 4.5, 0, Math.PI * 2);
    bc.arc(26, 10, 4.5, 0, Math.PI * 2);
    bc.fill();
    bc.restore();
    bc.fillStyle = "#ffffff";
    bc.font = `800 44px "Helvetica Neue", Arial, sans-serif`;
    bc.textAlign = "center";
    bc.textBaseline = "middle";
    bc.fillText("deliveroo", 128, 190, 232);
    const bagTex = new THREE.CanvasTexture(bagCv);
    bagTex.colorSpace = THREE.SRGBColorSpace;
    bagTex.anisotropy = 4;
    const bagFace = new THREE.MeshStandardMaterial({ map: bagTex, roughness: 0.6 });
    // BoxGeometry faces: +x, -x, +y, -y, +z, -z; the back of the bag is -z
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 0.34), [bag, bag, bag, bag, bag, bagFace]);
    pack.position.set(0, 1.36, -0.36);
    pack.rotation.x = -0.52;
    add(riderGroup, pack);
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x0b4f49, roughness: 0.8 });
    const packTop = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.36), strapMat);
    packTop.position.set(0, 1.56, -0.48);
    packTop.rotation.x = -0.52;
    add(riderGroup, packTop);
    for (const sx of [-0.13, 0.13]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.03), strapMat);
      strap.position.set(sx, 1.42, 0.02);
      strap.rotation.x = -0.5;
      add(riderGroup, strap);
    }

    // arms are static: shoulders to the grips
    for (const s of [-1, 1]) {
      const sh = new THREE.Vector3(0.2 * s, 1.47, 0.0);
      const hand = new THREE.Vector3(0.26 * s, 1.15, 0.33);
      const el = midJoint(sh, hand, 0.29, 0.27, new THREE.Vector3(0.5 * s, -1, -0.2), new THREE.Vector3());
      const up = new THREE.Mesh(unit, jacket), lo = new THREE.Mesh(unit, jacket);
      between(up, sh, el);
      up.scale.x = up.scale.z = 0.055;
      between(lo, el, hand);
      lo.scale.x = lo.scale.z = 0.045;
      add(riderGroup, up);
      add(riderGroup, lo);
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), jacket);
      shoulder.position.copy(sh);
      add(riderGroup, shoulder);
      const hm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin);
      hm.position.copy(hand);
      add(riderGroup, hm);
    }
    for (const s of [-1, 1]) {
      const upper = new THREE.Mesh(unit, trousers), lower = new THREE.Mesh(unit, trousers);
      add(riderGroup, upper);
      add(riderGroup, lower);
      legs.push({ upper, lower, l1: 0.45, l2: 0.47, r1: 0.075, r2: 0.055 });
      hips.push(new THREE.Vector3(0.1 * s, 1.0, -0.25));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.25), shoes);
      add(riderGroup, foot);
      feet.push(foot);
    }
  } else {
    legs = [];
    hips = [];
    feet = [];
  }

  const knee = new THREE.Vector3();
  const footP = new THREE.Vector3();
  const pole = new THREE.Vector3(0, 0.25, 1);

  const pose = (steerAngle: number, spin: number, pedal: number, lean: number) => {
    steer.rotation.y = steerAngle;
    rear.rotation.x = spin;
    front.rotation.x = spin;
    crank.rotation.x = pedal;
    leanGroup.rotation.z = lean;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const ang = pedal + (i === 0 ? Math.PI : 0);
      // crank rotates about x: (0, CR, 0) -> (0, CR cos, CR sin)
      const px = 0.13 * s, py = BB.y + CR * Math.cos(ang), pz = BB.z + CR * Math.sin(ang);
      (i === 0 ? pedL : pedR).position.set(px, py, pz);
      if (legs.length) {
        footP.set(px, py + 0.06, pz - 0.02);
        const L = legs[i];
        midJoint(hips[i], footP, L.l1, L.l2, pole, knee);
        between(L.upper, hips[i], knee);
        L.upper.scale.x = L.upper.scale.z = L.r1;
        between(L.lower, knee, footP);
        L.lower.scale.x = L.lower.scale.z = L.r2;
        feet[i].position.set(px, py + 0.045, pz + 0.04);
      }
    }
  };
  pose(0, 0, 0.6, 0);
  const remount = () => {
    leanGroup.add(riderGroup);
    riderGroup.position.set(0, 0, 0);
    riderGroup.rotation.set(0, 0, 0);
    riderGroup.scale.set(1, 1, 1);
  };
  return { group, rider: riderGroup, remount, pose };
}
