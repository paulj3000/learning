// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

/**
 * ADR-023's promise, checked mechanically: adding Tailwind to the admin
 * section cannot restyle a child's page. tokens.css owns `--color-*`,
 * `--radius-*` and friends on `:root`; if Tailwind ever emitted its own theme
 * variables there, every island page would silently change. So compile the
 * real admin.css and inspect the output.
 */

const ADMIN_DIR = join(process.cwd(), 'src/features/admin');
const ADMIN_CSS = readFileSync(join(ADMIN_DIR, 'admin.css'), 'utf8');
const GLOBAL_CSS = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8');
const require = createRequire(import.meta.url);

/** A spread of utilities touching every theme namespace the admin uses. */
const CANDIDATES = [
  'bg-background',
  'bg-card',
  'bg-primary',
  'bg-primary/90',
  'text-foreground',
  'text-muted-foreground',
  'text-primary-foreground',
  'border',
  'border-input',
  'border-destructive',
  'bg-warning/10',
  'rounded-md',
  'rounded-xl',
  'shadow-sm',
  'font-sans',
  'font-semibold',
  'text-sm',
  'text-2xl',
  'tracking-tight',
  'p-6',
  'gap-4',
  'hover:bg-accent',
  'md:grid-cols-2',
  'accent-primary',
  'divide-y',
];

async function buildAdminCss(): Promise<string> {
  const compiler = await compile(ADMIN_CSS, {
    base: ADMIN_DIR,
    async loadStylesheet(id, base) {
      const path = id.startsWith('.') ? join(base, id) : require.resolve(id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  return compiler.build(CANDIDATES);
}

/** Removes every `<at-rule prelude> { ... }` block whose prelude starts with `prefix`. */
function stripBlocks(css: string, prefix: string): string {
  let result = css;
  for (let start = result.indexOf(prefix); start !== -1; start = result.indexOf(prefix)) {
    let depth = 0;
    let end = result.indexOf('{', start);
    for (; end < result.length; end += 1) {
      if (result[end] === '{') depth += 1;
      if (result[end] === '}' && --depth === 0) break;
    }
    result = result.slice(0, start) + result.slice(end + 1);
  }
  return result;
}

describe('admin.css (ADR-023)', () => {
  it('declares no custom property outside Tailwind’s private --tw-* names', async () => {
    const css = await buildAdminCss();
    const declared = [...css.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)].map((match) => match[1]);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((name) => !name.startsWith('--tw-'))).toEqual([]);
    expect(css).not.toMatch(/:root|:host/);
  });

  it('resolves the shadcn/ui colour names to the island tokens', async () => {
    const css = await buildAdminCss();
    expect(css).toMatch(/\.bg-primary\s*\{\s*background-color:\s*var\(--color-primary\)/);
    expect(css).toMatch(/\.text-muted-foreground\s*\{\s*color:\s*var\(--color-text-muted\)/);
    expect(css).toMatch(/\.border-destructive\s*\{\s*border-color:\s*var\(--color-danger\)/);
  });

  it('keeps every element selector inside @scope (.admin-root)', async () => {
    const css = await buildAdminCss();
    expect(css).toContain('@scope (.admin-root)');
    // Tailwind's own `@layer properties` fallback sets only --tw-* variables (checked above).
    const unscoped = stripBlocks(stripBlocks(css, '@scope'), '@layer properties {');
    // Every prelude before a `{`, minus at-rules (@media, @supports, @property).
    const selectors = [...unscoped.matchAll(/([^{};]+)\{/g)]
      .map((match) => match[1].trim())
      .filter((prelude) => prelude.length > 0 && !prelude.startsWith('@'));
    expect(selectors.length).toBeGreaterThan(0);
    // Utilities are class-keyed, directly or inside Tailwind's zero-specificity :where(.x ...).
    expect(selectors.filter((selector) => !/^(\.|:where\(\.)/.test(selector))).toEqual([]);
  });
});

describe('admin.css reset layering', () => {
  it('keeps the element reset in a cascade layer, below :where() utilities like divide-y', async () => {
    const css = await buildAdminCss();
    // Unlayered, the reset's `*` would tie with divide-y's zero specificity
    // and win by scope proximity, removing every divider.
    expect(css).toMatch(/@layer admin-reset\s*\{\s*@scope \(\.admin-root\)\s*\{\s*\*/);
    const unlayered = stripBlocks(css, '@layer admin-reset {');
    expect(unlayered).not.toMatch(/border:\s*0 solid/);
  });
});

describe('global.css button rules', () => {
  it('skip the admin subtree, so its flat shadcn/ui buttons get no island lip or press', () => {
    const buttonSelectors = [...GLOBAL_CSS.matchAll(/^(button[^{,]*)\{/gm)].map((match) =>
      match[1].trim(),
    );
    expect(buttonSelectors.length).toBeGreaterThanOrEqual(5);
    for (const selector of buttonSelectors) {
      expect(selector).toMatch(/^button:where\(:not\(\.admin-root \*\)\)/);
    }
  });
});
