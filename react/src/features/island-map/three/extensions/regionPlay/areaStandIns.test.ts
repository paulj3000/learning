import { describe, expect, it } from 'vitest';
import { Box3, Mesh, type Object3D } from 'three';
import { STAND_IN_SHAPES } from '../../../../region-play/regionPlayConfig';
import { buildStandIn, type Owned } from './areaStandIns';

const SIZE = { width: 2, height: 3, depth: 1.5 };

function triangles(root: Object3D): number {
  let count = 0;
  root.traverse((node) => {
    if (node instanceof Mesh) {
      const geometry = node.geometry;
      count += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    }
  });
  return count;
}

describe('stand-in shapes', () => {
  it('lists the new shapes in the closed list', () => {
    for (const shape of ['TREE', 'LOG', 'GEAR', 'SWITCH', 'ROCK', 'ARCH']) {
      expect(STAND_IN_SHAPES).toContain(shape);
    }
  });

  it.each(STAND_IN_SHAPES)('%s builds a cheap, owned, grounded group', (shape) => {
    const owned: Owned = { geometries: [], materials: [] };
    const group = buildStandIn(shape, 0xc0502a, SIZE, owned);
    group.updateMatrixWorld(true);
    expect(group.children.length).toBeGreaterThan(0);
    expect(triangles(group)).toBeLessThan(600);
    // Every mesh's geometry and material is handed to the caller to dispose.
    let meshes = 0;
    group.traverse((node) => {
      if (node instanceof Mesh) meshes += 1;
    });
    expect(owned.geometries).toHaveLength(meshes);
    expect(owned.materials).toHaveLength(meshes);
    if (!['TREE', 'LOG', 'GEAR', 'SWITCH', 'ROCK', 'ARCH'].includes(shape)) return;
    const box = new Box3().setFromObject(group);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.3);
    expect(box.max.y).toBeLessThanOrEqual(SIZE.height + 0.4);
  });

  it('gives a GEAR a spinner for the scene to turn', () => {
    const group = buildStandIn('GEAR', 0xc0502a, SIZE, { geometries: [], materials: [] });
    expect(group.getObjectByName('gear-spin')).toBeDefined();
  });

  it('keeps an ARCH open in the middle', () => {
    const group = buildStandIn('ARCH', 0xc0502a, SIZE, { geometries: [], materials: [] });
    const center = new Box3().setFromCenterAndSize(
      { x: 0, y: 0.5, z: 0 } as never,
      { x: 0.2, y: 0.4, z: 0.2 } as never,
    );
    const hit = group.children.some((child) =>
      new Box3().setFromObject(child).intersectsBox(center),
    );
    expect(hit).toBe(false);
  });
});
