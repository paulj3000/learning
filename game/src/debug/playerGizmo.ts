/**
 * Player footprint and ground-probe gizmo, drawn from the canonical `PlayerTransform`.
 *
 * A circle at the feet shows the collision footprint, a vertical line shows the body height,
 * and a downward line is the ground probe (green when grounded, orange in the air). A short
 * line shows the facing (yaw). `computeGizmoPose` is pure so it is tested without a scene.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
} from 'three';
import { createResourceScope, type ResourceScope } from '../core/resources';
import type { EntityWorld } from '../core/entities';
import {
  PLAYER_ENTITY_ID,
  PlayerTransformComponent,
  interpolatePlayerPosition,
  type PlayerTransform,
} from '../contracts/player';

export interface PlayerGizmoOptions {
  radius?: number;
  height?: number;
  probeLength?: number;
  scope?: ResourceScope;
  /** Semantic id of the player entity. Default `PLAYER_ENTITY_ID`. */
  entityId?: string;
}

export interface GizmoPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  grounded: boolean;
}

export const GIZMO_COLORS = Object.freeze({
  grounded: 0x4dff88,
  airborne: 0xffa64d,
  body: 0xffffff,
});

export function computeGizmoPose(transform: PlayerTransform, alpha: number): GizmoPose {
  const p = interpolatePlayerPosition(transform, alpha);
  return { x: p.x, y: p.y, z: p.z, yaw: transform.yaw, grounded: transform.grounded };
}

export interface PlayerGizmo {
  readonly group: Group;
  visible: boolean;
  /** Reads the player's transform from the world; hides the gizmo when there is no player. */
  update(alpha?: number): void;
  dispose(): void;
}

const CIRCLE_SEGMENTS = 24;

export function createPlayerGizmo(
  world: EntityWorld,
  options: PlayerGizmoOptions = {},
): PlayerGizmo {
  const radius = options.radius ?? 0.35;
  const height = options.height ?? 1.6;
  const probeLength = options.probeLength ?? 0.6;
  const scope = options.scope
    ? options.scope.child('playerGizmo')
    : createResourceScope('playerGizmo');
  const entityId = options.entityId ?? PLAYER_ENTITY_ID;

  const group = new Group();
  group.name = 'debug.player';
  group.visible = false;

  const geometryOf = (points: number[]) => {
    const geometry = scope.track(new BufferGeometry());
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    return geometry;
  };

  const ring: number[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
    const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    ring.push(Math.cos(a) * radius, 0.02, Math.sin(a) * radius);
  }
  const bodyMaterial = scope.track(new LineBasicMaterial({ color: GIZMO_COLORS.body }));
  const probeMaterial = scope.track(new LineBasicMaterial({ color: GIZMO_COLORS.grounded }));
  group.add(new LineLoop(geometryOf(ring), bodyMaterial));
  group.add(new Line(geometryOf([0, 0, 0, 0, height, 0]), bodyMaterial));
  group.add(new Line(geometryOf([0, 0.05, 0, 0, 0.05, radius * 1.8]), bodyMaterial));
  group.add(new Line(geometryOf([0, 0, 0, 0, -probeLength, 0]), probeMaterial));

  let disposed = false;
  return {
    group,
    get visible() {
      return group.visible;
    },
    set visible(value: boolean) {
      group.visible = value;
    },
    update(alpha = 1) {
      if (disposed) {
        return;
      }
      const entity = world.bySemanticId(entityId);
      const transform =
        entity === undefined ? undefined : world.get(entity, PlayerTransformComponent);
      if (!transform) {
        group.visible = false;
        return;
      }
      group.visible = true;
      const pose = computeGizmoPose(transform, alpha);
      group.position.set(pose.x, pose.y, pose.z);
      group.rotation.y = pose.yaw;
      probeMaterial.color.setHex(pose.grounded ? GIZMO_COLORS.grounded : GIZMO_COLORS.airborne);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      group.removeFromParent();
      group.clear();
      scope.dispose();
    },
  };
}
