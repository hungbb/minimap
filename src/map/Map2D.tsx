// The 2D floor plan, built from plain HTML and SVG.
import { Traffic2D } from './Traffic2D.tsx';
import { officeAssembly } from '../lib/assembly.ts';
import { AssemblePlay, OfficeDecor } from '../components/AssemblyDecor.tsx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import styled, { css, keyframes, type RuleSet } from 'styled-components';
import type { TeamUser } from '../../shared/types.ts';
import { Badge, BadgeFigure, type SelectHandler } from '../components/Badge.tsx';
import { Desk, Mochi, MochiSvg } from '../components/Mochi.tsx';
import { useElementSize, useReducedMotion } from '../lib/hooks.ts';
import { createPress, dropPlace, zoneAt } from '../lib/dragMove.ts';
import { computeLayout, noticeBoardSpot, parkActivities, petSpot, type MapLayout, type Seat, type Zone, type ZoneKind } from '../lib/layout.ts';
import type { Ambience } from '../lib/ambience.ts';
import { lookFor } from '../lib/look.ts';
import { media, theme } from '../styles/theme.ts';
import { DECOR, Tree, STREET_ART, Umbrella } from './decor.tsx';
import { ArcadeCabinet2D } from './ArcadeCabinet.tsx';
import { OfficeCat2D } from './OfficeCat2D.tsx';
import { parkTrees } from '../lib/parkTrees.ts';
import { PickerCabinet } from './PickerCabinet.tsx';
import { NoticeBoard2D } from './NoticeBoard2D.tsx';
import { ResultBanner2D } from './ResultBanner2D.tsx';
import type { MapProps } from './types.ts';
import type { ReactionKind } from '../lib/voteReactions.ts';
import { hasWeather, WeatherOverlay } from './WeatherOverlay.tsx';

const HOP_MS = 900;

const MapFill = styled.div`
  isolation: isolate;
  /* Keep the previous measured plan from spilling while ResizeObserver catches up. */
  overflow: clip;
  /* Resizing reflows the whole town together; attendance changes can still glide. */
  &[data-reflow] * { transition: none !important; }
  position: absolute;
  inset: 0;
`;

// ---- Daylight -------------------------------------------------------------
// The map sets --night, --warm, --lamps, --sky-top and --sky-bottom from the
// office's daylight (lib/ambience.ts). In the daytime they're all zero, so the
// map looks just as it always has.

/** The sky behind the town, which only shows at dawn, dusk, night and on grey days. */
const Sky = styled.div`
  position: absolute;
  inset: 0;
  border-radius: 22px;
  background: linear-gradient(var(--sky-top), var(--sky-bottom));
  opacity: max(var(--night), var(--warm), var(--gloom));
  pointer-events: none;
`;

const Stars = styled(Sky)`
  background:
    radial-gradient(#fff 1px, transparent 1.7px) 0 0 / 53px 47px,
    radial-gradient(rgb(255 255 255 / .7) 1px, transparent 1.7px) 23px 31px / 71px 61px;
  /* Clouds hide them. */
  opacity: calc((var(--night) - .5) * 2 * (1 - var(--clouds)));
`;

/**
 * Dims an area's floor and furniture at night and warms it at sunset, beneath the
 * people and their names so they stay easy to read. Indoor rooms keep their lights on.
 */
const shade = css`
  &::after {
    --tint-warm: rgb(255 140 70 / calc(var(--warm, 0) * .2));
    --tint-lights: rgb(255 214 140 / calc(var(--night, 0) * var(--lights, 0)));
    --tint-night: rgb(28 32 92 / calc(var(--night, 0) * var(--dark, .55)));
    --tint-gloom: rgb(120 128 150 / calc(var(--gloom, 0) * var(--grey, .4)));
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background:
      linear-gradient(var(--tint-warm), var(--tint-warm)),
      linear-gradient(var(--tint-lights), var(--tint-lights)),
      linear-gradient(var(--tint-night), var(--tint-night)),
      linear-gradient(var(--tint-gloom), var(--tint-gloom));
    mix-blend-mode: multiply;
    pointer-events: none;
  }

  /* In the plain daytime look the tint is fully clear, so skip the blending altogether. */
  [data-plain] &::after { display: none; }
`;

const INDOORS = css`
  --dark: .12;
  --lights: .22;
  --grey: .15;
`;

const Plan = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
`;

// The street's pavement runs along its top, then a curb line, then the road. Shares of its height, in %.
const PAVEMENT = 28;
const CURB = 1.5;

const ZONE_LOOKS: Record<ZoneKind, RuleSet> = {
  office: css`
    background: repeating-conic-gradient(#e6deff 0 25%, #f1ecff 0 50%) 0 0 / 40px 40px;
  `,
  wfh: css`
    border-radius: 26px 26px 64px 26px;
    background: radial-gradient(#a4e8c0 2px, transparent 3px) 0 0 / 22px 22px, ${theme.mint};
  `,
  off: css`
    border-radius: 26px 64px 26px 26px;
    background: linear-gradient(105deg, ${theme.sand} 0 62%, ${theme.water} 62.5%);
  `,
  lobby: css`
    background: repeating-linear-gradient(90deg, #ffe0ec 0 26px, #ffebf2 26px 52px);
  `,
  // A pavement, a curb, then the road and its lane markings.
  street: css`
    background:
      repeating-linear-gradient(90deg, #fff 0 24px, transparent 24px 52px) 0 66% / 100% 3px no-repeat,
      linear-gradient(#efe9f7 0 ${PAVEMENT}%, ${theme.ink} ${PAVEMENT}% ${PAVEMENT + CURB}%, #8d8ba5 ${PAVEMENT + CURB}%);
  `,
};

const GLIDE = '.9s cubic-bezier(.45, .05, .3, 1)';

const Room = styled.section<{ $kind: ZoneKind; $dropTarget: boolean }>`
  position: absolute;
  /* Lets a small room's name get smaller when the room is narrow (see RoomTitle). */
  container-type: inline-size;
  border: ${theme.line};
  border-radius: 20px;
  box-shadow: 0 5px 0 ${theme.ink};
  /* Rooms grow and shrink with their people, at the same pace people walk. */
  transition: left ${GLIDE}, top ${GLIDE}, width ${GLIDE}, height ${GLIDE};

  ${media.reducedMotion} { transition: none; }

  ${({ $kind }) => ZONE_LOOKS[$kind]}
  ${({ $kind }) => ($kind === 'office' || $kind === 'lobby') && INDOORS}
  ${shade}

  /* The room someone is about to drop themselves into. */
  ${({ $dropTarget }) => $dropTarget && css`
    outline: 4px dashed ${theme.focus};
    outline-offset: 3px;
  `}
`;

const Park = styled.div`
  position: absolute;
  border-radius: 20px;
  background: radial-gradient(#a4e8c0 2px, transparent 3px) 0 0 / 22px 22px, ${theme.mint};
  transition: left ${GLIDE}, top ${GLIDE}, width ${GLIDE}, height ${GLIDE};

  ${media.reducedMotion} { transition: none; }

  ${shade}
`;

// The lobby and the beach are kept small beside the park, so when they are narrow
// their names get the smaller size a phone gets. "Not checked in" doesn't fit otherwise.
const NARROW_ROOM = '@container (max-width: 172px)';

const compactTitle = css`
  left: 8px;
  gap: 4px;
  max-width: calc(100% - 12px);
  padding: 0 7px 1px;
  font-size: 12.5px;
`;

const RoomTitle = styled.h2<{ $smallRoom: boolean }>`
  position: absolute;
  top: -3px;
  left: 14px;
  z-index: 1;
  display: flex;
  gap: 7px;
  max-width: calc(100% - 22px);
  padding: 1px 11px 2px;
  border: ${theme.line};
  border-radius: 0 0 12px 12px;
  background: ${theme.paper};
  font-family: ${theme.displayFont};
  font-size: 15px;
  font-weight: 800;
  line-height: 1.15;

  ${({ $smallRoom }) => $smallRoom && css`${NARROW_ROOM} { ${compactTitle} }`}
  ${media.phone} { ${compactTitle} }
`;

// A name still too long for its room goes onto a second line, so "Not checked in" is
// never cut short. Only a name that needs more than two lines ends in an ellipsis.
const RoomName = styled.span`
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  text-wrap: balance;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  /* With the tight line height above, this keeps a one-line name as tall as it always was. */
  padding: .25em 0 .2em;
`;

const RoomCount = styled.span`
  flex: none;
  padding: .25em 0 .2em;
  font-weight: 500;
`;

const sway = keyframes`
  from { rotate: calc(var(--wind) * -5deg); }
  to { rotate: calc(var(--wind) * 5deg); }
`;

const DecorBox = styled.div<{ $hidden: boolean }>`
  position: absolute;
  /* Rooms change shape with their people, so furniture can't outgrow a wide, short room. */
  max-width: 90px;
  max-height: 62%;
  pointer-events: none;
  transform-origin: 50% 100%;

  [data-windy] &[data-sway] { animation: ${sway} calc(2.4s - var(--wind) * 1s) ease-in-out infinite alternate; }

  ${media.reducedMotion} { animation: none !important; }

  ${({ $hidden }) => $hidden && 'display: none;'}
`;

/** Snow settled along the top of an area. */
const SnowCap = styled.div`
  position: absolute;
  top: -6px;
  left: 10px;
  right: 10px;
  height: 13px;
  border-radius: 8px 8px 0 0;
  background:
    radial-gradient(circle at 8px 5px, #fff 6.5px, transparent 7px) 0 0 / 16px 13px repeat-x,
    linear-gradient(#fff, #fff) 0 0 / 100% 6px no-repeat;
  opacity: var(--snow);
  filter: drop-shadow(0 1px 0 rgb(42 38 87 / .25));
  pointer-events: none;
`;

/** A puddle on the road, shining while it rains. */
const Puddle = styled.span`
  position: absolute;
  aspect-ratio: 3;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgb(205 225 255 / .7), rgb(160 190 235 / .45) 65%, transparent);
  opacity: var(--wet);
  pointer-events: none;
`;

// Held over one shoulder, beside the status bubble above the head, and behind everything
// else in the person's badge, so their status and name always stay on top.
const UmbrellaBox = styled.span`
  position: absolute;
  z-index: -1;
  left: 58%;
  top: -14px;
  width: 50px;
  transform: rotate(16deg);
  transform-origin: 30% 100%;
  aspect-ratio: 64 / 60;
  pointer-events: none;

  svg { display: block; }
`;

const UMBRELLA_COLOURS = ['#ff8fb3', '#8fc9ff', '#ffe27a', '#b7a6ff', '#9fe89a'];

const StreetPiece = styled.div`
  position: absolute;
  pointer-events: none;

  svg { display: block; }
`;

// A lamp's light, which shows as it gets dark. It sits above the street's night shade.
const LampGlow = styled.span`
  position: absolute;
  z-index: -1;
  left: 69%;
  top: 25%;
  width: 260%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgb(255 226 122 / .85), rgb(255 226 122 / .3) 45%, transparent);
  opacity: var(--lamps, 0);
  transform: translate(-50%, -50%);
`;

// Painted across the whole road, from the curb to the bottom edge.
const Crosswalk = styled(StreetPiece)`
  top: calc(${PAVEMENT + CURB}% + 4px);
  bottom: 4px;
  left: 44%;
  width: clamp(30px, 7%, 64px);
  background: repeating-linear-gradient(#fff 0 6px, transparent 6px 12px);
`;

/**
 * Lamps stand on the curb and reach a little above the pavement, clear of the rooms
 * above at any street height. The left one keeps clear of the street's name.
 */
function StreetDecor() {
  const lamp = { bottom: `${100 - PAVEMENT}%`, height: `calc(${PAVEMENT}% + 8px)`, aspectRatio: '36 / 52', zIndex: 1 };
  return (
    <>
      <StreetPiece style={{ ...lamp, left: 'max(16%, 150px)' }}><LampGlow />{STREET_ART.lamp}</StreetPiece>
      <StreetPiece style={{ ...lamp, right: '24%' }}><LampGlow />{STREET_ART.lamp}</StreetPiece>
      <Crosswalk />
      <Puddle style={{ left: '22%', bottom: '14%', width: 'clamp(30px, 8%, 70px)' }} />
      <Puddle style={{ left: '61%', bottom: '38%', width: 'clamp(24px, 6%, 54px)' }} />
      <Puddle style={{ left: '76%', bottom: '10%', width: 'clamp(28px, 7%, 62px)' }} />
    </>
  );
}

const bob = keyframes`
  0%, 100% { transform: scale(1, 1); }
  50% { transform: scale(1.03, .96); }
`;

const waddle = keyframes`
  0%, 100% { transform: rotate(-5deg); }
  50% { transform: rotate(5deg); }
`;

const hop = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-12px); }
`;

// Position and scale change often, so they stay inline rather than become classes.
const confettiFly = keyframes`
  from { transform: translate(0, 0) rotate(0); opacity: 1; }
  to { transform: translate(var(--x), var(--y)) rotate(320deg); opacity: 0; }
`;

const tagRise = keyframes`
  0% { transform: translate(-50%, 6px) scale(.6); opacity: 0; }
  15%, 85% { transform: translate(-50%, 0) scale(1); opacity: 1; }
  100% { transform: translate(-50%, -6px) scale(1); opacity: 0; }
`;

/** 🙌 or 👏 over someone cheering or clapping when a vote closes. */
const ReactionTag = styled.span`
  position: absolute;
  bottom: 100%;
  left: 50%;
  z-index: 5;
  font-size: 20px;
  line-height: 1;
  pointer-events: none;
  animation: ${tagRise} 3s ease-out forwards;
`;

const Confetti = styled.span`
  position: absolute;
  top: 20%;
  left: 50%;
  z-index: 5;
  pointer-events: none;

  i {
    position: absolute;
    width: 6px;
    height: 9px;
    border-radius: 1px;
    animation: ${confettiFly} 1.4s ease-out forwards;
  }
`;

const CONFETTI = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  return {
    x: `${Math.round(Math.cos(angle) * (28 + (i % 3) * 10))}px`,
    y: `${Math.round(Math.sin(angle) * (24 + (i % 4) * 8) - 18)}px`,
    colour: ['#ff9cc2', '#ffe27a', '#8fddf5', '#bdf0d2', '#b7a6ff'][i % 5]!,
  };
});

const PersonBox = styled.div<{ $dimmed: boolean; $moving: boolean; $strolling: boolean; $reaction?: ReactionKind; $draggable: boolean; $dragging: boolean }>`
  position: absolute;
  z-index: 3;
  transform: translate(-50%, -50%) scale(var(--s, 1));
  transition: left ${GLIDE}, top ${GLIDE}, opacity .25s, transform .3s;

  &:hover, &:focus-within { z-index: 10; }

  ${({ $dimmed }) => $dimmed && 'opacity: .22;'}

  ${({ $strolling }) => $strolling && css`
    /* Traffic updates these positions directly so dodges never lag behind a car. */
    transition: opacity .25s, transform .3s;
  `}

  ${MochiSvg} {
    animation: ${bob} 2.6s ease-in-out infinite;
    animation-delay: var(--d, 0s);
    transform-origin: 50% 100%;

    ${({ $strolling }) => $strolling && css`
      animation: ${waddle} .9s ease-in-out infinite;
    `}

    ${({ $moving }) => $moving && css`
      animation: ${hop} .45s ease-in-out 2;
    `}

    ${({ $reaction }) => ($reaction === 'hop' || $reaction === 'confetti') && css`
      animation: ${hop} .5s ease-out 1;
    `}
    ${({ $reaction }) => $reaction === 'cheer' && css`
      animation: ${hop} .5s ease-in-out 6;
    `}
    ${({ $reaction }) => $reaction === 'clap' && css`
      animation: ${waddle} .3s ease-in-out 10;
    `}
  }

  /* Your own character can be picked up, also by touch, so the page mustn't scroll or select text instead. */
  ${({ $draggable }) => $draggable && css`
    touch-action: none;
    user-select: none;
    -webkit-touch-callout: none;

    [data-badge] { cursor: grab; }
  `}

  /* Follows the pointer straight away, then glides to its new seat when let go. */
  ${({ $dragging }) => $dragging && css`
    &, &:hover, &:focus-within { z-index: 20; }
    transition: opacity .25s, transform .3s;
    animation: none;

    [data-badge] { cursor: grabbing; }

    ${MochiSvg} { animation: ${waddle} .3s ease-in-out infinite; }
  `}

  ${media.reducedMotion} {
    animation: none;
    transition: opacity .25s;

    ${MochiSvg} { animation: none; }
  }
`;

function percent(part: number, whole: number): string {
  return `${(part / whole) * 100}%`;
}

function ZoneRoom({ zone, layout, busy, snowy, assembled, dropTarget, onAssemble }: { zone: Zone; layout: MapLayout; busy: boolean; snowy: boolean; assembled: boolean; dropTarget: boolean; onAssemble: (trigger: HTMLElement)=>void }) {
  const style: CSSProperties = {
    left: percent(zone.x, layout.width),
    top: percent(zone.y, layout.height),
    width: percent(zone.w, layout.width),
    height: percent(zone.h, layout.height),
  };
  return (
    <Room $kind={zone.kind} $dropTarget={dropTarget} style={style} data-office-assembled={assembled || undefined}>
      {assembled && <OfficeDecor aria-hidden="true"/>}
      <RoomTitle $smallRoom={zone.kind === 'lobby' || zone.kind === 'off'}>
        <RoomName>{zone.name}</RoomName>
        <RoomCount>{zone.count}</RoomCount>
        {assembled && <AssemblePlay data-assemble-play aria-label={`Assemble team from ${zone.name}`} aria-haspopup="dialog" onClick={event=>onAssemble(event.currentTarget)}>✦ Assemble</AssemblePlay>}
      </RoomTitle>
      {snowy && <SnowCap />}
      {DECOR[zone.kind].map(({ art, width, left, right, top, bottom, large, sway: sways }, i) => (
        <DecorBox
          key={i}
          data-sway={sways || undefined}
          $hidden={Boolean(large && busy)}
          style={{
            width: `${width}%`,
            aspectRatio: '1',
            left: left === undefined ? undefined : `${left}%`,
            right: right === undefined ? undefined : `${right}%`,
            top: top === undefined ? undefined : `${top}%`,
            bottom: bottom === undefined ? undefined : `${bottom}%`,
          }}
        >
          {art}
        </DecorBox>
      ))}
      {zone.kind === 'street' && <StreetDecor />}
    </Room>
  );
}

interface PersonProps {
  user: TeamUser;
  seat: Seat;
  layout: MapLayout;
  scale: number;
  dimmed: boolean;
  selected: boolean;
  onSelect: SelectHandler;
  /** Outdoors in the rain or snow. */
  umbrella: boolean;
  /** Hasn't voted on a vote shown on the map. */
  waiting: boolean;
  reaction: ReactionKind | undefined;
  /** Set only for the person logged in on this browser, who may drag themselves to another room. */
  drag?: PersonDrag;
}

/** Where the pointer is while someone drags themselves, in screen pixels. */
interface PersonDrag {
  onOver: (clientX: number, clientY: number) => void;
  onDrop: (clientX: number, clientY: number) => void;
  onCancel: () => void;
}

/** Lets a person be picked up and dropped. A press that doesn't move still opens their card. */
function useDrag(drag: PersonDrag | undefined) {
  const stop = useRef<(() => void) | null>(null);
  const justDropped = useRef(false);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  // The window's listeners outlive a render, so they read the newest callbacks from here.
  const latest = useRef(drag);
  latest.current = drag;
  useEffect(() => () => stop.current?.(), []);
  if (!drag) return { offset: null, handlers: {} };

  const handlers = {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0 || stop.current) return;
      justDropped.current = false;
      const box = event.currentTarget;
      // Freeze a street sidestep as soon as it is grabbed, before the drag threshold.
      if (box.hasAttribute('data-street-person')) box.dataset.streetPressed = 'true';
      const press = createPress(event);

      // Moves are heard on the window: after a quick flick the first one is already off
      // the character, so the character itself would never hear it.
      const move = (e: PointerEvent) => {
        const wasDragging = press.dragged();
        const moved = press.move(e);
        if (!moved) return;
        // Capturing sends the click that ends a drag to the character, which drops it below.
        if (!wasDragging && box.isConnected) box.setPointerCapture(e.pointerId);
        setOffset(moved);
        latest.current?.onOver(e.clientX, e.clientY);
      };
      const end = (e: PointerEvent) => {
        if (e.pointerId !== press.pointerId) return;
        stop.current?.();
        if (!press.dragged()) return;
        justDropped.current = true;
        setOffset(null);
        if (e.type === 'pointerup') latest.current?.onDrop(e.clientX, e.clientY);
        else latest.current?.onCancel();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      stop.current = () => {
        delete box.dataset.streetPressed;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        stop.current = null;
      };
    },
    // A drag isn't a click, so it doesn't open the card.
    onClickCapture(event: { stopPropagation(): void; preventDefault(): void }) {
      if (!justDropped.current) return;
      justDropped.current = false;
      event.stopPropagation();
      event.preventDefault();
    },
  };
  return { offset, handlers };
}

function Person({ user, seat, layout, scale, dimmed, selected, onSelect, umbrella, waiting, reaction, drag }: PersonProps) {
  const zoneId = seat.zone.id;
  const previousZone = useRef(zoneId);
  const [moving, setMoving] = useState(false);
  const { offset, handlers } = useDrag(drag);

  // People hop as they glide to a new room.
  useEffect(() => {
    if (previousZone.current === zoneId) return;
    previousZone.current = zoneId;
    setMoving(true);
    const timer = setTimeout(() => setMoving(false), HOP_MS);
    return () => clearTimeout(timer);
  }, [zoneId]);

  const cellPx = seat.cell * scale;
  const street = seat.zone.kind === 'street';
  const left = street ? `calc(${percent(seat.x, layout.width)} + var(--street-x, 0px))` : percent(seat.x, layout.width);
  const top = street ? `calc(${percent(seat.y, layout.height)} + var(--street-z, 0px))` : percent(seat.y, layout.height);
  const style = {
    left: offset ? `calc(${left} + ${offset.x}px)` : left,
    top: offset ? `calc(${top} + ${offset.y}px)` : top,
    '--s': Math.max(0.5, Math.min(cellPx / 100, 1.15)).toFixed(3),
    '--d': `${-lookFor(user.username).phase * 0.37}s`,
  } as CSSProperties;

  return (
    <PersonBox
      data-street-person={street || undefined}
      data-street-x={seat.x}
      data-street-z={seat.y}
      data-street-radius={Math.min(1.5, seat.cell * 0.16)}
      data-street-held={Boolean(offset)}
      $dimmed={dimmed}
      $moving={moving}
      $strolling={seat.zone.kind === 'street'}
      $reaction={reaction}
      $draggable={Boolean(drag)}
      $dragging={Boolean(offset)}
      title={drag ? 'Drag yourself to another room to change your place' : undefined}
      style={style}
      {...handlers}
    >
      {reaction === 'cheer' && <ReactionTag aria-hidden="true">🙌</ReactionTag>}
      {reaction === 'clap' && <ReactionTag aria-hidden="true">👏</ReactionTag>}
      {reaction === 'confetti' && (
        <Confetti aria-hidden="true">
          {CONFETTI.map((c, i) => (
            <i key={i} style={{ background: c.colour, '--x': c.x, '--y': c.y } as CSSProperties} />
          ))}
        </Confetti>
      )}
      <Badge
        user={user}
        selected={selected}
        waiting={waiting}
        onSelect={onSelect}
        figure={
          <BadgeFigure $selected={selected}>
            {umbrella && (
              <UmbrellaBox>
                <Umbrella colour={UMBRELLA_COLOURS[lookFor(user.username).phase % UMBRELLA_COLOURS.length]!} />
              </UmbrellaBox>
            )}
            <Mochi user={user} />
            {seat.zone.kind === 'office' && <Desk />}
          </BadgeFigure>
        }
      />
    </PersonBox>
  );
}

/** Who is reacting to a vote right now. Each reaction ends by itself. */
function usePlaying(reactions: MapProps['reactions']): ReadonlyMap<string, ReactionKind> {
  const [playing, setPlaying] = useState<ReadonlyMap<string, ReactionKind>>(new Map());
  // Kept across new sets of reactions, so one that is still playing still ends.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (!reactions) return;
    setPlaying((current) => new Map([...current, ...reactions.list.map((r) => [r.username, r.kind] as const)]));
    for (const r of reactions.list) {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setPlaying((current) => {
          if (current.get(r.username) !== r.kind) return current;
          const next = new Map(current);
          next.delete(r.username);
          return next;
        });
      }, r.ms);
      timers.current.add(timer);
    }
  }, [reactions]);
  return playing;
}

/** The ordinary daytime look, with nothing to tint. */
function isPlain(look: Ambience): boolean {
  return look.daylight === 1 && look.warmth === 0 && look.weather.gloom === 0;
}

export default function Map2D({ state, isDimmed, selected, onSelect, onArcade, onPet, pet, onAssemble, onPicker, look, votes, voteMarks, reactions, mover, onMove }: MapProps) {
  const attendance = officeAssembly(state);
  const fillRef = useRef<HTMLDivElement>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const [dropZone, setDropZone] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const daylight = {
    '--night': 1 - look.daylight,
    '--warm': look.warmth,
    '--lamps': look.lamps,
    '--sky-top': look.sky.top,
    '--sky-bottom': look.sky.bottom,
    '--gloom': look.weather.gloom,
    '--clouds': look.weather.clouds,
    '--wind': look.weather.wind,
    '--wet': look.weather.precipitation === 'rain' || look.weather.precipitation === 'drizzle' ? look.weather.intensity : 0,
    '--snow': look.weather.precipitation === 'snow' ? 0.5 + look.weather.intensity * 0.5 : 0,
  } as CSSProperties;
  const snowy = look.weather.precipitation === 'snow';
  const wet = look.weather.precipitation !== 'none';
  const { width, height } = useElementSize(fillRef);
  const portrait = height > 0 && width / height < 0.95;
  useLayoutEffect(() => {
    const root = fillRef.current;
    if (!root) return;
    root.setAttribute('data-reflow', '');
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => root.removeAttribute('data-reflow'));
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [width, height]);
  const layout = useMemo(() => computeLayout(state.places, state.users, { portrait }), [state.places, state.users, portrait]);

  const board = noticeBoardSpot(layout);
  const catSpot = petSpot(layout, state.places);
  const activities = parkActivities(layout);
  const playing = usePlaying(reactions);
  const street = layout.zones.find((z) => z.kind === 'street');

  // Fit the whole plan inside the available space, keeping its proportions.
  const scale = Math.min(width / layout.width, height / layout.height);

  // A point on the screen, in layout units.
  function toLayout(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = planRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return null;
    return { x: ((clientX - rect.left) / rect.width) * layout.width, y: ((clientY - rect.top) / rect.height) * layout.height };
  }

  const drag: PersonDrag | undefined = mover
    ? {
        onOver(clientX, clientY) {
          const point = toLayout(clientX, clientY);
          const zone = point && zoneAt(layout, point.x, point.y);
          setDropZone(zone && zone.id !== layout.seats.get(mover)?.zone.id ? zone.id : null);
        },
        onDrop(clientX, clientY) {
          setDropZone(null);
          const point = toLayout(clientX, clientY);
          const place = point ? dropPlace(layout, mover, point.x, point.y) : undefined;
          if (place !== undefined) onMove(place);
        },
        onCancel: () => setDropZone(null),
      }
    : undefined;

  function isBusy(zone: Zone): boolean {
    if (portrait) return true;
    const seat = [...layout.seats.values()].find((s) => s.zone.id === zone.id);
    return seat ? zone.count * seat.cell ** 2 > zone.w * zone.h * 0.3 : false;
  }

  return (
    <MapFill
      data-map-root
      data-layout={portrait ? 'portrait' : 'landscape'}
      data-daylight={look.phase}
      data-plain={isPlain(look) || undefined}
      data-windy={look.weather.wind > 0.2 || undefined}
      ref={fillRef}
      style={daylight}
    >
      <Sky />
      <Stars />
      {width > 0 && height > 0 && (
        <Plan ref={planRef} style={{ width: layout.width * scale, height: layout.height * scale }}>
          {layout.park && (
            <Park
              data-park
              style={{
                left: percent(layout.park.x, layout.width),
                top: percent(layout.park.y, layout.height),
                width: percent(layout.park.w, layout.width),
                height: percent(layout.park.h, layout.height),
              }}
            >
              {snowy && <SnowCap />}

            </Park>
          )}
          {layout.zones.map((zone) => (
            <ZoneRoom key={zone.id} zone={zone} layout={layout} busy={isBusy(zone)} snowy={snowy} assembled={attendance.unlocked && zone.kind==='office' && zone.count>0} dropTarget={dropZone === zone.id} onAssemble={onAssemble} />
          ))}
          {layout.park && parkTrees(layout.park).map((tree, i) => (
            <div key={`park-tree-${i}`} data-park-tree aria-hidden="true"
              style={{position: 'absolute', width: tree.size * scale, height: tree.size * 1.3 * scale,
                left: percent(tree.x, layout.width), top: percent(tree.y, layout.height),
                transform: 'translate(-50%, -100%)', zIndex: 1, pointerEvents: 'none'}}>
              <DecorBox data-sway $hidden={false} style={{width:'100%', height:'100%', maxWidth:'none', maxHeight:'none'}}>{Tree}</DecorBox>
            </div>
          ))}
          {activities && <>
            <ArcadeCabinet2D x={percent(activities.arcade.x + activities.arcade.w / 2, layout.width)} y={percent(activities.arcade.y + activities.arcade.h, layout.height)} width={activities.arcade.w * scale} onPlay={onArcade}/>
            <PickerCabinet x={percent(activities.picker.x + activities.picker.w / 2, layout.width)} y={percent(activities.picker.y + activities.picker.h, layout.height)} width={activities.picker.w * scale} disabled={!state.users.length} onPlay={onPicker}/>
          </>}
          {pet && catSpot && (
            <OfficeCat2D pet={pet} x={percent(catSpot.x, layout.width)} y={percent(catSpot.y, layout.height)} width={catSpot.size * scale} onOpen={onPet} />
          )}
          {board && <NoticeBoard2D spot={board} width={layout.width} height={layout.height} votes={votes} />}
          {hasWeather(look) && <WeatherOverlay look={look} reduced={reduced} />}
          {street && <Traffic2D street={street} scale={scale} plan={planRef} daylight={look.daylight} reduced={reduced} />}
          {street && voteMarks?.result && <ResultBanner2D result={voteMarks.result} street={street} width={layout.width} height={layout.height} />}
          {state.users.map((user) => {
            const seat = layout.seats.get(user.username);
            if (!seat) return null;
            return (
              <Person
                key={user.username}
                user={user}
                seat={seat}
                layout={layout}
                scale={scale}
                dimmed={isDimmed(user)}
                selected={selected === user.username}
                onSelect={onSelect}
                umbrella={wet && (seat.zone.kind === 'street' || seat.zone.kind === 'off')}
                waiting={voteMarks?.waiting.has(user.username) ?? false}
                reaction={playing.get(user.username)}
                drag={user.username === mover ? drag : undefined}
              />
            );
          })}
        </Plan>
      )}
    </MapFill>
  );
}
