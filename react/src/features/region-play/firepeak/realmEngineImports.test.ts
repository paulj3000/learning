import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GE-073 / GE-074: Firepeak and North Pole consume the Game Engine Core through
 * `@lai/game-engine`, never through the island-map shims left at the moved modules' old paths
 * (GE-020, GE-030). Shared region-play files are guarded by the Treasure Rush migration (GE-070);
 * this test covers the files only these two realms own, found by name under `src/`.
 */
const SRC = resolve(process.cwd(), 'src');
const REALM_FILE = /firepeak|northPole|north-pole|north_pole/i;

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

function realmFiles(directory: string, inRealmDir = false): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    const realm = inRealmDir || REALM_FILE.test(name);
    if (statSync(path).isDirectory()) return realmFiles(path, realm);
    // This file holds a shim import as a fixture for the last test, so it is not scanned.
    return realm && /\.tsx?$/.test(name) && name !== 'realmEngineImports.test.ts' ? [path] : [];
  });
}

describe('Firepeak and North Pole engine imports (GE-073, GE-074)', () => {
  it('finds the realm sources and tests', () => {
    expect(realmFiles(SRC).length).toBeGreaterThan(5);
  });

  it('imports moved engine modules only from @lai/game-engine, never through the shims', () => {
    const offenders = realmFiles(SRC)
      .filter((path) => SHIM_IMPORT.test(readFileSync(path, 'utf8')))
      .map((path) => relative(process.cwd(), path));
    expect(offenders).toEqual([]);
  });

  it('would catch a shim import', () => {
    expect(SHIM_IMPORT.test("import { x } from '../../firstPersonController';")).toBe(true);
    expect(SHIM_IMPORT.test("import { x } from '@lai/game-engine/movement';")).toBe(false);
  });
});
