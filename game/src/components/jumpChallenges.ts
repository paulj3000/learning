/**
 * Course and jump challenge tracking.
 *
 * An authored `challengeId` has two or more routes: at least one `JUMP` route and at least one
 * `ACCESSIBLE` (non-jump) route. Reaching any route's goal emits the **same**
 * `jump.challenge.completed` claim (only the route id differs), so the accessible route is
 * worth exactly as much as the jump route (jumping standard, scoring standard, contract rule
 * 4). Using an accessible route additionally emits the informational `jump.alternative.used`,
 * which consumers must never value lower. Required progress never needs a jump, so a
 * challenge is optional by nature; nothing here times, counts down or penalises.
 */

import { defineComponent } from '../core/entities';
import type { CapabilityDefinition } from '../core/capabilities';
import { emitClaim, emitPresentation, entityKey, playerPosition, type GameplayRuntime } from './common';
import { rectContains, type Rect } from './geometry';
import { configRoot, Issues } from './validate';

export type JumpRouteKind = 'JUMP' | 'ACCESSIBLE';

export interface JumpRouteSpec {
  routeId: string;
  kind: JumpRouteKind;
  /** Entering this zone starts the challenge. */
  start: Rect;
  /** Entering this zone completes it by this route. */
  goal: Rect;
}

export interface JumpChallengeSpec {
  challengeId: string;
  routes: JumpRouteSpec[];
}

export interface JumpChallengeState {
  spec: JumpChallengeSpec;
  started: boolean;
  completed: boolean;
  completedRouteId: string | null;
}
export const JumpChallengeComponent = defineComponent<JumpChallengeState>('gameplay.jumpChallenge');

export interface JumpChallengesConfig {
  challenges: JumpChallengeSpec[];
}

export function validateJumpChallengesConfig(input: unknown) {
  const issues = new Issues();
  const root = configRoot(input, issues);
  const challenges = issues.records(
    root.challenges,
    'challenges',
    (item, path): JumpChallengeSpec => {
      const challengeId = issues.id(item.challengeId, `${path}.challengeId`);
      const routes = issues.records(
        item.routes,
        `${path}.routes`,
        (r, rp): JumpRouteSpec => ({
          routeId: issues.id(r.routeId, `${rp}.routeId`),
          kind: issues.oneOf<JumpRouteKind>(r.kind, `${rp}.kind`, ['JUMP', 'ACCESSIBLE']),
          start: issues.rect(r.start, `${rp}.start`),
          goal: issues.rect(r.goal, `${rp}.goal`),
        }),
        (r) => r.routeId,
        8,
      );
      if (!routes.some((r) => r.kind === 'JUMP')) {
        issues.add(`${path}.routes`, 'needs a JUMP route');
      }
      if (!routes.some((r) => r.kind === 'ACCESSIBLE')) {
        issues.add(`${path}.routes`, 'needs an ACCESSIBLE (non-jump) route: required progress never needs a jump');
      }
      return { challengeId, routes };
    },
    (c) => c.challengeId,
    64,
  );
  return issues.result<JumpChallengesConfig>({ challenges });
}

export const JUMP_CHALLENGES_CAPABILITY_ID = 'gameplay.jumpChallenges';

export const jumpChallengesCapability: CapabilityDefinition<JumpChallengesConfig, GameplayRuntime> = {
  id: JUMP_CHALLENGES_CAPABILITY_ID,
  version: '1.0.0',
  description: 'Jump challenges with a jump route and an accessible route that emit equal-value completion claims.',
  defaults: { challenges: [] },
  validate: validateJumpChallengesConfig,
  install(runtime, config) {
    const { world } = runtime;
    for (const spec of config.challenges) {
      world.add(world.create(entityKey('jumpChallenge', spec.challengeId)), JumpChallengeComponent, {
        spec,
        started: false,
        completed: false,
        completedRouteId: null,
      });
    }
    runtime.systems.add({
      id: 'gameplay.jumpChallenges',
      phase: 'simulation',
      update() {
        const player = playerPosition(runtime);
        if (!player) {
          return;
        }
        for (const entity of world.query(JumpChallengeComponent)) {
          const state = world.get(entity, JumpChallengeComponent)!;
          if (state.completed) {
            continue;
          }
          const { spec } = state;
          const start = (routeId: string, accessible: boolean) => {
            if (!state.started) {
              state.started = true;
              emitPresentation(runtime, 'JumpRouteChosen', { challengeId: spec.challengeId, routeId, accessible });
              emitClaim(runtime, 'jump.challenge.started', { challengeId: spec.challengeId });
            }
          };
          for (const route of spec.routes) {
            if (rectContains(route.start, player.x, player.z)) {
              start(route.routeId, route.kind === 'ACCESSIBLE');
            }
          }
          for (const route of spec.routes) {
            if (rectContains(route.goal, player.x, player.z)) {
              // Reaching a goal always yields started then completed, identically for any route.
              start(route.routeId, route.kind === 'ACCESSIBLE');
              state.completed = true;
              state.completedRouteId = route.routeId;
              emitClaim(runtime, 'jump.challenge.completed', { challengeId: spec.challengeId, routeId: route.routeId });
              if (route.kind === 'ACCESSIBLE') {
                emitClaim(runtime, 'jump.alternative.used', { challengeId: spec.challengeId, routeId: route.routeId });
              }
              break;
            }
          }
        }
      },
    });
    return () => {
      runtime.systems.remove('gameplay.jumpChallenges');
    };
  },
};
