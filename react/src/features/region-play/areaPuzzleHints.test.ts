import { describe, expect, it } from 'vitest';
import { hintsShown, type BandCommon } from './areaPuzzles';

/** Issue #102: the hints a child was shown before an answer, sent as the solve's `hintsUsed`. */

const band: BandCommon = {
  intro: 'Cross the lava',
  hints: ['first', 'second'],
  hintAfterAttempts: 2,
  completeMessage: null,
  scienceNote: null,
};

describe('hintsShown', () => {
  it('is none before any hint is asked for or due', () => {
    expect(hintsShown(band, 0, false)).toBe(0);
    expect(hintsShown(band, 1, false)).toBe(0);
  });

  it('counts the first hint when the child asked for it', () => {
    expect(hintsShown(band, 0, true)).toBe(1);
    expect(hintsShown(band, 1, true)).toBe(1);
  });

  it('counts every hint that wrong tries brought out, up to the band hint count', () => {
    expect(hintsShown(band, 2, false)).toBe(1);
    expect(hintsShown(band, 4, true)).toBe(2);
    expect(hintsShown(band, 99, false)).toBe(2);
  });

  it('is none for a band without hints', () => {
    expect(hintsShown({ ...band, hints: [] }, 9, true)).toBe(0);
  });
});
