// The office cat in the browser: what both maps draw (its name, size and mood, from the cat's
// own data and how many people are in the main office), its colours, and when to play the
// happy hop after someone feeds it.
import { moodOf, type PetMood, type PetStage, type PetView } from '../../shared/pet.ts';
import type { TeamState } from '../../shared/types.ts';

export interface PetShown {
  name: string;
  stage: PetStage;
  mood: PetMood;
  /** Goes up by one each time someone feeds it, so the maps play a hop. */
  cheer: number;
}

/** How big each stage is, next to a grown cat. */
export const STAGE_SCALE: Record<PetStage, number> = { kitten: 0.7, cat: 1, bigcat: 1.3 };

export const CAT = { fur: '#f6a55b', stripe: '#d9783a', belly: '#fff1dc', nose: '#ff7b9c' };

export function inMainOffice(state: Pick<TeamState, 'places' | 'users'>): number {
  const main = state.places[0];
  return main ? state.users.filter((u) => u.place === main.id).length : 0;
}

export function petShown(view: PetView | null, state: Pick<TeamState, 'places' | 'users'>, cheer: number): PetShown | null {
  if (!view || !state.places.length) return null;
  return { name: view.name, stage: view.stage, mood: moodOf(view, inMainOffice(state)), cheer };
}

/** Whether someone fed the cat between two looks at it. A new day or a fresh map doesn't count. */
export function newFeed(prev: PetView | null, next: PetView): boolean {
  return Boolean(prev && prev.day === next.day && next.fed.length > prev.fed.length);
}
