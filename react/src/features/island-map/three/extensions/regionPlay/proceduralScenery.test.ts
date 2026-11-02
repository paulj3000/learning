import { Box3, Group, InstancedMesh, Matrix4, type Mesh, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  PROCEDURAL_SHAPES,
  tryParseRegionPlayConfig,
  type RegionPlayProceduralConfig,
} from '../../../../region-play/regionPlayConfig';
import {
  BRIDGE_WIDTH,
  buildProceduralScenery,
  GATE_BARS_NAME,
  PALM_TRUNKS_NAME,
  proceduralRoot,
} from './proceduralScenery';

/** One of every shape, two palms, a gold flag. */
const ENTRIES: RegionPlayProceduralConfig[] = [
  ...PROCEDURAL_SHAPES.filter((shape) => shape !== 'PALM').map((shape, index) => ({
    id: `p-${shape.toLowerCase()}`,
    shape,
    x: index * 3,
    z: 0,
    ...(shape === 'BRIDGE' ? { height: 5.6 } : {}),
  })),
  { id: 'palm-a', shape: 'PALM', x: -5, z: 0, height: 5 },
  { id: 'palm-b', shape: 'PALM', x: -8, z: 2, rotationY: 1 },
  { id: 'gold-flag', shape: 'FLAG', x: 0, z: 9, height: 7, color: 0xf2c94c },
];

function matrixAt(mesh: InstancedMesh, index: number): number[] {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix.toArray();
}

describe('procedural placeholders (TR-13)', () => {
  it('draws every shape where the layout puts it', () => {
    const scenery = buildProceduralScenery(ENTRIES);
    for (const entry of ENTRIES.filter((item) => item.shape !== 'PALM')) {
      const root = proceduralRoot(scenery.root, entry.id);
      expect(root, entry.id).toBeDefined();
      expect(root?.position.x).toBe(entry.x);
      expect(root?.children.length, entry.id).toBeGreaterThan(0);
    }
    expect(proceduralRoot(scenery.root, 'p-gate')?.getObjectByName(GATE_BARS_NAME)).toBeDefined();
  });

  it('reads the TR-17 and TR-20 shapes from a config', () => {
    for (const shape of ['BROKEN_PLANKS', 'BRIDGE', 'LANTERNS', 'SPYGLASS'] as const) {
      expect(PROCEDURAL_SHAPES).toContain(shape);
    }
  });

  it('instances the palms, each standing at its own spot and height', () => {
    const scenery = buildProceduralScenery(ENTRIES);
    const trunks = scenery.root.getObjectByName(PALM_TRUNKS_NAME) as InstancedMesh;
    expect(trunks).toBeInstanceOf(InstancedMesh);
    expect(trunks.count).toBe(2);
    const first = new Matrix4().fromArray(matrixAt(trunks, 0));
    const position = { x: first.elements[12], z: first.elements[14] };
    expect(position).toEqual({ x: -5, z: 0 });
  });

  it('animates on tick: palms sway, flames flicker, the boat bobs', () => {
    const scenery = buildProceduralScenery(ENTRIES);
    const trunks = scenery.root.getObjectByName(PALM_TRUNKS_NAME) as InstancedMesh;
    const boat = proceduralRoot(scenery.root, 'p-rowboat')?.children[0] as Group;
    const torch = proceduralRoot(scenery.root, 'p-torch') as Group;
    const flames = torch.children.at(-1) as Group;
    const before = { palm: matrixAt(trunks, 0), boat: boat.position.y, flame: flames.scale.y };
    scenery.tick(0.4);
    expect(matrixAt(trunks, 0)).not.toEqual(before.palm);
    expect(boat.position.y).not.toBe(before.boat);
    expect(flames.scale.y).not.toBe(before.flame);
  });

  it('tints what the layout colours, and shares materials between same-coloured parts', () => {
    const scenery = buildProceduralScenery(ENTRIES);
    const cloth = (id: string) => {
      const flag = proceduralRoot(scenery.root, id) as Group;
      return ((flag.children[1] as Group).children[0] as Mesh).material as MeshStandardMaterial;
    };
    expect(cloth('gold-flag').color.getHex()).toBe(0xf2c94c);
    expect(cloth('p-flag').color.getHex()).toBe(0x1d1d1d);
    const torchPoleMaterial = (
      (proceduralRoot(scenery.root, 'p-torch') as Group).children[0] as Mesh
    ).material;
    const flagPoleMaterial = ((proceduralRoot(scenery.root, 'p-flag') as Group).children[0] as Mesh)
      .material;
    expect(torchPoleMaterial).toBe(flagPoleMaterial);
  });

  it('lays the bridge the width of the gap the channel leaves, as long as asked (TR-17)', () => {
    const scenery = buildProceduralScenery([
      { id: 'bridge', shape: 'BRIDGE', x: 0, z: -37.9, height: 5.6 },
    ]);
    const box = new Box3().setFromObject(proceduralRoot(scenery.root, 'bridge') as Group);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(BRIDGE_WIDTH + 1e-5);
    expect(box.max.x - box.min.x).toBeGreaterThan(BRIDGE_WIDTH - 0.3);
    // The posts at each end add their own radius to the 5.6 m deck.
    expect(box.max.z - box.min.z).toBeGreaterThanOrEqual(5.55);
    expect(box.max.z - box.min.z).toBeLessThan(5.9);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.1);
    expect(box.max.y).toBeLessThan(1.5); // rails, not walls
  });

  it('shows and hides a placeholder by id, and ignores an unknown one (TR-17)', () => {
    const scenery = buildProceduralScenery(ENTRIES);
    const planks = proceduralRoot(scenery.root, 'p-broken_planks') as Group;
    scenery.setVisible('p-broken_planks', false);
    expect(planks.visible).toBe(false);
    scenery.setVisible('p-broken_planks', true);
    expect(planks.visible).toBe(true);
    expect(() => scenery.setVisible('nothing', false)).not.toThrow();
  });

  it('lifts a gate’s bars over about a second, or at once, and refuses what is not a gate (TR-17)', () => {
    const scenery = buildProceduralScenery(ENTRIES);
    const bars = proceduralRoot(scenery.root, 'p-gate')?.getObjectByName(GATE_BARS_NAME) as Mesh;
    expect(scenery.liftGate('p-gate', false)).toBe(true);
    scenery.tick(0.5);
    expect(bars.position.y).toBeGreaterThan(0);
    expect(bars.visible).toBe(true);
    scenery.tick(2);
    expect(bars.visible).toBe(false); // clear of the lintel
    expect(scenery.liftGate('p-tent', false)).toBe(false);
    expect(scenery.liftGate('nothing', true)).toBe(false);

    const instant = buildProceduralScenery(ENTRIES);
    const other = proceduralRoot(instant.root, 'p-gate')?.getObjectByName(GATE_BARS_NAME) as Mesh;
    instant.liftGate('p-gate', true);
    expect(other.visible).toBe(false);
  });

  it('puts the spyglass on a tripod pointing out over the sea, with a lens that glows (TR-20)', () => {
    const scenery = buildProceduralScenery([{ id: 'spy', shape: 'SPYGLASS', x: 2.6, z: -41.6 }]);
    const root = proceduralRoot(scenery.root, 'spy') as Group;
    expect(root.children.length).toBeGreaterThanOrEqual(3);
    const box = new Box3().setFromObject(root);
    expect(box.min.z).toBeLessThan(-0.5); // the tube reaches toward -z, out to sea
    expect(box.max.y).toBeGreaterThan(1.2);
  });

  it('takes itself out of the scene on dispose', () => {
    const parent = new Group();
    const scenery = buildProceduralScenery(ENTRIES);
    parent.add(scenery.root);
    scenery.dispose();
    expect(parent.children).toEqual([]);
  });

  it('builds nothing for an empty list', () => {
    const scenery = buildProceduralScenery([]);
    expect(scenery.root.children).toEqual([]);
    scenery.tick(1);
  });
});

describe('region-play config: procedural entries', () => {
  const base = { chests: [], figures: [], interactions: [] };

  it('reads them, and treats a config from before TR-13 as having none', () => {
    expect(tryParseRegionPlayConfig(base)?.procedural).toEqual([]);
    expect(
      tryParseRegionPlayConfig({
        ...base,
        procedural: [{ id: 'p', shape: 'TENT', x: 1, z: 2, rotationY: 0.4, color: 0xffffff }],
      })?.procedural,
    ).toEqual([{ id: 'p', shape: 'TENT', x: 1, z: 2, rotationY: 0.4, color: 0xffffff }]);
  });

  it('refuses the whole config for an unknown shape, as it does any unreadable entry', () => {
    expect(
      tryParseRegionPlayConfig({ ...base, procedural: [{ id: 'p', shape: 'DRAGON', x: 0, z: 0 }] }),
    ).toBeNull();
  });
});

describe('region-play config: unlock and ambience (TR-17, TR-18)', () => {
  const base = { chests: [], figures: [], interactions: [] };
  const unlock = {
    changeKey: 'TREASURE_COVE_QUEST_COMPLETE',
    unlocked: false,
    openColliders: ['gate:collider'],
    showWhenOpen: ['bridge'],
    hideWhenOpen: ['planks'],
    liftGates: ['gate'],
  };
  const cloud = { id: 'f', x: 0, z: 0, radius: 4, height: 2, count: 12 };

  it('reads them, and treats a config from before them as having neither', () => {
    expect(tryParseRegionPlayConfig(base)?.unlock).toBeUndefined();
    expect(tryParseRegionPlayConfig(base)?.ambience).toBeUndefined();
    expect(tryParseRegionPlayConfig({ ...base, unlock })?.unlock).toEqual(unlock);
    expect(
      tryParseRegionPlayConfig({ ...base, ambience: { water: ['sea'], fireflies: [cloud] } })
        ?.ambience,
    ).toEqual({ water: ['sea'], fireflies: [cloud] });
  });

  it('refuses the whole config for an unreadable unlock, as it does any unreadable entry', () => {
    expect(
      tryParseRegionPlayConfig({ ...base, unlock: { ...unlock, unlocked: 'yes' } }),
    ).toBeNull();
    expect(tryParseRegionPlayConfig({ ...base, unlock: { ...unlock, changeKey: '' } })).toBeNull();
    expect(
      tryParseRegionPlayConfig({ ...base, unlock: { ...unlock, openColliders: [1] } }),
    ).toBeNull();
    expect(tryParseRegionPlayConfig({ ...base, unlock: 'open' })).toBeNull();
  });

  it('refuses unreadable fireflies, and a cloud too big to be a cloud', () => {
    for (const bad of [
      { ...cloud, radius: 0 },
      { ...cloud, count: 0 },
      { ...cloud, count: 1.5 },
      { ...cloud, count: 100000 },
      { ...cloud, id: '' },
    ]) {
      expect(
        tryParseRegionPlayConfig({ ...base, ambience: { water: [], fireflies: [bad] } }),
      ).toBeNull();
    }
    expect(
      tryParseRegionPlayConfig({ ...base, ambience: { water: [1], fireflies: [] } }),
    ).toBeNull();
  });

  it('knows a replay chest when it reads one', () => {
    const chest = {
      entityId: 'spy',
      assetId: null,
      openClip: null,
      isOpen: false,
      scale: 1,
      placeholder: { width: 1, height: 1, depth: 1 },
      presentation: 'REPLAY',
    };
    expect(tryParseRegionPlayConfig({ ...base, chests: [chest] })?.chests[0]?.presentation).toBe(
      'REPLAY',
    );
  });
});
