import { describe, expect, it } from 'vitest';
import {
  BACKDROP_HALF_WIDTH_METERS,
  BACKDROP_HEIGHT_METERS,
  EASEL_CANVASES,
  HERO_HALF_WIDTH_METERS,
  HERO_HEIGHT_METERS,
  resolveEaselCanvas,
} from './castleEaselCanvas';
import { THE_STORYKEEPERS_TALE } from '../../adventures/content/theStorykeepersTale';
import { ASSET_MANIFEST } from './assets/manifest';

/**
 * Beat 7's nine pictures. The failure this file exists to catch is the quiet
 * one: a hero or a setting is added, renamed, or reordered in
 * `theStorykeepersTale.ts` and the easel silently has no picture for one of
 * the nine stories a child can now tell - which shows up as a blank page at
 * the end of a story rather than as anything a type checker would notice.
 */

function optionIds(stepId: string): string[] {
  const step = THE_STORYKEEPERS_TALE.steps.find((candidate) => candidate.id === stepId);
  if (!step || step.presentation.kind !== 'creative-choice') {
    throw new Error(`"${stepId}" is not a creative-choice step`);
  }
  return step.presentation.options.map((option) => option.id);
}

const heroIds = optionIds('choose-hero');
const settingIds = optionIds('choose-setting');

describe('the easel covers every story that can be told', () => {
  it('authors exactly one picture for each (hero, setting) pair', () => {
    expect(EASEL_CANVASES).toHaveLength(heroIds.length * settingIds.length);
    for (const heroOptionId of heroIds) {
      for (const settingOptionId of settingIds) {
        const matches = EASEL_CANVASES.filter(
          (entry) =>
            entry.heroOptionId === heroOptionId && entry.settingOptionId === settingOptionId,
        );
        expect(matches, `${heroOptionId} + ${settingOptionId}`).toHaveLength(1);
      }
    }
  });

  it('names only option ids the adventure actually declares', () => {
    for (const entry of EASEL_CANVASES) {
      expect(heroIds).toContain(entry.heroOptionId);
      expect(settingIds).toContain(entry.settingOptionId);
    }
  });

  it('names only assets the manifest can load', () => {
    const ids = new Set(ASSET_MANIFEST.map((entry) => entry.id));
    for (const entry of EASEL_CANVASES) {
      expect(ids.has(entry.heroAssetId), entry.heroAssetId).toBe(true);
      expect(ids.has(entry.settingAssetId), entry.settingAssetId).toBe(true);
    }
  });

  /**
   * A hero has to fit **whole** inside its backdrop, not merely have its
   * origin inside it. Checking the origin alone was the first version of
   * this test and it passed on a dragon whose head stuck out through the
   * top of the picture, which is what looking at the easel showed.
   */
  it('fits every hero entirely inside its own backdrop', () => {
    for (const entry of EASEL_CANVASES) {
      const where = `${entry.heroOptionId} + ${entry.settingOptionId}`;
      expect(entry.heroScale, where).toBeGreaterThan(0);
      const halfWidth = HERO_HALF_WIDTH_METERS * entry.heroScale;
      const height = HERO_HEIGHT_METERS * entry.heroScale;
      expect(Math.abs(entry.heroOffset.x) + halfWidth, where).toBeLessThanOrEqual(
        BACKDROP_HALF_WIDTH_METERS,
      );
      expect(entry.heroOffset.y, where).toBeGreaterThanOrEqual(0);
      expect(entry.heroOffset.y + height, where).toBeLessThanOrEqual(BACKDROP_HEIGHT_METERS);
    }
  });
});

describe('resolveEaselCanvas', () => {
  it('finds the picture for a finished pair of choices', () => {
    const canvas = resolveEaselCanvas('hero-dragon', 'setting-cave');
    expect(canvas?.heroAssetId).toBe('canvas-hero-dragon');
    expect(canvas?.settingAssetId).toBe('canvas-setting-cave');
  });

  /** A session resumed part-way through has one choice, or neither. */
  it('leaves the page blank until both choices are made', () => {
    expect(resolveEaselCanvas('hero-fox', null)).toBeUndefined();
    expect(resolveEaselCanvas(null, 'setting-island')).toBeUndefined();
    expect(resolveEaselCanvas(undefined, undefined)).toBeUndefined();
  });
});
