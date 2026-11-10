// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { PROGRESS_FILL } from './ui/variants';

/**
 * ADR-052's promise, checked mechanically (mirrors adminCss.test.ts):
 * importing portal.css cannot restyle any page that does not use its classes,
 * and every colour pair the portal components use passes WCAG AA.
 */

const PORTAL_DIR = join(process.cwd(), 'src/features/portal');
const PORTAL_CSS = readFileSync(join(PORTAL_DIR, 'portal.css'), 'utf8');
const require = createRequire(import.meta.url);

const CANDIDATES = [
  'bg-ocean-700',
  'bg-tropical-700',
  'bg-treasure-300',
  'bg-coral-700',
  'bg-purple-700',
  'bg-paper',
  'bg-sand',
  'bg-ink/60',
  'text-white',
  'text-ink',
  'text-ocean-900',
  'border-slate-line',
  'border-t-ocean-700',
  'min-h-12',
  'min-h-14',
  'md:w-56',
  'md:flex-col',
  'font-display',
  'rounded-2xl',
  'hover:bg-ocean-50',
];

async function buildPortalCss(): Promise<string> {
  const compiler = await compile(PORTAL_CSS, {
    base: PORTAL_DIR,
    async loadStylesheet(id, base) {
      const path = id.startsWith('.') ? join(base, id) : require.resolve(id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  return compiler.build(CANDIDATES);
}

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

describe('portal.css (ADR-052)', () => {
  it('declares no custom property outside Tailwind’s private --tw-* names', async () => {
    const css = await buildPortalCss();
    const declared = [...css.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)].map((match) => match[1]);
    expect(declared.filter((name) => !name.startsWith('--tw-'))).toEqual([]);
    expect(css).not.toMatch(/:root|:host/);
  });

  it('writes the portal palette straight into utilities', async () => {
    const css = await buildPortalCss();
    expect(css).toMatch(/\.bg-ocean-700\s*\{\s*background-color:\s*#0b5a85/);
    expect(css).toMatch(/\.bg-treasure-300\s*\{\s*background-color:\s*#ffd75e/);
  });

  it('ships no reset: every selector is a utility class', async () => {
    const css = await buildPortalCss();
    const unscoped = stripBlocks(css, '@layer properties {').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...unscoped.matchAll(/([^{};]+)\{/g)]
      .map((match) => match[1].trim())
      .filter((prelude) => prelude.length > 0 && !prelude.startsWith('@'));
    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.filter((selector) => !/^(\.|:where\(\.)/.test(selector))).toEqual([]);
  });
});

/** Every `--color-name: #hex` in the portal theme. */
const PALETTE = new Map(
  [...PORTAL_CSS.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [
    match[1],
    match[2].toLowerCase(),
  ]),
);
PALETTE.set('white', '#ffffff');

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((raw) => {
    const scaled = raw / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const a = PALETTE.get(foreground);
  const b = PALETTE.get(background);
  if (!a || !b) throw new Error(`Unknown portal colour: ${a ? background : foreground}`);
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** [text, background] pairs the portal components actually render. */
const TEXT_PAIRS: Array<[string, string]> = [
  ['white', 'ocean-700'],
  ['white', 'tropical-700'],
  ['ink', 'treasure-300'],
  ['white', 'coral-700'],
  ['white', 'purple-700'],
  ['ink', 'paper'],
  ['ink', 'sand'],
  ['ink', 'ocean-50'],
  ['ocean-900', 'ocean-100'],
  ['ink', 'tropical-50'],
  ['ink', 'treasure-50'],
  ['ink', 'coral-50'],
  ['ink', 'purple-50'],
  ['ocean-900', 'paper'],
  ['ocean-700', 'white'],
  ['ink-muted', 'paper'],
  // The child homepage (WelcomeHarbor, IslandExplorer): headings on the sand page and the
  // ocean "you are here" card, and the dark-on-pale badge for a locked island.
  ['ocean-900', 'sand'],
  ['ocean-900', 'ocean-50'],
  ['ink-muted', 'sand'],
  // AP-02/AP-03: links on the dashboard cards, the 3D Area link, chips on paper.
  ['ocean-900', 'coral-50'],
  ['ocean-900', 'purple-50'],
  ['ocean-900', 'tropical-50'],
  ['ocean-900', 'treasure-50'],
  ['ink', 'coral-50'],
];

describe('portal palette contrast (WCAG 2.1 AA)', () => {
  it.each(TEXT_PAIRS)('%s on %s is at least 4.5:1', (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.values(PROGRESS_FILL).map((utility) => utility.replace(/^bg-/, '')))(
    'progress fill %s meets 3:1 non-text contrast against the paper track',
    (fill) => {
      expect(contrast(fill, 'paper')).toBeGreaterThanOrEqual(3);
    },
  );

  it('defines all five portal families', () => {
    for (const family of ['ocean', 'tropical', 'treasure', 'coral', 'purple']) {
      expect([...PALETTE.keys()].some((name) => name.startsWith(`${family}-`))).toBe(true);
    }
  });
});

/**
 * `source(none)` means a file outside the `@source` list gets no portal
 * classes at all: it renders unstyled, and nothing fails. That is how a theme
 * can be "done" yet invisible, so every file that draws with the portal must
 * be listed.
 */
describe('portal.css sources', () => {
  const SRC = join(process.cwd(), 'src');
  const sources = [...PORTAL_CSS.matchAll(/@source\s+'([^']+)'/g)].map((match) =>
    resolve(PORTAL_DIR, match[1]),
  );
  const covered = (file: string) =>
    sources.some((source) => file === source || file.startsWith(source + sep));

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'admin' ? [] : sourceFiles(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  const PORTAL_USE =
    /from '[^']*portal\/(ui|shell)'|\b(?:bg|text|border)-(?:ocean|tropical|treasure|coral|purple)-\d/;

  it('lists every file that uses the portal components or palette', () => {
    const users = sourceFiles(SRC).filter((file) => PORTAL_USE.test(readFileSync(file, 'utf8')));
    expect(users.map((file) => relative(SRC, file))).toEqual(
      expect.arrayContaining(['routes/WelcomeHarbor.tsx', 'features/island/IslandExplorer.tsx']),
    );
    expect(users.filter((file) => !covered(file)).map((file) => relative(SRC, file))).toEqual([]);
  });
});
