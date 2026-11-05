// How the town looks at a moment: how light it is, how warm the light is, and
// whether the lamps are on. Both maps read this, so 2D and 3D always agree.
// Nothing here touches the DOM or three.js, so it can be tested on its own.
import type { SunTimes, Weather } from '../../shared/types.ts';

export type Phase = 'night' | 'dawn' | 'day' | 'dusk';

export interface Ambience {
  /** 0 is full night, 1 full day. Changes smoothly around sunrise and sunset. */
  daylight: number;
  /** 0 to 1: the warm colour of sunrise and sunset. */
  warmth: number;
  phase: Phase;
  /** 0 to 1: how brightly the street lamps and windows glow. */
  lamps: number;
  /** The sky behind the town. */
  sky: { top: string; bottom: string };
}

const MINUTE = 60_000;
/** Light fades in from this long before sunrise until this long after it, and the other way round at sunset. */
const TWILIGHT = 40 * MINUTE;
/** Warm light builds up before sunrise and sunset, and fades after them. */
const WARM_BEFORE = { rise: 50 * MINUTE, set: 80 * MINUTE };
const WARM_AFTER = { rise: 70 * MINUTE, set: 50 * MINUTE };
/** Dawn and dusk cover the warm light and the twilight. */
const PHASE_BEFORE = { rise: 60 * MINUTE, set: 80 * MINUTE };
const PHASE_AFTER = { rise: 70 * MINUTE, set: 60 * MINUTE };

const DAY_SKY = { top: '#a9dcff', bottom: '#e4f6ff' };
const NIGHT_SKY = { top: '#141a45', bottom: '#363c7d' };
const WARM_SKY = { top: '#8f9be8', bottom: '#ffb27a' };

/** The town's look in the daytime, and whenever there's no weather to go by. */
export const DAY: Ambience = { daylight: 1, warmth: 0, phase: 'day', lamps: 0, sky: DAY_SKY };

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Eases from 0 at `from` to 1 at `to`. */
function smoothstep(from: number, to: number, value: number): number {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blends two `#rrggbb` colours. 0 gives `a`, 1 gives `b`, exactly. */
export function mixColor(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${((mix(ar, br) << 16) | (mix(ag, bg) << 8) | mix(ab, bb)).toString(16).padStart(6, '0')}`;
}

interface Day {
  rise: number;
  set: number;
}

function days(sun: readonly SunTimes[]): Day[] {
  return sun
    .map((day) => ({ rise: Date.parse(day.rise), set: Date.parse(day.set) }))
    .filter((day) => Number.isFinite(day.rise) && Number.isFinite(day.set) && day.set > day.rise);
}

/** Up after sunrise and down after sunset, for one day. */
function lightOn(day: Day, t: number): number {
  return Math.min(smoothstep(day.rise - TWILIGHT, day.rise + TWILIGHT, t), 1 - smoothstep(day.set - TWILIGHT, day.set + TWILIGHT, t));
}

/** Rises to 1 at `peak`, falling back to 0 `before` it and `after` it. */
function bump(peak: number, before: number, after: number, t: number): number {
  return t <= peak ? smoothstep(peak - before, peak, t) : 1 - smoothstep(peak, peak + after, t);
}

function lampsFor(daylight: number): number {
  return 1 - smoothstep(0.2, 0.6, daylight);
}

function skyFor(daylight: number, warmth: number): Ambience['sky'] {
  const top = mixColor(NIGHT_SKY.top, DAY_SKY.top, daylight);
  const bottom = mixColor(NIGHT_SKY.bottom, DAY_SKY.bottom, daylight);
  return { top: mixColor(top, WARM_SKY.top, warmth * 0.85), bottom: mixColor(bottom, WARM_SKY.bottom, warmth * 0.85) };
}

/**
 * The look of the town at `at`. Without weather, the town keeps its daytime look.
 * Without sun times (polar day or night), it goes by whether the weather service says it's day.
 */
export function ambience(weather: Pick<Weather, 'isDay' | 'sun'> | null, at: Date): Ambience {
  if (!weather) return DAY;
  const t = at.getTime();
  const known = days(weather.sun ?? []).filter((day) => t >= day.rise - 12 * 60 * MINUTE && t <= day.set + 12 * 60 * MINUTE);
  if (!known.length) return weather.isDay ? DAY : { daylight: 0, warmth: 0, phase: 'night', lamps: 1, sky: skyFor(0, 0) };

  const daylight = Math.max(...known.map((day) => lightOn(day, t)));
  const warmth = Math.max(
    ...known.map((day) => Math.max(bump(day.rise, WARM_BEFORE.rise, WARM_AFTER.rise, t), bump(day.set, WARM_BEFORE.set, WARM_AFTER.set, t))),
  );
  let phase: Phase = daylight >= 0.5 ? 'day' : 'night';
  for (const day of known) {
    if (t >= day.rise - PHASE_BEFORE.rise && t <= day.rise + PHASE_AFTER.rise) phase = 'dawn';
    if (t >= day.set - PHASE_BEFORE.set && t <= day.set + PHASE_AFTER.set) phase = 'dusk';
  }
  if (daylight === 1 && warmth === 0) return { ...DAY, phase };
  return { daylight, warmth, phase, lamps: lampsFor(daylight), sky: skyFor(daylight, warmth) };
}

/** Sunrise at 06:00 and sunset at 18:00 local time, for previewing without an office location. */
export function defaultSun(now: Date): SunTimes[] {
  return [-1, 0, 1].map((offset) => {
    const at = (hour: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour).toISOString();
    return { rise: at(6), set: at(18) };
  });
}

/**
 * The moment a `?time=` preview shows: `dawn`, `day`, `dusk`, `night` or a local `HH:MM`.
 * Named times follow today's sun. Returns null for anything else.
 */
export function previewTime(value: string, sun: readonly SunTimes[], now: Date): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
  }
  // Today is the day whose noon is nearest to now.
  const today = days(sun).sort((a, b) => Math.abs((a.rise + a.set) / 2 - now.getTime()) - Math.abs((b.rise + b.set) / 2 - now.getTime()))[0];
  if (!today) return null;
  const named: Record<string, number> = {
    dawn: today.rise,
    day: (today.rise + today.set) / 2,
    dusk: today.set,
    night: today.set + 4 * 60 * MINUTE,
  };
  return value in named ? new Date(named[value]!) : null;
}
