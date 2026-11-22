/** Test fixtures for the SDK. Not exported from the package index. */

import { createCapabilityRegistry, type CapabilityRegistry } from '../core/capabilities';
import { validationFailed, validationOk } from '../core/errors';
import type { EventMap } from '../core/eventBus';
import type { EngineRuntime } from '../core/runtime';
import type { AdventureDefinition } from './adventure';
import { defineAdventure } from './adventure';

/** A registry with a stub `movement.jump` (needs `movement.walk`) and `camera.thirdPerson`. */
export function createTestRegistry(
  log: string[] = [],
): CapabilityRegistry<EngineRuntime<EventMap>> {
  const registry = createCapabilityRegistry<EngineRuntime<EventMap>>();
  registry.register({
    id: 'movement.walk',
    version: '0.1.0',
    description: 'stub walk',
    defaults: {},
    validate: (input) => validationOk((input ?? {}) as object),
    install: () => {
      log.push('install:movement.walk');
      return () => log.push('uninstall:movement.walk');
    },
  });
  registry.register<{ jumpHeight: number }>({
    id: 'movement.jump',
    version: '0.1.0',
    description: 'stub jump',
    requires: ['movement.walk'],
    defaults: { jumpHeight: 1.2 },
    validate: (input) => {
      const value = (input ?? {}) as { jumpHeight?: unknown };
      if (
        value.jumpHeight !== undefined &&
        (typeof value.jumpHeight !== 'number' || value.jumpHeight < 0.2 || value.jumpHeight > 2.5)
      ) {
        return validationFailed([{ path: 'jumpHeight', message: 'must be 0.2 to 2.5' }]);
      }
      return validationOk({ jumpHeight: (value.jumpHeight as number | undefined) ?? 1.2 });
    },
    install: () => {
      log.push('install:movement.jump');
      return () => log.push('uninstall:movement.jump');
    },
  });
  return registry;
}

export function validAdventure(overrides: Partial<AdventureDefinition> = {}): AdventureDefinition {
  return defineAdventure({
    id: 'demo-adventure',
    realmId: 'demo-realm',
    version: '1.0.0',
    engineApi: '^0.1.0',
    ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
    learningObjectiveIds: ['counting.to.ten'],
    areas: ['demo-cove', 'demo-hill'],
    capabilities: [{ id: 'movement.jump', config: { jumpHeight: 1.0 } }],
    components: [{ id: 'chest-1', type: 'gameplay.chest', areaId: 'demo-cove' }],
    questIds: ['quest-1'],
    challengeIds: ['challenge-1'],
    jumpChallenges: [
      {
        id: 'jump-1',
        areaId: 'demo-cove',
        jumpRouteId: 'jump-1-hop',
        accessibleRouteId: 'jump-1-walk',
        optional: true,
      },
    ],
    checkpoints: [{ id: 'cp-1', areaId: 'demo-cove' }],
    worldConsequenceId: 'bridge-repaired',
    contentSource: 'MANIFEST',
    ...overrides,
  }) as AdventureDefinition;
}

export const validRealm = {
  id: 'demo-realm',
  version: '1.0.0',
  titleKey: 'realm.demo.title',
  places: [
    { id: 'demo-cove-place', titleKey: 'place.demoCove.title', areaIds: ['demo-cove'] },
    { id: 'demo-hill-place', titleKey: 'place.demoHill.title', areaIds: ['demo-hill'] },
  ],
  ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
  milestoneIds: ['first-bridge'],
  adventureIds: ['demo-adventure'],
};
