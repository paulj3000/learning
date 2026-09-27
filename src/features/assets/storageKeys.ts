import type { AssetCategory } from './types';

/**
 * S3 key layout for uploaded models (docs/android/ASSET_MANAGEMENT.md
 * sections 6 and 23):
 *
 *   assets/models/<category folder>/<assetId>/v<version>/model.glb
 *
 * Every version gets its own object, so a replaced model never overwrites
 * the bytes an older client or CDN edge may still be serving, and a
 * versioned URL can be cached indefinitely. The category folder is for
 * humans browsing the bucket only: nothing reads a category back out of a
 * key, and an asset whose category is later edited keeps its old key. The
 * `Asset`/`AssetVersion` record is always the authoritative reference.
 */

export const MODEL_CATEGORY_FOLDERS: Record<AssetCategory, string> = {
  CHARACTER: 'characters',
  NPC: 'npcs',
  CREATURE: 'creatures',
  BUILDING: 'buildings',
  PROP: 'props',
  VEGETATION: 'vegetation',
  VEHICLE: 'vehicles',
  QUEST_ITEM: 'quest-items',
  ENVIRONMENT: 'environments',
  DECORATION: 'decorations',
  OTHER: 'other',
};

/** The stored file name inside each version folder; the admin's own file name is kept on the record. */
export const MODEL_OBJECT_FILE_NAME = 'model.glb';

export function modelObjectKey(category: AssetCategory, assetId: string, version: number): string {
  if (!assetId || /[/\\]/.test(assetId)) {
    throw new Error('An asset id must be a non-empty value without slashes.');
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('An asset version must be a positive whole number.');
  }
  return `assets/models/${MODEL_CATEGORY_FOLDERS[category]}/${assetId}/v${version}/${MODEL_OBJECT_FILE_NAME}`;
}
