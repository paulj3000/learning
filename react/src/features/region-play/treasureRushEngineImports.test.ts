import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GE-070: Treasure Rush consumes the Game Engine Core through `@lai/game-engine`, never through
 * the island-map shims the engine lead left at the moved modules' old paths (GE-020, GE-030).
 * The shims stay for other locations until they migrate; Treasure Rush must not drift back.
 */
const TREASURE_RUSH_DIRS = [
  'src/features/region-play',
  'src/features/island-map/three/extensions/regionPlay',
].map((dir) => resolve(process.cwd(), dir));

/** The modules moved into `@lai/game-engine` whose old paths are now re-export shims. */
const SHIMMED_MODULES = [
  'firstPersonController',
  'jumpConfiguration',
  'locomotionConfiguration',
  'playerCollision',
  'gamepadInput',
  'pointerControls',
  'playerCamera',
  'cameraHeightFollower',
  'cameraPreference',
  'playerPresentation',
];

const SHIM_IMPORT = new RegExp(
  `from '(?:\\.\\.?/)+(?:island-map/three/)?(?:${SHIMMED_MODULES.join('|')})'`,
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    // This file holds a shim import as a fixture for the last test, so it is not scanned.
    return /\.tsx?$/.test(name) && name !== 'treasureRushEngineImports.test.ts' ? [path] : [];
  });
}

describe('Treasure Rush engine imports (GE-070)', () => {
  it('scans the Treasure Rush sources and tests', () => {
    expect(TREASURE_RUSH_DIRS.flatMap(sourceFiles).length).toBeGreaterThan(20);
  });

  it('imports moved engine modules only from @lai/game-engine, never through the shims', () => {
    const offenders = TREASURE_RUSH_DIRS.flatMap(sourceFiles)
      .filter((path) => SHIM_IMPORT.test(readFileSync(path, 'utf8')))
      .map((path) => relative(process.cwd(), path));
    expect(offenders).toEqual([]);
  });

  it('would catch a shim import', () => {
    expect(SHIM_IMPORT.test("import { x } from '../../playerCollision';")).toBe(true);
    expect(SHIM_IMPORT.test("import { x } from '@lai/game-engine/movement';")).toBe(false);
  });
});
