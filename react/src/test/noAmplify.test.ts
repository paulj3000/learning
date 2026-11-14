import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

/**
 * AMP-07 and AMP-08 (docs/platform/AMPLIFY_FINAL_REMOVAL.md): Amplify is gone from the source and
 * must not come back by accident, and the browser never holds an AI or speech SDK.
 */

const repo = resolve(__dirname, '../../..');
const CODE = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js']);
const SKIP = new Set(['node_modules', 'dist', 'test-results', 'playwright-report', '.git']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (CODE.has(extname(entry.name))) out.push(path);
  }
  return out;
}

/** Module specifiers in import, export-from, require and dynamic import forms. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\1/gm;
  for (const match of text.matchAll(pattern)) found.push(match[2]);
  return found;
}

const isAmplify = (specifier: string) => /^(aws-amplify|@aws-amplify\/)/.test(specifier);

describe('no Amplify in the source (AMP-07)', () => {
  it('has no Amplify backend, hosting or build files', () => {
    for (const path of ['amplify', 'amplify.yml', 'customHttp.yml', 'amplify-hosting']) {
      expect(existsSync(join(repo, path)), path).toBe(false);
    }
  });

  it('declares no Amplify package in any workspace manifest', () => {
    for (const manifest of ['package.json', 'react/package.json']) {
      const json = JSON.parse(readFileSync(join(repo, manifest), 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >;
      const names = ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap((key) =>
        Object.keys(json[key] ?? {}),
      );
      expect(names.filter(isAmplify), manifest).toEqual([]);
      expect(JSON.stringify(json.scripts ?? {}), manifest).not.toMatch(/\bampx\b|sandbox/);
    }
  });

  it('imports Amplify nowhere in the app, room server, infrastructure or scripts', () => {
    const offenders: string[] = [];
    for (const dir of ['react/src', 'react/e2e', 'server', 'infra', 'scripts']) {
      for (const file of sourceFiles(join(repo, dir))) {
        // The boundary guards (this file, engineBoundary.test.ts) quote Amplify imports as data.
        if (/\.test\.tsx?$/.test(file) && /noAmplify|engineBoundary/.test(file)) continue;
        if (specifiers(readFileSync(file, 'utf8')).some(isAmplify)) offenders.push(file);
      }
    }
    expect(offenders.map((file) => file.slice(repo.length + 1))).toEqual([]);
  });

  it('never ships a Bedrock, Polly or Cognito admin SDK to the browser', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(repo, 'react/src'))) {
      if (/\.test\.tsx?$/.test(file)) continue;
      if (specifiers(readFileSync(file, 'utf8')).some((s) => s.startsWith('@aws-sdk/'))) {
        offenders.push(file.slice(repo.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads specifiers in every import form', () => {
    expect(
      specifiers(
        [
          "import { a } from 'aws-amplify';",
          "import 'aws-amplify/data';",
          "export * from '@aws-amplify/ui-react';",
          "const m = await import('aws-amplify/auth');",
          "require('@aws-amplify/backend');",
        ].join('\n'),
      ).filter(isAmplify),
    ).toHaveLength(5);
  });
});
