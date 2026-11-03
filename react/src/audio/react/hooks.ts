import { useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { getSharedSoundManager } from '../sharedSoundManager';
import type {
  PlayOptions,
  SoundHandle,
  SoundManager,
  SoundPlayer,
  SoundScope,
  SoundSettings,
  StopOptions,
  AudioStatus,
} from '../AudioTypes';
import { SoundManagerContext } from './SoundManagerContext';

/** The manager from the nearest `SoundProvider`, or the shared one when there is no provider. */
export function useSoundManager(): SoundManager {
  return useContext(SoundManagerContext) ?? getSharedSoundManager();
}

export interface UseSound extends SoundPlayer {
  playSound(soundId: string, options?: PlayOptions): void;
}

/**
 * Stable, fire-and-forget helpers. Identity never changes while the manager
 * does not, so using it in effect dependencies or memoized children is free.
 * Sounds started here belong to the app, not to this component; use
 * `useSoundScope` when they must stop on unmount.
 */
export function useSound(): UseSound {
  const manager = useSoundManager();
  return useMemo(
    () => ({
      play: (soundId, options) => manager.play(soundId, options),
      stop: (soundId, options) => manager.stop(soundId, options),
      stopAll: (options) => manager.stopAll(options),
      playSound: (soundId, options) => {
        void manager.play(soundId, options);
      },
    }),
    [manager],
  );
}

/** A scope handle that survives StrictMode's mount, cleanup, mount cycle. */
interface ReattachableScope extends SoundPlayer {
  attach(): void;
  detach(): void;
}

function createReattachableScope(manager: SoundManager, name: string): ReattachableScope {
  let scope: SoundScope | null = null;
  let attached = true; // usable from the first render; detached only by cleanup

  const current = (): SoundScope | null => {
    if (!attached) return null;
    if (!scope || scope.disposed) scope = manager.createScope(name);
    return scope;
  };

  return {
    play: (soundId: string, options?: PlayOptions): Promise<SoundHandle | null> =>
      current()?.play(soundId, options) ?? Promise.resolve(null),
    stop: (soundId: string, options?: StopOptions) => scope?.stop(soundId, options),
    stopAll: (options?: StopOptions) => scope?.stopAll(options),
    attach() {
      attached = true;
    },
    detach() {
      attached = false;
      scope?.dispose();
      scope = null;
    },
  };
}

/**
 * A player whose sounds stop when the component unmounts, and whose pending
 * loads are cancelled so nothing starts late. Safe under React StrictMode.
 * Use it for a game or scene component's music, ambience and effects.
 */
export function useSoundScope(name: string): SoundPlayer {
  const manager = useSoundManager();
  const scope = useMemo(() => createReattachableScope(manager, name), [manager, name]);

  useEffect(() => {
    scope.attach();
    return () => scope.detach();
  }, [scope]);

  return scope;
}

/** Mixer settings for a volume panel. Re-renders only when a setting or the status changes. */
export function useSoundSettings(): SoundSettings {
  const manager = useSoundManager();
  return useSyncExternalStore(manager.subscribe, manager.getSettings, manager.getSettings);
}

export function useAudioStatus(): AudioStatus {
  const manager = useSoundManager();
  return useSyncExternalStore(manager.subscribe, manager.getStatus, manager.getStatus);
}
