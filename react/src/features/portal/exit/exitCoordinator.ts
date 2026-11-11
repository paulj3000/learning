/**
 * "Leave island" never asks a question (AP-04). It only has two jobs before
 * it navigates: save what is still being saved, and, where something is
 * mid-way (an open encounter), offer a plain "are you sure" with no
 * challenge in it.
 *
 * Whatever is on screen registers an `ExitParticipant`. The coordinator
 * collects them and answers two questions for the shell:
 *
 * - `needsConfirm()`: does anything want a confirmation first?
 * - `saveAll()`: flush every participant. It **never rejects and never
 *   hangs**: a failing save is counted, and a slow one is abandoned after
 *   `timeoutMs`, because a child must never be stuck on an island waiting
 *   for the network. Progress the island already wrote as it happened (each
 *   checkpoint, find and adventure step) is unaffected either way.
 *
 * Pure: no React, no router, no timers except the one passed-in `setTimer`.
 */

export interface ExitParticipant {
  /** Flush anything not yet saved. May reject; the coordinator absorbs it. */
  save(): Promise<void>;
  /** True while leaving now would interrupt something (an open encounter). */
  needsConfirm?(): boolean;
}

export type ExitSaveResult =
  { status: 'saved' } | { status: 'partial'; failed: number; timedOut: boolean };

export interface ExitSaveOptions {
  timeoutMs?: number;
  /** Injected for tests; defaults to `setTimeout`. */
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface ExitCoordinator {
  register(participant: ExitParticipant): () => void;
  needsConfirm(): boolean;
  saveAll(options?: ExitSaveOptions): Promise<ExitSaveResult>;
  size(): number;
}

/** Long enough for an in-flight write on a slow tablet; short enough not to feel stuck. */
export const DEFAULT_EXIT_SAVE_TIMEOUT_MS = 2500;

export function createExitCoordinator(): ExitCoordinator {
  const participants = new Set<ExitParticipant>();

  return {
    register(participant) {
      participants.add(participant);
      return () => {
        participants.delete(participant);
      };
    },

    needsConfirm() {
      for (const participant of participants) {
        try {
          if (participant.needsConfirm?.()) return true;
        } catch {
          // A broken check must not block leaving; it just does not ask.
        }
      }
      return false;
    },

    size() {
      return participants.size;
    },

    async saveAll(options = {}) {
      const {
        timeoutMs = DEFAULT_EXIT_SAVE_TIMEOUT_MS,
        setTimer = (callback, ms) => setTimeout(callback, ms),
        clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      } = options;

      const saves = [...participants].map((participant) => {
        try {
          return participant.save();
        } catch (error) {
          return Promise.reject(error);
        }
      });
      if (saves.length === 0) return { status: 'saved' };

      let handle: unknown;
      const timeout = new Promise<'timeout'>((resolve) => {
        handle = setTimer(() => resolve('timeout'), timeoutMs);
      });
      const settled = Promise.allSettled(saves);
      const outcome = await Promise.race([settled, timeout]);
      clearTimer(handle);

      if (outcome === 'timeout') {
        return { status: 'partial', failed: 0, timedOut: true };
      }
      const failed = outcome.filter((result) => result.status === 'rejected').length;
      return failed === 0 ? { status: 'saved' } : { status: 'partial', failed, timedOut: false };
    },
  };
}

/**
 * Tracks fire-and-forget writes (a checkpoint save, a world change) so an
 * exit can wait for the ones still in flight. `track` returns the same
 * promise, so callers keep their own `.then`/`.catch` chains.
 */
export interface PendingWrites {
  track<T>(promise: Promise<T>): Promise<T>;
  settle(): Promise<void>;
  count(): number;
}

export function createPendingWrites(): PendingWrites {
  const pending = new Set<Promise<unknown>>();
  return {
    track(promise) {
      pending.add(promise);
      const forget = () => {
        pending.delete(promise);
      };
      promise.then(forget, forget);
      return promise;
    },
    async settle() {
      const results = await Promise.allSettled([...pending]);
      const failed = results.some((result) => result.status === 'rejected');
      if (failed) throw new Error('A save did not finish.');
    },
    count() {
      return pending.size;
    },
  };
}
