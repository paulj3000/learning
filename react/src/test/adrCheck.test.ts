// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const roots: string[] = [];
// Built from parts so this file does not itself contain a bad reference.
const PREFIX = 'ADR-';

const ROW = (id: string, title: string, status = 'Accepted') =>
  `| ADR-${id} | ${title} | ${status} | Test | |`;

function fixture(decisions: string, extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'adr-check-'));
  roots.push(root);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/DECISIONS.md'), decisions);
  for (const [path, text] of Object.entries(extra)) writeFileSync(join(root, path), text);
  return root;
}

function run(root: string) {
  const result = spawnSync(
    resolve(repoRoot, 'node_modules/.bin/tsx'),
    [resolve(repoRoot, 'scripts/check-adrs.ts'), '--root', root],
    { encoding: 'utf-8' },
  );
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

const GOOD = [
  '# Log',
  ROW('001', 'First'),
  ROW('002', 'Second'),
  ROW('003', 'Held elsewhere', 'Reserved'),
  '## ADR-001: First',
  'Status: Accepted',
  '## ADR-002: Second',
  'Status: Accepted',
  '',
].join('\n');

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('ADR registry check', () => {
  it('passes a consistent log, resolving defined and reserved references', () => {
    const root = fixture(GOOD, {
      'docs/a.md': 'See ADR-001 and ADR-003. ADR-NNN is a placeholder.',
    });
    expect(run(root)).toMatchObject({ code: 0 });
  });

  it('rejects a duplicate heading', () => {
    const { code, output } = run(fixture(`${GOOD}## ADR-001: Another\n`));
    expect(code).toBe(1);
    expect(output).toMatch(/duplicate heading ADR-001/);
  });

  it('rejects a malformed heading', () => {
    const { output } = run(fixture(`${GOOD}## ADR 004 - Loose\n`));
    expect(output).toMatch(/malformed ADR heading/);
  });

  it('rejects a heading missing from the registry', () => {
    const { output } = run(fixture(`${GOOD}## ADR-004: Unlisted\n`));
    expect(output).toMatch(/ADR-004 has no registry row/);
  });

  it('rejects a registry row with no heading unless it is Reserved', () => {
    const { output } = run(fixture(`${ROW('005', 'Ghost')}\n${GOOD}`));
    expect(output).toMatch(/registry row ADR-005 has no heading and is not Reserved/);
  });

  it('rejects a registry title that differs from the heading', () => {
    const { output } = run(fixture(GOOD.replace('| ADR-002 | Second', '| ADR-002 | Renamed')));
    expect(output).toMatch(/registry title for ADR-002 differs/);
  });

  it('rejects malformed and unknown references', () => {
    const { output } = run(fixture(GOOD, { 'docs/a.md': `${PREFIX}2 and ${PREFIX}099` }));
    expect(output).toMatch(new RegExp(`malformed reference "${PREFIX}2"`));
    expect(output).toMatch(new RegExp(`${PREFIX}099, which is neither defined nor reserved`));
  });
});
