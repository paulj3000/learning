import { createSoundManager, type SoundManagerOptions } from './SoundManager';
import type { SoundManager } from './AudioTypes';

/**
 * The application-wide manager: one per page, hence one `AudioContext`.
 * It is created on first use and lives for the page. React components never
 * dispose it (a StrictMode remount would otherwise find it closed); a game
 * that wants to stop its own audio uses a scope instead.
 */
let shared: SoundManager | undefined;

export function getSharedSoundManager(options?: SoundManagerOptions): SoundManager {
  if (!shared || shared.disposed) shared = createSoundManager(options);
  return shared;
}

/** Test seam: drops the shared manager (disposing it) so the next call builds a fresh one. */
export function resetSharedSoundManager(): void {
  shared?.dispose();
  shared = undefined;
}
