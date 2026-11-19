/**
 * Resource lifecycle: scoped, idempotent disposal.
 *
 * Every GPU or DOM resource the engine creates (geometries, materials, textures, render
 * targets, listeners, timers, loaded asset handles) is registered with a `ResourceScope`.
 * Disposing a scope disposes its children first, then its own resources in reverse
 * registration order (the inverse of construction, like a stack), exactly once. A scope per
 * scene, per adventure and per entity gives the "dispose on unmount" guarantee LAI-2103
 * requires without each world hand-writing teardown.
 *
 * Errors thrown by one disposer are collected and reported after the rest have run, so one
 * bad resource cannot leak the others.
 */

import { EngineError } from './errors';

export interface Disposable {
  dispose(): void;
}

export type Disposer = Disposable | (() => void);

export interface ResourceScope {
  readonly name: string;
  readonly disposed: boolean;
  /** Registers a resource; returns it for chaining (`const g = scope.track(new BoxGeometry())`). */
  track<T extends Disposer>(resource: T): T;
  /** Removes a resource without disposing it (ownership moved elsewhere). */
  release(resource: Disposer): boolean;
  /** Creates a child scope disposed before this scope's own resources. */
  child(name: string): ResourceScope;
  /** Live resources in this scope and its children (diagnostics and leak tests). */
  count(): number;
  dispose(): void;
}

export interface ResourceScopeOptions {
  /** Receives disposer errors after a dispose pass. Default: throws an AggregateError. */
  onDisposeErrors?: (errors: readonly unknown[], scopeName: string) => void;
}

function runDisposer(resource: Disposer): void {
  if (typeof resource === 'function') {
    resource();
  } else {
    resource.dispose();
  }
}

export function createResourceScope(name: string, options: ResourceScopeOptions = {}): ResourceScope {
  const resources: Disposer[] = [];
  const children: ResourceScope[] = [];
  let disposed = false;

  const reportErrors =
    options.onDisposeErrors ??
    ((errors: readonly unknown[], scopeName: string) => {
      throw new AggregateError(errors, `Disposing resource scope "${scopeName}" failed`);
    });

  const scope: ResourceScope = {
    name,
    get disposed() {
      return disposed;
    },
    track(resource) {
      if (disposed) {
        // Never hold a resource in a dead scope: dispose it now so it cannot leak.
        runDisposer(resource);
        throw new EngineError('DISPOSED', `Resource scope "${name}" is disposed`, { scope: name });
      }
      resources.push(resource);
      return resource;
    },
    release(resource) {
      const index = resources.lastIndexOf(resource);
      if (index < 0) {
        return false;
      }
      resources.splice(index, 1);
      return true;
    },
    child(childName) {
      if (disposed) {
        throw new EngineError('DISPOSED', `Resource scope "${name}" is disposed`, { scope: name });
      }
      const created = createResourceScope(`${name}/${childName}`, options);
      children.push(created);
      return created;
    },
    count() {
      return resources.length + children.reduce((sum, c) => sum + (c.disposed ? 0 : c.count()), 0);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      const errors: unknown[] = [];
      for (const child of children.splice(0).reverse()) {
        try {
          child.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      for (const resource of resources.splice(0).reverse()) {
        try {
          runDisposer(resource);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        reportErrors(errors, name);
      }
    },
  };
  return scope;
}
