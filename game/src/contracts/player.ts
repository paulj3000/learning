/**
 * The canonical player transform.
 *
 * One source of truth for where the child is: movement **writes** it once per simulation
 * step, and collision, camera, animation, audio and gameplay components **read** it. Nothing
 * else moves the player. This is the rule that fixed avatar drift when blocked (the avatar
 * mirrors the controller and never applies root motion of its own) and wall penetration (the
 * camera and avatar follow the collided position, never a desired one). See
 * `docs/engineering/game-engine/architecture.md`, "Canonical player transform".
 *
 * Units: metres, radians, seconds. `position.y` is the height of the child's **feet** (0 on
 * flat ground), as in the shared controller.
 */

import { defineComponent } from '../core/entities';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The engine's one plain 3D vector type (an alias, so every module shares the same symbol). */
export type Vec3 = Vec3Like;

/** How the player moves over the ground, for animation, sound and the HUD. */
export type PlayerGait = 'idle' | 'walk' | 'run' | 'sprint';

/** What the body is doing (the shared controller's `MovementState`, plus climbing and swimming). */
export type PlayerMovementState =
  | 'IDLE'
  | 'WALK'
  | 'RUN'
  | 'SPRINT'
  | 'JUMP_START'
  | 'AIRBORNE'
  | 'FALLING'
  | 'LANDING'
  | 'CLIMBING'
  | 'SWIMMING'
  | 'SLIDING';

export const PLAYER_MOVEMENT_STATES: readonly PlayerMovementState[] = Object.freeze([
  'IDLE',
  'WALK',
  'RUN',
  'SPRINT',
  'JUMP_START',
  'AIRBORNE',
  'FALLING',
  'LANDING',
  'CLIMBING',
  'SWIMMING',
  'SLIDING',
]);

export interface PlayerTransform {
  /** Feet position after collision (never a desired, uncollided position). */
  readonly position: Readonly<Vec3Like>;
  /** The position one simulation step ago, for render interpolation. */
  readonly previousPosition: Readonly<Vec3Like>;
  /**
   * Facing, radians about +Y, in the shared controller's convention: 0 looks down **+Z**. A
   * Three.js object facing the same way has `rotation.y = yaw + Math.PI` (camera/yaw.ts).
   */
  readonly yaw: number;
  /** Look pitch, radians (camera only; the body never pitches). */
  readonly pitch: number;
  /** Velocity actually achieved this step, m/s (zero into a wall: no drift). */
  readonly velocity: Readonly<Vec3Like>;
  readonly grounded: boolean;
  readonly state: PlayerMovementState;
  readonly gait: PlayerGait;
  /** The collider id the player stands on, when it is one (a platform, a crate). */
  readonly supportId: string | null;
}

/** The ECS component holding the canonical transform on the player entity. */
export const PlayerTransformComponent = defineComponent<PlayerTransform>('player.transform');

/** The player entity's semantic id. There is one player per runtime. */
export const PLAYER_ENTITY_ID = 'player';

export function createPlayerTransform(position: Vec3Like = { x: 0, y: 0, z: 0 }, yaw = 0): PlayerTransform {
  return Object.freeze({
    position: Object.freeze({ ...position }),
    previousPosition: Object.freeze({ ...position }),
    yaw,
    pitch: 0,
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    grounded: true,
    state: 'IDLE' as const,
    gait: 'idle' as const,
    supportId: null,
  });
}

/** Linear interpolation between the previous and current positions, for rendering. */
export function interpolatePlayerPosition(transform: PlayerTransform, alpha: number): Vec3Like {
  const a = Math.min(Math.max(alpha, 0), 1);
  const p = transform.previousPosition;
  const c = transform.position;
  return { x: p.x + (c.x - p.x) * a, y: p.y + (c.y - p.y) * a, z: p.z + (c.z - p.z) * a };
}
