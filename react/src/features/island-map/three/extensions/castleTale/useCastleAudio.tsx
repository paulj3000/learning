import { useEffect, useMemo, useRef } from 'react';
import { djangoAudioSourceFor } from '../../../../../api/audio/audioManifestApi';
import { createMusicStates } from '../../../../../audio/music';
import { preferenceSyncFor, type PreferenceSync } from '../../../../../audio/preferences';
import {
  useAudioManifest,
  useSoundManager,
  useSoundScope,
  type AudioManifestSource,
} from '../../../../../audio/react';
import { createAudioZones, zonesFromAssignments, type ZoneSpec } from '../../../../../audio/world';
import type { AgeBandValue } from '../../../../child-profile/constants';
import { LANDING_SOUND_MIN_SPEED } from '../../../../region-play/audio/treasureRushSounds';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import {
  playCastleCue,
  setCastleSoundSink,
  type CastleSoundMoment,
  type CastleSoundPlace,
} from './castleSoundCues';
import {
  CASTLE_CUE_SOUNDS,
  CASTLE_MUSIC,
  CUE_FALLBACK,
  ENTRY_AMBIENCE,
  ONE_SHOT_SPATIAL,
  POSITIONAL_CUES,
  ROOM_AMBIENCE,
  ROOM_PRIORITY,
  SHARED_MOVEMENT,
  SPROUT_SILENT_MOMENTS,
} from './castleSounds';
import type { CastleTaleSceneApi } from './castleTaleScene';

export const CASTLE_REGION_ID = 'storykeeper-castle';
export const AMBIENCE_FADE_MS = 1500;
export const MUSIC_FADE_MS = 1200;
const SCOPE_NAME = 'castle';
/** How often the child's room is re-read, like the castle guide. */
const ROOM_POLL_MS = 400;

export interface UseCastleAudioOptions {
  childId: string;
  ageBand: AgeBandValue;
  bus: WorldEngineEventBus;
  /** The castle scene, once it is up. Without it the bed stays the hall's and sounds are flat. */
  scene: CastleTaleSceneApi | null;
  /** Keeper Quill's entity id: his greeting is heard from where he stands. */
  quillEntityId?: string;
  /** Where the manifest comes from. Defaults to Django for this child; `null` means silence. */
  source?: AudioManifestSource | null;
  /** Where a session default is asked for. Defaults to the open child's preference sync. */
  preferences?: Pick<PreferenceSync, 'applySessionDefault'> | null;
  pollMs?: number;
}

export interface CastleAudio {
  /** The Storybook (the castle guide) is open: the story theme plays while it is. */
  setStoryOpen(open: boolean): void;
}

const BUILT_IN_ZONES: readonly ZoneSpec[] = Object.entries(ROOM_AMBIENCE).map(([id, cue]) => ({
  id,
  cue,
  priority: (ROOM_PRIORITY as Readonly<Record<string, number>>)[id] ?? 0,
}));

/** Staff zone assignments (by room id) override the built-in room beds. */
export function mergeRoomZones(fromManifest: readonly ZoneSpec[]): ZoneSpec[] {
  const merged = new Map(BUILT_IN_ZONES.map((zone) => [zone.id, zone]));
  for (const zone of fromManifest) merged.set(zone.id, { ...merged.get(zone.id), ...zone });
  return [...merged.values()];
}

/**
 * Storykeeper Castle's sound (SC-R06-01, SC-R06-02), on the shared Sound Manager. Mounted by the
 * castle's companion for the whole visit; modelled on `useTreasureRushAudio`.
 *
 * - Loads the published audio manifest for `storykeeper-castle`. A manifest that cannot be loaded
 *   leaves the castle silent; nothing here throws or waits for it.
 * - Every sound is in one scope (`castle`), so leaving the castle stops all of it.
 * - The room bed follows the room the child stands in (read from the scene, as the castle guide
 *   does) with a 1500 ms crossfade, one bed at a time; a room whose bed has no audio falls back
 *   to the hall's, and with no audio at all it is silence.
 * - Music: the exploration theme, and the story theme while the Storybook is open.
 * - Moments (`playCastleCue`) map to cues; a missing cue is silent or plays its shared fallback.
 * - Sprouts (SC-R06-02): no try-again sound, and a calmer mix (reduced intensity) as a session
 *   default only when the child has no saved mix. Mute and volume are the child's own settings in
 *   the Sound Manager and are never touched here.
 *
 * It decides nothing about play: it only reacts to what the castle reports.
 */
export function useCastleAudio(options: UseCastleAudioOptions): CastleAudio {
  const { childId, ageBand, bus, scene, quillEntityId } = options;
  const pollMs = options.pollMs ?? ROOM_POLL_MS;
  const manager = useSoundManager();
  const player = useSoundScope(SCOPE_NAME);

  const derived = useMemo(
    () => (options.source === undefined ? djangoAudioSourceFor(childId) : options.source),
    [childId, options.source],
  );
  const manifestScope = useMemo(() => ({ type: 'region', id: CASTLE_REGION_ID }) as const, []);
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
  const music = useMemo(
    () =>
      createMusicStates({
        player,
        crossfadeMs: MUSIC_FADE_MS,
        states: {
          exploration: { sound: CASTLE_MUSIC.explore },
          narration: { sound: CASTLE_MUSIC.story },
        },
      }),
    [player],
  );
  const storyOpen = useRef(false);

  useEffect(() => manager.installGestureUnlock(), [manager]);

  // Own the bed and the music for this visit. StrictMode runs this twice; the second run restores.
  useEffect(() => {
    zones.activate();
    void music.activate().then((resumed) => {
      if (!resumed) void music.setState(storyOpen.current ? 'narration' : 'exploration');
    });
    return () => {
      zones.deactivate();
      music.deactivate();
    };
  }, [zones, music]);

  // SC-R06-02: Sprouts get a calmer mix, for this session only, when nothing is saved.
  const preferences = options.preferences;
  useEffect(() => {
    if (ageBand !== 'SPROUT') return undefined;
    const sync = preferences === undefined ? preferenceSyncFor(childId) : preferences;
    if (!sync) return undefined;
    return sync.applySessionDefault({ reducedIntensity: true });
  }, [ageBand, childId, preferences]);

  // The room the child stands in, re-read often and cheaply. Only a change moves the bed; a
  // moment in a doorway (no room) keeps the bed it had.
  useEffect(() => {
    if (!scene) return undefined;
    let room: string | undefined;
    const read = () => {
      const next = scene.currentRoomId();
      if (!next || next === room) return;
      const previous = room;
      room = next;
      zones.enter(next);
      if (previous) {
        zones.exit(previous);
        void player.play(CASTLE_CUE_SOUNDS.roomDoor[0] as string).catch(() => undefined);
      }
    };
    read();
    const timer = setInterval(read, pollMs);
    return () => {
      clearInterval(timer);
      if (room) zones.exit(room);
    };
  }, [scene, zones, player, pollMs]);

  // Staff zone assignments (by room id) replace the built-in beds and priorities.
  const { assignments } = manifest;
  useEffect(() => {
    zones.setZones(mergeRoomZones(zonesFromAssignments(assignments)));
  }, [zones, assignments]);

  // SC-JMP's course: the shared movement and platform cues, flat and optional.
  useEffect(() => {
    const play = (cue: string) => void player.play(cue).catch(() => undefined);
    const offs = [
      bus.on('PlayerJumped', () => play(SHARED_MOVEMENT.playerJump)),
      bus.on('PlayerLanded', ({ impactSpeed }) => {
        if (impactSpeed >= LANDING_SOUND_MIN_SPEED) play(SHARED_MOVEMENT.playerLand);
      }),
      bus.on('PlatformActivated', ({ cue }) => play(cue ?? SHARED_MOVEMENT.platformActivate)),
      bus.on('PlatformMoving', ({ cue }) => play(cue ?? SHARED_MOVEMENT.platformMove)),
      bus.on('PlatformStopped', ({ cue }) => play(cue ?? SHARED_MOVEMENT.platformStop)),
      bus.on('PressurePlatePressed', () => play(SHARED_MOVEMENT.pressurePlate)),
      bus.on('PlayerBounced', ({ cue }) => play(cue ?? SHARED_MOVEMENT.bounce)),
      bus.on('CourseCheckpointReached', () => play(SHARED_MOVEMENT.checkpoint)),
      bus.on('PlayerRecovered', () => play(SHARED_MOVEMENT.playerRecover)),
      bus.on('PlatformGoalReached', () => play(SHARED_MOVEMENT.platformGoal)),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [bus, player]);

  // Moments of play. One sink for the visit.
  const sprout = ageBand === 'SPROUT';
  useEffect(() => {
    const placeFor = (soundId: string, at?: CastleSoundPlace) => {
      if (!POSITIONAL_CUES.has(soundId) || !at?.entityId || at.entityId !== quillEntityId) {
        return undefined;
      }
      const read = scene?.quillPositionReader();
      const spot: [number, number, number] = [0, 0, 0];
      return read?.(spot) ? { ...ONE_SHOT_SPATIAL, position: spot } : undefined;
    };
    const previous = setCastleSoundSink((moment: CastleSoundMoment, at?: CastleSoundPlace) => {
      if (sprout && SPROUT_SILENT_MOMENTS.has(moment)) return;
      for (const cue of CASTLE_CUE_SOUNDS[moment]) {
        const fallback = CUE_FALLBACK[cue];
        const soundId = !manager.has(cue) && fallback ? fallback : cue;
        const spatial = placeFor(soundId, at);
        void player.play(soundId, spatial ? { spatial } : {}).catch(() => undefined);
      }
    });
    return () => void setCastleSoundSink(previous);
  }, [player, manager, scene, quillEntityId, sprout]);

  // Any NPC's approach (Quill today, Professor Orion and others once they land): one greeting cue.
  useEffect(
    () =>
      bus.on('NpcApproached', ({ entityId }) => {
        // Through the sink, so the Sprout rules and placement apply in one place.
        playCastleCue('npcGreet', { entityId });
      }),
    [bus],
  );

  // CollectiblePickedUp in the castle is a story object found: the artifact cue.
  useEffect(
    () =>
      bus.on('CollectiblePickedUp', ({ entityId }) => playCastleCue('artifactFound', { entityId })),
    [bus],
  );

  // A manifest that arrives (or changes) after the castle started gives waiting cues their audio.
  const { status, revision } = manifest;
  useEffect(() => {
    if (status !== 'ready') return;
    zones.retry();
    void music.retry();
  }, [status, revision, zones, music]);

  return useMemo(
    () => ({
      setStoryOpen(open: boolean) {
        if (storyOpen.current === open) return;
        storyOpen.current = open;
        void music.setState(open ? 'narration' : 'exploration');
      },
    }),
    [music],
  );
}
