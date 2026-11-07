import { createDefaultSettings } from '../AudioChannels';
import type { SoundManager, SoundSettings } from '../AudioTypes';
import { toPatch, type AudioSettingsApi } from '../../api/audio/audioSettingsApi';

/**
 * Keeps one child's saved audio mix and the shared Sound Manager in step (SM-P5).
 *
 * The Sound Manager stays the only holder of live settings; this object only copies a saved mix
 * into it and saves what the child changes. One sync belongs to one child: it is created for a
 * child, disposed when the child changes or the child area is left, and a late answer for a
 * disposed sync does nothing, so a slow response can never overwrite a newer child's mix.
 *
 * - Starting resets the manager to the calm defaults, so one child's mix never carries over to
 *   the next on a shared device, then loads this child's mix from the server.
 * - A change the child makes before the load answers wins: the saved mix is not applied over it.
 * - Changes are saved after a short pause (a slider drag is one save), never during a load, and
 *   one save at a time. A failed load or save leaves the live mix as it is, never throws, and is
 *   not retried in a loop; the next change tries again.
 * - Remote settings applied here do not trigger a save.
 */

export interface PreferenceSyncOptions {
  manager: SoundManager;
  /** `null` (a build without the Django API): the mix is live only and nothing is loaded or saved. */
  api: AudioSettingsApi | null;
  debounceMs?: number;
  onError?(kind: 'load' | 'save'): void;
}

export type PreferenceSyncState = 'idle' | 'loading' | 'ready' | 'failed';

export interface PreferenceSync {
  readonly state: PreferenceSyncState;
  /** Resets to defaults and loads. Call once. */
  start(): Promise<void>;
  /** Saves any pending change, resets the manager to defaults and stops. Idempotent. */
  dispose(): void;
}

export const SAVE_DEBOUNCE_MS = 500;

const key = (settings: SoundSettings): string => JSON.stringify(toPatch(settings));

export function createPreferenceSync(options: PreferenceSyncOptions): PreferenceSync {
  const { manager, api } = options;
  const debounceMs = options.debounceMs ?? SAVE_DEBOUNCE_MS;
  const controller = new AbortController();

  let state: PreferenceSyncState = 'idle';
  let disposed = false;
  let started = false;
  let loaded = false;
  /** The last mix known to match the server (or the defaults before the first answer). */
  let saved = key(createDefaultSettings());
  let touched = false;
  let applying = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving = false;
  let saveAgain = false;
  let unsubscribe: (() => void) | undefined;

  const defaults = () => manager.applySettings(toPatch(createDefaultSettings()));

  function flush(): void {
    if (!api || disposed) return;
    if (saving) {
      saveAgain = true;
      return;
    }
    const snapshot = manager.getSettings();
    if (key(snapshot) === saved) return;
    saving = true;
    void api
      .save(snapshot, controller.signal)
      .then(() => {
        saved = key(snapshot);
      })
      .catch(() => {
        if (!disposed) options.onError?.('save');
      })
      .finally(() => {
        saving = false;
        if (saveAgain && !disposed) {
          saveAgain = false;
          schedule();
        }
      });
  }

  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      flush();
    }, debounceMs);
  }

  function onSettingsChange(): void {
    if (applying || disposed) return;
    if (key(manager.getSettings()) === saved) return;
    touched = true;
    // Nothing is saved until the server's mix has been read, or a save could overwrite it.
    if (loaded) schedule();
  }

  return {
    get state() {
      return state;
    },
    async start() {
      if (started || disposed || !api) return;
      started = true;
      state = 'loading';
      applying = true;
      try {
        defaults();
      } finally {
        applying = false;
      }
      unsubscribe = manager.subscribe(onSettingsChange);
      try {
        const remote = await api.get(controller.signal);
        if (disposed) return;
        loaded = true;
        if (touched) {
          // The child already moved a slider: keep that and save it over the old mix.
          schedule();
        } else {
          saved = key(remote);
          applying = true;
          try {
            manager.applySettings(toPatch(remote));
          } finally {
            applying = false;
          }
        }
        state = 'ready';
      } catch {
        if (disposed) return;
        // Unreadable or offline: play with the defaults, and let the next change save.
        loaded = true;
        state = 'failed';
        options.onError?.('load');
        if (touched) schedule();
      }
    },
    dispose() {
      if (disposed) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      // A change the child made just before leaving is saved best-effort, not lost.
      if (api && loaded && !saving && key(manager.getSettings()) !== saved) {
        const snapshot = manager.getSettings();
        void api.save(snapshot).catch(() => undefined);
      }
      disposed = true;
      controller.abort();
      unsubscribe?.();
      if (api && started) {
        applying = true;
        defaults();
      }
    },
  };
}
