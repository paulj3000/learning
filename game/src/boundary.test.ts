import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * LAI-2101 boundary guard for `game/` (ADR-020 item 4; CLAUDE.md section 19). Engine code may
 * import only `three` (and its `examples/jsm` addons), Node built-ins in tests, `vitest` in
 * tests and its own relative modules. Deny by default: React, routers, Django or API clients,
 * Amplify, AWS SDKs, Phaser, physics libraries and anything under `react/` all fail.
 */

const SRC = fileURLToPath(new URL('.', import.meta.url));
const ALLOWED_RUNTIME = [/^three$/, /^three\/examples\/jsm\/.+\.js$/, /^three\/addons\/.+\.js$/];
const ALLOWED_TEST_ONLY = [/^node:/, /^vitest$/, /^typescript$/];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return listSourceFiles(path);
    }
    return /\.(ts|tsx|mts|js)$/.test(name) ? [path] : [];
  });
}

function specifiers(source: string): string[] {
  const found: string[] = [];
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      const callee = node.expression;
      if (
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === 'require')
      ) {
        found.push((node.arguments[0] as ts.StringLiteral).text);
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      found.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export function boundaryViolations(root: string): string[] {
  const violations: string[] = [];
  for (const path of listSourceFiles(root)) {
    const rel = relative(root, path);
    const isTest = /\.test\.tsx?$/.test(rel) || rel.startsWith('testing/');
    if (/\.tsx$/.test(rel)) {
      violations.push(`${rel}: .tsx files (React) are not allowed in game/`);
    }
    for (const spec of specifiers(readFileSync(path, 'utf8'))) {
      if (spec.startsWith('.')) {
        if (
          /(^|\/)react\/src\//.test(spec) ||
          spec.split('/').filter((p) => p === '..').length > 3
        ) {
          violations.push(`${rel}: relative import leaves game/ (${spec})`);
        }
        continue;
      }
      const allowed =
        ALLOWED_RUNTIME.some((re) => re.test(spec)) ||
        (isTest && ALLOWED_TEST_ONLY.some((re) => re.test(spec)));
      if (!allowed) {
        violations.push(`${rel}: imports "${spec}"`);
      }
    }
  }
  return violations;
}

describe('game/ import boundary (ADR-020)', () => {
  it('imports nothing but three and its own modules', () => {
    expect(boundaryViolations(SRC)).toEqual([]);
  });

  it('catches forbidden imports in every form', () => {
    // Built from names so no import-shaped text sits in this file (the repo-level
    // workspace check scans source text for forbidden imports).
    const forbidden = [
      'react',
      '@/api/client',
      'aws-amplify',
      'phaser',
      '@aws-sdk/client-s3',
      'cannon-es',
    ];
    const forms = [
      (m: string) => `import React from '${m}';`,
      (m: string) => `export { x } from '${m}';`,
      (m: string) => `const m = await import('${m}');`,
      (m: string) => `const p = require('${m}');`,
      (m: string) => `type T = import('${m}').S3Client;`,
      (m: string) => `import '${m}';`,
    ].map((build, i) => build(forbidden[i]!));
    for (const form of forms) {
      expect(specifiers(form)).toHaveLength(1);
      const spec = specifiers(form)[0]!;
      expect(ALLOWED_RUNTIME.some((re) => re.test(spec))).toBe(false);
    }
  });
});
