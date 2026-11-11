// The office cat's API: everyone sees it, people who are logged in feed it once a day, and the
// admin names it. It keeps its own data (data/pet.json on Node.js, the `pet` key on
// Cloudflare). Days are closed by tick(), which the hosts run with their other timed changes,
// and on each request, so a cat nobody looked at for a while catches up by itself.

import { cleanName, dateIn, DEFAULT_NAME, MAX_NAME, rollOver, toView, type PetState, type PetView } from '../../shared/pet.ts';
import {
  ApiError,
  backupError,
  errorResponse,
  jsonResponse,
  type ApiRequest,
  type ApiResponse,
  type Team,
  type TeamFeature,
} from '../core.ts';

export interface PetOptions {
  saved: Partial<PetState> | null;
  save: (data: PetState) => void | Promise<void>;
  team: Team;
  /** Tells open maps about feeds, a new name and a new day. */
  onChange?: (view: PetView) => void;
  now?: () => Date;
  /** Which day it is depends on where the team is. Left out, the computer's own time zone is used. */
  timeZone?: string;
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isDay = (value: unknown): value is string => typeof value === 'string' && (value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value));

function fresh(): PetState {
  return { name: DEFAULT_NAME, day: '', fed: [], goodDays: 0, quietDays: 0 };
}

// Takes what was stored, keeping only what makes sense, so a damaged file can't break the cat.
function fromSaved(saved: Partial<PetState> | null): PetState {
  const base = fresh();
  if (!saved) return base;
  return {
    name: cleanName(saved.name) ?? base.name,
    day: isDay(saved.day) ? saved.day : base.day,
    // Each person counts once, even in a file written before duplicates were stopped.
    fed: Array.isArray(saved.fed) ? [...new Set(saved.fed.filter((name) => typeof name === 'string'))] : [],
    goodDays: isCount(saved.goodDays) ? saved.goodDays : 0,
    quietDays: isCount(saved.quietDays) ? saved.quietDays : 0,
  };
}

// Checks the cat in a backup against the people in that backup.
function checkPet(value: unknown, usernames: ReadonlySet<string>): PetState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw backupError('its office cat is not valid.');
  const { name, day, fed, goodDays, quietDays } = value as Record<string, unknown>;
  const cleaned = cleanName(name);
  if (!cleaned) throw backupError(`its office cat needs a name of 1 to ${MAX_NAME} characters.`);
  if (!isDay(day) || !isCount(goodDays) || !isCount(quietDays)) throw backupError('its office cat has broken days.');
  if (!Array.isArray(fed) || !fed.every((n) => typeof n === 'string' && usernames.has(n))) {
    throw backupError('its office cat was fed by someone who is not on the team.');
  }
  if (new Set(fed).size !== fed.length) throw backupError('its office cat was fed twice by the same person today.');
  return { name: cleaned, day, fed: fed as string[], goodDays, quietDays };
}

export function createPet({ saved, save: store, team, onChange = () => {}, now = () => new Date(), timeZone }: PetOptions) {
  let pet = fromSaved(saved);
  let writing: Promise<unknown> = Promise.resolve();

  const today = () => dateIn(now(), timeZone);

  function save(): void | Promise<void> {
    return store(pet);
  }

  /** What everyone sees: today's cat, even before a new day has been saved. */
  function view(): PetView {
    const members = new Set(team.members());
    const current = rollOver(pet, today());
    return toView({ ...current, fed: current.fed.filter((name) => members.has(name)) });
  }

  // Changes go one at a time, and a reply only says a change is stored once it is. A change
  // that fails, or fails to save, is undone. Each change starts by closing past days.
  function change<T>(task: () => T): Promise<T> {
    const run = writing.then(async () => {
      const before = pet;
      try {
        pet = rollOver(pet, today());
        const result = task();
        await store(pet);
        onChange(view());
        return result;
      } catch (err) {
        pet = before;
        throw err;
      }
    });
    writing = run.catch(() => {});
    return run;
  }

  /** Saves a new day once it starts, and tells open maps. Run it often; it does nothing on the same day. */
  function tick(): Promise<void> {
    if (pet.day === today()) return Promise.resolve();
    return change(() => {}).catch((err) => console.error(err));
  }

  async function route(req: ApiRequest): Promise<ApiResponse> {
    const action = `${req.method} ${req.url.pathname}`;

    if (action === 'GET /api/pet') return jsonResponse(200, view());

    if (action === 'POST /api/pet/feed') {
      const { username } = team.player(req);
      // Feeding twice in a day changes nothing, so a double tap is fine.
      if (view().fed.includes(username)) return jsonResponse(200, view());
      await change(() => {
        // Checked again here: two feeds can both pass the check above while a save is pending.
        if (pet.fed.includes(username)) return;
        pet = { ...pet, fed: [...pet.fed, username] };
      });
      return jsonResponse(200, view());
    }

    if (action === 'PATCH /api/pet/admin') {
      team.requireAdmin(req);
      const name = cleanName((await req.readJson()).name);
      if (!name) throw new ApiError(400, `Give the cat a name of 1 to ${MAX_NAME} characters.`);
      await change(() => {
        pet = { ...pet, name };
      });
      return jsonResponse(200, view());
    }

    throw new ApiError(404, 'Not found.');
  }

  /** Answers the cat's requests, or returns null for anything else. Never throws. */
  async function handle(req: ApiRequest): Promise<ApiResponse | null> {
    const { pathname } = req.url;
    if (pathname !== '/api/pet' && !pathname.startsWith('/api/pet/')) return null;
    try {
      return await route(req);
    } catch (err) {
      return errorResponse(err);
    }
  }

  const feature: TeamFeature = {
    key: 'pet',
    backup: () => pet,
    checkBackup(value, usernames) {
      // Backups from before the cat start with a new kitten.
      const next = value === undefined ? fresh() : checkPet(value, usernames);
      return () =>
        change(() => {
          pet = next;
        }).then(() => {});
    },
    forget: (usernames) =>
      change(() => {
        const gone = new Set(usernames);
        pet = { ...pet, fed: pet.fed.filter((name) => !gone.has(name)) };
      }),
  };

  return { handle, save, view, tick, feature };
}

export type Pet = ReturnType<typeof createPet>;
