// Monitor page: filters, the people list, and switching between 2D and 3D.
import type { AssemblyCast } from '../components/TeamAssemble.tsx';
import { officeAssembly } from '../lib/assembly.ts';
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import styled, { css } from 'styled-components';
import type { PetView } from '../../shared/pet.ts';
import type { CelebrateView } from '../../shared/celebrate.ts';
import type { TeamState, TeamUser } from '../../shared/types.ts';
import { latestResult, waitingVoters, type VoteView } from '../../shared/vote.ts';
import { DetailCard } from '../components/DetailCard.tsx';
import { PetCard } from '../components/PetCard.tsx';
import { InfoPanel } from '../components/InfoPanel.tsx';
import { Mochi } from '../components/Mochi.tsx';
import { RecentUpdates } from '../components/RecentUpdates.tsx';
import { storeSession, useSession } from '../lib/session.ts';
import { api, ApiFailure, errorText } from '../lib/api.ts';
import { wishReactions } from '../lib/celebrateLook.ts';
import { moverFor, withMove, type PendingMove } from '../lib/dragMove.ts';
import { newFeed, petShown } from '../lib/petLook.ts';
import { useAmbience, useNow, useReducedMotion, useTeamState } from '../lib/hooks.ts';
import { closeTime, diffUpdates, mergeUpdates, seedUpdates, visibleUpdates, type RecentUpdate } from '../lib/recentUpdates.ts';
import { reactions as planReactions, type VoteSnapshot } from '../lib/voteReactions.ts';
import { shownStatus } from '../lib/status.ts';
import { supportsWebGL } from '../lib/webgl.ts';
import { isNotWorking, placeGroup, placeName, type PlaceGroup } from '../lib/layout.ts';
import Map2D from '../map/Map2D.tsx';
import type { FocusRequest, ReactionPlay, VoteMarks } from '../map/types.ts';
import { media, theme } from '../styles/theme.ts';
import { Button, Count, Segmented, Wordmark } from '../styles/ui.ts';

// three.js is large, so it only loads when someone opens the 3D map.
const Map3D = lazy(() => import('../map/Map3D.tsx'));
// The celebration and arcade load only when their map buttons are pressed.
const TeamAssemble = lazy(() => import('../components/TeamAssemble.tsx').then((m) => ({ default: m.TeamAssemble })));
const MemberDialog = lazy(() => import('../components/MemberDialog.tsx').then(m => ({default:m.MemberDialog})));
const RandomPicker = lazy(() => import('../components/RandomPicker.tsx').then(m => ({ default: m.RandomPicker })));
const Basketball = lazy(() => import('../components/Basketball.tsx').then((m) => ({ default: m.Basketball })));

const MODE_KEY = 'minimap.mode';
const NO_VOTES: VoteView[] = [];
const WEATHER_KEY = 'minimap.weather';
const VOTE_MARKS_KEY = 'minimap.voteMarks';
const RECENT_CLOSED_KEY = 'minimap.recentClosed';
// After the server saves a drag, the map waits this long for the live update before it trusts the server again.
const MOVE_SETTLE_MS = 5000;
const MOVE_NOTE_MS = 6000;

type Filter = 'all' | 'office' | 'wfh' | 'notWorking';
type Mode = '2d' | '3d';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'office', label: 'In office' },
  { id: 'wfh', label: 'From home' },
  { id: 'notWorking', label: 'Not working' },
];

const GROUPS: { id: PlaceGroup; name: string }[] = [
  { id: 'working', name: 'Working' },
  { id: 'notWorking', name: 'Not working' },
  { id: 'notCheckedIn', name: 'Not checked in' },
];

const EMPTY_FILTER_TEXT: Record<Filter, string> = {
  all: 'Team members appear here once they are added.',
  office: 'Nobody is in an office right now.',
  wfh: 'Nobody is working from home right now.',
  notWorking: 'Everyone is working or not checked in yet.',
};

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100dvh;

  ${media.phone} { height: auto; }
`;

const TopBar = styled.header`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  padding: 12px 18px;

  ${media.phone} { padding: 12px 16px; }
`;

const TopBarSpacer = styled.div`
  flex: 1;

  ${media.phone} { display: none; }
`;

const Stage = styled.main`
  flex: 1;
  display: flex;
  min-height: 0;
  gap: 14px;
  padding: 0 18px 16px;

  ${media.phone} {
    flex-direction: column;
    padding: 0 16px 16px;
  }
`;

const MapArea = styled.div<{ $is3d: boolean }>`
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;

  ${media.phone} {
    flex: none;
    height: clamp(560px, 185vw, 1080px);
    min-height: 0;

    ${({ $is3d }) => $is3d && css`
      height: clamp(480px, 135vw, 850px);
      min-height: 0;
    `}
  }
  @media (max-width: 860px) and (orientation: landscape) and (max-height: 600px) {
    height: clamp(360px, 72vw, 640px);
    ${({ $is3d }) => $is3d && css`height: clamp(360px, 55vw, 520px);`}
  }
`;

const MapHost = styled.div`
  position: absolute;
  inset: 0;
`;

const OfflineNote = styled.p`
  position: absolute;
  top: 8px;
  left: 50%;
  z-index: 30;
  transform: translateX(-50%);
  padding: 2px 14px;
  border: ${theme.thinLine};
  border-radius: 12px;
  background: ${theme.bubblegum};
  font-weight: 800;
`;

const MoveNote = styled(OfflineNote)`
  top: auto;
  bottom: 12px;
  width: max-content;
  max-width: 90%;
  text-align: center;
`;

const EmptyNote = styled.p`
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 20;
  width: min(340px, 90%);
  transform: translate(-50%, -50%);
  padding: 14px 18px;
  border: ${theme.line};
  border-radius: 16px;
  background: ${theme.paper};
  text-align: center;
`;

// The Recent updates card floats over the map's bottom left corner, so the people list
// keeps its full height and nothing on the page moves when the card shows or hides. That
// corner is clear of the notes at the top centre and the bottom centre. On a map too
// narrow for both, a note goes on top of the card.
const RecentCard = styled(RecentUpdates)<{ $is3d: boolean; $offline: boolean }>`
  position: absolute;
  left: 12px;
  bottom: var(--recent-bottom, 12px);
  z-index: 25;
  width: min(290px, calc(100% - 24px));

  /* In 3D, the hint about dragging and zooming runs along the bottom of that corner, so the
     card sits above it. On a narrow map the hint takes two lines for someone who is logged
     in. The card steps up again while the keyboard is on the map's link to the latest vote
     result, which shows just above the hint. */
  ${({ $is3d }) => $is3d && css`
    --recent-bottom: 40px;
    @media (max-width: 940px) { --recent-bottom: 60px; }
    ${MapArea}:has([data-vote-result]:focus) > & { --recent-bottom: 82px; }
  `}

  /* A phone shows it across the top of the map, so the "Not checked in" room at the bottom stays clear. */
  ${media.phone} {
    top: 8px;
    right: 8px;
    bottom: auto;
    left: 8px;
    width: auto;

    /* Below the 3D map's camera buttons, and below the reconnecting note, which takes two lines here. */
    ${({ $is3d }) => $is3d && css`top: 52px;`}
    ${({ $offline }) => $offline && css`top: 86px;`}
  }
`;

const Side = styled.div`
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 290px;
  min-height: 0;

  ${media.phone} { width: 100%; }
`;

const People = styled.aside`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: ${theme.line};
  border-radius: 18px;
  background: ${theme.paper};
  box-shadow: 0 5px 0 ${theme.ink};
  overflow: hidden;

  ${media.phone} { flex: none; }
`;

// One line per person, so a whole team fits on a wall TV, which can't scroll.
const PeopleUl = styled.ul`
  flex: 1;
  margin: 0;
  padding: 3px 6px;
  list-style: none;
  overflow-y: auto;

  ${media.phone} { padding: 6px; max-height: none; }
`;

const FilterGroup = styled(Segmented)`
  ${media.phone} {
    display: grid;
    grid-template-columns: 1fr 1fr;

    button:nth-child(3) { border-left: 0; }
    button:nth-child(n + 3) { border-top: ${theme.line}; }
  }
`;

const PeopleHeading = styled.li`
  display: flex;
  justify-content: space-between;
  padding: 3px 6px 0;
  color: ${theme.inkSoft};
  font-family: ${theme.displayFont};
  font-size: 13px;
  font-weight: 800;
  line-height: 1.35;
`;

const PeopleEmpty = styled.li`
  padding: 14px;
  color: ${theme.inkSoft};
  text-align: center;
`;

const PersonRow = styled.button<{ $selected: boolean }>`
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 1px 6px;
  border: 0;
  border-radius: 8px;
  background: none;
  text-align: left;
  cursor: pointer;

  &:hover { background: #eef8ff; }

  ${({ $selected }) => $selected && css`
    &, &:hover { background: ${theme.butter}; }
  `}

  /* Phones scroll, and their rows need to be big enough to tap. */
  ${media.phone} {
    grid-template-columns: 32px minmax(0, 1fr);
    padding: 5px 8px;
  }
`;

const RowAvatar = styled.span`
  width: 22px;
  height: 22px;

  ${media.phone} { width: 32px; height: 32px; }
`;

const RowText = styled.span`
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
`;

const RowName = styled.span`
  flex: 0 1 auto;
  max-width: 62%;
  overflow: hidden;
  font-family: ${theme.displayFont};
  font-size: 14px;
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const RowWhere = styled.span`
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  color: ${theme.inkSoft};
  font-size: 12px;
  line-height: 1.3;
  text-align: right;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

function readSaved(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

// Falls back to the 2D map if the 3D map can't load or crashes.
// Keeps the map running when a part fails or can't be downloaded: that part just isn't shown.
class Guard extends Component<{ what: string; onFail?: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`Could not show ${this.props.what}`, error);
    this.props.onFail?.();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function PeopleList({ state, people, filter, selected, onPick }: {
  state: TeamState;
  people: TeamUser[];
  filter: Filter;
  selected: string | null;
  onPick: (username: string, row: HTMLElement) => void;
}) {
  function fullWhere(user: TeamUser): string {
    const place = placeName(state.places, user.place);
    const status = shownStatus(user);
    return status ? `${place}: ${status}` : place;
  }

  if (!people.length) {
    const text = state.users.length ? EMPTY_FILTER_TEXT[filter] : EMPTY_FILTER_TEXT.all;
    return (
      <PeopleUl>
        <PeopleEmpty>{text}</PeopleEmpty>
      </PeopleUl>
    );
  }

  return (
    <PeopleUl>
      {GROUPS.flatMap((group) => {
        const members = people.filter((user) => placeGroup(user.place, state.places) === group.id);
        if (!members.length) return [];
        return [
          <PeopleHeading key={group.id}>
            <span>{group.name}</span>
            <span>{members.length}</span>
          </PeopleHeading>,
          ...members.map((user) => (
            <li key={user.username}>
              <PersonRow
                type="button"
                data-person-row
                title={fullWhere(user)}
                $selected={selected === user.username}
                onClick={(event) => onPick(user.username, event.currentTarget)}
              >
                <RowAvatar><Mochi user={user} /></RowAvatar>
                <RowText>
                  <RowName>{user.nickname}</RowName>
                  <RowWhere>{shownStatus(user) || placeName(state.places, user.place)}</RowWhere>
                </RowText>
              </PersonRow>
            </li>
          )),
        ];
      })}
    </PeopleUl>
  );
}

export function MonitorPage() {
  const { state: liveState, online, votes, celebrate, pet: petView, onUserSaved, onFundSaved } = useTeamState();
  // Someone logged in on this browser can drag their own character to another room.
  const session = useSession(liveState);
  const login = session.auth;
  const [memberDialog, setMemberDialog] = useState<{account: boolean; trigger: HTMLElement} | null>(null);
  const closeMemberDialog = useCallback(() => setMemberDialog(null), []);
  function openMemberDialog(event: ReactMouseEvent<HTMLElement>, account: boolean) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setSelection(null);
    setMemberDialog({account, trigger: event.currentTarget});
  }
  const [move, setMove] = useState<(PendingMove & { saved: boolean }) | null>(null);
  const [moveError, setMoveError] = useState('');
  // The map shows a dragged move straight away, while the server saves it.
  const state = useMemo(() => liveState && withMove(liveState, move), [liveState, move]);
  const mover = useMemo(() => moverFor(liveState?.users ?? [], login?.username), [liveState, login]);
  const has3D = useMemo(supportsWebGL, []);
  const [filter, setFilter] = useState<Filter>('all');
  const [mode, setMode] = useState<Mode>(() => {
    const requested = new URLSearchParams(location.search).get('mode') || readSaved(MODE_KEY);
    return requested === '3d' && has3D ? '3d' : '2d';
  });
  const [selection, setSelection] = useState<{ username: string; anchor: HTMLElement } | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [arcadeRequest, setArcadeRequest] = useState<{trigger: HTMLElement} | null>(null);
  const openArcade = useCallback((trigger: HTMLElement) => setArcadeRequest({trigger}), []);
  const [assemblyCast, setAssemblyCast] = useState<AssemblyCast | null>(null);
  const closeAssembly = useCallback(() => setAssemblyCast(null), []);
  function openAssembly(trigger: HTMLElement) {
    if (!state) return;
    const attendance = officeAssembly(state);
    if (attendance.unlocked) {
      closeCard();
      setAssemblyCast({members:structuredClone(attendance.members),total:attendance.total,trigger});
    }
  }
  const pickerTrigger = useRef<HTMLElement | null>(null);
  const openPicker = useCallback((trigger: HTMLElement) => { pickerTrigger.current = trigger; setSelection(null); setPickerOpen(true); }, []);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Each screen can turn the town's daylight and weather off, if the admin has them on.
  const [weatherOn, setWeatherOn] = useState(() => readSaved(WEATHER_KEY) !== 'off');
  const weatherAllowed = Boolean(state?.settings.officeName) && state?.settings.mapWeather !== false;
  const look = useAmbience(state?.weather ?? null, weatherAllowed && weatherOn);
  // A wall TV can hide the "hasn't voted" markers and the results banner.
  const [voteMarksOn, setVoteMarksOn] = useState(() => readSaved(VOTE_MARKS_KEY) !== 'off');
  // Votes close by the clock, with no message from the server, or early with one.
  const now = useNow(15_000, votes);
  const allVotes = votes ?? NO_VOTES;
  const voteMarks = useMemo<VoteMarks | null>(
    () => (voteMarksOn ? { waiting: waitingVoters(allVotes, now), result: latestResult(allVotes, now) } : null),
    [voteMarksOn, allVotes, now],
  );
  // Characters react to votes coming in and closing, unless motion is turned down.
  const reduced = useReducedMotion();
  const lastLook = useRef<VoteSnapshot | null>(null);
  const [reactions, setReactions] = useState<ReactionPlay | null>(null);
  useEffect(() => {
    if (!votes) return;
    const look = { votes, at: new Date() };
    const list = planReactions(lastLook.current, look);
    lastLook.current = look;
    if (list.length && !reduced) setReactions({ id: look.at.getTime(), list });
  }, [votes, now, reduced]);
  // Confetti over someone celebrating when a teammate sends wishes.
  const lastParty = useRef<CelebrateView | null>(null);
  useEffect(() => {
    if (!celebrate) return;
    const list = wishReactions(lastParty.current, celebrate);
    lastParty.current = celebrate;
    if (list.length && !reduced) setReactions({ id: Date.now(), list });
  }, [celebrate, reduced]);

  // Recent updates: who changed their place or status in the last few minutes. Each state
  // from the server is compared with the one before it. A drag shown early (`state`) isn't
  // an update until the server says so, or it would make two rows.
  const lastLive = useRef<TeamState | null>(null);
  const [updates, setUpdates] = useState<RecentUpdate[]>([]);
  const [recentClosed, setRecentClosed] = useState(() => Number(readSaved(RECENT_CLOSED_KEY)) || 0);
  // While live updates are cut off, states are missed, so the next one can't be compared with the last one seen.
  const missedStates = useRef(false);
  useEffect(() => {
    if (!online) missedStates.current = true;
  }, [online]);
  useEffect(() => {
    if (!liveState) return;
    const prev = lastLive.current;
    const missed = missedStates.current;
    lastLive.current = liveState;
    missedStates.current = false;
    const seen = new Date();
    // The first state, and the first after a gap, have no "before": they show who was updated lately, and where they are now.
    const added = prev && !missed ? diffUpdates(prev, liveState) : seedUpdates(liveState, seen, prev);
    if (added.length) setUpdates((list) => mergeUpdates(list, added, seen));
  }, [liveState]);
  const recent = useMemo(() => visibleUpdates(updates, now, recentClosed), [updates, now, recentClosed]);

  // Hides the rows that are showing. The time is saved, so a reload doesn't bring them back.
  function closeRecent() {
    const closed = closeTime(recent);
    save(RECENT_CLOSED_KEY, String(closed));
    setRecentClosed(closed);
  }

  useEffect(() => {
    document.title = 'Team Minimap';
  }, []);

  // A saved move is done once the live update shows it, or after a while if that update is missed.
  const liveMoved = move?.saved && liveState?.users.find((u) => u.username === move.username)?.place === move.place;
  useEffect(() => {
    if (!move?.saved) return;
    if (liveMoved) {
      setMove(null);
      return;
    }
    const timer = setTimeout(() => setMove(null), MOVE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [move, liveMoved]);

  useEffect(() => {
    if (!moveError) return;
    const timer = setTimeout(() => setMoveError(''), MOVE_NOTE_MS);
    return () => clearTimeout(timer);
  }, [moveError]);

  const moveMe = useCallback(
    async (place: string | null) => {
      if (!login || !mover) return;
      const request = { username: login.username, place };
      const isThis = (current: PendingMove | null) => current?.username === request.username && current.place === place;
      setMove({ ...request, saved: false });
      setMoveError('');
      try {
        await api('PATCH', '/api/me', { place }, { Authorization: `Bearer ${login.token}` });
        setMove((current) => (current && isThis(current) ? { ...current, saved: true } : current));
      } catch (err) {
        // Put them back where the server has them.
        if (err instanceof ApiFailure && err.status === 401) storeSession(null);
        setMove((current) => (isThis(current) ? null : current));
        setMoveError(
          err instanceof ApiFailure && err.status === 401
            ? 'Your login has ended. Use Log in on the home page to move yourself.'
            : `Could not move you. ${errorText(err)}`,
        );
      }
    },
    [login, mover],
  );

  const places = state?.places;
  const officeIds = useMemo(() => new Set(places?.map((p) => p.id)), [places]);

  const matches = useCallback(
    (user: TeamUser) => {
      if (filter === 'office') return user.place !== null && officeIds.has(user.place);
      if (filter === 'wfh') return user.place === 'wfh';
      if (filter === 'notWorking') return isNotWorking(user.place);
      return true;
    },
    [filter, officeIds],
  );
  const isDimmed = useCallback((user: TeamUser) => !matches(user), [matches]);

  // The office cat hops each time someone feeds it, and its card opens from either map.
  const [cheer, setCheer] = useState(0);
  const lastPet = useRef<PetView | null>(null);
  useEffect(() => {
    if (!petView) return;
    if (newFeed(lastPet.current, petView)) setCheer((n) => n + 1);
    lastPet.current = petView;
  }, [petView]);
  const pet = useMemo(() => (state ? petShown(petView, state, cheer) : null), [petView, state, cheer]);
  const [petAnchor, setPetAnchor] = useState<HTMLElement | null>(null);
  const closePet = useCallback(() => setPetAnchor(null), []);
  const openPet = useCallback((trigger: HTMLElement) => {
    setSelection(null);
    setPetAnchor(trigger);
  }, []);

  const closeCard = useCallback(() => setSelection(null), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const select = useCallback((username: string, anchor: HTMLElement) => {
    setPetAnchor(null);
    setSelection({ username, anchor });
  }, []);

  // A list click points at the person on the map; the row is the fallback.
  function pickFromList(username: string, row: HTMLElement) {
    setFocus({ username, at: Date.now() });
    const badge = document.querySelector<HTMLElement>(`[data-map-root] [data-badge][data-username="${CSS.escape(username)}"]`);
    select(username, badge ?? row);
  }

  function chooseMode(next: Mode) {
    save(MODE_KEY, next);
    closeCard();
    setMode(next);
  }

  // Not saved, so the next visit tries 3D again.
  function fallBackTo2D() {
    closeCard();
    setMode('2d');
  }

  function chooseFilter(next: Filter) {
    closeCard();
    setFilter(next);
  }

  const users = state?.users ?? [];
  const counts: Record<Filter, number> = {
    all: users.length,
    office: users.filter((u) => u.place !== null && officeIds.has(u.place)).length,
    wfh: users.filter((u) => u.place === 'wfh').length,
    notWorking: users.filter((u) => isNotWorking(u.place)).length,
  };

  const people = useMemo(() => {
    const order: (string | null)[] = [...(places ?? []).map((p) => p.id), 'wfh', 'out', 'off', null];
    return (state?.users ?? [])
      .filter(matches)
      .sort((a, b) => order.indexOf(a.place) - order.indexOf(b.place) || a.nickname.localeCompare(b.nickname));
  }, [state, places, matches]);

  const selectedUser = selection ? users.find((u) => u.username === selection.username) : undefined;

  // The selected person was deleted.
  useEffect(() => {
    if (state && selection && !selectedUser) closeCard();
  }, [state, selection, selectedUser, closeCard]);

  const mapProps = state && { state, isDimmed, selected: selection?.username ?? null, focus, onSelect: select, onArcade: openArcade, pet, onPet: openPet, onAssemble: openAssembly, onPicker: openPicker, look, votes: allVotes, voteMarks, reactions, mover, onMove: moveMe };

  return (
    <Page>
      <TopBar>
        <Wordmark href="/">Team Minimap</Wordmark>
        <FilterGroup role="group" aria-label="Show people">
          {FILTERS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => chooseFilter(id)}>
              {label}<Count>{counts[id]}</Count>
            </button>
          ))}
        </FilterGroup>
        <Segmented role="group" aria-label="Map style">
          <button type="button" aria-pressed={mode === '2d'} onClick={() => chooseMode('2d')}>2D</button>
          <button
            type="button"
            aria-pressed={mode === '3d'}
            disabled={!has3D}
            title={has3D ? undefined : 'This browser cannot show 3D graphics'}
            onClick={() => chooseMode('3d')}
          >
            3D
          </button>
        </Segmented>
        {weatherAllowed && (
          <Segmented role="group" aria-label="Town">
            <button
              type="button"
              aria-pressed={weatherOn}
              title="Show the office's daylight and weather on the map"
              onClick={() => {
                save(WEATHER_KEY, weatherOn ? 'off' : 'on');
                setWeatherOn(!weatherOn);
              }}
            >
              Weather
            </button>
          </Segmented>
        )}
        <Segmented role="group" aria-label="Votes on the map">
          <button
            type="button"
            aria-pressed={voteMarksOn}
            title="Show who hasn't voted yet, and the latest result"
            onClick={() => {
              save(VOTE_MARKS_KEY, voteMarksOn ? 'off' : 'on');
              setVoteMarksOn(!voteMarksOn);
            }}
          >
            Votes
          </button>
        </Segmented>
        <TopBarSpacer />
        {session.auth ? <>
          <Button as="a" $primary href="/me" data-member-dialog-trigger aria-haspopup="dialog" onClick={event => openMemberDialog(event, false)}>Update status</Button>
          <Button as="a" href="/account" data-member-dialog-trigger aria-haspopup="dialog" onClick={event => openMemberDialog(event, true)} style={{maxWidth: 'min(220px, 100%)', whiteSpace: 'normal', overflowWrap: 'anywhere'}} aria-label={`Account settings for ${session.auth.username}`}>@{session.auth.username}</Button>
        </> : session.pending ? <span role="status">Checking account…</span> :
          session.error ? <Button onClick={session.retry}>Retry account check</Button> :
          <Button as="a" $primary href="/me" data-member-dialog-trigger aria-haspopup="dialog" onClick={event => openMemberDialog(event, false)}>Log in</Button>}

      </TopBar>

      <Stage>
        <MapArea $is3d={mode === '3d'}>
          {/* Before the map, so the keyboard and screen readers reach the news ahead of everyone on the map. */}
          {state && (
            <RecentCard
              $is3d={mode === '3d'}
              $offline={!online}
              rows={recent}
              users={users}
              places={state.places}
              now={now}
              onClose={closeRecent}
              onPick={pickFromList}
            />
          )}
          <MapHost>
            {mapProps && mode === '2d' && <Map2D {...mapProps} />}
            {mapProps && mode === '3d' && (
              <Guard what="the 3D map" onFail={fallBackTo2D}>
                <Suspense fallback={null}>
                  <Map3D {...mapProps} onFail={fallBackTo2D} />
                </Suspense>
              </Guard>
            )}
          </MapHost>
          {/* Loaded on the first Play, then kept, so a finished round that wasn't saved stays available. */}
          {arcadeRequest && (
            <Guard what="the basketball arcade">
              <Suspense fallback={null}>
                <Basketball initialView={mode} users={users} request={arcadeRequest} />
              </Suspense>
            </Guard>
          )}
          {!online && <OfflineNote role="status">Reconnecting to the server</OfflineNote>}
          {moveError && <MoveNote role="alert">{moveError}</MoveNote>}
          {state && !state.users.length && (
            <EmptyNote>No team members yet. Add usernames on the <a href="/admin">Admin page</a>.</EmptyNote>
          )}
        </MapArea>

        <Side>
          {state && <InfoPanel state={state} votes={allVotes} celebrate={celebrate} />}
          <People aria-label="Team members">
            {state && <PeopleList state={state} people={people} filter={filter} selected={selection?.username ?? null} onPick={pickFromList} />}
          </People>
        </Side>
      </Stage>

      {memberDialog && (
        <Guard what="the member editor" onFail={closeMemberDialog}>
          <Suspense fallback={null}>
            <MemberDialog {...memberDialog} state={liveState} session={session} onUserSaved={onUserSaved} onFundSaved={onFundSaved} onClose={closeMemberDialog}/>
          </Suspense>
        </Guard>
      )}

      {assemblyCast && (
        <Guard what="the team assembly" onFail={closeAssembly}>
          <Suspense fallback={null}>
            <TeamAssemble cast={assemblyCast} initialView={mode} onClose={closeAssembly}/>
          </Suspense>
        </Guard>
      )}

      {state && pickerOpen && (
        <Guard what="the random picker" onFail={closePicker}>
          <Suspense fallback={null}>
            <RandomPicker users={users} initialView={mode} trigger={pickerTrigger.current} onClose={closePicker}/>
          </Suspense>
        </Guard>
      )}

      {state && petAnchor && petView && pet && (
        <PetCard pet={petView} shown={pet} users={state.users} login={login ?? null} anchor={petAnchor} onClose={closePet} />
      )}

      {state && selection && selectedUser && (
        <DetailCard
          user={selectedUser}
          places={state.places}
          votes={allVotes}
          users={state.users}
          celebrate={celebrate}
          login={login ?? null}
          anchor={selection.anchor}
          onClose={closeCard}
        />
      )}
    </Page>
  );
}
