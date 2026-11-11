// The office cat: the rules the server and the browser share. Each person can feed it once a
// day. A day with enough feeds is a good day, and good days make it grow up, from kitten to
// cat to big cat; it never shrinks or goes away. Its mood comes from today's feeds and how
// many people are in the main office, and it naps when nobody is there.

export type PetStage = 'kitten' | 'cat' | 'bigcat';
export type PetMood = 'sleeping' | 'sad' | 'content' | 'happy' | 'joyful';

/** What is kept, and what everyone may see. */
export interface PetState {
  name: string;
  /** The day `fed` is for, YYYY-MM-DD on the team's calendar. Empty before the first day. */
  day: string;
  /** Who fed it that day. */
  fed: string[];
  goodDays: number;
  /** Days in a row, up to the last one, that weren't good. */
  quietDays: number;
}

export interface PetView extends PetState {
  stage: PetStage;
  /** Good days still needed to grow up, or null once it is a big cat. */
  toGrow: number | null;
}

export const DEFAULT_NAME = 'Miu';
export const MAX_NAME = 20;
/** Feeds that make a day a good day. */
export const GOOD_DAY_FEEDS = 3;
/** Good days needed for each stage. */
export const STAGES: [PetStage, number][] = [['kitten', 0], ['cat', 5], ['bigcat', 20]];
/** After this many quiet days in a row, an unfed cat is sad. */
const SAD_AFTER = 2;

export function stageFor(goodDays: number): PetStage {
  let stage: PetStage = 'kitten';
  for (const [name, needed] of STAGES) if (goodDays >= needed) stage = name;
  return stage;
}

function toGrow(goodDays: number): number | null {
  const next = STAGES.find(([, needed]) => needed > goodDays);
  return next ? next[1] - goodDays : null;
}

/** A name for the cat, trimmed, or null when it is empty or too long. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name && [...name].length <= MAX_NAME ? name : null;
}

/** Today on the wall calendar of a time zone (or the computer's own). */
export function dateIn(now: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Closes the days since the one that was kept: that day counts as good or quiet by its
 * feeds, and every day nobody looked in between counts as quiet. Returns the same state
 * when it is still the same day.
 */
export function rollOver(state: PetState, today: string): PetState {
  if (state.day === today) return state;
  if (!state.day) return { ...state, day: today, fed: [] };
  const gap = daysBetween(state.day, today);
  if (gap <= 0) return { ...state, day: today, fed: [] }; // The clock went back: just start the day again.
  const good = state.fed.length >= GOOD_DAY_FEEDS;
  const missed = gap - 1;
  return {
    ...state,
    day: today,
    fed: [],
    goodDays: state.goodDays + (good ? 1 : 0),
    quietDays: good ? missed : state.quietDays + 1 + missed,
  };
}

export function toView(state: PetState): PetView {
  return { ...state, stage: stageFor(state.goodDays), toGrow: toGrow(state.goodDays) };
}

/** How the cat feels, with `inOffice` people in the main office now. */
export function moodOf(pet: Pick<PetState, 'fed' | 'quietDays'>, inOffice: number): PetMood {
  if (inOffice === 0) return 'sleeping';
  const score = pet.fed.length * 2 + inOffice;
  if (score >= 10) return 'joyful';
  if (score >= 4) return 'happy';
  if (pet.quietDays >= SAD_AFTER && pet.fed.length === 0) return 'sad';
  return 'content';
}

const STAGE_NAMES: Record<PetStage, string> = { kitten: 'Kitten', cat: 'Cat', bigcat: 'Big cat' };

export function stageText(view: Pick<PetView, 'stage' | 'toGrow'>): string {
  if (view.toGrow === null) return `${STAGE_NAMES[view.stage]}, all grown up`;
  return `${STAGE_NAMES[view.stage]}: ${view.toGrow} more good day${view.toGrow === 1 ? '' : 's'} to grow up`;
}

export function moodText(mood: PetMood, name: string): string {
  switch (mood) {
    case 'sleeping':
      return `${name} is napping until someone comes to the office.`;
    case 'sad':
      return `${name} feels lonely. Feed them to cheer them up.`;
    case 'content':
      return `${name} is doing fine.`;
    case 'happy':
      return `${name} is happy.`;
    case 'joyful':
      return `${name} is overjoyed!`;
  }
}
