import { describe, expect, it } from 'vitest';
import type { AgeBandValue } from '../child-profile/constants';
import { pagesForBand, storybookProgress } from './pages';
import { STORYBOOK_BONUS_SLOTS, STORYBOOK_REQUIRED_SLOTS, toSceneState } from './scene';

const BANDS: readonly AgeBandValue[] = ['SPROUT', 'PATHFINDER', 'EXPLORER'];

describe("the 3D book's capacity", () => {
  it("has room for every band's required pages and for the one bonus page", () => {
    for (const band of BANDS) {
      const pages = pagesForBand(band);
      expect(pages.filter((p) => p.required).length, band).toBeLessThanOrEqual(
        STORYBOOK_REQUIRED_SLOTS,
      );
      expect(pages.filter((p) => !p.required).length, band).toBeLessThanOrEqual(
        STORYBOOK_BONUS_SLOTS,
      );
    }
  });
});

describe('toSceneState', () => {
  it('is a closed, empty book for a child who has done nothing', () => {
    expect(
      toSceneState(storybookProgress({ worldChangeKeys: [], discoveryIds: [] }, 'PATHFINDER')),
    ).toEqual({
      required: [false],
      bonusFound: false,
      complete: false,
    });
  });

  it("gives one flag per required page, in registry order, and only the band's own", () => {
    const explorer = toSceneState(
      storybookProgress(
        { worldChangeKeys: ['CASTLE_SECRET_DOOR_OPENED'], discoveryIds: [] },
        'EXPLORER',
      ),
    );
    expect(explorer.required).toEqual([false, true, false]);
    expect(
      toSceneState(storybookProgress({ worldChangeKeys: [], discoveryIds: [] }, 'SPROUT')).required,
    ).toHaveLength(1);
  });

  it('reports the bonus page and a whole book separately: the bonus never makes it whole', () => {
    const bonusOnly = toSceneState(
      storybookProgress({ worldChangeKeys: [], discoveryIds: ['castle-tapestry-stair'] }, 'SPROUT'),
    );
    expect(bonusOnly).toEqual({ required: [false], bonusFound: true, complete: false });
    const whole = toSceneState(
      storybookProgress({ worldChangeKeys: ['FIRST_STORY_TOLD'], discoveryIds: [] }, 'SPROUT'),
    );
    expect(whole).toEqual({ required: [true], bonusFound: false, complete: true });
  });

  it('is pure and total', () => {
    const progress = storybookProgress(
      { worldChangeKeys: ['FIRST_STORY_TOLD'], discoveryIds: [] },
      'PATHFINDER',
    );
    expect(toSceneState(progress)).toEqual(toSceneState(progress));
  });
});
