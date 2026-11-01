import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../../api/parse';
import { coveSceneJson } from '../../test/playFixtures';
import { EMPTY_LAYOUT, readRegionLayout, RegionLayoutError } from './regionLayout';

const plane = {
  kind: 'FLAT_PLANE',
  id: 'sea',
  color: 0x2f86b8,
  area: { id: 'sea:area', minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
  y: 0,
};

function failure(layout: JsonValue): RegionLayoutError {
  try {
    readRegionLayout(layout);
  } catch (error) {
    if (error instanceof RegionLayoutError) return error;
    throw error;
  }
  throw new Error('expected a RegionLayoutError');
}

describe('readRegionLayout (TR-13)', () => {
  it('reads Treasure Cove’s real layout: scenery, colliders, four zones, movers, lights, placeholders', async () => {
    const layout = readRegionLayout((await coveSceneJson()).layout as JsonValue);
    expect(layout.zones.map((zone) => zone.rect.id)).toEqual([
      'cove-zone-landing',
      'cove-zone-grove',
      'cove-zone-beach',
      'cove-zone-ruins',
    ]);
    expect(layout.scenery.length).toBeGreaterThan(40);
    expect(new Set(layout.scenery.map((item) => item.kind))).toEqual(
      new Set(['FLAT_PLANE', 'BOX', 'TILED_GROUND', 'CLUSTER', 'MODEL', 'SCATTER']),
    );
    expect(layout.colliders.map((c) => c.rect.id)).toContain('cove-channel:collider');
    expect(layout.ambient).toHaveLength(4);
    expect(layout.lights).toHaveLength(2);
    expect(layout.procedural.filter((item) => item.shape === 'PALM').length).toBeGreaterThan(20);
    expect(layout.procedural.find((item) => item.id === 'cove-lookout-flag')?.color).toBe(0xf2c94c);
  });

  it('gives an empty layout for a region without one', () => {
    expect(readRegionLayout(undefined)).toEqual(EMPTY_LAYOUT);
  });

  it.each([
    ['a layout that is not an object', [], 'scene.layout'],
    [
      'an unsupported scenery kind',
      { scenery: [{ ...plane, kind: 'VOLCANO' }] },
      'scene.layout.scenery[0].kind',
    ],
    [
      'a missing colour',
      { scenery: [{ ...plane, color: 'blue' }] },
      'scene.layout.scenery[0].color',
    ],
    [
      'an inside-out rectangle',
      { colliders: [{ rect: { id: 'r', minX: 2, maxX: 1, minZ: 0, maxZ: 1 } }] },
      'scene.layout.colliders[0].rect',
    ],
    [
      'a box upside down',
      { scenery: [{ kind: 'BOX', id: 'b', color: 0, area: plane.area, minY: 2, maxY: 1 }] },
      'scene.layout.scenery[0]',
    ],
    [
      'an unknown placeholder shape',
      { procedural: [{ id: 'p', shape: 'DRAGON', x: 0, z: 0 }] },
      'scene.layout.procedural[0].shape',
    ],
    [
      'a mover with two points',
      {
        ambient: [
          {
            kind: 'SPLINE_LOOP',
            id: 'gull',
            path: [
              { x: 0, y: 1, z: 0 },
              { x: 1, y: 1, z: 0 },
            ],
            loopsPerSecond: 0.1,
            appearance: { primitive: 'CONE', color: 0 },
          },
        ],
      },
      'scene.layout.ambient[0].path',
    ],
    ['a list that is not a list', { zones: { rect: {} } }, 'scene.layout.zones'],
  ])('refuses %s, naming where', (_name, layout, path) => {
    expect(failure(layout as JsonValue).path).toBe(path);
  });
});
