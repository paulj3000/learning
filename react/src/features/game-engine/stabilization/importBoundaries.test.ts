import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Wave 2 stabilization, area 10: import boundaries from the React side.
 *
 * - No file under react/ reaches into the engine through a deep `@lai/game-engine/src/...` path
 *   or a relative path into `game/`; everything goes through the package exports.
 * - React engine files import the engine only through package subpaths that the engine's own
 *   package.json `exports` lists.
 * - The engine (game/src) never imports react/ (the game side guard in boundary.test.ts covers
 *   "three and itself only"; this adds the reverse direction and the exports contract).
 */

const REACT_SRC = resolve(__dirname, '../../..');
const GAME_ROOT = resolve(REACT_SRC, '../../game');
const GAME_SRC = join(GAME_ROOT, 'src');
const ENGINE_FEATURE = resolve(REACT_SRC, 'features/game-engine');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Module specifiers in static imports, re-exports, dynamic imports and vi.mock calls. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bvi\.(?:mock|doMock|importActual)\(\s*['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

const reactFiles = walk(REACT_SRC);
const engineFeatureFiles = walk(ENGINE_FEATURE);
const gameFiles = walk(GAME_SRC);

const packageExports = Object.keys(
  (
    JSON.parse(readFileSync(join(GAME_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, string>;
    }
  ).exports,
);
const allowedSubpaths = new Set(
  packageExports
    .filter((key) => key !== './*')
    .map((key) => (key === '.' ? '@lai/game-engine' : `@lai/game-engine/${key.slice(2)}`)),
);

describe('import boundaries', () => {
  it('finds the source trees it is checking', () => {
    expect(reactFiles.length).toBeGreaterThan(200);
    expect(engineFeatureFiles.length).toBeGreaterThan(5);
    expect(gameFiles.length).toBeGreaterThan(100);
    expect(allowedSubpaths.has('@lai/game-engine')).toBe(true);
    expect(allowedSubpaths.has('@lai/game-engine/core')).toBe(true);
  });

  it('no react/ file imports the engine through a deep @lai/game-engine/src/... path', () => {
    const offenders = reactFiles.flatMap((file) =>
      specifiers(readFileSync(file, 'utf8'))
        .filter((spec) => /^@lai\/game-engine\/src(\/|$)/.test(spec))
        .map((spec) => `${relative(REACT_SRC, file)} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('no react/ file reaches into game/ with a relative path', () => {
    const offenders = reactFiles.flatMap((file) =>
      specifiers(readFileSync(file, 'utf8'))
        .filter((spec) => spec.startsWith('.'))
        .filter((spec) => {
          const target = resolve(file, '..', spec);
          return target === GAME_ROOT || target.startsWith(`${GAME_ROOT}/`);
        })
        .map((spec) => `${relative(REACT_SRC, file)} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  // GE-076: every island-map re-export shim for a moved engine module is retired (gamepadInput and
  // cameraHeightFollower on 2026-11-19, the last eight under GE-S1 on 2026-11-22). They must not
  // come back: importers use the explicitly listed engine entry points instead.
  const RETIRED_SHIMS = [
    'cameraHeightFollower',
    'cameraPreference',
    'firstPersonController',
    'gamepadInput',
    'jumpConfiguration',
    'locomotionConfiguration',
    'playerCamera',
    'playerCollision',
    'playerPresentation',
    'pointerControls',
  ].map((name) => `features/island-map/three/${name}.ts`);

  const wildcardImports = () =>
    reactFiles.flatMap((file) =>
      specifiers(readFileSync(file, 'utf8'))
        .filter((spec) => spec === '@lai/game-engine' || spec.startsWith('@lai/game-engine/'))
        .filter((spec) => !allowedSubpaths.has(spec))
        .map((spec) => ({ file: relative(REACT_SRC, file), spec })),
    );

  it('the retired island-map engine re-export shims stay deleted', () => {
    const present = RETIRED_SHIMS.filter((file) => reactFiles.includes(join(REACT_SRC, file)));
    expect(present).toEqual([]);
  });

  // Defect GE-S1 (Low), fixed 2026-11-22: react/ reached `@lai/game-engine/<dir>/<file>` through
  // the package's `./*` wildcard export, a deep path that bypassed the named exports.
  it('no react/ file imports an engine subpath that the exports map does not list explicitly', () => {
    expect(wildcardImports()).toEqual([]);
  });

  it('React engine feature files import the engine only via package subpaths (and the engine is imported at all)', () => {
    let engineImports = 0;
    const offenders: string[] = [];
    for (const file of engineFeatureFiles) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('@lai/game-engine')) {
          engineImports += 1;
          if (!allowedSubpaths.has(spec)) offenders.push(`${relative(REACT_SRC, file)} -> ${spec}`);
        }
        if (/(^|\/)game\/src(\/|$)/.test(spec) || /^\.{1,2}\/.*\bgame\b\/src/.test(spec)) {
          offenders.push(`${relative(REACT_SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(engineImports).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  it('the engine feature never imports Phaser, and no engine host file imports the retired Amplify SDK', () => {
    const offenders = engineFeatureFiles.flatMap((file) =>
      specifiers(readFileSync(file, 'utf8'))
        .filter((spec) => /^phaser(\/|$)/.test(spec) || /^aws-amplify|^@aws-amplify/.test(spec))
        .map((spec) => `${relative(REACT_SRC, file)} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('game/ never imports react/, React, a DOM-only UI library or the react app by path', () => {
    const offenders = gameFiles.flatMap((file) =>
      specifiers(readFileSync(file, 'utf8'))
        .filter(
          (spec) =>
            /^react(-dom)?(\/|$)/.test(spec) ||
            /^@testing-library\//.test(spec) ||
            /(^|\/)react\/src(\/|$)/.test(spec) ||
            /^@lai\/(?!game-engine)/.test(spec),
        )
        .map((spec) => `${relative(GAME_SRC, file)} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('game/ imports reach only three, the package itself by relative path, or test tooling in tests', () => {
    const offenders = gameFiles.flatMap((file) => {
      const isTest = /\.test\.ts$/.test(file);
      if (/(^|\/)(sdk\/scaffold\.ts|boundary\.test\.ts)$/.test(file)) return []; // they generate or inspect import text
      return specifiers(readFileSync(file, 'utf8'))
        .filter((spec) => {
          if (spec.includes('${')) return false;
          if (spec.startsWith('.')) {
            const target = resolve(file, '..', spec);
            return !target.startsWith(`${GAME_SRC}/`) && target !== GAME_SRC;
          }
          if (spec === 'three' || spec.startsWith('three/')) return false;
          if (spec.startsWith('node:') && isTest) return false;
          if (spec === 'vitest' && isTest) return false;
          return true;
        })
        .map((spec) => `${relative(GAME_SRC, file)} -> ${spec}`);
    });
    expect(offenders).toEqual([]);
  });

  it('the exports map has a deep-import escape hatch, so the guard above is the only thing stopping it', () => {
    // `./*` maps any `@lai/game-engine/<x>` to `src/<x>.ts`. A `src/...` specifier is therefore
    // resolvable today; this test pins that the escape hatch exists so removing it is a conscious change.
    expect(packageExports).toContain('./*');
  });
});
