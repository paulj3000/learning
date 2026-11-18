import { describe, expect, it } from 'vitest';
import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import { CHOOSE_PARAMS, ORDER_PARAMS } from '../../test/choicePuzzleFixtures';
import { puzzleOutcomeJson } from '../../test/firepeakFixtures';
import {
  addToOrder,
  clearOrder,
  differentChoiceState,
  openChoiceState,
  recordChoiceResult,
  reopenChoiceState,
  selectOption,
  successLines,
  symbolGlyph,
  undoOrder,
} from './areaPuzzleUi';
import {
  chooseAnswerCorrect,
  firstVariantIndex,
  hashText,
  nextVariantIndex,
  orderSequenceCorrect,
  parsePuzzleParams,
  type ChooseAnswerParams,
  type OrderSequenceParams,
} from './areaPuzzles';

const choose = parsePuzzleParams('CHOOSE_ANSWER', CHOOSE_PARAMS) as ChooseAnswerParams;
const order = parsePuzzleParams('ORDER_SEQUENCE', ORDER_PARAMS) as OrderSequenceParams;

describe('the practice field of a puzzle outcome', () => {
  it('reads practice when the server sends it and false when it does not', () => {
    expect(read(puzzleOutcomeJson({ practice: true }), parse.puzzleOutcome).practice).toBe(true);
    expect(read(puzzleOutcomeJson(), parse.puzzleOutcome).practice).toBe(false);
  });
});

describe('parsePuzzleParams for CHOOSE_ANSWER', () => {
  it('reads variants, options with symbols and the entity map', () => {
    expect(choose.variants).toHaveLength(2);
    expect(choose.variants[0].options[1]).toEqual({ id: 'b', label: '7', symbol: 'star' });
    expect(choose.optionEntities.a).toBe('fh-stone-a');
    expect(choose.hintAfterAttempts).toBe(2);
    expect(choose.intro).toBe('');
  });

  it('allows options without a symbol or an entity map', () => {
    const { optionEntities: _drop, ...rest } = CHOOSE_PARAMS;
    void _drop;
    const bare = {
      ...rest,
      variants: [
        {
          ...CHOOSE_PARAMS.variants[0],
          options: [
            { id: 'a', label: '6' },
            { id: 'b', label: '7' },
          ],
        },
      ],
    };
    const parsed = parsePuzzleParams('CHOOSE_ANSWER', bare) as ChooseAnswerParams;
    expect(parsed.variants[0].options[0].symbol).toBeNull();
    expect(parsed.optionEntities).toEqual({});
  });

  it.each([
    ['no variants', { ...CHOOSE_PARAMS, variants: [] }],
    [
      'an answer that is not an option',
      { ...CHOOSE_PARAMS, variants: [{ ...CHOOSE_PARAMS.variants[0], answer: 'z' }] },
    ],
    [
      'one option',
      {
        ...CHOOSE_PARAMS,
        optionEntities: undefined,
        variants: [
          { ...CHOOSE_PARAMS.variants[0], options: [{ id: 'a', label: '6' }], answer: 'a' },
        ],
      },
    ],
    [
      'an unknown symbol',
      {
        ...CHOOSE_PARAMS,
        variants: [
          {
            ...CHOOSE_PARAMS.variants[0],
            options: [
              { id: 'a', label: '6', symbol: 'blob' },
              { id: 'b', label: '7' },
            ],
            answer: 'b',
          },
        ],
        optionEntities: undefined,
      },
    ],
    ['entity keys that differ from the option ids', { ...CHOOSE_PARAMS, optionEntities: { a: 'x' } }],
  ])('refuses %s', (_name, params) => {
    expect(parsePuzzleParams('CHOOSE_ANSWER', JSON.parse(JSON.stringify(params)))).toBeNull();
  });
});

describe('parsePuzzleParams for ORDER_SEQUENCE', () => {
  it('reads items, the answer and the entity map', () => {
    expect(order.variants[0].answer).toEqual(['blue', 'gold', 'red']);
    expect(order.itemEntities.red).toBe('fh-switch-red');
  });

  it('refuses an answer that is not a permutation of the items', () => {
    const bad = {
      ...ORDER_PARAMS,
      variants: [{ ...ORDER_PARAMS.variants[0], answer: ['blue', 'gold'] }],
    };
    expect(parsePuzzleParams('ORDER_SEQUENCE', bad)).toBeNull();
  });

  it('refuses more than six items', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ id: `i${i}`, label: `Item ${i}` }));
    const bad = {
      ...ORDER_PARAMS,
      itemEntities: undefined,
      variants: [{ ...ORDER_PARAMS.variants[0], items, answer: items.map((i) => i.id) }],
    };
    expect(parsePuzzleParams('ORDER_SEQUENCE', JSON.parse(JSON.stringify(bad)))).toBeNull();
  });
});

describe('the client graders', () => {
  it('grades a choice and refuses an unknown option', () => {
    const variant = choose.variants[0];
    expect(chooseAnswerCorrect(variant, 'b')).toBe(true);
    expect(chooseAnswerCorrect(variant, 'a')).toBe(false);
    expect(() => chooseAnswerCorrect(variant, 'zzz')).toThrow();
  });

  it('grades an order and refuses anything that is not a permutation', () => {
    const variant = order.variants[0];
    expect(orderSequenceCorrect(variant, ['blue', 'gold', 'red'])).toBe(true);
    expect(orderSequenceCorrect(variant, ['red', 'gold', 'blue'])).toBe(false);
    expect(() => orderSequenceCorrect(variant, ['blue', 'gold'])).toThrow();
    expect(() => orderSequenceCorrect(variant, ['blue', 'blue', 'red'])).toThrow();
    expect(() => orderSequenceCorrect(variant, ['blue', 'gold', 'x'])).toThrow();
  });
});

describe('variant selection', () => {
  it('is a pure function of session and puzzle', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
    expect(firstVariantIndex('s1', 'p1', 5)).toBe(firstVariantIndex('s1', 'p1', 5));
  });

  it('stays in range and spreads across variants', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 60; i += 1) {
      const index = firstVariantIndex(`session-${i}`, 'fh-choose-1', 4);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
      seen.add(index);
    }
    expect(seen.size).toBe(4);
    expect(firstVariantIndex('s', 'p', 0)).toBe(0);
  });

  it('pins the hash so every client agrees (FNV-1a of "a")', () => {
    expect(hashText('a')).toBe(0xe40c292c);
  });

  it('moves to the next variant and wraps', () => {
    expect(nextVariantIndex(0, 3)).toBe(1);
    expect(nextVariantIndex(2, 3)).toBe(0);
    expect(nextVariantIndex(0, 1)).toBe(0);
  });
});

describe('choice state', () => {
  it('opens on the first variant, and on the next one for practice', () => {
    const first = openChoiceState('s', 'fh-choose-1', choose, false);
    const practice = openChoiceState('s', 'fh-choose-1', choose, true);
    expect(first.practice).toBe(false);
    expect(practice.practice).toBe(true);
    expect(practice.variantIndex).toBe(nextVariantIndex(first.variantIndex, 2));
  });

  it('keeps the question after a wrong answer and counts the try', () => {
    let state = openChoiceState('s', 'p', choose, false);
    state = recordChoiceResult(selectOption(state, 'a'), false);
    expect(state.result).toBe('wrong');
    expect(state.wrongCount).toBe(1);
    expect(state.selected).toBe('a');
  });

  it('"try a different one" gives a fresh question', () => {
    let state = recordChoiceResult(selectOption(openChoiceState('s', 'p', choose, false), 'a'), false);
    state = differentChoiceState(state, choose);
    expect(state.selected).toBeNull();
    expect(state.wrongCount).toBe(0);
    expect(state.variantIndex).toBe(
      nextVariantIndex(openChoiceState('s', 'p', choose, false).variantIndex, 2),
    );
  });

  it('reopens a finished question as the next one', () => {
    const done = recordChoiceResult(openChoiceState('s', 'p', choose, false), true);
    const again = reopenChoiceState(done, choose, true);
    expect(again.practice).toBe(true);
    expect(again.variantIndex).toBe(nextVariantIndex(done.variantIndex, 2));
    const midway = selectOption(openChoiceState('s', 'p', choose, false), 'a');
    expect(reopenChoiceState(midway, choose, false)).toBe(midway);
  });

  it('builds, undoes and clears an order without repeats', () => {
    let state = openChoiceState('s', 'p', order, false);
    state = addToOrder(addToOrder(addToOrder(state, 'red'), 'red'), 'blue');
    expect(state.order).toEqual(['red', 'blue']);
    expect(undoOrder(state).order).toEqual(['red']);
    expect(clearOrder(state).order).toEqual([]);
  });

  it('lists the explanation then the closing lines', () => {
    expect(successLines('Because.', choose)).toEqual([
      'Because.',
      'The stone glows!',
      'Adding puts groups together.',
    ]);
    expect(successLines('Because.', order)).toEqual(['Because.']);
  });

  it('gives every symbol a glyph', () => {
    for (const symbol of ['circle', 'square', 'triangle', 'star', 'diamond', 'hexagon', 'heart', 'moon'] as const) {
      expect(symbolGlyph(symbol)).not.toBe('');
    }
    expect(symbolGlyph(null)).toBe('');
  });
});
