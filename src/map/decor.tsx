// Furniture drawn on the 2D map.
import type { ReactNode } from 'react';
import type { ZoneKind } from '../lib/layout.ts';

const INK = '#2a2657';

const line = { stroke: INK, strokeWidth: 3 };
const joined = { ...line, strokeLinejoin: 'round' as const };

const Plant = (
  <svg viewBox="0 0 40 52" width="100%" height="100%">
    <path d="M20 30C8 28 4 18 6 8c8 2 13 8 14 22Zm0 0c12-2 16-12 14-22-8 2-13 8-14 22Z" fill="#7ad67f" {...joined} />
    <path d="M9 30h22l-3 20H12Z" fill="#ff9c7a" {...joined} />
  </svg>
);

const Board = (
  <svg viewBox="0 0 90 44" width="100%" height="100%">
    <rect x="2" y="2" width="86" height="40" rx="5" fill="#fff" {...line} />
    <path d="M12 28l12-11 10 8 14-13" fill="none" stroke="#ff6f9f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M58 15h20M58 23h20M58 31h12" stroke="#8fc9ff" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const House = (
  <svg viewBox="0 0 80 72" width="100%" height="100%">
    <path d="M12 34h56v36H12Z" fill="#fff4d6" {...joined} />
    <path d="M3 38 40 4l37 34Z" fill="#ff8fb3" {...joined} />
    <rect x="33" y="46" width="15" height="24" rx="3" fill="#b7a6ff" {...line} />
    <rect x="17" y="43" width="11" height="11" rx="2" fill="#8fddf5" stroke={INK} strokeWidth="2.5" />
    <rect x="53" y="43" width="11" height="11" rx="2" fill="#8fddf5" stroke={INK} strokeWidth="2.5" />
  </svg>
);

const Tree = (
  <svg viewBox="0 0 40 52" width="100%" height="100%">
    <rect x="16" y="32" width="8" height="18" rx="2" fill="#c99467" {...line} />
    <circle cx="20" cy="20" r="17" fill="#7ad67f" {...line} />
  </svg>
);

const Parasol = (
  <svg viewBox="0 0 60 64" width="100%" height="100%">
    <path d="M30 18v44" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
    <path d="M4 30C6 12 18 4 30 4s24 8 26 26c-6-5-12-5-17 0-6-5-12-5-18 0-5-5-11-5-17 0Z" fill="#ff8fb3" {...joined} />
  </svg>
);

const Mat = (
  <svg viewBox="0 0 90 30" width="100%" height="100%">
    <rect x="2" y="2" width="86" height="26" rx="9" fill="#ffe27a" {...line} />
    <path d="M14 15h62" stroke={INK} strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" />
  </svg>
);

// Short and stout, so it fits on the pavement with its light still easy to see.
const Lamp = (
  <svg viewBox="0 0 36 52" width="100%" height="100%">
    <path d="M12 49V7h11" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 49h12" stroke={INK} strokeWidth="4" strokeLinecap="round" />
    <circle cx="25" cy="13" r="8" fill="#ffe27a" stroke={INK} strokeWidth="3" />
  </svg>
);

const Car = (
  <svg viewBox="0 0 90 50" width="100%" height="100%">
    <path d="M26 24 34 8h24l10 16Z" fill="#dfe3ff" {...joined} />
    <rect x="4" y="22" width="82" height="18" rx="7" fill="#ff8fb3" {...line} />
    <circle cx="24" cy="41" r="7" fill={INK} />
    <circle cx="66" cy="41" r="7" fill={INK} />
  </svg>
);

/** Trees for the town park, in percentages of the park. */
export const PARK_TREES = [
  { art: Tree, left: 8, bottom: 10, width: 14, sway: true },
  { art: Tree, left: 42, bottom: 22, width: 12, sway: true },
  { art: Tree, right: 10, bottom: 8, width: 15, sway: true },
];

export interface DecorItem {
  art: ReactNode;
  width: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  /** Large items are hidden once a room fills up, so they don't sit behind people. */
  large?: boolean;
  /** Sways in the wind. */
  sway?: boolean;
}

// Positions are percentages of the zone, chosen to stay clear of the title tab.
export const DECOR: Record<ZoneKind, DecorItem[]> = {
  office: [
    { art: Board, right: 3, top: 2.5, width: 15, large: true },
    { art: Plant, left: 1.5, bottom: 3, width: 7 },
    { art: Plant, right: 1.5, bottom: 3, width: 7 },
  ],
  wfh: [
    { art: House, right: 3, top: 5, width: 25, large: true },
    { art: Tree, left: 3, bottom: 5, width: 11, sway: true },
  ],
  off: [{ art: Parasol, left: 6, top: 22, width: 17 }],
  lobby: [{ art: Mat, right: 3, bottom: 12, width: 13, large: true }],
  // The street lines its things up with its pavement and road instead: see STREET_ART.
  street: [],
};

/** Held by people outdoors in the rain or snow. Drawn behind them, so the canopy peeks over their head. */
export function Umbrella({ colour }: { colour: string }) {
  return (
    <svg viewBox="0 0 64 60" width="100%" height="100%">
      <path d="M33 22v28c0 5-7 5-7 0" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <path d="M4 24C6 10 18 3 32 3s26 7 28 21c-5-4-10-4-14 0-4-4-10-4-14 0-4-4-10-4-14 0-4-4-9-4-14 0Z" fill={colour} {...joined} />
      <path d="M32 3v3" stroke={INK} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** The street's own art. Map2D stands the lamps on the curb and drives the car in the road. */
export const STREET_ART = { lamp: Lamp, car: Car };
