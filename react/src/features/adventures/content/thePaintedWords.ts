import type { AdventureDefinition, AdventureStep, ChoiceOption } from '../engine/types';
import {
  PAINTED_WORDS_SETS,
  type OddOneOutQuestion,
  type PaintedWordsSet,
  type RhymeQuestion,
  type BeginningSoundQuestion,
  type SyllableQuestion,
  wordOf,
} from './paintedWordsBank';

/**
 * "The Painted Words" (SC-R04-05), a Pathfinder (ages 5 to 6) phonemic-awareness
 * mission in Storykeeper Castle's Illustration Studio. Something made the words
 * in the Great Storybook's illustrations run off into the paintings; the child
 * recovers them with four short activities (a rhyme gallery, a beginning-sound
 * hunt, a syllable workshop, and the restoration) and the page
 * `page-painted-words` returns to the book.
 *
 * Authored entirely from the approved word bank (`paintedWordsBank.ts`), uses
 * only step types the engine already has, grades in app code, needs no AI, has no
 * timers and no free text, and a wrong answer only loops back to the same step.
 *
 * Two approved sets exist so a replay shows fresh words. They are two definitions
 * of one story: the same page, the same world change (idempotent), different
 * words. `selectPaintedWordsSlug` picks between them.
 *
 * It lives at the real `storykeeper-castle` location, because both the content export and
 * the location-manifest validator require a START_ADVENTURE interaction's location to be a real
 * one that the adventure is authored for. The card route offers the location's first template
 * (the Tale); this mission is reached through its own named interaction, so it is exempt from the
 * one-adventure-per-band invariant (`PREFERRED_ONLY_ADVENTURES` in adventureInvariants.test.ts).
 */
export const PAINTED_WORDS_LOCATION_SLUG = 'storykeeper-castle';
export const PAINTED_WORDS_CHANGE_KEY = 'STUDIO_PAGE_MENDED';
export const PAINTED_WORDS_PAGE_ID = 'page-painted-words';
export const PAINTED_WORDS_SLUG = 'the-painted-words';
export const PAINTED_WORDS_AGAIN_SLUG = 'the-painted-words-again';

const SPEAKER = 'Keeper Quill';
const OBJECTIVE = 'phonemic-awareness';

const option = (word: string): ChoiceOption => ({ id: `opt-${word}`, label: word });

/** Display order is fixed in content so tests are deterministic. The answer is not always first. */
function orderedOptions(
  answer: string,
  distractors: readonly string[],
  slot: number,
): ChoiceOption[] {
  const all = [...distractors];
  all.splice(slot % (all.length + 1), 0, answer);
  return all.map(option);
}

function choiceStep(
  id: string,
  prompt: string,
  options: ChoiceOption[],
  answer: string,
  nextStepId: string,
  ladder: string[],
  fallbackText: string,
): AdventureStep {
  return {
    id,
    type: 'CHOICE',
    objectiveIds: [OBJECTIVE],
    presentation: { kind: 'choice', prompt, options, correctOptionId: `opt-${answer}` },
    transitions: [
      { when: 'correct', nextStepId },
      { when: 'incorrect', nextStepId: id },
    ],
    hintPolicy: { ladder },
    fallback: { text: fallbackText },
  };
}

function rhymeStep(q: RhymeQuestion, slot: number, next: string): AdventureStep {
  const rime = wordOf(q.target).rime;
  const options = orderedOptions(q.answer, q.distractors, slot);
  return choiceStep(
    q.id,
    `Which word rhymes with ${q.target}?`,
    options,
    q.answer,
    next,
    [
      `Say ${q.target} out loud. Which word sounds like it at the end?`,
      `Listen to the end of each word: ${options.map((o) => o.label).join(', ')}.`,
      `${q.target} ends with ${rime}. Which one ends with ${rime} too?`,
      `${q.target} and ${q.answer} both end with ${rime}.`,
      `The answer is ${q.answer}.`,
    ],
    `${q.target} and ${q.answer} sound the same at the end.`,
  );
}

function beginningStep(q: BeginningSoundQuestion, slot: number, next: string): AdventureStep {
  const options = orderedOptions(q.answer, q.distractors, slot);
  return choiceStep(
    q.id,
    `Which one starts with the same sound as ${q.target}?`,
    options,
    q.answer,
    next,
    [
      `Say ${q.target} slowly. What sound do you hear first?`,
      `Listen to the start of each word: ${options.map((o) => o.label).join(', ')}.`,
      `${q.target} and one of these start with the very same sound.`,
      `${q.target} and ${q.answer} start with the same sound.`,
      `The answer is ${q.answer}.`,
    ],
    `${q.target} and ${q.answer} start with the same sound.`,
  );
}

function oddOneOutStep(q: OddOneOutQuestion, next: string): AdventureStep {
  const words = [q.rhyming[0], q.rhyming[1], q.odd, q.rhyming[2]];
  const rime = wordOf(q.rhyming[0]).rime;
  return choiceStep(
    q.id,
    'Three of these rhyme. Which one does not?',
    words.map(option),
    q.odd,
    next,
    [
      'Say each word out loud. Listen to how each one ends.',
      `Three of these words end with ${rime}.`,
      `${q.rhyming.join(', ')} all end the same way.`,
      `${q.odd} does not end like the others.`,
      `The answer is ${q.odd}.`,
    ],
    `${q.odd} is the word that does not rhyme.`,
  );
}

function syllableStep(q: SyllableQuestion, next: string): AdventureStep {
  const entry = wordOf(q.word);
  return {
    id: q.id,
    type: 'NUMBER_INPUT',
    objectiveIds: [OBJECTIVE],
    presentation: {
      kind: 'number-input',
      prompt: `Clap the parts in ${q.word}. How many claps?`,
      correctValue: entry.syllables,
    },
    transitions: [
      { when: 'correct', nextStepId: next },
      { when: 'incorrect', nextStepId: q.id },
    ],
    hintPolicy: {
      ladder: [
        `Say ${q.word} slowly and clap each part.`,
        'Put your hand under your chin. Each part makes your chin dip.',
        `Try it in pieces: ${entry.parts.split('-').join(', ')}.`,
        `${q.word} has ${entry.syllables} ${entry.syllables === 1 ? 'part' : 'parts'}: ${entry.parts}.`,
        `The answer is ${entry.syllables}.`,
      ],
    },
    fallback: {
      text: `${q.word} has ${entry.syllables} ${entry.syllables === 1 ? 'clap' : 'claps'}.`,
    },
  };
}

function narrative(id: string, text: string, next: string, fallback: string): AdventureStep {
  return {
    id,
    type: 'NARRATIVE',
    objectiveIds: [],
    presentation: { kind: 'narrative', speaker: SPEAKER, text },
    transitions: [{ when: 'always', nextStepId: next }],
    fallback: { text: fallback },
  };
}

export function buildPaintedWords(
  slug: string,
  title: string,
  set: PaintedWordsSet,
): AdventureDefinition {
  const [r1, r2] = set.rhymes;
  const [b1, b2] = set.beginnings;
  const [s1, s2] = set.syllables;
  const steps: AdventureStep[] = [
    narrative(
      'paint-room-intro',
      'When the Great Storybook tore, one page landed in the Illustration Studio, and its words ran off into the paintings. Each picture still remembers its sound. Can you help the words find their way home?',
      r1.id,
      'The words ran into the paintings. Help them find their way home.',
    ),
    rhymeStep(r1, 0, r2.id),
    rhymeStep(r2, 1, b1.id),
    beginningStep(b1, 2, b2.id),
    beginningStep(b2, 1, set.oddOneOut.id),
    oddOneOutStep(set.oddOneOut, s1.id),
    syllableStep(s1, s2.id),
    syllableStep(s2, 'favourite-painting'),
    {
      id: 'favourite-painting',
      type: 'REFLECTION',
      objectiveIds: [],
      presentation: {
        kind: 'reflection',
        prompt:
          'Look at the words you brought home. Which painting would you like to add to the page?',
      },
      transitions: [{ when: 'always', nextStepId: 'page-mended' }],
      fallback: { text: 'Think of your favourite painting.' },
    },
    {
      id: 'page-mended',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'One by one, the words fly out of the paintings and settle back onto the page. The picture is whole again!',
        payload: {
          changeType: 'REPAIR',
          changeKey: PAINTED_WORDS_CHANGE_KEY,
          locationSlug: PAINTED_WORDS_LOCATION_SLUG,
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The words are back on the page.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'The words are home. Let us take this page to the Great Storybook.',
      },
      transitions: [],
      fallback: { text: 'The words are home.' },
    },
  ];
  return {
    slug,
    version: 1,
    title,
    locationSlug: PAINTED_WORDS_LOCATION_SLUG,
    ageBands: ['PATHFINDER'],
    entryStepId: 'paint-room-intro',
    steps,
  };
}

export const THE_PAINTED_WORDS: AdventureDefinition = buildPaintedWords(
  PAINTED_WORDS_SLUG,
  'The Painted Words',
  PAINTED_WORDS_SETS[0],
);

/** The replay: the same story and page with the second approved word set. */
export const THE_PAINTED_WORDS_AGAIN: AdventureDefinition = buildPaintedWords(
  PAINTED_WORDS_AGAIN_SLUG,
  'The Painted Words, Again',
  PAINTED_WORDS_SETS[1],
);

/**
 * Adventure slugs that are reached only through a named interaction at a location that already has a
 * first-listed adventure. The one-adventure-per-band invariants skip them (see the file header).
 */
export const PREFERRED_ONLY_ADVENTURES: readonly string[] = [
  PAINTED_WORDS_SLUG,
  PAINTED_WORDS_AGAIN_SLUG,
];

export const PAINTED_WORDS_ADVENTURES: AdventureDefinition[] = [
  THE_PAINTED_WORDS,
  THE_PAINTED_WORDS_AGAIN,
];

/**
 * Which word set to play. First play uses set A; once the page is mended the
 * replay uses set B. Pure, so the choice is testable and never random.
 */
export function selectPaintedWordsSlug(worldChangeKeys: readonly string[]): string {
  return worldChangeKeys.includes(PAINTED_WORDS_CHANGE_KEY)
    ? PAINTED_WORDS_AGAIN_SLUG
    : PAINTED_WORDS_SLUG;
}
