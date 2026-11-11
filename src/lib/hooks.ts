import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { TeamState, Weather } from '../../shared/types.ts';
import type { CelebrateView } from '../../shared/celebrate.ts';
import type { FundPerson } from '../../shared/fund.ts';
import type { PetView } from '../../shared/pet.ts';
import type { VoteView } from '../../shared/vote.ts';
import { ambience, DAY, defaultSun, PREVIEW_WEATHER, previewTime, type Ambience, type WeatherInput } from './ambience.ts';
import { subscribe } from './api.ts';
import { withCelebration } from './celebrateLook.ts';
import { replaceSavedMember, type MemberUpdates } from './memberUpdates.ts';
import { withFund } from './fundLook.ts';

/**
 * The team's live state, the team's votes (public views, without anyone's picks), birthdays
 * and anniversaries, and the office cat. Each user carries their fund standing (`fund`) and what they
 * celebrate today (`celebration`), so every page draws the same looks.
 */
export function useTeamState(): {
  state: TeamState | null;
  online: boolean;
  votes: VoteView[] | null;
  fund: FundPerson[] | null;
  celebrate: CelebrateView | null;
  pet: PetView | null;
} & MemberUpdates {
  const [raw, setState] = useState<TeamState | null>(null);
  const [votes, setVotes] = useState<VoteView[] | null>(null);
  const [fund, setFund] = useState<FundPerson[] | null>(null);
  const [celebrate, setCelebrate] = useState<CelebrateView | null>(null);
  const [pet, setPet] = useState<PetView | null>(null);
  const [online, setOnline] = useState(true);
  useEffect(() => subscribe({
    onState: setState,
    onConnection: setOnline,
    onVotes: setVotes,
    onFund: setFund,
    onCelebrate: setCelebrate,
    onPet: setPet,
  }), []);
  const state = useMemo(() => {
    if (!raw || (!fund?.length && !celebrate)) return raw;
    return { ...raw, users: withCelebration(withFund(raw.users, fund), celebrate) };
  }, [raw, fund, celebrate]);
  const onUserSaved = useCallback<MemberUpdates['onUserSaved']>((user) => {
    setState(current => current ? { ...current, users: replaceSavedMember(current.users, user) } : current);
  }, []);
  const onFundSaved = useCallback<MemberUpdates['onFundSaved']>((people) => setFund(people), []);
  return { state, online, votes, fund, celebrate, pet, onUserSaved, onFundSaved };
}

export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * The time, read again every `everyMs` and whenever `changed` changes. Pass the votes as
 * `changed`: a vote closed early ends "now", which a clock read before the update hasn't reached.
 */
export function useNow(everyMs: number, changed?: unknown): Date {
  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setTick(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  // `tick` and `changed` are only reasons to look at the clock again.
  return useMemo(() => new Date(), [tick, changed]);
}

export interface Message {
  text: string;
  isError: boolean;
}

// A status line for a form. Success messages clear by themselves when `fadeMs` is set.
export function useMessage(fadeMs?: number) {
  const [message, setMessage] = useState<Message>({ text: '', isError: false });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback(
    (text: string, isError = false) => {
      setMessage({ text, isError });
      clearTimeout(timer.current);
      if (fadeMs && !isError) timer.current = setTimeout(() => setMessage({ text: '', isError: false }), fadeMs);
    },
    [fadeMs],
  );
  return [message, show] as const;
}

/** Whether the person has asked their device for less motion. Follows changes to the setting. */
export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const onChange = () => setReduced(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * How the town should look now, from the office's weather. Checked every minute so
 * the light changes gradually. Previews on this screen only: `?time=dusk` (or dawn,
 * day, night, or a local HH:MM) and `?weather=rain` (see PREVIEW_WEATHER). When turned
 * off, the town keeps its daytime look, but previews still show.
 */
export function useAmbience(weather: Weather | null, enabled = true): Ambience {
  const [preview] = useState(() => {
    const params = new URLSearchParams(location.search);
    const weather = PREVIEW_WEATHER[params.get('weather') ?? ''];
    return { time: params.get('time'), weather };
  });
  const now = useNow(60_000);
  const minute = Math.floor(now.getTime() / 60_000);
  return useMemo(() => {
    const at = new Date(minute * 60_000);
    if (!preview.time && !preview.weather) return enabled ? ambience(weather, at) : DAY;
    // A weather preview shows that weather alone, without the live cloud, rain and wind detail.
    let shown: WeatherInput | null = weather;
    if (preview.weather) shown = { isDay: weather?.isDay ?? true, sun: weather?.sun, ...preview.weather };
    if (!preview.time) return ambience(shown, at);
    const sun = shown?.sun?.length ? shown.sun : defaultSun(at);
    const time = previewTime(preview.time, sun, at);
    return ambience({ isDay: shown?.isDay ?? true, ...shown, sun }, time ?? at);
  }, [weather, enabled, preview, minute]);
}
