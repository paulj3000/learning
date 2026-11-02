import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Points,
  Scene,
  type BufferAttribute,
} from 'three';
import { describe, expect, it } from 'vitest';
import { buildFireflies, FIREFLIES_NAME, fireflyPosition, shimmerWater, unit } from './livingCove';

const cloud = { id: 'f', x: 10, z: -20, radius: 8, height: 2.5, count: 30 };

describe('fireflyPosition (TR-18)', () => {
  it('keeps every firefly inside its cloud and above the ground, at any time', () => {
    for (let index = 0; index < 60; index += 1) {
      for (const time of [0, 0.7, 5, 123.4, 9999]) {
        const point = fireflyPosition(cloud, index, time);
        expect(Math.hypot(point.x - cloud.x, point.z - cloud.z)).toBeLessThanOrEqual(
          cloud.radius + 1e-9,
        );
        expect(point.y).toBeGreaterThan(0.3);
        expect(point.y).toBeLessThan(cloud.height + 1.3);
      }
    }
  });

  it('gives every firefly its own path, the same one each time', () => {
    const a = fireflyPosition(cloud, 1, 3);
    const b = fireflyPosition(cloud, 2, 3);
    expect(a).not.toEqual(b);
    expect(fireflyPosition(cloud, 1, 3)).toEqual(a);
    expect(unit(4, 2)).toBe(unit(4, 2));
    expect(unit(4, 2)).toBeGreaterThanOrEqual(0);
    expect(unit(4, 2)).toBeLessThan(1);
  });

  it('drifts: a firefly is somewhere else a moment later', () => {
    expect(fireflyPosition(cloud, 3, 0)).not.toEqual(fireflyPosition(cloud, 3, 2));
  });
});

describe('buildFireflies (TR-18)', () => {
  it('is one draw call for every cloud, and moves on tick', () => {
    const scene = new Scene();
    const fireflies = buildFireflies([cloud, { ...cloud, id: 'g', x: -10, count: 10 }], scene);
    const points = scene.getObjectByName(FIREFLIES_NAME) as Points;
    expect(points).toBeInstanceOf(Points);
    const positions = points.geometry.getAttribute('position') as BufferAttribute;
    expect(positions.count).toBe(40);
    const before = positions.array.slice();
    fireflies.tick(1.5);
    expect(positions.array).not.toEqual(before);
    fireflies.dispose();
    expect(scene.getObjectByName(FIREFLIES_NAME)).toBeUndefined();
  });

  it('adds nothing for no clouds', () => {
    const scene = new Scene();
    const fireflies = buildFireflies([], scene);
    fireflies.tick(1);
    fireflies.dispose();
    expect(scene.children).toEqual([]);
  });
});

describe('shimmerWater (TR-18)', () => {
  function water() {
    const shared = new MeshStandardMaterial({ color: 0x2f86b8 });
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), shared));
    return { root, shared };
  }

  it('animates a copy, never the material other scenery may share', () => {
    const { root, shared } = water();
    const before = new Color(shared.color);
    const shimmer = shimmerWater([root, undefined]);
    const mesh = root.children[0] as Mesh;
    expect(mesh.material).not.toBe(shared);
    const start = (mesh.material as MeshStandardMaterial).color.clone();
    shimmer.tick(1.2);
    expect((mesh.material as MeshStandardMaterial).color.equals(start)).toBe(false);
    expect(shared.color.equals(before)).toBe(true);
    shimmer.dispose();
  });

  it('stays within a gentle band of the original colour', () => {
    const { root } = water();
    const shimmer = shimmerWater([root]);
    const base = new Color(0x2f86b8);
    const mesh = root.children[0] as Mesh;
    for (let step = 0; step < 100; step += 1) {
      shimmer.tick(0.37);
      const color = (mesh.material as MeshStandardMaterial).color;
      expect(Math.abs(color.r - base.r) + Math.abs(color.g - base.g)).toBeLessThan(0.2);
    }
  });

  it('does nothing for scenery that is not there', () => {
    const shimmer = shimmerWater([undefined]);
    shimmer.tick(1);
    shimmer.dispose();
  });
});
