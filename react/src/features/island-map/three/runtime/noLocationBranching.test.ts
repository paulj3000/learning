import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ISLAND_LOCATIONS } from '../../../island/locations';
import { ALL_CHECKPOINTS } from '../../../discovery/checkpoints';

/**
 * Acceptance A2 (`docs/engine/11_ACCEPTANCE_TESTS.md`): the generic runtime
 * must never branch on a location. Every non-test source file in this
 * directory, except the manifests themselves, is scanned for any known
 * location slug or region id as a string literal. A hit means
 * region-specific behaviour leaked into the engine and belongs in a
 * manifest or a registered extension instead.
 */
const RUNTIME_DIR = resolve(process.cwd(), 'src/features/island-map/three/runtime');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return name === 'manifests' ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const KNOWN_IDS = [
  ...new Set([
    ...ISLAND_LOCATIONS.map((location) => location.slug),
    ...ALL_CHECKPOINTS.map((checkpoint) => checkpoint.regionId),
  ]),
];

describe('generic location runtime', () => {
  it('scans a non-empty set of runtime files', () => {
    expect(sourceFiles(RUNTIME_DIR).length).toBeGreaterThan(3);
  });

  it('names no location slug or region id outside the manifests', () => {
    const leaks = sourceFiles(RUNTIME_DIR).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return KNOWN_IDS.filter((id) => new RegExp(`['"\`]${id}['"\`:]`).test(source)).map(
        (id) => `${relative(RUNTIME_DIR, path)}: "${id}"`,
      );
    });
    expect(leaks).toEqual([]);
  });
});
