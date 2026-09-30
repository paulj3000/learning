import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getIslandLocation } from '../../../island/locations';
import { ASSET_MANIFEST } from './manifest';
import { SCENE_ASSET_IDS, getSceneAssets } from './sceneAssets';

const THREE_DIR = resolve(process.cwd(), 'src/features/island-map/three');

/** The scene file each catalogued location is built by. */
const SCENE_FILES: Record<string, string> = {
  'pirate-builder-bay': 'pirateBuilderBayScene.ts',
};

/** Every manifest id the scene source names as a string literal. */
function manifestIdsNamedIn(fileName: string): Set<string> {
  const source = readFileSync(resolve(THREE_DIR, fileName), 'utf8');
  const literals = new Set([...source.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]));
  return new Set(ASSET_MANIFEST.map((entry) => entry.id).filter((id) => literals.has(id)));
}

describe('SCENE_ASSET_IDS', () => {
  it('is keyed by real island location slugs', () => {
    for (const slug of Object.keys(SCENE_ASSET_IDS)) {
      expect(getIslandLocation(slug), slug).toBeDefined();
    }
  });

  it('lists each model once and resolves every id in the manifest', () => {
    for (const [slug, ids] of Object.entries(SCENE_ASSET_IDS)) {
      expect(new Set(ids).size, slug).toBe(ids.length);
      expect(getSceneAssets(slug)?.map((entry) => entry.id)).toEqual(ids);
    }
  });

  it('matches the manifest ids each scene file actually names', () => {
    for (const [slug, ids] of Object.entries(SCENE_ASSET_IDS)) {
      const fileName = SCENE_FILES[slug];
      expect(fileName, `${slug} has no scene file to check against`).toBeDefined();
      expect([...manifestIdsNamedIn(fileName!)].sort(), slug).toEqual([...ids].sort());
    }
  });

  it('returns undefined for a location whose scene is not catalogued', () => {
    expect(getSceneAssets('wonderwild-forest')).toBeUndefined();
  });
});
