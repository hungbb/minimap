// The 2D floor plan, built from plain HTML and SVG.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import styled, { css, keyframes, type RuleSet } from 'styled-components';
import type { TeamUser } from '../../shared/types.ts';
import { Badge, BadgeFigure, type SelectHandler } from '../components/Badge.tsx';
import { Desk, Mochi, MochiSvg } from '../components/Mochi.tsx';
import { useAmbience, useElementSize, useReducedMotion } from '../lib/hooks.ts';
import { computeLayout, type MapLayout, type Seat, type Zone, type ZoneKind } from '../lib/layout.ts';
import type { Ambience } from '../lib/ambience.ts';
import { lookFor } from '../lib/look.ts';
import { media, theme } from '../styles/theme.ts';
import { DECOR, PARK_TREES, STREET_ART } from './decor.tsx';
import type { MapProps } from './types.ts';
import { hasWeather, Weather2D } from './Weather2D.tsx';

const HOP_MS = 900;

const MapFill = styled.div`
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

const Room = styled.section<{ $kind: ZoneKind }>`
  position: absolute;
  border: ${theme.line};
  border-radius: 20px;
  box-shadow: 0 5px 0 ${theme.ink};
  /* Rooms grow and shrink with their people, at the same pace people walk. */
  transition: left ${GLIDE}, top ${GLIDE}, width ${GLIDE}, height ${GLIDE};

  ${media.reducedMotion} { transition: none; }

  ${({ $kind }) => ZONE_LOOKS[$kind]}
  ${({ $kind }) => ($kind === 'office' || $kind === 'lobby') && INDOORS}
  ${shade}
`;

const Park = styled.div`
  position: absolute;
  border-radius: 20px;
  background: radial-gradient(#a4e8c0 2px, transparent 3px) 0 0 / 22px 22px, ${theme.mint};
  transition: left ${GLIDE}, top ${GLIDE}, width ${GLIDE}, height ${GLIDE};

  ${media.reducedMotion} { transition: none; }

  ${shade}
`;

const RoomTitle = styled.h2`
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
  white-space: nowrap;

  ${media.phone} {
    left: 8px;
    gap: 4px;
    max-width: calc(100% - 12px);
    padding: 0 7px 1px;
    font-size: 12.5px;
  }
`;

const RoomName = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RoomCount = styled.span`
  flex: none;
  font-weight: 500;
`;

const DecorBox = styled.div<{ $hidden: boolean }>`
  position: absolute;
  /* Rooms change shape with their people, so furniture can't outgrow a wide, short room. */
  max-width: 90px;
  max-height: 62%;
  pointer-events: none;

  ${({ $hidden }) => $hidden && 'display: none;'}
`;

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
      <StreetPiece style={{ right: '2%', bottom: '8%', height: `min(${(100 - PAVEMENT) * 0.5}%, 42px)`, aspectRatio: '90 / 50' }}>
        {STREET_ART.car}
      </StreetPiece>
    </>
  );
}

const bob = keyframes`
  0%, 100% { transform: scale(1, 1); }
  50% { transform: scale(1.03, .96); }
`;

const stroll = keyframes`
  0%, 100% { translate: -12px 0; }
  50% { translate: 12px 0; }
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
const PersonBox = styled.div<{ $dimmed: boolean; $moving: boolean; $strolling: boolean }>`
  position: absolute;
  z-index: 3;
  transform: translate(-50%, -50%) scale(var(--s, 1));
  transition: left ${GLIDE}, top ${GLIDE}, opacity .25s, transform .3s;

  &:hover, &:focus-within { z-index: 10; }

  ${({ $dimmed }) => $dimmed && 'opacity: .22;'}

  ${({ $strolling }) => $strolling && css`
    animation: ${stroll} 7s ease-in-out infinite;
    animation-delay: var(--d, 0s);

    &:hover, &:focus-within { animation-play-state: paused; }
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
  }

  ${media.reducedMotion} {
    animation: none;
    transition: opacity .25s;

    ${MochiSvg} { animation: none; }
  }
`;

function percent(part: number, whole: number): string {
  return `${(part / whole) * 100}%`;
}

function ZoneRoom({ zone, layout, busy }: { zone: Zone; layout: MapLayout; busy: boolean }) {
  const style: CSSProperties = {
    left: percent(zone.x, layout.width),
    top: percent(zone.y, layout.height),
    width: percent(zone.w, layout.width),
    height: percent(zone.h, layout.height),
  };
  return (
    <Room $kind={zone.kind} style={style}>
      <RoomTitle>
        <RoomName>{zone.name}</RoomName>
        <RoomCount>{zone.count}</RoomCount>
      </RoomTitle>
      {DECOR[zone.kind].map(({ art, width, left, right, top, bottom, large }, i) => (
        <DecorBox
          key={i}
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
}

function Person({ user, seat, layout, scale, dimmed, selected, onSelect }: PersonProps) {
  const zoneId = seat.zone.id;
  const previousZone = useRef(zoneId);
  const [moving, setMoving] = useState(false);

  // People hop as they glide to a new room.
  useEffect(() => {
    if (previousZone.current === zoneId) return;
    previousZone.current = zoneId;
    setMoving(true);
    const timer = setTimeout(() => setMoving(false), HOP_MS);
    return () => clearTimeout(timer);
  }, [zoneId]);

  const cellPx = seat.cell * scale;
  const style = {
    left: percent(seat.x, layout.width),
    top: percent(seat.y, layout.height),
    '--s': Math.max(0.5, Math.min(cellPx / 100, 1.15)).toFixed(3),
    '--d': `${-lookFor(user.username).phase * 0.37}s`,
  } as CSSProperties;

  return (
    <PersonBox $dimmed={dimmed} $moving={moving} $strolling={seat.zone.kind === 'street'} style={style}>
      <Badge
        user={user}
        selected={selected}
        onSelect={onSelect}
        figure={
          <BadgeFigure $selected={selected}>
            <Mochi user={user} />
            {seat.zone.kind === 'office' && <Desk />}
          </BadgeFigure>
        }
      />
    </PersonBox>
  );
}

/** The ordinary daytime look, with nothing to tint. */
function isPlain(look: Ambience): boolean {
  return look.daylight === 1 && look.warmth === 0 && look.weather.gloom === 0;
}

export default function Map2D({ state, isDimmed, selected, onSelect }: MapProps) {
  const fillRef = useRef<HTMLDivElement>(null);
  const look = useAmbience(state.weather);
  const reduced = useReducedMotion();
  const daylight = {
    '--night': 1 - look.daylight,
    '--warm': look.warmth,
    '--lamps': look.lamps,
    '--sky-top': look.sky.top,
    '--sky-bottom': look.sky.bottom,
    '--gloom': look.weather.gloom,
    '--clouds': look.weather.clouds,
  } as CSSProperties;
  const { width, height } = useElementSize(fillRef);
  const portrait = height > 0 && width / height < 0.95;
  const layout = useMemo(() => computeLayout(state.places, state.users, { portrait }), [state.places, state.users, portrait]);

  // Fit the whole plan inside the available space, keeping its proportions.
  const scale = Math.min(width / layout.width, height / layout.height);

  function isBusy(zone: Zone): boolean {
    if (portrait) return true;
    const seat = [...layout.seats.values()].find((s) => s.zone.id === zone.id);
    return seat ? zone.count * seat.cell ** 2 > zone.w * zone.h * 0.3 : false;
  }

  return (
    <MapFill data-map-root data-daylight={look.phase} data-plain={isPlain(look) || undefined} ref={fillRef} style={daylight}>
      <Sky />
      <Stars />
      {width > 0 && height > 0 && (
        <Plan style={{ width: layout.width * scale, height: layout.height * scale }}>
          {layout.park && (
            <Park
              aria-hidden="true"
              style={{
                left: percent(layout.park.x, layout.width),
                top: percent(layout.park.y, layout.height),
                width: percent(layout.park.w, layout.width),
                height: percent(layout.park.h, layout.height),
              }}
            >
              {PARK_TREES.map(({ art, width: treeWidth, left, right, bottom }, i) => (
                <DecorBox
                  key={i}
                  $hidden={false}
                  style={{
                    width: `${treeWidth}%`,
                    aspectRatio: '1',
                    left: left === undefined ? undefined : `${left}%`,
                    right: right === undefined ? undefined : `${right}%`,
                    bottom: `${bottom}%`,
                  }}
                >
                  {art}
                </DecorBox>
              ))}
            </Park>
          )}
          {layout.zones.map((zone) => (
            <ZoneRoom key={zone.id} zone={zone} layout={layout} busy={isBusy(zone)} />
          ))}
          {hasWeather(look) && <Weather2D look={look} reduced={reduced} />}
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
              />
            );
          })}
        </Plan>
      )}
    </MapFill>
  );
}
