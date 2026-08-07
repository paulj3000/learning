import type { AdventureDefinition } from '../engine/types';

/**
 * "The Storykeeper's Tale", Storykeeper Castle's first adventure
 * (docs/ROADMAP.md Phase 5). Targets Pathfinders (ages 5-6) only for this
 * first authored adventure, same scope precedent as Phase 3's "Repair the
 * Moonlight Bridge". The child picks the story's hero and setting through
 * curated `CREATIVE_CHOICE` options (no free text, per docs/AI_AND_CHILD_
 * SAFETY.md's child input policy); Chatty then narrates a short AI-varied
 * scene for each choice (wired in useAdventureSession.ts via the existing
 * Phase 4 `generateCompanionTurn` route with intent NARRATE). The
 * comprehension and sequencing steps below are deliberately anchored to
 * `keeper-explains-rules`' fixed, authored line rather than to any AI-
 * generated scene text, so correctness stays 100% deterministic
 * (CLAUDE.md section 7) no matter what Chatty narrates.
 */
export const THE_STORYKEEPERS_TALE: AdventureDefinition = {
  slug: 'the-storykeepers-tale',
  version: 1,
  title: "The Storykeeper's Tale",
  locationSlug: 'storykeeper-castle',
  ageBands: ['PATHFINDER'],
  entryStepId: 'meet-keeper-quill',
  steps: [
    {
      id: 'meet-keeper-quill',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Keeper Quill',
        text: 'Welcome to the castle library! I keep all the island stories here, but today’s page is empty. Will you help me tell a brand new tale?',
      },
      transitions: [{ when: 'always', nextStepId: 'choose-hero' }],
      fallback: { text: 'Keeper Quill needs help telling a brand new story.' },
    },
    {
      id: 'choose-hero',
      type: 'CREATIVE_CHOICE',
      objectiveIds: ['creative-storytelling'],
      presentation: {
        kind: 'creative-choice',
        prompt: "Who should be the hero of today's story?",
        options: [
          { id: 'hero-puppy', label: 'A brave puppy' },
          { id: 'hero-dragon', label: 'A curious dragon' },
          { id: 'hero-fox', label: 'A clever fox' },
        ],
      },
      transitions: [{ when: 'always', nextStepId: 'choose-setting' }],
      fallback: { text: 'A brave hero is ready for an adventure.' },
    },
    {
      id: 'choose-setting',
      type: 'CREATIVE_CHOICE',
      objectiveIds: ['creative-storytelling'],
      presentation: {
        kind: 'creative-choice',
        prompt: 'Where does the story take place?',
        options: [
          { id: 'setting-island', label: 'A floating island' },
          { id: 'setting-mountain', label: 'A snowy mountain' },
          { id: 'setting-cave', label: 'A hidden glowing cave' },
        ],
      },
      transitions: [{ when: 'always', nextStepId: 'keeper-explains-rules' }],
      fallback: { text: 'The story takes place somewhere new and exciting.' },
    },
    {
      id: 'keeper-explains-rules',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Keeper Quill',
        text: 'Every good story needs three things: a hero, a problem to solve, and a happy ending. Let’s see if you remember!',
      },
      transitions: [{ when: 'always', nextStepId: 'comprehension-check' }],
      fallback: { text: 'Every good story needs a hero, a problem, and a happy ending.' },
    },
    {
      id: 'comprehension-check',
      type: 'CHOICE',
      objectiveIds: ['reading-comprehension'],
      presentation: {
        kind: 'choice',
        prompt: 'What did Keeper Quill say every good story needs?',
        options: [
          { id: 'opt-three-things', label: 'A hero, a problem, and a happy ending' },
          { id: 'opt-treasure', label: 'A hidden treasure map' },
          { id: 'opt-song', label: 'A magical song' },
        ],
        correctOptionId: 'opt-three-things',
      },
      transitions: [
        { when: 'correct', nextStepId: 'order-the-story' },
        { when: 'incorrect', nextStepId: 'comprehension-check' },
      ],
      hintPolicy: {
        ladder: [
          "You've got this! What did Keeper Quill say every good story needs?",
          'Think back to what Keeper Quill just told you.',
          'Keeper Quill named three things a story needs.',
          'Keeper Quill said: a hero, a problem, and a happy ending.',
          'The answer is "A hero, a problem, and a happy ending."',
        ],
      },
      fallback: { text: 'Every good story needs a hero, a problem, and a happy ending.' },
    },
    {
      id: 'order-the-story',
      type: 'ORDERING',
      objectiveIds: ['sequencing'],
      presentation: {
        kind: 'ordering',
        prompt: 'Put these story beats in the right order.',
        items: [
          { id: 'beat-choice', label: 'The hero makes a brave choice' },
          { id: 'beat-ending', label: 'The story reaches a happy ending' },
          { id: 'beat-problem', label: 'The hero finds a problem' },
        ],
        correctOrder: ['beat-problem', 'beat-choice', 'beat-ending'],
      },
      transitions: [
        { when: 'correct', nextStepId: 'story-reflection' },
        { when: 'incorrect', nextStepId: 'order-the-story' },
      ],
      hintPolicy: {
        ladder: [
          "Nice work so far! Let's put the story beats in order.",
          'Think about what has to happen first in a story.',
          'A story starts with a problem, then a choice, then an ending.',
          'The problem comes first, then the brave choice.',
          'The order is: the problem, the choice, then the happy ending.',
        ],
      },
      fallback: { text: 'First the problem, then the choice, then the happy ending.' },
    },
    {
      id: 'story-reflection',
      type: 'REFLECTION',
      objectiveIds: [],
      presentation: {
        kind: 'reflection',
        prompt:
          'Before Keeper Quill binds your tale, take a moment to picture it: your hero, the setting, and how it ends.',
      },
      transitions: [{ when: 'always', nextStepId: 'story-written' }],
      fallback: { text: 'Picture your story before it is bound into a book.' },
    },
    {
      id: 'story-written',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'Keeper Quill binds your tale into a brand new book for the castle library!',
        payload: {
          changeType: 'STORY_CREATED',
          changeKey: 'FIRST_STORY_TOLD',
          locationSlug: 'storykeeper-castle',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'Your story is bound into a brand new book!' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You and Keeper Quill told a brand new story together! It now has a home in the castle library.',
      },
      transitions: [],
      fallback: { text: 'You told a brand new story together!' },
    },
  ],
};
