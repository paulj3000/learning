import { describe, expect, it } from 'vitest';
import {
  DECK_MAX_CM,
  DECK_MIN_CM,
  DECK_START_CM,
  STORM_WAVE_MS,
  TIDE_BOARD,
  TIDE_DURATION_MS,
  TIDE_RISE_MS,
  TIDE_TRIAL_COPY,
  TIDE_TRIAL_HINTS,
  evaluateDeck,
  highTideCm,
  initialTideTrialState,
  isTideTrialWon,
  outcomeMessage,
  peakWaterCm,
  stepDeck,
  tideBoardLines,
  tideLevelAt,
  tideTrialReducer,
  type TideTrialEvent,
  type TideTrialState,
} from './tideTrial';

function play(events: TideTrialEvent[], from: TideTrialState = initialTideTrialState()) {
  return events.reduce(tideTrialReducer, from);
}

function raiseTimes(count: number): TideTrialEvent[] {
  return Array.from({ length: count }, () => ({ type: 'RAISE_DECK' }) as const);
}

describe('tide arithmetic', () => {
  it('adds low water, the tide, and the storm wave', () => {
    expect(highTideCm()).toBe(125);
    expect(peakWaterCm()).toBe(145);
  });

  it('floods any deck the water reaches, including one exactly level with it', () => {
    expect(evaluateDeck(130)).toEqual({
      kind: 'FLOODED',
      deckCm: 130,
      peakWaterCm: 145,
      shortByCm: 15,
    });
    expect(evaluateDeck(145)).toMatchObject({ kind: 'FLOODED', shortByCm: 0 });
  });

  it('keeps a deck dry from just above the peak up to the cart limit', () => {
    expect(evaluateDeck(150)).toEqual({ kind: 'DRY', deckCm: 150, peakWaterCm: 145, spareCm: 5 });
    expect(evaluateDeck(TIDE_BOARD.cartLimitCm)).toMatchObject({ kind: 'DRY' });
  });

  it('rejects a deck above what the cart can climb', () => {
    expect(evaluateDeck(190)).toEqual({
      kind: 'TOO_STEEP',
      deckCm: 190,
      cartLimitCm: 170,
      overByCm: 20,
    });
  });

  it('leaves at least one working height on the 10 cm steps a child can pick', () => {
    const reachable: number[] = [];
    for (let cm = DECK_MIN_CM; cm <= DECK_MAX_CM; cm = stepDeck(cm, 1)) {
      reachable.push(cm);
      if (cm === DECK_MAX_CM) break;
    }
    expect(reachable.filter((cm) => evaluateDeck(cm).kind === 'DRY')).toEqual([150, 160, 170]);
  });

  it('starts on a deck that floods, so pressing go straight away shows what the tide does', () => {
    expect(evaluateDeck(DECK_START_CM).kind).toBe('FLOODED');
  });

  it('clamps deck steps to the range', () => {
    expect(stepDeck(DECK_MIN_CM, -1)).toBe(DECK_MIN_CM);
    expect(stepDeck(DECK_MAX_CM, 1)).toBe(DECK_MAX_CM);
    expect(stepDeck(120, 1)).toBe(130);
  });
});

describe('tideLevelAt', () => {
  it('runs from low water through high tide to the storm peak', () => {
    expect(tideLevelAt(0)).toBe(TIDE_BOARD.lowWaterCm);
    expect(tideLevelAt(TIDE_RISE_MS)).toBe(highTideCm());
    expect(tideLevelAt(TIDE_DURATION_MS)).toBe(peakWaterCm());
    expect(tideLevelAt(TIDE_DURATION_MS + 1000)).toBe(peakWaterCm());
  });

  it('only ever rises, in whole centimetres', () => {
    let previous = tideLevelAt(0);
    for (let ms = 0; ms <= TIDE_RISE_MS + STORM_WAVE_MS; ms += 50) {
      const level = tideLevelAt(ms);
      expect(Number.isInteger(level)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });
});

describe('tideTrialReducer', () => {
  it('moves the deck only while planning', () => {
    const planned = play([{ type: 'RAISE_DECK' }, { type: 'RAISE_DECK' }, { type: 'LOWER_DECK' }]);
    expect(planned.deckCm).toBe(DECK_START_CM + 10);

    const rising = play([{ type: 'BRING_TIDE' }, { type: 'RAISE_DECK' }], planned);
    expect(rising.phase).toBe('TIDE_RISING');
    expect(rising.deckCm).toBe(planned.deckCm);
  });

  it('judges the deck when the tide is brought in and reveals it when the tide finishes', () => {
    const rising = play([{ type: 'BRING_TIDE' }]);
    expect(rising).toMatchObject({ phase: 'TIDE_RISING', attempts: 1 });
    expect(rising.outcome?.kind).toBe('FLOODED');

    expect(play([{ type: 'TIDE_FINISHED' }], rising).phase).toBe('RESULT');
  });

  it('ignores a tide finishing when none was brought in', () => {
    expect(play([{ type: 'TIDE_FINISHED' }])).toEqual(initialTideTrialState());
  });

  it('lets a flooded child rebuild and keep their deck height and attempt count', () => {
    const retried = play([
      { type: 'BRING_TIDE' },
      { type: 'TIDE_FINISHED' },
      { type: 'TRY_AGAIN' },
    ]);
    expect(retried).toMatchObject({ phase: 'PLANNING', deckCm: DECK_START_CM, attempts: 1 });
  });

  it('is won by a dry deck, and a win cannot be retried away', () => {
    const won = play([...raiseTimes(4), { type: 'BRING_TIDE' }, { type: 'TIDE_FINISHED' }]);
    expect(won.deckCm).toBe(150);
    expect(isTideTrialWon(won)).toBe(true);
    expect(play([{ type: 'TRY_AGAIN' }], won)).toBe(won);
  });

  it('is not won by a too-steep deck', () => {
    const steep = play([...raiseTimes(8), { type: 'BRING_TIDE' }, { type: 'TIDE_FINISHED' }]);
    expect(steep.outcome?.kind).toBe('TOO_STEEP');
    expect(isTideTrialWon(steep)).toBe(false);
  });

  it('reveals hints one at a time and stops at the last', () => {
    const hinted = play(
      Array.from({ length: TIDE_TRIAL_HINTS.length + 2 }, () => ({ type: 'SHOW_HINT' }) as const),
    );
    expect(hinted.hintsShown).toBe(TIDE_TRIAL_HINTS.length);
  });
});

describe('copy', () => {
  it('reports the measured gap after a flood, so a retry has something to work from', () => {
    expect(outcomeMessage(evaluateDeck(130), 1).join(' ')).toContain('15 cm too high');
  });

  it('celebrates a first-try win differently from a win after retries', () => {
    const dry = evaluateDeck(160);
    expect(outcomeMessage(dry, 1)[0]).not.toEqual(outcomeMessage(dry, 3)[0]);
  });

  it('never names the answer before the last hint', () => {
    for (const hint of TIDE_TRIAL_HINTS.slice(0, -1)) {
      expect(hint).not.toMatch(/150|160|170 cm/);
    }
  });

  it('avoids em dashes in child-facing text (CLAUDE.md section 13)', () => {
    const everything = [
      ...Object.values(TIDE_TRIAL_COPY),
      ...tideBoardLines(),
      ...TIDE_TRIAL_HINTS,
      ...outcomeMessage(evaluateDeck(130), 1),
      ...outcomeMessage(evaluateDeck(145), 1),
      ...outcomeMessage(evaluateDeck(190), 1),
      ...outcomeMessage(evaluateDeck(160), 1),
      ...outcomeMessage(evaluateDeck(160), 2),
    ];
    for (const line of everything) {
      expect(line).not.toContain('—');
    }
  });
});
