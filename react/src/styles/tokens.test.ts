import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The automated colour-contrast check `docs/ACCESSIBILITY_AUDIT.md` records
 * as missing: "No automated contrast/axe scan against rendered pages - the
 * contrast numbers above were computed directly from the token hex values".
 *
 * Computing them by hand worked once and then rotted the moment the palette
 * was redesigned. `tokens.css` is the one place the numbers *can* be checked
 * mechanically, because the app reads those tokens rather than restating
 * them - only four CSS modules hard-code a colour at all, and none of them
 * carries body text.
 *
 * This does not replace an axe scan of rendered pages, which would catch a
 * different class of fault (text over an image, a component that ignores the
 * tokens). It does guarantee the palette itself can never ship failing.
 */

const TOKENS = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** Every `--name: #value` declaration in the token file. */
function readColorTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens.set(match[1], match[2].toLowerCase());
  }
  return tokens;
}

const COLORS = readColorTokens(TOKENS);

function token(name: string): string {
  const value = COLORS.get(name);
  if (!value) throw new Error(`"${name}" is not a colour token in tokens.css`);
  return value;
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const full =
    hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex.slice(0, 7);
  const value = Number.parseInt(full.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((raw) => {
    const scaled = raw / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large text and non-text UI. */
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

const PAGE_SURFACES = ['--color-background', '--color-surface', '--color-surface-sunk'];

describe('contrastRatio', () => {
  /** The check itself has to be right, or every assertion below is decoration. */
  it('agrees with the known WCAG anchors', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 2);
    // The canonical mid-grey example: #777 on white is just under 4.5:1.
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#c03a00', '#f7e9db')).toBeCloseTo(contrastRatio('#f7e9db', '#c03a00'), 5);
  });
});

describe('token palette meets WCAG AA', () => {
  it('found the tokens to check', () => {
    expect(COLORS.size).toBeGreaterThan(15);
  });

  it.each(['--color-text', '--color-text-muted'])(
    '%s is readable body text on every page surface',
    (name) => {
      for (const surface of PAGE_SURFACES) {
        expect(
          contrastRatio(token(name), token(surface)),
          `${name} on ${surface}`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    },
  );

  /**
   * These are used both as link text on the page and as the fill behind
   * white label text, so each has to clear 4.5:1 in both directions.
   */
  it.each([
    ['--color-primary', '--color-primary-contrast'],
    ['--color-accent', '--color-accent-contrast'],
  ])('%s works as link text and as a filled button', (name, contrast) => {
    for (const surface of PAGE_SURFACES) {
      expect(
        contrastRatio(token(name), token(surface)),
        `${name} on ${surface}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
    expect(
      contrastRatio(token(name), token(contrast)),
      `${contrast} label on ${name}`,
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(['--color-warning', '--color-danger', '--color-success'])(
    '%s is readable status text on every page surface',
    (name) => {
      for (const surface of PAGE_SURFACES) {
        expect(
          contrastRatio(token(name), token(surface)),
          `${name} on ${surface}`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    },
  );

  /** WCAG 1.4.11: focus rings and input edges are non-text UI, 3:1. */
  it.each(['--color-focus-ring', '--color-border'])(
    '%s is a visible non-text boundary on every page surface',
    (name) => {
      for (const surface of PAGE_SURFACES) {
        expect(
          contrastRatio(token(name), token(surface)),
          `${name} on ${surface}`,
        ).toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    },
  );

  /**
   * A focus ring that *was* an action colour would be indistinguishable
   * from a hover or a selected state, which is the whole job of a focus
   * ring for a keyboard user.
   *
   * Note what is deliberately not asserted here: a contrast ratio between
   * the ring and the button it surrounds. `global.css` draws the ring with
   * `outline-offset: 2px`, so it lands on the page *behind* the control
   * rather than on the control - the ratio that matters is ring against
   * the page surfaces, which the test above covers. Requiring 3:1 between
   * the ring and a mid-tone button would rule out every mid-tone ring
   * colour on luminance grounds, whatever its hue.
   */
  it('never reuses an action colour as the focus ring', () => {
    for (const action of ['--color-primary', '--color-accent', '--color-primary-deep']) {
      expect(token('--color-focus-ring'), `focus ring equals ${action}`).not.toBe(token(action));
    }
  });

  /** Text on the deep surfaces the world views and HUDs use. */
  it('reads on the deep surface', () => {
    expect(
      contrastRatio(token('--color-text-on-deep'), token('--color-surface-deep')),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

/**
 * The playful accents are the palette's foot-gun: they are bright, and
 * bright reads as "use it for the important words". None of them can carry
 * body text on cream. The token file says so in a comment; this says so in
 * a way that fails a build.
 */
describe('playful accents are fills, not text colours', () => {
  const ACCENTS = [
    '--color-sun',
    '--color-lime',
    '--color-sky',
    '--color-grape',
    '--color-blossom',
  ];

  it.each(ACCENTS)('%s carries the dark text colour at AA', (name) => {
    expect(
      contrastRatio(token('--color-text'), token(name)),
      `--color-text on ${name}`,
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(ACCENTS)('%s is not accidentally readable as text on the page', (name) => {
    // If one of these ever does clear 4.5:1 on cream, it has drifted dark
    // enough to stop being a playful accent, and the palette should say so.
    expect(
      contrastRatio(token(name), token('--color-background')),
      `${name} has drifted dark enough to be a text colour`,
    ).toBeLessThan(AA_TEXT);
  });
});
