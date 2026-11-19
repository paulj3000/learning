import type { Box3 } from 'three';
import type { EnvironmentQuery, Vec3Like } from '@lai/game-engine/contracts';
import type { JsonValue } from '../../island-map/three/runtime/locationManifest';
import type { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';

/**
 * GE-065: what the engine bridge needs from the live island-map location runtime
 * (`createLocationEngine`'s `WorldExtensionContext`).
 *
 * Today's `WorldExtensionContext` satisfies this structurally (the bridge mounts on it without a
 * cast). The three members marked "GE-070" are added to the host by the Treasure Rush session; on
 * a host without them the bridge runs degraded and says so in its diagnostics (never silently):
 *
 * - `addCollider` returning an id (and accepting `id` and `gate`). Without it, colliders are still
 *   added, but removing them may not work (the old host removes manifest colliders only).
 * - `playerState()`. Without it, the bridge reads `playerPosition()` (ground plane): feet at
 *   y = 0, always grounded, velocity from position deltas, no support id.
 * - `setEnvironment()`. Without it, surface traction, forces, water and ladders from
 *   `environment.volumes` cannot reach the child's movement.
 */
export interface LocationBridgeHost {
  readonly bus: WorldEngineEventBus;
  readonly config: { readonly [key: string]: JsonValue };
  readonly reducedMotion: boolean;
  /**
   * GE-070 contract: returns the collider id (the requested `id`, or one the host generates).
   * Ids starting with `derived:` are refused by the host; the bridge only uses `engine:` ids.
   * Re-adding an id replaces its box. Boxes are kept by reference, so moving one in place is
   * live. `gate: true` is never jumpable and blocks the camera like a wall. Today's host returns
   * nothing.
   */
  addCollider(box: Box3, options?: { jumpable?: boolean; id?: string; gate?: boolean }): string | void;
  removeCollider(id: string): boolean;
  /** Ground-plane position; the fallback when `playerState` is missing. */
  playerPosition(): { x: number; z: number };
  /** Puts the child back at a safe spot. GE-070: collision-checked on the host. Emits nothing. */
  teleportPlayer(x: number, z: number, yaw: number): void;
  onFrame(callback: (deltaSeconds: number) => void): () => void;
  /** Where the child is and which way they face (yaw for the fallback transform). */
  childPlacement?(): { x: number; z: number; yaw: number };
  /**
   * GE-070 contract: the controller's state after collision. `position` is the collided feet
   * position; `velocity` is (horizontal x, vertical, horizontal z) actually achieved; `yaw` uses
   * the controller convention (0 looks down +Z); `supportId` is the authored collider id, or the
   * platform id for platform boxes, or null.
   */
  playerState?(): BridgePlayerState;
  /** GE-070 contract: hands surfaces, forces, water and ladders to the live controller. */
  setEnvironment?(query: EnvironmentQuery | null): void;
}

export interface BridgePlayerState {
  position: Vec3Like;
  yaw: number;
  velocity: Vec3Like;
  grounded: boolean;
  supportId: string | null;
}

/** Which optional host features are present. Reported by the bridge's `api.support`. */
export interface BridgeHostSupport {
  playerState: boolean;
  setEnvironment: boolean;
}

export function hostSupport(host: LocationBridgeHost): BridgeHostSupport {
  return {
    playerState: typeof host.playerState === 'function',
    setEnvironment: typeof host.setEnvironment === 'function',
  };
}
