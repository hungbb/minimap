// How the town looks at a moment: how light it is, how warm the light is, and
// whether the lamps are on. Both maps read this, so 2D and 3D always agree.
// Nothing here touches the DOM or three.js, so it can be tested on its own.
import type { SunTimes, Weather } from '../../shared/types.ts';

export type Phase = 'night' | 'dawn' | 'day' | 'dusk';

export type Precipitation = 'none' | 'drizzle' | 'rain' | 'snow';

/** The weather the town shows, each part from 0 (none) to 1 (as much as there is). */
export interface Conditions {
  precipitation: Precipitation;
  /** How heavily it rains or snows. */
  intensity: number;
  clouds: number;
  fog: number;
  /** A thunderstorm: occasional soft lightning. */
  storm: boolean;
  /** How grey and dim an overcast day is. */
  gloom: number;
  /** Blows rain and snow sideways. */
  wind: number;
}

export const CLEAR: Conditions = { precipitation: 'none', intensity: 0, clouds: 0, fog: 0, storm: false, gloom: 0, wind: 0 };

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
  weather: Conditions;
}

/** What `ambience` reads from the weather. Everything but the day and night flag is optional. */
export type WeatherInput = Pick<Weather, 'isDay'> & Partial<Pick<Weather, 'sun' | 'code' | 'cloudCover' | 'precipitation' | 'windSpeed'>>;

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
const GREY_SKY = { top: '#9aa6b8', bottom: '#d2d8e2' };
const NIGHT_GREY_SKY = { top: '#272c45', bottom: '#3e4463' };

/** The town's look in the daytime, and whenever there's no weather to go by. */
export const DAY: Ambience = { daylight: 1, warmth: 0, phase: 'day', lamps: 0, sky: DAY_SKY, weather: CLEAR };

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

// WMO weather codes, as Open-Meteo sends them.
function fromCode(code: number): Conditions {
  const wet = (precipitation: Precipitation, intensity: number, extra: Partial<Conditions> = {}): Conditions => ({
    ...CLEAR, precipitation, intensity, clouds: 0.9, gloom: 0.3 + intensity * 0.3, ...extra,
  });
  if (code <= 0) return CLEAR;
  if (code === 1) return { ...CLEAR, clouds: 0.25 };
  if (code === 2) return { ...CLEAR, clouds: 0.55 };
  if (code === 3) return { ...CLEAR, clouds: 0.9, gloom: 0.3 };
  if (code === 45 || code === 48) return { ...CLEAR, clouds: 0.6, fog: code === 48 ? 0.9 : 0.75, gloom: 0.25 };
  if (code === 51 || code === 56) return wet('drizzle', 0.35);
  if (code === 53) return wet('drizzle', 0.55);
  if (code === 55 || code === 57) return wet('drizzle', 0.75);
  if (code === 61) return wet('rain', 0.4);
  if (code === 63 || code === 66) return wet('rain', 0.7);
  if (code === 65 || code === 67) return wet('rain', 1);
  if (code === 71 || code === 77) return wet('snow', 0.4);
  if (code === 73 || code === 85) return wet('snow', 0.7);
  if (code === 75 || code === 86) return wet('snow', 1);
  if (code === 80) return wet('rain', 0.5, { clouds: 0.7 });
  if (code === 81) return wet('rain', 0.8, { clouds: 0.8 });
  if (code === 82) return wet('rain', 1);
  if (code >= 95) return wet('rain', 1, { storm: true, gloom: 0.7 });
  return CLEAR;
}

/** The weather to show: the weather code, fine-tuned by cloud cover, rain amount and wind when they're known. */
export function conditions(weather: WeatherInput | null): Conditions {
  if (!weather || weather.code === undefined) return CLEAR;
  const base = fromCode(weather.code);
  const result = { ...base };
  // Cloud cover sharpens the clear-to-cloudy codes, which only come in four steps.
  if (weather.cloudCover !== undefined && weather.code <= 3) result.clouds = clamp(weather.cloudCover / 100);
  // A heavy downpour can be heavier than its code says.
  if (weather.precipitation !== undefined && base.precipitation !== 'none') {
    result.intensity = Math.max(base.intensity, clamp(weather.precipitation / 6));
  }
  if (weather.windSpeed !== undefined) result.wind = clamp(weather.windSpeed / 40);
  return result;
}

function isClear(weather: Conditions): boolean {
  return (Object.keys(CLEAR) as (keyof Conditions)[]).every((key) => weather[key] === CLEAR[key]);
}

function greySky(sky: Ambience['sky'], daylight: number, gloom: number): Ambience['sky'] {
  if (gloom <= 0) return sky;
  const top = mixColor(NIGHT_GREY_SKY.top, GREY_SKY.top, daylight);
  const bottom = mixColor(NIGHT_GREY_SKY.bottom, GREY_SKY.bottom, daylight);
  return { top: mixColor(sky.top, top, gloom), bottom: mixColor(sky.bottom, bottom, gloom) };
}

/**
 * The look of the town at `at`. Without weather, the town keeps its daytime look.
 * Without sun times (polar day or night), it goes by whether the weather service says it's day.
 */
export function ambience(weather: WeatherInput | null, at: Date): Ambience {
  const light = daylightAt(weather, at);
  const now = conditions(weather);
  if (isClear(now)) return light;
  // Dark storm clouds bring the lamps on a little, even by day.
  const lamps = Math.max(light.lamps, clamp((now.gloom - 0.6) * 2.5) * 0.6);
  return { ...light, lamps, sky: greySky(light.sky, light.daylight, now.gloom), weather: now };
}

function daylightAt(weather: WeatherInput | null, at: Date): Ambience {
  if (!weather) return DAY;
  const t = at.getTime();
  const known = days(weather.sun ?? []).filter((day) => t >= day.rise - 12 * 60 * MINUTE && t <= day.set + 12 * 60 * MINUTE);
  if (!known.length) return weather.isDay ? DAY : { daylight: 0, warmth: 0, phase: 'night', lamps: 1, sky: skyFor(0, 0), weather: CLEAR };

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
  return { daylight, warmth, phase, lamps: lampsFor(daylight), sky: skyFor(daylight, warmth), weather: CLEAR };
}

/** Weather a `?weather=` preview can show, as the code the weather service would send. */
export const PREVIEW_WEATHER: Record<string, number> = {
  clear: 0,
  partly: 2,
  cloudy: 3,
  fog: 45,
  drizzle: 53,
  rain: 63,
  downpour: 65,
  snow: 73,
  storm: 95,
};

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
