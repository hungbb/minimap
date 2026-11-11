// The 3D scene: same rooms and seats as 2D, drawn with three.js. React owns the
// page around it (Map3D.tsx) and renders each person's badge into the label
// elements this scene hands back.
import { officeAssembly } from '../lib/assembly.ts';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Place, TeamState, TeamUser } from '../../shared/types.ts';
import { resultText, type VoteView } from '../../shared/vote.ts';
import { CLEAR, mixColor, type Ambience, type Conditions } from '../lib/ambience.ts';
import { watchContextLoss } from '../lib/contextLoss.ts';
import { fundArt, userFundTier } from '../lib/fundLook.ts';
import { BODY_RADIUS } from '../lib/drawing.ts';
import { boardNotes, voteLink } from '../lib/noticeBoard.ts';
import { DRAG_START_PX, dropPlace, zoneAt } from '../lib/dragMove.ts';
import { computeLayout, noticeBoardSpot, parkActivities, petSpot, standingArea, type MapLayout, type Zone, type ZoneKind } from '../lib/layout.ts';
import { box, clampTo, contains, grow, hopHeight, pickSpot, steer, type Box } from '../lib/wander.ts';
import type { PetShown } from '../lib/petLook.ts';
import type { Reaction, ReactionKind } from '../lib/voteReactions.ts';
import { parkTrees } from '../lib/parkTrees.ts';
import { createTraffic, parkedTraffic, stepTraffic, stepTrafficDodge, streetRoad, type Road, type TrafficDodge } from '../lib/traffic.ts';
import { createTraffic3D } from './traffic3d.ts';
import { createPickerCabinet } from './pickerCabinet3d.ts';
import { createArcadeCabinet } from './arcade3d.ts';
import { createBlimp } from './blimp3d.ts';
import { createOfficeCat, type OfficeCat3D } from './cat3d.ts';
import { createCharacterBuilder } from './character3d.ts';
import { createNoticeBoard, type NoticeBoard3D } from './noticeBoard3d.ts';
import type { VoteMarks } from './types.ts';

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
  arcade: HTMLElement | null;
  picker: HTMLElement | null;
  /** Where the notice board's link goes. */
  board: HTMLElement | null;
  /** Where the office cat's name and button go. */
  pet: HTMLElement | null;
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
  /** The team's votes, for the notice board. */
  setVotes(votes: VoteView[]): void;
  /** Ballots over people who haven't voted, and the blimp with the latest result. Null hides them. */
  setVoteMarks(marks: VoteMarks | null): void;
  /** Plays characters' reactions to votes once (lib/voteReactions.ts). */
  react(list: Reaction[]): void;
  /** The person logged in on this browser, who may drag their own character to another room. */
  setMover(username: string | null): void;
  /** The office cat's name, size and mood (lib/petLook.ts). Null hides it. */
  setPet(pet: PetShown | null): void;
  destroy(): void;
}

interface SceneOptions {
  onArcade: (trigger: HTMLElement) => void;
  /** A click on the office cat. */
  onPet: (trigger: HTMLElement) => void;
  onPicker: (trigger: HTMLElement) => void;
  /** A click on the notice board: the /vote page, or one vote on it. */
  onNoticeBoard: (link: string) => void;
  onPick: (username: string, label: HTMLElement) => void;
  onCamera: (camera: CameraState) => void;
  /** The browser took away the 3D context and didn't give it back. */
  onContextGone: () => void;
  /** The mover dropped their character on another room: its place, or null for Not checked in. */
  onMove: (place: string | null) => void;
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
  /** Held outdoors in the rain or snow. */
  umbrella: THREE.Group;
  /** Floats over their head while they haven't voted on a vote shown on the map. */
  ballot: THREE.Sprite;
  ballotOn: boolean;
  /** When the ballot started to pop away, or -1. */
  ballotPopAt: number;
  /** A reaction to a vote that is playing now. */
  reaction: { kind: ReactionKind; start: number; end: number } | null;
  /** 🙌 or 👏 beside their head while they cheer or clap. Made when first needed. */
  emoji: THREE.Sprite | null;
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
  /** Picked up by the person dragging themselves to another room. */
  held: boolean;
  trafficDodge: TrafficDodge | null;
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
const UMBRELLA_COLOURS = [0xff8fb3, 0x8fc9ff, 0xffe27a, 0xb7a6ff, 0x9fe89a];

/** Each person always carries the same colour of umbrella. */
function umbrellaColour(username: string): number {
  let hash = 0;
  for (const ch of username) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return UMBRELLA_COLOURS[hash % UMBRELLA_COLOURS.length]!;
}

const LIGHT = {
  sun: '#fff4dc', warmSun: '#ffb27a', moon: '#a9b8ff',
  sky: '#ffffff', nightSky: '#6d7ad0',
  ground: '#cfc2ff', nightGround: '#3d3a78',
  glass: '#8fddf5', nightGlass: '#2c3770',
};

// A little paper ballot with a tick box, for people who haven't voted.
function ballotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2a2657';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(8, 4, 48, 56, 6);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeRect(16, 14, 12, 12);
  ctx.strokeRect(16, 36, 12, 12);
  ctx.beginPath();
  for (const y of [20, 42]) {
    ctx.moveTo(34, y);
    ctx.lineTo(48, y);
  }
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const BALLOT_POP_S = 0.4;

function emojiTexture(emoji: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 32, 36);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const CONFETTI_COLOURS = [0xff9cc2, 0xffe27a, 0x8fddf5, 0xbdf0d2, 0xb7a6ff];
const CONFETTI_PIECES = 24;

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
// The office cat trots a little slower than people stroll, and is a bit smaller than them when grown.
const CAT_SPEED = 3.4;
const CAT_SIZE = 2.6;
const CAT_LABEL_CELL = 15; // The biggest seat a room gives, for sizing the cat's name in an empty office.
const CROWDED_CELL = 6; // Below this, people stay put: there's no room to wander.
const STUCK_SECONDS = 3;
const WALL_H = 5;
const INK = 0x2a2657;

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

export function createScene3D(root: HTMLElement, { onPick, onCamera, onContextGone, onArcade, onPet, onPicker, onNoticeBoard, onMove }: SceneOptions): Scene3D {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motion.matches;
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
  const trafficModels = createTraffic3D();
  scene.add(trafficModels.group);
  let traffic = createTraffic();
  let road: Road | null = null;
  let trafficDaylight = 1;
  function motionChanged() {
    reducedMotion = motion.matches;
    traffic = createTraffic();
    trafficModels.clear();
    for (const c of characters.values()) {
      c.trafficDodge = null;
      if (reducedMotion && !c.held) {
        c.group.position.copy(c.seat);
        c.goal.copy(c.seat);
        c.mode = 'idle';
        c.inner.position.y = 0;
        c.inner.rotation.set(0, 0, 0);
        c.inner.scale.setScalar(1);
      }
    }
  }
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 600);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  root.append(renderer.domElement);
  const stopWatchingContext = watchContextLoss(renderer.domElement, onContextGone);

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

  let picker: THREE.Group | null = null;
  let pickerSlot: HTMLElement | null = null;
  let arcade: THREE.Group | null = null;
  let arcadeSlot: HTMLElement | null = null;
  let noticeBoard: NoticeBoard3D | null = null;
  let officeCat: OfficeCat3D | null = null;
  let pet: PetShown | null = null;
  // Where the cat may walk, where it is heading, and when it next sets off.
  let catZoneId = '';
  let catArea: Box | null = null;
  let catGoal: Point | null = null;
  let catAt: Point | null = null;
  let catWaitUntil = 0;
  let catClosest = Infinity;
  let catCloserAt = 0;
  let catLabelScale = 0;
  let places: Place[] = [];
  let votes: VoteView[] = [];
  let boardDrawnAt = 0;
  let boardPulsing = false;
  let voteMarks: VoteMarks | null = null;
  const ballotMap = ballotTexture();
  // The blimp belongs to the sky, not the town, so it stays when the town is rebuilt.
  const blimp = createBlimp();
  blimp.group.visible = false;
  blimp.group.scale.setScalar(1.5);
  scene.add(blimp.group);
  let blimpText = '';
  const emojiMaps: Partial<Record<'cheer' | 'clap', THREE.Texture>> = {};
  let bursts: { points: THREE.Points; speeds: number[]; start: number; end: number }[] = [];
  const world = new THREE.Group();
  scene.add(world);
  const desks = new THREE.Group();
  scene.add(desks);

  const characters = new Map<string, Character>();
  const zoneLabels = new Map<string, HTMLElement>();
  let labelElements: ReadonlyMap<string, HTMLElement> = new Map();
  let layout: MapLayout = computeLayout([], []);
  let portraitLayout = false;
  let center: Point = { x: 0, z: 0 };
  let buildKey = '';
  let assembledOffices = new Set<string>();
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
  // The shared foreground overlay draws clouds, precipitation, fog and lightning.
  // The scene keeps their physical effects: shadows, snow caps, puddles, umbrellas and wind.
  let weather: Conditions = CLEAR;
  const cloudArea = () => ({ w: layout.width + 12, d: layout.height + 12 });

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
    const { w, d } = cloudArea();
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

  // Snow on walls, roofs and trees, puddles on the road, umbrellas and swaying trees.
  const snowMaterial = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp });
  const puddleMaterial = new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0, depthWrite: false });
  let snowCaps: THREE.Mesh[] = [];
  let trees: { tree: THREE.Group; phase: number }[] = [];

  function addSnow(parent: THREE.Object3D, geometry: THREE.BufferGeometry, { x = 0, y = 0, z = 0, squash = 1, turn = 0 } = {}) {
    const cap = mesh(geometry, snowMaterial, { x, y, z, shadow: false });
    cap.scale.y = squash;
    cap.rotation.y = turn;
    cap.visible = weather.precipitation === 'snow';
    parent.add(cap);
    snowCaps.push(cap);
  }

  function makeUmbrella(colour: number) {
    const umbrella = new THREE.Group();
    umbrella.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6), INK, { x: 0.8, y: 2.3, z: 0.3 }));
    umbrella.add(mesh(new THREE.ConeGeometry(2, 0.9, 12), colour, { x: 0.8, y: 4.25, z: 0.3 }));
    umbrella.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), INK, { x: 0.8, y: 4.75, z: 0.3 }));
    umbrella.rotation.z = -0.12;
    umbrella.visible = false;
    return umbrella;
  }

  function showWeatherDetails() {
    const snowing = weather.precipitation === 'snow';
    for (const cap of snowCaps) cap.visible = snowing;
    const wet = weather.precipitation === 'rain' || weather.precipitation === 'drizzle';
    puddleMaterial.opacity = wet ? 0.35 + weather.intensity * 0.35 : 0;
    puddleMaterial.visible = wet;
  }

  function animateWeather(time: number) {
    placeClouds(time);
    // People outdoors open their umbrellas.
    const raining = weather.precipitation !== 'none';
    for (const c of characters.values()) c.umbrella.visible = raining && (c.zoneKind === 'street' || c.zoneKind === 'off');
    const sway = reducedMotion ? 0 : weather.wind;
    for (const { tree, phase } of trees) tree.rotation.z = sway ? Math.sin(time * (1.1 + sway) + phase) * 0.05 * sway : 0;
  }

  // ---- Building the rooms -----------------------------------------------

  function addPlant(parent: THREE.Group, x: number, z: number) {
    block(x, z, 0.9, 0.9);
    parent.add(mesh(new THREE.CylinderGeometry(0.9, 0.65, 1.3, 10), 0xff9c7a, { x, y: 1.65, z }));
    const leaf = new THREE.ConeGeometry(1.2, 2.9, 7);
    parent.add(mesh(leaf, 0x63c96c, { x, y: 3.7, z }));
    parent.add(mesh(new THREE.ConeGeometry(0.9, 2.2, 7), 0x7ad67f, { x, y: 5, z }));
  }

  function addTree(parent: THREE.Group, x: number, z: number, scale = 1) {
    block(x, z, 1.2 * scale, 1.2 * scale);
    // Built around the foot of its trunk, so it sways from there in the wind.
    const tree = new THREE.Group();
    tree.position.set(x, 1, z);
    tree.scale.setScalar(scale);
    tree.add(mesh(new THREE.CylinderGeometry(0.55, 0.75, 3, 8), 0xc99467, { y: 1.5 }));
    tree.add(mesh(new THREE.IcosahedronGeometry(2.5, 1), 0x63c96c, { y: 4.6 }));
    tree.add(mesh(new THREE.IcosahedronGeometry(1.7, 1), 0x7ad67f, { x: 1, y: 6, z: 0.4 }));
    addSnow(tree, new THREE.IcosahedronGeometry(2.1, 1), { y: 6.1, squash: 0.45 });
    addSnow(tree, new THREE.IcosahedronGeometry(1.4, 1), { x: 1, y: 7.1, z: 0.4, squash: 0.45 });
    parent.add(tree);
    trees.push({ tree, phase: x * 0.37 + z * 0.21 });
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
    addSnow(group, new THREE.BoxGeometry(z.w + 0.3, 0.4, 1.1), { x: c.x, y: 1 + WALL_H + 0.2, z: c.z - z.h / 2 + 0.35 });
    addSnow(group, new THREE.BoxGeometry(1.1, 0.4, z.h), { x: c.x - z.w / 2 + 0.35, y: 1 + WALL_H + 0.2, z: c.z });

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
    addSnow(group, new THREE.ConeGeometry(3.6, 2, 4), { x: hx, y: 8.5, z: hz, turn: Math.PI / 4 });
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
    group.add(mesh(new THREE.BoxGeometry(9, 0.2, 3.6), 0xffe27a, { x: c.x - z.w / 2 + 7, y: 1.1, z: c.z + z.h / 2 - 3, shadow: false }));
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

  // Runs off both sides of the island: a pavement, then the road and its markings.
  function addStreet(group: THREE.Group, z: Zone, c: Point) {
    const width = layout.width + 8;
    const origin = toWorld(z.x, z.y);
    // Match the full visible road, which extends past the zone on both sides.
    road = streetRoad({ x: -width / 2, y: origin.z, w: width, h: z.h });
    // Widen across the lane (z) only; front-to-back length (x) stays unchanged.
    road.carWidth *= 1.5;
    const pavement = road.curb - road.minZ;
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

    // Puddles, which shine while it rains.
    for (const [px, pz, size] of [[-0.16, -0.25, 3.2], [0.08, 0.3, 2.4], [0.27, -0.1, 2.8]] as const) {
      const puddle = mesh(new THREE.CircleGeometry(1, 20), puddleMaterial, { x: width * px, y: 1.02, z: roadZ + roadDepth * pz, shadow: false });
      puddle.rotation.x = -Math.PI / 2;
      puddle.scale.set(size, size * 0.45, 1);
      puddle.receiveShadow = false;
      group.add(puddle);
    }

    addLampPost(group, -width * 0.32, pavementZ);
    addLampPost(group, width * 0.24, pavementZ);
  }

  const BUILDERS: Record<ZoneKind, (group: THREE.Group, z: Zone, c: Point) => void> = { office: addOffice, wfh: addWfh, off: addOff, lobby: addLobby, street: addStreet };

  function zoneCenter(z: Zone): Point {
    return toWorld(z.x + z.w / 2, z.y + z.h / 2);
  }

  function buildWorld() {
    trafficModels.clear();
    traffic = createTraffic();
    road = null;
    for (const c of characters.values()) c.trafficDodge = null;
    disposeGroup(world);
    nightLights = [];
    snowCaps = [];
    trees = [];
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
      for (const tree of parkTrees(layout.park)) {
        const at = toWorld(tree.x, tree.y);
        addTree(world, at.x, at.z, tree.size / 7.7);
      }
    }

    for (const z of layout.zones) {
      const c = zoneCenter(z);
      BUILDERS[z.kind](world, z, c);
      if (assembledOffices.has(z.id)) {
        const ring = mesh(new THREE.TorusGeometry(1.2,.14,10,48),0xffdb7d,{x:c.x,y:WALL_H+2,z:c.z-z.h/2});
        world.add(ring);
        world.add(mesh(new THREE.OctahedronGeometry(.65),0xffe9a8,{x:c.x,y:WALL_H+2,z:c.z-z.h/2+.15}));
        const bulbs=Math.max(3,Math.floor(z.w/4));
        for (let i=0;i<bulbs;i++) world.add(mesh(new THREE.SphereGeometry(.32,10,8),i%2 ? 0x9debd0 : 0xffd779,{x:c.x-z.w/2+2+i*(z.w-4)/Math.max(1,bulbs-1),y:WALL_H+.25,z:c.z-z.h/2+.25}));
      }

      const label = document.createElement('div');
      const object = new CSS2DObject(label);
      object.position.set(c.x - z.w / 2 + 2, z.kind === 'office' ? WALL_H + 2.5 : 3, c.z - z.h / 2 + 0.5);
      object.center.set(0, 0.5);
      world.add(object);
      zoneLabels.set(z.id, label);
    }

    arcade = null; arcadeSlot = null; picker = null; pickerSlot = null;
    const activities = parkActivities(layout);
    if (activities) {
      for (const kind of ['arcade', 'picker'] as const) {
        const spot = activities[kind];
        const at = toWorld(spot.x + spot.w / 2, spot.y + spot.h * 0.8);
        const cabinet = kind === 'arcade' ? createArcadeCabinet() : createPickerCabinet();
        cabinet.group.position.set(at.x, 0.1, at.z);
        cabinet.group.rotation.y = -0.12;
        cabinet.group.scale.setScalar(spot.w / 8);
        world.add(cabinet.group);
        block(at.x, at.z, spot.w / 2, spot.w / 3);
        if (kind === 'arcade') { arcade = cabinet.group; arcadeSlot = cabinet.playElement; }
        else { picker = cabinet.group; pickerSlot = cabinet.playElement; }
      }
    }

    // The office cat starts by the plant in the main office, or where it was before the town
    // was rebuilt, and wanders that room's floor (see "The office cat" below).
    officeCat = null;
    catArea = null;
    catGoal = null;
    const catSpot = petSpot(layout, places);
    const catZone = catSpot && layout.zones.find((z) => z.id === catSpot.zoneId);
    if (catSpot && catZone) {
      officeCat = createOfficeCat(CAT_SIZE);
      catZoneId = catZone.id;
      catArea = wanderArea(catZone, 1);
      const start = toWorld(catSpot.x, catSpot.y - catSpot.size * 0.3);
      const at = catAt && contains(catArea, catAt) ? catAt : clampTo(catArea, start);
      officeCat.group.position.set(at.x, 1, at.z);
      officeCat.group.visible = Boolean(pet);
      if (pet) officeCat.set(pet);
      world.add(officeCat.group);
      catWaitUntil = 0;
      catLabelScale = 0;
    }

    // The notice board stands at the back of its spot, facing the camera, lit after dark.
    noticeBoard = null;
    const spot = noticeBoardSpot(layout);
    if (spot) {
      const at = toWorld(spot.x + spot.w / 2, spot.y + spot.h * 0.75);
      noticeBoard = createNoticeBoard();
      noticeBoard.group.position.set(at.x, 1, at.z);
      noticeBoard.group.scale.setScalar(spot.w / 10.5);
      world.add(noticeBoard.group);
      block(at.x, at.z, spot.w / 2, 1);
      addNightLight(world, at.x, 9, at.z + 5, { strength: 1.6, distance: 14 });
      drawBoard(0);
    }

    buildPresets();
    applyNightLights();
  }

  // Shows or hides someone's ballot. One that goes away while the map is open pops.
  function markBallot(c: Character, animate: boolean) {
    const on = voteMarks?.waiting.has(c.username) ?? false;
    if (on === c.ballotOn) return;
    c.ballotOn = on;
    if (on) {
      c.ballotPopAt = -1;
      c.ballot.material.opacity = 1;
      c.ballot.visible = true;
    } else if (animate && !reducedMotion && c.ballot.visible) {
      c.ballotPopAt = performance.now() / 1000;
    } else {
      c.ballot.visible = false;
    }
  }

  // Plays a reaction on top of whatever someone is doing: hops, a wiggle, and 🙌 or 👏.
  function animateReaction(c: Character, time: number) {
    const r = c.reaction;
    if (!r) return;
    const t = time - r.start;
    if (time >= r.end) {
      c.reaction = null;
      c.inner.rotation.z = 0;
      if (c.emoji) c.emoji.visible = false;
      return;
    }
    if (r.kind === 'cheer') c.inner.position.y += hopHeight(t % 0.5, 0.5, 1.1);
    else if (r.kind === 'clap') c.inner.rotation.z = Math.sin(t * 22) * 0.1;
    else c.inner.position.y += hopHeight(t, 0.6);
    if (c.emoji) c.emoji.position.y = 2.9 + Math.min(t * 2, 0.5);
  }

  function confettiAt(position: THREE.Vector3, time: number) {
    const positions = new Float32Array(CONFETTI_PIECES * 3);
    const colours = new Float32Array(CONFETTI_PIECES * 3);
    const speeds: number[] = [];
    const colour = new THREE.Color();
    for (let i = 0; i < CONFETTI_PIECES; i++) {
      const angle = (i / CONFETTI_PIECES) * Math.PI * 2;
      const out = 3 + (i % 4);
      speeds.push(Math.cos(angle) * out, 7 + (i % 3) * 2, Math.sin(angle) * out);
      positions.set([position.x, position.y + 2.5, position.z], i * 3);
      colour.set(CONFETTI_COLOURS[i % CONFETTI_COLOURS.length]!);
      colours.set([colour.r, colour.g, colour.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.7, vertexColors: true, transparent: true }));
    scene.add(points);
    bursts.push({ points, speeds, start: time, end: time + 1.5 });
  }

  function animateBursts(dt: number, time: number) {
    bursts = bursts.filter((burst) => {
      const done = time >= burst.end;
      if (done) {
        scene.remove(burst.points);
        burst.points.geometry.dispose();
        (burst.points.material as THREE.Material).dispose();
        return false;
      }
      const position = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < CONFETTI_PIECES; i++) {
        burst.speeds[i * 3 + 1]! -= 14 * dt;
        position.setXYZ(i, position.getX(i) + burst.speeds[i * 3]! * dt, position.getY(i) + burst.speeds[i * 3 + 1]! * dt, position.getZ(i) + burst.speeds[i * 3 + 2]! * dt);
      }
      position.needsUpdate = true;
      (burst.points.material as THREE.PointsMaterial).opacity = 1 - (time - burst.start) / (burst.end - burst.start);
      return true;
    });
  }

  function animateVoteMarks(time: number) {
    for (const c of characters.values()) {
      if (!c.ballot.visible) continue;
      if (c.ballotPopAt >= 0) {
        const t = (time - c.ballotPopAt) / BALLOT_POP_S;
        c.ballot.scale.setScalar(1.1 * (1 + t));
        c.ballot.material.opacity = Math.max(0, 1 - t);
        if (t >= 1) {
          c.ballot.visible = false;
          c.ballotPopAt = -1;
        }
        continue;
      }
      c.ballot.scale.setScalar(1.1);
      c.ballot.position.y = 2.9 + (reducedMotion ? 0 : Math.sin(time * 2.4 + c.phase) * 0.15);
    }

    if (!blimp.group.visible) return;
    // A slow, flat loop behind the town, so the banner mostly faces the camera. It flies
    // lower in fog so the banner stays readable. Without motion it waits at the back, facing us.
    const angle = reducedMotion ? -Math.PI / 2 : time * 0.05;
    const rx = layout.width * 0.36;
    const rz = layout.height * 0.12;
    const height = weather.fog > 0 ? 11 : 16;
    blimp.group.position.set(Math.cos(angle) * rx, height + (reducedMotion ? 0 : Math.sin(time * 0.7) * 0.4), Math.sin(angle) * rz - layout.height * 0.05);
    blimp.group.rotation.y = Math.atan2(-Math.cos(angle) * rz, -Math.sin(angle) * rx);
  }

  function drawBoard(time: number) {
    if (!noticeBoard) return;
    const pulse = reducedMotion ? 0 : (Math.sin(time * 3.5) + 1) / 2;
    const board = boardNotes(votes, new Date());
    noticeBoard.draw(board, pulse);
    boardDrawnAt = time;
    boardPulsing = !reducedMotion && board.notes.some((n) => n.urgent);
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
      // Trees are groups of their own, so look inside everything.
      child.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          // Tiled floors have their own material and texture; the rest are shared.
          const material = node.material as THREE.MeshToonMaterial;
          if (material.map || node.userData.ownedMaterial) {
            material.map?.dispose();
            material.dispose();
          }
        }
        if (node instanceof CSS2DObject) node.element.remove();
      });
    }
  }

  // ---- Characters -------------------------------------------------------

  const buildBody = createCharacterBuilder({ ramp, mat, mesh });

  // A new fund standing, or a birthday starting or ending, redraws the body too.
  const designKeyOf = (user: TeamUser) => JSON.stringify([user.look, userFundTier(user), user.celebration ?? null]);
  // The name tag sits above a fund rain cloud or a party hat, so they stay in sight.
  const labelHeight = (user: TeamUser) => (user.celebration ? 4.6 : fundArt(userFundTier(user)).cloud ? 4.3 : 3.3);

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
    label.position.set(0, labelHeight(user), 0);
    label.center.set(0.5, 1);
    group.add(label);
    const umbrella = makeUmbrella(umbrellaColour(user.username));
    group.add(umbrella);
    const ballot = new THREE.Sprite(new THREE.SpriteMaterial({ map: ballotMap, transparent: true, depthWrite: false }));
    ballot.position.set(1.7, 2.9, 0);
    ballot.visible = false;
    group.add(ballot);
    scene.add(group);

    return {
      umbrella,
      ballot,
      ballotOn: false,
      ballotPopAt: -1,
      reaction: null,
      emoji: null,
      username: user.username,
      designKey: designKeyOf(user),
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
      held: false,
      trafficDodge: null,
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
    character.ballot.material.dispose();
    character.emoji?.material.dispose();
    character.label.element.remove();
    clearBody(character);
    character.umbrella.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      (node.userData.fadeMaterial as THREE.Material | undefined)?.dispose();
    });
  }

  // Someone saved a new look, so swap it in without moving them.
  function redecorate(character: Character, user: TeamUser, designKey: string) {
    clearBody(character);
    character.bodyMaterial = buildBody(character.inner, user);
    character.designKey = designKey;
    character.label.position.y = labelHeight(user);
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
      { id: 'overview', name: 'Overview', target: [0, 0, 1], ...all, direction: [0, 0.76, 0.64], tilt: portraitLayout ? 1.15 : 0.86 },
      { id: 'top', name: 'From above', target: [0, 0, 0], ...all, direction: [0, 1, 0.001], tilt: 1.12 },
    ];
    if (layout.park) {
      const park = layout.park;
      const center = toWorld(park.x + park.w / 2, park.y + park.h / 2);
      presets.push({ id: 'park', name: 'Park', target: [center.x, 4, center.z], w: park.w + 18, h: park.h + 24, direction: [0, 0.76, 0.64], tilt: 0.9 });
    }
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
    const distance = fitDistance(preset.w, preset.h, preset.tilt);
    // A tall town needs more distance than the old landscape-only orbit limit allowed.
    const overview = presets[0]!;
    const overviewDistance = fitDistance(overview.w, overview.h, overview.tilt);
    controls.maxDistance = Math.max(230, overviewDistance * 1.5, distance * 1.25);
    camera.far = controls.maxDistance + Math.hypot(layout.width, layout.height);
    camera.updateProjectionMatrix();
    const position = target.clone().addScaledVector(direction, distance);
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
    if (e.button !== 0 || !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const meshes = [...characters.values()].map((c) => c.group);
    if (arcade) meshes.push(arcade);
    if (picker) meshes.push(picker);
    if (noticeBoard) meshes.push(noticeBoard.group);
    if (officeCat?.group.visible) meshes.push(officeCat.group);
    if (blimp.group.visible) meshes.push(blimp.group);
    const hit = raycaster.intersectObjects(meshes, true).find(
      (h) => h.object.userData.username || h.object.userData.pet || h.object.userData.arcade || h.object.userData.picker || h.object.userData.noticeBoard || h.object.userData.resultBanner,
    );
    if (hit?.object.userData.resultBanner && voteMarks?.result) {
      onNoticeBoard(voteLink(voteMarks.result.vote.id));
      return;
    }
    if (hit?.object.userData.noticeBoard && noticeBoard) {
      onNoticeBoard(hit.object.userData.noticeFace && hit.uv ? noticeBoard.linkAt(hit.uv) : '/vote');
      return;
    }
    if (hit?.object.userData.picker && pickerSlot) {
      const control = pickerSlot.querySelector<HTMLButtonElement>('[data-picker-play]');
      if (control && !control.disabled) onPicker(control);
      return;
    }
    if (hit?.object.userData.pet && officeCat) {
      onPet(officeCat.slot.querySelector<HTMLElement>('[data-office-cat]') ?? officeCat.slot);
      return;
    }
    if (hit?.object.userData.arcade && arcadeSlot) {
      onArcade(arcadeSlot.querySelector<HTMLElement>('[data-arcade-play]') ?? arcadeSlot);
      return;
    }
    const username = hit?.object.userData.username as string | undefined;
    const character = username ? characters.get(username) : undefined;
    if (username && character) onPick(username, character.labelElement);
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  // ---- Dragging yourself to another room ----------------------------------
  // The person logged in on this browser can pick up their own character, by its body
  // or its name, and drop it on another room. This listens before the camera controls,
  // so dragging yourself doesn't turn the camera.

  let mover: string | null = null;
  let hold: { character: Character; pointerId: number; x: number; y: number; moved: boolean } | null = null;
  let dropZone: string | null = null;
  // Characters stand on y = 1.
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);
  const floorPoint = new THREE.Vector3();
  const HELD_LIFT = 1.2;

  function aim(e: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }

  function showDropZone(id: string | null) {
    if (id === dropZone) return;
    if (dropZone) delete zoneLabels.get(dropZone)?.dataset.dropTarget;
    dropZone = id;
    const label = id ? zoneLabels.get(id) : undefined;
    if (label) label.dataset.dropTarget = '';
  }

  // The floor under the pointer, in layout units, kept on the map.
  function layoutPointAt(e: PointerEvent): { x: number; y: number } | null {
    aim(e);
    if (!raycaster.ray.intersectPlane(floor, floorPoint)) return null;
    return {
      x: THREE.MathUtils.clamp(floorPoint.x + center.x, 0, layout.width),
      y: THREE.MathUtils.clamp(floorPoint.z + center.z, 0, layout.height),
    };
  }

  function onHoldStart(e: PointerEvent) {
    const character = mover ? characters.get(mover) : undefined;
    if (!character || hold || e.button !== 0 || !(e.target instanceof Node)) return;
    const onCanvas = e.target === renderer.domElement;
    if (onCanvas) {
      aim(e);
      if (!raycaster.intersectObject(character.group, true).some((h) => h.object.userData.username)) return;
    } else if (!character.labelElement.contains(e.target)) {
      return;
    }
    e.stopPropagation();
    hold = { character, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    // A press that doesn't move is still a click, which opens their card.
    if (onCanvas) downAt = { x: e.clientX, y: e.clientY };
  }

  function onHoldMove(e: PointerEvent) {
    if (!hold || hold.pointerId !== e.pointerId) return;
    const { character } = hold;
    if (!hold.moved) {
      if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) < DRAG_START_PX) return;
      hold.moved = true;
      character.held = true;
      character.trafficDodge = null;
      root.setPointerCapture(e.pointerId);
      tween = null;
    }
    const point = layoutPointAt(e);
    if (!point) return;
    const { x, z } = toWorld(point.x, point.y);
    character.group.position.set(x, 1 + HELD_LIFT, z);
    const zone = zoneAt(layout, point.x, point.y);
    showDropZone(zone && zone.id !== character.zoneId ? zone.id : null);
  }

  function onHoldEnd(e: PointerEvent) {
    if (!hold || hold.pointerId !== e.pointerId) return;
    const { character, moved } = hold;
    hold = null;
    if (!moved) return;
    const point = e.type === 'pointerup' ? layoutPointAt(e) : null;
    letGo(character);
    const place = point ? dropPlace(layout, character.username, point.x, point.y) : undefined;
    if (place !== undefined) onMove(place);
  }

  // Back to their own spot. A drop on another room moves the spot itself.
  function letGo(character: Character) {
    showDropZone(null);
    character.held = false;
    character.inner.rotation.z = 0;
    character.group.position.y = 1;
    character.goal.copy(character.seat);
    character.goingHome = true;
    if (reducedMotion) {
      character.group.position.copy(character.seat);
      character.mode = 'idle';
    } else {
      character.mode = 'travel';
    }
  }

  // Lets the page style the mover's name as something to grab.
  function markMover() {
    const label = mover ? characters.get(mover)?.labelElement : undefined;
    if (label) label.dataset.mover = '';
  }

  root.addEventListener('pointerdown', onHoldStart, { capture: true });
  root.addEventListener('pointermove', onHoldMove);
  root.addEventListener('pointerup', onHoldEnd);
  root.addEventListener('pointercancel', onHoldEnd);

  // ---- Applying data ----------------------------------------------------

  function apply(state: TeamState, isDimmed: (user: TeamUser) => boolean): SceneLabels {
    const portrait = root.clientHeight > 0 && root.clientWidth / root.clientHeight < 0.95;
    const reflow = portrait !== portraitLayout;
    portraitLayout = portrait;
    places = state.places;
    layout = computeLayout(state.places, state.users, { portrait });

    // Rooms change size with their people, which means rebuilding the town.
    const attendance = officeAssembly(state);
    assembledOffices = new Set(attendance.unlocked ? attendance.members.map(user=>user.place!) : []);
    const key = layout.zones.map((z) => [z.id, z.name, z.x, z.y, z.w, z.h].join()).join(';') + ':' + [...assembledOffices].sort().join(',');
    const isFirstBuild = !buildKey;
    if (key !== buildKey) {
      buildKey = key;
      buildWorld();
    }
    if (isFirstBuild || reflow) applyPreset(activePreset ?? 'overview', true);

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
        markBallot(character, false);
        changed = true;
      }
      const designKey = designKeyOf(user);
      if (designKey !== character.designKey) redecorate(character, user, designKey);
      const { x, z } = toWorld(seat.x, seat.y);
      const seatMoved = character.seat.distanceTo(new THREE.Vector3(x, 1, z)) > 0.05;
      const changedRoom = character.zoneId !== seat.zone.id;
      character.seat.set(x, 1, z);
      character.zoneId = seat.zone.id;
      character.zoneKind = seat.zone.kind;
      character.scale = deskSize(seat.cell);
      character.cell = seat.cell;
      if (changedRoom || seatMoved || reflow) character.trafficDodge = null;
      character.area = seat.cell >= CROWDED_CELL ? wanderArea(seat.zone, character.scale) : null;
      character.targetOpacity = isDimmed(user) ? 0.22 : 1;
      // Someone being dragged stays under the pointer, and heads to their spot when let go.
      if (character.held) return;
      if (!character.placed || reducedMotion || reflow) {
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
    markMover();

    const zones = layout.zones.flatMap(({ id, name, count }) => {
      const element = zoneLabels.get(id);
      return element ? [{ id, name, count, element }] : [];
    });
    return { people: labelElements, zones, arcade: arcadeSlot, picker: pickerSlot, board: noticeBoard?.slot ?? null, pet: officeCat?.slot ?? null };
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

    // Notes count down every half minute; ones in their last hour pulse.
    if (time - boardDrawnAt > (boardPulsing ? 0.1 : 30)) drawBoard(time);
    animateVoteMarks(time);
    animateBursts(dt, time);
    animateCat(dt, time);

    if (road) {
      const people = [...characters.values()].filter(c => !c.held).map(c => ({
        x: c.group.position.x, z: c.group.position.z, radius: bodyRadius(c),
      }));
      if (!reducedMotion) traffic = stepTraffic(traffic, road, dt, people);
      trafficModels.update(reducedMotion ? parkedTraffic(road) : traffic.cars, trafficDaylight, road);
    }

    for (const c of characters.values()) {
      const { group, inner } = c;
      const size = c.scale;
      group.scale.setScalar(size);

      const labelScale = labelScaleAt(group.position, c.cell);
      if (labelScale !== c.labelScale) {
        c.labelScale = labelScale;
        c.labelElement.style.transform = `scale(${labelScale})`;
      }

      if (c.held || hold?.character === c) {
        // Wriggles while picked up. Nothing else moves them until they're let go.
        inner.position.y = 0;
        if (c.held && !reducedMotion) inner.rotation.z = Math.sin(time * 12) * 0.12;
      } else {
        const dodging = dodgeTraffic(c, dt, time);
        if (!dodging && c.mode === 'idle' && time >= c.waitUntil && wandering && c.area && !reducedMotion) setOff(c, time);

        if (dodging) {
          inner.position.y = Math.abs(Math.sin(time * 11 + c.phase)) * 0.35;
          inner.scale.setScalar(1);
        } else if (c.mode === 'idle') {
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
        animateReaction(c, time);
      }

      if (Math.abs(c.opacity - c.targetOpacity) > 0.005) {
        setOpacity(c, c.opacity + (c.targetOpacity - c.opacity) * Math.min(1, dt * 8));
      }
    }
  }

  // Sidesteps also work for idle people and crowded streets where wandering is off.
  function dodgeTraffic(c: Character, dt: number, time: number): boolean {
    if (!road || reducedMotion) return false;
    const position = c.group.position;
    const result = stepTrafficDodge({ x: position.x, z: position.z, radius: bodyRadius(c) }, c.trafficDodge, road, traffic.cars, dt);
    if (!result) return false;
    c.trafficDodge = result.dodge;
    const next = result.position;
    const facing = Math.atan2(next.x - position.x, next.z - position.z);
    if (Math.hypot(next.x - position.x, next.z - position.z) > 0.001)
      c.inner.rotation.y += shortestAngle(facing - c.inner.rotation.y) * Math.min(1, dt * 10);
    position.x = next.x;
    position.z = next.z;
    // A dodge isn't a failed wander; don't trigger the stuck timer while waiting.
    c.closerAt = time;
    return true;
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

  // Shrink labels when neighbours would overlap at the current zoom. The cat's name uses this
  // too, so it is the same size as the names of the people around it.
  function labelScaleAt(position: THREE.Vector3, cell: number): number {
    const pixelsPerUnit = root.clientHeight / (2 * position.distanceTo(camera.position) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    return Math.round(Math.max(root.clientWidth < 600 ? 0.42 : 0.55, Math.min((cell * pixelsPerUnit) / 104, 1)) * 20) / 20;
  }

  // ---- The office cat ------------------------------------------------------
  // It wanders the main office like people do, using the same rules to pick spots and walk
  // round desks and people. Now and then it trots over to someone in the room, and it stays
  // put while asleep, while wandering is off or when motion is turned down.

  function catObstacles(): Box[] {
    return [...scenery, ...deskBoxes.values()];
  }

  function nextCatSpot(cat: OfficeCat3D): Point | null {
    const from = cat.group.position;
    const people = [...characters.values()].filter((c) => c.zoneId === catZoneId);
    const blocked = catObstacles().map((b) => grow(b, cat.radius()));
    const visit = people[Math.floor(Math.random() * people.length)];
    if (visit && Math.random() < 0.4 && catArea) {
      // Stop beside them, on the side the cat is coming from.
      const p = visit.group.position;
      const away = Math.hypot(from.x - p.x, from.z - p.z) || 1;
      const gap = bodyRadius(visit) + cat.radius() + 0.4;
      const spot = clampTo(catArea, { x: p.x + ((from.x - p.x) / away) * gap, z: p.z + ((from.z - p.z) / away) * gap });
      if (!blocked.some((b) => contains(b, spot))) return spot;
    }
    return catArea && pickSpot(catArea, from, people.map((c) => c.group.position), blocked);
  }

  function turnCat(cat: OfficeCat3D, angle: number, dt: number) {
    cat.group.rotation.y += shortestAngle(angle - cat.group.rotation.y) * Math.min(1, dt * 6);
  }

  function animateCat(dt: number, time: number) {
    const cat = officeCat;
    if (!cat?.group.visible) return;
    const position = cat.group.position;
    catAt = { x: position.x, z: position.z };
    // Sized like the names of people in the same room; an empty room uses its biggest seat.
    const cell = [...layout.seats.values()].find((s) => s.zone.id === catZoneId)?.cell ?? CAT_LABEL_CELL;
    const scale = labelScaleAt(position, cell);
    if (scale !== catLabelScale) {
      catLabelScale = scale;
      cat.slot.style.transform = `scale(${scale})`;
    }
    if (!reducedMotion) cat.animate(time);

    if (reducedMotion || !wandering || pet?.mood === 'sleeping' || !catArea) {
      catGoal = null;
      cat.setWalking(false);
      return;
    }
    if (!catGoal) {
      // Sitting: turn to face the camera, then set off again after a while.
      cat.setWalking(false);
      turnCat(cat, 0, dt);
      if (time < catWaitUntil) return;
      catGoal = nextCatSpot(cat);
      catClosest = Infinity;
      catCloserAt = time;
      if (!catGoal) catWaitUntil = time + 2;
      return;
    }

    const distance = Math.hypot(catGoal.x - position.x, catGoal.z - position.z);
    if (distance < 0.3) {
      catGoal = null;
      catWaitUntil = time + 3 + Math.random() * 6;
      return;
    }
    cat.setWalking(true);
    const radius = cat.radius();
    let direction = steer(position, catGoal, catObstacles(), radius + 0.3);
    for (const c of characters.values()) {
      if (c.zoneId !== catZoneId) continue;
      const dx = position.x - c.group.position.x;
      const dz = position.z - c.group.position.z;
      const apart = Math.hypot(dx, dz);
      const room = (radius + bodyRadius(c)) * 0.95;
      if (apart > 1e-6 && apart < room) {
        const push = ((room - apart) / room) * 1.5;
        direction = { x: direction.x + (dx / apart) * push, z: direction.z + (dz / apart) * push };
      }
    }
    const length = Math.hypot(direction.x, direction.z) || 1;
    direction = { x: direction.x / length, z: direction.z / length };
    const step = Math.min(distance, CAT_SPEED * dt);
    const inside = clampTo(catArea, { x: position.x + direction.x * step, z: position.z + direction.z * step });
    position.x = inside.x;
    position.z = inside.z;
    turnCat(cat, Math.atan2(direction.x, direction.z), dt * 1.5);

    // Boxed in: give up on this spot and sit for a bit.
    if (distance < catClosest - 0.5) {
      catClosest = distance;
      catCloserAt = time;
    } else if (time - catCloserAt > STUCK_SECONDS) {
      catGoal = null;
      catWaitUntil = time + 2;
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
    animateWeather(now / 1000);
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
  motion.addEventListener('change', motionChanged);
  resize();
  raf = requestAnimationFrame(loop);

  return {
    update: apply,
    applyPreset: (id) => applyPreset(id),
    setAmbience({ daylight, warmth, phase, lamps, weather: now }) {
      weather = now;
      trafficDaylight = daylight;
      showWeatherDetails();
      sky.color.set(mixColor(LIGHT.nightSky, LIGHT.sky, daylight));
      sky.groundColor.set(mixColor(LIGHT.nightGround, LIGHT.ground, daylight));
      sky.intensity = 1.4 + 0.5 * daylight;

      sun.color.set(mixColor(LIGHT.moon, mixColor(LIGHT.sun, LIGHT.warmSun, warmth), daylight));
      // Grey skies soften the sunlight and its shadows.
      sun.intensity = (0.65 + 0.7 * daylight) * (1 - now.gloom * 0.55);

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
      blimp.setLit(lamps);
    },

    react(list) {
      if (reducedMotion) return;
      const time = performance.now() / 1000;
      for (const { username, kind, ms } of list) {
        const c = characters.get(username);
        if (!c) continue;
        c.reaction = { kind, start: time, end: time + ms / 1000 };
        c.inner.rotation.z = 0;
        if (kind === 'confetti') confettiAt(c.group.position, time);
        if (kind === 'cheer' || kind === 'clap') {
          const map = (emojiMaps[kind] ??= emojiTexture(kind === 'cheer' ? '🙌' : '👏'));
          if (!c.emoji) {
            c.emoji = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }));
            c.emoji.position.set(-1.7, 2.9, 0);
            c.emoji.scale.setScalar(1.6);
            c.group.add(c.emoji);
          }
          c.emoji.material.map = map;
          c.emoji.visible = true;
        } else if (c.emoji) {
          c.emoji.visible = false;
        }
      }
    },

    setPet(next) {
      pet = next;
      if (!officeCat) return;
      officeCat.group.visible = Boolean(next);
      if (next) officeCat.set(next);
    },

    setVoteMarks(marks) {
      voteMarks = marks;
      for (const c of characters.values()) markBallot(c, true);
      const text = marks?.result ? resultText(marks.result) : '';
      blimp.group.visible = Boolean(text);
      if (text && text !== blimpText) blimp.setText(text);
      blimpText = text;
    },

    setVotes(next) {
      votes = next;
      drawBoard(performance.now() / 1000);
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
    setMover(username) {
      if (mover === username) return;
      if (mover) delete characters.get(mover)?.labelElement.dataset.mover;
      if (hold && hold.character.username !== username) {
        if (hold.moved) letGo(hold.character);
        hold = null;
      }
      mover = username;
      markMover();
    },
    destroy() {
      motion.removeEventListener('change', motionChanged);
      trafficModels.dispose();
      root.removeEventListener('pointerdown', onHoldStart, { capture: true });
      root.removeEventListener('pointermove', onHoldMove);
      root.removeEventListener('pointerup', onHoldEnd);
      root.removeEventListener('pointercancel', onHoldEnd);
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      scene.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
        if (node.userData.ownedMaterial) (node.material as THREE.MeshStandardMaterial).map?.dispose();
        (node.userData.fadeMaterial as THREE.Material | undefined)?.dispose();
      });
      for (const character of characters.values()) character.bodyMaterial.dispose();
      for (const material of materials.values()) material.dispose();
      lampGlow.map?.dispose();
      lampGlow.dispose();
      ballotMap.dispose();
      for (const map of Object.values(emojiMaps)) map.dispose();
      for (const burst of bursts) {
        burst.points.geometry.dispose();
        (burst.points.material as THREE.Material).dispose();
      }
      puff.dispose();
      shadowOnly.dispose();
      snowMaterial.dispose();
      puddleMaterial.dispose();
      ramp.dispose();
      stopWatchingContext();
      renderer.dispose();
      renderer.forceContextLoss(); // Browsers allow only a few live 3D contexts.
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}
