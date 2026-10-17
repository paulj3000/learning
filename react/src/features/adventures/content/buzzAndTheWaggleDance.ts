import type { AdventureDefinition } from '../engine/types';
import { WONDER_WALL_ANSWERED_QUESTION_ID, WONDER_WALL_QUESTIONS } from './wonderWallQuestions';

/**
 * "Buzz and the Waggle Dance", Wonderwild Forest's first adventure
 * (docs/ROADMAP.md Phase 6). Targets Pathfinders (ages 5-6) only for this
 * first authored adventure, same scope precedent as Phase 3's "Repair the
 * Moonlight Bridge" and Phase 5's "The Storykeeper's Tale".
 *
 * The child picks a question from the curated Wonder Wall
 * (`wonderWallQuestions.ts`, `wonder-wall` step below); only
 * `WONDER_WALL_ANSWERED_QUESTION_ID` continues into this adventure today,
 * and every other question gets a calm, safe redirect
 * (`wonder-wall-fallback`) rather than a dead end — docs/ROADMAP.md's
 * "safe fallback when a question is out of scope", implemented
 * deterministically as a plain CHOICE-step transition rather than an AI
 * safety check, since the boundary here is "not built yet," not "unsafe."
 * `shrink-into-hive` is the one `aiNarrated` step: Chatty narrates a bounded
 * variation of the authored shrinking scene (docs/ROADMAP.md "bounded
 * curiosity-to-adventure generation"), reusing the existing Phase 4
 * `generateCompanionTurn` route with `authoredBaseText` grounding so it can
 * rephrase but never contradict the authored text. The observation and
 * comprehension steps are anchored to fixed, authored facts (see "Sources"
 * below) so correctness stays 100% deterministic no matter what Chatty
 * says, matching Phase 5's "Storykeeper's Tale" precedent.
 *
 * Sources (docs/CONTENT_SOURCES.md):
 * - Honeybees perform a "waggle dance" on the honeycomb to tell nearby
 *   bees the direction and distance of a food source; a longer waggle run
 *   signals a farther distance. Well-established since Karl von Frisch's
 *   research (1946), for which he shared the 1973 Nobel Prize in
 *   Physiology or Medicine; widely corroborated since and taught as
 *   standard entomology. Checked against general science-communication
 *   consensus (not a single primary source) on 2026-08-07.
 */
export const BUZZ_AND_THE_WAGGLE_DANCE: AdventureDefinition = {
  slug: 'buzz-and-the-waggle-dance',
  version: 1,
  title: 'Buzz and the Waggle Dance',
  locationSlug: 'wonderwild-forest',
  ageBands: ['PATHFINDER'],
  entryStepId: 'wonder-wall',
  steps: [
    {
      id: 'wonder-wall',
      type: 'CHOICE',
      objectiveIds: ['curious-questioning'],
      presentation: {
        kind: 'choice',
        prompt:
          'The Wonder Wall is covered in curious questions. What are you curious about today?',
        options: WONDER_WALL_QUESTIONS.map((entry) => ({ id: entry.id, label: entry.question })),
        correctOptionId: WONDER_WALL_ANSWERED_QUESTION_ID,
      },
      transitions: [
        { when: 'correct', nextStepId: 'shrink-into-hive' },
        { when: 'incorrect', nextStepId: 'wonder-wall-fallback' },
      ],
      fallback: { text: "Today's question is: why do bees dance?" },
    },
    {
      id: 'wonder-wall-fallback',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'That is a wonderful question! That part of the forest is still growing, so let’s explore why bees dance today instead.',
      },
      transitions: [{ when: 'always', nextStepId: 'shrink-into-hive' }],
      fallback: { text: "Let's explore why bees dance today." },
    },
    {
      id: 'shrink-into-hive',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'Hold on tight! A little island magic shrinks you down, down, down, until you are standing right at the door of a buzzing beehive.',
        aiNarrated: true,
      },
      transitions: [{ when: 'always', nextStepId: 'meet-buzz' }],
      fallback: { text: 'Island magic shrinks you down to the door of a buzzing beehive.' },
    },
    {
      id: 'meet-buzz',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'This is Buzz! She just flew back from a flower patch, and now she is wiggling back and forth on the honeycomb while her sisters watch closely.',
      },
      transitions: [{ when: 'always', nextStepId: 'observe-the-dance' }],
      fallback: { text: 'Buzz is wiggling back and forth while the other bees watch.' },
    },
    {
      id: 'observe-the-dance',
      type: 'CHOICE',
      objectiveIds: ['cause-and-effect'],
      presentation: {
        kind: 'choice',
        prompt:
          'Buzz waggles for a long time before turning around. What is she telling the other bees?',
        options: [
          { id: 'opt-far-away', label: 'The flowers are far away' },
          { id: 'opt-next-door', label: 'The flowers are right next to the hive' },
          { id: 'opt-bedtime', label: 'It is time to sleep' },
        ],
        correctOptionId: 'opt-far-away',
      },
      transitions: [
        { when: 'correct', nextStepId: 'count-the-waggles' },
        { when: 'incorrect', nextStepId: 'observe-the-dance' },
      ],
      hintPolicy: {
        ladder: [
          "You're a great observer! What does a long waggle tell the other bees?",
          'Think about how far Buzz just flew to reach the flowers.',
          'The longer Buzz dances, the more she has to tell the other bees.',
          'A long waggle means a long trip: the flowers are far from the hive.',
          'The answer is "The flowers are far away."',
        ],
      },
      fallback: { text: 'A long waggle means the flowers are far away from the hive.' },
    },
    {
      id: 'count-the-waggles',
      type: 'NUMBER_INPUT',
      objectiveIds: ['observation'],
      presentation: {
        kind: 'number-input',
        prompt: 'Watch closely. How many times does Buzz waggle her body before she turns around?',
        correctValue: 5,
      },
      transitions: [
        { when: 'correct', nextStepId: 'science-comprehension-check' },
        { when: 'incorrect', nextStepId: 'count-the-waggles' },
      ],
      hintPolicy: {
        ladder: [
          'Watch Buzz closely and count each waggle.',
          'Try counting out loud as she moves.',
          'She waggles more than three times, but fewer than seven.',
          'Count carefully: 1, 2, 3, 4...',
          'Buzz waggled 5 times.',
        ],
      },
      fallback: { text: 'Buzz waggled 5 times before turning around.' },
    },
    {
      id: 'science-comprehension-check',
      type: 'CHOICE',
      objectiveIds: ['science-comprehension'],
      presentation: {
        kind: 'choice',
        prompt: 'Why does Buzz do a waggle dance?',
        options: [
          { id: 'opt-tell-flowers', label: 'To tell the other bees where to find flowers' },
          { id: 'opt-warm-wings', label: 'To warm up her wings' },
          { id: 'opt-goodnight', label: 'To say goodnight' },
        ],
        correctOptionId: 'opt-tell-flowers',
      },
      transitions: [
        { when: 'correct', nextStepId: 'wonder-reflection' },
        { when: 'incorrect', nextStepId: 'science-comprehension-check' },
      ],
      hintPolicy: {
        ladder: [
          "You've got this! Why did Buzz do her waggle dance?",
          'Think about what Buzz just showed the other bees.',
          'Buzz found something the whole hive needs to know about.',
          'Buzz is telling the other bees exactly where to find flowers.',
          'The answer is "To tell the other bees where to find flowers."',
        ],
      },
      fallback: { text: 'Buzz dances to tell the other bees where to find flowers.' },
    },
    {
      id: 'wonder-reflection',
      type: 'REFLECTION',
      objectiveIds: [],
      presentation: {
        kind: 'reflection',
        prompt:
          'Buzz is proud to share her hive with you. Before you head back, think of one more question you are curious about in nature.',
      },
      transitions: [{ when: 'always', nextStepId: 'forest-changes' }],
      fallback: { text: 'Think of one more question you are curious about in nature.' },
    },
    {
      id: 'forest-changes',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The Wonder Wall lights up with a picture of a waggling bee, and a new patch of flowers blooms in Wonderwild Forest!',
        payload: {
          changeType: 'WONDER_DISCOVERED',
          changeKey: 'WAGGLE_DANCE_DISCOVERED',
          locationSlug: 'wonderwild-forest',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The Wonder Wall lights up and new flowers bloom in the forest!' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You helped uncover one of Wonderwild Forest’s best-kept secrets: why bees dance! The Wonder Wall will remember this discovery.',
      },
      transitions: [],
      fallback: { text: 'You discovered why bees dance!' },
    },
  ],
};
