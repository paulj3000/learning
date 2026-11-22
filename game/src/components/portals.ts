/**
 * Portals: entering the zone asks the host to transition to a target area.
 *
 * The engine only emits a `PortalRequested` presentation/transition request with the target
 * area id; the host decides whether and how to load it (and may refuse). Edge-triggered: the
 * child must leave the zone before it can fire again, so a host that declines does not get a
 * request every step. A requirement id (host check) keeps a portal closed with `PortalBlocked`.
 */

import { defineComponent } from '../core/entities';
import type { CapabilityDefinition } from '../core/capabilities';
import type { Vec3Like } from '../contracts/player';
import {
  emitPresentation,
  entityKey,
  playerPosition,
  requirementMet,
  type GameplayRuntime,
} from './common';
import { configRoot, Issues } from './validate';

export interface PortalSpec {
  id: string;
  position: Vec3Like;
  radius: number;
  targetAreaId: string;
  requirementId?: string;
}

export interface PortalState {
  spec: PortalSpec;
  inside: boolean;
}
export const PortalComponent = defineComponent<PortalState>('gameplay.portal');

export interface PortalsConfig {
  portals: PortalSpec[];
}

export function validatePortalsConfig(input: unknown) {
  const issues = new Issues();
  const root = configRoot(input, issues);
  const portals = issues.records(
    root.portals,
    'portals',
    (item, path): PortalSpec => ({
      id: issues.id(item.id, `${path}.id`),
      position: issues.vec3(item.position, `${path}.position`),
      radius: issues.num(item.radius, `${path}.radius`, 0.5, 8, 1.5),
      targetAreaId: issues.id(item.targetAreaId, `${path}.targetAreaId`),
      requirementId: issues.optionalId(item.requirementId, `${path}.requirementId`),
    }),
    (p) => p.id,
    64,
  );
  return issues.result<PortalsConfig>({ portals });
}

export const PORTALS_CAPABILITY_ID = 'gameplay.portals';

export const portalsCapability: CapabilityDefinition<PortalsConfig, GameplayRuntime> = {
  id: PORTALS_CAPABILITY_ID,
  version: '1.0.0',
  description: 'Portals: edge-triggered zone entry that requests a transition to a target area id.',
  defaults: { portals: [] },
  validate: validatePortalsConfig,
  install(runtime, config) {
    const { world } = runtime;
    for (const spec of config.portals) {
      world.add(world.create(entityKey('portal', spec.id)), PortalComponent, {
        spec,
        inside: false,
      });
    }
    runtime.systems.add({
      id: 'gameplay.portals',
      phase: 'simulation',
      update() {
        const player = playerPosition(runtime);
        for (const entity of world.query(PortalComponent)) {
          const state = world.get(entity, PortalComponent)!;
          const { spec } = state;
          const inside =
            player !== undefined &&
            Math.hypot(player.x - spec.position.x, player.z - spec.position.z) <= spec.radius &&
            Math.abs(player.y - spec.position.y) <= 3;
          if (inside && !state.inside) {
            if (requirementMet(runtime, spec.requirementId)) {
              emitPresentation(runtime, 'PortalRequested', {
                portalId: spec.id,
                targetAreaId: spec.targetAreaId,
              });
            } else {
              emitPresentation(runtime, 'PortalBlocked', { portalId: spec.id });
            }
          }
          state.inside = inside;
        }
      },
    });
    return () => {
      runtime.systems.remove('gameplay.portals');
    };
  },
};
