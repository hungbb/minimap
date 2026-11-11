// Where rooms and people go. Shared by the 2D and 3D maps, in world units.
//
// The map is a small town: buildings along the top, a street running right
// through it for people who are out, then a small lobby, park and beach below.
// Rooms grow and shrink with how many people are in them, and most of the map
// goes to the working rooms, because that's where most people are.
import type { Place, TeamUser } from '../../shared/types.ts';

export type ZoneKind = 'office' | 'wfh' | 'off' | 'lobby' | 'street';

export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
}

export interface Seat {
  x: number;
  y: number;
  cell: number;
  zone: Zone;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapLayout {
  zones: Zone[];
  seats: Map<string, Seat>;
  width: number;
  height: number;
  /** Scenery that fills the space the lobby and beach don't need. */
  park: Rect | null;
}

interface ZoneDef {
  name: string;
  kind: ZoneKind;
}

interface ZoneEntry {
  id: string;
  def: ZoneDef;
}

export type PlaceGroup = 'working' | 'notWorking' | 'notCheckedIn';

type Counts = (id: string) => number;

const MAX_CELL = 15;
const SHORT_STREET = 16;
const SHORT_BOTTOM_ROOM = 24;

// Landscape map: the smallest each room can get, so its name still fits.
const MAP_WIDTH = 100;
const MAP_HEIGHT = 68;
const GAP = 2;
const MIN_BIG_ROOM = 20;
const MIN_SMALL_ROOM = 18;
const MIN_TOP_ROW = 24;
const MIN_BOTTOM_ROW = 13;
const MIN_LOBBY = 20;
const MIN_BEACH = 22;
const LOBBY_WEIGHT = 0.5; // People waiting in the lobby need less room than people at work.
const LOBBY_PERSON_WIDTH = 5; // The lobby and beach only get as wide as their people need.
const BEACH_PERSON_WIDTH = 8;
const MIN_PARK = 38;
const STREET_HEIGHT = 12;
const MAX_STREET_HEIGHT = 20;
const STREET_FITS = 8; // People who fit before the street needs to get wider.

export const FIXED_ZONES = {
  wfh: { name: 'Work from home', kind: 'wfh' },
  out: { name: 'Out of Office', kind: 'street' },
  off: { name: 'Off', kind: 'off' },
  lobby: { name: 'Not checked in', kind: 'lobby' },
} as const satisfies Record<string, ZoneDef>;

export function placeName(places: Place[], id: string | null): string {
  if (!id) return FIXED_ZONES.lobby.name;
  if (id === 'wfh' || id === 'off' || id === 'out') return FIXED_ZONES[id].name;
  return places.find((p) => p.id === id)?.name || id;
}

export function isNotWorking(place: string | null): boolean {
  return place === 'off' || place === 'out';
}

/** Someone whose office was removed from the data counts as not checked in. */
export function placeGroup(place: string | null, places: Place[]): PlaceGroup {
  if (isNotWorking(place)) return 'notWorking';
  if (place === 'wfh' || places.some((p) => p.id === place)) return 'working';
  return 'notCheckedIn';
}

function zone(id: string, def: ZoneDef, x: number, y: number, w: number, h: number): Zone {
  return { id, name: def.name, kind: def.kind, x, y, w, h, count: 0 };
}

/**
 * Splits a length between rooms: each gets its minimum, then the rest goes by weight.
 * If there are too many rooms for their minimums, they shrink evenly to fit.
 */
export function shareLength(total: number, rooms: { min: number; weight: number }[]): number[] {
  const minimums = rooms.reduce((sum, room) => sum + room.min, 0);
  if (minimums >= total) return rooms.map((room) => (room.min * total) / minimums);
  const weights = rooms.reduce((sum, room) => sum + room.weight, 0);
  const free = total - minimums;
  return rooms.map((room) => room.min + (weights ? (free * room.weight) / weights : free / rooms.length));
}

function landscapeZones(places: Place[], count: Counts): Omit<MapLayout, 'seats'> {
  const [main, ...others] = places;
  const zones: Zone[] = [];

  // The street widens only when a lot of people are out; the rows share what's left.
  const streetHeight = Math.min(STREET_HEIGHT + Math.max(0, count('out') - STREET_FITS), MAX_STREET_HEIGHT);
  const top: (ZoneEntry & { min: number; weight: number })[] = [
    ...(main ? [{ id: main.id, def: main as ZoneDef, min: MIN_BIG_ROOM, weight: count(main.id) + 1 }] : []),
    ...others.map((p) => ({ id: p.id, def: p as ZoneDef, min: MIN_SMALL_ROOM, weight: count(p.id) })),
    { id: 'wfh', def: FIXED_ZONES.wfh, min: MIN_BIG_ROOM, weight: count('wfh') + 1 },
  ];
  const topPeople = top.reduce((sum, room) => sum + count(room.id), 0);
  const bottomPeople = count('lobby') * LOBBY_WEIGHT + count('off');

  const rowsTotal = MAP_HEIGHT - GAP * 4 - streetHeight;
  const [topHeight = 0, bottomHeight = 0] = shareLength(rowsTotal, [
    { min: MIN_TOP_ROW, weight: topPeople + 2 },
    { min: MIN_BOTTOM_ROW, weight: bottomPeople },
  ]);

  const topWidths = shareLength(MAP_WIDTH - GAP * (top.length + 1), top);
  let x = GAP;
  top.forEach((room, i) => {
    const width = topWidths[i] ?? 0;
    zones.push(zone(room.id, room.def, x, GAP, width, topHeight));
    x += width + GAP;
  });

  const streetY = GAP + topHeight + GAP;
  // The street lines up with the rooms above and below it.
  zones.push(zone('out', FIXED_ZONES.out, GAP, streetY, MAP_WIDTH - GAP * 2, streetHeight));

  const bottomY = streetY + streetHeight + GAP;
  const available = MAP_WIDTH - GAP * 4 - MIN_PARK;
  const wantedLobby = Math.max(MIN_LOBBY, count('lobby') * LOBBY_PERSON_WIDTH + 4);
  const wantedBeach = Math.max(MIN_BEACH, count('off') * BEACH_PERSON_WIDTH + 4);
  // Activities keep their park space even when the lobby and beach are crowded.
  const lobbyExtra = wantedLobby - MIN_LOBBY;
  const beachExtra = wantedBeach - MIN_BEACH;
  const fit = Math.min(1, (available - MIN_LOBBY - MIN_BEACH) / Math.max(1, lobbyExtra + beachExtra));
  const lobbyWidth = MIN_LOBBY + lobbyExtra * fit;
  const offWidth = MIN_BEACH + beachExtra * fit;
  zones.push(zone('lobby', FIXED_ZONES.lobby, GAP, bottomY, lobbyWidth, bottomHeight));
  zones.push(zone('off', FIXED_ZONES.off, MAP_WIDTH - GAP - offWidth, bottomY, offWidth, bottomHeight));

  const parkWidth = Math.max(MIN_PARK,MAP_WIDTH - GAP * 4 - lobbyWidth - offWidth);
  const park = parkWidth >= MIN_PARK ? { x: GAP * 2 + lobbyWidth, y: bottomY, w: parkWidth, h: bottomHeight } : null;
  return { zones, width: MAP_WIDTH, height: MAP_HEIGHT, park };
}

function portraitZones(places: Place[], count: Counts): Omit<MapLayout, 'seats'> {
  const [main, ...others] = places;
  const zones: Zone[] = [];
  const gap = 3;
  const rowH = 32;
  let y = 2;

  const addRow = (items: ZoneEntry[]) => {
    items.forEach((item, i) => {
      const row = Math.floor(i / 2);
      const lastAlone = i === items.length - 1 && i % 2 === 0;
      zones.push(zone(item.id, item.def, i % 2 ? 51.5 : 2, y + row * (rowH + gap), lastAlone ? 96 : 46.5, rowH));
    });
    y += Math.ceil(items.length / 2) * (rowH + gap);
  };

  const [onlyOther] = others;
  if (main && onlyOther && others.length === 1) {
    // The main office and the row below it trade height as people move between them.
    const [mainHeight = 0, rowHeight = 0] = shareLength(80, [
      { min: 30, weight: count(main.id) + 1 },
      { min: 30, weight: Math.max(count(onlyOther.id), count('wfh')) + 1 },
    ]);
    zones.push(zone(main.id, main, 2, y, 96, mainHeight));
    y += mainHeight + gap;

    const [otherWidth = 0, homeWidth = 0] = shareLength(94, [
      { min: 34, weight: count(onlyOther.id) },
      { min: 34, weight: count('wfh') + 1 },
    ]);
    zones.push(zone(onlyOther.id, onlyOther, 2, y, otherWidth, rowHeight));
    zones.push(zone('wfh', FIXED_ZONES.wfh, 4 + otherWidth, y, homeWidth, rowHeight));
    y += rowHeight + gap;
  } else {
    if (main) {
      zones.push(zone(main.id, main, 2, y, 96, 40));
      y += 40 + gap;
    }
    addRow(others.map((p) => ({ id: p.id, def: p })));
    zones.push(zone('wfh', FIXED_ZONES.wfh, 2, y, 96, 40));
    y += 40 + gap;
  }

  zones.push(zone('out', FIXED_ZONES.out, 2, y, 96, 28));
  y += 28 + gap;

  const [lobbyWidth = 0, offWidth = 0] = shareLength(94, [
    { min: 48, weight: count('lobby') * LOBBY_WEIGHT },
    { min: 34, weight: count('off') + 1 },
  ]);
  const bottomH = 23;
  zones.push(zone('lobby', FIXED_ZONES.lobby, 2, y, lobbyWidth, bottomH));
  zones.push(zone('off', FIXED_ZONES.off, 4 + lobbyWidth, y, offWidth, bottomH));
  y += bottomH + gap;
  const park = { x: 2, y, w: 96, h: 32 };
  y += park.h + gap;
  return { zones, width: 100, height: y, park };
}

/** Reserved activity footprints, shared by both map renderers. Nobody is seated in the park. */
export function parkActivities(layout: Pick<MapLayout, 'park'>) {
  const p = layout.park;
  if (!p) return null;
  const cabinetW = Math.min(12, p.w * 0.22, (p.h - 2) / 1.6);
  const cabinet = (fraction: number): Rect => ({
    x: p.x + p.w * fraction - cabinetW / 2,
    y: p.y + p.h * 0.92 - cabinetW * 1.6,
    w: cabinetW, h: cabinetW * 1.6,
  });
  const boardH = Math.min(14, p.h * 0.78);
  return {
    board: { x: p.x + p.w * 0.03, y: p.y + (p.h - boardH) / 2, w: Math.min(22, p.w * 0.34), h: boardH },
    arcade: cabinet(0.59),
    picker: cabinet(0.86),
  };
}

/** The vote board now stands beside the games in the park. */
export function noticeBoardSpot(layout: Pick<MapLayout, 'park'>): Rect | null {
  return parkActivities(layout)?.board ?? null;
}

/**
 * Where the office cat sits in both maps: on the floor of the main office, just inside the
 * potted plant in its bottom-right corner. `x` and `y` are its feet; `size` is a grown cat's
 * width. Null when there is no office.
 */
export function petSpot(layout: Pick<MapLayout, 'zones'>, places: Place[]): { x: number; y: number; size: number; zoneId: string } | null {
  const main = places[0];
  const z = main && layout.zones.find((zone) => zone.id === main.id);
  if (!z) return null;
  const size = Math.max(3, Math.min(6, z.w * 0.12, z.h * 0.2));
  return { x: z.x + z.w * 0.9 - size / 2, y: z.y + z.h * 0.97, size, zoneId: z.id };
}

/** People stand clear of room names and edges. Activities have their own park. */
export function standingArea(z: Zone): Rect { return roomArea(z); }

function roomArea(z: Zone): Rect {
  // A short street has no room below its name, so people stand beside it instead.
  if (z.kind === 'street' && z.h < SHORT_STREET) return { x: z.x + 15, y: z.y + 1, w: z.w - 19, h: z.h - 2 };
  // These rooms are kept small, so people stand closer to the room's name.
  if ((z.kind === 'lobby' || z.kind === 'off') && z.h < SHORT_BOTTOM_ROOM) {
    return { x: z.x + 2, y: z.y + 4, w: z.w - 4, h: z.h - 5 };
  }
  return { x: z.x + 2, y: z.y + 7, w: z.w - 4, h: z.h - 9 };
}

// Picks the grid that gives each person the most room, then centers it.
function seatsIn(z: Zone, count: number): Omit<Seat, 'zone'>[] {
  const area = standingArea(z);
  let best = { cols: 1, rows: 1, score: -1, cw: MAX_CELL, ch: MAX_CELL };
  for (let cols = 1; cols <= Math.max(count, 1); cols++) {
    const rows = Math.ceil(count / cols) || 1;
    const cw = Math.min(area.w / cols, MAX_CELL);
    const ch = Math.min(area.h / rows, MAX_CELL);
    const score = Math.min(cw, ch);
    if (score > best.score) best = { cols, rows, score, cw, ch };
  }

  const seats: Omit<Seat, 'zone'>[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / best.cols);
    const inRow = row === best.rows - 1 ? count - best.cols * (best.rows - 1) : best.cols;
    const col = i - row * best.cols;
    seats.push({
      x: area.x + area.w / 2 + (col - (inRow - 1) / 2) * best.cw,
      y: area.y + area.h / 2 + (row - (best.rows - 1) / 2) * best.ch,
      cell: best.score,
    });
  }
  return seats;
}

export function computeLayout(places: Place[], users: TeamUser[], { portrait = false } = {}): MapLayout {
  // Someone whose office was removed from the data waits in the lobby.
  const zoneIds = new Set([...places.map((p) => p.id), 'wfh', 'out', 'off', 'lobby']);
  const zoneOf = (u: TeamUser) => (u.place && zoneIds.has(u.place) ? u.place : 'lobby');

  const peopleIn = new Map<string, TeamUser[]>();
  for (const user of users) {
    const id = zoneOf(user);
    peopleIn.set(id, [...(peopleIn.get(id) ?? []), user]);
  }
  const count: Counts = (id) => peopleIn.get(id)?.length ?? 0;

  const { zones, width, height, park } = portrait ? portraitZones(places, count) : landscapeZones(places, count);

  const seats = new Map<string, Seat>();
  for (const z of zones) {
    // Sorted by username so people keep their spot when someone else moves.
    const inZone = [...(peopleIn.get(z.id) ?? [])].sort((a, b) => a.username.localeCompare(b.username));
    z.count = inZone.length;
    const zoneSeats = seatsIn(z, inZone.length);
    inZone.forEach((u, i) => {
      const seat = zoneSeats[i];
      if (seat) seats.set(u.username, { ...seat, zone: z });
    });
  }
  return { zones, seats, width, height, park };
}
