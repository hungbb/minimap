import type { TeamState, TeamUser } from '../../shared/types.ts';
import type { LatestResult, VoteView } from '../../shared/vote.ts';
import type { SelectHandler } from '../components/Badge.tsx';
import type { Ambience } from '../lib/ambience.ts';
import type { PetShown } from '../lib/petLook.ts';
import type { Reaction } from '../lib/voteReactions.ts';

/** Asks the map to bring a person into view. `at` lets the same person be requested twice. */
export interface FocusRequest {
  username: string;
  at: number;
}

/** What the map shows about votes beyond the notice board. Each screen can turn them off. */
export interface VoteMarks {
  /** People invited to an open vote shown on the map who haven't voted yet. */
  waiting: ReadonlySet<string>;
  /** A vote that closed in the last 3 hours, for the banner. */
  result: LatestResult | null;
}

/** Reactions to play once (lib/voteReactions.ts). A new `id` plays a new set. */
export interface ReactionPlay {
  id: number;
  list: Reaction[];
}

export interface MapProps {
  state: TeamState;
  isDimmed: (user: TeamUser) => boolean;
  selected: string | null;
  focus: FocusRequest | null;
  onSelect: SelectHandler;
  onPicker: (trigger: HTMLElement) => void;
  onAssemble: (trigger: HTMLElement) => void;
  onArcade: (trigger: HTMLElement) => void;
  /** The office cat, or null before it has loaded. */
  pet: PetShown | null;
  /** A click on the office cat, to open its card. */
  onPet: (trigger: HTMLElement) => void;
  /** The time of day and weather to show (lib/ambience.ts). */
  look: Ambience;
  /** The team's votes, as anyone may see them. The notice board shows the open ones. */
  votes: VoteView[];
  /** Markers over people who haven't voted, and the latest result's banner. Null when turned off. */
  voteMarks: VoteMarks | null;
  /** Characters hop when they vote, and cheer, clap or get confetti when a vote closes. */
  reactions: ReactionPlay | null;
  /** The person logged in on this browser, who may drag their own character to another room. Null for nobody. */
  mover: string | null;
  /** The mover dropped their character on another room: its place, or null for Not checked in. */
  onMove: (place: string | null) => void;
}
