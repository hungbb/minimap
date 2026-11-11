// The office cat on the 2D map: it sits on the main office floor, curls up asleep when nobody
// is in, shows its mood on its face, and hops when someone feeds it. Clicking it opens its card.
import type { CSSProperties } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { moodText, type PetMood } from '../../shared/pet.ts';
import { CAT, STAGE_SCALE, type PetShown } from '../lib/petLook.ts';

const INK = '#2a2657';

const sway = keyframes`
  from { transform: rotate(-8deg); }
  to { transform: rotate(10deg); }
`;
const breathe = keyframes`
  from { transform: scaleY(1); }
  to { transform: scaleY(1.04); }
`;
const hop = keyframes`
  0%, 100% { transform: translateY(0); }
  30% { transform: translateY(-28%); }
  55% { transform: translateY(0); }
  70% { transform: translateY(-10%); }
`;
const drift = keyframes`
  from { opacity: 0; transform: translate(0, 0); }
  30% { opacity: 1; }
  to { opacity: 0; transform: translate(6px, -10px); }
`;

const Spot = styled.button<{ $mood: PetMood }>`
  position: absolute;
  z-index: 3;
  padding: 0;
  border: 0;
  background: transparent;
  transform: translate(-50%, -100%);
  cursor: pointer;

  /* Big enough to tap, even for a kitten. */
  &::before {
    content: '';
    position: absolute;
    inset: 50% auto auto 50%;
    width: max(100%, 44px);
    height: max(100%, 44px);
    transform: translate(-50%, -50%);
  }
  &:focus-visible {
    outline: 3px solid ${INK};
    outline-offset: 3px;
    border-radius: 8px;
  }
  svg { display: block; width: 100%; overflow: visible; }

  [data-cat-tail] {
    transform-box: fill-box;
    transform-origin: 0% 100%;
    animation: ${sway} ${({ $mood }) => ($mood === 'joyful' ? 0.35 : $mood === 'happy' ? 0.7 : 1.6)}s ease-in-out infinite alternate;
  }
  [data-cat-body] {
    transform-box: fill-box;
    transform-origin: 50% 100%;
    animation: ${breathe} 1.8s ease-in-out infinite alternate;
  }
  [data-cat-z] { animation: ${drift} 2.4s ease-out infinite; }
  [data-cat-z]:nth-of-type(2) { animation-delay: 1.2s; }
  &[data-cheer] [data-cat-hop] { animation: ${hop} 0.8s ease-out; }
  [data-cat-hop] { transform-box: fill-box; }

  ${({ $mood }) =>
    $mood === 'sleeping' &&
    css`
      [data-cat-tail] { animation: none; }
    `}

  @media (prefers-reduced-motion: reduce) {
    *, &[data-cheer] [data-cat-hop] { animation: none !important; }
  }
`;

const Name = styled.span`
  position: absolute;
  left: 50%;
  top: 100%;
  padding: 0 5px;
  border: 1.5px solid ${INK};
  border-radius: 6px;
  background: #fff8ec;
  color: ${INK};
  font: 800 9px/1.3 sans-serif;
  white-space: nowrap;
  transform: translate(-50%, 2px);
  pointer-events: none;
`;

function Face({ mood }: { mood: PetMood }) {
  const eyes =
    mood === 'happy' || mood === 'joyful' ? (
      <path d="M24 19q2-2.5 4 0M32 19q2-2.5 4 0" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
    ) : mood === 'sad' ? (
      <>
        <path d="M23.5 17.5l4 1.2M36.5 17.5l-4 1.2" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="26" cy="20" r="1.4" fill={INK} />
        <circle cx="34" cy="20" r="1.4" fill={INK} />
        <path d="M35.5 22.5q-1 2 0 3 1-1 0-3Z" fill="#6fb5f0" />
      </>
    ) : (
      <>
        <circle cx="26" cy="19.5" r="1.6" fill={INK} />
        <circle cx="34" cy="19.5" r="1.6" fill={INK} />
      </>
    );
  return (
    <>
      {eyes}
      <path d="M29 22.5h2l-1 1.2Z" fill={CAT.nose} />
      <path d={mood === 'sad' ? 'M27.5 26q2.5-2 5 0' : 'M27.5 24.5q1.25 1.5 2.5 0 1.25 1.5 2.5 0'} fill="none" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />
      <path d="M21 22.5h-4M21 24.5l-3.5 1M39 22.5h4M39 24.5l3.5 1" stroke={INK} strokeWidth=".8" strokeLinecap="round" />
    </>
  );
}

function SittingCat({ mood }: { mood: PetMood }) {
  // Sad cats hold their ears flat.
  const ears = mood === 'sad' ? 'M20 15 15 9l9 2ZM40 15l5-6-9 2Z' : 'M20 14 19 4l8 6ZM40 14l1-10-8 6Z';
  return (
    <g data-cat-hop>
      <path data-cat-tail d="M41 44c9 0 12-6 10-13" fill="none" stroke={CAT.fur} strokeWidth="5" strokeLinecap="round" />
      <g data-cat-body>
        <path d="M18 46c-3-8 1-20 12-20s15 12 12 20Z" fill={CAT.fur} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M24 46c-1-6 1-12 6-12s7 6 6 12Z" fill={CAT.belly} />
        <path d="M23 46v-3M37 46v-3" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      </g>
      <path d={ears} fill={CAT.fur} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <ellipse cx="30" cy="20" rx="11" ry="9.5" fill={CAT.fur} stroke={INK} strokeWidth="2.2" />
      <path d="M27 11.5l1 3M30 11v3M33 11.5l-1 3" stroke={CAT.stripe} strokeWidth="1.4" strokeLinecap="round" />
      <Face mood={mood} />
      {mood === 'joyful' && <path d="M45 8c-2-3-6 0-2 3l2 1.6 2-1.6c4-3 0-6-2-3ZM12 12c-1.5-2-4.5 0-1.5 2.2l1.5 1.2 1.5-1.2c3-2.2 0-4.2-1.5-2.2Z" fill="#ff6f9f" />}
    </g>
  );
}

function SleepingCat() {
  return (
    <g data-cat-hop>
      <g data-cat-body>
        <path d="M10 46c-1-10 8-14 20-14s21 4 20 14Z" fill={CAT.fur} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M30 34v4M36 34.5l-.5 4M24 34.5l.5 4" stroke={CAT.stripe} strokeWidth="1.4" strokeLinecap="round" />
      </g>
      <path data-cat-tail d="M48 45c4 1 6-1 5-4" fill="none" stroke={CAT.fur} strokeWidth="4" strokeLinecap="round" />
      <path d="M11 38 11 30l6 4ZM23 37l3-7 2 6Z" fill={CAT.fur} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <ellipse cx="18" cy="40" rx="9" ry="7" fill={CAT.fur} stroke={INK} strokeWidth="2.2" />
      <path d="M13 40q2 1.5 4 0M20 40q2 1.5 4 0" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M17.5 42.5h1.5l-.75 1Z" fill={CAT.nose} />
      <text data-cat-z x="26" y="26" fontFamily="sans-serif" fontWeight="900" fontSize="8" fill={INK}>z</text>
      <text data-cat-z x="30" y="20" fontFamily="sans-serif" fontWeight="900" fontSize="10" fill={INK}>Z</text>
    </g>
  );
}

/** The cat's art alone, for its card. */
export function CatArt({ mood }: { mood: PetMood }) {
  return <svg viewBox="0 0 60 48" aria-hidden="true">{mood === 'sleeping' ? <SleepingCat /> : <SittingCat mood={mood} />}</svg>;
}

interface OfficeCat2DProps {
  pet: PetShown;
  x: string;
  y: string;
  /** A grown cat's width, in pixels. */
  width: number;
  onOpen: (trigger: HTMLElement) => void;
}

export function OfficeCat2D({ pet, x, y, width, onOpen }: OfficeCat2DProps) {
  const style = { left: x, top: y, width: Math.max(18, width * STAGE_SCALE[pet.stage]) } as CSSProperties;
  return (
    <Spot
      type="button"
      data-office-cat
      data-cheer={pet.cheer > 0 || undefined}
      $mood={pet.mood}
      style={style}
      aria-haspopup="dialog"
      aria-label={`${pet.name}, the office cat. ${moodText(pet.mood, pet.name)}`}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {/* A new key restarts the hop each time someone feeds it. Only the art is keyed: the card
          keeps this button as its anchor, and keyboard focus stays on it. */}
      <CatArt key={pet.cheer} mood={pet.mood} />
      <Name>{pet.name}</Name>
    </Spot>
  );
}
