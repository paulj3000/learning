import { read } from '../api/parse';
import * as parse from '../api/play/parse';
import type { RegionBootstrap } from '../api/play/types';
import { firepeakBootstrapJson } from './firepeakFixtures';

/** CHOOSE_ANSWER and ORDER_SEQUENCE parameters and a bootstrap holding two of each (FPV). */

export const CHOOSE_PARAMS = {
  presentation: 'PLATFORMS',
  subject: 'MATHEMATICS',
  skill: 'addition-within-10',
  optionEntities: { a: 'fh-stone-a', b: 'fh-stone-b', c: 'fh-stone-c' },
  variants: [
    {
      id: 'v1',
      prompt: 'What is 3 + 4?',
      options: [
        { id: 'a', label: '6', symbol: 'circle' },
        { id: 'b', label: '7', symbol: 'star' },
        { id: 'c', label: '8', symbol: 'moon' },
      ],
      answer: 'b',
      explanation: '3 and 4 together make 7.',
    },
    {
      id: 'v2',
      prompt: 'What is 2 + 5?',
      options: [
        { id: 'a', label: '6', symbol: 'circle' },
        { id: 'b', label: '7', symbol: 'star' },
        { id: 'c', label: '8', symbol: 'moon' },
      ],
      answer: 'b',
      explanation: '2 and 5 together make 7.',
    },
  ],
  hints: ['Count up from 4.'],
  hintAfterAttempts: 2,
  completeMessage: 'The stone glows!',
  scienceNote: 'Adding puts groups together.',
};

export const ORDER_PARAMS = {
  presentation: 'SWITCHES',
  subject: 'LOGIC',
  skill: 'sequencing',
  itemEntities: { red: 'fh-switch-red', blue: 'fh-switch-blue', gold: 'fh-switch-gold' },
  variants: [
    {
      id: 'v1',
      prompt: 'Press the switches from coolest to hottest.',
      items: [
        { id: 'red', label: 'Fire switch', symbol: 'triangle' },
        { id: 'blue', label: 'Water switch', symbol: 'circle' },
        { id: 'gold', label: 'Sun switch', symbol: 'star' },
      ],
      answer: ['blue', 'gold', 'red'],
      explanation: 'Water is cool, the sun is warm and fire is hottest.',
    },
  ],
  hints: [],
  hintAfterAttempts: 2,
};

function puzzle(
  puzzleId: string,
  kind: string,
  title: string,
  entityIds: string[],
  parameters: Record<string, unknown>,
  solved: boolean,
) {
  return { puzzleId, kind, title, entityIds, solved, locked: false, failedAttempts: 0, parameters };
}

/** A Firepeak bootstrap with two CHOOSE_ANSWER puzzles and one ORDER_SEQUENCE puzzle added. */
export function choiceBootstrap(solved: string[] = []): RegionBootstrap {
  const json = firepeakBootstrapJson({ session: true });
  const other = {
    ...CHOOSE_PARAMS,
    optionEntities: { a: 'fh-other-a', b: 'fh-other-b', c: 'fh-other-c' },
  };
  const extra = [
    puzzle('fh-choose-1', 'CHOOSE_ANSWER', 'Lava stones', Object.values(CHOOSE_PARAMS.optionEntities), CHOOSE_PARAMS, solved.includes('fh-choose-1')),
    puzzle('fh-choose-2', 'CHOOSE_ANSWER', 'Other stones', Object.values(other.optionEntities), other, solved.includes('fh-choose-2')),
    puzzle('fh-order-1', 'ORDER_SEQUENCE', 'Forge switches', Object.values(ORDER_PARAMS.itemEntities), ORDER_PARAMS, solved.includes('fh-order-1')),
  ];
  return read({ ...json, puzzles: [...json.puzzles, ...extra] }, parse.regionBootstrap);
}
