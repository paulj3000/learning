import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AP-01 rework: the child shell's fixed nav covered fixed-position game layers
 * (Pirate Pip's dialog buttons under the bottom bar on phones, the left of the
 * panel under the sidebar on a 768px tablet). The shell now publishes the room
 * its nav takes up, and every fixed game layer offsets itself by it.
 */
const SRC = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8');

const shellCss = read('features/portal/shell/ChildShell.module.css');
const shellTsx = read('features/portal/shell/ChildShell.tsx');

/** Fixed-position game layers that render inside the child shell. */
const GAME_LAYERS = [
  'features/island-map/three/extensions/regionPlay/ui/RegionPlayPanels.module.css',
  'features/island-map/three/extensions/castleTale/CastleSpeech.module.css',
];

function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    out.push({ selector: match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: match[2] });
  }
  return out;
}

function declaration(body: string, property: string): string | undefined {
  return new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`).exec(body)?.[1].trim();
}

describe('child nav insets', () => {
  it('match the nav: a bottom bar on phones, a w-56 (14rem) sidebar from md (48rem)', () => {
    const [phone, wide] = rules(shellCss).filter((rule) => rule.selector === '.shell');
    expect(declaration(phone.body, '--child-nav-inset-bottom')).toBe('5rem');
    expect(declaration(phone.body, '--child-nav-inset-left')).toBe('0px');
    expect(shellCss).toMatch(/@media \(min-width: 48rem\)/);
    expect(declaration(wide.body, '--child-nav-inset-bottom')).toBe('0px');
    expect(declaration(wide.body, '--child-nav-inset-left')).toBe('14rem');
    // The nav whose room these describe.
    expect(shellTsx).toMatch(/fixed inset-x-0 bottom-0/);
    expect(shellTsx).toMatch(/md:w-56/);
  });

  it('reserve the same room in the page, so content can scroll clear of the nav', () => {
    const [phone] = rules(shellCss).filter((rule) => rule.selector === '.shell');
    expect(declaration(phone.body, 'padding-bottom')).toBe('var(--child-nav-inset-bottom)');
    expect(declaration(phone.body, 'padding-left')).toBe('var(--child-nav-inset-left)');
    expect(shellTsx).not.toMatch(/\bpb-20\b|\bmd:pl-56\b/);
  });

  it('drop to zero in full screen, where the stage covers the nav', () => {
    const full = rules(shellCss).find((rule) => rule.selector.includes(':fullscreen'));
    expect(full).toBeDefined();
    expect(declaration(full!.body, '--child-nav-inset-bottom')).toBe('0px');
    expect(declaration(full!.body, '--child-nav-inset-left')).toBe('0px');
  });

  it.each(GAME_LAYERS)('are honoured by every fixed layer in %s', (path) => {
    const fixed = rules(read(path)).filter(
      (rule) => declaration(rule.body, 'position') === 'fixed',
    );
    expect(fixed.length).toBeGreaterThan(0);
    for (const { selector, body } of fixed) {
      const bottom = declaration(body, 'bottom');
      expect(bottom, `${selector} bottom`).toContain('var(--child-nav-inset-bottom, 0px)');
      const left = declaration(body, 'left');
      if (left !== undefined) {
        expect(left, `${selector} left`).toContain('var(--child-nav-inset-left, 0px)');
      }
    }
  });
});
