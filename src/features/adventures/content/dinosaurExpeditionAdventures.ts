import type { AdventureDefinition } from '../engine/types';

/**
 * The two Adventure Engine challenges embedded in "Dinosaur Expedition",
 * the Adventure Library's exploration arc (docs/ROADMAP.md Phase 15,
 * `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 34).
 * Ordinary `AdventureDefinition`s run by the unchanged Adventure Engine:
 * the Story Engine decides only *when* to embed one, never whether an
 * answer is right (CLAUDE.md section 7). `locationSlug: 'fossil-ridge'` is a
 * story-only pseudo-location that deliberately matches no entry in
 * `src/features/island/locations.ts`, so these never surface on an
 * `IslandLocationPage` — same precedent as `emberMountainChapterAdventures.ts`.
 *
 * Scoped to Pathfinders and Explorers: the reading volume and the
 * addition-within-ten step are above the Sprout band, and the arc's own
 * `supportedAgeBands` matches (`src/features/story/content/dinosaurExpedition.ts`).
 *
 * Sources (docs/CONTENT_SOURCES.md):
 * - A fossil is the preserved remains or traces of a living thing from long
 *   ago, and footprints count as fossils too (trace fossils). Standard
 *   paleontology, taught as such by every major natural history museum;
 *   checked against general science-communication consensus on 2026-08-17.
 * - Paleontologists uncover fossils slowly with soft brushes and small
 *   tools rather than striking them, because fossil bone is brittle.
 *   Standard field practice; checked 2026-08-17.
 * - Large long-necked plant-eating dinosaurs (sauropods) left big, rounded
 *   footprints, while meat-eating dinosaurs that walked on two legs
 *   (theropods) left narrower prints showing three toes. Well established
 *   in dinosaur ichnology (the study of tracks); checked against general
 *   science-communication consensus on 2026-08-17.
 * - A longer distance between one footprint and the next means a longer
 *   stride, which points to a larger or faster animal. Standard
 *   trackway reasoning; checked 2026-08-17.
 */

export const DINO_CHAPTER_1_FOSSIL_DIG: AdventureDefinition = {
  slug: 'dino-chapter-1-fossil-dig',
  version: 1,
  title: 'The Fossil Dig',
  locationSlug: 'fossil-ridge',
  ageBands: ['PATHFINDER', 'EXPLORER'],
  entryStepId: 'arrive-at-the-ridge',
  steps: [
    {
      id: 'arrive-at-the-ridge',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'Fossil Ridge! Something huge is buried in this sandy cliff, and the wind has just uncovered the first piece of it. Shall we dig it out together?',
      },
      transitions: [{ when: 'always', nextStepId: 'choose-the-tool' }],
      fallback: { text: 'Something huge is buried in Fossil Ridge. Let’s dig it out.' },
    },
    {
      id: 'choose-the-tool',
      type: 'CHOICE',
      objectiveIds: ['following-instructions'],
      presentation: {
        kind: 'choice',
        prompt: 'Fossil bone breaks easily. Which tool should we use to clear the sand off it?',
        options: [
          { id: 'soft-brush', label: 'A soft brush' },
          { id: 'heavy-hammer', label: 'A heavy hammer' },
          { id: 'water-bucket', label: 'A bucket of water' },
        ],
        correctOptionId: 'soft-brush',
      },
      transitions: [
        { when: 'correct', nextStepId: 'count-the-bones' },
        { when: 'incorrect', nextStepId: 'choose-the-tool' },
      ],
      hintPolicy: {
        ladder: [
          'Good thinking! Fossil hunters work very gently.',
          'The bone is old and brittle, so nothing heavy or splashy.',
          'We want to move sand away one grain at a time.',
          'Think of the softest tool on the table.',
          'A soft brush is the right tool. Choose the soft brush to keep going.',
        ],
      },
      fallback: { text: 'A soft brush is the gentle tool for uncovering a fossil.' },
    },
    {
      id: 'count-the-bones',
      type: 'NUMBER_INPUT',
      objectiveIds: ['counting-sets'],
      presentation: {
        kind: 'number-input',
        prompt: 'You brush the sand away and long curved bones appear. How many bones can you see?',
        correctValue: 6,
      },
      transitions: [
        { when: 'correct', nextStepId: 'order-the-dig-steps' },
        { when: 'incorrect', nextStepId: 'count-the-bones' },
      ],
      hintPolicy: {
        ladder: [
          'You can do this! Let’s count the bones together.',
          'Start at the left end of the row and work across.',
          'Touch each bone and say the number out loud.',
          'There are four long bones and two shorter ones.',
          'There are 6 bones. Type 6 to keep going.',
        ],
      },
      fallback: { text: 'There are 6 bones in the sand.' },
    },
    {
      id: 'order-the-dig-steps',
      type: 'ORDERING',
      objectiveIds: ['sequencing'],
      presentation: {
        kind: 'ordering',
        prompt: 'Put the fossil hunter’s steps in the right order.',
        items: [
          { id: 'lift-bone', label: 'Lift the bone into the crate' },
          { id: 'brush-sand', label: 'Brush the sand away' },
          { id: 'draw-map', label: 'Draw where the bone was lying' },
        ],
        correctOrder: ['brush-sand', 'draw-map', 'lift-bone'],
      },
      transitions: [
        { when: 'correct', nextStepId: 'dig-site-narration' },
        { when: 'incorrect', nextStepId: 'order-the-dig-steps' },
      ],
      hintPolicy: {
        ladder: [
          'Nice work so far! Let’s think about what comes first.',
          'You cannot draw a bone you have not uncovered yet.',
          'Uncovering comes first, and lifting comes last.',
          'Brush the sand away, then draw the map, then lift.',
          'The order is: brush the sand, draw where it was lying, lift the bone.',
        ],
      },
      fallback: { text: 'Brush first, then draw the map, then lift the bone.' },
    },
    {
      id: 'dig-site-narration',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'Six bones, safe in the crate, and a map of exactly where they lay. Fossil Ridge has a real dig site now.',
      },
      transitions: [{ when: 'always', nextStepId: 'dig-site-opened' }],
      fallback: { text: 'Fossil Ridge has a real dig site now.' },
    },
    {
      id: 'dig-site-opened',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'A proper dig site is open on Fossil Ridge, with crates, brushes, and a map.',
        payload: {
          changeType: 'CREATE',
          changeKey: 'FOSSIL_DIG_SITE_OPENED',
          locationSlug: 'fossil-ridge',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'A dig site is open on Fossil Ridge.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You opened the dig site! Six ancient bones are safe, and something even bigger is waiting nearby.',
      },
      transitions: [],
      fallback: { text: 'You opened the dig site!' },
    },
  ],
};

export const DINO_CHAPTER_2_FOOTPRINT_TRAIL: AdventureDefinition = {
  slug: 'dino-chapter-2-footprint-trail',
  version: 1,
  title: 'The Footprint Trail',
  locationSlug: 'fossil-ridge',
  ageBands: ['PATHFINDER', 'EXPLORER'],
  entryStepId: 'find-the-trail',
  steps: [
    {
      id: 'find-the-trail',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'Look at the flat rock behind the dig site. Those dips are not puddles. They are footprints, turned to stone a very long time ago.',
      },
      transitions: [{ when: 'always', nextStepId: 'add-the-prints' }],
      fallback: { text: 'There are ancient footprints turned to stone on the flat rock.' },
    },
    {
      id: 'add-the-prints',
      type: 'NUMBER_INPUT',
      objectiveIds: ['addition-within-ten'],
      presentation: {
        kind: 'number-input',
        prompt:
          'There are 4 footprints on the sunny side of the rock and 3 on the shady side. How many footprints are there altogether?',
        correctValue: 7,
      },
      transitions: [
        { when: 'correct', nextStepId: 'order-the-prints' },
        { when: 'incorrect', nextStepId: 'add-the-prints' },
      ],
      hintPolicy: {
        ladder: [
          'You can do this! Let’s put the two groups together.',
          'Start with the 4 sunny prints in your head.',
          'Now count on: 5, 6, 7.',
          '4 and 3 more makes seven.',
          'The answer is 7. Type 7 to keep going.',
        ],
      },
      fallback: { text: '4 and 3 more makes 7 footprints.' },
    },
    {
      id: 'order-the-prints',
      type: 'ORDERING',
      objectiveIds: ['comparing-lengths'],
      presentation: {
        kind: 'ordering',
        prompt: 'Line the three footprints up from smallest to biggest.',
        items: [
          { id: 'huge-print', label: 'A print as wide as a wheel' },
          { id: 'small-print', label: 'A print the size of your hand' },
          { id: 'middle-print', label: 'A print the size of a dinner plate' },
        ],
        correctOrder: ['small-print', 'middle-print', 'huge-print'],
      },
      transitions: [
        { when: 'correct', nextStepId: 'who-made-the-print' },
        { when: 'incorrect', nextStepId: 'order-the-prints' },
      ],
      hintPolicy: {
        ladder: [
          'Good start! Let’s compare their sizes.',
          'Picture each print next to the others.',
          'A hand is smaller than a dinner plate.',
          'A dinner plate is smaller than a wheel.',
          'Hand, then dinner plate, then wheel: that is the order.',
        ],
      },
      fallback: { text: 'Hand sized, then plate sized, then wheel sized.' },
    },
    {
      id: 'who-made-the-print',
      type: 'CHOICE',
      objectiveIds: ['observation'],
      presentation: {
        kind: 'choice',
        prompt:
          'The biggest print is round with short, blunt toes, and the steps between prints are very far apart. What does that tell us?',
        options: [
          { id: 'big-and-heavy', label: 'A very big animal with wide, round feet walked here' },
          { id: 'tiny-and-quick', label: 'A tiny animal with thin toes hopped here' },
          { id: 'nothing-at-all', label: 'The rock just cracked that way on its own' },
        ],
        correctOptionId: 'big-and-heavy',
      },
      transitions: [
        { when: 'correct', nextStepId: 'trail-narration' },
        { when: 'incorrect', nextStepId: 'who-made-the-print' },
      ],
      hintPolicy: {
        ladder: [
          'Great observing! Look at the shape and the spacing.',
          'A round print as wide as a wheel needs a wide, round foot.',
          'Far apart steps mean long legs.',
          'Think big, heavy, and slow, not small and quick.',
          'A very big animal with wide, round feet walked here. Choose that one.',
        ],
      },
      fallback: { text: 'A very big animal with wide, round feet walked here.' },
    },
    {
      id: 'trail-narration',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'You have mapped the whole trail, from the smallest print to the enormous one, and it leads straight along the ridge.',
      },
      transitions: [{ when: 'always', nextStepId: 'trail-mapped' }],
      fallback: { text: 'The whole footprint trail is mapped.' },
    },
    {
      id: 'trail-mapped',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The footprint trail is mapped, with a marker beside every print.',
        payload: {
          changeType: 'CREATE',
          changeKey: 'FOOTPRINT_TRAIL_MAPPED',
          locationSlug: 'fossil-ridge',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The footprint trail is mapped.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You mapped the footprint trail! Now comes the best question of all: who left it?',
      },
      transitions: [],
      fallback: { text: 'You mapped the footprint trail!' },
    },
  ],
};

export const DINOSAUR_EXPEDITION_ADVENTURES: AdventureDefinition[] = [
  DINO_CHAPTER_1_FOSSIL_DIG,
  DINO_CHAPTER_2_FOOTPRINT_TRAIL,
];
