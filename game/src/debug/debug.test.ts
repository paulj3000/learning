import { Box3Helper, Color } from 'three';
import { describe, expect, it } from 'vitest';
import { createDiagnostics } from '../core/diagnostics';
import { createEntityWorld } from '../core/entities';
import { createResourceScope } from '../core/resources';
import type { ColliderSpec, PhysicsProvider } from '../contracts/physics';
import {
  PLAYER_ENTITY_ID,
  PlayerTransformComponent,
  createPlayerTransform,
} from '../contracts/player';
import {
  COLLIDER_DEBUG_COLORS,
  GIZMO_COLORS,
  colliderDebugClass,
  colliderDebugColor,
  computeGizmoPose,
  countCollidersByClass,
  createCollisionDebugView,
  createPlayerGizmo,
  createRendererStatsCollector,
  readRendererStats,
} from './index';

function fakeProvider(
  initial: ColliderSpec[],
): PhysicsProvider & { add(spec: ColliderSpec): void; listeners: number } {
  const specs = [...initial];
  const listeners = new Set<() => void>();
  const notify = () => [...listeners].forEach((l) => l());
  return {
    id: 'fake',
    addCollider(spec) {
      specs.push(spec);
      notify();
    },
    add(spec) {
      this.addCollider(spec);
    },
    updateCollider() {},
    removeCollider(id) {
      const i = specs.findIndex((s) => s.id === id);
      if (i >= 0) specs.splice(i, 1);
      notify();
      return i >= 0;
    },
    hasCollider: (id) => specs.some((s) => s.id === id),
    getCollider: (id) => specs.find((s) => s.id === id),
    colliders: () => specs,
    raycast: () => null,
    overlaps: () => [],
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get listeners() {
      return listeners.size;
    },
  };
}

const box = (id: string, kind: ColliderSpec['kind'], gate = false): ColliderSpec => ({
  id,
  kind,
  gate,
  min: { x: 0, y: 0, z: 0 },
  max: { x: 1, y: 1, z: 1 },
});

describe('collision debug', () => {
  it('colour codes every collider class and lets gates win over kind', () => {
    expect(colliderDebugClass(box('a', 'SOLID'))).toBe('SOLID');
    expect(colliderDebugClass(box('g', 'SOLID', true))).toBe('GATE');
    expect(colliderDebugColor(box('j', 'JUMPABLE'))).toBe(COLLIDER_DEBUG_COLORS.JUMPABLE);
    expect(new Set(Object.values(COLLIDER_DEBUG_COLORS)).size).toBe(4);
    expect(
      countCollidersByClass([box('a', 'SOLID'), box('b', 'TRIGGER'), box('g', 'JUMPABLE', true)]),
    ).toEqual({
      SOLID: 1,
      JUMPABLE: 0,
      TRIGGER: 1,
      GATE: 1,
    });
  });

  it('builds a helper per collider with the right colour and rebuilds on provider change', () => {
    const provider = fakeProvider([box('wall', 'SOLID'), box('gate', 'SOLID', true)]);
    const view = createCollisionDebugView(provider);
    expect(view.group.children).toHaveLength(2);
    const wall = view.group.children[0] as Box3Helper;
    expect(wall).toBeInstanceOf(Box3Helper);
    expect((wall.material as unknown as { color: Color }).color.getHex()).toBe(
      COLLIDER_DEBUG_COLORS.SOLID,
    );
    provider.add(box('step', 'JUMPABLE'));
    expect(view.group.children).toHaveLength(3);
    view.dispose();
  });

  it('disposes helpers and unsubscribes, and is idempotent', () => {
    const provider = fakeProvider([box('wall', 'SOLID')]);
    const parent = createResourceScope('test');
    const view = createCollisionDebugView(provider, { scope: parent });
    expect(provider.listeners).toBe(1);
    expect(parent.count()).toBeGreaterThan(0);
    view.dispose();
    view.dispose();
    expect(provider.listeners).toBe(0);
    expect(view.group.children).toHaveLength(0);
    provider.add(box('late', 'SOLID'));
    expect(view.group.children).toHaveLength(0);
    parent.dispose();
  });

  it('toggles visibility', () => {
    const view = createCollisionDebugView(fakeProvider([]), { visible: false });
    expect(view.visible).toBe(false);
    view.visible = true;
    expect(view.group.visible).toBe(true);
    view.dispose();
  });
});

describe('player gizmo', () => {
  it('computes an interpolated pose', () => {
    const t = {
      ...createPlayerTransform({ x: 2, y: 0, z: 0 }),
      previousPosition: { x: 0, y: 0, z: 0 },
      yaw: 1,
    };
    expect(computeGizmoPose(t, 0.5)).toEqual({ x: 1, y: 0, z: 0, yaw: 1, grounded: true });
  });

  it('hides without a player, follows the transform and colours the probe by grounding', () => {
    const world = createEntityWorld();
    const gizmo = createPlayerGizmo(world);
    gizmo.update();
    expect(gizmo.group.visible).toBe(false);
    const entity = world.create(PLAYER_ENTITY_ID);
    world.add(entity, PlayerTransformComponent, createPlayerTransform({ x: 3, y: 1, z: -2 }));
    gizmo.update(1);
    expect(gizmo.group.visible).toBe(true);
    expect(gizmo.group.position.toArray()).toEqual([3, 1, -2]);
    world.set(entity, PlayerTransformComponent, {
      ...createPlayerTransform({ x: 3, y: 2, z: -2 }),
      grounded: false,
    });
    gizmo.update(1);
    const probe = gizmo.group.children[3] as unknown as { material: { color: Color } };
    expect(probe.material.color.getHex()).toBe(GIZMO_COLORS.airborne);
    gizmo.dispose();
    gizmo.dispose();
    expect(gizmo.group.children).toHaveLength(0);
  });
});

describe('renderer stats', () => {
  const renderer = {
    info: { render: { calls: 7, triangles: 1200 }, memory: { geometries: 4, textures: 2 } },
  };

  it('reads renderer.info', () => {
    expect(readRendererStats(renderer)).toEqual({
      drawCalls: 7,
      triangles: 1200,
      geometries: 4,
      textures: 2,
    });
  });

  it('writes gauges into diagnostics, and nothing when diagnostics are off', () => {
    const diagnostics = createDiagnostics();
    createRendererStatsCollector(renderer, diagnostics).collect();
    expect(diagnostics.snapshot().gauges).toMatchObject({
      'renderer.drawCalls': 7,
      'renderer.triangles': 1200,
      'renderer.geometries': 4,
      'renderer.textures': 2,
    });
    const off = createDiagnostics({ enabled: false });
    createRendererStatsCollector(renderer, off).collect();
    expect(off.snapshot().gauges).toEqual({});
  });
});
