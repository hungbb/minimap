// The 3D map: React draws the controls and badges around a three.js scene.
import { officeAssembly } from '../lib/assembly.ts';
import { AssemblePlay } from '../components/AssemblyDecor.tsx';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import styled, { css } from 'styled-components';
import { mapSummary, resultText, type VoteView } from '../../shared/vote.ts';
import { moodText } from '../../shared/pet.ts';
import { voteLink } from '../lib/noticeBoard.ts';
import { Badge, BadgeName } from '../components/Badge.tsx';
import { PICKER_LABELS } from '../lib/pickerAppearance.ts';
import { useElementSize, useReducedMotion } from '../lib/hooks.ts';
import { media, theme } from '../styles/theme.ts';
import { Button } from '../styles/ui.ts';
import { createScene3D, type CameraState, type Scene3D, type ZoneLabelSlot } from './scene3d.ts';
import type { MapProps } from './types.ts';
import { ArcadePlay } from './ArcadeCabinet.tsx';
import { NoticeBoardLink } from './NoticeBoard2D.tsx';
import { hasWeather, WeatherOverlay } from './WeatherOverlay.tsx';
import { MAP_LAYERS } from './layers.ts';

const View = styled.div<{ $namesOff: boolean }>`
  isolation: isolate;
  position: absolute;
  inset: 0;
  overflow: hidden;
  border: ${theme.line};
  border-radius: 22px;
  /* The sky follows the time of day at the office (lib/ambience.ts). */
  background: linear-gradient(var(--sky-top), var(--sky-bottom) 70%);
  box-shadow: 0 5px 0 ${theme.ink};

  ${media.phone} {
    [data-arcade-play], [data-picker-play] {
      width: 44px;
      min-width: 44px;
      min-height: 44px;
      padding: 3px;
      font-size: 9px;
      white-space: normal;
    }
  }

  ${({ $namesOff }) =>
    $namesOff &&
    css`
      ${BadgeName} {
        display: none;
      }
    `}
`;

// The cat's name above its head, drawn like a team member's name, and its button.
const PetName = styled.button`
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  pointer-events: auto;
`;

const ZoneLabel = styled.div`
  padding: 0 10px;
  border: ${theme.line};
  border-radius: 12px;
  background: ${theme.paper};
  font: 800 15px/1.4 ${theme.displayFont};
  white-space: nowrap;
  pointer-events: none;

  ${media.phone} {
    padding: 0 6px;
    border-width: 2px;
    border-radius: 8px;
    font-size: 11px;
  }
`;

const SceneStage = styled.div`
  position: absolute;
  inset: 0;
  z-index: ${MAP_LAYERS.scene};

  canvas {
    display: block;
  }

  /* The room someone is about to drop themselves into. */
  [data-drop-target] > ${ZoneLabel} {
    outline: 4px dashed ${theme.focus};
    outline-offset: 2px;
    background: ${theme.butter};
  }

  /* Your own name can be grabbed to drag yourself, also by touch. */
  [data-mover] [data-badge] {
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
`;

const ZoneLabelCount = styled.span`
  margin-left: 5px;
  font-weight: 500;
`;

const CameraBar = styled.div`
  position: absolute;
  left: 12px;
  right: 12px;
  top: 12px;
  z-index: ${MAP_LAYERS.controls};
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  pointer-events: none;

  ${Button} {
    pointer-events: auto;
  }
  ${Button}[aria-pressed='true'] {
    background: ${theme.butter};
  }

  ${media.phone} {
    flex-wrap: nowrap;
    left: 0;
    right: 0;
    top: 0;
    padding: 8px 10px 10px;
    overflow-x: auto;
    pointer-events: auto;
    scrollbar-width: none;

    ${Button} {
      flex: none;
    }
  }
`;

const CameraHint = styled.p`
  position: absolute;
  left: 14px;
  bottom: 10px;
  z-index: ${MAP_LAYERS.controls};
  margin: 0;
  color: ${theme.ink};
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;

  /* Stays readable against a dark sky. */
  [data-daylight='night'] &,
  [data-daylight='dawn'] &,
  [data-daylight='dusk'] & {
    padding: 0 8px;
    border-radius: 8px;
    background: rgb(255 254 250 / 0.85);
  }

  ${media.phone} {
    display: none;
  }
`;

const ResultLink = styled.a`
  position: absolute;
  left: 12px;
  bottom: 36px;
  z-index: ${MAP_LAYERS.controls + 1};
  padding: 2px 10px;
  border: ${theme.thinLine};
  border-radius: 10px;
  background: ${theme.butter};
  font-weight: 800;
  text-decoration: none;

  &:not(:focus) {
    clip-path: inset(50%);
    width: 1px;
    height: 1px;
    overflow: hidden;
    white-space: nowrap;
  }
`;

function boardLabel(votes: VoteView[]): string {
  const open = mapSummary(votes, new Date()).length;
  return `Notice board: ${open || 'no'} open ${open === 1 ? 'vote' : 'votes'}. Open team votes`;
}

interface Map3DProps extends MapProps {
  /** The 3D map can't keep drawing, so show something else. */
  onFail: () => void;
}

export default function Map3D({
  state,
  isDimmed,
  selected,
  focus,
  onSelect,
  onArcade,
  onPet,
  pet,
  onPicker,
  onAssemble,
  look,
  votes,
  voteMarks,
  reactions,
  mover,
  onMove,
  onFail,
}: Map3DProps) {
  const attendance = officeAssembly(state);
  const officeIds = new Set(state.places.map(place=>place.id));
  const stageRef = useRef<HTMLDivElement>(null);
  const viewport = useElementSize(stageRef);
  const portrait = viewport.height > 0 && viewport.width / viewport.height < 0.95;
  const sceneRef = useRef<Scene3D | null>(null);
  const [pickerSlot, setPickerSlot] = useState<HTMLElement | null>(null);
  const onPickerRef = useRef(onPicker);
  onPickerRef.current = onPicker;
  const [arcadeSlot, setArcadeSlot] = useState<HTMLElement | null>(null);
  const [boardSlot, setBoardSlot] = useState<HTMLElement | null>(null);
  const onArcadeRef = useRef(onArcade);
  onArcadeRef.current = onArcade;
  const [petSlot, setPetSlot] = useState<HTMLElement | null>(null);
  const onPetRef = useRef(onPet);
  onPetRef.current = onPet;
  const [personLabels, setPersonLabels] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const [zoneLabels, setZoneLabels] = useState<ZoneLabelSlot[]>([]);
  const [camera, setCamera] = useState<CameraState>({ presets: [], active: 'overview' });
  const [namesOn, setNamesOn] = useState(true);
  const [wanderOn, setWanderOn] = useState(true);
  const reduced = useReducedMotion();

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const scene = createScene3D(stage, {
      onCamera: setCamera,
      onPicker: trigger => onPickerRef.current(trigger),
      onArcade: (trigger) => onArcadeRef.current(trigger),
      onPet: (trigger) => onPetRef.current(trigger),
      onNoticeBoard: (link) => location.assign(link),
      onContextGone: () => onFailRef.current(),
      onMove: (place) => onMoveRef.current(place),
      // Clicking a character opens the same card as clicking its badge.
      onPick: (username, label) =>
        onSelectRef.current(username, label.querySelector<HTMLElement>('[data-badge]') ?? label),
    });
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
      setPersonLabels(new Map());
      setZoneLabels([]);
      setPickerSlot(null);
      setArcadeSlot(null);
      setBoardSlot(null);
      setPetSlot(null);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { people, zones, arcade, picker, board, pet: petLabel } = scene.update(state, isDimmed);
    setPersonLabels(people);
    setZoneLabels(zones);
    setPickerSlot(picker);
    setArcadeSlot(arcade);
    setBoardSlot(board);
    setPetSlot(petLabel);
  }, [state, isDimmed, portrait]);

  useEffect(() => {
    sceneRef.current?.setPet(pet);
  }, [pet, petSlot]);

  useEffect(() => {
    sceneRef.current?.setVotes(votes);
  }, [votes]);

  useEffect(() => {
    sceneRef.current?.setVoteMarks(voteMarks);
  }, [voteMarks]);

  useEffect(() => {
    if (reactions) sceneRef.current?.react(reactions.list);
  }, [reactions]);

  useEffect(() => {
    if (focus) sceneRef.current?.focus(focus.username);
  }, [focus]);

  useEffect(() => {
    sceneRef.current?.setMover(mover);
  }, [mover]);

  useEffect(() => {
    sceneRef.current?.setWandering(wanderOn);
  }, [wanderOn]);

  useEffect(() => {
    sceneRef.current?.setAmbience(look);
  }, [look]);

  return (
    <View
      data-map-root
      data-layout={portrait ? 'portrait' : 'landscape'}
      data-daylight={look.phase}
      $namesOff={!namesOn}
      style={{ '--sky-top': look.sky.top, '--sky-bottom': look.sky.bottom } as CSSProperties}
    >
      <SceneStage ref={stageRef} />
      {hasWeather(look) && <WeatherOverlay look={look} reduced={reduced} />}

      <CameraBar>
        {camera.presets.map((preset) => (
          <Button
            key={preset.id}
            $small
            type="button"
            aria-pressed={preset.id === camera.active}
            onClick={() => sceneRef.current?.applyPreset(preset.id)}
          >
            {preset.name}
          </Button>
        ))}
        <Button $small type="button" aria-pressed={namesOn} onClick={() => setNamesOn(!namesOn)}>
          Names
        </Button>
        <Button $small type="button" aria-pressed={wanderOn} onClick={() => setWanderOn(!wanderOn)}>
          Wander
        </Button>
      </CameraBar>

      <CameraHint>
        Drag to rotate, scroll to zoom, click someone for details{mover && ', drag yourself to another room to move'}
      </CameraHint>

      {arcadeSlot &&
        createPortal(
          <ArcadePlay
            data-arcade-play
            data-arcade-cabinet="3d"
            aria-label="Open basketball arcade"
            aria-haspopup="dialog"
            onClick={(event) => onArcade(event.currentTarget)}
          >
            Play
          </ArcadePlay>,
          arcadeSlot,
        )}

      {/* The cat's name, which is also its button for keyboards and screen readers. */}
      {petSlot && pet &&
        createPortal(
          <PetName
            type="button"
            data-office-cat
            aria-haspopup="dialog"
            aria-label={`${pet.name}, the office cat. ${moodText(pet.mood, pet.name)}`}
            onClick={(event) => onPet(event.currentTarget)}
          >
            <BadgeName>{pet.name}</BadgeName>
          </PetName>,
          petSlot,
        )}

      {pickerSlot && createPortal(
        <ArcadePlay data-picker-play disabled={!state.users.length} aria-label={!state.users.length ? 'Random picker unavailable: no team members' : 'Open random picker'} aria-haspopup="dialog" onClick={event => onPicker(event.currentTarget)} style={{background: theme.bubblegum}}>{PICKER_LABELS.start}</ArcadePlay>, pickerSlot)}
      {boardSlot &&
        createPortal(
          <NoticeBoardLink href="/vote" data-notice-board="3d" aria-label={boardLabel(votes)}>
            Votes
          </NoticeBoardLink>,
          boardSlot,
        )}

      {/* The blimp's banner for keyboards and screen readers: it shows when focused. */}
      {voteMarks?.result && (
        <ResultLink data-vote-result href={voteLink(voteMarks.result.vote.id)}>{resultText(voteMarks.result)}</ResultLink>
      )}

      {zoneLabels.map((zone) =>
        createPortal(
          <ZoneLabel style={attendance.unlocked && officeIds.has(zone.id) && zone.count>0 ? {background:'#fff0bf',borderColor:'#bd913c'} : undefined}>
            <span>{zone.name}</span>
            <ZoneLabelCount>{zone.count}</ZoneLabelCount>
            {attendance.unlocked && officeIds.has(zone.id) && zone.count>0 && <AssemblePlay data-assemble-play aria-label={`Assemble team from ${zone.name}`} aria-haspopup="dialog" style={{marginLeft:8}} onClick={event=>onAssemble(event.currentTarget)}>✦ Assemble</AssemblePlay>}
          </ZoneLabel>,
          zone.element,
          zone.id,
        ),
      )}

      {state.users.map((user) => {
        const label = personLabels.get(user.username);
        if (!label) return null;
        return createPortal(
          <Badge
            user={user}
            floating
            dimmed={isDimmed(user)}
            selected={selected === user.username}
            onSelect={onSelect}
          />,
          label,
          user.username,
        );
      })}
    </View>
  );
}
