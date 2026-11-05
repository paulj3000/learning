/**
 * NPC behaviour controller (LAI-NPC-019 to 024): implements `BehaviorControllerFactory` from
 * `../contracts/engine.ts`. Pure logic: no Three.js objects, React, network or physics library.
 * The runtime (`../engine/`) calls `update` once per frame and applies the returned pose,
 * locomotion and events to the NPC's root and animator.
 *
 * Parameters follow `lai/apps/npcs/behaviors.py` exactly (metres, m/s, seconds). Waypoints and
 * scripted `moveTo` points are offsets from the placement home (not rotated by `home.yaw`), so a
 * profile can be reused; they are clamped into the `boundsRadius` circle at runtime as a second
 * line of defence behind release validation (`validation/behavior.py`). A scripted `face` yaw is
 * an absolute world yaw in radians.
 *
 * Behaviour per type:
 * - stationary (and `spec: null`): stands at home; with `facePlayer` (spec default true, never for
 *   `spec: null`) turns toward a player within FACE_PLAYER_DISTANCE, else back to `home.yaw`.
 * - reactive: stands at home facing `home.yaw`; only its `reactions` do anything.
 * - wander: random targets in the `radius` disc (seeded via `random`), paused between them for a
 *   random time in `pauseSeconds`.
 * - patrol: walks the waypoints in order, pausing `pauseSeconds` at each; `loop: true` returns to
 *   the first after the last, `loop: false` walks back (ping-pong).
 * - follow: follows the player to `stopDistance` and idles facing them; beyond `giveUpDistance`
 *   (or when the player is gone) returns home (`returning`).
 * - guide: walks the waypoints once, waiting (`waiting_for_player`) while the player is farther
 *   than `waitForPlayerDistance`; idles at the last waypoint.
 * - scripted: runs `steps` (`moveTo`, `play`, `wait`, `face`), looping when `loop`.
 *   `play` is reported through the frame's extra `animation` field (see NpcBehaviorFrame).
 *
 * `npc.waypoint_reached {index}` fires on arrival at a patrol or guide waypoint (its index) and at
 * a scripted `moveTo` (its step index). A point that cannot be reached (blocked both ways or
 * taking far longer than its straight-line time) is skipped without that event.
 */

import type {
  BehaviorController,
  BehaviorControllerArgs,
  BehaviorControllerFactory,
  BehaviorFrame,
  BehaviorState,
  Locomotion,
  PlayerPose,
} from '../contracts/engine';
import type { BehaviorSpec } from '../contracts/types';
import type { AdventureEvent, AnimationState } from '../contracts/vocabulary';
import { createBehaviorMachine } from './behaviorMachine';
import { advanceToward, createMoveResult, type MoveContext } from './collision';
import {
  ARRIVAL_EPSILON,
  FACE_PLAYER_DISTANCE,
  FOLLOW_RESTART_MARGIN,
  LEG_TIME_SLACK,
  MAX_DELTA_SECONDS,
  REACTION_SECONDS,
  RUN_SPEED_THRESHOLD,
  TURN_RATE,
  WANDER_TARGET_ATTEMPTS,
} from './constants';
import { angleDelta, clampToCircle, distance, turnToward, yawTowards } from './geometry';

/**
 * A `BehaviorFrame` plus the scripted `play` animation started this frame (null otherwise).
 * Contract v1's `BehaviorFrame` has no field for it; the runtime can read it once the contract
 * adds one (reported as a needed contract change).
 */
export interface NpcBehaviorFrame extends BehaviorFrame {
  animation: AnimationState | null;
}

export interface NpcBehaviorController extends BehaviorController {
  update(deltaSeconds: number, player: PlayerPose | null): NpcBehaviorFrame;
}

/** Defaults mirror `runtime_parameters` in `behaviors.py`, for a spec published before them. */
const DEFAULTS = {
  boundsRadius: 15,
  speed: 1,
  radius: 3,
  pauseSeconds: [1, 3] as const,
  stopDistance: 2,
  giveUpDistance: 25,
  waitForPlayerDistance: 4,
};

type Kind = 'stationary' | 'reactive' | 'wander' | 'patrol' | 'follow' | 'guide' | 'scripted';

interface Point {
  x: number;
  z: number;
  pause: number;
}

type Step =
  | { action: 'moveTo'; x: number; z: number }
  | { action: 'play'; state: AnimationState }
  | { action: 'wait'; seconds: number }
  | { action: 'face'; yaw: number };

interface Resolved {
  kind: Kind;
  boundsRadius: number;
  speed: number;
  facePlayer: boolean;
  radius: number;
  pauseMin: number;
  pauseMax: number;
  loop: boolean;
  points: Point[];
  steps: Step[];
  stopDistance: number;
  giveUpDistance: number;
  waitForPlayerDistance: number;
  reactions: Partial<Record<AdventureEvent, AnimationState>>;
}

/** Everything that changes as the behaviour runs; snapshotted by `interrupt`. */
interface Progress {
  x: number;
  z: number;
  yaw: number;
  /** Waypoint index (patrol, guide) or step index (scripted). */
  index: number;
  /** Ping-pong direction for a non-looping patrol: 1 or -1. */
  direction: number;
  pauseRemaining: number;
  reactRemaining: number;
  reactReturn: BehaviorState;
  targetX: number;
  targetZ: number;
  legTime: number;
  legBudget: number;
  /** Guide reached its last waypoint, or a non-looping script ended. */
  done: boolean;
  /** The current scripted step has been started. */
  stepStarted: boolean;
  /** Follow could not get home; stop trying until it follows again. */
  homeUnreachable: boolean;
}

const KINDS: readonly Kind[] = [
  'stationary',
  'reactive',
  'wander',
  'patrol',
  'follow',
  'guide',
  'scripted',
];

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolve(spec: BehaviorSpec | null, homeX: number, homeZ: number): Resolved {
  const p = spec?.parameters;
  const kind: Kind = spec && KINDS.includes(spec.type as Kind) ? (spec.type as Kind) : 'stationary';
  const boundsRadius = positive(p?.boundsRadius, DEFAULTS.boundsRadius);
  const inBounds = (x: number, z: number) =>
    clampToCircle({ x: homeX + x, z: homeZ + z }, homeX, homeZ, boundsRadius);
  const pause = p?.pauseSeconds ?? DEFAULTS.pauseSeconds;
  const pauseMin = Math.max(0, Math.min(pause[0], pause[1]));
  const pauseMax = Math.max(pauseMin, pause[0], pause[1]);
  const giveUpDistance = positive(p?.giveUpDistance, DEFAULTS.giveUpDistance);
  return {
    kind,
    boundsRadius,
    speed: positive(p?.speed, DEFAULTS.speed),
    facePlayer: spec !== null && kind === 'stationary' && p?.facePlayer !== false,
    radius: Math.min(positive(p?.radius, DEFAULTS.radius), boundsRadius),
    pauseMin,
    pauseMax,
    loop: p?.loop !== false,
    points: (p?.waypoints ?? []).map((w) => {
      const at = inBounds(w.x, w.z);
      return { x: at.x, z: at.z, pause: Math.max(0, w.pauseSeconds ?? 0) };
    }),
    steps: (p?.steps ?? []).map((step): Step => {
      if (step.action !== 'moveTo') return step;
      const at = inBounds(step.x, step.z);
      return { action: 'moveTo', x: at.x, z: at.z };
    }),
    stopDistance: Math.min(positive(p?.stopDistance, DEFAULTS.stopDistance), giveUpDistance),
    giveUpDistance,
    waitForPlayerDistance: positive(p?.waitForPlayerDistance, DEFAULTS.waitForPlayerDistance),
    reactions: p?.reactions ?? {},
  };
}

/** Upper bound on zero-time phase changes in one frame (arrivals, step changes). */
function phaseLimit(r: Resolved): number {
  return 8 + 2 * Math.max(r.points.length, r.steps.length);
}

export function locomotionFor(moved: number, speed: number): Locomotion {
  if (moved <= 1e-6) return 'idle';
  return speed > RUN_SPEED_THRESHOLD ? 'run' : 'walk';
}

export function createBehaviorController(args: BehaviorControllerArgs): NpcBehaviorController {
  const { placementKey, home } = args;
  const random = args.random ?? Math.random;
  const r = resolve(args.spec, home.x, home.z);
  const machine = createBehaviorMachine<Progress>(placementKey);
  const ctx: MoveContext = {
    homeX: home.x,
    homeZ: home.z,
    boundsRadius: r.boundsRadius,
    isBlocked: args.isBlocked ?? null,
  };
  const p: Progress = {
    x: home.x,
    z: home.z,
    yaw: home.yaw,
    index: 0,
    direction: 1,
    pauseRemaining: 0,
    reactRemaining: 0,
    reactReturn: 'idle',
    targetX: home.x,
    targetZ: home.z,
    legTime: 0,
    legBudget: 0,
    done: false,
    stepStarted: false,
    homeUnreachable: false,
  };
  const move = createMoveResult();
  const probe = { x: 0, z: 0 };
  const limit = phaseLimit(r);
  let disposed = false;
  let moved = 0;
  let animation: AnimationState | null = null;

  // --- small helpers (no allocation) ---

  const state = () => machine.state();
  const go = (to: BehaviorState) => machine.transition(to);

  const startLeg = (x: number, z: number) => {
    p.targetX = x;
    p.targetZ = z;
    p.legTime = 0;
    p.legBudget = (distance(p.x, p.z, x, z) / r.speed) * LEG_TIME_SLACK + 1;
  };

  /** Turns toward `yaw` for `seconds`; returns the seconds the turn needed (<= seconds). */
  const turn = (yaw: number, seconds: number): number => {
    const needed = Math.abs(angleDelta(p.yaw, yaw)) / TURN_RATE;
    p.yaw = turnToward(p.yaw, yaw, TURN_RATE * seconds);
    return Math.min(needed, seconds);
  };

  const facePlayerOr = (player: PlayerPose | null, within: number, seconds: number) => {
    if (player && distance(p.x, p.z, player.x, player.z) <= within) {
      turn(yawTowards(p.x, p.z, player.x, player.z), seconds);
    } else {
      turn(home.yaw, seconds);
    }
  };

  /** One leg toward the current target. Returns what happened via `move`. */
  const walk = (speed: number, seconds: number) => {
    const travelYaw = yawTowards(p.x, p.z, p.targetX, p.targetZ);
    const far = distance(p.x, p.z, p.targetX, p.targetZ) > ARRIVAL_EPSILON;
    advanceToward(p, p.targetX, p.targetZ, speed, seconds, ctx, move, probe);
    if (far) turn(travelYaw, move.consumed);
    moved += move.moved;
    p.legTime += move.consumed;
    if (!move.arrived && p.legTime > p.legBudget) move.blocked = true;
    return move;
  };

  const reached = (index: number) => {
    machine.emit({ type: 'npc.waypoint_reached', placementKey, index });
  };

  // --- per type: each phase returns the seconds it used; 0 means "changed, run again" ---

  const stationaryPhase = (player: PlayerPose | null, seconds: number): number => {
    if (r.facePlayer) facePlayerOr(player, FACE_PLAYER_DISTANCE, seconds);
    else turn(home.yaw, seconds);
    return seconds;
  };

  const pickWanderTarget = (): boolean => {
    for (let attempt = 0; attempt < WANDER_TARGET_ATTEMPTS; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const radius = r.radius * Math.sqrt(random());
      probe.x = home.x + Math.sin(angle) * radius;
      probe.z = home.z + Math.cos(angle) * radius;
      clampToCircle(probe, home.x, home.z, r.boundsRadius);
      if (!ctx.isBlocked || !ctx.isBlocked(probe.x, probe.z)) {
        startLeg(probe.x, probe.z);
        return true;
      }
    }
    return false;
  };

  const wanderPause = () => {
    p.pauseRemaining = r.pauseMin + random() * (r.pauseMax - r.pauseMin);
  };

  const wanderPhase = (seconds: number): number => {
    switch (state()) {
      case 'moving': {
        walk(r.speed, seconds);
        if (move.arrived) {
          wanderPause();
          go('paused');
          return move.consumed;
        }
        if (move.blocked) {
          if (!pickWanderTarget()) {
            wanderPause();
            go('paused');
          }
          return seconds;
        }
        return move.consumed;
      }
      case 'paused': {
        const used = Math.min(p.pauseRemaining, seconds);
        p.pauseRemaining -= used;
        if (p.pauseRemaining <= 1e-12) {
          p.pauseRemaining = 0;
          if (pickWanderTarget()) go('moving');
          else wanderPause();
        }
        return used;
      }
      default:
        if (pickWanderTarget()) go('moving');
        else {
          wanderPause();
          go('paused');
        }
        return 0;
    }
  };

  const nextPatrolIndex = () => {
    const n = r.points.length;
    if (n <= 1) return;
    if (r.loop) {
      p.index = (p.index + 1) % n;
      return;
    }
    if (p.index + p.direction < 0 || p.index + p.direction >= n) p.direction = -p.direction;
    p.index += p.direction;
  };

  const legToIndex = () => {
    const point = r.points[p.index];
    startLeg(point.x, point.z);
  };

  const patrolPhase = (seconds: number): number => {
    if (r.points.length === 0) return stationaryPhase(null, seconds);
    switch (state()) {
      case 'moving': {
        walk(r.speed, seconds);
        if (move.arrived) {
          const pause = r.points[p.index].pause;
          reached(p.index);
          nextPatrolIndex();
          if (pause > 0) {
            p.pauseRemaining = pause;
            go('paused');
          } else {
            legToIndex();
          }
          return move.consumed;
        }
        if (move.blocked) {
          nextPatrolIndex();
          legToIndex();
          return seconds;
        }
        return move.consumed;
      }
      case 'paused': {
        const used = Math.min(p.pauseRemaining, seconds);
        p.pauseRemaining -= used;
        if (p.pauseRemaining <= 1e-12) {
          p.pauseRemaining = 0;
          legToIndex();
          go('moving');
        }
        return used;
      }
      default:
        legToIndex();
        go('moving');
        return 0;
    }
  };

  const guidePhase = (player: PlayerPose | null, seconds: number): number => {
    if (r.points.length === 0) return stationaryPhase(null, seconds);
    const playerFar =
      player === null || distance(p.x, p.z, player.x, player.z) > r.waitForPlayerDistance;
    const faceTheChild = () => {
      if (player) turn(yawTowards(p.x, p.z, player.x, player.z), seconds);
    };
    switch (state()) {
      case 'moving': {
        if (playerFar) {
          go('waiting_for_player');
          return 0;
        }
        walk(r.speed, seconds);
        if (move.arrived || move.blocked) {
          const pause = move.arrived ? r.points[p.index].pause : 0;
          if (move.arrived) reached(p.index);
          if (p.index >= r.points.length - 1) p.done = true;
          else {
            p.index += 1;
            legToIndex();
          }
          if (pause > 0) {
            p.pauseRemaining = pause;
            go('paused');
          } else if (p.done) go('idle');
          return move.arrived ? move.consumed : seconds;
        }
        return move.consumed;
      }
      case 'paused': {
        const used = Math.min(p.pauseRemaining, seconds);
        p.pauseRemaining -= used;
        if (p.pauseRemaining <= 1e-12) {
          p.pauseRemaining = 0;
          if (p.done) go('idle');
          else if (playerFar) go('waiting_for_player');
          else go('moving');
        }
        return used;
      }
      case 'waiting_for_player':
        if (!playerFar) {
          legToIndex();
          go('moving');
          return 0;
        }
        faceTheChild();
        return seconds;
      default: // idle
        if (p.done) {
          faceTheChild();
          return seconds;
        }
        legToIndex();
        go(playerFar ? 'waiting_for_player' : 'moving');
        return 0;
    }
  };

  const followPhase = (player: PlayerPose | null, seconds: number): number => {
    const d = player ? distance(p.x, p.z, player.x, player.z) : Infinity;
    switch (state()) {
      case 'following': {
        if (!player || d > r.giveUpDistance) {
          startLeg(home.x, home.z);
          go('returning');
          return 0;
        }
        if (d <= r.stopDistance) {
          go('idle');
          return 0;
        }
        // Stand-off point: `stopDistance` short of the player, kept inside the bounds circle.
        const k = (d - r.stopDistance) / d;
        probe.x = p.x + (player.x - p.x) * k;
        probe.z = p.z + (player.z - p.z) * k;
        clampToCircle(probe, home.x, home.z, r.boundsRadius);
        p.targetX = probe.x;
        p.targetZ = probe.z;
        walk(r.speed, seconds);
        if (move.moved <= 1e-9) turn(yawTowards(p.x, p.z, player.x, player.z), seconds);
        // The player keeps moving: re-aim next frame rather than chaining legs.
        return seconds;
      }
      case 'returning': {
        p.targetX = home.x;
        p.targetZ = home.z;
        walk(r.speed, seconds);
        if (move.arrived) {
          go('idle');
          return move.consumed;
        }
        if (move.blocked) {
          p.homeUnreachable = true;
          go('idle');
          return seconds;
        }
        return move.consumed;
      }
      default: {
        // idle
        if (player && d <= r.giveUpDistance) {
          if (d > r.stopDistance + FOLLOW_RESTART_MARGIN) {
            p.homeUnreachable = false;
            go('following');
            return 0;
          }
          turn(yawTowards(p.x, p.z, player.x, player.z), seconds);
          return seconds;
        }
        if (!p.homeUnreachable && distance(p.x, p.z, home.x, home.z) > ARRIVAL_EPSILON) {
          startLeg(home.x, home.z);
          go('returning');
          return 0;
        }
        turn(home.yaw, seconds);
        return seconds;
      }
    }
  };

  const nextStep = () => {
    p.stepStarted = false;
    p.index += 1;
    if (p.index >= r.steps.length) {
      if (r.loop) p.index = 0;
      else {
        p.index = r.steps.length - 1;
        p.done = true;
        go('idle');
      }
    }
  };

  const scriptedPhase = (seconds: number): number => {
    if (p.done || r.steps.length === 0) {
      return seconds;
    }
    const step = r.steps[p.index];
    switch (step.action) {
      case 'moveTo': {
        if (!p.stepStarted) {
          p.stepStarted = true;
          startLeg(step.x, step.z);
          go('moving');
          return 0;
        }
        walk(r.speed, seconds);
        if (move.arrived) {
          reached(p.index);
          nextStep();
          return move.consumed;
        }
        if (move.blocked) {
          nextStep();
          return seconds;
        }
        return move.consumed;
      }
      case 'play':
        animation = step.state;
        go('idle');
        nextStep();
        return 0;
      case 'wait': {
        if (!p.stepStarted) {
          p.stepStarted = true;
          p.pauseRemaining = step.seconds;
          go('paused');
        }
        const used = Math.min(p.pauseRemaining, seconds);
        p.pauseRemaining -= used;
        if (p.pauseRemaining <= 1e-12) {
          p.pauseRemaining = 0;
          nextStep();
        }
        return used;
      }
      case 'face': {
        if (!p.stepStarted) {
          p.stepStarted = true;
          go('idle');
        }
        const used = turn(step.yaw, seconds);
        if (Math.abs(angleDelta(p.yaw, step.yaw)) <= 1e-9) {
          nextStep();
          return used;
        }
        return seconds;
      }
    }
  };

  const phase = (player: PlayerPose | null, seconds: number): number => {
    switch (r.kind) {
      case 'wander':
        return wanderPhase(seconds);
      case 'patrol':
        return patrolPhase(seconds);
      case 'guide':
        return guidePhase(player, seconds);
      case 'follow':
        return followPhase(player, seconds);
      case 'scripted':
        return scriptedPhase(seconds);
      case 'reactive':
        turn(home.yaw, seconds);
        return seconds;
      default:
        return stationaryPhase(player, seconds);
    }
  };

  const frame = (): NpcBehaviorFrame => ({
    x: p.x,
    z: p.z,
    yaw: p.yaw,
    locomotion: locomotionFor(moved, r.speed),
    events: machine.drain(),
    animation,
  });

  return {
    update(deltaSeconds, player) {
      moved = 0;
      animation = null;
      if (disposed) return frame();
      const dt =
        Number.isFinite(deltaSeconds) && deltaSeconds > 0
          ? Math.min(deltaSeconds, MAX_DELTA_SECONDS)
          : 0;
      const current = state();
      if (current === 'interrupted' || dt === 0) return frame();
      if (current === 'reacting') {
        p.reactRemaining -= dt;
        if (p.reactRemaining <= 1e-12) {
          p.reactRemaining = 0;
          go(p.reactReturn);
        }
        return frame();
      }
      let remaining = dt;
      for (let i = 0; i < limit && remaining > 1e-12; i += 1) {
        remaining -= phase(player, remaining);
      }
      return frame();
    },
    interrupt() {
      if (disposed) return;
      machine.interrupt({ ...p });
    },
    resume() {
      if (disposed) return;
      const progress = machine.resume();
      if (progress) Object.assign(p, progress);
    },
    react(event) {
      if (disposed) return null;
      const reaction = r.reactions[event] ?? null;
      if (reaction === null) return null;
      const current = state();
      if (current === 'interrupted') return reaction;
      p.reactRemaining = REACTION_SECONDS;
      if (current !== 'reacting') {
        p.reactReturn = current;
        go('reacting');
      }
      return reaction;
    },
    state,
    dispose() {
      if (disposed) return;
      disposed = true;
      machine.dispose();
    },
  };
}

/** `createBehaviorController` typed as the contract's factory (what the runtime is given). */
export const behaviorControllerFactory: BehaviorControllerFactory = createBehaviorController;
