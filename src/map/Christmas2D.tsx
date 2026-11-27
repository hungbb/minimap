// The 2D map's Christmas look (lib/season.ts): the big tree in the park, the office's little
// tree, snowy pines, a snowman, wreaths, holly on the room names, pine garlands with red bows
// and fairy lights, and Santa beside his tree and his sleigh flying over the town.
import type { ReactNode } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { bulbSpots, LIGHT_COLOURS, SLEIGH_LOOP_SECONDS, SLEIGH_TRIP_SECONDS, TWINKLE_SECONDS } from '../lib/season.ts';
import { media } from '../styles/theme.ts';

const INK = '#2a2657';
const GREEN = '#2fa84f';
const DARK_GREEN = '#1f7a3d';
const RED = '#e5283b';
const GOLD = '#ffd23f';
const SKIN = '#ffd9c2';

const line = { stroke: INK, strokeWidth: 2.5, strokeLinejoin: 'round' as const };

const blink = keyframes`
  from { opacity: 1; }
  to { opacity: .35; }
`;

/**
 * Makes every fairy light on the map twinkle. The map root includes it, so lights inside
 * plain furniture art (decor.tsx) twinkle too. Lights glow brighter after dark.
 */
export const twinkleStyles = css`
  .xmas-bulb {
    animation: ${blink} ${TWINKLE_SECONDS / 2}s ease-in-out infinite alternate;
    filter: drop-shadow(0 0 calc(1px + var(--night, 0) * 3px) currentColor);
  }

  ${media.reducedMotion} { .xmas-bulb { animation: none; } }
`;

/** A fairy light. Lights next to each other differ in colour and twinkle at different times. */
function Bulb({ cx, cy, r = 2.2, index }: { cx: number; cy: number; r?: number; index: number }) {
  const colour = LIGHT_COLOURS[index % LIGHT_COLOURS.length];
  const delay = -((index % LIGHT_COLOURS.length) * TWINKLE_SECONDS) / LIGHT_COLOURS.length;
  return <circle className="xmas-bulb" cx={cx} cy={cy} r={r} fill={colour} style={{ color: colour, animationDelay: `${delay}s` }} />;
}

function Star({ x, y, size }: { x: number; y: number; size: number }) {
  const points = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 ? size * 0.42 : size;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    return `${(x + Math.cos(angle) * radius).toFixed(2)},${(y + Math.sin(angle) * radius).toFixed(2)}`;
  });
  return <polygon className="xmas-star" points={points.join(' ')} fill={GOLD} {...line} strokeWidth={2} />;
}

// Where the lights hang on the tree's three tiers, as [x, y].
const TREE_LIGHTS: [number, number][] = [
  [24, 30], [36, 33],
  [17, 50], [29, 47], [42, 51],
  [10, 72], [22, 69], [35, 72], [48, 69],
];

/** A decorated Christmas tree with a star on top and, when asked, presents underneath. */
export function ChristmasTreeArt({ presents = true }: { presents?: boolean }) {
  return (
    <svg viewBox="0 0 60 96" width="100%" height="100%" overflow="visible">
      <rect x="25" y="76" width="10" height="12" rx="2" fill="#a8744f" {...line} />
      <path d="M30 40 3 80h54Z" fill={DARK_GREEN} {...line} />
      <path d="M30 22 9 58h42Z" fill={GREEN} {...line} />
      <path d="M30 8 15 38h30Z" fill="#4fc46a" {...line} />
      {/* Tinsel looping round each tier. */}
      <path d="M17 33q13 6 26-2M11 54q19 7 38-3M6 76q24 8 48-4" fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
      {TREE_LIGHTS.map(([cx, cy], i) => <Bulb key={i} cx={cx} cy={cy} index={i} />)}
      <Star x={30} y={8} size={8} />
      {presents && (
        <>
          <rect x="1" y="80" width="17" height="14" rx="2" fill={RED} {...line} />
          <path d="M9.5 80v14M1 87h17" stroke={GOLD} strokeWidth="2.5" />
          <rect x="41" y="83" width="18" height="11" rx="2" fill={GREEN} {...line} />
          <path d="M50 83v11" stroke="#fff" strokeWidth="2.5" />
          <path d="M50 83c-4-5-8-3-5 0m5 0c4-5 8-3 5 0" fill="none" stroke="#fff" strokeWidth="2" />
          <rect x="18" y="86" width="10" height="8" rx="1.5" fill={GOLD} {...line} strokeWidth={2} />
          <path d="M23 86v8" stroke={RED} strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

/** A snowy pine for the park, in place of its round trees. */
export const Pine = (
  <svg viewBox="0 0 40 52" width="100%" height="100%">
    <rect x="16" y="38" width="8" height="12" rx="2" fill="#c99467" {...line} strokeWidth={3} />
    <path d="M20 16 4 42h32Z" fill={DARK_GREEN} {...line} strokeWidth={3} />
    <path d="M20 4 8 26h24Z" fill={GREEN} {...line} strokeWidth={3} />
    <path d="M14 15l6-11 6 11-3-1.5-3 2-3-2Z" fill="#fff" />
    <path d="M10 32l4-6 3 2 3-2 3 2 3-2 4 6-3-1-4 2-3-2-3 2-4-2Z" fill="#fff" />
  </svg>
);

/** A snowman on the beach, with a carrot nose and a scarf. */
export const Snowman = (
  <svg viewBox="0 0 40 52" width="100%" height="100%">
    <circle cx="20" cy="38" r="12" fill="#fff" {...line} />
    <circle cx="20" cy="18" r="9" fill="#fff" {...line} />
    <path d="M12 6h16M15 6V0h10v6" fill="#3a3466" {...line} strokeWidth={2} />
    <path d="M11 25q9 4 18 0l-1 5-3-1-1 6-3-1 1-5q-6 0-11-4Z" fill={RED} {...line} strokeWidth={2} />
    <circle cx="17" cy="16" r="1.4" fill={INK} />
    <circle cx="23" cy="16" r="1.4" fill={INK} />
    <path d="M20 19l7 2-7 1Z" fill="#ff9c3a" stroke="#d9762a" strokeWidth="1" strokeLinejoin="round" />
    <circle cx="20" cy="35" r="1.4" fill={INK} />
    <circle cx="20" cy="41" r="1.4" fill={INK} />
  </svg>
);

/** A wreath with a bow, and lights along the roof, drawn over the house (viewBox 0 0 80 72). */
export const HouseTrimmings: ReactNode = (
  <>
    {[[10, 38], [19, 30], [28, 22], [37, 14], [46, 17], [55, 25], [64, 33], [72, 40]].map(([cx, cy], i) => (
      <Bulb key={i} cx={cx!} cy={cy!} r={2} index={i} />
    ))}
    <circle cx="40.5" cy="52" r="6" fill="none" stroke={DARK_GREEN} strokeWidth="4.5" />
    <circle cx="40.5" cy="52" r="6" fill="none" stroke={INK} strokeWidth="1" strokeDasharray="2 3" />
    <path d="M37 59l3.5-3 3.5 3-3.5 2Z" fill={RED} stroke={INK} strokeWidth="1" />
  </>
);

// ---- Fairy lights along a room ---------------------------------------------

const LightString = styled.div`
  position: absolute;
  top: 2px;
  left: 4%;
  right: 4%;
  height: 18px;
  pointer-events: none;

  svg { position: absolute; inset: 0; overflow: visible; }
`;

/** A red bow, its knot at `x`, `y`. */
function Bow({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      <path d="M0 1-3 7M0 1l3 6" stroke={RED} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M0 0C-3-4-7-3-6 1-5 4-2 2 0 0Zm0 0c3-4 7-3 6 1-1 3-4 1-6-1Z" fill={RED} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
      <circle r="1.6" fill={RED} stroke={INK} strokeWidth="1" />
    </g>
  );
}

/**
 * A pine garland hung along the top of a room `units` wide (layout units), sagging between red
 * bows, with twinkling lights on it.
 */
export function FairyLights({ units, scale }: { units: number; scale: number }) {
  const spots = bulbSpots(units, 3.2);
  const width = units * 0.92 * scale;
  // A bow every two lights; the garland dips between them.
  const swags = Math.max(1, Math.round(spots.length / 2));
  const swag = width / swags;
  const dip = 6;
  const sagAt = (x: number) => {
    const t = (x % swag) / swag;
    return 2 + 4 * dip * t * (1 - t);
  };
  const path = Array.from({ length: swags }, (_, i) => `M${i * swag} 2Q${(i + 0.5) * swag} ${2 + 2 * dip} ${(i + 1) * swag} 2`).join('');
  return (
    <LightString aria-hidden="true">
      <svg width="100%" height="100%">
        <path d={path} fill="none" stroke={DARK_GREEN} strokeWidth="5.5" strokeLinecap="round" />
        <path d={path} fill="none" stroke={GREEN} strokeWidth="5.5" strokeDasharray="1.5 3" />
        {spots.map((share, i) => (
          <Bulb key={i} cx={share * width} cy={sagAt(share * width) + 4} r={3.2} index={i} />
        ))}
        {Array.from({ length: swags + 1 }, (_, i) => <Bow key={i} x={i * swag} y={2} />)}
      </svg>
    </LightString>
  );
}

/** A sprig of holly with red berries, for a corner of a room's name. Its parent is positioned. */
export function Holly() {
  return (
    <svg aria-hidden="true" viewBox="0 0 30 20" width="28" height="19" style={{ position: 'absolute', right: -19, top: -10, overflow: 'visible', pointerEvents: 'none' }}>
      <path d="M14 12C10 4 4 6 1 3c1 4-1 6 2 8-2 1-2 3 0 4 3-1 6 0 11-3Z" fill={GREEN} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M16 12c4-8 10-6 13-9-1 4 1 6-2 8 2 1 2 3 0 4-3-1-6 0-11-3Z" fill={DARK_GREEN} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12.5" cy="13.5" r="3.2" fill={RED} stroke={INK} strokeWidth="1.4" />
      <circle cx="18" cy="14" r="3.2" fill={RED} stroke={INK} strokeWidth="1.4" />
      <circle cx="15.2" cy="9.5" r="3.2" fill={RED} stroke={INK} strokeWidth="1.4" />
    </svg>
  );
}

/** A wreath with a red bow on a street lamp's post, drawn over the lamp (viewBox 0 0 36 52). */
export const LampTrimmings = (
  <svg viewBox="0 0 36 52" width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
    {/* Red and white stripes up the post, like a candy cane. */}
    <path d="M12 46v-3m0-6v-3m0-6v-3" stroke={RED} strokeWidth="4" />
    <circle cx="12" cy="20" r="5.5" fill="none" stroke={DARK_GREEN} strokeWidth="4" />
    <circle cx="12" cy="20" r="5.5" fill="none" stroke={GREEN} strokeWidth="1.6" strokeDasharray="1.5 2.5" />
    <Bow x={12} y={25} size={0.8} />
  </svg>
);

// ---- Santa -------------------------------------------------------------------

/** Santa, waving, with his sack of presents. */
export const SantaArt = (
  <svg viewBox="0 0 64 72" width="100%" height="100%" overflow="visible">
    <path d="M44 40c-6 4-8 14-6 24 1 5 18 5 20 0 2-10 0-20-6-24Z" fill="#b5835a" {...line} />
    <path d="M45 40q4 3 7 0" fill="none" stroke={INK} strokeWidth="2" />
    <rect x="17" y="62" width="12" height="8" rx="3" fill={INK} />
    <rect x="33" y="62" width="12" height="8" rx="3" fill={INK} />
    <path d="M16 41 9 55" stroke={RED} strokeWidth="7" strokeLinecap="round" />
    <circle cx="9" cy="56" r="3.6" fill={INK} />
    <path d="M12 64c0-20 6-34 20-34s20 14 20 34Z" fill={RED} {...line} />
    <rect x="29" y="34" width="6" height="26" fill="#fff" />
    <rect x="12" y="47" width="40" height="6" fill={INK} />
    <rect x="28" y="46" width="8" height="8" rx="1.5" fill="none" stroke={GOLD} strokeWidth="2" />
    <rect x="11" y="58" width="42" height="7" rx="3.5" fill="#fff" {...line} strokeWidth={2} />
    <path className="santa-wave" d="M48 40 57 27" stroke={RED} strokeWidth="7" strokeLinecap="round" />
    <circle className="santa-wave" cx="58" cy="25" r="3.6" fill={INK} />
    <circle cx="32" cy="24" r="9" fill={SKIN} {...line} strokeWidth={2} />
    <path d="M21 25c0 12 5 19 11 19s11-7 11-19c-3 3-7 4-11 4s-8-1-11-4Z" fill="#fff" {...line} strokeWidth={2} />
    <path d="M26 29q3-3 6 0 3-3 6 0" fill="#fff" stroke={INK} strokeWidth="1.5" />
    <circle cx="28.5" cy="22" r="1.3" fill={INK} />
    <circle cx="35.5" cy="22" r="1.3" fill={INK} />
    <circle cx="32" cy="26" r="1.8" fill="#ff8f8f" />
    <path d="M22 17Q27 2 42 6l7 13Z" fill={RED} {...line} strokeWidth={2} />
    <rect x="21" y="14" width="22" height="6" rx="3" fill="#fff" {...line} strokeWidth={2} />
    <circle cx="49" cy="19" r="3.6" fill="#fff" {...line} strokeWidth={2} />
  </svg>
);

const wave = keyframes`
  from { rotate: 0deg; }
  to { rotate: -14deg; }
`;

// In front of the notice board's legs beside him.
const SantaBox = styled.div`
  position: absolute;
  z-index: 2;
  transform: translate(-50%, -100%);
  pointer-events: none;

  .santa-wave {
    transform-box: view-box;
    transform-origin: 48px 40px;
    animation: ${wave} .7s ease-in-out infinite alternate;
  }

  ${media.reducedMotion} { .santa-wave { animation: none; } }
`;

/** Santa standing in the park, his feet at `x`, `y` (CSS lengths), `width` pixels wide. */
export function Santa2D({ x, y, width }: { x: string; y: string; width: number }) {
  return (
    <SantaBox data-santa aria-hidden="true" style={{ left: x, top: y, width, height: width * (72 / 64) }}>
      {SantaArt}
    </SantaBox>
  );
}

function Reindeer({ x, nose }: { x: number; nose?: boolean }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <path d="M4 40 1 52M10 40l-2 12M22 40l3 12M28 40l4 11" stroke="#7a4f32" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="16" cy="36" rx="14" ry="7" fill="#a8744f" {...line} strokeWidth={2} />
      <path d="M27 32l5-10" stroke="#a8744f" strokeWidth="6" strokeLinecap="round" />
      <circle cx="35" cy="20" r="5.5" fill="#a8744f" {...line} strokeWidth={2} />
      <path d="M33 15l-3-8m0 0-4-1m4 1 1-5M37 15l3-7m0 0 4-2m-4 2-1-4" fill="none" stroke="#7a4f32" strokeWidth="2" strokeLinecap="round" />
      <circle cx="36" cy="19" r="1.2" fill={INK} />
      <circle cx="41" cy="22" r="2.2" fill={nose ? RED : '#4a3326'} />
    </g>
  );
}

/**
 * Santa's sleigh, pulled by two reindeer, the first with a red nose. Faces right. Fairy lights
 * run along its rim, and a lantern glows at the front.
 */
export const SleighArt = (
  <svg viewBox="0 0 170 60" width="100%" height="100%" overflow="visible">
    <path d="M50 38q22 6 44-6" fill="none" stroke={GOLD} strokeWidth="1.5" />
    <Reindeer x={86} />
    <Reindeer x={126} nose />
    <path d="M94 34q16 2 34-4" fill="none" stroke={GOLD} strokeWidth="1.5" />
    {/* Santa in the sleigh, with the sack behind him. */}
    <circle cx="18" cy="22" r="9" fill="#b5835a" {...line} strokeWidth={2} />
    <path d="M26 30c0-9 4-14 11-14s11 5 11 14Z" fill={RED} {...line} strokeWidth={2} />
    <circle cx="37" cy="13" r="6" fill={SKIN} {...line} strokeWidth={2} />
    <path d="M31 14c0 7 3 11 6 11s6-4 6-11c-2 2-4 2-6 2s-4 0-6-2Z" fill="#fff" stroke={INK} strokeWidth="1.5" />
    <path d="M31 10Q34 0 43 3l3 8Z" fill={RED} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
    <rect x="30.5" y="8" width="13" height="4" rx="2" fill="#fff" stroke={INK} strokeWidth="1.2" />
    <circle cx="46" cy="11" r="2.4" fill="#fff" stroke={INK} strokeWidth="1.2" />
    <path d="M6 26h50q4 0 4 4c0 8-6 14-16 14H16C8 44 4 36 6 26Z" fill={RED} {...line} />
    <path d="M9 32h47" stroke={GOLD} strokeWidth="2" />
    {[10, 17, 24, 31, 38, 45, 52].map((cx, i) => <Bulb key={i} cx={cx} cy={27} r={2.3} index={i} />)}
    <path d="M2 50h52q8 0 10-8" fill="none" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
    <path d="M16 44v6M44 44v6" stroke={GOLD} strokeWidth="2.5" />
    {/* The lantern on its pole at the front. */}
    <path d="M58 27V17" stroke={GOLD} strokeWidth="1.8" />
    <circle cx="58" cy="15" r="7" fill="rgb(255 226 122 / .45)" />
    <rect x="55" y="11" width="6" height="7" rx="1.5" fill="#fff3b0" stroke={INK} strokeWidth="1.3" />
  </svg>
);

const trip = SLEIGH_TRIP_SECONDS / SLEIGH_LOOP_SECONDS;

// Across the sky from left to right, then out of sight until the next trip.
const fly = keyframes`
  0% { left: -22%; visibility: visible; }
  ${(trip * 100).toFixed(2)}% { left: 104%; visibility: visible; }
  ${(trip * 100 + 0.01).toFixed(2)}%, 100% { left: 104%; visibility: hidden; }
`;

const bobble = keyframes`
  from { transform: translateY(-6%) rotate(-3deg); }
  to { transform: translateY(6%) rotate(2deg); }
`;

const Sky = styled.div`
  position: absolute;
  inset: 0;
  z-index: 25;
  overflow: hidden;
  border-radius: 20px;
  pointer-events: none;
`;

const Sleigh = styled.div`
  position: absolute;
  top: 1%;
  aspect-ratio: 170 / 60;
  animation: ${fly} ${SLEIGH_LOOP_SECONDS}s linear infinite;

  > div { width: 100%; height: 100%; animation: ${bobble} 1.1s ease-in-out infinite alternate; }
  > div > svg { filter: drop-shadow(0 3px 0 rgb(42 38 87 / .2)) drop-shadow(0 0 6px rgb(255 226 122 / .7)); }

  ${media.reducedMotion} {
    animation: none;
    left: 72%;
    > div, .trail-spark { animation: none; }
  }
`;

const sparkle = keyframes`
  0%, 100% { opacity: .15; transform: scale(.5); }
  50% { opacity: 1; transform: scale(1.15); }
`;

// The magic trail streams out behind the sleigh, fading as it goes, with sparkles in it.
const Trail = styled.svg`
  position: absolute;
  right: 66%;
  top: 30%;
  width: 150%;
  height: 70%;
  overflow: visible;

  .trail-spark {
    transform-box: fill-box;
    transform-origin: center;
    animation: ${sparkle} .9s ease-in-out infinite;
  }
`;

// Where the sparkles sit along the trail ([x, y, size] in a 100 by 40 box), the newest on the right.
const SPARKS: [number, number, number][] = [
  [94, 18, 4], [86, 26, 3], [80, 12, 3.5], [72, 22, 2.5], [65, 30, 3], [58, 15, 2.5],
  [50, 25, 2], [43, 33, 2.5], [36, 20, 2], [28, 30, 1.8], [20, 24, 1.6], [12, 34, 1.4], [5, 28, 1.2],
];

/** A four-pointed sparkle centred on `x`, `y`. */
const sparkPath = (x: number, y: number, r: number) =>
  `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;

function MagicTrail() {
  return (
    <Trail viewBox="0 0 100 40" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sleigh-trail" x1="1" x2="0">
          <stop offset="0" stopColor="#fff6c8" stopOpacity=".95" />
          <stop offset=".35" stopColor="#ffd23f" stopOpacity=".55" />
          <stop offset="1" stopColor="#ffd23f" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* A ribbon of light that widens and droops behind the sleigh. */}
      <path d="M100 17C70 15 40 22 0 34 40 28 70 24 100 23Z" fill="url(#sleigh-trail)" style={{ filter: 'blur(1.2px)' }} />
      {SPARKS.map(([x, y, r], i) => (
        <path
          key={i}
          className="trail-spark"
          d={sparkPath(x, y, r)}
          fill={i % 3 === 1 ? '#fff' : GOLD}
          style={{ animationDelay: `${-(i * 0.23) % 0.9}s` }}
        />
      ))}
    </Trail>
  );
}

/** Santa's sleigh flying over the town, `width` pixels wide. */
export function Sleigh2D({ width }: { width: number }) {
  return (
    <Sky aria-hidden="true">
      <Sleigh data-sleigh style={{ width }}>
        <MagicTrail />
        <div>{SleighArt}</div>
      </Sleigh>
    </Sky>
  );
}
