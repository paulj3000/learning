/**
 * Typed service registry: how the engine reaches the outside world without importing it.
 *
 * The engine never imports React, a Django client or an AWS SDK (ADR-020). Instead the host
 * (React) provides implementations of service **ports** (Asset Manager, Sound Manager, NPC
 * Manager, Question Studio and others, defined in `../services/`) under typed tokens, and
 * engine code asks for them by token. Tests provide fakes the same way.
 */

import { EngineError } from './errors';

export interface ServiceToken<T> {
  readonly id: string;
  readonly __service?: T;
}

export function defineService<T>(id: string): ServiceToken<T> {
  return Object.freeze({ id }) as ServiceToken<T>;
}

export interface ServiceRegistry {
  provide<T>(token: ServiceToken<T>, implementation: T): () => void;
  get<T>(token: ServiceToken<T>): T | undefined;
  /** Throws `MISSING_DEPENDENCY` naming the service when it was not provided. */
  require<T>(token: ServiceToken<T>): T;
  has(token: ServiceToken<unknown>): boolean;
  ids(): string[];
  clear(): void;
}

export function createServiceRegistry(): ServiceRegistry {
  const services = new Map<string, unknown>();
  return {
    provide(token, implementation) {
      if (services.has(token.id)) {
        throw new EngineError('DUPLICATE_ID', `Service "${token.id}" is already provided`, { service: token.id });
      }
      services.set(token.id, implementation);
      return () => {
        if (services.get(token.id) === implementation) {
          services.delete(token.id);
        }
      };
    },
    get: (token) => services.get(token.id) as never,
    require(token) {
      if (!services.has(token.id)) {
        throw new EngineError('MISSING_DEPENDENCY', `Service "${token.id}" was not provided by the host`, {
          service: token.id,
        });
      }
      return services.get(token.id) as never;
    },
    has: (token) => services.has(token.id),
    ids: () => [...services.keys()],
    clear: () => services.clear(),
  };
}
