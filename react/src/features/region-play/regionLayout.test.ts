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
  it('reads Treasure Cove’s jumpable barrels with their real height (LAI-JMP-01)', async () => {
    const layout = readRegionLayout((await coveSceneJson()).layout as JsonValue);
    const barrels = layout.colliders.filter((c) => c.rect.id.startsWith('cove-landing-barrel-'));
    expect(barrels).toHaveLength(4);
    for (const barrel of barrels)
      expect(barrel).toMatchObject({ minY: 0, maxY: 0.9, jumpable: true });
    // The gate and the channel stay solid walls.
    const gate = layout.colliders.find((c) => c.rect.id === 'cove-ruins-gate:collider');
    expect(gate?.jumpable).toBeUndefined();
  });

  it('reads collider heights and refuses a jumpable flag that is not a boolean (LAI-JMP-01)', () => {
    const rect = { id: 'r', minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
    expect(
      readRegionLayout({ colliders: [{ rect, minY: 0, maxY: 0.5, jumpable: true }] }).colliders,
    ).toEqual([{ rect, minY: 0, maxY: 0.5, jumpable: true }]);
    expect(readRegionLayout({ colliders: [{ rect }] }).colliders).toEqual([{ rect }]);
    expect(failure({ colliders: [{ rect, jumpable: 'yes' }] }).path).toBe(
      'scene.layout.colliders[0].jumpable',
    );
  });

  it('reads Treasure Cove’s real layout: scenery, colliders, five zones, movers, lights, placeholders', async () => {
    const layout = readRegionLayout((await coveSceneJson()).layout as JsonValue);
    expect(layout.zones.map((zone) => zone.rect.id)).toEqual([
      'cove-zone-landing',
      'cove-zone-grove',
      'cove-zone-beach',
      'cove-zone-ruins',
      'cove-zone-lookout',
    ]);
    expect(layout.scenery.length).toBeGreaterThan(40);
    expect(new Set(layout.scenery.map((item) => item.kind))).toEqual(
      new Set(['FLAT_PLANE', 'BOX', 'TILED_GROUND', 'CLUSTER', 'MODEL', 'SCATTER']),
    );
    expect(layout.colliders.map((c) => c.rect.id)).toEqual(
      expect.arrayContaining([
        'cove-channel-west:collider',
        'cove-channel-gap:collider',
        'cove-channel-east:collider',
      ]),
    );
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

describe('the unlock and ambience blocks (TR-17, TR-18)', () => {
  const unlock = {
    changeKey: 'TREASURE_COVE_QUEST_COMPLETE',
    openColliders: ['gate:collider', 'gap:collider'],
    showWhenOpen: ['bridge'],
    hideWhenOpen: ['planks'],
    liftGates: ['gate'],
  };

  it('reads Treasure Cove’s real unlock: the gate and the gap open, the bridge appears', async () => {
    const layout = readRegionLayout((await coveSceneJson()).layout as JsonValue);
    expect(layout.unlock).toEqual({
      changeKey: 'TREASURE_COVE_QUEST_COMPLETE',
      openColliders: ['cove-ruins-gate:collider', 'cove-channel-gap:collider'],
      showWhenOpen: ['cove-bridge', 'cove-lookout-lanterns'],
      hideWhenOpen: ['cove-broken-bridge'],
      liftGates: ['cove-ruins-gate'],
    });
    // Every id it names exists in the layout, so nothing is opened that is not there.
    const colliders = layout.colliders.map((c) => c.rect.id);
    const procedural = layout.procedural.map((p) => p.id);
    for (const id of layout.unlock?.openColliders ?? []) expect(colliders).toContain(id);
    for (const id of [
      ...(layout.unlock?.showWhenOpen ?? []),
      ...(layout.unlock?.hideWhenOpen ?? []),
      ...(layout.unlock?.liftGates ?? []),
    ]) {
      expect(procedural).toContain(id);
    }
  });

  it('reads Treasure Cove’s real ambience: three bodies of water and three clouds of fireflies', async () => {
    const layout = readRegionLayout((await coveSceneJson()).layout as JsonValue);
    expect(layout.ambience?.water).toHaveLength(3);
    expect(layout.ambience?.fireflies.map((cloud) => cloud.id)).toEqual([
      'cove-fireflies-grove',
      'cove-fireflies-ruins',
      'cove-fireflies-lookout',
    ]);
  });

  it('has neither block unless the layout says so', () => {
    const layout = readRegionLayout({ scenery: [plane] });
    expect(layout.unlock).toBeUndefined();
    expect(layout.ambience).toBeUndefined();
  });

  it('names the path of a malformed unlock', () => {
    expect(failure({ unlock: { ...unlock, changeKey: '' } }).path).toBe(
      'scene.layout.unlock.changeKey',
    );
    expect(failure({ unlock: { ...unlock, openColliders: [3] } }).path).toBe(
      'scene.layout.unlock.openColliders[0]',
    );
    expect(failure({ unlock: 'open' }).path).toBe('scene.layout.unlock');
  });

  it('names the path of malformed fireflies, and refuses a cloud that is too big', () => {
    const cloud = { id: 'f', x: 0, z: 0, radius: 3, height: 2, count: 10 };
    expect(failure({ ambience: { water: [], fireflies: [{ ...cloud, radius: 0 }] } }).path).toBe(
      'scene.layout.ambience.fireflies[0].radius',
    );
    expect(failure({ ambience: { water: [], fireflies: [{ ...cloud, count: 2.5 }] } }).path).toBe(
      'scene.layout.ambience.fireflies[0].count',
    );
    expect(failure({ ambience: { water: [], fireflies: [{ ...cloud, count: 5000 }] } }).path).toBe(
      'scene.layout.ambience.fireflies[0].count',
    );
  });
});
