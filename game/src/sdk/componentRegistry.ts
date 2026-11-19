/**
 * Component registry: how an adventure registers its own component types without touching
 * engine internals. A type id maps to a factory `(runtime, placement) => entity`. Duplicate
 * type ids are rejected, and placing an unregistered type fails with `UNKNOWN_ID`.
 *
 * Composition, not inheritance: a factory creates an entity in `runtime.world` and attaches
 * components; behaviour belongs in systems the adventure (or a capability) installs.
 */

import type { EntityHandle } from '../core/entities';
import { EngineError } from '../core/errors';
import type { EventMap } from '../core/eventBus';
import type { EngineRuntime } from '../core/runtime';
import type { ComponentPlacement } from './adventure';

export const COMPONENT_TYPE_ID = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

export type ComponentFactory<Entity = EntityHandle> = (runtime: EngineRuntime<EventMap>, placement: ComponentPlacement) => Entity;

export interface ComponentRegistry<Entity = EntityHandle> {
  /** Throws `INVALID_CONFIG` for a malformed id and `DUPLICATE_ID` for one already registered. */
  register(typeId: string, factory: ComponentFactory<Entity>): void;
  has(typeId: string): boolean;
  list(): string[];
  /** Creates one placement. Throws `UNKNOWN_ID` when its type is not registered. */
  create(runtime: EngineRuntime<EventMap>, placement: ComponentPlacement): Entity;
  /** Creates placements in order. Stops at the first failure (the runtime's start disposes). */
  createAll(runtime: EngineRuntime<EventMap>, placements: readonly ComponentPlacement[]): Entity[];
}

export function createComponentRegistry<Entity = EntityHandle>(): ComponentRegistry<Entity> {
  const factories = new Map<string, ComponentFactory<Entity>>();
  const registry: ComponentRegistry<Entity> = {
    register(typeId, factory) {
      if (!COMPONENT_TYPE_ID.test(typeId)) {
        throw new EngineError('INVALID_CONFIG', `Component type id "${typeId}" must be dotted lowerCamel with a namespace`, { typeId });
      }
      if (typeof factory !== 'function') {
        throw new EngineError('INVALID_CONFIG', `Component type "${typeId}" needs a factory function`, { typeId });
      }
      if (factories.has(typeId)) {
        throw new EngineError('DUPLICATE_ID', `Component type "${typeId}" is already registered`, { typeId });
      }
      factories.set(typeId, factory);
    },
    has: (typeId) => factories.has(typeId),
    list: () => [...factories.keys()],
    create(runtime, placement) {
      const factory = factories.get(placement.type);
      if (!factory) {
        throw new EngineError('UNKNOWN_ID', `Component type "${placement.type}" is not registered`, {
          typeId: placement.type,
          placementId: placement.id,
        });
      }
      return factory(runtime, placement);
    },
    createAll: (runtime, placements) => placements.map((placement) => registry.create(runtime, placement)),
  };
  return registry;
}
