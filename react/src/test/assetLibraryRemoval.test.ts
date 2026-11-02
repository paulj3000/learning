import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Staff asset management lives in Django Admin only (ADR-044). React keeps
 * resolving and loading published assets; it has no pages, routes, nav
 * entries or API client for creating, uploading, publishing or deleting them.
 */
const SRC = resolve(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

const FILES = sources(SRC).filter((f) => !f.endsWith('assetLibraryRemoval.test.ts'));
const read = (f: string) => readFileSync(f, 'utf8');

describe('React has no staff asset library', () => {
  it('imports none of the removed modules', () => {
    const removed =
      /(djangoAssetAdmin|assetBackend|ModelUploadWizard|modelUpload['"]|uploadProgress|modelAssetPages|AdminModelAssets|AdminNewModelAsset|routes\/AdminAssets|features\/assets\/django|modelFileChecks|storageKeys)/;
    const offenders = FILES.filter((f) => removed.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('has no admin asset routes or navigation', () => {
    const routes = read(join(SRC, 'app/AppRoutes.tsx'));
    expect(routes).not.toMatch(/path="assets/);
    const nav = read(join(SRC, 'features/admin/AdminLayout.tsx'));
    expect(nav).not.toMatch(/\/admin\/assets|Game assets/);
  });

  it('sends no request to the administrator asset API', () => {
    const offenders = FILES.filter((f) => /['"`]admin\/assets\/(?!assetversion)/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('keeps the read-only asset loading the game needs', () => {
    for (const kept of [
      'api/assets/djangoAssetResolver.ts',
      'features/island-map/three/assets/assetLoader.ts',
      'features/island-map/three/assets/mediaAssets.ts',
      'features/assets/preview/adminAssetPreview.entry.ts', // bundled into Django Admin's preview
    ]) {
      expect(statSync(join(SRC, kept)).isFile()).toBe(true);
    }
  });
});
