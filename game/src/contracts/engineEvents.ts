/**
 * Presentation events the engine emits on its runtime bus: for sound, animation, HUD and
 * diagnostics only. Nothing about progress depends on them (that is `gameplayEvents.ts`).
 *
 * The names and payloads match the island-map runtime's `WorldEngineEventMap`
 * (`react/src/features/island-map/three/worldEngineEvents.ts`) for every event both define,
 * so a host can forward one to the other unchanged during migration. A test in that
 * directory keeps them identical (`engineEventParity.test.ts`).
 */

import type { PlayerGait } from './player';

export type RecoveryReason = 'FELL_OUT_OF_WORLD' | 'LEFT_PLAYABLE_AREA' | 'INVALID_POSITION' | 'HAZARD';

export type EnginePresentationEventMap = {
  PlayerJumped: { airJump: boolean };
  PlayerLanded: { impactSpeed: number };
  PlayerGaitChanged: { gait: PlayerGait };
  PlayerFootstep: { gait: Exclude<PlayerGait, 'idle'> };
  /** `hazardId` names the hazard that sent the child back (Firepeak requirement 7), when one did. */
  PlayerRecovered: { reason: RecoveryReason; checkpointId?: string | null; hazardId?: string | null };
  PlayerEnteredZone: { zoneId: string };
  PlayerLeftZone: { zoneId: string };
  CourseCheckpointReached: { checkpointId: string; label: string };
  PlatformGoalReached: { goalId: string };
  PlayerBounced: { platformId: string; cue?: string };
  PressurePlatePressed: { plateId: string };
  PressurePlateReleased: { plateId: string };
};

export type EnginePresentationEventName = keyof EnginePresentationEventMap;
