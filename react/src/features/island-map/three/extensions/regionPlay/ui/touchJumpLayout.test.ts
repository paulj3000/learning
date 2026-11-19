import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Jumping standard: on a touch screen the world HUD's Jump button (right edge, from
 * max(42%, 9.5rem) up) must not cover Backpack, Hint or the hint itself. Region play's controls
 * are fixed to the same right edge. jsdom has no layout, so this checks the authored geometry in
 * rem: the Jump column's width against the hint bubble's offset, and the Jump button's lowest
 * position against the top of the Hint button. Browser QA still checks it on a real phone.
 */
const SRC = resolve(__dirname, '../../../../../..');
const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8');

const hudCss = read('features/island-map/three/WorldHud.module.css');
const panelsCss = read('features/island-map/three/extensions/regionPlay/ui/RegionPlayPanels.module.css');
const tokensCss = read('styles/tokens.css');

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the first `selector { ... }` rule in `css` (no nested braces). */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^{}]*)\\}`).exec(stripComments(css));
  if (!match) throw new Error(`no rule ${selector}`);
  return match[1];
}

/** The block inside `@media <query> { ... }` (one level of nesting). */
function mediaBlock(css: string, query: string): string {
  const source = stripComments(css);
  const start = source.indexOf(`@media ${query}`);
  if (start < 0) throw new Error(`no @media ${query}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(source.indexOf('{', start) + 1, i);
  }
  throw new Error(`unclosed @media ${query}`);
}

function declaration(body: string, property: string): string {
  const match = new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`).exec(body);
  if (!match) throw new Error(`no ${property}`);
  return match[1].trim();
}

const token = (name: string) => {
  const match = new RegExp(`${name}:\\s*([\\d.]+)rem;`).exec(tokensCss);
  if (!match) throw new Error(`no token ${name}`);
  return Number(match[1]);
};

/**
 * A length in rem: `1rem`, `var(--space-4)`, or `calc(a + b + ...)` of those. The nav inset is
 * 0 here: it moves the fixed controls and the stage (and so the Jump button) up together.
 */
function rem(value: string): number {
  const inner = value.replace(/^calc\((.*)\)$/s, '$1');
  return inner.split('+').reduce((sum, raw) => {
    const term = raw.trim();
    if (term.startsWith('var(--child-nav-inset')) return sum;
    const variable = /^var\((--[\w-]+)\)$/.exec(term);
    if (variable) return sum + token(variable[1]);
    const length = /^([\d.]+)rem$/.exec(term);
    if (length) return sum + Number(length[1]);
    throw new Error(`cannot read ${term}`);
  }, 0);
}

/** How far the Jump button reaches in from the right edge, at each size. */
function jumpReach(body: string): number {
  return rem(declaration(body, 'right')) + rem(declaration(body, 'width'));
}

describe('touch Jump button and region play controls (jumping standard)', () => {
  const jumpPhone = ruleBody(hudCss, '.jumpButton');
  const jumpTablet = ruleBody(mediaBlock(hudCss, '(min-width: 900px)'), '.jumpButton');

  it('on a touch screen the hint opens left of the Jump column, at both Jump sizes', () => {
    const bubble = ruleBody(mediaBlock(panelsCss, '(any-pointer: coarse)'), '.hintBubble');
    const bubbleRight = rem(declaration(bubble, 'right'));
    expect(bubbleRight).toBeGreaterThan(jumpReach(jumpPhone));
    expect(bubbleRight).toBeGreaterThan(jumpReach(jumpTablet));
  });

  it('the Hint and Backpack buttons sit below the lowest the Jump button goes', () => {
    const jumpLowest = rem(/max\([^,]+,\s*([^)]+)\)/.exec(declaration(jumpPhone, 'bottom'))![1]);
    const hint = ruleBody(panelsCss, '.hintButton');
    const backpack = ruleBody(panelsCss, '.backpackButton');
    const top = (body: string) => rem(declaration(body, 'bottom')) + rem(declaration(body, 'min-height'));
    expect(top(hint)).toBeLessThan(jumpLowest);
    expect(top(backpack)).toBeLessThan(jumpLowest);
  });
});
