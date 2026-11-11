// The office cat in 3D, matching the 2D one. It sits when standing still, walks on four legs
// when the scene moves it, and lies down asleep when nobody is in. It droops when sad, wags
// faster when happy and hops when fed. Its name and keyboard button sit in `slot`, which
// Map3D fills. Where it walks is the scene's job (scene3d.ts); this only poses it.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { PetMood } from '../../shared/pet.ts';
import { CAT, STAGE_SCALE, type PetShown } from '../lib/petLook.ts';

const hex = (color: string) => parseInt(color.slice(1), 16);
const HOP_S = 0.8;
/** A grown cat's width at scale 1. */
const MODEL_WIDTH = 2.4;

export interface OfficeCat3D {
  group: THREE.Group;
  slot: HTMLElement;
  set(pet: PetShown): void;
  /** Whether the scene is walking it somewhere: it stands up and trots. */
  setWalking(on: boolean): void;
  /** How far its body reaches from its middle, for keeping clear of furniture and people. */
  radius(): number;
  animate(time: number): void;
}

type Pose = 'sit' | 'walk' | 'sleep';

/** `size` is a grown cat's width in world units. */
export function createOfficeCat(size: number): OfficeCat3D {
  const group = new THREE.Group();
  group.name = 'office-cat';
  const inner = new THREE.Group();
  group.add(inner);

  const materials = {
    fur: new THREE.MeshStandardMaterial({ color: hex(CAT.fur), roughness: 0.8 }),
    stripe: new THREE.MeshStandardMaterial({ color: hex(CAT.stripe), roughness: 0.8 }),
    belly: new THREE.MeshStandardMaterial({ color: hex(CAT.belly), roughness: 0.8 }),
    nose: new THREE.MeshStandardMaterial({ color: hex(CAT.nose) }),
    ink: new THREE.MeshStandardMaterial({ color: 0x2a2657 }),
  };
  function add(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.userData.pet = true;
    mesh.userData.ownedMaterial = true;
    parent.add(mesh);
    return mesh;
  }

  // Facing +z, standing on y = 0.
  const body = add(inner, new THREE.SphereGeometry(0.8, 18, 14), materials.fur, 0, 0.75, 0);
  const belly = add(inner, new THREE.SphereGeometry(0.55, 14, 10), materials.belly, 0, 0.7, 0.55);
  belly.scale.set(1, 1.1, 0.6);
  for (const x of [-0.25, 0, 0.25]) add(body, new THREE.BoxGeometry(0.08, 0.05, 0.5), materials.stripe, x, 0.78, -0.1);

  const head = new THREE.Group();
  inner.add(head);
  add(head, new THREE.SphereGeometry(0.62, 18, 14), materials.fur, 0, 0, 0).scale.set(1.12, 1, 1);
  const ears = [-1, 1].map((side) => {
    const ear = add(head, new THREE.ConeGeometry(0.22, 0.42, 4), materials.fur, side * 0.38, 0.55, 0);
    ear.rotation.z = -side * 0.35;
    return ear;
  });
  for (const x of [-0.12, 0, 0.12]) add(head, new THREE.BoxGeometry(0.05, 0.18, 0.04), materials.stripe, x, 0.5, 0.25);
  add(head, new THREE.SphereGeometry(0.06, 8, 6), materials.nose, 0, -0.05, 0.62);
  const eyes = [-1, 1].map((side) => add(head, new THREE.SphereGeometry(0.075, 8, 6), materials.ink, side * 0.22, 0.08, 0.56));
  const shut = [-1, 1].map((side) => add(head, new THREE.BoxGeometry(0.18, 0.035, 0.04), materials.ink, side * 0.22, 0.06, 0.6));

  // Each leg swings from the hip.
  const legs = [
    [-0.35, 0.55],
    [0.35, 0.55],
    [-0.35, -0.55],
    [0.35, -0.55],
  ].map(([x, z]) => {
    const hip = new THREE.Group();
    hip.position.set(x!, 0.62, z!);
    inner.add(hip);
    add(hip, new THREE.CylinderGeometry(0.13, 0.11, 0.62, 8), materials.fur, 0, -0.31, 0);
    add(hip, new THREE.SphereGeometry(0.13, 8, 6), materials.belly, 0, -0.6, 0.04);
    return hip;
  });

  // The tail swings from its base at the back.
  const tail = new THREE.Group();
  inner.add(tail);
  add(tail, new THREE.CylinderGeometry(0.11, 0.13, 1.2, 8), materials.fur, 0, 0.55, -0.15).rotation.x = -0.35;
  add(tail, new THREE.SphereGeometry(0.12, 8, 6), materials.stripe, 0, 1.12, -0.36);

  // The name sits above the head, like people's, so it never covers the cat. CSS2DRenderer
  // owns the anchor's transform, so the scene scales the slot inside it, as it does for people.
  const anchor = document.createElement('div');
  const slot = document.createElement('div');
  Object.assign(slot.style, { display: 'flex', justifyContent: 'center', transformOrigin: '50% 100%' });
  anchor.append(slot);
  const label = new CSS2DObject(anchor);
  label.center.set(0.5, 1);
  group.add(label);

  let mood: PetMood = 'content';
  let stage = 1;
  let walking = false;
  let cheer = -1;
  let hopStart = -Infinity;
  let pendingHop = false;
  let pose: Pose = 'sit';

  const scale = () => (size / MODEL_WIDTH) * stage;

  function applyPose() {
    pose = mood === 'sleeping' ? 'sleep' : walking ? 'walk' : 'sit';
    const sad = mood === 'sad';
    if (pose === 'sleep') {
      // Lying down: low and long, with the head resting on the floor.
      body.scale.set(1, 0.65, 1.45);
      body.position.set(0, 0.5, 0);
      head.position.set(0.55, 0.55, 0.75);
      head.rotation.set(0, 0.6, -0.25);
      tail.position.set(0, 0.25, -0.9);
      tail.rotation.set(-1.2, 0, 0);
    } else if (pose === 'walk') {
      // On all fours: a long body with the head in front and the tail up behind.
      body.scale.set(0.85, 0.75, 1.35);
      body.position.set(0, 0.95, 0);
      head.position.set(0, 1.45, 0.95);
      head.rotation.set(sad ? 0.3 : -0.1, 0, 0);
      tail.position.set(0, 1.0, -0.95);
      tail.rotation.set(-0.5, 0, 0);
    } else {
      body.scale.set(1, 1.05, 1.25);
      body.position.set(0, 0.75, 0);
      head.position.set(0, 1.55, 0.2);
      head.rotation.set(sad ? 0.35 : 0, 0, 0);
      tail.position.set(0, 0.35, -0.9);
      tail.rotation.set(0, 0, 0);
    }
    belly.visible = pose === 'sit';
    for (const hip of legs) {
      hip.visible = pose === 'walk';
      hip.rotation.x = 0;
    }
    // Sad cats hold their ears flat.
    for (const ear of ears) {
      ear.rotation.x = sad ? -0.7 : 0;
      ear.position.y = sad ? 0.45 : 0.55;
    }
    for (const eye of eyes) eye.visible = pose !== 'sleep';
    for (const line of shut) line.visible = pose === 'sleep';
    inner.scale.setScalar(scale());
    label.position.set(0, (pose === 'sleep' ? 1.3 : pose === 'walk' ? 2.3 : 2.6) * scale(), 0);
  }
  applyPose();

  return {
    group,
    slot,
    set(pet) {
      const changed = pet.mood !== mood || STAGE_SCALE[pet.stage] !== stage;
      mood = pet.mood;
      stage = STAGE_SCALE[pet.stage];
      // The first look only sets the count; later feeds play a hop.
      if (cheer >= 0 && pet.cheer > cheer) pendingHop = true;
      cheer = pet.cheer;
      if (changed) applyPose();
    },
    setWalking(on) {
      if (on === walking) return;
      walking = on;
      applyPose();
    },
    radius: () => 0.9 * scale(),
    animate(time) {
      if (pendingHop) {
        hopStart = time;
        pendingHop = false;
      }
      const speed = mood === 'joyful' ? 9 : mood === 'happy' ? 5 : mood === 'sleeping' ? 0.6 : 2;
      tail.rotation.z = Math.sin(time * speed) * (mood === 'sleeping' ? 0.08 : 0.45);
      const t = (time - hopStart) / HOP_S;
      const hop = t >= 0 && t < 1 ? Math.abs(Math.sin(t * Math.PI * 2)) * (1 - t) * 1.2 : 0;
      if (pose === 'walk') {
        // A trot: legs swing in diagonal pairs and the body bobs a little.
        const swing = Math.sin(time * 12) * 0.6;
        legs.forEach((hip, i) => (hip.rotation.x = i === 0 || i === 3 ? swing : -swing));
        inner.position.y = hop + Math.abs(Math.sin(time * 12)) * 0.08;
        return;
      }
      const base = pose === 'sleep' ? 0.65 : 1.05;
      body.scale.y = base * (1 + Math.sin(time * 2.2) * 0.025);
      inner.position.y = hop || (mood === 'joyful' ? Math.abs(Math.sin(time * 4)) * 0.12 : 0);
    },
  };
}
