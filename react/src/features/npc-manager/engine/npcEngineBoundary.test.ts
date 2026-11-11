import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ADR-020 for the NPC engine (docs/NPC_MANAGER_CONTRACTS.md section 6). The app-wide guard
 * (`src/test/engineBoundary.ts`) covers `island-map/three/`; this one walks every module that
 * `npc-manager/engine/` and `npc-manager/animation/` reach, transitively, and allows only
 * Three.js and the engine-safe NPC modules: no React, API clients (including
 * `contracts/parse.ts`, which reads API responses), Amplify or AWS SDKs.
 */

const FEATURE = resolve(__dirname, '..');
const ENGINE_DIRS = ['engine', 'animation'];
/** NPC folders an engine module may reach. `contracts/parse.ts` is excluded below. */
const ALLOWED_LOCAL = /^(engine|animation|behavior|contracts)\/[^/]+\.ts$/;

function listSources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return listSources(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

function resolveLocal(importer: string, specifier: string): string {
  const base = resolve(dirname(importer), specifier.replace(/\.js$/, ''));
  for (const suffix of ['', '.ts', '.tsx', '/index.ts']) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return base;
}

function violations(): string[] {
  const found: string[] = [];
  const queue = ENGINE_DIRS.flatMap((dir) => listSources(join(FEATURE, dir)));
  const visited = new Set(queue);
  while (queue.length > 0) {
    const file = queue.shift()!;
    const name = relative(FEATURE, file).split(sep).join('/');
    const imports = ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles;
    for (const { fileName: specifier } of imports) {
      if (!specifier.startsWith('.')) {
        if (specifier !== 'three' && !specifier.startsWith('three/')) {
          found.push(`${name} imports package ${specifier}`);
        }
        continue;
      }
      const target = resolveLocal(file, specifier);
      const key = relative(FEATURE, target).split(sep).join('/');
      if (!ALLOWED_LOCAL.test(key) || key === 'contracts/parse.ts') {
        found.push(`${name} imports ${specifier} (${key})`);
        continue;
      }
      if (!visited.has(target)) {
        visited.add(target);
        queue.push(target);
      }
    }
  }
  return found;
}

describe('NPC engine boundary (ADR-020)', () => {
  it('engine and animation modules reach only Three.js and engine-safe NPC modules', () => {
    expect(violations()).toEqual([]);
  });

  it('scans real engine files', () => {
    const files = ENGINE_DIRS.flatMap((dir) => listSources(join(FEATURE, dir)));
    expect(files.some((file) => file.endsWith('createNpcRuntime.ts'))).toBe(true);
    expect(files.some((file) => file.endsWith('npcAnimator.ts'))).toBe(true);
  });
});
