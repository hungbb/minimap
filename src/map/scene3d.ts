// The 3D scene: same rooms and seats as 2D, drawn with three.js. React owns the
// page around it (Map3D.tsx) and renders each person's badge into the label
// elements this scene hands back.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { TeamState, TeamUser } from '../../shared/types.ts';
import { CLEAR, mixColor, type Ambience, type Conditions } from '../lib/ambience.ts';
import { BODY_RADIUS } from '../lib/drawing.ts';
import { computeLayout, standingArea, type MapLayout, type Zone, type ZoneKind } from '../lib/layout.ts';
import { box, clampTo, contains, grow, pickSpot, steer, type Box } from '../lib/wander.ts';
import { createCharacterBuilder } from './character3d.ts';

export interface CameraPreset {
  id: string;
  name: string;
}

export interface CameraState {
  presets: CameraPreset[];
  active: string | null;
}

export interface ZoneLabelSlot {
  id: string;
  name: string;
  count: number;
  element: HTMLElement;
}

export interface SceneLabels {
  people: ReadonlyMap<string, HTMLElement>;
  zones: ZoneLabelSlot[];
}

export interface Scene3D {
  /** Applies new data, and returns the elements React should render labels into. */
  update(state: TeamState, isDimmed: (user: TeamUser) => boolean): SceneLabels;
  applyPreset(id: string): void;
  focus(username: string): void;
  /** Lets people wander around their room, or sends everyone back to their spot. */
  setWandering(on: boolean): void;
  /** Lights the town for the time of day: sun and sky, moonlight, lamps and windows. */
  setAmbience(look: Ambience): void;
  destroy(): void;
}

interface SceneOptions {
  onPick: (username: string, label: HTMLElement) => void;
  onCamera: (camera: CameraState) => void;
}

type Vec3 = [number, number, number];

interface PresetView extends CameraPreset {
  target: Vec3;
  w: number;
  h: number;
  direction: Vec3;
  tilt: number;
}

interface Character {
  username: string;
  group: THREE.Group;
  inner: THREE.Group;
  bodyMaterial: THREE.Material;
  designKey: string;
  label: CSS2DObject;
  labelElement: HTMLElement;
  phase: number;
  /** Their own spot in the room, where they go back to. */
  seat: THREE.Vector3;
  /** Where they're walking to now. */
  goal: THREE.Vector3;
  zoneId: string;
  zoneKind: ZoneKind;
  /** Where they may wander, or null when the room is too crowded to. */
  area: Box | null;
  /** travel: hurrying to a new room. walk: wandering. idle: standing still. */
  mode: 'travel' | 'walk' | 'idle';
  goingHome: boolean;
  stopsLeft: number;
  waitUntil: number;
  closest: number;
  closerAt: number;
  placed: boolean;
  opacity: number;
  targetOpacity: number;
  scale: number;
  cell: number;
  labelScale: number;
}

interface Tween {
  fromTarget: THREE.Vector3;
  fromPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
  toPosition: THREE.Vector3;
  startedAt: number;
}

interface MeshOptions {
  x?: number;
  y?: number;
  z?: number;
  shadow?: boolean;
}

interface Point {
  x: number;
  z: number;
}

const FRAME_MS = 1000 / 30; // 30 fps is plenty, and kinder to an always-on TV.

// ---- Daylight ----------------------------------------------------------------
// In the daytime the town is lit exactly as it always has been. Around sunrise the
// sun comes up low on one side, around sunset it goes down on the other, and at night
// a cool moon lights the town while lamps and windows glow.
const NOON = new THREE.Vector3(-34, 80, 44);
const SUNRISE = new THREE.Vector3(-110, 18, 30);
const SUNSET = new THREE.Vector3(70, 18, 30);
const MOON = new THREE.Vector3(40, 90, 30);
const LIGHT = {
  sun: '#fff4dc', warmSun: '#ffb27a', moon: '#a9b8ff',
  sky: '#ffffff', nightSky: '#6d7ad0',
  ground: '#cfc2ff', nightGround: '#3d3a78',
  glass: '#8fddf5', nightGlass: '#2c3770',
};

/** A soft round dot for snowflakes. */
function flakeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 226, 122, 0.9)');
  gradient.addColorStop(0.4, 'rgba(255, 226, 122, 0.3)');
  gradient.addColorStop(1, 'rgba(255, 226, 122, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
const WALK_SPEED = 16;
const WANDER_SPEED = 4.2;
const CROWDED_CELL = 6; // Below this, people stay put: there's no room to wander.
const STUCK_SECONDS = 3;
const WALL_H = 5;
const INK = 0x2a2657;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- Shared materials and helpers ---------------------------------------

function toonRamp() {
  const texture = new THREE.DataTexture(new Uint8Array([150, 210, 255]), 3, 1, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function checkerTexture(a: string, b: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = b;
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillRect(32, 32, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createScene3D(root: HTMLElement, { onPick, onCamera }: SceneOptions): Scene3D {
  const ramp = toonRamp();
  const materials = new Map<number, THREE.MeshToonMaterial>();
  const mat = (color: number): THREE.MeshToonMaterial => {
    let material = materials.get(color);
    if (!material) {
      material = new THREE.MeshToonMaterial({ color, gradientMap: ramp });
      materials.set(color, material);
    }
    return material;
  };

  function mesh(geometry: THREE.BufferGeometry, color: number | THREE.Material, { x = 0, y = 0, z = 0, shadow = true }: MeshOptions = {}) {
    const m = new THREE.Mesh(geometry, typeof color === 'object' ? color : mat(color));
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
  }

  // Windows and lamp bulbs have their own materials, so they can glow at night.
  const windowGlass = new THREE.MeshToonMaterial({ color: LIGHT.glass, gradientMap: ramp });
  const lampBulb = new THREE.MeshToonMaterial({ color: 0xffe27a, gradientMap: ramp });
  const lampGlow = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });

  // ---- Scene ------------------------------------------------------------

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 600);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  root.append(renderer.domElement);

  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  root.append(labels.domElement);

  const sky = new THREE.HemisphereLight(0xffffff, 0xcfc2ff, 1.9);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xfff4dc, 1.35);
  sun.position.copy(NOON);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 60, bottom: -60, near: 1, far: 220 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 16;
  controls.maxDistance = 230;
  controls.screenSpacePanning = false;

  const world = new THREE.Group();
  scene.add(world);
  const desks = new THREE.Group();
  scene.add(desks);

  const characters = new Map<string, Character>();
  const zoneLabels = new Map<string, HTMLElement>();
  let labelElements: ReadonlyMap<string, HTMLElement> = new Map();
  let layout: MapLayout = computeLayout([], []);
  let center: Point = { x: 0, z: 0 };
  let buildKey = '';
  let deskKey = '';
  let presets: PresetView[] = [];
  let activePreset: string | null = 'overview';
  let wandering = true;
  // Things on the floor that wandering people walk around.
  let scenery: Box[] = [];
  let deskBoxes = new Map<string, Box>();

  // Marks an area around a point, in world units, as something to walk around.
  const block = (x: number, z: number, halfW: number, halfD: number) => scenery.push(box(x - halfW, z - halfD, halfW * 2, halfD * 2));

  const toWorld = (x: number, y: number): Point => ({ x: x - center.x, z: y - center.z });

  // ---- Lights that come on after dark ------------------------------------
  // Office and lobby ceiling lights, the light at home and the street lamps all light
  // what's around them at night, like the lit rooms and lamp glow in the 2D map.
  // They're switched off in the daytime, so they cost nothing then.
  let nightLights: { light: THREE.PointLight; strength: number }[] = [];
  let lampLevel = 0;

  function addNightLight(parent: THREE.Group, x: number, y: number, z: number, { color = 0xffd9a0, strength, distance }: { color?: number; strength: number; distance: number }) {
    // No decay, just a soft edge at `distance`, so the strengths sit beside the sun and sky's.
    const light = new THREE.PointLight(color, 0, distance, 0);
    light.position.set(x, y, z);
    parent.add(light);
    nightLights.push({ light, strength });
  }

  function applyNightLights() {
    for (const { light, strength } of nightLights) {
      light.intensity = strength * lampLevel;
      light.visible = lampLevel > 0.01;
    }
  }

  // ---- Weather ------------------------------------------------------------
  // Rain or snow falls over the whole island; people's names are drawn on top of the
  // scene, so they stay readable. The clouds themselves drift across the sky behind
  // the canvas (Map3D.tsx); here, invisible ones sail over the town, so only their
  // shadows pass over the rooms and nobody is hidden.
  let weather: Conditions = CLEAR;
  let skyLight = 1.9;
  let flashAt = 0;
  const FALL_FROM = 45;
  // Phones get fewer drops; a TV or desktop gets more.
  const maxDrops = Math.min(1500, Math.round((root.clientWidth || 1000) * 1.4));
  const drops = Array.from({ length: maxDrops }, () => ({ x: 0, y: Math.random() * FALL_FROM, z: 0, depth: 0.6 + Math.random() * 0.4, phase: Math.random() * 6.3 }));
  const dropArea = () => ({ w: layout.width + 12, d: layout.height + 12 });
  const scatter = (drop: (typeof drops)[number]) => {
    const { w, d } = dropArea();
    drop.x = (Math.random() - 0.5) * w;
    drop.z = (Math.random() - 0.5) * d;
  };

  const rainPositions = new Float32Array(maxDrops * 6);
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
  const snowPositions = new Float32Array(maxDrops * 3);
  const snowGeometry = new THREE.BufferGeometry();
  snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const snow = new THREE.Points(snowGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, map: flakeTexture(), transparent: true, depthWrite: false }));
  for (const fall of [rain, snow]) {
    fall.frustumCulled = false;
    fall.visible = false;
    scene.add(fall);
  }

  // Draws nothing, but still casts a shadow.
  const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const puff = new THREE.IcosahedronGeometry(1, 1);
  const PUFFS: [number, number, number, number][] = [[0, 0, 0, 4], [3.6, -0.6, 0.4, 3], [-3.6, -0.7, 0, 3.2], [1.4, 1.5, -0.4, 2.8], [-1.6, 1, 0.6, 2.4]];
  function makeCloud() {
    const cloud = new THREE.Group();
    for (const [x, y, z, size] of PUFFS) {
      const part = new THREE.Mesh(puff, shadowOnly);
      part.position.set(x, y, z);
      part.scale.set(size, size * 0.72, size * 0.85);
      part.castShadow = true;
      cloud.add(part);
    }
    scene.add(cloud);
    return cloud;
  }
  const clouds = Array.from({ length: 6 }, (_, i) => ({
    shadow: makeCloud(),
    speed: 1.2 + (i % 3) * 0.5,
    start: i / 6 + Math.random() * 0.1,
    size: 0.8 + ((i * 7) % 5) * 0.12,
    lane: i,
  }));

  function placeClouds(time: number) {
    const { w, d } = dropArea();
    const span = w + 40;
    const shown = Math.round(weather.clouds * clouds.length);
    for (const [i, cloud] of clouds.entries()) {
      const visible = i < shown;
      cloud.shadow.visible = visible;
      if (!visible) continue;
      const moved = reducedMotion ? 0 : time * cloud.speed;
      const x = ((((cloud.start * span + moved) % span) + span) % span) - span / 2;
      cloud.shadow.scale.setScalar(cloud.size * 1.5);
      cloud.shadow.position.set(x * 0.8, 42, -d / 2 + ((cloud.lane * 0.37) % 1) * d);
    }
  }

  function animateWeather(dt: number, time: number) {
    placeClouds(time);
    // A rare, soft brightening of the sky in a storm: never a strobe.
    let flash = 0;
    if (weather.storm && !reducedMotion) {
      if (time > flashAt + 1.2) flashAt = time + 15 + Math.random() * 15;
      const since = time - flashAt;
      if (since > 0) flash = since < 0.25 ? since / 0.25 : Math.max(0, 1 - (since - 0.25) / 0.9);
    }
    sky.intensity = skyLight + flash * 1.4;

    const kind = weather.precipitation;
    rain.visible = kind === 'rain' || kind === 'drizzle';
    snow.visible = kind === 'snow';
    if (kind === 'none') return;
    const count = Math.round(maxDrops * weather.intensity);
    const snowing = kind === 'snow';
    const speed = snowing ? 3.5 : kind === 'drizzle' ? 26 : 40;
    const blow = snowing ? weather.wind * 3 : 1.5 + weather.wind * 9;
    const length = kind === 'drizzle' ? 0.8 : 1.7;
    const { w } = dropArea();
    for (let i = 0; i < count; i++) {
      const drop = drops[i]!;
      if (!drop.x && !drop.z) scatter(drop);
      if (!reducedMotion) {
        drop.y -= speed * drop.depth * dt;
        drop.x += (blow + (snowing ? Math.sin(time * 1.3 + drop.phase) * 0.8 : 0)) * dt;
        if (drop.y < 0) {
          drop.y += FALL_FROM;
          scatter(drop);
        }
        if (drop.x > w / 2) drop.x -= w;
      }
      if (snowing) {
        snowPositions.set([drop.x, drop.y, drop.z], i * 3);
      } else {
        const lean = (blow / speed) * length;
        rainPositions.set([drop.x - lean, drop.y + length, drop.z, drop.x, drop.y, drop.z], i * 6);
      }
    }
    const geometry = snowing ? snowGeometry : rainGeometry;
    geometry.attributes.position!.needsUpdate = true;
    geometry.setDrawRange(0, snowing ? count : count * 2);
  }

  // ---- Building the rooms -----------------------------------------------

  function addPlant(parent: THREE.Group, x: number, z: number) {
    block(x, z, 0.9, 0.9);
    parent.add(mesh(new THREE.CylinderGeometry(0.9, 0.65, 1.3, 10), 0xff9c7a, { x, y: 1.65, z }));
    const leaf = new THREE.ConeGeometry(1.2, 2.9, 7);
    parent.add(mesh(leaf, 0x63c96c, { x, y: 3.7, z }));
    parent.add(mesh(new THREE.ConeGeometry(0.9, 2.2, 7), 0x7ad67f, { x, y: 5, z }));
  }

  function addTree(parent: THREE.Group, x: number, z: number) {
    block(x, z, 1.2, 1.2);
    parent.add(mesh(new THREE.CylinderGeometry(0.55, 0.75, 3, 8), 0xc99467, { x, y: 2.5, z }));
    parent.add(mesh(new THREE.IcosahedronGeometry(2.5, 1), 0x63c96c, { x, y: 5.6, z }));
    parent.add(mesh(new THREE.IcosahedronGeometry(1.7, 1), 0x7ad67f, { x: x + 1, y: 7, z: z + 0.4 }));
  }

  function addOffice(group: THREE.Group, z: Zone, c: Point) {
    const tiles = checkerTexture('#e6deff', '#f4f0ff');
    tiles.repeat.set(z.w / 5, z.h / 5);
    const floor = new THREE.MeshToonMaterial({ map: tiles, gradientMap: ramp });
    group.add(mesh(new THREE.BoxGeometry(z.w, 1, z.h), floor, { ...c, y: 0.5, shadow: false }));

    // Back and left walls only, cut away so the room stays visible.
    const backWall = mesh(new THREE.BoxGeometry(z.w, WALL_H, 0.7), 0xfff4fa, { x: c.x, y: 1 + WALL_H / 2, z: c.z - z.h / 2 + 0.35 });
    const sideWall = mesh(new THREE.BoxGeometry(0.7, WALL_H, z.h), 0xf8ebff, { x: c.x - z.w / 2 + 0.35, y: 1 + WALL_H / 2, z: c.z });
    group.add(backWall, sideWall);

    // Windows along the back wall.
    const windows = Math.max(1, Math.floor(z.w / 11));
    for (let i = 0; i < windows; i++) {
      const wx = c.x - z.w / 2 + ((i + 0.5) * z.w) / windows;
      group.add(mesh(new THREE.BoxGeometry(5, 2.6, 0.2), windowGlass, { x: wx, y: 3.9, z: c.z - z.h / 2 + 0.75, shadow: false }));
    }
    addPlant(group, c.x + z.w / 2 - 2.2, c.z - z.h / 2 + 2.4);
    addPlant(group, c.x - z.w / 2 + 2.4, c.z + z.h / 2 - 2.4);
    addNightLight(group, c.x, WALL_H + 4, c.z - z.h * 0.1, { strength: 2.6, distance: Math.max(z.w, z.h) * 0.72 });
  }

  function addWfh(group: THREE.Group, z: Zone, c: Point) {
    group.add(mesh(new THREE.BoxGeometry(z.w, 1, z.h), 0xa4e8c0, { ...c, y: 0.5, shadow: false }));
    const hx = c.x + z.w / 2 - 7;
    const hz = c.z - z.h / 2 + 6;
    group.add(mesh(new THREE.BoxGeometry(8, 4.6, 7), 0xfff4d6, { x: hx, y: 3.3, z: hz }));
    block(hx, hz, 4.4, 3.9);
    const roof = mesh(new THREE.ConeGeometry(6.8, 3.8, 4), 0xff8fb3, { x: hx, y: 7.5, z: hz });
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
    group.add(mesh(new THREE.BoxGeometry(1.8, 3, 0.2), 0xb7a6ff, { x: hx, y: 2.5, z: hz + 3.55, shadow: false }));
    // Lights up at night like the office windows.
    group.add(mesh(new THREE.BoxGeometry(1.6, 1.4, 0.2), windowGlass, { x: hx + 2.4, y: 3.6, z: hz + 3.55, shadow: false }));
    addNightLight(group, hx, 4.5, hz + 6, { strength: 1.6, distance: 13 });
    addTree(group, c.x - z.w / 2 + 3, c.z + z.h / 2 - 3);
  }

  function addOff(group: THREE.Group, z: Zone, c: Point) {
    const sandW = z.w * 0.64;
    group.add(mesh(new THREE.BoxGeometry(sandW, 1, z.h), 0xffe9b8, { x: c.x - z.w / 2 + sandW / 2, y: 0.5, z: c.z, shadow: false }));
    const waterW = z.w - sandW;
    group.add(mesh(new THREE.BoxGeometry(waterW, 0.8, z.h), 0x8fddf5, { x: c.x + z.w / 2 - waterW / 2, y: 0.4, z: c.z, shadow: false }));
    // Kept low and to one side, so it doesn't block the view of the street behind it.
    const px = c.x - z.w / 2 + sandW * 0.94;
    const pz = c.z - z.h / 2 + 3;
    group.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 3.4, 6), 0xffffff, { x: px, y: 2.7, z: pz }));
    block(px, pz, 0.6, 0.6);
    group.add(mesh(new THREE.ConeGeometry(3, 1.3, 10), 0xff8fb3, { x: px, y: 4.8, z: pz }));
  }

  function addLobby(group: THREE.Group, z: Zone, c: Point) {
    group.add(mesh(new THREE.BoxGeometry(z.w, 1, z.h), 0xffe0ec, { ...c, y: 0.5, shadow: false }));
    group.add(mesh(new THREE.BoxGeometry(9, 0.2, 3.6), 0xffe27a, { x: c.x + z.w / 2 - 7, y: 1.1, z: c.z + z.h / 2 - 3, shadow: false }));
    addNightLight(group, c.x, 7, c.z, { strength: 1.8, distance: Math.max(z.w, z.h) * 0.75 });
  }

  function addLampPost(group: THREE.Group, x: number, z: number) {
    block(x, z, 0.5, 0.5);
    group.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 6, 8), INK, { x, y: 4, z }));
    group.add(mesh(new THREE.SphereGeometry(0.6, 12, 8), lampBulb, { x, y: 7.2, z }));
    const glow = new THREE.Sprite(lampGlow);
    glow.position.set(x, 7.2, z);
    glow.scale.setScalar(6);
    group.add(glow);
    addNightLight(group, x, 6.6, z + 0.6, { color: 0xffd27a, strength: 2.8, distance: 17 });
  }

  function addCar(group: THREE.Group, x: number, z: number) {
    block(x, z, 3.9, 1.8);
    group.add(mesh(new THREE.BoxGeometry(7.5, 1.5, 3.2), 0xff8fb3, { x, y: 2, z }));
    group.add(mesh(new THREE.BoxGeometry(4, 1.3, 2.8), 0xdfe3ff, { x: x - 0.3, y: 3.3, z }));
    for (const wheelX of [x - 2.4, x + 2.4]) {
      for (const wheelZ of [z - 1.65, z + 1.65]) {
        const wheel = mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.5, 14), INK, { x: wheelX, y: 1.5, z: wheelZ });
        wheel.rotation.x = Math.PI / 2;
        group.add(wheel);
      }
    }
  }

  // Runs off both sides of the island: a pavement, then the road and its markings.
  function addStreet(group: THREE.Group, z: Zone, c: Point) {
    const width = layout.width + 8;
    const pavement = z.h * 0.3;
    const roadDepth = z.h - pavement;
    const pavementZ = c.z - z.h / 2 + pavement / 2;
    const roadZ = c.z + pavement / 2;
    group.add(mesh(new THREE.BoxGeometry(width, 1, roadDepth), 0x8d8ba5, { y: 0.5, z: roadZ, shadow: false }));
    group.add(mesh(new THREE.BoxGeometry(width, 1.15, pavement), 0xefe9f7, { y: 0.575, z: pavementZ, shadow: false }));

    const paint = 0xffffff;
    for (let x = -width / 2 + 3; x < width / 2; x += 7) {
      group.add(mesh(new THREE.BoxGeometry(3.5, 0.05, 0.3), paint, { x, y: 1.03, z: roadZ, shadow: false }));
    }
    const crosswalkX = -2;
    for (let i = 0; i < 5; i++) {
      const stripeZ = roadZ - roadDepth / 2 + 1 + (i * (roadDepth - 1.5)) / 4;
      group.add(mesh(new THREE.BoxGeometry(4, 0.06, 0.7), paint, { x: crosswalkX, y: 1.04, z: stripeZ, shadow: false }));
    }

    addLampPost(group, -width * 0.32, pavementZ);
    addLampPost(group, width * 0.24, pavementZ);
    addCar(group, width * 0.4, roadZ + 1);
  }

  const BUILDERS: Record<ZoneKind, (group: THREE.Group, z: Zone, c: Point) => void> = { office: addOffice, wfh: addWfh, off: addOff, lobby: addLobby, street: addStreet };

  function zoneCenter(z: Zone): Point {
    return toWorld(z.x + z.w / 2, z.y + z.h / 2);
  }

  function buildWorld() {
    disposeGroup(world);
    nightLights = [];
    zoneLabels.clear();
    scenery = [];
    center = { x: layout.width / 2, z: layout.height / 2 };

    // A rounded grass island under everything.
    const shape = new THREE.Shape();
    const w = layout.width + 8;
    const h = layout.height + 8;
    const r = 7;
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const island = mesh(new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false }), 0xbdf0d2, { y: 0, shadow: false });
    island.rotation.x = Math.PI / 2;
    world.add(island);

    if (layout.park) {
      const { x, y, w, h } = layout.park;
      const middle = toWorld(x + w / 2, y + h / 2);
      addTree(world, middle.x - w * 0.3, middle.z);
      addTree(world, middle.x + w * 0.05, middle.z - h * 0.15);
      addTree(world, middle.x + w * 0.32, middle.z + h * 0.1);
    }

    for (const z of layout.zones) {
      const c = zoneCenter(z);
      BUILDERS[z.kind](world, z, c);

      const label = document.createElement('div');
      const object = new CSS2DObject(label);
      object.position.set(c.x - z.w / 2 + 2, z.kind === 'office' ? WALL_H + 2.5 : 3, c.z - z.h / 2 + 0.5);
      object.center.set(0, 0.5);
      world.add(object);
      zoneLabels.set(z.id, label);
    }

    buildPresets();
    applyNightLights();
  }

  function buildDesks() {
    disposeGroup(desks);
    deskBoxes = new Map();
    for (const [username, seat] of layout.seats) {
      if (seat.zone.kind !== 'office') continue;
      const { x, z } = toWorld(seat.x, seat.y);
      const size = deskSize(seat.cell);
      deskBoxes.set(username, box(x - 1.7 * size, z + 1.65 * size, 3.4 * size, 1.4 * size));
      // Low and in front of the body, with the laptop to one side, so the face stays visible.
      desks.add(mesh(new THREE.BoxGeometry(3.4 * size, 0.25 * size, 1.4 * size), 0xffd9a0, { x, y: 1 + 0.65 * size, z: z + 2.35 * size }));
      desks.add(mesh(new THREE.BoxGeometry(3.1 * size, 0.55 * size, 0.2 * size), 0xf0b878, { x, y: 1 + 0.3 * size, z: z + 2.85 * size }));
      desks.add(mesh(new THREE.BoxGeometry(0.95 * size, 0.65 * size, 0.1 * size), 0xdfe3ff, { x: x + 1.15 * size, y: 1 + 1.05 * size, z: z + 2.15 * size }));
    }
  }

  // Scales furniture and people down when a room gets crowded.
  function deskSize(cell: number): number {
    return Math.max(0.9, Math.min(cell / 7, 1.5));
  }

  function disposeGroup(group: THREE.Group) {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        // Tiled floors have their own material and texture; the rest are shared.
        const material = child.material as THREE.MeshToonMaterial;
        if (material.map) {
          material.map.dispose();
          material.dispose();
        }
      }
      if (child instanceof CSS2DObject) child.element.remove();
    }
  }

  // ---- Characters -------------------------------------------------------

  const buildBody = createCharacterBuilder({ ramp, mat, mesh });

  function createCharacter(user: TeamUser, phase: number): Character {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    const bodyMaterial = buildBody(inner, user);

    // CSS2DRenderer owns the anchor's transform, so this inner element can scale.
    const labelElement = document.createElement('div');
    Object.assign(labelElement.style, { display: 'flex', justifyContent: 'center', transformOrigin: '50% 100%' });
    const anchor = document.createElement('div');
    anchor.append(labelElement);
    const label = new CSS2DObject(anchor);
    label.position.set(0, 3.3, 0);
    label.center.set(0.5, 1);
    group.add(label);
    scene.add(group);

    return {
      username: user.username,
      designKey: JSON.stringify(user.look),
      bodyMaterial,
      group,
      inner,
      label,
      labelElement,
      phase,
      seat: new THREE.Vector3(),
      goal: new THREE.Vector3(),
      zoneId: '',
      zoneKind: 'lobby',
      area: null,
      mode: 'idle',
      goingHome: true,
      stopsLeft: 0,
      waitUntil: 0,
      closest: Infinity,
      closerAt: 0,
      placed: false,
      opacity: 1,
      targetOpacity: 1,
      scale: 1,
      cell: 10,
      labelScale: 0,
    };
  }

  function clearBody(character: Character) {
    character.inner.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      (node.userData.fadeMaterial as THREE.Material | undefined)?.dispose();
    });
    character.bodyMaterial.dispose();
    character.inner.clear();
  }

  function destroyCharacter(character: Character) {
    scene.remove(character.group);
    character.label.element.remove();
    clearBody(character);
  }

  // Someone saved a new look, so swap it in without moving them.
  function redecorate(character: Character, user: TeamUser, designKey: string) {
    clearBody(character);
    character.bodyMaterial = buildBody(character.inner, user);
    character.designKey = designKey;
    if (character.opacity < 1) setOpacity(character, character.opacity);
  }

  function setOpacity(character: Character, value: number) {
    character.opacity = value;
    character.group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (!node.userData.fadeMaterial) node.userData.fadeMaterial = (node.material as THREE.Material).clone();
      const material = node.userData.fadeMaterial as THREE.Material;
      node.material = material;
      material.transparent = value < 1;
      material.opacity = value;
      material.depthWrite = value >= 1;
    });
  }

  // ---- Camera -----------------------------------------------------------

  // How far back the camera must sit for an area of this size to fit on screen.
  function fitDistance(w: number, h: number, tilt: number): number {
    const span = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return Math.max(w / (span * camera.aspect), (h * tilt) / span);
  }

  function buildPresets() {
    const all = { w: layout.width + 8, h: layout.height + 8 };
    presets = [
      { id: 'overview', name: 'Overview', target: [0, 0, 1], ...all, direction: [0, 0.76, 0.64], tilt: 0.86 },
      { id: 'top', name: 'From above', target: [0, 0, 0], ...all, direction: [0, 1, 0.001], tilt: 1.12 },
    ];
    for (const z of layout.zones) {
      if (z.kind === 'lobby') continue;
      const c = zoneCenter(z);
      // The street spans the whole map, so its view frames the middle where people stroll.
      const viewWidth = z.kind === 'street' ? z.w * 0.7 : z.w + 6;
      presets.push({ id: z.id, name: z.name, target: [c.x, 0, c.z], w: viewWidth, h: z.h + 6, direction: [0, 0.6, 0.8], tilt: 0.85 });
    }
    reportCamera();
  }

  function reportCamera() {
    onCamera({ presets: presets.map(({ id, name }) => ({ id, name })), active: activePreset });
  }

  let tween: Tween | null = null;

  function flyTo(targetVec: THREE.Vector3, positionVec: THREE.Vector3, immediate = false) {
    // Clears leftover momentum from a drag, which would otherwise skew the landing.
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;

    if (immediate || reducedMotion) {
      controls.target.copy(targetVec);
      camera.position.copy(positionVec);
      tween = null;
      controls.update();
      return;
    }
    tween = {
      fromTarget: controls.target.clone(),
      fromPosition: camera.position.clone(),
      toTarget: targetVec,
      toPosition: positionVec,
      startedAt: performance.now(),
    };
  }

  function applyPreset(id: string, immediate = false) {
    const preset = presets.find((p) => p.id === id) ?? presets[0];
    if (!preset) return;
    activePreset = preset.id;
    const target = new THREE.Vector3(...preset.target);
    const direction = new THREE.Vector3(...preset.direction).normalize();
    const position = target.clone().addScaledVector(direction, fitDistance(preset.w, preset.h, preset.tilt));
    flyTo(target, position, immediate);
    reportCamera();
  }

  controls.addEventListener('start', () => {
    tween = null;
    activePreset = null;
    reportCamera();
  });

  // ---- Clicking characters ----------------------------------------------

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: { x: number; y: number } | null = null;

  function onPointerDown(e: PointerEvent) {
    downAt = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: PointerEvent) {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const meshes = [...characters.values()].map((c) => c.group);
    const hit = raycaster.intersectObjects(meshes, true).find((h) => h.object.userData.username);
    const username = hit?.object.userData.username as string | undefined;
    const character = username ? characters.get(username) : undefined;
    if (username && character) onPick(username, character.labelElement);
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  // ---- Applying data ----------------------------------------------------

  function apply(state: TeamState, isDimmed: (user: TeamUser) => boolean): SceneLabels {
    layout = computeLayout(state.places, state.users);

    // Rooms change size with their people, which means rebuilding the town.
    const key = layout.zones.map((z) => [z.id, z.name, z.x, z.y, z.w, z.h].join()).join(';');
    const isFirstBuild = !buildKey;
    if (key !== buildKey) {
      buildKey = key;
      buildWorld();
    }
    if (isFirstBuild) applyPreset('overview', true);

    const nextDeskKey = [...layout.seats.entries()].map(([u, s]) => `${u}:${s.x}:${s.y}:${s.zone.kind}`).join();
    if (nextDeskKey !== deskKey) {
      deskKey = nextDeskKey;
      buildDesks();
    }

    const now = performance.now() / 1000;
    const seen = new Set<string>();
    let changed = false;
    state.users.forEach((user, i) => {
      const seat = layout.seats.get(user.username);
      if (!seat) return;
      seen.add(user.username);
      let character = characters.get(user.username);
      if (!character) {
        character = createCharacter(user, i * 0.7);
        characters.set(user.username, character);
        changed = true;
      }
      const designKey = JSON.stringify(user.look);
      if (designKey !== character.designKey) redecorate(character, user, designKey);
      const { x, z } = toWorld(seat.x, seat.y);
      const seatMoved = character.seat.distanceTo(new THREE.Vector3(x, 1, z)) > 0.05;
      const changedRoom = character.zoneId !== seat.zone.id;
      character.seat.set(x, 1, z);
      character.zoneId = seat.zone.id;
      character.zoneKind = seat.zone.kind;
      character.scale = deskSize(seat.cell);
      character.cell = seat.cell;
      character.area = seat.cell >= CROWDED_CELL ? wanderArea(seat.zone, character.scale) : null;
      character.targetOpacity = isDimmed(user) ? 0.22 : 1;
      if (!character.placed || reducedMotion) {
        character.group.position.copy(character.seat);
        character.goal.copy(character.seat);
        character.mode = 'idle';
        character.goingHome = true;
        // Spread out when people first set off, so they don't all move at once.
        character.waitUntil = now + Math.random() * restAtSeat(character);
        character.placed = true;
      } else if (changedRoom || (character.goingHome && seatMoved) || !character.area || !contains(character.area, character.goal)) {
        // Moved room, or the room changed shape: hurry to the new spot, as before.
        character.goal.copy(character.seat);
        character.goingHome = true;
        if (character.group.position.distanceTo(character.seat) > 0.05) character.mode = 'travel';
      }
    });

    for (const [username, character] of characters) {
      if (!seen.has(username)) {
        destroyCharacter(character);
        characters.delete(username);
        changed = true;
      }
    }

    // A new map only when people come or go, so React re-renders just for that.
    if (changed) labelElements = new Map([...characters].map(([username, c]) => [username, c.labelElement]));

    const zones = layout.zones.flatMap(({ id, name, count }) => {
      const element = zoneLabels.get(id);
      return element ? [{ id, name, count, element }] : [];
    });
    return { people: labelElements, zones };
  }

  // ---- Animation --------------------------------------------------------

  function animate(dt: number, time: number) {
    if (tween) {
      // Based on real time, so a slow machine lands on schedule with fewer frames.
      const t = Math.min(1, (performance.now() - tween.startedAt) / 900);
      const k = t * t * (3 - 2 * t);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
      camera.position.lerpVectors(tween.fromPosition, tween.toPosition, k);
      if (t >= 1) tween = null;
    }
    controls.update();

    for (const c of characters.values()) {
      const { group, inner } = c;
      const size = c.scale;
      group.scale.setScalar(size);

      // Shrink labels when neighbours would overlap at the current zoom.
      const pixelsPerUnit = root.clientHeight / (2 * group.position.distanceTo(camera.position) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const labelScale = Math.round(Math.max(root.clientWidth < 600 ? 0.42 : 0.55, Math.min((c.cell * pixelsPerUnit) / 104, 1)) * 20) / 20;
      if (labelScale !== c.labelScale) {
        c.labelScale = labelScale;
        c.labelElement.style.transform = `scale(${labelScale})`;
      }

      if (c.mode === 'idle' && time >= c.waitUntil && wandering && c.area && !reducedMotion) setOff(c, time);

      if (c.mode === 'idle') {
        // Standing still: turn to face the camera and breathe.
        inner.position.y = 0;
        inner.rotation.y += shortestAngle(-inner.rotation.y) * Math.min(1, dt * 4);
        if (!reducedMotion) {
          const breathe = Math.sin(time * 2.2 + c.phase) * 0.025;
          inner.scale.set(1 + breathe, 1 - breathe, 1 + breathe);
        }
      } else {
        walk(c, dt, time);
      }

      if (Math.abs(c.opacity - c.targetOpacity) > 0.005) {
        setOpacity(c, c.opacity + (c.targetOpacity - c.opacity) * Math.min(1, dt * 8));
      }
    }
  }

  // ---- Wandering ----------------------------------------------------------

  // A room's floor, kept far enough in from its edges that bodies stay inside.
  function wanderArea(z: Zone, scale: number): Box {
    const area = standingArea(z);
    const { x, z: top } = toWorld(area.x, area.y);
    return grow(box(x, top, area.w, area.h), -Math.min(BODY_RADIUS * scale * 0.5, area.w / 4, area.h / 4));
  }

  // People at a desk mostly work, and only now and then get up for a stroll.
  function restAtSeat(c: Character): number {
    return c.zoneKind === 'office' ? 12 + Math.random() * 25 : 3 + Math.random() * 5;
  }

  function bodyRadius(c: Character): number {
    return BODY_RADIUS * c.scale;
  }

  function obstaclesFor(c: Character): Box[] {
    const own = deskBoxes.get(c.username);
    return [...scenery, ...[...deskBoxes.values()].filter((d) => d !== own)];
  }

  function walkTo(c: Character, x: number, z: number, home: boolean, time: number) {
    c.goal.set(x, 1, z);
    c.goingHome = home;
    c.mode = 'walk';
    c.closest = Infinity;
    c.closerAt = time;
  }

  function goHome(c: Character, time: number) {
    walkTo(c, c.seat.x, c.seat.z, true, time);
  }

  // Done standing around: pick the next place to wander to, or head back.
  function setOff(c: Character, time: number) {
    if (!c.area) return;
    if (c.goingHome) c.stopsLeft = c.zoneKind === 'office' ? 1 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 4);
    if (c.stopsLeft <= 0) {
      goHome(c, time);
      return;
    }
    const others = [...characters.values()].filter((o) => o !== c && o.zoneId === c.zoneId).flatMap((o) => [o.group.position, o.goal]);
    const blocked = obstaclesFor(c).map((b) => grow(b, bodyRadius(c)));
    const spot = pickSpot(c.area, c.group.position, others, blocked);
    if (!spot) {
      c.waitUntil = time + 2;
      return;
    }
    c.stopsLeft -= 1;
    walkTo(c, spot.x, spot.z, false, time);
  }

  function arrive(c: Character, time: number) {
    c.mode = 'idle';
    c.waitUntil = time + (c.goingHome ? restAtSeat(c) : 1.5 + Math.random() * 3);
  }

  function walk(c: Character, dt: number, time: number) {
    const { group, inner, goal } = c;
    const position = group.position;
    const distance = Math.hypot(goal.x - position.x, goal.z - position.z);
    const travelling = c.mode === 'travel';
    if (distance <= (travelling ? 0.05 : 0.3)) {
      position.x = goal.x;
      position.z = goal.z;
      arrive(c, time);
      return;
    }

    let direction = { x: (goal.x - position.x) / distance, z: (goal.z - position.z) / distance };
    if (!travelling) {
      const radius = bodyRadius(c);
      direction = steer(position, goal, obstaclesFor(c), radius * 0.9 + 0.3);
      // Step around other people in the same room.
      for (const o of characters.values()) {
        if (o === c || o.zoneId !== c.zoneId) continue;
        const dx = position.x - o.group.position.x;
        const dz = position.z - o.group.position.z;
        const apart = Math.hypot(dx, dz);
        const room = (radius + bodyRadius(o)) * 0.95;
        if (apart > 1e-6 && apart < room) {
          const push = ((room - apart) / room) * 1.5;
          direction = { x: direction.x + (dx / apart) * push, z: direction.z + (dz / apart) * push };
        }
      }
      const length = Math.hypot(direction.x, direction.z) || 1;
      direction = { x: direction.x / length, z: direction.z / length };
    }

    const step = Math.min(distance, (travelling ? WALK_SPEED : WANDER_SPEED) * dt);
    position.x += direction.x * step;
    position.z += direction.z * step;
    if (!travelling && c.area) {
      const inside = clampTo(c.area, position);
      // The seat itself can sit right at the edge of where people wander.
      if (!c.goingHome || distance > 2) {
        position.x = inside.x;
        position.z = inside.z;
      }
    }

    const facing = Math.atan2(direction.x, direction.z);
    inner.rotation.y += shortestAngle(facing - inner.rotation.y) * Math.min(1, dt * (travelling ? 12 : 7));
    inner.position.y = travelling ? Math.abs(Math.sin(time * 11 + c.phase)) * 0.75 : Math.abs(Math.sin(time * 9 + c.phase)) * 0.3;
    inner.scale.set(1, 1, 1);

    // Boxed in by furniture or people: give up on this spot.
    if (!travelling) {
      if (distance < c.closest - 0.5) {
        c.closest = distance;
        c.closerAt = time;
      } else if (time - c.closerAt > STUCK_SECONDS) {
        if (c.goingHome) c.mode = 'travel';
        else goHome(c, time);
      }
    }
  }

  function shortestAngle(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  let raf = 0;
  let last = 0;
  let lastFrame = 0;

  // requestAnimationFrame stops by itself while the tab is hidden.
  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    if (now - lastFrame < FRAME_MS) return;
    const dt = Math.min((now - last) / 1000 || 0, 0.1);
    last = now;
    lastFrame = now;
    animate(dt, now / 1000);
    animateWeather(dt, now / 1000);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = root;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labels.setSize(w, h);
    if (activePreset && presets.length) applyPreset(activePreset, true);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(root);
  resize();
  raf = requestAnimationFrame(loop);

  return {
    update: apply,
    applyPreset: (id) => applyPreset(id),
    setAmbience({ daylight, warmth, phase, lamps, sky: skyColours, weather: now }) {
      weather = now;
      sky.color.set(mixColor(LIGHT.nightSky, LIGHT.sky, daylight));
      sky.groundColor.set(mixColor(LIGHT.nightGround, LIGHT.ground, daylight));
      skyLight = 1.4 + 0.5 * daylight;
      sky.intensity = skyLight;

      sun.color.set(mixColor(LIGHT.moon, mixColor(LIGHT.sun, LIGHT.warmSun, warmth), daylight));
      // Grey skies soften the sunlight and its shadows.
      sun.intensity = (0.65 + 0.7 * daylight) * (1 - now.gloom * 0.55);

      (rain.material as THREE.LineBasicMaterial).color.set(mixColor('#ffffff', '#b8c4ff', 1 - daylight));
      if (now.fog > 0) {
        const colour = mixColor(skyColours.bottom, '#dfe5ee', 0.5 * daylight);
        if (scene.fog instanceof THREE.FogExp2) scene.fog.color.set(colour);
        else scene.fog = new THREE.FogExp2(colour);
        (scene.fog as THREE.FogExp2).density = now.fog * 0.009;
      } else {
        scene.fog = null;
      }
      // Low on the rising or setting side, swinging up to midday as it gets light.
      const low = phase === 'dusk' ? SUNSET : SUNRISE;
      const daySun = low.clone().lerp(NOON, daylight);
      sun.position.copy(MOON).lerp(daySun, Math.min(1, daylight * 3));

      windowGlass.color.set(mixColor(LIGHT.glass, LIGHT.nightGlass, lamps * 0.7));
      windowGlass.emissive.set(0xffc861);
      windowGlass.emissiveIntensity = lamps * 0.9;
      lampBulb.emissive.set(0xffe27a);
      lampBulb.emissiveIntensity = lamps * 0.8;
      lampGlow.opacity = lamps * 0.85;
      lampLevel = lamps;
      applyNightLights();
    },

    setWandering(on) {
      wandering = on;
      const time = performance.now() / 1000;
      for (const c of characters.values()) {
        // Turned back on: set off at different times, not all at once.
        if (on) c.waitUntil = time + Math.random() * restAtSeat(c);
        else if (!c.goingHome) goHome(c, time);
      }
    },
    focus(username) {
      const c = characters.get(username);
      if (!c) return;
      activePreset = null;
      const target = c.group.position.clone();
      target.y = 0;
      const position = target.clone().addScaledVector(new THREE.Vector3(0, 0.6, 0.8), fitDistance(34, 26, 0.85));
      flyTo(target, position);
      reportCamera();
    },
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      scene.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
        (node.userData.fadeMaterial as THREE.Material | undefined)?.dispose();
      });
      for (const character of characters.values()) character.bodyMaterial.dispose();
      for (const material of materials.values()) material.dispose();
      lampGlow.map?.dispose();
      lampGlow.dispose();
      for (const fall of [rain, snow]) {
        fall.geometry.dispose();
        const material = fall.material as THREE.PointsMaterial;
        material.map?.dispose();
        material.dispose();
      }
      puff.dispose();
      shadowOnly.dispose();
      ramp.dispose();
      renderer.dispose();
      renderer.forceContextLoss(); // Browsers allow only a few live 3D contexts.
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}
