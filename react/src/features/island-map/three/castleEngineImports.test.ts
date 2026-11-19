import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GE-072: castle code imports the moved engine modules from `@lai/game-engine`, never through the
 * island-map re-export shims, so retiring the shims (GE-076) cannot break the castle.
 */
const THREE = resolve(process.cwd(), 'src/features/island-map/three');
const SHIMS = [
  'firstPersonController',
  'jumpConfiguration',
  'locomotionConfiguration',
  'playerCollision',
  'gamepadInput',
  'pointerControls',
  'cameraHeightFollower',
  'playerPresentation',
  'playerCamera',
  'cameraPreference',
];
const SHIM_IMPORT = new RegExp(`from '(?:\\.{1,2}/)+(?:${SHIMS.join('|')})'`);

function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, () => true).filter((file) => keep(file));
    return /\.(ts|tsx)$/.test(entry.name) && keep(entry.name) ? [path] : [];
  });
}

const CASTLE_FILES = [
  ...files(THREE, (name) => /^(castle|storykeeperCastle)/i.test(name) && !name.includes('/')),
  ...files(join(THREE, 'extensions/castleTale'), () => true),
  ...files(join(THREE, 'runtime/manifests'), (name) => /castle/i.test(name)),
  ...files(join(THREE, 'runtime/manifests/castleRooms'), () => true),
  ...files(join(THREE, 'runtime/locations'), (name) => /storykeeperCastle/.test(name)),
];

describe('castle imports engine modules from @lai/game-engine (GE-072)', () => {
  it('finds the castle files it guards', () => {
    expect(CASTLE_FILES.length).toBeGreaterThan(40);
    expect(CASTLE_FILES.some((file) => file.endsWith('castleEngineProfile.ts'))).toBe(true);
  });

  it('has no castle file importing a shimmed module', () => {
    const offenders = CASTLE_FILES.filter((file) => SHIM_IMPORT.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => file.slice(THREE.length + 1))).toEqual([]);
  });
});
