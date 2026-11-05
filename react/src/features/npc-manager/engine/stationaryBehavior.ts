import type {
  BehaviorController,
  BehaviorControllerArgs,
  BehaviorFrame,
  BehaviorState,
  NpcEngineEvent,
  PlayerPose,
} from '../contracts/engine';

/**
 * The runtime's built-in behaviour controller (LAI-NPC-008): the NPC stands at home facing its
 * home yaw. With `facePlayer`, it turns toward a player within `FACE_PLAYER_DISTANCE` and back
 * home when they leave. Used for every placement unless a `BehaviorControllerFactory` (the
 * behaviour engine, `../behavior/`) is injected, and for any behaviour type it does not
 * understand. Reactions come from the spec's `reactions`. Pure logic, no Three.js objects.
 */

export const FACE_PLAYER_DISTANCE = 5;
/** Radians per second. */
export const TURN_SPEED = 4;

export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** One step from `from` toward `to`, at most `maxStep` radians, along the short way round. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const delta = angleDelta(from, to);
  if (Math.abs(delta) <= maxStep) return to;
  return from + Math.sign(delta) * maxStep;
}

/** The yaw (rotation about +Y) that makes a model facing +Z look from (x, z) at the target. */
export function yawToward(x: number, z: number, targetX: number, targetZ: number): number {
  return Math.atan2(targetX - x, targetZ - z);
}

export function createStationaryBehavior(args: BehaviorControllerArgs): BehaviorController {
  const { home, spec, placementKey } = args;
  const facePlayer = spec?.parameters.facePlayer === true;
  let yaw = home.yaw;
  let state: BehaviorState = 'idle';
  let pending: NpcEngineEvent[] = [];

  function setState(next: BehaviorState): void {
    if (next === state) return;
    state = next;
    pending.push({ type: 'npc.behavior_changed', placementKey, state });
  }

  return {
    update(deltaSeconds: number, player: PlayerPose | null): BehaviorFrame {
      if (state !== 'interrupted') {
        let target = home.yaw;
        if (facePlayer && player) {
          const distance = Math.hypot(player.x - home.x, player.z - home.z);
          if (distance <= FACE_PLAYER_DISTANCE && distance > 0.01) {
            target = yawToward(home.x, home.z, player.x, player.z);
          }
        }
        yaw = turnToward(yaw, target, TURN_SPEED * Math.max(0, deltaSeconds));
      }
      const events = pending;
      pending = [];
      return { x: home.x, z: home.z, yaw, locomotion: 'idle', events };
    },
    interrupt() {
      setState('interrupted');
    },
    resume() {
      setState('idle');
    },
    cancel() {
      setState('idle');
    },
    react(event) {
      return spec?.parameters.reactions?.[event] ?? null;
    },
    state: () => state,
    dispose() {
      pending = [];
    },
  };
}
