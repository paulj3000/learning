import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANIMATION_CLIP_NAMES } from './animationVocabulary';
import { ASSET_MANIFEST, getAssetManifestEntry } from './manifest';

const PUBLIC_DIR = resolve(process.cwd(), 'public');

describe('ASSET_MANIFEST authoring check', () => {
  it('has a unique id per entry', () => {
    const ids = ASSET_MANIFEST.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Most entries resolve to a file `scripts/generate-world-assets.ts`
   * produced; a few (see `docs/ASSET_LICENCES.md`) resolve to an imported
   * `.glb` checked in beside them. Either way the url must name a real file.
   */
  it('resolves every url to a real file on disk', () => {
    for (const entry of ASSET_MANIFEST) {
      const filePath = join(PUBLIC_DIR, entry.url.replace(/^\//, ''));
      expect(existsSync(filePath), `${entry.id} -> ${entry.url} does not exist on disk`).toBe(true);
    }
  });

  it('only declares clip names from the approved animation vocabulary', () => {
    for (const entry of ASSET_MANIFEST) {
      for (const clip of entry.clips) {
        expect(ANIMATION_CLIP_NAMES as readonly string[]).toContain(clip);
      }
    }
  });

  it('points every lod.lowDetailId at another real manifest entry', () => {
    for (const entry of ASSET_MANIFEST) {
      if (!entry.lod) continue;
      expect(() => getAssetManifestEntry(entry.lod!.lowDetailId)).not.toThrow();
      expect(entry.lod.distanceMeters).toBeGreaterThan(0);
    }
  });
});

describe('getAssetManifestEntry', () => {
  it('throws for an unknown id', () => {
    expect(() => getAssetManifestEntry('does-not-exist')).toThrow(/unknown asset id/);
  });

  it('returns the matching entry for a known id', () => {
    expect(getAssetManifestEntry('npc-pip').kind).toBe('character');
  });
});
