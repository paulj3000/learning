import { useEffect, useMemo, useRef } from 'react';
import { djangoAudioSourceFor } from '../../../api/audio/audioManifestApi';
import {
  useAudioManifest,
  useSoundManager,
  useSoundScope,
  type AudioManifestSource,
} from '../../../audio/react';
import {
  createAudioZones,
  createCameraListener,
  createSpatialEmitters,
  zonesFromAssignments,
  type PositionReader,
  type WorldMatrixObject,
  type ZoneSpec,
} from '../../../audio/world';
import type { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';
import { setSoundSink, type SoundCue, type SoundPlace } from '../soundCues';
import { createTreasureRushMusic } from './treasureRushMusic';
import {
  CUE_SOUNDS,
  ENTRY_AMBIENCE,
  FOOTSTEP_VOLUME,
  LANDING_SOUND_MIN_SPEED,
  NPC_CUE_EVENTS,
  ONE_SHOT_SPATIAL,
  POSITIONAL_CUES,
  ZONE_AMBIENCE,
  TR_SOUND,
  ZONE_PRIORITY,
} from './treasureRushSounds';

export const AMBIENCE_FADE_MS = 1500;
const SCOPE_NAME = 'treasure-rush';

/** What the hook needs from the 3D scene, as plain functions (the scene half provides them). */
export interface TreasureRushSceneAudio {
  entityPositionReader(entityId: string): PositionReader | undefined;
  unlockPositionReader(): PositionReader | undefined;
  listenerSource(): WorldMatrixObject;
  onFrame(callback: (deltaSeconds: number) => void): () => void;
}

/** Whether a scene API offers the audio methods (a stubbed or older scene may not). */
export function hasSceneAudio(api: unknown): api is TreasureRushSceneAudio {
  if (typeof api !== 'object' || api === null) return false;
  const candidate = api as Partial<Record<keyof TreasureRushSceneAudio, unknown>>;
  return (
    typeof candidate.entityPositionReader === 'function' &&
    typeof candidate.unlockPositionReader === 'function' &&
    typeof candidate.listenerSource === 'function' &&
    typeof candidate.onFrame === 'function'
  );
}

export interface UseTreasureRushAudioOptions {
  childId: string;
  /** The region's id: the scope of the audio manifest. */
  regionId: string;
  /** The region's event bus; zone entries and exits change the ambience. */
  bus: WorldEngineEventBus;
  /** The 3D scene's position readers, once it is up. Without it every sound is flat. */
  scene?: TreasureRushSceneAudio | null;
  /**
   * Where the manifest comes from. Defaults to the Django API for this child; `null` (a build
   * without the API) means no manifest and a silent game. Tests pass their own.
   */
  source?: AudioManifestSource | null;
}

export interface TreasureRushAudio {
  /** Tell the music a rune puzzle is out (or no longer is). */
  setPuzzleActive(active: boolean): void;
}

/** The built-in zone table, which staff zone assignments in the manifest override by zone id. */
const BUILT_IN_ZONES: readonly ZoneSpec[] = Object.entries(ZONE_AMBIENCE).map(([id, cue]) => ({
  id,
  cue,
  priority: ZONE_PRIORITY[id] ?? 0,
}));

export function mergeZones(fromManifest: readonly ZoneSpec[]): ZoneSpec[] {
  const merged = new Map(BUILT_IN_ZONES.map((zone) => [zone.id, zone]));
  for (const zone of fromManifest) merged.set(zone.id, { ...merged.get(zone.id), ...zone });
  return [...merged.values()];
}

/**
 * Treasure Rush's sound (SM-P3 to SM-P7). Mounted by the region-play companion for the whole visit.
 *
 * - Loads the region's published audio manifest into the shared Sound Manager. A manifest that
 *   cannot be loaded leaves the game silent; nothing here throws or waits for it.
 * - Plays every sound inside one scope (`treasure-rush`), so leaving the game stops all of it
 *   and cancels pending loads. Global and interface sounds are never in this scope.
 * - Ambience follows the audio zones the child is in (enter and exit events from the engine) with
 *   crossfades, through the shared `AudioZones`. Zone cues and priorities can be overridden by
 *   zone assignments in Django.
 * - A few one-shots (chest, key, the gate) are heard from where they happen, through the shared
 *   emitters on the Sound Manager's one audio context. Correct and retry feedback, rewards, quest
 *   completion, music and instructions stay flat on purpose.
 * - Registers the one sound sink `playCue` feeds, mapping each gameplay moment (already raised
 *   once per authoritative event by the companion) to its cues.
 *
 * It decides nothing about the game: it reacts to what the companion and the engine report.
 */
export function useTreasureRushAudio(options: UseTreasureRushAudioOptions): TreasureRushAudio {
  const { childId, regionId, bus, scene } = options;
  const manager = useSoundManager();
  const player = useSoundScope(SCOPE_NAME);

  const derived = useMemo(
    () => (options.source === undefined ? djangoAudioSourceFor(childId) : options.source),
    [childId, options.source],
  );
  const manifestScope = useMemo(() => ({ type: 'region', id: regionId }) as const, [regionId]);
  const manifest = useAudioManifest(derived, manifestScope);

  const zones = useMemo(
    () =>
      createAudioZones({
        player,
        zones: BUILT_IN_ZONES,
        defaultCue: ENTRY_AMBIENCE,
        fadeMs: AMBIENCE_FADE_MS,
        autoStart: false,
      }),
    [player],
  );
  const music = useMemo(() => createTreasureRushMusic(player), [player]);
  const emitters = useMemo(
    () => createSpatialEmitters({ player, setListener: (pose) => manager.setListener(pose) }),
    [player, manager],
  );

  // The first tap anywhere unlocks the browser's audio; idempotent and removed on exit.
  useEffect(() => manager.installGestureUnlock(), [manager]);

  // Own the zones and music for this visit. StrictMode runs this twice; the second run restores.
  useEffect(() => {
    zones.activate();
    music.activate();
    return () => {
      zones.deactivate();
      music.deactivate();
    };
  }, [zones, music]);

  // Zones: the engine reports entries and exits of the zones declared in the region's layout.
  useEffect(() => {
    const offEnter = bus.on('PlayerEnteredZone', ({ zoneId }) => zones.enter(zoneId));
    const offLeave = bus.on('PlayerLeftZone', ({ zoneId }) => zones.exit(zoneId));
    return () => {
      offEnter();
      offLeave();
    };
  }, [bus, zones]);

  // LAI-JMP-01: the child's own jumps and landings, flat and quiet. Played by logical cue id;
  // with no published audio for a cue the play fails quietly and the jump goes on regardless.
  useEffect(() => {
    const offJump = bus.on('PlayerJumped', () => {
      void player.play(TR_SOUND.playerJump).catch(() => undefined);
    });
    const offLand = bus.on('PlayerLanded', ({ impactSpeed }) => {
      if (impactSpeed < LANDING_SOUND_MIN_SPEED) return;
      void player.play(TR_SOUND.playerLand).catch(() => undefined);
    });
    // Running & sprinting: optional footsteps, at the pace the engine reports, louder when faster.
    const offStep = bus.on('PlayerFootstep', ({ gait }) => {
      void player
        .play(TR_SOUND.playerFootstep, { volume: FOOTSTEP_VOLUME[gait] })
        .catch(() => undefined);
    });
    return () => {
      offJump();
      offLand();
      offStep();
    };
  }, [bus, player]);

  // Staff zone assignments from the manifest replace the built-in cues and priorities.
  const { assignments } = manifest;
  useEffect(() => {
    zones.setZones(mergeZones(zonesFromAssignments(assignments)));
  }, [zones, assignments]);

  // Space: the listener follows the camera and moving sources follow their objects, once per
  // frame, in the scene's own loop. Nothing here renders React.
  useEffect(() => {
    if (!scene) return undefined;
    const listener = createCameraListener(scene.listenerSource());
    const stop = scene.onFrame(() => {
      emitters.setListener(listener.update());
      emitters.update();
    });
    // Not disposed here: StrictMode re-runs this effect, and the scope owns the sounds anyway.
    return stop;
  }, [scene, emitters]);

  // NPC moments read the staff's NPC assignments; a ref, so a new manifest keeps the one sink.
  const assignmentsRef = useRef(assignments);
  assignmentsRef.current = assignments;

  // Moments of play. One sink for the visit; the companion raises each moment once.
  useEffect(() => {
    const readerFor = (at?: SoundPlace): PositionReader | undefined => {
      if (!scene || !at) return undefined;
      if (at.unlock) return scene.unlockPositionReader();
      return at.entityId ? scene.entityPositionReader(at.entityId) : undefined;
    };
    const previous = setSoundSink((cue: SoundCue, at?: SoundPlace) => {
      if (cue === 'questComplete') music.playVictory();
      const npcEvent = NPC_CUE_EVENTS[cue];
      if (npcEvent) {
        for (const assignment of assignmentsRef.current) {
          if (
            assignment.targetType === 'npc' &&
            assignment.targetId === at?.npcId &&
            assignment.event === npcEvent
          ) {
            void player.play(assignment.soundId).catch(() => undefined);
          }
        }
        return;
      }
      const read = readerFor(at);
      const spot: [number, number, number] = [0, 0, 0];
      const placed = read?.(spot) === true;
      for (const soundId of CUE_SOUNDS[cue]) {
        if (placed && POSITIONAL_CUES.has(soundId)) {
          void emitters.playAt(soundId, [...spot], ONE_SHOT_SPATIAL).catch(() => undefined);
        } else {
          void player.play(soundId).catch(() => undefined);
        }
      }
    });
    return () => void setSoundSink(previous);
  }, [player, music, emitters, scene]);

  // A manifest that arrives (or changes) after the game started gives waiting cues their audio.
  const { status, revision } = manifest;
  useEffect(() => {
    if (status !== 'ready') return;
    zones.retry();
    music.reapply();
  }, [status, revision, zones, music]);

  return useMemo(
    () => ({ setPuzzleActive: (active: boolean) => music.setPuzzleActive(active) }),
    [music],
  );
}
