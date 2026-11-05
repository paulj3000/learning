import { useEffect, type ReactNode } from 'react';
import { getSharedSoundManager } from '../sharedSoundManager';
import type { SoundManager } from '../AudioTypes';
import { SoundManagerContext } from './SoundManagerContext';

export interface SoundProviderProps {
  /** Defaults to the page-wide shared manager. Pass your own in tests. */
  manager?: SoundManager;
  /** Unlock audio on the first tap, click or key press. Default true. */
  unlockOnGesture?: boolean;
  children: ReactNode;
}

/**
 * Makes one Sound Manager available to the tree. It never disposes the
 * manager: the manager outlives components, and a StrictMode remount would
 * otherwise find it closed. The only effect is installing and removing the
 * gesture listeners, both idempotent.
 */
export function SoundProvider({ manager, unlockOnGesture = true, children }: SoundProviderProps) {
  const active = manager ?? getSharedSoundManager();

  useEffect(() => {
    if (!unlockOnGesture) return undefined;
    return active.installGestureUnlock();
  }, [active, unlockOnGesture]);

  return <SoundManagerContext.Provider value={active}>{children}</SoundManagerContext.Provider>;
}
