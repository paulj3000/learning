/**
 * The approved word bank for "The Painted Words" (SC-R04-05).
 *
 * Every word is a short, concrete noun a five-year-old can picture. Each entry
 * records the phonological facts the mission relies on (rime, first sound,
 * syllable count) so a unit test can prove every authored question is correct
 * and unambiguous, instead of trusting the author's ear. Grading is always done
 * by app code against these facts, never by a model (CLAUDE.md section 7).
 *
 * `onset` is a *sound*, not a letter name: "sun" and "sock" share /s/, and a
 * word such as "cup" (/k/) is never paired with "kite" or "city" here, so the
 * spelling cannot mislead. `pictureId` names the picture card the asset registry
 * resolves (a generated placeholder until final art exists).
 */
export interface PaintedWord {
  word: string;
  /** Picture card id in the asset registry. */
  pictureId: string;
  /** The word's ending sound family, e.g. `at` for cat and hat. Empty when unused. */
  rime: string;
  /** The first sound as a plain phoneme symbol, e.g. `s`, `b`, `f`. */
  onset: string;
  syllables: 1 | 2 | 3;
  /** Clapped out loud, e.g. `ap-ple`. Its parts must number `syllables`. */
  parts: string;
}

const w = (
  word: string,
  rime: string,
  onset: string,
  syllables: 1 | 2 | 3,
  parts = word,
): PaintedWord => ({ word, pictureId: `painted-words-${word}`, rime, onset, syllables, parts });

export const PAINTED_WORD_BANK: Readonly<Record<string, PaintedWord>> = Object.fromEntries(
  [
    w('cat', 'at', 'k', 1),
    w('hat', 'at', 'h', 1),
    w('dog', 'og', 'd', 1),
    w('log', 'og', 'l', 1),
    w('frog', 'og', 'fr', 1),
    w('sun', 'un', 's', 1),
    w('moon', 'oon', 'm', 1),
    w('spoon', 'oon', 'sp', 1),
    w('star', 'ar', 'st', 1),
    w('tree', 'ee', 'tr', 1),
    w('bee', 'ee', 'b', 1),
    w('ball', 'all', 'b', 1),
    w('bat', 'at', 'b', 1),
    w('bear', 'air', 'b', 1),
    w('bed', 'ed', 'b', 1),
    w('cup', 'up', 'k', 1),
    w('fish', 'ish', 'f', 1),
    w('fan', 'an', 'f', 1),
    w('pig', 'ig', 'p', 1),
    w('sock', 'ock', 's', 1),
    w('lamp', 'amp', 'l', 1),
    w('cow', 'ow', 'k', 1),
    w('drum', 'um', 'dr', 1),
    w('cake', 'ake', 'k', 1),
    w('lake', 'ake', 'l', 1),
    w('snake', 'ake', 'sn', 1),
    w('apple', 'ple', 'a', 2, 'ap-ple'),
    w('dragon', 'gon', 'd', 2, 'dra-gon'),
    w('banana', 'na', 'b', 3, 'ba-na-na'),
    w('butterfly', 'fly', 'b', 3, 'but-ter-fly'),
  ].map((entry) => [entry.word, entry]),
);

export const wordOf = (word: string): PaintedWord => {
  const entry = PAINTED_WORD_BANK[word];
  if (!entry) throw new Error(`"${word}" is not in the approved Painted Words bank.`);
  return entry;
};

/** A rhyme question: the target and the one choice that shares its rime. */
export interface RhymeQuestion {
  id: string;
  target: string;
  answer: string;
  distractors: readonly [string, string];
}

/** A beginning-sound question: the one choice that shares the target's first sound. */
export interface BeginningSoundQuestion {
  id: string;
  target: string;
  answer: string;
  distractors: readonly [string, string];
}

/** Three words rhyme and one does not. */
export interface OddOneOutQuestion {
  id: string;
  rhyming: readonly [string, string, string];
  odd: string;
}

export interface SyllableQuestion {
  id: string;
  word: string;
}

/** One complete, approved play-through. `setId` names it for replay selection. */
export interface PaintedWordsSet {
  setId: 'set-a' | 'set-b';
  rhymes: readonly [RhymeQuestion, RhymeQuestion];
  beginnings: readonly [BeginningSoundQuestion, BeginningSoundQuestion];
  oddOneOut: OddOneOutQuestion;
  syllables: readonly [SyllableQuestion, SyllableQuestion];
}

/**
 * The approved pools. The first play-through uses set A; a replay uses set B so
 * a child sees fresh words, and a later replay returns to set A. Both are fully
 * authored and reviewed here, nothing is generated for a child at runtime.
 */
export const PAINTED_WORDS_SETS: readonly [PaintedWordsSet, PaintedWordsSet] = [
  {
    setId: 'set-a',
    rhymes: [
      { id: 'rhyme-cat', target: 'cat', answer: 'hat', distractors: ['dog', 'sun'] },
      { id: 'rhyme-moon', target: 'moon', answer: 'spoon', distractors: ['star', 'tree'] },
    ],
    beginnings: [
      { id: 'first-sound-ball', target: 'ball', answer: 'bat', distractors: ['cup', 'fish'] },
      { id: 'first-sound-sun', target: 'sun', answer: 'sock', distractors: ['pig', 'lamp'] },
    ],
    oddOneOut: { id: 'rhyme-odd-one-out', rhyming: ['log', 'frog', 'dog'], odd: 'cake' },
    syllables: [
      { id: 'clap-apple', word: 'apple' },
      { id: 'clap-banana', word: 'banana' },
    ],
  },
  {
    setId: 'set-b',
    rhymes: [
      { id: 'rhyme-cake', target: 'cake', answer: 'lake', distractors: ['tree', 'fish'] },
      { id: 'rhyme-bee', target: 'bee', answer: 'tree', distractors: ['sun', 'cup'] },
    ],
    beginnings: [
      { id: 'first-sound-fish', target: 'fish', answer: 'fan', distractors: ['bed', 'cow'] },
      { id: 'first-sound-bear', target: 'bear', answer: 'bed', distractors: ['sun', 'fan'] },
    ],
    oddOneOut: { id: 'rhyme-odd-one-out', rhyming: ['cake', 'lake', 'snake'], odd: 'dog' },
    syllables: [
      { id: 'clap-pig', word: 'pig' },
      { id: 'clap-butterfly', word: 'butterfly' },
    ],
  },
];
