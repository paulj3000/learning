import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `docs/engine/06_ASSET_SYSTEM.md` "No Hard-Coded Storage URLs" (engine
 * Phase 10): code names an asset by id and an `AssetResolver` decides where
 * its file lives. The bundled catalogue (`manifest.ts`) is the one file
 * allowed to know a `public/models/` path, and nothing in `src/` may name a
 * storage host at all; signed S3 urls come from `assetService.ts` at run
 * time, never from a literal.
 */
const SRC_DIR = resolve(process.cwd(), 'src');
const CATALOGUE = 'features/island-map/three/assets/manifest.ts';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** A string literal starting with a bundled asset directory, e.g. `'/models/rock.gltf'`. */
const BUNDLED_PATH = /['"`]\/(models|textures|audio)\//;
/** A storage or CDN host written into code. */
const STORAGE_HOST = /amazonaws\.com|cloudfront\.net|amplifyapp\.com/;

describe('asset urls', () => {
  const files = sourceFiles(SRC_DIR).filter((path) => !path.includes(`${join('src', 'test')}`));

  it('scans the whole source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('are written only in the bundled asset catalogue', () => {
    const leaks = files
      .map((path) => relative(SRC_DIR, path))
      .filter((path) => path !== CATALOGUE)
      .filter((path) => BUNDLED_PATH.test(readFileSync(join(SRC_DIR, path), 'utf8')));
    expect(leaks).toEqual([]);
  });

  it('never name a storage host', () => {
    const leaks = files
      .filter((path) => STORAGE_HOST.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC_DIR, path));
    expect(leaks).toEqual([]);
  });
});
