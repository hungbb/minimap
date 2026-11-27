// The 3D map's Christmas look (lib/season.ts), built from simple shapes like the rest of the
// town: the big tree with its star and presents, the office's little tree, snowy pines, a
// snowman, wreaths, pine garlands with red bows and fairy lights, and Santa with his sleigh and
// reindeer.
// scene3d.ts places them and makes the lights twinkle.
import * as THREE from 'three';
import { bulbSpots, LIGHT_COLOURS, TREE_MODEL } from '../lib/season.ts';

const INK = 0x2a2657;
const GREEN = 0x2fa84f;
const DARK_GREEN = 0x1f7a3d;
const LIGHT_GREEN = 0x3fbf5f;
const RED = 0xe5283b;
const GOLD = 0xffd23f;
const WHITE = 0xffffff;
const SKIN = 0xffd9c2;
const BROWN = 0xa8744f;

interface MeshOptions {
  x?: number;
  y?: number;
  z?: number;
  shadow?: boolean;
}

/** What the scene lends these builders: its shared materials and its mesh helper. */
export interface FestiveTools {
  mat: (color: number) => THREE.Material;
  mesh: (geometry: THREE.BufferGeometry, color: number | THREE.Material, options?: MeshOptions) => THREE.Mesh;
  /** One glowing material per fairy light colour (LIGHT_COLOURS), so the scene can twinkle them. */
  bulbs: readonly THREE.MeshBasicMaterial[];
  /** The tree's star, which glows too. */
  star: THREE.Material;
  /** Snow lying on the pines. */
  snow: THREE.Material;
}

/**
 * The glowing materials for the fairy lights and the star. The scene owns and disposes them.
 * Bulbs ignore the sunlight, so the scene can dim one nearly dark and back (`lightBulbs`),
 * which shows in daylight too.
 */
export function festiveMaterials(ramp: THREE.Texture) {
  const bulbs = LIGHT_COLOURS.map((colour) => new THREE.MeshBasicMaterial({ color: colour, toneMapped: false }));
  const star = new THREE.MeshToonMaterial({ color: GOLD, emissive: GOLD, emissiveIntensity: 0.6, gradientMap: ramp });
  return { bulbs, star };
}

const bulbColours = LIGHT_COLOURS.map((colour) => new THREE.Color(colour));

/** Sets each bulb colour's brightness, from 0 (off) to 1 (full), a little brighter after dark. */
export function lightBulbs(bulbs: readonly THREE.MeshBasicMaterial[], levels: (index: number) => number, night: number) {
  bulbs.forEach((material, i) => {
    material.color.copy(bulbColours[i]!).multiplyScalar(0.28 + levels(i) * (0.85 + night * 0.4));
  });
}

const bulbGeometry = (radius: number) => new THREE.SphereGeometry(radius, 8, 6);

/** Lights round a cone tier, `count` of them at `y`, `radius` out from the middle. */
function ringOfLights(group: THREE.Group, tools: FestiveTools, y: number, radius: number, count: number, offset: number) {
  for (let i = 0; i < count; i++) {
    const angle = offset + (i / count) * Math.PI * 2;
    const material = tools.bulbs[(i + Math.round(offset * 3)) % tools.bulbs.length]!;
    group.add(tools.mesh(bulbGeometry(0.36), material, { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius, shadow: false }));
  }
}

function present(tools: FestiveTools, size: number, colour: number, ribbon: number, x: number, z: number, turn: number) {
  const box = new THREE.Group();
  box.position.set(x, size / 2, z);
  box.rotation.y = turn;
  box.add(tools.mesh(new THREE.BoxGeometry(size, size, size), colour));
  box.add(tools.mesh(new THREE.BoxGeometry(size * 1.02, size * 1.02, size * 0.22), ribbon, { shadow: false }));
  box.add(tools.mesh(new THREE.BoxGeometry(size * 0.22, size * 1.02, size * 1.02), ribbon, { shadow: false }));
  box.add(tools.mesh(new THREE.TorusGeometry(size * 0.18, size * 0.07, 6, 12), ribbon, { y: size * 0.55, shadow: false }));
  return box;
}


/**
 * A Christmas tree with lights, a star and, when asked, presents underneath. Its trunk stands
 * at y = 0 and the star's top is at TREE_MODEL.height. `star` is where its glow goes, for the scene to light at night.
 */
export function createChristmasTree(tools: FestiveTools, { presents = true } = {}) {
  const group = new THREE.Group();
  group.add(tools.mesh(new THREE.CylinderGeometry(0.5, 0.65, 1.6, 8), BROWN, { y: 0.8 }));
  const tiers = [
    { radius: TREE_MODEL.reach, height: 4.6, base: 1.2, colour: DARK_GREEN, lights: 9 },
    { radius: 3.2, height: 3.9, base: 3.9, colour: GREEN, lights: 7 },
    { radius: 2.3, height: 3.2, base: 6.2, colour: LIGHT_GREEN, lights: 5 },
  ];
  tiers.forEach((tier, i) => {
    group.add(tools.mesh(new THREE.ConeGeometry(tier.radius, tier.height, 12), tier.colour, { y: tier.base + tier.height / 2 }));
    // A ring of lights round the lower part of each tier.
    const rise = 0.22;
    ringOfLights(group, tools, tier.base + tier.height * rise, tier.radius * (1 - rise) + 0.12, tier.lights, i * 0.7);
  });
  const star = new THREE.Group();
  star.position.y = 9.6;
  const point = new THREE.OctahedronGeometry(0.75);
  star.add(tools.mesh(point, tools.star, { shadow: false }));
  const twin = tools.mesh(new THREE.OctahedronGeometry(0.75), tools.star, { shadow: false });
  twin.rotation.set(Math.PI / 4, 0, Math.PI / 4);
  star.add(twin);
  group.add(star);

  if (presents) {
    group.add(present(tools, 1.3, RED, GOLD, -2.6, 1.9, 0.3));
    group.add(present(tools, 1.0, GREEN, RED, 2.4, 2.2, -0.4));
    group.add(present(tools, 0.8, GOLD, RED, 0.4, 3.1, 0.8));
  }
  return { group, star };
}

/** A snowy pine for the park, in place of its round trees. Its trunk stands at y = 0, about 8 tall. */
export function createPine(tools: FestiveTools) {
  const group = new THREE.Group();
  group.add(tools.mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.2, 8), 0xc99467, { y: 1.1 }));
  group.add(tools.mesh(new THREE.ConeGeometry(3, 4.2, 9), DARK_GREEN, { y: 4 }));
  group.add(tools.mesh(new THREE.ConeGeometry(2.2, 3.4, 9), GREEN, { y: 6.2 }));
  group.add(tools.mesh(new THREE.ConeGeometry(1.15, 1.6, 9), tools.snow, { y: 7.3, shadow: false }));
  const skirt = tools.mesh(new THREE.ConeGeometry(2.3, 1.2, 9), tools.snow, { y: 5.25, shadow: false });
  skirt.scale.y = 0.6;
  group.add(skirt);
  return group;
}

/** A snowman with a hat, a scarf and a carrot nose, facing +z. About 5 tall. */
export function createSnowman(tools: FestiveTools) {
  const group = new THREE.Group();
  group.add(tools.mesh(new THREE.SphereGeometry(1.5, 14, 10), tools.snow, { y: 1.4 }));
  group.add(tools.mesh(new THREE.SphereGeometry(1.05, 14, 10), tools.snow, { y: 3.3 }));
  const scarf = tools.mesh(new THREE.TorusGeometry(0.8, 0.22, 6, 16), RED, { y: 2.6, shadow: false });
  scarf.rotation.x = Math.PI / 2;
  group.add(scarf);
  group.add(tools.mesh(new THREE.CylinderGeometry(1, 1, 0.12, 14), 0x3a3466, { y: 4.2 }));
  group.add(tools.mesh(new THREE.CylinderGeometry(0.6, 0.65, 0.9, 14), 0x3a3466, { y: 4.7 }));
  const nose = tools.mesh(new THREE.ConeGeometry(0.16, 0.8, 8), 0xff9c3a, { y: 3.3, z: 1.4, shadow: false });
  nose.rotation.x = Math.PI / 2;
  group.add(nose);
  for (const x of [-0.35, 0.35]) group.add(tools.mesh(new THREE.SphereGeometry(0.11, 6, 4), INK, { x, y: 3.55, z: 0.95, shadow: false }));
  for (const y of [1.6, 2.1]) group.add(tools.mesh(new THREE.SphereGeometry(0.13, 6, 4), INK, { y, z: 1.45, shadow: false }));
  return group;
}

/** A wreath with a red bow, facing +z, about 1.3 across. */
export function createWreath(tools: FestiveTools) {
  const group = new THREE.Group();
  group.add(tools.mesh(new THREE.TorusGeometry(0.55, 0.2, 8, 18), DARK_GREEN, { shadow: false }));
  group.add(tools.mesh(new THREE.BoxGeometry(0.4, 0.3, 0.2), RED, { y: -0.55, z: 0.12, shadow: false }));
  for (const [i, angle] of [0.6, 2.2, 3.6, 5].entries()) {
    group.add(tools.mesh(bulbGeometry(0.1), tools.bulbs[i % tools.bulbs.length]!, { x: Math.cos(angle) * 0.55, y: Math.sin(angle) * 0.55, z: 0.18, shadow: false }));
  }
  return group;
}

/** A red bow, its knot at the origin, facing +z, about 1 across. */
function bow(tools: FestiveTools) {
  const group = new THREE.Group();
  for (const side of [-1, 1]) {
    const loop = tools.mesh(new THREE.TorusGeometry(0.22, 0.09, 6, 10), RED, { x: side * 0.26, shadow: false });
    loop.scale.y = 0.75;
    const tail = tools.mesh(new THREE.BoxGeometry(0.12, 0.5, 0.06), RED, { x: side * 0.12, y: -0.3, shadow: false });
    tail.rotation.z = side * 0.35;
    group.add(loop, tail);
  }
  group.add(tools.mesh(new THREE.SphereGeometry(0.13, 8, 6), RED, { shadow: false }));
  return group;
}

/**
 * A pine garland from `from` to `to` with lights on it, about 2.4 apart. It sags between red
 * bows, which come every two lights.
 */
export function addLightString(parent: THREE.Object3D, tools: FestiveTools, from: THREE.Vector3, to: THREE.Vector3, sag = 0.35) {
  const spots = bulbSpots(from.distanceTo(to), 2.4);
  const swags = Math.max(1, Math.round(spots.length / 2));
  const along = (share: number) => {
    const at = from.clone().lerp(to, share);
    const t = (share * swags) % 1;
    at.y -= sag * 4 * t * (1 - t);
    return at;
  };
  const points = Array.from({ length: swags * 6 + 1 }, (_, i) => along(i / (swags * 6)));
  const garland = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), swags * 8, 0.2, 5);
  parent.add(tools.mesh(garland, DARK_GREEN, { shadow: false }));
  spots.forEach((share, i) => {
    const at = along(share);
    parent.add(tools.mesh(bulbGeometry(0.3), tools.bulbs[i % tools.bulbs.length]!, { x: at.x, y: at.y - 0.25, z: at.z, shadow: false }));
  });
  const facing = Math.atan2(to.x - from.x, to.z - from.z) - Math.PI / 2;
  for (let i = 0; i <= swags; i++) {
    const knot = bow(tools);
    knot.position.copy(along(i / swags));
    knot.rotation.y = facing;
    parent.add(knot);
  }
}

/**
 * Santa, about 3.6 tall, facing +z, with his sack. `wave` is his raised arm, which the scene
 * rocks to and fro.
 */
export function createSanta(tools: FestiveTools) {
  const group = new THREE.Group();
  for (const x of [-0.45, 0.45]) group.add(tools.mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.5, 10), INK, { x, y: 0.25 }));
  group.add(tools.mesh(new THREE.CylinderGeometry(1.05, 1.3, 1.9, 14), RED, { y: 1.35 }));
  group.add(tools.mesh(new THREE.CylinderGeometry(1.32, 1.32, 0.3, 14), WHITE, { y: 0.45, shadow: false }));
  group.add(tools.mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.3, 14), INK, { y: 1.45, shadow: false }));
  group.add(tools.mesh(new THREE.BoxGeometry(0.5, 0.4, 0.1), GOLD, { y: 1.45, z: 1.2, shadow: false }));
  group.add(tools.mesh(new THREE.SphereGeometry(0.75, 14, 10), SKIN, { y: 2.75 }));
  const beard = tools.mesh(new THREE.SphereGeometry(0.72, 14, 10), WHITE, { y: 2.45, z: 0.28, shadow: false });
  beard.scale.set(1, 1.1, 0.75);
  group.add(beard);
  group.add(tools.mesh(new THREE.SphereGeometry(0.13, 8, 6), 0xff8f8f, { y: 2.85, z: 0.74, shadow: false }));
  for (const x of [-0.25, 0.25]) group.add(tools.mesh(new THREE.SphereGeometry(0.08, 6, 4), INK, { x, y: 3.02, z: 0.66, shadow: false }));
  const brim = tools.mesh(new THREE.TorusGeometry(0.68, 0.16, 8, 18), WHITE, { y: 3.25, shadow: false });
  brim.rotation.x = Math.PI / 2;
  group.add(brim);
  const hat = tools.mesh(new THREE.ConeGeometry(0.68, 1.4, 12), RED, { y: 3.9, x: 0.15 });
  hat.rotation.z = -0.35;
  group.add(hat);
  group.add(tools.mesh(new THREE.SphereGeometry(0.22, 8, 6), WHITE, { x: 0.55, y: 4.5, shadow: false }));
  // The arm at his side, and the one he waves with, from the shoulder.
  const down = tools.mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 8), RED, { x: -1.15, y: 1.7 });
  down.rotation.z = -0.35;
  group.add(down);
  const wave = new THREE.Group();
  wave.position.set(1.05, 2.15, 0);
  const arm = tools.mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.3, 8), RED, { x: 0.35, y: 0.55 });
  arm.rotation.z = -0.55;
  wave.add(arm, tools.mesh(new THREE.SphereGeometry(0.26, 8, 6), INK, { x: 0.72, y: 1.15 }));
  group.add(wave);
  const sack = tools.mesh(new THREE.SphereGeometry(0.9, 12, 8), 0xb5835a, { x: -1.4, y: 0.95, z: -0.7 });
  sack.scale.set(0.9, 1.15, 0.9);
  group.add(sack);
  return { group, wave };
}

function reindeer(tools: FestiveTools, x: number, nose: boolean) {
  const group = new THREE.Group();
  group.position.x = x;
  const body = tools.mesh(new THREE.SphereGeometry(1, 12, 8), BROWN, { y: 1.6 });
  body.scale.set(1.5, 0.75, 0.7);
  group.add(body);
  for (const [lx, lz] of [[-0.9, -0.3], [-0.9, 0.3], [0.9, -0.3], [0.9, 0.3]] as const) {
    group.add(tools.mesh(new THREE.CylinderGeometry(0.12, 0.1, 1.2, 6), 0x7a4f32, { x: lx, y: 0.8, z: lz }));
  }
  const neck = tools.mesh(new THREE.CylinderGeometry(0.28, 0.35, 1.2, 8), BROWN, { x: 1.4, y: 2.3 });
  neck.rotation.z = -0.6;
  group.add(neck);
  group.add(tools.mesh(new THREE.SphereGeometry(0.5, 10, 8), BROWN, { x: 1.85, y: 2.85 }));
  group.add(tools.mesh(new THREE.SphereGeometry(0.17, 8, 6), nose ? tools.bulbs[0]! : tools.mat(0x4a3326), { x: 2.35, y: 2.8, shadow: false }));
  for (const z of [-0.25, 0.25]) {
    const antler = tools.mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.9, 5), 0x7a4f32, { x: 1.7, y: 3.55, z });
    antler.rotation.set(z * 1.4, 0, 0.3);
    group.add(antler);
  }
  return group;
}

/**
 * Santa's sleigh with two reindeer ahead of it, the first with a red nose. Faces +x. Fairy
 * lights run round its rim, and a lantern glows at the front.
 */
export function createSleigh(tools: FestiveTools) {
  const group = new THREE.Group();
  group.add(tools.mesh(new THREE.BoxGeometry(3.6, 1.4, 2.2), RED, { y: 1.3 }));
  for (const z of [-1.15, 1.15]) {
    bulbSpots(3.6, 0.6).forEach((share, i) => {
      group.add(tools.mesh(bulbGeometry(0.17), tools.bulbs[i % tools.bulbs.length]!, { x: -1.8 + share * 3.6, y: 1.95, z, shadow: false }));
    });
  }
  group.add(tools.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 5), GOLD, { x: 1.95, y: 2.3, shadow: false }));
  group.add(tools.mesh(new THREE.OctahedronGeometry(0.32), tools.star, { x: 1.95, y: 2.75, shadow: false }));
  group.add(tools.mesh(new THREE.BoxGeometry(0.6, 2, 2.2), RED, { x: -1.6, y: 1.9 }));
  for (const z of [-0.9, 0.9]) {
    group.add(tools.mesh(new THREE.BoxGeometry(4.6, 0.15, 0.15), GOLD, { x: 0.3, y: 0.15, z, shadow: false }));
    const curl = tools.mesh(new THREE.TorusGeometry(0.4, 0.08, 6, 12, Math.PI), GOLD, { x: 2.6, y: 0.55, z, shadow: false });
    curl.rotation.z = -Math.PI / 2;
    group.add(curl);
  }
  // Santa sits at the front, the sack behind him.
  group.add(tools.mesh(new THREE.SphereGeometry(0.75, 12, 8), RED, { x: 0.5, y: 2.4 }));
  group.add(tools.mesh(new THREE.SphereGeometry(0.5, 12, 8), SKIN, { x: 0.6, y: 3.3 }));
  group.add(tools.mesh(new THREE.SphereGeometry(0.45, 10, 8), WHITE, { x: 0.95, y: 3.05, shadow: false }));
  const hat = tools.mesh(new THREE.ConeGeometry(0.45, 0.9, 10), RED, { x: 0.55, y: 3.9 });
  hat.rotation.z = 0.3;
  group.add(hat);
  group.add(tools.mesh(new THREE.SphereGeometry(0.15, 6, 4), WHITE, { x: 0.3, y: 4.3, shadow: false }));
  group.add(tools.mesh(new THREE.SphereGeometry(0.85, 10, 8), 0xb5835a, { x: -0.9, y: 2.4 }));
  group.add(reindeer(tools, 5, false), reindeer(tools, 8.8, true));
  return group;
}
