/**
 * Checkpoints and course goals: the one checkpoint system (Firepeak requirements 5).
 *
 * Hazards, fall recovery and resume all read this component; there is no second checkpoint
 * list. A checkpoint is reached once per visit when the child stands in its x/z square. The
 * engine emits `CourseCheckpointReached` (presentation) and a `course.checkpoint.reached`
 * claim; recovery to a checkpoint is a presentation request and never costs anything.
 *
 * A checkpoint may sit at ground level only (jumping standard): `validateGameplayLayout`
 * rejects one standing on a moving, falling or bouncing platform.
 */

import { defineComponent } from '../core/entities';
import { defineService } from '../core/services';
import type { CapabilityDefinition } from '../core/capabilities';
import type { Vec3Like } from '../contracts/player';
import {
  emitClaim,
  emitPresentation,
  playerPosition,
  signalBoard,
  entityKey,
  type GameplayRuntime,
} from './common';
import { rectContains, type Rect } from './geometry';
import { configRoot, Issues } from './validate';

export interface CheckpointSpec {
  id: string;
  courseId: string;
  /** Where the child is put back: ground level, never on a moving platform. */
  position: Vec3Like;
  yaw: number;
  /** Child-facing, read aloud: "the old dock". */
  label: string;
  /** Half the side of the square that counts as reaching it, metres. Default 1. */
  halfSize: number;
  /** Optional world signal that must be true before this checkpoint can be reached. */
  requiresSignalId?: string;
}

export interface CourseGoalSpec {
  id: string;
  courseId: string;
  rect: Rect;
}

export interface CheckpointsConfig {
  checkpoints: CheckpointSpec[];
  goals: CourseGoalSpec[];
  /** Checkpoints already reached earlier this visit (resume): no events are re-emitted. */
  alreadyReached: string[];
}

export interface CheckpointState {
  spec: CheckpointSpec;
  reached: boolean;
}
export interface GoalState {
  spec: CourseGoalSpec;
  reached: boolean;
}
export const CheckpointComponent = defineComponent<CheckpointState>('gameplay.checkpoint');
export const CourseGoalComponent = defineComponent<GoalState>('gameplay.courseGoal');

export interface CheckpointTarget {
  id: string;
  position: Readonly<Vec3Like>;
  yaw: number;
  label: string;
}

export interface CheckpointsApi {
  /**
   * Where recovery goes, or null before any checkpoint is reached: in the course of the most
   * recently reached checkpoint, the reached checkpoint furthest along that course's authored
   * order. Reaching or re-marking an earlier checkpoint never moves recovery backwards within a
   * course (GE-L13); moving on to another course moves recovery there.
   */
  latest(): CheckpointTarget | null;
  reachedIds(): readonly string[];
  /**
   * Where to put the child back: the latest reached checkpoint, else the named fallback.
   * Returns null when neither exists.
   */
  resolveRecovery(fallbackCheckpointId?: string | null): CheckpointTarget | null;
  /** Marks a checkpoint reached without events (resuming a visit). */
  markReached(checkpointId: string): boolean;
  has(checkpointId: string): boolean;
}
export const CheckpointsService = defineService<CheckpointsApi>('gameplay.checkpoints');

export const CHECKPOINT_LIMITS = { maxCheckpoints: 64, minHalfSize: 0.5, maxHalfSize: 6 } as const;

export function validateCheckpointsConfig(input: unknown) {
  const issues = new Issues();
  const root = configRoot(input, issues);
  const checkpoints = issues.records(
    root.checkpoints,
    'checkpoints',
    (item, path): CheckpointSpec => ({
      id: issues.id(item.id, `${path}.id`),
      courseId: issues.id(item.courseId, `${path}.courseId`),
      position: issues.vec3(item.position, `${path}.position`),
      yaw: issues.num(item.yaw, `${path}.yaw`, -Math.PI * 2, Math.PI * 2, 0),
      label:
        typeof item.label === 'string' && item.label.trim() !== ''
          ? item.label
          : (issues.add(`${path}.label`, 'must be a non-empty child-facing label'), ''),
      halfSize: issues.num(
        item.halfSize,
        `${path}.halfSize`,
        CHECKPOINT_LIMITS.minHalfSize,
        CHECKPOINT_LIMITS.maxHalfSize,
        1,
      ),
      requiresSignalId: issues.optionalId(item.requiresSignalId, `${path}.requiresSignalId`),
    }),
    (c) => c.id,
    CHECKPOINT_LIMITS.maxCheckpoints,
  );
  const goals = issues.records(
    root.goals,
    'goals',
    (item, path): CourseGoalSpec => ({
      id: issues.id(item.id, `${path}.id`),
      courseId: issues.id(item.courseId, `${path}.courseId`),
      rect: issues.rect(item.rect, `${path}.rect`),
    }),
    (g) => g.id,
    32,
  );
  const alreadyReached = Array.isArray(root.alreadyReached)
    ? root.alreadyReached.map((v, i) => issues.id(v, `alreadyReached[${i}]`))
    : [];
  for (const id of alreadyReached) {
    if (id && !checkpoints.some((c) => c.id === id)) {
      issues.add('alreadyReached', `unknown checkpoint "${id}"`);
    }
  }
  return issues.result<CheckpointsConfig>({ checkpoints, goals, alreadyReached });
}

export const CHECKPOINTS_CAPABILITY_ID = 'gameplay.checkpoints';

export const checkpointsCapability: CapabilityDefinition<CheckpointsConfig, GameplayRuntime> = {
  id: CHECKPOINTS_CAPABILITY_ID,
  version: '1.0.0',
  description:
    'Course checkpoints and goals: the single checkpoint list hazards and recovery resolve against.',
  defaults: { checkpoints: [], goals: [], alreadyReached: [] },
  validate: validateCheckpointsConfig,
  install(runtime, config) {
    const { world } = runtime;
    const order: string[] = [];
    for (const spec of config.checkpoints) {
      const entity = world.create(entityKey('checkpoint', spec.id));
      world.add(entity, CheckpointComponent, {
        spec,
        reached: config.alreadyReached.includes(spec.id),
      });
      if (config.alreadyReached.includes(spec.id)) {
        order.push(spec.id);
      }
    }
    for (const spec of config.goals) {
      world.add(world.create(entityKey('goal', spec.id)), CourseGoalComponent, {
        spec,
        reached: false,
      });
    }
    const stateOf = (id: string) => {
      const entity = world.bySemanticId(entityKey('checkpoint', id));
      return entity === undefined ? undefined : world.get(entity, CheckpointComponent);
    };
    const target = (id: string): CheckpointTarget | null => {
      const state = stateOf(id);
      return state
        ? { id, position: state.spec.position, yaw: state.spec.yaw, label: state.spec.label }
        : null;
    };
    const authoredIndex = new Map(config.checkpoints.map((spec, index) => [spec.id, index]));
    const latestId = (): string | null => {
      const last = order[order.length - 1];
      if (last === undefined) {
        return null;
      }
      const courseId = stateOf(last)?.spec.courseId;
      let furthest = last;
      for (const id of order) {
        if (
          stateOf(id)?.spec.courseId === courseId &&
          (authoredIndex.get(id) ?? -1) > (authoredIndex.get(furthest) ?? -1)
        ) {
          furthest = id;
        }
      }
      return furthest;
    };
    const api: CheckpointsApi = {
      latest: () => {
        const id = latestId();
        return id === null ? null : target(id);
      },
      reachedIds: () => [...order],
      resolveRecovery(fallback) {
        return api.latest() ?? (fallback ? target(fallback) : null);
      },
      markReached(id) {
        const state = stateOf(id);
        if (!state) {
          return false;
        }
        if (!state.reached) {
          state.reached = true;
        }
        const at = order.indexOf(id);
        if (at >= 0) {
          order.splice(at, 1);
        }
        order.push(id);
        return true;
      },
      has: (id) => stateOf(id) !== undefined,
    };
    const removeService = runtime.services.provide(CheckpointsService, api);
    const signals = signalBoard(runtime);

    runtime.systems.add({
      id: 'gameplay.checkpoints',
      phase: 'simulation',
      update() {
        const player = playerPosition(runtime);
        if (!player) {
          return;
        }
        for (const entity of world.query(CheckpointComponent)) {
          const state = world.get(entity, CheckpointComponent)!;
          const { spec } = state;
          if (state.reached || (spec.requiresSignalId && !signals.get(spec.requiresSignalId))) {
            continue;
          }
          const near =
            Math.abs(player.x - spec.position.x) <= spec.halfSize &&
            Math.abs(player.z - spec.position.z) <= spec.halfSize;
          if (near) {
            state.reached = true;
            order.push(spec.id);
            emitPresentation(runtime, 'CourseCheckpointReached', {
              checkpointId: spec.id,
              label: spec.label,
            });
            emitClaim(runtime, 'course.checkpoint.reached', {
              courseId: spec.courseId,
              checkpointId: spec.id,
            });
          }
        }
        for (const entity of world.query(CourseGoalComponent)) {
          const state = world.get(entity, CourseGoalComponent)!;
          if (!state.reached && rectContains(state.spec.rect, player.x, player.z)) {
            state.reached = true;
            emitPresentation(runtime, 'PlatformGoalReached', { goalId: state.spec.id });
            emitClaim(runtime, 'course.completed', {
              courseId: state.spec.courseId,
              goalId: state.spec.id,
            });
          }
        }
      },
    });
    return () => {
      runtime.systems.remove('gameplay.checkpoints');
      removeService();
    };
  },
};
