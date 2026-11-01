import { Group, InstancedMesh, Matrix4, type Mesh, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  PROCEDURAL_SHAPES,
  tryParseRegionPlayConfig,
  type RegionPlayProceduralConfig,
} from '../../../../region-play/regionPlayConfig';
import {
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
