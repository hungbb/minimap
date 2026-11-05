import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { TeamState, Weather } from '../../shared/types.ts';
import { ambience, defaultSun, previewTime, type Ambience } from './ambience.ts';
import { subscribe } from './api.ts';

export function useTeamState(): { state: TeamState | null; online: boolean } {
  const [state, setState] = useState<TeamState | null>(null);
  const [online, setOnline] = useState(true);
  useEffect(() => subscribe(setState, setOnline), []);
  return { state, online };
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

export function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
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
 * the light changes gradually. `?time=dusk` (or dawn, day, night, or a local HH:MM)
 * previews another time of day on this screen only.
 */
export function useAmbience(weather: Weather | null): Ambience {
  const [preview] = useState(() => new URLSearchParams(location.search).get('time'));
  const now = useNow(60_000);
  const minute = Math.floor(now.getTime() / 60_000);
  return useMemo(() => {
    const at = new Date(minute * 60_000);
    if (!preview) return ambience(weather, at);
    const sun = weather?.sun?.length ? weather.sun : defaultSun(at);
    const shown = previewTime(preview, sun, at);
    return shown ? ambience({ isDay: weather?.isDay ?? true, sun }, shown) : ambience(weather, at);
  }, [weather, preview, minute]);
}
