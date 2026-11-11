/**
 * Behaviour parameter parsing (LAI-NPC-019). Pure functions, no Three.js, React or network.
 *
 * The server validates every profile per type (`lai/apps/npcs/behaviors.py` and release
 * validation in `validation/behavior.py`) and publishes `runtime_parameters` (defaults filled);
 * `contracts/parse.ts` only checks that `parameters` is an object. This module is the runtime's
 * second line of defence: it never throws, ignores anything malformed (a non-finite number, a
 * waypoint without coordinates, an unknown scripted action, animation state or adventure event)
 * and falls back to the same defaults as `runtime_parameters`, so a bad row can make an NPC
 * stand still but can never break the frame loop.
 *
 * Waypoints and `moveTo` points are offsets from the placement home (not rotated by `home.yaw`);
 * they are resolved to world points here and clamped into the `boundsRadius` circle.
 */

import type { BehaviorSpec } from '../contracts/types';
import {
  ADVENTURE_EVENTS,
  ANIMATION_STATES,
  type AdventureEvent,
  type AnimationState,
} from '../contracts/vocabulary';
import { clampToCircle } from './geometry';

/** Defaults mirror `runtime_parameters` and the ranges in `behaviors.py`. */
export const BEHAVIOR_DEFAULTS = {
  boundsRadius: 15,
  speed: 1,
  radius: 3,
  pauseSeconds: [1, 3] as const,
  stopDistance: 2,
  giveUpDistance: 25,
  waitForPlayerDistance: 4,
} as const;

/** Upper bounds from `behaviors.py`, so a corrupt number cannot make a 1 km/s NPC. */
const MAX = { speed: 6, boundsRadius: 100, seconds: 30, points: 32 } as const;

export type BehaviorKind =
  'stationary' | 'reactive' | 'wander' | 'patrol' | 'follow' | 'guide' | 'scripted';

const KINDS: readonly BehaviorKind[] = [
  'stationary',
  'reactive',
  'wander',
  'patrol',
  'follow',
  'guide',
  'scripted',
];

export interface ResolvedPoint {
  x: number;
  z: number;
  pause: number;
}

export type ResolvedStep =
  | { action: 'moveTo'; x: number; z: number }
  | { action: 'play'; state: AnimationState }
  | { action: 'wait'; seconds: number }
  | { action: 'face'; yaw: number };

/** A behaviour spec resolved to world coordinates with every field present and sane. */
export interface ResolvedBehavior {
  kind: BehaviorKind;
  boundsRadius: number;
  speed: number;
  facePlayer: boolean;
  radius: number;
  pauseMin: number;
  pauseMax: number;
  loop: boolean;
  points: ResolvedPoint[];
  steps: ResolvedStep[];
  stopDistance: number;
  giveUpDistance: number;
  waitForPlayerDistance: number;
  reactions: Partial<Record<AdventureEvent, AnimationState>>;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value: unknown, fallback: number, max = Infinity): number {
  return finite(value) && value > 0 ? Math.min(value, max) : fallback;
}

function seconds(value: unknown): number {
  return finite(value) && value > 0 ? Math.min(value, MAX.seconds) : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isAnimationState(value: unknown): value is AnimationState {
  return (ANIMATION_STATES as readonly unknown[]).includes(value);
}

function isAdventureEvent(value: unknown): value is AdventureEvent {
  return (ADVENTURE_EVENTS as readonly unknown[]).includes(value);
}

/** Known event -> known state pairs only. */
export function parseReactions(value: unknown): Partial<Record<AdventureEvent, AnimationState>> {
  const out: Partial<Record<AdventureEvent, AnimationState>> = {};
  const raw = record(value);
  if (!raw) return out;
  for (const [event, state] of Object.entries(raw)) {
    if (isAdventureEvent(event) && isAnimationState(state)) out[event] = state;
  }
  return out;
}

/**
 * Resolves a published spec around `home` (a null or unknown-type spec is stationary, and a
 * null spec never turns to face the player).
 */
export function resolveBehavior(
  spec: BehaviorSpec | null,
  homeX: number,
  homeZ: number,
): ResolvedBehavior {
  const p = record(spec?.parameters) ?? {};
  const kind: BehaviorKind =
    spec && KINDS.includes(spec.type as BehaviorKind) ? (spec.type as BehaviorKind) : 'stationary';
  const boundsRadius = positive(p.boundsRadius, BEHAVIOR_DEFAULTS.boundsRadius, MAX.boundsRadius);
  const inBounds = (x: number, z: number) =>
    clampToCircle({ x: homeX + x, z: homeZ + z }, homeX, homeZ, boundsRadius);

  const pause = Array.isArray(p.pauseSeconds) ? p.pauseSeconds : BEHAVIOR_DEFAULTS.pauseSeconds;
  const a = seconds(pause[0]);
  const b = seconds(pause[1]);

  const points: ResolvedPoint[] = [];
  if (Array.isArray(p.waypoints)) {
    for (const item of p.waypoints.slice(0, MAX.points)) {
      const w = record(item);
      if (!w || !finite(w.x) || !finite(w.z)) continue;
      const at = inBounds(w.x, w.z);
      points.push({ x: at.x, z: at.z, pause: seconds(w.pauseSeconds) });
    }
  }

  const steps: ResolvedStep[] = [];
  if (Array.isArray(p.steps)) {
    for (const item of p.steps.slice(0, MAX.points)) {
      const s = record(item);
      if (!s) continue;
      if (s.action === 'moveTo' && finite(s.x) && finite(s.z)) {
        const at = inBounds(s.x, s.z);
        steps.push({ action: 'moveTo', x: at.x, z: at.z });
      } else if (s.action === 'play' && isAnimationState(s.state)) {
        steps.push({ action: 'play', state: s.state });
      } else if (s.action === 'wait' && finite(s.seconds)) {
        steps.push({ action: 'wait', seconds: seconds(s.seconds) });
      } else if (s.action === 'face' && finite(s.yaw)) {
        steps.push({ action: 'face', yaw: s.yaw });
      }
    }
  }

  const giveUpDistance = positive(p.giveUpDistance, BEHAVIOR_DEFAULTS.giveUpDistance);
  return {
    kind,
    boundsRadius,
    speed: positive(p.speed, BEHAVIOR_DEFAULTS.speed, MAX.speed),
    facePlayer: spec !== null && kind === 'stationary' && p.facePlayer !== false,
    radius: Math.min(positive(p.radius, BEHAVIOR_DEFAULTS.radius), boundsRadius),
    pauseMin: Math.min(a, b),
    pauseMax: Math.max(a, b),
    loop: p.loop !== false,
    points,
    steps,
    stopDistance: Math.min(
      positive(p.stopDistance, BEHAVIOR_DEFAULTS.stopDistance),
      giveUpDistance,
    ),
    giveUpDistance,
    waitForPlayerDistance: positive(
      p.waitForPlayerDistance,
      BEHAVIOR_DEFAULTS.waitForPlayerDistance,
    ),
    reactions: parseReactions(p.reactions),
  };
}
