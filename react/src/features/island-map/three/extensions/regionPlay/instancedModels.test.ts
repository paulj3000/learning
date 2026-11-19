import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadedModel } from '../../runtime/extensionRegistry';
import { mountInstancedModels, type ModelPlacement } from './instancedModels';

/**
 * TR-PALM-05, TR-ENV-07: the asset library's palms, barrels and logs, instanced. Synthetic
 * models only: no real asset binary is a fixture.
 */

/** A two-part model, like a palm's trunk and crown: 1 m wide, 2 m tall, standing on y = 0. */
function twoPartModel(): LoadedModel & { materials: MeshBasicMaterial[] } {
  const materials = [new MeshBasicMaterial(), new MeshBasicMaterial()];
  const trunk = new Mesh(new BoxGeometry(0.2, 1.5, 0.2).translate(0, 0.75, 0), materials[0]);
  const crown = new Mesh(new BoxGeometry(1, 0.5, 1), materials[1]);
  crown.position.y = 1.75;
  const scene = new Group();
  scene.add(trunk, crown);
  return { scene, animations: [], materials };
}

/** A barrel-like box 0.8 wide, 1 tall, its origin at the middle of the base. */
function barrelModel(): LoadedModel {
  return {
    scene: new Mesh(new BoxGeometry(0.8, 1, 0.8).translate(0, 0.5, 0), new MeshBasicMaterial()),
    animations: [],
  };
}

function matrixAt(mesh: InstancedMesh, index: number) {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, rotation, scale);
  return { position, rotation, scale };
}

const palm = (id: string, x: number, height?: number): ModelPlacement => ({
  id,
  assetId: 'nature-palm-tree-tall',
  x,
  z: -x,
  rotationY: 0.5,
  ...(height !== undefined ? { height } : {}),
});

afterEach(() => vi.restoreAllMocks());

describe('mountInstancedModels', () => {
  it('loads each model once and draws all its placements in one instanced mesh per part', async () => {
    const loadModel = vi.fn(async (_assetId: string) => twoPartModel());
    const drawn = vi.fn();
    const set = mountInstancedModels(
      [palm('a', 1), palm('b', 5), { ...palm('c', 9), assetId: 'nature-palm-tree-small' }],
      loadModel,
      { name: 'palms', onDrawn: drawn },
    );
    await set.settled;
    expect(loadModel).toHaveBeenCalledTimes(2);
    expect(loadModel.mock.calls.map(([id]) => id).sort()).toEqual([
      'nature-palm-tree-small',
      'nature-palm-tree-tall',
    ]);
    const tall = set.root.children.filter((c) => c.name === 'palms:nature-palm-tree-tall');
    expect(tall).toHaveLength(2); // trunk and crown
    for (const mesh of tall) expect((mesh as InstancedMesh).count).toBe(2);
    expect(drawn).toHaveBeenCalledWith('nature-palm-tree-tall', ['a', 'b']);
    expect(drawn).toHaveBeenCalledWith('nature-palm-tree-small', ['c']);
  });

  it('shares the loaded materials and bakes each part into its own geometry clone', async () => {
    const model = twoPartModel();
    const set = mountInstancedModels([palm('a', 0)], async () => model, { name: 'palms' });
    await set.settled;
    const meshes = set.root.children as InstancedMesh[];
    expect(meshes.map((mesh) => mesh.material)).toEqual(model.materials);
    meshes.forEach((mesh) => mesh.geometry.computeBoundingBox());
    const tops = meshes.map((mesh) => mesh.geometry.boundingBox!.max.y);
    expect(tops).toContain(2); // the crown's own offset is baked in
  });

  it('scales a placement to its height and stands it on the ground', async () => {
    const set = mountInstancedModels([palm('a', 3, 6)], async () => twoPartModel(), {
      name: 'palms',
    });
    await set.settled;
    const { position, scale } = matrixAt(set.root.children[0] as InstancedMesh, 0);
    expect(scale.x).toBeCloseTo(3); // a 2 m model drawn 6 m tall
    expect(scale.y).toBeCloseTo(3);
    expect(position.toArray()).toEqual([3, -0, -3].map((v) => expect.closeTo(v, 5)));
  });

  it('uses `scale` when no height is given, and lifts a model whose origin is not its foot', async () => {
    const sunk = (): LoadedModel => ({
      scene: new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()), // centred: y -0.5..0.5
      animations: [],
    });
    const set = mountInstancedModels(
      [{ id: 'log', assetId: 'nature-wood-log', x: 0, z: 0, scale: 0.8 }],
      async () => sunk(),
      { name: 'props' },
    );
    await set.settled;
    const { position, scale } = matrixAt(set.root.children[0] as InstancedMesh, 0);
    expect(scale.x).toBeCloseTo(0.8);
    expect(position.y).toBeCloseTo(0.4); // half of 1 m, scaled: the bottom sits on y = 0
  });

  it('lays a barrel on its side resting on the ground', async () => {
    const set = mountInstancedModels(
      [
        { id: 'up', assetId: 'prop-wooden-barrel', x: 0, z: 0 },
        { id: 'down', assetId: 'prop-wooden-barrel', x: 2, z: 0, rotationZ: Math.PI / 2 },
      ],
      async () => barrelModel(),
      { name: 'props' },
    );
    await set.settled;
    const mesh = set.root.children[0] as InstancedMesh;
    expect(matrixAt(mesh, 0).position.y).toBeCloseTo(0);
    expect(matrixAt(mesh, 1).position.y).toBeCloseTo(0.4); // its radius
    mesh.computeBoundingBox();
    expect(mesh.boundingBox!.min.y).toBeCloseTo(0);
  });

  it('keeps what stands in for a model that fails, says why, and draws nothing for it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const drawn = vi.fn();
    const set = mountInstancedModels(
      [palm('a', 0), { id: 'b', assetId: 'prop-wooden-barrel', x: 1, z: 1 }],
      async (assetId) => {
        if (assetId === 'prop-wooden-barrel') throw new Error('unavailable');
        return twoPartModel();
      },
      { name: 'mixed', onDrawn: drawn },
    );
    await set.settled;
    expect(drawn).toHaveBeenCalledTimes(1);
    expect(drawn).toHaveBeenCalledWith('nature-palm-tree-tall', ['a']);
    expect(set.root.children.every((c) => !c.name.endsWith('prop-wooden-barrel'))).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not draw "prop-wooden-barrel"'),
      expect.any(Error),
    );
  });

  it('refuses a model with no geometry, as a failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const drawn = vi.fn();
    const set = mountInstancedModels(
      [palm('a', 0)],
      async () => ({ scene: new Group(), animations: [] }),
      { name: 'palms', onDrawn: drawn },
    );
    await set.settled;
    expect(drawn).not.toHaveBeenCalled();
    expect(set.root.children).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it('sways only a set built to sway, and only while ticked', async () => {
    const still = mountInstancedModels([palm('a', 0)], async () => twoPartModel(), {
      name: 'props',
    });
    const swaying = mountInstancedModels([palm('a', 0)], async () => twoPartModel(), {
      name: 'palms',
      sway: 0.02,
    });
    await Promise.all([still.settled, swaying.settled]);
    const before = (set: typeof still) =>
      (set.root.children[0] as InstancedMesh).instanceMatrix.array.slice();
    const stillBefore = before(still);
    const swayBefore = before(swaying);
    still.tick(1.3);
    swaying.tick(1.3);
    expect((still.root.children[0] as InstancedMesh).instanceMatrix.array).toEqual(stillBefore);
    const after = (swaying.root.children[0] as InstancedMesh).instanceMatrix.array;
    expect(after).not.toEqual(swayBefore);
    // Subtle: the lean never passes the configured sway.
    const { rotation } = matrixAt(swaying.root.children[0] as InstancedMesh, 0);
    const upright = new Vector3(0, 1, 0).applyQuaternion(rotation);
    expect(upright.angleTo(new Vector3(0, 1, 0))).toBeLessThanOrEqual(0.03);
  });

  it('disposes its own geometries and instance buffers, never the shared materials', async () => {
    const model = twoPartModel();
    const scene = new Scene();
    const set = mountInstancedModels([palm('a', 0), palm('b', 4)], async () => model, {
      name: 'palms',
    });
    scene.add(set.root);
    await set.settled;
    const meshes = [...set.root.children] as InstancedMesh[];
    const geometrySpies = meshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'));
    const meshSpies = meshes.map((mesh) => vi.spyOn(mesh, 'dispose'));
    const materialSpies = model.materials.map((material) => vi.spyOn(material, 'dispose'));
    set.dispose();
    expect(set.root.parent).toBeNull();
    for (const spy of [...geometrySpies, ...meshSpies]) expect(spy).toHaveBeenCalled();
    for (const spy of materialSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('builds nothing for a model that arrives after the scene was left', async () => {
    let finish: (model: LoadedModel) => void = () => {};
    const drawn = vi.fn();
    const set = mountInstancedModels(
      [palm('a', 0)],
      () => new Promise<LoadedModel>((resolve) => (finish = resolve)),
      { name: 'palms', onDrawn: drawn },
    );
    set.dispose();
    finish(twoPartModel());
    await set.settled;
    expect(set.root.children).toHaveLength(0);
    expect(drawn).not.toHaveBeenCalled();
  });
});
