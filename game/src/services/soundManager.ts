/**
 * Sound Manager port. Mirrors the capabilities of the real Sound Manager
 * (`react/src/audio/SoundManager.ts`: play by cue id, stop, positional sounds, a listener
 * pose, channels) without importing it. The engine asks for cues by logical id; Django owns
 * cue assignments and the host resolves them to files.
 *
 * `play` never rejects: a cue that cannot play resolves to null (the real manager's contract).
 */

import { defineService } from '../core/services';

export type AudioChannel = 'music' | 'ambient' | 'sfx' | 'voice' | 'ui';

import type { Vec3 } from '../contracts/player';

export type { Vec3 };

export interface PlayCueOptions {
  volume?: number;
  loop?: boolean;
  fadeInMs?: number;
  /** Plays the cue from a registered spatial emitter. */
  emitterId?: string;
}

export interface CuePlayback {
  readonly cueId: string;
  stop(options?: { fadeOutMs?: number }): void;
}

export interface ListenerPose {
  position: Vec3;
  /** Forward direction (unit vector). */
  forward: Vec3;
}

export interface SoundManagerPort {
  play(cueId: string, options?: PlayCueOptions): Promise<CuePlayback | null>;
  stop(cueId: string, options?: { fadeOutMs?: number }): void;
  stopAll(options?: { fadeOutMs?: number }): void;
  /** Registers (or moves) a positional emitter by semantic id. */
  setEmitter(emitterId: string, position: Vec3): void;
  removeEmitter(emitterId: string): void;
  /** Tells positional sounds where the camera is. Cheap; called every frame. */
  setListener(pose: ListenerPose): void;
}

export const SOUND_MANAGER = defineService<SoundManagerPort>('lai.soundManager');

export interface FakeSoundManager extends SoundManagerPort {
  /** Cue ids in play order. */
  readonly played: string[];
  readonly stopped: string[];
  readonly emitters: ReadonlyMap<string, Vec3>;
  readonly listener: ListenerPose | null;
}

export function createFakeSoundManager(): FakeSoundManager {
  const played: string[] = [];
  const stopped: string[] = [];
  const emitters = new Map<string, Vec3>();
  let listener: ListenerPose | null = null;
  return {
    played,
    stopped,
    emitters,
    get listener() {
      return listener;
    },
    async play(cueId, options) {
      if (options?.emitterId !== undefined && !emitters.has(options.emitterId)) {
        return null; // like the real manager: a sound that cannot play yields null
      }
      played.push(cueId);
      return { cueId, stop: () => void stopped.push(cueId) };
    },
    stop(cueId) {
      stopped.push(cueId);
    },
    stopAll() {
      stopped.push('*');
    },
    setEmitter(emitterId, position) {
      emitters.set(emitterId, { ...position });
    },
    removeEmitter(emitterId) {
      emitters.delete(emitterId);
    },
    setListener(pose) {
      listener = pose;
    },
  };
}
