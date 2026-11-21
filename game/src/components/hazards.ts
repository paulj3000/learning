/**
 * Hazards: static volumes (water, lava) and telegraphed moving hazards (falling rocks).
 *
 * A hazard never damages the child and there are no lives. Touching one makes the engine emit a
 * `HazardRecoveryRequested` presentation event carrying the `hazardId`, a kind message key and
 * the checkpoint to return to; the host (movement) performs the recovery and the toast.
 * Hazards reference checkpoints **by id** from the one checkpoint system
 * (`gameplay.checkpoints`); there is no second checkpoint list. The target is the latest
 * checkpoint reached, else the hazard's own named checkpoint ("every hazard has a checkpoint").
 *
 * Telegraphed hazards follow a deterministic schedule of REST, then WARN (a shadow or warning
 * of at least 1.5 s), then ACTIVE, keyed to simulated time so every device agrees. They are
 * allowed on a required route only with a declared safe lane. The warning is shown as a steady
 * mark under reduced motion. No countdown is ever exposed to the child.
 */

import { defineComponent } from '../core/entities';
import { defineService } from '../core/services';
import type { CapabilityDefinition } from '../core/capabilities';
import { CHECKPOINTS_CAPABILITY_ID, CheckpointsService } from './checkpoints';
import {
  emitPresentation,
  entityKey,
  isReducedMotion,
  playerPosition,
  signalBoard,
  type GameplayRuntime,
} from './common';
import { rectContains, rectsOverlap, type Rect } from './geometry';
import { configRoot, Issues } from './validate';

export const MIN_TELEGRAPH_SECONDS = 1.5;

export interface StaticHazardSpec {
  id: string;
  /** WATER, LAVA, PIT or any authored kind; drives copy and sound, never damage. */
  kind: string;
  rect: Rect;
  /** Feet at or below this height inside `rect` count as in the hazard. Default 0.05. */
  belowY: number;
  /** The checkpoint beside this hazard (resolved in the checkpoint system). */
  checkpointId: string;
  messageKey: string;
  /** GE-066: the hazard is off while this signal is on (a switch that drains the lava). */
  inactiveWhenSignalId?: string;
}

export type HazardPhase = 'REST' | 'WARN' | 'ACTIVE';

export interface TelegraphedHazardSpec {
  id: string;
  kind: string;
  /** The impact area (the shadow on the ground). */
  rect: Rect;
  route: 'REQUIRED' | 'OPTIONAL';
  /** Required routes must declare a lane outside `rect` that is always safe. */
  safeLane?: Rect;
  checkpointId: string;
  messageKey: string;
  telegraphSeconds: number;
  activeSeconds: number;
  restSeconds: number;
  offsetSeconds: number;
  /** GE-066: the hazard is off while this signal is on. Shown as REST, never recovering. */
  inactiveWhenSignalId?: string;
}

export interface HazardsConfig {
  hazards: StaticHazardSpec[];
  telegraphed: TelegraphedHazardSpec[];
  /** Seconds before the same hazard may ask for recovery again. */
  recoveryCooldownSeconds: number;
}

export interface HazardState {
  kind: 'STATIC' | 'TELEGRAPHED';
  spec: StaticHazardSpec | TelegraphedHazardSpec;
  inside: boolean;
  phase: HazardPhase;
  cooldown: number;
}
export const HazardComponent = defineComponent<HazardState>('gameplay.hazard');

/** The footprint of every hazard, for other systems (force volumes must not push into these). */
export interface HazardRegionsApi {
  regions(): readonly { id: string; rect: Rect }[];
}
export const HazardRegionsService = defineService<HazardRegionsApi>('gameplay.hazardRegions');

/** The phase of a telegraphed hazard at simulated `time` (pure, deterministic). */
export function telegraphPhaseAt(
  spec: Pick<
    TelegraphedHazardSpec,
    'telegraphSeconds' | 'activeSeconds' | 'restSeconds' | 'offsetSeconds'
  >,
  time: number,
): { phase: HazardPhase; secondsToImpact: number } {
  const cycle = spec.restSeconds + spec.telegraphSeconds + spec.activeSeconds;
  const t = (((time + spec.offsetSeconds) % cycle) + cycle) % cycle;
  if (t < spec.restSeconds) {
    return { phase: 'REST', secondsToImpact: spec.restSeconds - t + spec.telegraphSeconds };
  }
  if (t < spec.restSeconds + spec.telegraphSeconds) {
    return { phase: 'WARN', secondsToImpact: spec.restSeconds + spec.telegraphSeconds - t };
  }
  return { phase: 'ACTIVE', secondsToImpact: 0 };
}

export function validateHazardsConfig(input: unknown) {
  const issues = new Issues();
  const root = configRoot(input, issues);
  const message = (value: unknown, path: string) => {
    if (typeof value !== 'string' || !/^[a-z][a-zA-Z0-9_.]{0,80}$/.test(value)) {
      issues.add(path, 'must be a localizable message key (letters, digits, dots)');
      return '';
    }
    return value;
  };
  const kind = (value: unknown, path: string, fallback: string) =>
    value === undefined
      ? fallback
      : typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(value)
        ? value
        : (issues.add(path, 'must be UPPER_SNAKE_CASE'), fallback);
  const hazards = issues.records(
    root.hazards,
    'hazards',
    (item, path): StaticHazardSpec => ({
      id: issues.id(item.id, `${path}.id`),
      kind: kind(item.kind, `${path}.kind`, 'WATER'),
      rect: issues.rect(item.rect, `${path}.rect`),
      belowY: issues.num(item.belowY, `${path}.belowY`, -50, 5, 0.05),
      checkpointId: issues.id(item.checkpointId, `${path}.checkpointId`),
      messageKey: message(item.messageKey, `${path}.messageKey`),
      inactiveWhenSignalId: issues.optionalId(
        item.inactiveWhenSignalId,
        `${path}.inactiveWhenSignalId`,
      ),
    }),
    (h) => h.id,
    64,
  );
  const telegraphed = issues.records(
    root.telegraphed,
    'telegraphed',
    (item, path): TelegraphedHazardSpec => {
      const route = issues.oneOf<'REQUIRED' | 'OPTIONAL'>(
        item.route,
        `${path}.route`,
        ['REQUIRED', 'OPTIONAL'],
        'OPTIONAL',
      );
      const rect = issues.rect(item.rect, `${path}.rect`);
      const safeLane =
        item.safeLane === undefined ? undefined : issues.rect(item.safeLane, `${path}.safeLane`);
      if (route === 'REQUIRED') {
        if (!safeLane) {
          issues.add(
            `${path}.safeLane`,
            'a moving hazard on a required route must declare a safe lane',
          );
        } else if (rectsOverlap(safeLane, rect)) {
          issues.add(`${path}.safeLane`, 'the safe lane must not overlap the impact area');
        }
      }
      return {
        id: issues.id(item.id, `${path}.id`),
        kind: kind(item.kind, `${path}.kind`, 'FALLING_ROCK'),
        rect,
        route,
        safeLane,
        checkpointId: issues.id(item.checkpointId, `${path}.checkpointId`),
        messageKey: message(item.messageKey, `${path}.messageKey`),
        telegraphSeconds: issues.num(
          item.telegraphSeconds,
          `${path}.telegraphSeconds`,
          MIN_TELEGRAPH_SECONDS,
          10,
          2,
        ),
        activeSeconds: issues.num(item.activeSeconds, `${path}.activeSeconds`, 0.1, 3, 0.5),
        restSeconds: issues.num(item.restSeconds, `${path}.restSeconds`, 1, 60, 3),
        offsetSeconds: issues.num(item.offsetSeconds, `${path}.offsetSeconds`, 0, 120, 0),
        inactiveWhenSignalId: issues.optionalId(
          item.inactiveWhenSignalId,
          `${path}.inactiveWhenSignalId`,
        ),
      };
    },
    (h) => h.id,
    32,
  );
  const ids = new Set<string>();
  for (const h of [...hazards, ...telegraphed]) {
    if (ids.has(h.id)) {
      issues.add('', `hazard id "${h.id}" is used by a static and a telegraphed hazard`);
    }
    ids.add(h.id);
  }
  return issues.result<HazardsConfig>({
    hazards,
    telegraphed,
    recoveryCooldownSeconds: issues.num(
      root.recoveryCooldownSeconds,
      'recoveryCooldownSeconds',
      0.5,
      10,
      1.5,
    ),
  });
}

export const HAZARDS_CAPABILITY_ID = 'gameplay.hazards';

export const hazardsCapability: CapabilityDefinition<HazardsConfig, GameplayRuntime> = {
  id: HAZARDS_CAPABILITY_ID,
  version: '1.0.0',
  description:
    'Static and telegraphed hazards that request recovery to a checkpoint. No damage, no lives.',
  requires: [CHECKPOINTS_CAPABILITY_ID],
  defaults: { hazards: [], telegraphed: [], recoveryCooldownSeconds: 1.5 },
  validate: validateHazardsConfig,
  install(runtime, config) {
    const { world } = runtime;
    const checkpoints = runtime.services.require(CheckpointsService);
    for (const spec of config.hazards) {
      if (!checkpoints.has(spec.checkpointId)) {
        runtime.diagnostics.warn('HAZARD_UNKNOWN_CHECKPOINT', {
          hazard: spec.id,
          checkpoint: spec.checkpointId,
        });
      }
      world.add(world.create(entityKey('hazard', spec.id)), HazardComponent, {
        kind: 'STATIC',
        spec,
        inside: false,
        phase: 'ACTIVE',
        cooldown: 0,
      });
    }
    for (const spec of config.telegraphed) {
      if (!checkpoints.has(spec.checkpointId)) {
        runtime.diagnostics.warn('HAZARD_UNKNOWN_CHECKPOINT', {
          hazard: spec.id,
          checkpoint: spec.checkpointId,
        });
      }
      world.add(world.create(entityKey('hazard', spec.id)), HazardComponent, {
        kind: 'TELEGRAPHED',
        spec,
        inside: false,
        phase: 'REST',
        cooldown: 0,
      });
    }
    const removeRegions = runtime.services.provide(HazardRegionsService, {
      regions: () =>
        [...config.hazards, ...config.telegraphed].map((h) => ({ id: h.id, rect: h.rect })),
    });

    const signals = signalBoard(runtime);
    const inactive = (spec: { inactiveWhenSignalId?: string }) =>
      spec.inactiveWhenSignalId !== undefined && signals.get(spec.inactiveWhenSignalId);

    const request = (state: HazardState) => {
      const spec = state.spec;
      const target = checkpoints.resolveRecovery(spec.checkpointId);
      if (!target) {
        runtime.diagnostics.warn('HAZARD_NO_RECOVERY_TARGET', { hazard: spec.id });
        return;
      }
      emitPresentation(runtime, 'HazardRecoveryRequested', {
        hazardId: spec.id,
        hazardKind: spec.kind,
        reason: 'HAZARD',
        checkpointId: target.id,
        position: target.position,
        yaw: target.yaw,
        messageKey: spec.messageKey,
      });
      state.cooldown = config.recoveryCooldownSeconds;
    };

    runtime.systems.add({
      id: 'gameplay.hazards',
      phase: 'simulation',
      update(context) {
        const player = playerPosition(runtime);
        const steady = isReducedMotion(runtime);
        for (const entity of world.query(HazardComponent)) {
          const state = world.get(entity, HazardComponent)!;
          state.cooldown = Math.max(0, state.cooldown - context.dt);
          if (state.kind === 'STATIC') {
            const spec = state.spec as StaticHazardSpec;
            if (inactive(spec)) {
              state.inside = false;
              continue;
            }
            const inside =
              player !== undefined &&
              rectContains(spec.rect, player.x, player.z) &&
              player.y <= spec.belowY;
            if (inside && state.cooldown === 0) {
              request(state);
            }
            state.inside = inside;
            continue;
          }
          const spec = state.spec as TelegraphedHazardSpec;
          if (inactive(spec)) {
            // Off: the view sees REST once, and nothing recovers the child.
            if (state.phase !== 'REST') {
              state.phase = 'REST';
              emitPresentation(runtime, 'HazardTelegraph', {
                hazardId: spec.id,
                phase: 'REST',
                secondsToImpact: spec.telegraphSeconds,
                steadyWarning: steady,
              });
            }
            state.inside = false;
            continue;
          }
          const { phase, secondsToImpact } = telegraphPhaseAt(spec, context.time);
          if (phase !== state.phase) {
            state.phase = phase;
            emitPresentation(runtime, 'HazardTelegraph', {
              hazardId: spec.id,
              phase,
              secondsToImpact,
              steadyWarning: steady,
            });
          }
          const inside = player !== undefined && rectContains(spec.rect, player.x, player.z);
          if (phase === 'ACTIVE' && inside && state.cooldown === 0) {
            request(state);
          }
          state.inside = inside;
        }
      },
    });
    return () => {
      runtime.systems.remove('gameplay.hazards');
      removeRegions();
    };
  },
};
