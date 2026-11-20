/**
 * Collision visualization: one coloured wireframe box per collider of a `PhysicsProvider`.
 *
 * Development tooling only (no React, no gameplay rules). The view mirrors the provider: it
 * rebuilds when `provider.onChange` fires and disposes every helper through a `ResourceScope`,
 * so toggling or unmounting leaks nothing. Colour carries the collider kind so a designer can
 * tell a wall from a step from a trigger at a glance: SOLID red, JUMPABLE green, TRIGGER blue,
 * and any `gate` collider yellow regardless of kind.
 */

import { Box3, Box3Helper, Color, Group, Vector3 } from 'three';
import { createResourceScope, type ResourceScope } from '../core/resources';
import type { ColliderKind, ColliderSpec, PhysicsProvider } from '../contracts/physics';

export type ColliderDebugClass = ColliderKind | 'GATE';

export const COLLIDER_DEBUG_COLORS: Readonly<Record<ColliderDebugClass, number>> = Object.freeze({
  SOLID: 0xff4d4d,
  JUMPABLE: 0x4dff88,
  TRIGGER: 0x4da6ff,
  GATE: 0xffd84d,
});

/** The debug class of a collider: gates are shown as gates whatever their kind. */
export function colliderDebugClass(spec: Pick<ColliderSpec, 'kind' | 'gate'>): ColliderDebugClass {
  return spec.gate ? 'GATE' : spec.kind;
}

export function colliderDebugColor(spec: Pick<ColliderSpec, 'kind' | 'gate'>): number {
  return COLLIDER_DEBUG_COLORS[colliderDebugClass(spec)];
}

/** Collider count per debug class, for a legend and for tests. */
export function countCollidersByClass(specs: readonly ColliderSpec[]): Record<ColliderDebugClass, number> {
  const counts: Record<ColliderDebugClass, number> = { SOLID: 0, JUMPABLE: 0, TRIGGER: 0, GATE: 0 };
  for (const spec of specs) {
    counts[colliderDebugClass(spec)] += 1;
  }
  return counts;
}

export interface CollisionDebugView {
  /** Add this to the scene. Its children are the per-collider helpers. */
  readonly group: Group;
  visible: boolean;
  /** Rebuilds from the provider now (also runs on `provider.onChange`). */
  refresh(): void;
  readonly disposed: boolean;
  dispose(): void;
}

export interface CollisionDebugOptions {
  /** Parent scope; the view creates a child so disposing the parent also disposes the view. */
  scope?: ResourceScope;
  visible?: boolean;
}

export function createCollisionDebugView(provider: PhysicsProvider, options: CollisionDebugOptions = {}): CollisionDebugView {
  const own = options.scope ? options.scope.child('collisionDebug') : createResourceScope('collisionDebug');
  const group = new Group();
  group.name = 'debug.collision';
  group.visible = options.visible ?? true;
  let helperScope = own.child('helpers');
  let disposed = false;

  const refresh = () => {
    if (disposed) {
      return;
    }
    helperScope.dispose();
    group.clear();
    helperScope = own.child('helpers');
    for (const spec of provider.colliders()) {
      const box = new Box3(new Vector3(spec.min.x, spec.min.y, spec.min.z), new Vector3(spec.max.x, spec.max.y, spec.max.z));
      const helper = new Box3Helper(box, new Color(colliderDebugColor(spec)));
      helper.name = `debug.collider.${spec.id}`;
      helperScope.track(helper);
      group.add(helper);
    }
  };

  own.track(provider.onChange(refresh));
  refresh();

  return {
    group,
    get visible() {
      return group.visible;
    },
    set visible(value: boolean) {
      group.visible = value;
    },
    refresh,
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      group.removeFromParent();
      group.clear();
      own.dispose();
    },
  };
}
