/**
 * Collectibles: a pickup radius on x/z, once per visit, optional set id.
 *
 * The engine detects the pickup and emits `collectible.collected` as a CLAIM. Whether the
 * child keeps anything is Django's decision, recorded once per source record (scoring
 * standard); a collectible is hidden here after one pickup either way. No random drops: the
 * layout is authored.
 */

import { defineComponent } from '../core/entities';
import { defineService } from '../core/services';
import type { CapabilityDefinition } from '../core/capabilities';
import type { Vec3Like } from '../contracts/player';
import { emitClaim, emitPresentation, entityKey, playerPosition, type GameplayRuntime } from './common';
import { configRoot, Issues } from './validate';

export interface CollectibleSpec {
  id: string;
  position: Vec3Like;
  /** Pickup radius on x/z, metres. Forgiving by default for small hands. */
  pickupRadius: number;
  setId: string | null;
  /** Feet may be this far above or below the collectible (it can sit on a platform). */
  verticalReach: number;
}

export interface CollectibleState {
  spec: CollectibleSpec;
  collected: boolean;
}
export const CollectibleComponent = defineComponent<CollectibleState>('gameplay.collectible');

export interface CollectiblesConfig {
  collectibles: CollectibleSpec[];
  /** Ids already collected earlier (the host knows from Django); shown as gone, no claim. */
  alreadyCollected: string[];
}

export interface CollectiblesApi {
  isCollected(id: string): boolean;
  collectedIds(): string[];
  remaining(): number;
  /** Starts a fresh visit: everything is available again. */
  resetVisit(): void;
}
export const CollectiblesService = defineService<CollectiblesApi>('gameplay.collectibles');

export const COLLECTIBLE_LIMITS = { minRadius: 0.3, maxRadius: 3, maxCount: 512 } as const;

export function validateCollectiblesConfig(input: unknown) {
  const issues = new Issues();
  const root = configRoot(input, issues);
  const collectibles = issues.records(
    root.collectibles,
    'collectibles',
    (item, path): CollectibleSpec => ({
      id: issues.id(item.id, `${path}.id`),
      position: issues.vec3(item.position, `${path}.position`),
      pickupRadius: issues.num(item.pickupRadius, `${path}.pickupRadius`, COLLECTIBLE_LIMITS.minRadius, COLLECTIBLE_LIMITS.maxRadius, 1),
      setId: issues.optionalId(item.setId, `${path}.setId`) ?? null,
      verticalReach: issues.num(item.verticalReach, `${path}.verticalReach`, 0.5, 6, 2),
    }),
    (c) => c.id,
    COLLECTIBLE_LIMITS.maxCount,
  );
  const alreadyCollected = Array.isArray(root.alreadyCollected) ? root.alreadyCollected.map((v, i) => issues.id(v, `alreadyCollected[${i}]`)) : [];
  return issues.result<CollectiblesConfig>({ collectibles, alreadyCollected });
}

export const COLLECTIBLES_CAPABILITY_ID = 'gameplay.collectibles';

export const collectiblesCapability: CapabilityDefinition<CollectiblesConfig, GameplayRuntime> = {
  id: COLLECTIBLES_CAPABILITY_ID,
  version: '1.0.0',
  description: 'Pickup-radius collectibles, once per visit, emitting collectible.collected claims.',
  defaults: { collectibles: [], alreadyCollected: [] },
  validate: validateCollectiblesConfig,
  install(runtime, config) {
    const { world } = runtime;
    const initial = new Set(config.alreadyCollected);
    for (const spec of config.collectibles) {
      world.add(world.create(entityKey('collectible', spec.id)), CollectibleComponent, { spec, collected: initial.has(spec.id) });
    }
    const all = () => world.query(CollectibleComponent).map((e) => world.get(e, CollectibleComponent)!);
    const api: CollectiblesApi = {
      isCollected: (id) => all().find((s) => s.spec.id === id)?.collected ?? false,
      collectedIds: () => all().filter((s) => s.collected).map((s) => s.spec.id),
      remaining: () => all().filter((s) => !s.collected).length,
      resetVisit() {
        for (const state of all()) {
          state.collected = false;
        }
      },
    };
    const removeService = runtime.services.provide(CollectiblesService, api);
    runtime.systems.add({
      id: 'gameplay.collectibles',
      phase: 'simulation',
      update() {
        const player = playerPosition(runtime);
        if (!player) {
          return;
        }
        for (const state of all()) {
          if (state.collected) {
            continue;
          }
          const { spec } = state;
          if (Math.hypot(player.x - spec.position.x, player.z - spec.position.z) <= spec.pickupRadius && Math.abs(player.y - spec.position.y) <= spec.verticalReach) {
            state.collected = true;
            emitPresentation(runtime, 'CollectiblePickedUp', { collectibleId: spec.id });
            emitClaim(runtime, 'collectible.collected', { collectibleId: spec.id, setId: spec.setId });
          }
        }
      },
    });
    return () => {
      runtime.systems.remove('gameplay.collectibles');
      removeService();
    };
  },
};
