import type { Object3D } from 'three';
import { clone as cloneWithSkeletons } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * The one way runtime code turns a cached, loaded asset scene into a placeable
 * instance (LAI-2106). Every placement of an asset clones the scene that
 * `assetLoader.ts` cached, and the copy shares that scene's geometry,
 * materials and textures, so placing an asset many times costs one parse and
 * one upload.
 *
 * `Object3D.clone(true)` is not enough for a rigged character. It copies the
 * bones, but each cloned `SkinnedMesh` keeps the *source's* `Skeleton`, so
 * the skin stays bound to bones outside the copy: an `AnimationMixer` on the
 * clone moves the cloned bones while the visible skin follows the cached
 * originals, and every instance of the model shares one pose.
 * `SkeletonUtils.clone` gives each copy its own `Skeleton` bound to its own
 * bones, while still sharing geometry and materials.
 *
 * Models with no `SkinnedMesh` (every kit piece, prop and node-animated
 * character such as `npc-pip`) keep the plain `clone(true)` they always had,
 * so nothing about a static model changes.
 *
 * Disposal stays as before: never dispose a clone's geometry, materials or
 * textures, because they belong to the shared cache. A cloned `Skeleton`
 * belongs to its instance; the bone texture a renderer may create for it is
 * released with that renderer.
 */

export function containsSkinnedMesh(root: Object3D): boolean {
  let found = false;
  root.traverse((child) => {
    if ((child as { isSkinnedMesh?: boolean }).isSkinnedMesh) found = true;
  });
  return found;
}

/** A fresh, independently placeable and animatable copy of a cached asset scene. */
export function cloneAssetScene<T extends Object3D>(source: T): T {
  return containsSkinnedMesh(source) ? (cloneWithSkeletons(source) as T) : source.clone(true);
}
