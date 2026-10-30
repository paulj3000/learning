import { useNpcApproachBridge } from './npcApproachBridge';
import { SANDBOX_NPC_ID, type WorldEngineEventBus } from './worldEngineEvents';

/**
 * The single React-level bridge from the Three.js event bus to real domain
 * code, per `docs/ROADMAP.md` Phase 31's "wired to trigger an existing
 * quest/adventure action without duplicating its business rule."
 *
 * Takes `noteCharacterMet` as a parameter rather than calling
 * `useExplorableWorld` itself, so the one call to that hook stays owned by
 * the view (same pattern `PirateBuilderBayWorldView.tsx` already uses),
 * instead of this hook triggering a second, redundant fetch. On success,
 * emits `NpcStateChanged` back onto the bus so the scene can react
 * (Phase 31's inbound-direction proof).
 *
 * A thin, sandbox-fixed wrapper around `useNpcApproachBridge` (extracted at
 * Phase 32 so Welcome Harbor's own NPC bridge does not duplicate this
 * effect) so this module's own tests and `ThreeSandboxWorldView.tsx` need no
 * changes.
 */
export function useSandboxBridge(
  bus: WorldEngineEventBus,
  noteCharacterMet: (npcId: string) => void,
): void {
  useNpcApproachBridge(bus, SANDBOX_NPC_ID, noteCharacterMet);
}
