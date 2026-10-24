import type { AdventureDefinition } from '../engine/types';

/**
 * "Quill's Picture Story", Storykeeper Castle's Sprouts adventure
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-10, storyboard section 5).
 *
 * The castle had no Sprouts content at all: `the-storykeepers-tale` is
 * PATHFINDER only and the whole secret-door arc is EXPLORER only, so a
 * three-year-old could walk in and tap six sprites for six sentences. This
 * is the same castle, the same rooms and the same assets, asking three-
 * and four-year-olds something they can actually do.
 *
 * **It is authored content, not an engine change.** Every step type,
 * transition rule and validator below already existed; what is new is the
 * words, and how few of them there are.
 *
 * Three things shape every line of it, from CLAUDE.md section 3's Sprouts
 * band:
 *
 * - **One-step decisions.** Two options where the Pathfinder tale offers
 *   three, and two beats to order where it offers three. A Sprout is being
 *   asked "which of these two?", never "arrange these three".
 * - **No reading required.** Every prompt is one short sentence written to
 *   be *heard*: read aloud by a grown-up, or narrated. Option labels are
 *   the picture's name and nothing more - "The puppy", not "A brave puppy
 *   who wants to help".
 * - **Sessions of five to eight minutes.** Six steps, three of which are a
 *   single tap, is the whole adventure.
 *
 * The world change is deliberately the same `FIRST_STORY_TOLD` the
 * Pathfinder tale writes, on the same shelf in the same library. A
 * three-year-old's story earns exactly the consequence a five-year-old's
 * does; the castle does not keep a lesser shelf for younger children.
 *
 * The hint ladders are three rungs rather than five, and every rung is a
 * sentence a grown-up can read aloud without explaining it first. The
 * engine takes any ladder length (`getHintText` clamps), so this is an
 * authoring choice about attention span, not a schema change.
 */
export const QUILLS_PICTURE_STORY: AdventureDefinition = {
  slug: 'quills-picture-story',
  version: 1,
  title: "Quill's Picture Story",
  locationSlug: 'storykeeper-castle',
  ageBands: ['SPROUT'],
  entryStepId: 'quill-says-hello',
  steps: [
    {
      id: 'quill-says-hello',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Keeper Quill',
        text: 'Hello! Let us make a picture story together.',
        aiNarrated: true,
      },
      transitions: [{ when: 'always', nextStepId: 'pick-the-animal' }],
      fallback: { text: 'Keeper Quill wants to make a picture story.' },
    },
    {
      /*
        Beat 3's gallery, for Sprouts. Two portraits instead of three, and
        the labels are the animal's name: a child who cannot read is being
        asked to match a spoken word to a picture, which is vocabulary and
        classification both.
      */
      id: 'pick-the-animal',
      type: 'CREATIVE_CHOICE',
      objectiveIds: ['vocabulary', 'classification'],
      presentation: {
        kind: 'creative-choice',
        prompt: 'Who is the story about?',
        options: [
          { id: 'picture-puppy', label: 'The puppy' },
          { id: 'picture-fox', label: 'The fox' },
        ],
      },
      transitions: [{ when: 'always', nextStepId: 'pick-the-place' }],
      fallback: { text: 'The story is about a friendly animal.' },
    },
    {
      /*
        Beat 4's tower. Standing at a window is the choice, which is why
        this beat works for a band that cannot aim - the whole reason the
        storyboard made the windows an approach and not a raycast.
      */
      id: 'pick-the-place',
      type: 'CREATIVE_CHOICE',
      objectiveIds: ['vocabulary', 'observation'],
      presentation: {
        kind: 'creative-choice',
        prompt: 'Where does the story happen?',
        options: [
          { id: 'picture-island', label: 'On the island' },
          { id: 'picture-cave', label: 'In the cave' },
        ],
      },
      transitions: [{ when: 'always', nextStepId: 'what-happened-first' }],
      fallback: { text: 'The story happens somewhere new.' },
    },
    {
      /*
        Beat 6's lectern, cut to two plates. "What happened first" is the
        smallest true sequencing question there is: one thing, then another
        thing, and only one of the two orders makes sense.
      */
      id: 'what-happened-first',
      type: 'ORDERING',
      objectiveIds: ['sequencing'],
      presentation: {
        kind: 'ordering',
        prompt: 'What happened first?',
        items: [
          { id: 'picture-ending', label: 'They found a friend' },
          { id: 'picture-problem', label: 'They got lost' },
        ],
        correctOrder: ['picture-problem', 'picture-ending'],
      },
      transitions: [
        { when: 'correct', nextStepId: 'quill-writes-it-down' },
        { when: 'incorrect', nextStepId: 'what-happened-first' },
      ],
      hintPolicy: {
        ladder: [
          'Which one happened at the start?',
          'They had to get lost before they could find a friend.',
          'Getting lost happened first.',
        ],
      },
      fallback: { text: 'They got lost first, and then they found a friend.' },
    },
    {
      id: 'quill-writes-it-down',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Keeper Quill',
        text: 'What a good story. I will write it down for you.',
        aiNarrated: true,
      },
      transitions: [{ when: 'always', nextStepId: 'picture-story-made' }],
      fallback: { text: 'Keeper Quill writes the story down.' },
    },
    {
      /*
        The same key, the same shelf, the same book as the Pathfinder tale.
        A Sprout's story is a story.
      */
      id: 'picture-story-made',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'Your picture story is a real book now, on the castle shelf!',
        payload: {
          changeType: 'STORY_CREATED',
          changeKey: 'FIRST_STORY_TOLD',
          locationSlug: 'storykeeper-castle',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'Your picture story is a real book now!' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You made a picture story with Keeper Quill!',
      },
      transitions: [],
      fallback: { text: 'You made a picture story!' },
    },
  ],
};
