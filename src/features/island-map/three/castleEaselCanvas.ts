/**
 * Beat 7's easel: the nine pictures the Illustration Studio can end up
 * showing (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-5, storyboard beat 7).
 *
 * Three heroes times three settings is nine outcomes, and every one of them
 * is authored below - but out of **seven** assets, not nine finished
 * canvases (the roadmap's A.6, "the cross-product trap"): a hero silhouette
 * is layered in front of a setting backdrop, so a fourth hero would cost one
 * asset rather than three. What each of the nine rows authors is the part
 * composition cannot infer: where on that backdrop this hero stands, and how
 * big. A fox at the mouth of a cave is not a dragon on a snowy peak.
 *
 * **No AI image generation**, per SC-5's exit criteria and CLAUDE.md section
 * 12. Every value here is a number a person chose.
 *
 * Pure data and pure lookups: no `three` import, no React, unit tested.
 */

export interface EaselCanvas {
  /** `choose-hero`'s option id. Never invented here. */
  heroOptionId: string;
  /** `choose-setting`'s option id. Never invented here. */
  settingOptionId: string;
  /** The silhouette asset, layered in front. */
  heroAssetId: string;
  /** The backdrop asset, layered behind. */
  settingAssetId: string;
  /**
   * Where the hero stands on the backdrop, in metres from the backdrop's
   * bottom centre. The backdrop is 0.8m wide and 0.62m tall, and a hero
   * silhouette is about 0.4m across and 0.28m tall at scale 1, so an offset
   * has to leave room for the hero's own size - a dragon authored high on a
   * mountain put its head out through the top of the picture.
   */
  heroOffset: { x: number; y: number };
  /** Uniform scale on the hero silhouette, so distance reads as size. */
  heroScale: number;
}

const HERO_ASSETS: Readonly<Record<string, string>> = {
  'hero-puppy': 'canvas-hero-puppy',
  'hero-dragon': 'canvas-hero-dragon',
  'hero-fox': 'canvas-hero-fox',
};

const SETTING_ASSETS: Readonly<Record<string, string>> = {
  'setting-island': 'canvas-setting-island',
  'setting-mountain': 'canvas-setting-mountain',
  'setting-cave': 'canvas-setting-cave',
};

function canvas(
  heroOptionId: string,
  settingOptionId: string,
  heroOffset: { x: number; y: number },
  heroScale: number,
): EaselCanvas {
  return {
    heroOptionId,
    settingOptionId,
    heroAssetId: HERO_ASSETS[heroOptionId],
    settingAssetId: SETTING_ASSETS[settingOptionId],
    heroOffset,
    heroScale,
  };
}

/** Half-width and height of a hero silhouette at scale 1 (`canvasHero` in `scripts/generate-world-assets.ts`). */
export const HERO_HALF_WIDTH_METERS = 0.2;
export const HERO_HEIGHT_METERS = 0.28;
/** The backdrop every hero has to stand inside (`canvasSetting`, same file). */
export const BACKDROP_HALF_WIDTH_METERS = 0.4;
export const BACKDROP_HEIGHT_METERS = 0.62;

/**
 * The nine. Read them as a 3x3 table: the island's hero stands on the green
 * land beside its tree, the mountain's stands clear of the peak on the open
 * slope to its right, and the cave's stands low and close in the mouth of
 * it. The dragon is authored a size up throughout, because a dragon that
 * paints the same size as a puppy is not a dragon.
 */
export const EASEL_CANVASES: readonly EaselCanvas[] = [
  canvas('hero-puppy', 'setting-island', { x: -0.14, y: 0.2 }, 1),
  canvas('hero-puppy', 'setting-mountain', { x: 0.22, y: 0.16 }, 0.85),
  canvas('hero-puppy', 'setting-cave', { x: -0.06, y: 0.08 }, 1),

  canvas('hero-dragon', 'setting-island', { x: -0.1, y: 0.22 }, 1.15),
  canvas('hero-dragon', 'setting-mountain', { x: 0.18, y: 0.24 }, 1),
  canvas('hero-dragon', 'setting-cave', { x: 0, y: 0.1 }, 1.1),

  canvas('hero-fox', 'setting-island', { x: -0.16, y: 0.2 }, 0.95),
  canvas('hero-fox', 'setting-mountain', { x: 0.22, y: 0.14 }, 0.8),
  canvas('hero-fox', 'setting-cave', { x: -0.08, y: 0.07 }, 0.9),
];

/**
 * The picture for one finished story, or `undefined` when the child has not
 * made both choices yet. Callers treat `undefined` as "leave the page
 * blank", which is also what a session resumed part-way through gets.
 */
export function resolveEaselCanvas(
  heroOptionId: string | null | undefined,
  settingOptionId: string | null | undefined,
): EaselCanvas | undefined {
  if (!heroOptionId || !settingOptionId) return undefined;
  return EASEL_CANVASES.find(
    (entry) => entry.heroOptionId === heroOptionId && entry.settingOptionId === settingOptionId,
  );
}
