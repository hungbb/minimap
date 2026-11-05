// The 3D map: React draws the controls and badges around a three.js scene.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import styled, { css } from 'styled-components';
import { Badge, BadgeName } from '../components/Badge.tsx';
import { useAmbience } from '../lib/hooks.ts';
import { media, theme } from '../styles/theme.ts';
import { Button } from '../styles/ui.ts';
import { createScene3D, type CameraState, type Scene3D, type ZoneLabelSlot } from './scene3d.ts';
import type { MapProps } from './types.ts';

const View = styled.div<{ $namesOff: boolean }>`
  position: absolute;
  inset: 0;
  overflow: hidden;
  border: ${theme.line};
  border-radius: 22px;
  /* The sky follows the time of day at the office (lib/ambience.ts). */
  background: linear-gradient(var(--sky-top), var(--sky-bottom) 70%);
  box-shadow: 0 5px 0 ${theme.ink};

  ${({ $namesOff }) => $namesOff && css`
    ${BadgeName} { display: none; }
  `}
`;

const SceneStage = styled.div`
  position: absolute;
  inset: 0;

  canvas { display: block; }
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

const ZoneLabelCount = styled.span`
  margin-left: 5px;
  font-weight: 500;
`;

const CameraBar = styled.div`
  position: absolute;
  left: 12px;
  right: 12px;
  top: 12px;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  pointer-events: none;

  ${Button} { pointer-events: auto; }
  ${Button}[aria-pressed='true'] { background: ${theme.butter}; }

  ${media.phone} {
    flex-wrap: nowrap;
    left: 0;
    right: 0;
    top: 0;
    padding: 8px 10px 10px;
    overflow-x: auto;
    pointer-events: auto;
    scrollbar-width: none;

    ${Button} { flex: none; }
  }
`;

const CameraHint = styled.p`
  position: absolute;
  left: 14px;
  bottom: 10px;
  z-index: 5;
  margin: 0;
  color: ${theme.ink};
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;

  /* Stays readable against a dark sky. */
  [data-daylight='night'] &, [data-daylight='dawn'] &, [data-daylight='dusk'] & {
    padding: 0 8px;
    border-radius: 8px;
    background: rgb(255 254 250 / .85);
  }

  ${media.phone} { display: none; }
`;

export default function Map3D({ state, isDimmed, selected, focus, onSelect }: MapProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const [personLabels, setPersonLabels] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const [zoneLabels, setZoneLabels] = useState<ZoneLabelSlot[]>([]);
  const [camera, setCamera] = useState<CameraState>({ presets: [], active: 'overview' });
  const [namesOn, setNamesOn] = useState(true);
  const [wanderOn, setWanderOn] = useState(true);
  const look = useAmbience(state.weather);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const scene = createScene3D(stage, {
      onCamera: setCamera,
      // Clicking a character opens the same card as clicking its badge.
      onPick: (username, label) => onSelectRef.current(username, label.querySelector<HTMLElement>('[data-badge]') ?? label),
    });
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
      setPersonLabels(new Map());
      setZoneLabels([]);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { people, zones } = scene.update(state, isDimmed);
    setPersonLabels(people);
    setZoneLabels(zones);
  }, [state, isDimmed]);

  useEffect(() => {
    if (focus) sceneRef.current?.focus(focus.username);
  }, [focus]);

  useEffect(() => {
    sceneRef.current?.setWandering(wanderOn);
  }, [wanderOn]);

  useEffect(() => {
    sceneRef.current?.setAmbience(look);
  }, [look]);

  return (
    <View
      data-map-root
      data-daylight={look.phase}
      $namesOff={!namesOn}
      style={{ '--sky-top': look.sky.top, '--sky-bottom': look.sky.bottom } as CSSProperties}
    >
      <SceneStage ref={stageRef} />

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

      <CameraHint>Drag to rotate, scroll to zoom, click someone for details</CameraHint>

      {zoneLabels.map((zone) =>
        createPortal(
          <ZoneLabel>
            <span>{zone.name}</span>
            <ZoneLabelCount>{zone.count}</ZoneLabelCount>
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
