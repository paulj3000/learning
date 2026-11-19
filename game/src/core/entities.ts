/**
 * Entity and component management.
 *
 * A deliberately small entity-component store, built for composition instead of the deep
 * class hierarchies the per-world scene files grew. An entity is a numeric handle plus an
 * optional **semantic id** (the authored content id, ADR-008: durable state is keyed by
 * semantic ids, never by a Three.js UUID). Components are plain data stored per type; a
 * `ComponentType` token carries the TypeScript type, so `get(entity, Health)` is typed
 * without casts at the call site.
 *
 * Behaviour lives in systems (`systems.ts`), not on entities.
 */

import { EngineError } from './errors';

export type EntityHandle = number & { readonly __entity: unique symbol };

/** A typed component key. Create once per component kind with `defineComponent`. */
export interface ComponentType<T> {
  readonly id: string;
  /** Phantom field: carries `T` for inference only, never read. */
  readonly __type?: T;
}

export function defineComponent<T>(id: string): ComponentType<T> {
  if (!/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/.test(id)) {
    throw new EngineError('INVALID_CONFIG', `Component id "${id}" must be dotted lowerCamel (e.g. "gameplay.collectible")`, {
      id,
    });
  }
  return Object.freeze({ id }) as ComponentType<T>;
}

export interface EntityWorld {
  create(semanticId?: string): EntityHandle;
  destroy(entity: EntityHandle): void;
  exists(entity: EntityHandle): boolean;
  /** Looks up a live entity by its authored semantic id. */
  bySemanticId(semanticId: string): EntityHandle | undefined;
  semanticIdOf(entity: EntityHandle): string | undefined;
  add<T>(entity: EntityHandle, type: ComponentType<T>, value: T): T;
  /** Replaces a component value; the entity must already have it. */
  set<T>(entity: EntityHandle, type: ComponentType<T>, value: T): T;
  get<T>(entity: EntityHandle, type: ComponentType<T>): T | undefined;
  /** Like `get` but throws `UNKNOWN_ID` when absent. */
  require<T>(entity: EntityHandle, type: ComponentType<T>): T;
  has(entity: EntityHandle, type: ComponentType<unknown>): boolean;
  remove(entity: EntityHandle, type: ComponentType<unknown>): boolean;
  /** Entities that have every listed component, in creation order. */
  query(...types: ComponentType<unknown>[]): EntityHandle[];
  /** Live entity count. */
  readonly size: number;
  /** Subscribe to entity destruction (to release resources a system attached). */
  onDestroy(listener: (entity: EntityHandle, semanticId: string | undefined) => void): () => void;
  clear(): void;
}

export function createEntityWorld(): EntityWorld {
  let nextHandle = 1;
  const alive = new Set<EntityHandle>();
  const semanticToEntity = new Map<string, EntityHandle>();
  const entityToSemantic = new Map<EntityHandle, string>();
  const stores = new Map<string, Map<EntityHandle, unknown>>();
  const destroyListeners = new Set<(entity: EntityHandle, semanticId: string | undefined) => void>();

  const assertAlive = (entity: EntityHandle): void => {
    if (!alive.has(entity)) {
      throw new EngineError('UNKNOWN_ID', `Entity ${entity} does not exist`, { entity });
    }
  };
  const storeFor = (type: ComponentType<unknown>): Map<EntityHandle, unknown> => {
    let store = stores.get(type.id);
    if (!store) {
      store = new Map();
      stores.set(type.id, store);
    }
    return store;
  };

  const world: EntityWorld = {
    create(semanticId) {
      if (semanticId !== undefined) {
        if (semanticId.trim() === '') {
          throw new EngineError('INVALID_CONFIG', 'A semantic id must not be empty');
        }
        if (semanticToEntity.has(semanticId)) {
          throw new EngineError('DUPLICATE_ID', `An entity with semantic id "${semanticId}" already exists`, { semanticId });
        }
      }
      const entity = nextHandle++ as EntityHandle;
      alive.add(entity);
      if (semanticId !== undefined) {
        semanticToEntity.set(semanticId, entity);
        entityToSemantic.set(entity, semanticId);
      }
      return entity;
    },
    destroy(entity) {
      if (!alive.has(entity)) {
        return;
      }
      const semanticId = entityToSemantic.get(entity);
      for (const listener of [...destroyListeners]) {
        listener(entity, semanticId);
      }
      alive.delete(entity);
      for (const store of stores.values()) {
        store.delete(entity);
      }
      if (semanticId !== undefined) {
        semanticToEntity.delete(semanticId);
        entityToSemantic.delete(entity);
      }
    },
    exists: (entity) => alive.has(entity),
    bySemanticId: (semanticId) => semanticToEntity.get(semanticId),
    semanticIdOf: (entity) => entityToSemantic.get(entity),
    add(entity, type, value) {
      assertAlive(entity);
      const store = storeFor(type);
      if (store.has(entity)) {
        throw new EngineError('DUPLICATE_ID', `Entity ${entity} already has component "${type.id}"`, {
          entity,
          component: type.id,
        });
      }
      store.set(entity, value);
      return value;
    },
    set(entity, type, value) {
      assertAlive(entity);
      const store = storeFor(type);
      if (!store.has(entity)) {
        throw new EngineError('UNKNOWN_ID', `Entity ${entity} has no component "${type.id}"`, {
          entity,
          component: type.id,
        });
      }
      store.set(entity, value);
      return value;
    },
    get(entity, type) {
      return stores.get(type.id)?.get(entity) as never;
    },
    require(entity, type) {
      const store = stores.get(type.id);
      if (!store || !store.has(entity)) {
        throw new EngineError('UNKNOWN_ID', `Entity ${entity} has no component "${type.id}"`, {
          entity,
          component: type.id,
        });
      }
      return store.get(entity) as never;
    },
    has: (entity, type) => stores.get(type.id)?.has(entity) ?? false,
    remove: (entity, type) => stores.get(type.id)?.delete(entity) ?? false,
    query(...types) {
      if (types.length === 0) {
        return [...alive];
      }
      // Iterate the smallest store, check the rest.
      const typeStores = types.map((t) => stores.get(t.id));
      if (typeStores.some((s) => s === undefined || s.size === 0)) {
        return [];
      }
      const sorted = (typeStores as Map<EntityHandle, unknown>[]).slice().sort((a, b) => a.size - b.size);
      const [smallest, ...rest] = sorted;
      const result: EntityHandle[] = [];
      for (const entity of smallest!.keys()) {
        if (rest.every((s) => s.has(entity))) {
          result.push(entity);
        }
      }
      return result.sort((a, b) => a - b);
    },
    get size() {
      return alive.size;
    },
    onDestroy(listener) {
      destroyListeners.add(listener);
      return () => {
        destroyListeners.delete(listener);
      };
    },
    clear() {
      for (const entity of [...alive]) {
        world.destroy(entity);
      }
    },
  };
  return world;
}
