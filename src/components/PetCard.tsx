// The office cat's card: the cat turning in 3D, its name, how grown up it is, how it feels, who
// fed it today, and a Feed button for people who are logged in. It opens beside the cat, like a
// person's card.
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { GOOD_DAY_FEEDS, moodText, stageText, type PetView } from '../../shared/pet.ts';
import type { AuthResult, TeamUser } from '../../shared/types.ts';
import { api, errorText } from '../lib/api.ts';
import { useReducedMotion } from '../lib/hooks.ts';
import { supportsWebGL } from '../lib/webgl.ts';
import type { PetShown } from '../lib/petLook.ts';
import { CatArt } from '../map/OfficeCat2D.tsx';
import { theme } from '../styles/theme.ts';
import { Button } from '../styles/ui.ts';
import { Card, place } from './DetailCard.tsx';
import type { PetCat3DProps } from './PetCat3D.tsx';

// three.js is large, so the 3D cat loads only when the card opens. If it can't load, the
// 2D drawing takes its place.
const PetCat3D = lazy(() =>
  import('./PetCat3D.tsx').catch(() => ({ default: ({ pet }: PetCat3DProps) => <CatArt mood={pet.mood} /> })),
);

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;

  h3 { font-size: 21px; overflow-wrap: anywhere; }
`;

// The cat's own little stage: 3D when it can, the 2D drawing otherwise.
const Portrait = styled.div`
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 92px;
  height: 84px;
  border: ${theme.thinLine};
  border-radius: 14px;
  background: radial-gradient(circle at 50% 70%, #fff8ec, #ffe1c2);
  overflow: hidden;

  svg { width: 70px; }
`;

const Line = styled.p`
  margin: 9px 0 0;
  overflow-wrap: anywhere;
`;

const Soft = styled(Line)`
  color: ${theme.inkSoft};
  font-size: 14px;
  font-weight: 700;
`;

const Problem = styled(Line)`
  color: ${theme.error};
  font-weight: 800;
`;

interface PetCardProps {
  pet: PetView;
  shown: PetShown;
  users: TeamUser[];
  login: AuthResult | null;
  anchor: HTMLElement;
  onClose: () => void;
}

export function PetCard({ pet, shown, users, login, anchor, onClose }: PetCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [feeding, setFeeding] = useState(false);
  const [error, setError] = useState('');
  const reduced = useReducedMotion();
  const [use3D, setUse3D] = useState(() => supportsWebGL());
  const flat = useMemo(() => <CatArt mood={shown.mood} />, [shown.mood]);

  useLayoutEffect(() => {
    if (cardRef.current) place(cardRef.current, anchor);
  });

  // Follows the cat while the 3D camera moves.
  useEffect(() => {
    let frame = requestAnimationFrame(function follow() {
      if (cardRef.current) place(cardRef.current, anchor);
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element;
      if (cardRef.current?.contains(target) || target.closest?.('[data-office-cat]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  const nickname = (name: string) => users.find((u) => u.username === name)?.nickname || name;
  const fedByMe = Boolean(login && pet.fed.includes(login.username));
  const left = GOOD_DAY_FEEDS - pet.fed.length;

  async function feed() {
    if (!login) return;
    setFeeding(true);
    setError('');
    try {
      // The live update brings the feed, and with it the hop.
      await api('POST', '/api/pet/feed', {}, { Authorization: `Bearer ${login.token}` });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setFeeding(false);
    }
  }

  return createPortal(
    <Card role="dialog" aria-label={`${pet.name}, the office cat`} ref={cardRef}>
      <Head>
        <Portrait>
          {use3D ? (
            <Suspense fallback={flat}>
              <PetCat3D pet={shown} reduced={reduced} onFail={() => setUse3D(false)} />
            </Suspense>
          ) : (
            flat
          )}
        </Portrait>
        <div>
          <h3>{pet.name}</h3>
          <Soft style={{ margin: 0 }}>{stageText(pet)}</Soft>
        </div>
      </Head>
      <Line>{moodText(shown.mood, pet.name)}</Line>
      <Soft>
        {pet.fed.length ? `Fed today by ${pet.fed.map(nickname).join(', ')}.` : `Nobody has fed ${pet.name} today.`}
        {left > 0 ? ` ${left} more for a good day.` : ' Today is a good day!'}
      </Soft>
      {login ? (
        <Button $small type="button" style={{ marginTop: 10 }} disabled={feeding || fedByMe} onClick={() => void feed()}>
          {fedByMe ? `You fed ${pet.name} today ✓` : `Feed ${pet.name} 🐟`}
        </Button>
      ) : (
        <Soft>Log in on <a href="/me">Update status</a> to feed {pet.name}.</Soft>
      )}
      {error && <Problem role="alert">{error}</Problem>}
    </Card>,
    document.body,
  );
}
