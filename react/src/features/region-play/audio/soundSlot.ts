import type { EndReason, SoundHandle, SoundPlayer } from '../../../audio';

/**
 * One place for one sound: Treasure Rush's ambience bed or its music. It keeps the invariant the
 * game cares about, "at most one of these is playing", on top of the shared Sound Manager.
 *
 * - Asking for what is already wanted does nothing, so a re-render never restarts a loop.
 * - A new request fades out the old sound and starts the new one.
 * - A start that finishes loading after it was replaced, or after `deactivate`, stops itself, so a
 *   late response can never bring audio back after the child has left.
 * - A cue that cannot play (not in the manifest, no asset, blocked) is not retried by itself. It
 *   is tried again only by `reapply`, which the game calls when a new manifest arrives.
 */
export interface SoundSlot {
  /** The cue the slot is meant to be playing, or `null`. */
  readonly wanted: string | null;
  /** Plays `soundId` (or nothing for `null`). The same id again is a no-op. */
  set(soundId: string | null): void;
  /** Tries the wanted cue again if it is not playing. Used when the manifest changes. */
  reapply(): void;
  /** Allows playback and starts the wanted cue. */
  activate(): void;
  /** Stops now and refuses late starts until `activate`. The wanted cue is remembered. */
  deactivate(): void;
}

export interface SoundSlotOptions {
  fadeMs: number;
  /** A sound that was playing ended by itself (or failed): not when this slot stopped it. */
  onEnded?(soundId: string, reason: EndReason): void;
  /** The wanted sound could not start (no definition, no asset, playback refused). */
  onUnavailable?(soundId: string): void;
}

export function createSoundSlot(player: SoundPlayer, options: SoundSlotOptions): SoundSlot {
  let wanted: string | null = null;
  let active = false;
  let generation = 0;
  let handle: SoundHandle | null = null;
  /** The id a start is in flight or finished for; cleared when it fails, so only `reapply` retries. */
  let attempted: string | null = null;

  function release(): void {
    const old = handle;
    handle = null;
    old?.stop({ fadeOutMs: options.fadeMs });
  }

  function start(): void {
    generation += 1;
    release();
    attempted = null;
    const id = wanted;
    if (!active || id === null) return;
    const mine = generation;
    attempted = id;
    void player
      .play(id, options.fadeMs > 0 ? { fadeInMs: options.fadeMs } : undefined)
      .then((started) => {
        if (mine !== generation) {
          started?.stop(); // replaced or deactivated while loading
          return;
        }
        if (!started) {
          attempted = null;
          options.onUnavailable?.(id);
          return;
        }
        handle = started;
        void started.whenEnded().then((reason) => {
          if (handle !== started) return;
          handle = null;
          attempted = null;
          if (reason === 'finished' || reason === 'failed') options.onEnded?.(id, reason);
        });
      })
      .catch(() => {
        if (mine === generation) attempted = null;
      });
  }

  return {
    get wanted() {
      return wanted;
    },
    set(soundId) {
      // The same id is a no-op; a cue that failed is retried by `reapply`, never by asking again.
      if (soundId === wanted) return;
      wanted = soundId;
      start();
    },
    reapply() {
      if (!active || wanted === null || handle !== null || attempted === wanted) return;
      start();
    },
    activate() {
      if (active) return;
      active = true;
      start();
    },
    deactivate() {
      active = false;
      generation += 1;
      attempted = null;
      const old = handle;
      handle = null;
      old?.stop();
    },
  };
}
