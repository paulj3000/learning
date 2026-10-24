import {
  AnimationMixer,
  type AnimationClip,
  type Bone,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { describe, expect, it } from 'vitest';
import { instantiateAsset, loadAsset } from './assetLoader';
import { cloneAssetScene, containsSkinnedMesh } from './cloneAsset';

/**
 * LAI-2106: skeleton-safe cloning, proven against the real bundled rig
 * (`npc-harbor-master`: one skin, 62 joints, four skinned meshes) through
 * the real fetch-based `GLTFLoader.load()` path in jsdom. This checks the
 * scene graph and bone transforms, not pixels: no WebGL renderer runs here.
 */

function skinnedMeshesOf(root: Object3D): SkinnedMesh[] {
  const meshes: SkinnedMesh[] = [];
  root.traverse((child) => {
    if ((child as SkinnedMesh).isSkinnedMesh) meshes.push(child as SkinnedMesh);
  });
  return meshes;
}

function isInside(node: Object3D, root: Object3D): boolean {
  for (let current: Object3D | null = node; current; current = current.parent) {
    if (current === root) return true;
  }
  return false;
}

/** Every skinned mesh's bones, read through its skeleton, as the renderer would. */
function bonePose(root: Object3D): number[] {
  return skinnedMeshesOf(root).flatMap((mesh) =>
    mesh.skeleton.bones.flatMap((bone: Bone) => bone.quaternion.toArray()),
  );
}

function play(
  model: Object3D,
  clipName: string,
  seconds: number,
  clips: readonly AnimationClip[],
): AnimationMixer {
  const mixer = new AnimationMixer(model);
  const clip = clips.find((candidate) => candidate.name === clipName);
  if (!clip) throw new Error(`no clip ${clipName}`);
  mixer.clipAction(clip).play();
  mixer.update(seconds);
  return mixer;
}

describe('cloneAssetScene: skinned characters', () => {
  it('detects the bundled rig as skinned and a node-animated character as not', async () => {
    expect(containsSkinnedMesh((await loadAsset('npc-harbor-master')).scene)).toBe(true);
    expect(containsSkinnedMesh((await loadAsset('npc-pip')).scene)).toBe(false);
  });

  it('binds each instance’s skin to bones inside that instance, never the cache’s or a sibling’s', async () => {
    const { scene: source } = await loadAsset('npc-harbor-master');
    const first = cloneAssetScene(source);
    const second = cloneAssetScene(source);

    const firstMeshes = skinnedMeshesOf(first);
    const secondMeshes = skinnedMeshesOf(second);
    expect(firstMeshes).toHaveLength(skinnedMeshesOf(source).length);
    expect(firstMeshes.length).toBeGreaterThan(0);

    for (const [index, mesh] of firstMeshes.entries()) {
      const sibling = secondMeshes[index]!;
      expect(mesh.skeleton).not.toBe(sibling.skeleton);
      expect(mesh.skeleton).not.toBe(skinnedMeshesOf(source)[index]!.skeleton);
      expect(mesh.skeleton.bones).toHaveLength(62);
      for (const bone of mesh.skeleton.bones) expect(isInside(bone, first)).toBe(true);
      for (const bone of sibling.skeleton.bones) expect(isInside(bone, second)).toBe(true);
    }
  });

  it('documents the bug it replaces: a plain clone(true) leaves the skin on the cached bones', async () => {
    const { scene: source } = await loadAsset('npc-harbor-master');
    const plain = source.clone(true);
    const [mesh] = skinnedMeshesOf(plain);
    expect(isInside(mesh!.skeleton.bones[0]!, plain)).toBe(false);
  });

  it('animates two instances independently: one walking does not move the other', async () => {
    const { scene: source, animations } = await loadAsset('npc-harbor-master');
    const walker = cloneAssetScene(source);
    const bystander = cloneAssetScene(source);
    const restPose = bonePose(bystander);

    play(walker, 'Walk', 0.4, animations);

    expect(bonePose(walker)).not.toEqual(restPose);
    expect(bonePose(bystander)).toEqual(restPose);
    expect(bonePose(source)).toEqual(restPose);

    play(bystander, 'Wave', 0.7, animations);
    expect(bonePose(bystander)).not.toEqual(restPose);
    expect(bonePose(bystander)).not.toEqual(bonePose(walker));
  });

  it('shares the cached geometry and materials rather than copying them', async () => {
    const { scene: source } = await loadAsset('npc-harbor-master');
    const copy = cloneAssetScene(source);
    const sourceMeshes = skinnedMeshesOf(source);
    for (const [index, mesh] of skinnedMeshesOf(copy).entries()) {
      expect(mesh.geometry).toBe(sourceMeshes[index]!.geometry);
      expect(mesh.material).toBe(sourceMeshes[index]!.material);
      expect(mesh.bindMatrix.equals(sourceMeshes[index]!.bindMatrix)).toBe(true);
    }
  });

  it('is what instantiateAsset returns for a rigged model', async () => {
    const instance = await instantiateAsset('npc-professor-ticktock');
    const [mesh] = skinnedMeshesOf(instance);
    expect(mesh).toBeDefined();
    expect(isInside(mesh!.skeleton.bones[0]!, instance)).toBe(true);
  });
});

describe('cloneAssetScene: static models', () => {
  it('copies a static kit piece with its transforms, sharing geometry and material', async () => {
    const { scene: source } = await loadAsset('wall');
    const copy = cloneAssetScene(source);
    const sourceWall = source.getObjectByName('Wall') as Mesh;
    const copyWall = copy.getObjectByName('Wall') as Mesh;

    expect(copy).not.toBe(source);
    expect(copyWall).not.toBe(sourceWall);
    expect(copyWall.geometry).toBe(sourceWall.geometry);
    expect(copyWall.material).toBe(sourceWall.material);
    expect(copyWall.matrix.equals(sourceWall.matrix)).toBe(true);
  });

  it('keeps a node-animated character’s named parts and lets its clips bind', async () => {
    const { scene: source, animations } = await loadAsset('npc-quill');
    const copy = cloneAssetScene(source);
    expect(copy.getObjectByName('Arm')).toBeDefined();
    const mixer = new AnimationMixer(copy);
    const action = mixer.clipAction(animations.find((clip) => clip.name === 'Wave')!);
    action.play();
    mixer.update(0.3);
    expect(action.isRunning()).toBe(true);
  });
});
