import type { AgeBandValue } from '../../child-profile/constants';
import type { MovementSpec } from './jumpConfiguration';
import type { PlayerCameraConfiguration } from './playerPresentation';
import { WALL_HEIGHT } from './sceneKit';

/**
 * Storykeeper Castle's engine profile (SC-JMP-01, SC-JMP-02, SC-JMP-18): everything the castle
 * asks of the shared movement engine, as data, in one place.
 *
 * There is no castle movement, physics, collision, camera or recovery code. The castle is a
 * consumer of the shared runtime (`createLocationEngine`, `FirstPersonController`,
 * `playerCamera.ts`, `platforms/`). This module is the castle's side of that contract: the
 * manifest reads its movement and camera from here, the movement audit
 * (`castleMovementAudit.engine.test.ts`) proves the shared runtime keeps the castle's rules with
 * these values, and the unified Game Engine Core (GE, core/gameengine) can take the castle over by
 * reading this profile instead of the castle's manifest internals. Nothing here is behaviour.
 *
 * Jumping is optional in the castle (owner direction 2026-11-18): no learning step, door,
 * page, reward or exit needs a jump. Every pad answer is also on the HUD card.
 */

/** How far above the wall top the ceiling slabs' undersides hang (they rest on the walls). */
export const CASTLE_CEILING_SLAB_OFFSET = 0.1;

/** The underside of the ceiling slabs at the castle's default 3 m walls. */
export const CASTLE_CEILING_UNDERSIDE = WALL_HEIGHT + CASTLE_CEILING_SLAB_OFFSET;

/** The highest top any castle platform may have, metres (`castlePlatforms.ts` enforces it). */
export const CASTLE_PLATFORM_TOP_CAP = 0.5;

/** How the castle returns a lost child. Shared runtime behaviour, named here so it can be checked. */
export type CastleRecoveryRule =
  /** Leaving the playable area, an invalid position or a fall: back to the last safe floor. */
  | 'LAST_SAFE_GROUND'
  /** A saved checkpoint the child returns to on the next visit (`discovery/checkpoints.ts`). */
  | 'SAVED_CHECKPOINT_ON_ENTRY';

export interface CastleEngineProfile {
  /** Handed to the shared controller unchanged (`manifest.movement`). */
  readonly movement: Readonly<{
    jump: Readonly<{ jumpHeight: number }>;
    locomotion: Readonly<{ runSpeed: number; sprintSpeed: number }>;
  }>;
  /** Handed to the shared third-person camera unchanged (`manifest.player.camera`). */
  readonly camera: Readonly<
    Pick<PlayerCameraConfiguration, 'distance' | 'minDistance' | 'maxDistance' | 'heightOffset'> & {
      maxHeight: number;
    }
  >;
  /** Rooms are flat: no stairs, no upper floors, no lifts, no bounce pads. */
  readonly flatFloors: true;
  /** Every wall, sealed passage and door frame is solid at every height; none is jumpable. */
  readonly wallsJumpable: false;
  /** Recovery moves the player only, never progress, items, pages or rewards. */
  readonly recovery: readonly CastleRecoveryRule[];
}

export const CASTLE_ENGINE_PROFILE: CastleEngineProfile = Object.freeze({
  /*
    A lower hop than outdoors (0.9 m) keeps the eye well under the 3.1 m ceiling slabs at the top
    of a jump, even from a 0.5 m pad; a gentler run and sprint keep a child from shooting through
    the narrow passages past what the story wants them to notice.
  */
  movement: Object.freeze({
    jump: Object.freeze({ jumpHeight: 0.9 }),
    locomotion: Object.freeze({ runSpeed: 4.8, sprintSpeed: 5.6 }),
  }),
  /*
    Indoor third-person camera: closer than outdoors so the child stays in view through archways,
    and capped under the ceiling slabs, so it never looks over a wall into a room the story has
    not opened yet.
  */
  camera: Object.freeze({
    distance: 2.6,
    minDistance: 1.2,
    maxDistance: 3.5,
    heightOffset: 1.45,
    maxHeight: 2.95,
  }),
  flatFloors: true,
  wallsJumpable: false,
  recovery: Object.freeze(['LAST_SAFE_GROUND', 'SAVED_CHECKPOINT_ON_ENTRY'] as const),
});

/** The castle's movement settings as the shared controller reads them. */
export function castleMovementSpec(): MovementSpec {
  const { jump, locomotion } = CASTLE_ENGINE_PROFILE.movement;
  return { jump: { ...jump }, locomotion: { ...locomotion } };
}

/**
 * SC-JMP-18: what moving around the castle asks of a child in each age band. Difficulty lives in
 * content (which platforms exist, how high), never in engine branches: the shared controller is
 * the same for every band. This table is the castle's statement of that content, checked against
 * the manifest by `castleEngineProfile.test.ts`. It adds no setting and changes no behaviour.
 */
export interface CastleBandMovement {
  /** `solid-pads`: low static pads to hop onto. `flat-markers`: floor plates, no colliders. */
  readonly platforms: 'solid-pads' | 'flat-markers';
  /** The highest surface a child of this band can stand on, metres. */
  readonly highestSurface: number;
  /** Whether any learning step, door, page or exit needs a jump. Always false. */
  readonly jumpRequiredForLearning: false;
  /** Whether any route the band needs has a hazard, a timer or a moving or vanishing platform. */
  readonly hazardsOrTimers: false;
  /** How a pad answers: standing still on it this long (a hop answers nothing), milliseconds. */
  readonly padDwellMs: number;
  /** The equivalent ways to give every pad answer. */
  readonly equivalentRoutes: readonly ('hud-card' | 'walk-in' | 'aim')[];
}

/** `usePadAnswers.PAD_DWELL_MS`, restated so this module stays free of React; a test keeps them equal. */
export const CASTLE_PAD_DWELL_MS = 700;

export const CASTLE_MOVEMENT_BY_BAND: Readonly<Record<AgeBandValue, CastleBandMovement>> =
  Object.freeze({
    SPROUT: Object.freeze({
      platforms: 'flat-markers',
      highestSurface: 0,
      jumpRequiredForLearning: false,
      hazardsOrTimers: false,
      padDwellMs: CASTLE_PAD_DWELL_MS,
      // Sprouts have no reticle (`noReticleBands`), so no aiming route.
      equivalentRoutes: Object.freeze(['hud-card', 'walk-in'] as const),
    }),
    PATHFINDER: Object.freeze({
      platforms: 'solid-pads',
      highestSurface: CASTLE_PLATFORM_TOP_CAP,
      jumpRequiredForLearning: false,
      hazardsOrTimers: false,
      padDwellMs: CASTLE_PAD_DWELL_MS,
      equivalentRoutes: Object.freeze(['hud-card', 'walk-in', 'aim'] as const),
    }),
    EXPLORER: Object.freeze({
      platforms: 'solid-pads',
      highestSurface: CASTLE_PLATFORM_TOP_CAP,
      jumpRequiredForLearning: false,
      hazardsOrTimers: false,
      padDwellMs: CASTLE_PAD_DWELL_MS,
      equivalentRoutes: Object.freeze(['hud-card', 'walk-in', 'aim'] as const),
    }),
  });
