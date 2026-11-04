import { useEffect, useRef } from 'react';
import { audioSettingsApiFor, type AudioSettingsApi } from '../../api/audio/audioSettingsApi';
import { useSoundManager } from '../react/hooks';
import { createPreferenceSync, type PreferenceSync } from './AudioPreferencesSync';

interface Held {
  childId: string;
  sync: PreferenceSync;
  disposeTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface UseChildAudioPreferencesOptions {
  /** Tests pass their own; the default is the Django API for the child. */
  apiFor?: (childId: string) => AudioSettingsApi | null;
  debounceMs?: number;
}

/**
 * Loads the child's saved audio mix into the shared Sound Manager and saves their changes, for as
 * long as `childId` is set (SM-P5). Mount it once, above the games, so the mix follows the child
 * from adventure to adventure and a scene being disposed never resets it. A different `childId`
 * (or `null`) disposes the old child's sync, which resets the manager first.
 *
 * StrictMode: the simulated unmount only schedules disposal; the immediate remount cancels it and
 * reuses the same sync, so there is one request, not two.
 */
export function useChildAudioPreferences(
  childId: string | null,
  options: UseChildAudioPreferencesOptions = {},
): void {
  const manager = useSoundManager();
  const held = useRef<Held | null>(null);
  const apiFor = options.apiFor ?? audioSettingsApiFor;
  const { debounceMs } = options;

  useEffect(() => {
    if (!childId) return undefined;
    let current = held.current;
    if (current && current.childId === childId) {
      clearTimeout(current.disposeTimer);
      current.disposeTimer = undefined;
    } else {
      current?.sync.dispose();
      const sync = createPreferenceSync({ manager, api: apiFor(childId), debounceMs });
      current = { childId, sync, disposeTimer: undefined };
      held.current = current;
      void sync.start();
    }
    const mine = current;
    return () => {
      mine.disposeTimer = setTimeout(() => {
        mine.sync.dispose();
        if (held.current === mine) held.current = null;
      }, 0);
    };
  }, [childId, manager, apiFor, debounceMs]);
}
