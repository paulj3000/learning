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
  'features/npc-manager/ui/NpcInteraction.module.css',
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

  it('drop to zero in full screen, where the stage covers the nav (the HUD top row stays reserved)', () => {
    const full = rules(shellCss).find((rule) => rule.selector.includes(':fullscreen'));
    expect(full).toBeDefined();
    expect(declaration(full!.body, '--child-nav-inset-bottom')).toBe('0px');
    expect(declaration(full!.body, '--child-nav-inset-left')).toBe('0px');
    // GE-090-D8: the top bar is hidden, but the HUD's top row (the harbor link) is reserved.
    expect(declaration(full!.body, '--child-header-inset')).toBe('calc(0.75rem + 2.75rem)');
  });

  it("reserve exactly the HUD's top row in full screen, so a tall panel never covers the harbor link", () => {
    const hud = rules(read('features/island-map/three/WorldHud.module.css'));
    expect(declaration(hud.find((rule) => rule.selector === '.overlay')!.body, 'padding')).toBe(
      'var(--space-3)',
    );
    expect(declaration(hud.find((rule) => rule.selector === '.exitLink')!.body, 'min-height')).toBe(
      '2.75rem',
    );
    const full = rules(shellCss).find((rule) => rule.selector.includes(':fullscreen'))!;
    expect(declaration(full.body, '--child-header-inset')).toBe('calc(0.75rem + 2.75rem)');
  });

  it("make room for the stage's own exits in full screen, and only there", () => {
    const [phone] = rules(shellCss).filter((rule) => rule.selector === '.shell');
    expect(declaration(phone.body, '--child-stage-exits-inset')).toBe('0px');
    const full = rules(shellCss).find((rule) => rule.selector.includes(':fullscreen'))!;
    // GE-090-D8: plus the measured gap below the stage (WorldStage), 0 when nothing is below it.
    expect(declaration(full.body, '--child-stage-exits-inset')).toBe(
      'calc(7.5rem + var(--child-stage-bottom-gap, 0px))',
    );
    for (const path of [
      'features/island-map/three/extensions/regionPlay/ui/RegionPlayPanels.module.css',
      'features/npc-manager/ui/NpcInteraction.module.css',
    ]) {
      const panel = rules(read(path)).find((rule) => rule.selector === '.panel')!;
      expect(declaration(panel.body, 'bottom')).toContain('var(--child-stage-exits-inset, 0px)');
    }
  });

  it('declare a zero header inset until ChildShell measures the top bar', () => {
    const [phone] = rules(shellCss).filter((rule) => rule.selector === '.shell');
    expect(declaration(phone.body, '--child-header-inset')).toBe('0px');
    expect(shellTsx).toMatch(/'--child-header-inset'/);
  });

  it.each(GAME_LAYERS)('keep every fixed layer in %s clear of the top bar (adult exit)', (path) => {
    for (const { selector, body } of rules(read(path))) {
      if (declaration(body, 'position') !== 'fixed') continue;
      const top = declaration(body, 'top');
      if (top !== undefined) {
        expect(top, `${selector} top`).toContain('var(--child-header-inset, 0px)');
      }
    }
    // Every height cap leaves room for the top bar and the nav, with a usable floor.
    const capped = rules(read(path)).filter((rule) => /max-height:\s*max\(/.test(rule.body));
    for (const { selector, body } of rules(read(path))) {
      if (!/max-height:\s*min\(70vh/.test(body)) continue;
      expect(
        capped.some((rule) => rule.selector === selector),
        `${selector} caps its height to the room left by the top bar`,
      ).toBe(true);
    }
    for (const { selector, body } of capped) {
      const cap = body.replace(/\s+/g, ' ');
      expect(cap, `${selector} max-height`).toContain('var(--child-header-inset, 0px)');
      expect(cap, `${selector} max-height`).toContain('var(--child-nav-inset-bottom, 0px)');
      expect(cap, `${selector} max-height`).toMatch(/max\( 10rem,/);
    }
  });

  it.each(GAME_LAYERS)('are honoured by every fixed layer in %s', (path) => {
    const fixed = rules(read(path)).filter(
      (rule) => declaration(rule.body, 'position') === 'fixed',
    );
    expect(fixed.length).toBeGreaterThan(0);
    for (const { selector, body } of fixed) {
      // Layers anchored to the top (the NPC ambient line) never meet the bottom bar.
      const bottom = declaration(body, 'bottom');
      if (bottom !== undefined) {
        expect(bottom, `${selector} bottom`).toContain('var(--child-nav-inset-bottom, 0px)');
      }
      const left = declaration(body, 'left');
      if (left !== undefined) {
        expect(left, `${selector} left`).toContain('var(--child-nav-inset-left, 0px)');
      }
    }
  });
  it("leave the game layers' own height caps alone in full screen (zero-specificity column rule)", () => {
    // Pip's panel is a direct child of the full-screen wrapper. A `.wrapper:fullscreen > *`
    // max-height (0,3,0) beat the panel's own cap (0,1,0): at 375x667 it grew to 45vh and ran
    // off the top over "Go back to the harbor" (GE-090-D8). The column rule must not compete.
    const column = rules(read('features/island-map/IslandWorldView.module.css')).filter(
      (rule) =>
        rule.selector.includes('.wrapper:fullscreen >') &&
        declaration(rule.body, 'max-height') !== undefined,
    );
    expect(column.length).toBeGreaterThan(0);
    for (const { selector } of column) {
      expect(selector, 'full-screen column rule').toMatch(/^:where\(.*\)$/);
    }
  });
});
