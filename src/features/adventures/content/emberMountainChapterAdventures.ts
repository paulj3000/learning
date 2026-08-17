import type { AdventureDefinition } from '../engine/types';

/**
 * The four Adventure Engine challenges embedded inside "The Dragon of Ember
 * Mountain" (docs/ROADMAP.md Phase 12, `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md`
 * section 12). Each is an ordinary `AdventureDefinition`, run through the
 * unchanged Adventure Engine exactly like any other adventure (CLAUDE.md
 * section 7: AI/story layers never decide correctness) — the Story Engine
 * (`src/features/story/`) only decides *when* to embed one, not how it
 * grades a child's answer. `locationSlug: 'ember-mountain'` is a
 * story-only pseudo-location: it deliberately does not match any entry in
 * `src/features/island/locations.ts`, so these adventures never surface on
 * an `IslandLocationPage` — they are only ever reachable through the Story
 * Engine's own chapter runner. There is no chapter-4 adventure here: "The
 * Dragon's Cave" is narration and a reflection moment with no graded
 * challenge (see `src/features/story/content/dragonOfEmberMountain.ts`),
 * matching the roadmap's own chapter-4 description.
 *
 * All four are scoped to `ageBands: ['PATHFINDER']` only, the same
 * first-story precedent every other location's first adventure already
 * used (Phase 3/5/6).
 */

export const DRAGON_CHAPTER_1_BROKEN_PATH: AdventureDefinition = {
  slug: 'dragon-chapter-1-broken-path',
  version: 1,
  title: 'The Broken Path',
  locationSlug: 'ember-mountain',
  ageBands: ['PATHFINDER'],
  entryStepId: 'inspect-path',
  steps: [
    {
      id: 'inspect-path',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'The mountain path has crumbled away in the middle, and smoke is still curling up from beyond the peak. We will need to rebuild it, stone by stone.',
      },
      transitions: [{ when: 'always', nextStepId: 'count-missing-stones' }],
      fallback: { text: 'The mountain path has crumbled away. Let’s rebuild it.' },
    },
    {
      id: 'count-missing-stones',
      type: 'NUMBER_INPUT',
      objectiveIds: ['counting-sets'],
      presentation: {
        kind: 'number-input',
        prompt: 'How many stone slabs are missing from the path?',
        correctValue: 3,
      },
      transitions: [
        { when: 'correct', nextStepId: 'order-stone-slabs' },
        { when: 'incorrect', nextStepId: 'count-missing-stones' },
      ],
      hintPolicy: {
        ladder: [
          "You can do this! Let's count the gaps in the path together.",
          'Look closely at each broken stretch of stone.',
          'Touch each gap and count out loud as you go.',
          'There is one gap near the start and two more further up.',
          'There are 3 missing stone slabs. Type 3 to keep going.',
        ],
      },
      fallback: { text: 'There are 3 missing stone slabs.' },
    },
    {
      id: 'order-stone-slabs',
      type: 'ORDERING',
      objectiveIds: ['measurement'],
      presentation: {
        kind: 'ordering',
        prompt: 'Put the stone slabs in order from shortest to longest so they fit the path.',
        items: [
          { id: 'medium-slab', label: 'Medium slab' },
          { id: 'long-slab', label: 'Long slab' },
          { id: 'short-slab', label: 'Short slab' },
        ],
        correctOrder: ['short-slab', 'medium-slab', 'long-slab'],
      },
      transitions: [
        { when: 'correct', nextStepId: 'path-rebuilt-narration' },
        { when: 'incorrect', nextStepId: 'order-stone-slabs' },
      ],
      hintPolicy: {
        ladder: [
          "Nice work so far! Let's measure these slabs.",
          'Look at how long each stone slab is.',
          'Find the shortest slab first, then work up to the longest.',
          'The short slab goes first, then the medium slab.',
          'Shortest, then medium, then longest: that is the order.',
        ],
      },
      fallback: { text: 'Shortest, then medium, then longest.' },
    },
    {
      id: 'path-rebuilt-narration',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'The stones lock into place and the path stretches on toward the mountain, smoke and all.',
      },
      transitions: [{ when: 'always', nextStepId: 'path-repaired' }],
      fallback: { text: 'The path is whole again, stretching toward the mountain.' },
    },
    {
      id: 'path-repaired',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The mountain path is repaired, stone by stone.',
        payload: {
          changeType: 'REPAIR',
          changeKey: 'MOUNTAIN_PATH_REPAIRED',
          locationSlug: 'ember-mountain',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The mountain path is repaired.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You rebuilt the mountain path! The way toward Ember Mountain is finally clear.',
      },
      transitions: [],
      fallback: { text: 'You rebuilt the mountain path!' },
    },
  ],
};

export const DRAGON_CHAPTER_2_WHISPERING_FOREST: AdventureDefinition = {
  slug: 'dragon-chapter-2-whispering-forest',
  version: 1,
  title: 'The Whispering Forest',
  locationSlug: 'ember-mountain',
  ageBands: ['PATHFINDER'],
  entryStepId: 'enter-forest',
  steps: [
    {
      id: 'enter-forest',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'The trees here lean in close and seem to whisper. A little fox left a note pinned to a branch, and a trail of colored leaves winds deeper into the forest.',
        aiNarrated: true,
      },
      transitions: [{ when: 'always', nextStepId: 'read-the-note' }],
      fallback: { text: 'A fox left a note, and a trail of leaves winds into the forest.' },
    },
    {
      id: 'read-the-note',
      type: 'CHOICE',
      objectiveIds: ['reading-comprehension', 'animal-science'],
      presentation: {
        kind: 'choice',
        prompt:
          'The note says: "Foxes rest by day and hunt by night. Follow the trail when the shadows grow long." What should you do?',
        options: [
          { id: 'opt-wait-for-evening', label: 'Follow the trail as it starts to get dark' },
          { id: 'opt-follow-noon', label: 'Follow the trail right at midday' },
          { id: 'opt-ignore-note', label: 'Leave the note where it is and turn back' },
        ],
        correctOptionId: 'opt-wait-for-evening',
      },
      transitions: [
        { when: 'correct', nextStepId: 'leaf-pattern' },
        { when: 'incorrect', nextStepId: 'read-the-note' },
      ],
      hintPolicy: {
        ladder: [
          "You're a good reader! What did the note say about foxes?",
          'The note tells you something about when foxes are awake.',
          'Foxes hunt by night, not in the middle of the day.',
          '"Shadows grow long" means evening is coming.',
          'Follow the trail as it starts to get dark.',
        ],
      },
      fallback: { text: 'Follow the trail as it starts to get dark, just like the note says.' },
    },
    {
      id: 'leaf-pattern',
      type: 'CHOICE',
      objectiveIds: ['patterns'],
      presentation: {
        kind: 'choice',
        prompt: 'The leaves on the trail go red, gold, red, gold. What color comes next?',
        options: [
          { id: 'opt-red', label: 'Red' },
          { id: 'opt-gold', label: 'Gold' },
          { id: 'opt-green', label: 'Green' },
        ],
        correctOptionId: 'opt-red',
      },
      transitions: [
        { when: 'correct', nextStepId: 'forest-clues-found' },
        { when: 'incorrect', nextStepId: 'leaf-pattern' },
      ],
      hintPolicy: {
        ladder: [
          "You're a great pattern-spotter! What repeats in this trail?",
          'Look at the order: red, gold, red, gold...',
          'The two colors keep taking turns.',
          'After gold, the pattern starts over again.',
          'The next leaf is red.',
        ],
      },
      fallback: { text: 'The pattern repeats, so the next leaf is red.' },
    },
    {
      id: 'forest-clues-found',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The trail of clues leads all the way to the foot of Ember Mountain.',
        payload: {
          changeType: 'DISCOVERY',
          changeKey: 'WHISPERING_FOREST_CLUES_FOUND',
          locationSlug: 'ember-mountain',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The trail of clues leads to the foot of Ember Mountain.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You followed the forest creatures’ clues all the way to the mountain.',
      },
      transitions: [],
      fallback: { text: 'You followed the clues to the mountain.' },
    },
  ],
};

export const DRAGON_CHAPTER_3_DRAGON_TRACKS: AdventureDefinition = {
  slug: 'dragon-chapter-3-dragon-tracks',
  version: 1,
  title: 'Dragon Tracks',
  locationSlug: 'ember-mountain',
  ageBands: ['PATHFINDER'],
  entryStepId: 'find-tracks',
  steps: [
    {
      id: 'find-tracks',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'Huge footprints press deep into the ash here. Whatever made these tracks is enormous.',
      },
      transitions: [{ when: 'always', nextStepId: 'measure-track' }],
      fallback: { text: 'Huge footprints press deep into the ash.' },
    },
    {
      id: 'measure-track',
      type: 'NUMBER_INPUT',
      objectiveIds: ['measurement'],
      presentation: {
        kind: 'number-input',
        prompt: 'Line up your claw-length ruler along the track. How many claw-lengths long is it?',
        correctValue: 6,
      },
      transitions: [
        { when: 'correct', nextStepId: 'compare-tracks' },
        { when: 'incorrect', nextStepId: 'measure-track' },
      ],
      hintPolicy: {
        ladder: [
          "You're a careful measurer! Line the ruler up with the track.",
          'Start measuring from the heel of the track.',
          'Count each claw-length as you move along the print.',
          'It is more than five claw-lengths, but fewer than seven.',
          'The track is 6 claw-lengths long.',
        ],
      },
      fallback: { text: 'The track is 6 claw-lengths long.' },
    },
    {
      id: 'compare-tracks',
      type: 'CHOICE',
      objectiveIds: ['comparing-lengths', 'observation'],
      presentation: {
        kind: 'choice',
        prompt: 'You spot three tracks: small, medium, and large. Which one should you follow?',
        options: [
          { id: 'opt-large', label: 'The large track, since it is freshest and deepest' },
          { id: 'opt-small', label: 'The small track, since it is easiest to follow' },
          { id: 'opt-medium', label: 'The medium track, since it is in the middle' },
        ],
        correctOptionId: 'opt-large',
      },
      transitions: [
        { when: 'correct', nextStepId: 'tracks-measured' },
        { when: 'incorrect', nextStepId: 'compare-tracks' },
      ],
      hintPolicy: {
        ladder: [
          "You're a sharp observer! Look closely at all three tracks.",
          'Think about which track looks newest and deepest in the ash.',
          'A deeper, fresher track means it was made more recently.',
          'The large track is the deepest and freshest of the three.',
          'Follow the large track.',
        ],
      },
      fallback: { text: 'The large, freshest track is the one to follow.' },
    },
    {
      id: 'tracks-measured',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'You mark the trail of tracks leading up toward a dark cave.',
        payload: {
          changeType: 'DISCOVERY',
          changeKey: 'DRAGON_TRACKS_MEASURED',
          locationSlug: 'ember-mountain',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The tracks lead up toward a dark cave.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You measured and compared the tracks. They lead somewhere higher up the mountain.',
      },
      transitions: [],
      fallback: { text: 'The tracks lead higher up the mountain.' },
    },
  ],
};

export const DRAGON_CHAPTER_5_SAVE_THE_DRAGON: AdventureDefinition = {
  slug: 'dragon-chapter-5-save-the-dragon',
  version: 1,
  title: 'Save the Dragon',
  locationSlug: 'ember-mountain',
  ageBands: ['PATHFINDER'],
  entryStepId: 'what-the-dragon-needs',
  steps: [
    {
      id: 'what-the-dragon-needs',
      type: 'CHOICE',
      objectiveIds: ['cause-and-effect'],
      presentation: {
        kind: 'choice',
        prompt:
          'The dragon is curled tight around her egg, still shaking. What does she need most?',
        options: [
          { id: 'opt-safe-warm-place', label: 'A warm, safe place to keep the egg' },
          { id: 'opt-loud-party', label: 'A loud, noisy party to cheer her up' },
          { id: 'opt-left-alone', label: 'To be left completely alone forever' },
        ],
        correctOptionId: 'opt-safe-warm-place',
      },
      transitions: [
        { when: 'correct', nextStepId: 'count-warming-stones' },
        { when: 'incorrect', nextStepId: 'what-the-dragon-needs' },
      ],
      hintPolicy: {
        ladder: [
          'You understand her already! What would help a scared, protective dragon?',
          'Think about why she is guarding her egg so closely.',
          'A frightened parent needs somewhere calm and warm to settle.',
          'Loud parties would only frighten her more.',
          'She needs a warm, safe place to keep the egg.',
        ],
      },
      fallback: { text: 'The dragon needs a warm, safe place to keep her egg.' },
    },
    {
      id: 'count-warming-stones',
      type: 'NUMBER_INPUT',
      objectiveIds: ['counting-sets'],
      presentation: {
        kind: 'number-input',
        prompt:
          'Warm stones from the mountain fire will ring the nest. How many stones do you have?',
        correctValue: 7,
      },
      transitions: [
        { when: 'correct', nextStepId: 'nest-rebuilt-narration' },
        { when: 'incorrect', nextStepId: 'count-warming-stones' },
      ],
      hintPolicy: {
        ladder: [
          "You're doing great! Let's count the warming stones together.",
          'Look at each stone glowing near the fire.',
          'Count them out loud, one at a time.',
          'There are more than five, but fewer than nine.',
          'There are 7 warming stones.',
        ],
      },
      fallback: { text: 'There are 7 warming stones.' },
    },
    {
      id: 'nest-rebuilt-narration',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'You ring the nest with warm stones. The dragon finally uncurls, just a little, and lets out a long, tired breath of smoke.',
        aiNarrated: true,
      },
      transitions: [{ when: 'always', nextStepId: 'dragon-rescued' }],
      fallback: { text: 'The dragon uncurls a little, finally able to rest.' },
    },
    {
      id: 'dragon-rescued',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The dragon and her egg are safe at last.',
        payload: {
          changeType: 'RESCUE',
          changeKey: 'DRAGON_RESCUED',
          locationSlug: 'ember-mountain',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'mountain-restored' }],
      fallback: { text: 'The dragon and her egg are safe.' },
    },
    {
      id: 'mountain-restored',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The smoke over Ember Mountain clears, and green shoots begin to push up through the ash.',
        payload: {
          changeType: 'RESTORATION',
          changeKey: 'EMBER_MOUNTAIN_RESTORED',
          locationSlug: 'ember-mountain',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'cave-unlocked' }],
      fallback: { text: 'The smoke clears and green shoots appear on the mountain.' },
    },
    {
      id: 'cave-unlocked',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The dragon invites you to visit her cave whenever you like.',
        payload: {
          changeType: 'UNLOCK',
          changeKey: 'DRAGON_CAVE_UNLOCKED',
          locationSlug: 'ember-mountain',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The dragon’s cave is open to you now.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You saved the dragon and restored Ember Mountain! The island has changed because of what you learned.',
      },
      transitions: [],
      fallback: { text: 'You saved the dragon and restored Ember Mountain!' },
    },
  ],
};

export const EMBER_MOUNTAIN_CHAPTER_ADVENTURES: AdventureDefinition[] = [
  DRAGON_CHAPTER_1_BROKEN_PATH,
  DRAGON_CHAPTER_2_WHISPERING_FOREST,
  DRAGON_CHAPTER_3_DRAGON_TRACKS,
  DRAGON_CHAPTER_5_SAVE_THE_DRAGON,
];
