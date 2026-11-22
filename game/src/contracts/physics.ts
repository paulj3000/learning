/**
 * Physics provider and environment ports.
 *
 * The engine's collision model is the shared controller's: axis-aligned boxes in one live
 * collider list, solid by default, jumpable only where authored (ADR-063, ADR-059, ADR-060).
 * `PhysicsProvider` names that model as an interface so gameplay components (doors that open,
 * platforms that move, bridges that appear) and the camera (boom collision) use one API, and
 * so a different provider could be swapped in later. **No physics dependency is added**: the
 * default provider is the existing AABB model (`../physics/aabbProvider.ts`). A library-backed
 * provider would need an ADR and owner approval (jumping standard: "Do not add one without an
 * ADR").
 *
 * `EnvironmentQuery` is how movement learns about the world under the feet (surface friction,
 * ice, water, ladders) and around the body (wind, currents) without knowing which component
 * authored it. Gameplay volume components provide it; movement consumes it.
 */

import { defineService } from '../core/services';
import type { Vec3Like } from './player';

export type ColliderKind =
  /**
   * Blocks at every height (walls, gates, boundaries). The default. A raised one keeps its
   * height and leaves the space under it open only with walk-under clearance (the avatar's
   * collision height plus `movement.collision.clearanceMargin`); otherwise it blocks down to
   * the ground (GE-L16, `movement/clearance.ts`). Never stepped or jumped onto.
   */
  | 'SOLID'
  /** Blocks only where it is in height; can be stood on and jumped over (crates, platforms). */
  | 'JUMPABLE'
  /** Never blocks; reports overlap (zones, checkpoints, hazards). Entered by x/z. */
  | 'TRIGGER';

export interface ColliderSpec {
  /** Semantic id, unique within the provider. */
  readonly id: string;
  readonly kind: ColliderKind;
  readonly min: Readonly<Vec3Like>;
  readonly max: Readonly<Vec3Like>;
  /**
   * A gate (a locked door, quest barrier, boundary or broken bridge). Gates are never jumpable:
   * a gate collider of kind `JUMPABLE` is rejected (jumping standard, "Gates are never jumpable").
   */
  readonly gate?: boolean;
  /** Ignored by camera collision (invisible world boundaries; Treasure Rush camera fix). */
  readonly cameraIgnores?: boolean;
  /** Surface profile id for the top face (ice, mud, sand). */
  readonly surfaceId?: string;
}

export interface RayHit {
  colliderId: string;
  distance: number;
  point: Vec3Like;
}

export interface PhysicsProvider {
  /** Provider id, e.g. `lai.aabb`. Recorded in diagnostics. */
  readonly id: string;
  addCollider(spec: ColliderSpec): void;
  /** Moves or resizes a collider in place (moving platforms, opening doors). */
  updateCollider(id: string, min: Readonly<Vec3Like>, max: Readonly<Vec3Like>): void;
  removeCollider(id: string): boolean;
  hasCollider(id: string): boolean;
  getCollider(id: string): ColliderSpec | undefined;
  colliders(): readonly ColliderSpec[];
  /** Nearest hit along a ray, skipping colliders `filter` rejects. Triggers never hit. */
  raycast(
    origin: Readonly<Vec3Like>,
    direction: Readonly<Vec3Like>,
    maxDistance: number,
    filter?: (spec: ColliderSpec) => boolean,
  ): RayHit | null;
  /** Ids of colliders (any kind) whose box overlaps the given box. */
  overlaps(min: Readonly<Vec3Like>, max: Readonly<Vec3Like>): string[];
  /** Subscribe to collider list changes (the controller rebuilds its live arrays). */
  onChange(listener: () => void): () => void;
}

export const PhysicsProviderService = defineService<PhysicsProvider>('engine.physics');

// --- environment -------------------------------------------------------------------------

/** How a surface changes ground movement. Multipliers are relative to the location's tuning. */
export interface SurfaceProfile {
  readonly id: string;
  /**
   * 0 to 1: how much grip the feet have. 1 is normal ground; ice is low. Scales acceleration
   * and deceleration (so the child keeps sliding on ice), never the top speed.
   */
  readonly friction: number;
  /** 0.5 to 1.5: top-speed multiplier (mud slows, a boardwalk does not). */
  readonly speedMultiplier: number;
  /** Footstep sound family for the Sound Manager (`sfx.footstep.<id>`), optional. */
  readonly footstepCue?: string;
}

export const DEFAULT_SURFACE: SurfaceProfile = Object.freeze({
  id: 'ground',
  friction: 1,
  speedMultiplier: 1,
});

export type ExternalForceKind = 'WIND' | 'CURRENT' | 'CONVEYOR' | 'UPDRAFT';

/** A steady push on the body, as an acceleration in m/s². Movement sums the forces it is in. */
export interface ExternalForce {
  readonly id: string;
  readonly kind: ExternalForceKind;
  readonly acceleration: Readonly<Vec3Like>;
  /** Whether the force applies on the ground as well as in the air. Default true. */
  readonly affectsGrounded?: boolean;
}

export type Medium = 'AIR' | 'WATER';

export interface ClimbableInfo {
  readonly id: string;
  /** Top and bottom of the climbable, feet heights. */
  readonly bottomY: number;
  readonly topY: number;
  /** Where the climber faces (toward the ladder), radians. */
  readonly facingYaw: number;
  /** Where climbing off the top puts the feet. */
  readonly exitTop: Readonly<Vec3Like>;
}

export interface EnvironmentQuery {
  surfaceAt(x: number, y: number, z: number): SurfaceProfile;
  forcesAt(x: number, y: number, z: number): readonly ExternalForce[];
  mediumAt(x: number, y: number, z: number): Medium;
  /** Water surface height at x/z, when the point is in water. */
  waterSurfaceAt(x: number, z: number): number | null;
  climbableAt(x: number, y: number, z: number): ClimbableInfo | null;
}

/** An environment with normal ground, no forces, no water and nothing to climb. */
export const NEUTRAL_ENVIRONMENT: EnvironmentQuery = Object.freeze({
  surfaceAt: () => DEFAULT_SURFACE,
  forcesAt: () => [],
  mediumAt: () => 'AIR' as const,
  waterSurfaceAt: () => null,
  climbableAt: () => null,
});

export const EnvironmentQueryService = defineService<EnvironmentQuery>('engine.environment');
