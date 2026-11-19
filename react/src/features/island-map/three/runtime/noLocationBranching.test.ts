import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ISLAND_LOCATIONS } from '../../../island/locations';
import { ALL_CHECKPOINTS } from '../../../discovery/checkpoints';

/**
 * Acceptance A2 (`docs/engine/11_ACCEPTANCE_TESTS.md`): the generic runtime
 * must never branch on a location. Every non-test source file in this
 * directory, except the manifests and the location definitions (`locations/`), is scanned for any known
 * location slug or region id as a string literal. A hit means
 * region-specific behaviour leaked into the engine and belongs in a
 * manifest or a registered extension instead.
 */
const RUNTIME_DIR = resolve(process.cwd(), 'src/features/island-map/three/runtime');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      // Per-location data may name its location: the manifests and the GE-075 location definitions.
      return name === 'manifests' || name === 'locations' ? [] : sourceFiles(path);
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

/**
 * GE-075 / Firepeak requirement 11: the Game Engine Core (`game/src`, `@lai/game-engine`) is
 * held to the same rule. Realm and location specifics belong in SDK definitions and content,
 * never in engine code. Contract vector fixtures are data, not engine behaviour, so they are
 * the one exclusion.
 */
const ENGINE_DIR = resolve(process.cwd(), '../game/src');
const ENGINE_FIXTURES = new Set(['contracts/gameplayEventVectors.ts']);

describe('Game Engine Core (game/src)', () => {
  const engineFiles = () =>
    sourceFiles(ENGINE_DIR).filter((path) => !ENGINE_FIXTURES.has(relative(ENGINE_DIR, path).split('\\').join('/')));

  it('scans a non-empty set of engine files', () => {
    expect(engineFiles().length).toBeGreaterThan(3);
  });

  it('names no location slug or region id', () => {
    const leaks = engineFiles().flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return KNOWN_IDS.filter((id) => new RegExp(`['"\`]${id}['"\`:]`).test(source)).map(
        (id) => `${relative(ENGINE_DIR, path)}: "${id}"`,
      );
    });
    expect(leaks).toEqual([]);
  });
});
