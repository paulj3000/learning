import { useEffect, useMemo } from 'react';
import { djangoAudioSourceFor } from '../../../api/audio/audioManifestApi';
import {
  useAudioManifest,
  useSoundManager,
  useSoundScope,
  type AudioManifestSource,
} from '../../../audio/react';
import type { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';
import { setSoundSink, type SoundCue } from '../soundCues';
import { createSoundSlot } from './soundSlot';
import { createTreasureRushMusic } from './treasureRushMusic';
import { CUE_SOUNDS, ENTRY_AMBIENCE, ambienceForZone } from './treasureRushSounds';

export const AMBIENCE_FADE_MS = 1500;
const SCOPE_NAME = 'treasure-rush';

export interface UseTreasureRushAudioOptions {
  childId: string;
  /** The region's id: the scope of the audio manifest. */
  regionId: string;
  /** The region's event bus; zone entries change the ambience. */
  bus: WorldEngineEventBus;
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

/**
 * Treasure Rush's sound (SM-P3). Mounted by the region-play companion for the whole visit.
 *
 * - Loads the region's published audio manifest into the shared Sound Manager. A manifest that
 *   cannot be loaded leaves the game silent; nothing here throws or waits for it.
 * - Plays every sound inside one scope (`treasure-rush`), so leaving the game stops all of it
 *   and cancels pending loads. Global and interface sounds are never in this scope.
 * - Registers the one sound sink `playCue` feeds, mapping each gameplay moment (already raised
 *   once per authoritative event by the companion) to its cues.
 * - Keeps the ambience bed in step with the zone the child last entered, and the music in step
 *   with the puzzle and the finale.
 *
 * It decides nothing about the game: it reacts to what the companion and the engine report.
 */
export function useTreasureRushAudio(options: UseTreasureRushAudioOptions): TreasureRushAudio {
  const { childId, regionId, bus } = options;
  const manager = useSoundManager();
  const player = useSoundScope(SCOPE_NAME);

  const derived = useMemo(
    () => (options.source === undefined ? djangoAudioSourceFor(childId) : options.source),
    [childId, options.source],
  );
  const scope = useMemo(() => ({ type: 'region', id: regionId }) as const, [regionId]);
  const manifest = useAudioManifest(derived, scope);

  const ambience = useMemo(() => createSoundSlot(player, { fadeMs: AMBIENCE_FADE_MS }), [player]);
  const music = useMemo(() => createTreasureRushMusic(player), [player]);

  // The first tap anywhere unlocks the browser's audio; idempotent and removed on exit.
  useEffect(() => manager.installGestureUnlock(), [manager]);

  // Own the slots for this visit. StrictMode runs this twice; the second run restores the state.
  useEffect(() => {
    ambience.activate();
    ambience.set(ambience.wanted ?? ENTRY_AMBIENCE);
    music.activate();
    return () => {
      ambience.deactivate();
      music.deactivate();
    };
  }, [ambience, music]);

  // Zones: the ambience follows the last zone entered. A zone with no ambience changes nothing.
  useEffect(
    () =>
      bus.on('PlayerEnteredZone', ({ zoneId }) => {
        const next = ambienceForZone(zoneId);
        if (next) ambience.set(next);
      }),
    [bus, ambience],
  );

  // Moments of play. One sink for the visit; the companion raises each moment once.
  useEffect(() => {
    const previous = setSoundSink((cue: SoundCue) => {
      if (cue === 'questComplete') music.playVictory();
      for (const soundId of CUE_SOUNDS[cue]) {
        void player.play(soundId).catch(() => undefined);
      }
    });
    return () => void setSoundSink(previous);
  }, [player, music]);

  // A manifest that arrives (or changes) after the game started gives waiting cues their audio.
  const { status, revision } = manifest;
  useEffect(() => {
    if (status !== 'ready') return;
    ambience.reapply();
    music.reapply();
  }, [status, revision, ambience, music]);

  return useMemo(
    () => ({ setPuzzleActive: (active: boolean) => music.setPuzzleActive(active) }),
    [music],
  );
}
