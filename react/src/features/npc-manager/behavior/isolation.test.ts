import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('behaviour module isolation (CLAUDE.md section 19, contract section 6)', () => {
  it('imports no React, Three.js, API client, Amplify, AWS or physics code', () => {
    const dir = __dirname;
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(3);
    for (const file of sources) {
      const imports = [...readFileSync(join(dir, file), 'utf8').matchAll(/from '([^']+)'/g)].map(
        (m) => m[1],
      );
      for (const source of imports) {
        expect(source, `${file} imports ${source}`).toMatch(/^\.\.?\//);
        expect(source).not.toMatch(/api|island-map|engine\/|react/i);
      }
    }
  });
});
