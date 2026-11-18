// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * scripts/check-docs.ts (LAI-ENG-001). The required file list and template sections are read
 * from the script itself, so these fixtures stay valid when a template gains a section.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const roots: string[] = [];
// Built from parts so this file never contains a literal conflict marker line.
const OURS = '<'.repeat(7);
const THEIRS = '>'.repeat(7);

interface Manifest {
  required: string[];
  templates: Record<string, string[]>;
}

function manifest(): Manifest {
  const source = `
    import * as m from ${JSON.stringify(resolve(repoRoot, 'scripts/check-docs.ts'))};
    console.log(JSON.stringify({
      required: [...m.ROOT_INSTRUCTION_FILES, ...m.ENGINEERING_DOCS, ...m.ADVENTURE_DOCS, 'docs/adr/README.md'],
      templates: m.TEMPLATE_SECTIONS,
    }));`;
  const result = spawnSync(resolve(repoRoot, 'node_modules/.bin/tsx'), ['--eval', source], {
    encoding: 'utf-8',
  });
  return JSON.parse(result.stdout) as Manifest;
}

const MANIFEST = manifest();
const STATUS = '# Doc\n\n> **Status:** Proposed\n> **Owner:** Project owner\n';

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A tree that passes: every required document and template, each well formed. */
function fixture(overrides: Record<string, string | null> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-check-'));
  roots.push(root);
  const files: Record<string, string> = {};
  for (const path of MANIFEST.required) files[path] = STATUS;
  for (const [path, sections] of Object.entries(MANIFEST.templates)) {
    files[path] = [
      '# Template',
      '',
      '> **Status:** Template',
      '',
      ...sections.map((s) => `## ${s}\n\nTBD\n`),
    ].join('\n');
  }
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  for (const [path, text] of Object.entries(files)) write(root, path, text);
  return root;
}

function run(root: string) {
  const result = spawnSync(
    resolve(repoRoot, 'node_modules/.bin/tsx'),
    [resolve(repoRoot, 'scripts/check-docs.ts'), '--root', root],
    { encoding: 'utf-8' },
  );
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('documentation check', () => {
  it('passes a complete tree with resolving links', () => {
    const root = fixture({
      'docs/engineering/README.md': `${STATUS}\nSee [policy](testing-policy.md), [ADRs](../adr/README.md#top), [root](/CLAUDE.md), [web](https://example.com) and [here](#section).\n`,
    });
    expect(run(root)).toMatchObject({ code: 0 });
  });

  it('reports a missing required document', () => {
    const { code, output } = run(fixture({ 'docs/engineering/branch-policy.md': null }));
    expect(code).toBe(1);
    expect(output).toContain('docs/engineering/branch-policy.md: required document is missing');
  });

  it('reports a missing root instruction file', () => {
    const { code, output } = run(fixture({ 'AGENTS.md': null }));
    expect(code).toBe(1);
    expect(output).toContain('AGENTS.md: required document is missing');
  });

  it('reports a broken relative link with its line', () => {
    const { code, output } = run(
      fixture({ 'AGENTS.md': '# Agents\n\nRead [this](docs/engineering/nope.md).\n' }),
    );
    expect(code).toBe(1);
    expect(output).toContain('AGENTS.md:3: broken link "docs/engineering/nope.md"');
  });

  it('ignores links inside fenced code blocks and inline code', () => {
    const text = `${STATUS}\n\`[a](missing.md)\`\n\n\`\`\`md\n[b](missing.md)\n\`\`\`\n`;
    expect(run(fixture({ 'docs/adventures/README.md': text }))).toMatchObject({ code: 0 });
  });

  it('requires a status line in governed directories', () => {
    const { code, output } = run(fixture({ 'docs/adventures/npc-standard.md': '# NPCs\n' }));
    expect(code).toBe(1);
    expect(output).toContain('docs/adventures/npc-standard.md: no "**Status:**" line');
  });

  it('rejects an undocumented status value', () => {
    const { code, output } = run(
      fixture({ 'docs/engineering/release-policy.md': '# R\n\n> **Status:** Final\n' }),
    );
    expect(code).toBe(1);
    expect(output).toContain('status "Final" is not one of');
  });

  it('reports a template without a required section', () => {
    const path = 'docs/engineering/templates/agent-handoff.md';
    const sections = (MANIFEST.templates[path] ?? []).filter((s) => s !== 'Blockers');
    const text = `# H\n\n> **Status:** Template\n\n${sections.map((s) => `## ${s}\n`).join('\n')}`;
    const { code, output } = run(fixture({ [path]: text }));
    expect(code).toBe(1);
    expect(output).toContain(`${path}: missing required section "## Blockers"`);
  });

  it('reports a merge-conflict marker in any Markdown file', () => {
    const text = `# Notes\n${OURS} HEAD\nmine\n=======\ntheirs\n${THEIRS} branch\n`;
    const { code, output } = run(fixture({ 'docs/other/notes.md': text }));
    expect(code).toBe(1);
    expect(output).toContain('docs/other/notes.md:2: unresolved merge-conflict marker');
    expect(output).toContain('docs/other/notes.md:6: unresolved merge-conflict marker');
  });

  it('does not treat a setext heading underline as a conflict marker', () => {
    const text = '# Notes\n\nTitle\n=======\n';
    expect(run(fixture({ 'docs/other/notes.md': text }))).toMatchObject({ code: 0 });
  });
});
