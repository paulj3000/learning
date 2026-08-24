import { useEffect } from 'react';
import type { WorldEngineEventBus } from './worldEngineEvents';

/**
 * The generic React-level bridge from a Three.js scene's `NpcApproached`
 * event to the real domain write, extracted from `useSandboxBridge.ts`
 * (Phase 31) so Phase 32's Welcome Harbor region can wire its own NPC
 * without duplicating this effect. Takes `noteCharacterMet` as a parameter
 * rather than calling `useExplorableWorld` itself, so the one call to that
 * hook (or an equivalent direct read) stays owned by the view.
 */
export function useNpcApproachBridge(
  bus: WorldEngineEventBus,
  npcId: string,
  noteCharacterMet: (npcId: string) => void,
): void {
  useEffect(() => {
    return bus.on('NpcApproached', ({ entityId }) => {
      if (entityId !== npcId) return;
      noteCharacterMet(entityId);
      bus.emit('NpcStateChanged', { entityId, metByChild: true });
    });
  }, [bus, npcId, noteCharacterMet]);
}
