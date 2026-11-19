/**
 * Platforms: moving, rotating (turntable), falling (crumble then drop then respawn), bounce
 * and static or appearing, as JUMPABLE colliders in the shared physics provider.
 *
 * Non-negotiables (jumping standard):
 * - tops at least 0.8 m, speeds 0.2 to 4 m/s, at most 64 platforms per area;
 * - moving and falling platforms are **optional-route only** (`route: 'OPTIONAL'`), because
 *   required progress never needs a jump or a timed platform;
 * - reduced motion slows moving platforms and turntables to 60%, and the crumble warning is a
 *   steady dim instead of a blink;
 * - nothing is lost when a platform drops away: a fall only asks for recovery.
 *
 * Moving math is ported from react/src/features/island-map/three/platforms/platformMotion.ts
 * (see `pathMotion.ts`). The falling platform adds the "crumble then fall" option the Firepeak
 * requirements ask for; its warning/visible/hidden timings mirror `PlatformVanishSpec`
 * (platformSpec.ts) so existing authored data maps across.
 *
 * Carry: movement reads `PlatformsApi.carryVelocityAt(supportId, x, z)` for the velocity of the
 * platform under the child's feet, and `consumeLaunch()` for a pending bounce.
 */

import { defineComponent } from '../core/entities';
import { defineService } from '../core/services';
import type { CapabilityDefinition } from '../core/capabilities';
import { PhysicsProviderService } from '../contracts/physics';
import type { Vec3Like } from '../contracts/player';
import {
  emitPresentation,
  entityKey,
  isReducedMotion,
  playerPosition,
  playerSupportId,
  REDUCED_MOTION_SPEED_SCALE,
  signalBoard,
  type GameplayRuntime,
} from './common';
import { advanceMotion, createPathMotion, initialMotionState, motionOffset, type PathMotion, type PathMotionState, type PlatformPathMode } from './pathMotion';
import { configRoot, Issues, isRecord } from './validate';

export const PLATFORM_LIMITS = {
  /** The narrowest top a child must land on, metres. */
  minTop: 0.8,
  maxSize: 30,
  maxThickness: 10,
  minSpeed: 0.2,
  maxSpeed: 4,
  maxPause: 10,
  maxWaypoints: 16,
  maxPathReach: 60,
  minBounce: 0.5,
  maxBounce: 4,
  minVisible: 1.5,
  maxCycle: 60,
  maxSpin: 45,
  maxPlatforms: 64,
} as const;

export type PlatformRoute = 'REQUIRED' | 'OPTIONAL';
export type FallingPhase = 'STABLE' | 'CRUMBLING' | 'FALLING' | 'GONE';

export interface MovingSpec {
  /** Waypoint offsets from the rest position; the path starts at (0, 0, 0). */
  path: Vec3Like[];
  mode: PlatformPathMode;
  speed: number;
  pauseSeconds: number;
  /** The platform only moves while this signal is true (always when absent). */
  activeSignalId?: string;
  /** While inactive, head back to the start (otherwise stay where it is). */
  returnWhenInactive: boolean;
}

export interface FallingSpec {
  /** `TIMED`: on a fixed cycle. `STAND`: crumbles a while after the child steps on. */
  mode: 'TIMED' | 'STAND';
  /** Seconds it stays whole (for STAND: after the child steps on). The crumble warning is the end of it. At least 1.5. */
  visibleSeconds: number;
  /** Seconds it is gone before it returns. */
  hiddenSeconds: number;
  /** Seconds of crumbling warning before it drops. Default 1. */
  warningSeconds: number;
  /** Seconds the drop takes. Default 0.6. */
  fallSeconds: number;
  /** `TIMED` only: where in the cycle it starts, seconds. */
  offsetSeconds: number;
}

export interface PlatformSpec {
  id: string;
  /** Bottom centre of the platform, metres. */
  position: Vec3Like;
  size: Vec3Like;
  route: PlatformRoute;
  moving?: MovingSpec;
  /** A round turntable turning at this rate; carries a rider round its centre. */
  spinDegreesPerSecond?: number;
  falling?: FallingSpec;
  /** A bounce pad: landing throws the child up to about this height, metres. */
  bounceHeight?: number;
  /** Bounce cue id for the Sound Manager (presentation only). */
  bounceCue?: string;
  /** Not there until `activeSignalId` first goes true (an appearing bridge). */
  appearSignalId?: string;
}

export interface PlatformsConfig {
  platforms: PlatformSpec[];
}

// --- pure falling model ------------------------------------------------------------------

export interface FallingModel {
  spec: FallingSpec;
  phase: FallingPhase;
  /** Seconds in the current phase. */
  timer: number;
  /** STAND: the child has stepped on, so the countdown to crumbling runs. */
  armed: boolean;
  /** Metres dropped so far while FALLING (0 otherwise). */
  drop: number;
}

export const FALL_GRAVITY = 18;

export function createFallingModel(spec: FallingSpec): FallingModel {
  return { spec, phase: 'STABLE', timer: 0, armed: spec.mode === 'TIMED', drop: 0 };
}

/**
 * Advances the model. `canRespawn` is false while the child is where the platform would
 * return, so it never reappears around or under them. Returns the new phase on a change.
 */
export function stepFallingModel(model: FallingModel, dt: number, standing: boolean, canRespawn: boolean): FallingPhase | null {
  const { spec } = model;
  switch (model.phase) {
    case 'STABLE': {
      if (spec.mode === 'STAND' && standing) {
        model.armed = true;
      }
      if (!model.armed) {
        return null;
      }
      model.timer += dt;
      if (model.timer >= spec.visibleSeconds - spec.warningSeconds) {
        model.phase = 'CRUMBLING';
        model.timer = 0;
        return 'CRUMBLING';
      }
      return null;
    }
    case 'CRUMBLING':
      model.timer += dt;
      if (model.timer >= spec.warningSeconds) {
        model.phase = 'FALLING';
        model.timer = 0;
        model.drop = 0;
        return 'FALLING';
      }
      return null;
    case 'FALLING':
      model.timer += dt;
      model.drop = 0.5 * FALL_GRAVITY * Math.min(model.timer, spec.fallSeconds) ** 2;
      if (model.timer >= spec.fallSeconds) {
        model.phase = 'GONE';
        model.timer = 0;
        return 'GONE';
      }
      return null;
    case 'GONE':
      model.timer += dt;
      if (model.timer >= spec.hiddenSeconds && canRespawn) {
        model.phase = 'STABLE';
        model.timer = 0;
        model.drop = 0;
        model.armed = spec.mode === 'TIMED';
        return 'STABLE';
      }
      return null;
  }
}

/** TIMED platforms start part-way round their cycle: fast-forwards without emitting anything. */
export function fastForwardFalling(model: FallingModel, seconds: number): void {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) {
    stepFallingModel(model, step, false, true);
  }
}

// --- state -------------------------------------------------------------------------------

export interface PlatformState {
  spec: PlatformSpec;
  offset: Vec3Like;
  yaw: number;
  /** Velocity this step, m/s (what the child standing on it inherits). */
  carry: Vec3Like;
  motion?: { path: PathMotion; state: PathMotionState };
  falling?: FallingModel;
  hasCollider: boolean;
  /** Appearing platform: has been activated at least once. */
  appeared: boolean;
  /** Bounce platform: the child was on it last step. */
  wasOn: boolean;
}
export const PlatformComponent = defineComponent<PlatformState>('gameplay.platform');

export interface PlatformsApi {
  /** Velocity of a platform at a point on it (turntables turn about their centre). Zero if unknown. */
  carryVelocityAt(supportId: string | null, x: number, z: number): Vec3Like;
  /** A pending bounce launch height in metres (clears it), else null. */
  consumeLaunch(): { platformId: string; height: number } | null;
  /** Current top-surface centre of a platform, for presentation. */
  positionOf(platformId: string): Vec3Like | undefined;
  phaseOf(platformId: string): FallingPhase | undefined;
}
export const PlatformsService = defineService<PlatformsApi>('gameplay.platforms');

// --- validation --------------------------------------------------------------------------

export function validatePlatformsConfig(input: unknown) {
  const issues = new Issues();
  const root = configRoot(input, issues);
  const platforms = issues.records(
    root.platforms,
    'platforms',
    (item, path): PlatformSpec => {
      const id = issues.id(item.id, `${path}.id`);
      const size = issues.vec3(item.size, `${path}.size`, PLATFORM_LIMITS.maxSize);
      if (Math.min(size.x, size.z) < PLATFORM_LIMITS.minTop) {
        issues.add(`${path}.size`, `the top must be at least ${PLATFORM_LIMITS.minTop} m on each side`);
      }
      if (size.y <= 0 || size.y > PLATFORM_LIMITS.maxThickness) {
        issues.add(`${path}.size.y`, `thickness must be above 0 and at most ${PLATFORM_LIMITS.maxThickness} m`);
      }
      const spec: PlatformSpec = {
        id,
        position: issues.vec3(item.position, `${path}.position`),
        size,
        route: issues.oneOf<PlatformRoute>(item.route, `${path}.route`, ['REQUIRED', 'OPTIONAL'], 'REQUIRED'),
        appearSignalId: issues.optionalId(item.appearSignalId, `${path}.appearSignalId`),
      };
      if (item.moving !== undefined) {
        spec.moving = readMoving(item.moving, `${path}.moving`, issues);
        if (spec.route !== 'OPTIONAL') {
          issues.add(`${path}.route`, 'a moving platform must be on an optional route (required progress never needs one)');
        }
      }
      if (item.spinDegreesPerSecond !== undefined) {
        spec.spinDegreesPerSecond = issues.num(item.spinDegreesPerSecond, `${path}.spinDegreesPerSecond`, -PLATFORM_LIMITS.maxSpin, PLATFORM_LIMITS.maxSpin);
      }
      if (item.falling !== undefined) {
        spec.falling = readFalling(item.falling, `${path}.falling`, issues);
        if (spec.route !== 'OPTIONAL') {
          issues.add(`${path}.route`, 'a falling platform must be on an optional route (required progress never needs one)');
        }
        if (item.moving !== undefined) {
          issues.add(`${path}.falling`, 'a platform cannot both move and fall');
        }
      }
      if (item.bounceHeight !== undefined) {
        spec.bounceHeight = issues.num(item.bounceHeight, `${path}.bounceHeight`, PLATFORM_LIMITS.minBounce, PLATFORM_LIMITS.maxBounce);
        spec.bounceCue = typeof item.bounceCue === 'string' ? item.bounceCue : undefined;
      }
      return spec;
    },
    (p) => p.id,
    PLATFORM_LIMITS.maxPlatforms,
  );
  return issues.result<PlatformsConfig>({ platforms });
}

function readMoving(value: unknown, path: string, issues: Issues): MovingSpec {
  const item = isRecord(value) ? value : {};
  if (!isRecord(value)) {
    issues.add(path, 'must be an object');
  }
  const rawPath = Array.isArray(item.path) ? item.path : [];
  if (rawPath.length < 1 || rawPath.length > PLATFORM_LIMITS.maxWaypoints) {
    issues.add(`${path}.path`, `needs 1 to ${PLATFORM_LIMITS.maxWaypoints} waypoints`);
  }
  const points = rawPath.slice(0, PLATFORM_LIMITS.maxWaypoints).map((p, i) => issues.vec3(p, `${path}.path[${i}]`, PLATFORM_LIMITS.maxPathReach));
  return {
    path: points,
    mode: issues.oneOf<PlatformPathMode>(item.mode, `${path}.mode`, ['PING_PONG', 'LOOP', 'ONCE'], 'PING_PONG'),
    speed: issues.num(item.speed, `${path}.speed`, PLATFORM_LIMITS.minSpeed, PLATFORM_LIMITS.maxSpeed),
    pauseSeconds: issues.num(item.pauseSeconds, `${path}.pauseSeconds`, 0, PLATFORM_LIMITS.maxPause, 1),
    activeSignalId: issues.optionalId(item.activeSignalId, `${path}.activeSignalId`),
    returnWhenInactive: issues.bool(item.returnWhenInactive, `${path}.returnWhenInactive`, false),
  };
}

function readFalling(value: unknown, path: string, issues: Issues): FallingSpec {
  const item = isRecord(value) ? value : {};
  if (!isRecord(value)) {
    issues.add(path, 'must be an object');
  }
  const warningSeconds = issues.num(item.warningSeconds, `${path}.warningSeconds`, 0.5, 5, 1);
  const visibleSeconds = issues.num(item.visibleSeconds, `${path}.visibleSeconds`, PLATFORM_LIMITS.minVisible, PLATFORM_LIMITS.maxCycle);
  if (visibleSeconds < warningSeconds + 0.5) {
    issues.add(`${path}.visibleSeconds`, 'must leave at least 0.5 s whole before the crumble warning');
  }
  return {
    mode: issues.oneOf<'TIMED' | 'STAND'>(item.mode, `${path}.mode`, ['TIMED', 'STAND'], 'STAND'),
    visibleSeconds,
    hiddenSeconds: issues.num(item.hiddenSeconds, `${path}.hiddenSeconds`, 0.5, PLATFORM_LIMITS.maxCycle),
    warningSeconds,
    fallSeconds: issues.num(item.fallSeconds, `${path}.fallSeconds`, 0.2, 3, 0.6),
    offsetSeconds: issues.num(item.offsetSeconds, `${path}.offsetSeconds`, 0, PLATFORM_LIMITS.maxCycle, 0),
  };
}

// --- helpers -----------------------------------------------------------------------------

function boxFor(state: PlatformState) {
  const { spec, offset } = state;
  const y = spec.position.y + offset.y - (state.falling?.drop ?? 0);
  const cx = spec.position.x + offset.x;
  const cz = spec.position.z + offset.z;
  return {
    min: { x: cx - spec.size.x / 2, y, z: cz - spec.size.z / 2 },
    max: { x: cx + spec.size.x / 2, y: y + spec.size.y, z: cz + spec.size.z / 2 },
  };
}

function isStandingOn(state: PlatformState, player: Vec3Like, supportId: string | null): boolean {
  if (supportId === state.spec.id) {
    return true;
  }
  const box = boxFor(state);
  return player.x >= box.min.x && player.x <= box.max.x && player.z >= box.min.z && player.z <= box.max.z && Math.abs(player.y - box.max.y) <= 0.2;
}

function playerInsideFootprint(state: PlatformState, player: Vec3Like): boolean {
  const box = boxFor(state);
  const clearance = 0.45;
  return (
    player.x >= box.min.x - clearance &&
    player.x <= box.max.x + clearance &&
    player.z >= box.min.z - clearance &&
    player.z <= box.max.z + clearance &&
    player.y < box.max.y &&
    player.y + 1.7 > box.min.y
  );
}

export const PLATFORMS_CAPABILITY_ID = 'gameplay.platforms';

export const platformsCapability: CapabilityDefinition<PlatformsConfig, GameplayRuntime> = {
  id: PLATFORMS_CAPABILITY_ID,
  version: '1.0.0',
  description: 'Moving, rotating, falling and bounce platforms with carry velocity, reduced-motion scaling and limits.',
  defaults: { platforms: [] },
  validate: validatePlatformsConfig,
  install(runtime, config) {
    const { world } = runtime;
    const physics = runtime.services.require(PhysicsProviderService);
    const signals = signalBoard(runtime);
    let launch: { platformId: string; height: number } | null = null;

    const phaseEvent = (state: PlatformState, phase: string) => {
      const warning = phase === 'CRUMBLING' ? (isReducedMotion(runtime) ? ('STEADY_DIM' as const) : ('BLINK' as const)) : null;
      emitPresentation(runtime, 'PlatformPhaseChanged', { platformId: state.spec.id, phase, warning });
    };
    const addCollider = (state: PlatformState) => {
      const box = boxFor(state);
      physics.addCollider({ id: state.spec.id, kind: 'JUMPABLE', min: box.min, max: box.max });
      state.hasCollider = true;
    };
    const removeCollider = (state: PlatformState) => {
      if (state.hasCollider) {
        physics.removeCollider(state.spec.id);
        state.hasCollider = false;
      }
    };

    for (const spec of config.platforms) {
      const state: PlatformState = {
        spec,
        offset: { x: 0, y: 0, z: 0 },
        yaw: 0,
        carry: { x: 0, y: 0, z: 0 },
        hasCollider: false,
        appeared: spec.appearSignalId === undefined,
        wasOn: false,
      };
      if (spec.moving) {
        state.motion = { path: createPathMotion(spec.moving.path, spec.moving.mode, spec.moving.pauseSeconds), state: initialMotionState() };
      }
      if (spec.falling) {
        state.falling = createFallingModel(spec.falling);
        if (spec.falling.mode === 'TIMED' && spec.falling.offsetSeconds > 0) {
          fastForwardFalling(state.falling, spec.falling.offsetSeconds);
        }
      }
      world.add(world.create(entityKey('platform', spec.id)), PlatformComponent, state);
      const solidNow = state.appeared && state.falling?.phase !== 'FALLING' && state.falling?.phase !== 'GONE';
      if (solidNow) {
        addCollider(state);
      }
    }

    const find = (id: string) => {
      const entity = world.bySemanticId(entityKey('platform', id));
      return entity === undefined ? undefined : world.get(entity, PlatformComponent);
    };
    const api: PlatformsApi = {
      carryVelocityAt(supportId, x, z) {
        const state = supportId ? find(supportId) : undefined;
        if (!state) {
          return { x: 0, y: 0, z: 0 };
        }
        const carry = { ...state.carry };
        if (state.spec.spinDegreesPerSecond) {
          const rate = (state.spec.spinDegreesPerSecond * Math.PI) / 180 * (isReducedMotion(runtime) ? REDUCED_MOTION_SPEED_SCALE : 1);
          const cx = state.spec.position.x + state.offset.x;
          const cz = state.spec.position.z + state.offset.z;
          // Tangential velocity of a point at (x - cx, z - cz) turning at `rate` about +Y.
          carry.x += rate * (z - cz);
          carry.z -= rate * (x - cx);
        }
        return carry;
      },
      consumeLaunch() {
        const out = launch;
        launch = null;
        return out;
      },
      positionOf(id) {
        const state = find(id);
        if (!state) {
          return undefined;
        }
        const box = boxFor(state);
        return { x: (box.min.x + box.max.x) / 2, y: box.max.y, z: (box.min.z + box.max.z) / 2 };
      },
      phaseOf: (id) => find(id)?.falling?.phase,
    };
    const removeService = runtime.services.provide(PlatformsService, api);

    runtime.systems.add({
      id: 'gameplay.platforms',
      phase: 'simulation',
      order: -10,
      update(context) {
        const player = playerPosition(runtime);
        const support = playerSupportId(runtime);
        const scale = isReducedMotion(runtime) ? REDUCED_MOTION_SPEED_SCALE : 1;
        for (const entity of world.query(PlatformComponent)) {
          const state = world.get(entity, PlatformComponent)!;
          const { spec } = state;
          const before = { ...state.offset };

          if (!state.appeared && spec.appearSignalId && signals.get(spec.appearSignalId)) {
            state.appeared = true;
            if (!state.hasCollider) {
              addCollider(state);
            }
            phaseEvent(state, 'APPEARED');
          }

          if (state.motion && spec.moving) {
            const active = spec.moving.activeSignalId === undefined || signals.get(spec.moving.activeSignalId);
            if (active) {
              advanceMotion(state.motion.path, state.motion.state, context.dt, spec.moving.speed * scale);
            } else if (spec.moving.returnWhenInactive) {
              advanceMotion(state.motion.path, state.motion.state, context.dt, spec.moving.speed * scale, true);
            }
            motionOffset(state.motion.path, state.motion.state, state.offset);
          }
          if (spec.spinDegreesPerSecond) {
            state.yaw += ((spec.spinDegreesPerSecond * Math.PI) / 180) * scale * context.dt;
          }

          if (state.falling) {
            const standing = player !== undefined && isStandingOn(state, player, support);
            const canRespawn = !(player !== undefined && playerInsideFootprint({ ...state, falling: { ...state.falling, drop: 0 } }, player));
            const changed = stepFallingModel(state.falling, context.dt, standing, canRespawn);
            if (changed) {
              phaseEvent(state, changed);
              if (changed === 'FALLING') {
                removeCollider(state);
              } else if (changed === 'STABLE') {
                addCollider(state);
              }
            }
          }

          state.carry.x = (state.offset.x - before.x) / context.dt;
          state.carry.y = (state.offset.y - before.y) / context.dt;
          state.carry.z = (state.offset.z - before.z) / context.dt;
          if (state.hasCollider && (state.carry.x !== 0 || state.carry.y !== 0 || state.carry.z !== 0)) {
            const box = boxFor(state);
            physics.updateCollider(spec.id, box.min, box.max);
          }

          if (spec.bounceHeight !== undefined) {
            const on = state.appeared && player !== undefined && isStandingOn(state, player, support);
            if (on && !state.wasOn) {
              launch = { platformId: spec.id, height: spec.bounceHeight };
              emitPresentation(runtime, 'PlayerBounced', { platformId: spec.id, cue: spec.bounceCue });
              emitPresentation(runtime, 'PlatformLaunch', { platformId: spec.id, height: spec.bounceHeight });
            }
            state.wasOn = on;
          }
        }
      },
    });
    return () => {
      runtime.systems.remove('gameplay.platforms');
      removeService();
      for (const entity of world.query(PlatformComponent)) {
        removeCollider(world.get(entity, PlatformComponent)!);
      }
    };
  },
};
