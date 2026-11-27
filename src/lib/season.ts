// The seasonal look of the town: Christmas, with Santa and his sleigh, all December.
// Both maps read this, so 2D and 3D always agree. It goes by the date on this screen,
// which hangs in the office, and needs nothing from the server.
import { parkActivities, type MapLayout, type Rect } from './layout.ts';

/** `christmas`: the December look, Santa and his sleigh included. */
export type Season = 'none' | 'christmas';

/** The season on a local date. */
export function seasonOn(date: Date): Season {
  return date.getMonth() === 11 ? 'christmas' : 'none';
}

/** Whether the town wears its Christmas look: lights, trees, snow, presents, Santa and his sleigh. */
export function isFestive(season: Season): boolean {
  return season !== 'none';
}

/** The season a `?season=` preview shows, or null for anything else. */
export function previewSeason(value: string | null): Season | null {
  return value === 'none' || value === 'christmas' ? value : null;
}

/**
 * The fairy light colours, in the order bulbs go along a string: mostly Christmas red and
 * green, with some gold. The two reds and the two greens twinkle at different times.
 */
export const LIGHT_COLOURS = ['#ff2e43', '#1fbf4f', '#ffd23f', '#ff2e43', '#1fbf4f'] as const;

/** Seconds for one twinkle. Each colour reaches its brightest at a different time. */
export const TWINKLE_SECONDS = 1.6;

/** How bright a bulb of colour `index` is at `time` seconds, from 0.35 to 1. Steady without motion. */
export function twinkle(index: number, time: number, still: boolean): number {
  if (still) return 1;
  const phase = (time / TWINKLE_SECONDS + index / LIGHT_COLOURS.length) * Math.PI * 2;
  return 0.675 + 0.325 * Math.sin(phase);
}

/** Where bulbs hang along a string `length` long, as shares of it, about `spacing` apart. */
export function bulbSpots(length: number, spacing: number): number[] {
  const count = Math.max(2, Math.floor(length / spacing));
  return Array.from({ length: count }, (_, i) => (i + 0.5) / count);
}

/** The Christmas tree in the park: `x` and `y` are the foot of its trunk, in layout units. */
export interface TreeSpot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The big tree stands in the park's first gap between the notice board and the games,
 * and towers over it,
 * where an ordinary tree stands the rest of the year. Null when there is no park or no gap.
 */
export function christmasTreeSpot(layout: Pick<MapLayout, 'park'>): TreeSpot | null {
  const park = layout.park;
  const activities = parkActivities(layout);
  if (!park || !activities) return null;
  const gap = parkGap(park, activities);
  if (!gap) return null;
  // The centrepiece: it grows with the park and stands partly behind the board and the games.
  const w = Math.min(12, Math.max(gap.w * 1.5, park.h * 0.45));
  const h = Math.min(w * 1.75, park.h * 0.9);
  return { x: gap.x + gap.w / 2, y: park.y + park.h * 0.93, w: Math.min(w, h / 1.3), h };
}

/** The 3D tree's model is this tall, with branches this far out from its trunk, before scaling. */
export const TREE_MODEL = { height: 10.4, reach: 4 } as const;

/**
 * How much the 3D map scales its big tree: taller than the 2D tree, as the camera looks down
 * on it, but no more than 1.7 times, to stay clear of the board and the games.
 */
export function christmasTreeScale3d(tree: TreeSpot): number {
  return Math.min((tree.h * 1.5) / TREE_MODEL.height, 1.7);
}

/** How far the big tree's branches reach out from its trunk, in layout units, on either map. */
export function christmasTreeReach(tree: TreeSpot): number {
  return Math.max(tree.w / 2, TREE_MODEL.reach * christmasTreeScale3d(tree));
}

/** The park's first gap wide enough for a tree, or null. parkTrees.ts uses the same one. */
export function parkGap(park: Rect, activities: NonNullable<ReturnType<typeof parkActivities>>): { x: number; w: number } | null {
  const gaps = [
    [activities.board.x + activities.board.w, activities.arcade.x],
    [activities.arcade.x + activities.arcade.w, activities.picker.x],
  ] as const;
  for (const [left, right] of gaps) {
    if (right - left >= 4 && left >= park.x && right <= park.x + park.w) return { x: left, w: right - left };
  }
  return null;
}

/**
 * Santa stands at the foot of the tree on its left, a little in front of it, clear of the
 * arcade's Play button on its right.
 */
export function santaSpot(tree: TreeSpot): { x: number; y: number; size: number } {
  const size = Math.max(2.4, tree.w * 0.38);
  return { x: tree.x - tree.w * 0.3, y: tree.y + 0.4, size };
}

/** One trip of the sleigh across the sky, then a rest before the next. */
export const SLEIGH_TRIP_SECONDS = 18;
export const SLEIGH_LOOP_SECONDS = 42;

/**
 * How far across the sky the sleigh is at `time` seconds: 0 at the left edge, 1 at the right,
 * or null while it rests out of sight. Without motion it waits in one spot near the right.
 */
export function sleighProgress(time: number, still: boolean): number | null {
  if (still) return 0.78;
  const t = ((time % SLEIGH_LOOP_SECONDS) + SLEIGH_LOOP_SECONDS) % SLEIGH_LOOP_SECONDS;
  return t < SLEIGH_TRIP_SECONDS ? t / SLEIGH_TRIP_SECONDS : null;
}
