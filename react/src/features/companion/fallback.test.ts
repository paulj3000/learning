import { describe, expect, it } from 'vitest';
import { FALLBACK_TURNS } from './fallback';
import { MAX_SPOKEN_LENGTH_BY_AGE_BAND } from './limits';
import { validateCompanionTurn } from './schema';
import type { CompanionIntent } from './schema';

describe('FALLBACK_TURNS', () => {
  const intents = Object.keys(FALLBACK_TURNS) as CompanionIntent[];

  it.each(intents)('has an authored turn for every intent (%s)', (intent) => {
    expect(FALLBACK_TURNS[intent].intent).toBe(intent);
  });

  it.each(intents)(
    'passes its own validator, even at the shortest age-band limit (%s)',
    (intent) => {
      const turn = FALLBACK_TURNS[intent];
      const result = validateCompanionTurn(turn, {
        expectedIntent: intent,
        maxLength: MAX_SPOKEN_LENGTH_BY_AGE_BAND.SPROUT,
      });
      expect(result.valid).toBe(true);
    },
  );
});
