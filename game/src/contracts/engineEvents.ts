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

/** How a platform or hazard warns the child: a blink, or a steady dim under reduced motion. */
export type SteadyOrBlink = 'BLINK' | 'STEADY_DIM';

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
  /** GE-066: a telegraphed hazard changed phase. `steadyWarning` is true under reduced motion. */
  HazardTelegraph: { hazardId: string; phase: 'WARN' | 'ACTIVE' | 'REST'; secondsToImpact: number; steadyWarning: boolean };
  /** GE-066: an engine platform changed phase (crumble, blink, gone, back). */
  PlatformPhaseChanged: { platformId: string; phase: string; warning: SteadyOrBlink | null };
  /**
   * GE-069: a moving platform's activation turned on (at start when it has no `activeSignalId`),
   * it left a pause or the start, and it arrived and paused or stopped. Same names, payloads and
   * semantics as the live platform system, so a host's platform sounds work for either runtime.
   * `cue` is the platform's own sound cue (`sounds.activated`, `.moving`, `.stopped`), if any.
   */
  PlatformActivated: { platformId: string; cue?: string };
  PlatformMoving: { platformId: string; cue?: string };
  PlatformStopped: { platformId: string; cue?: string };
  /** GE-066: the child stepped on a surface; `footstepCue` is the surface's own sound cue, if any. */
  SurfaceFootstep: { surfaceId: string; footstepCue: string | null };
};

export type EnginePresentationEventName = keyof EnginePresentationEventMap;
