import type { AdventureDefinition, AdventureStep } from '../engine/types';

/**
 * The Writing Room's write-your-story activity (SC-final-B), one adventure template per age band.
 *
 * **Age-correct band mapping (CLAUDE.md section 3).** The first brief listed the two older bands
 * the wrong way round. What ships is:
 *
 * - **Sprouts (3 to 4):** tap a picture, a character and a word. No reading, no typing, one
 *   decision at a time.
 * - **Pathfinders (5 to 6):** build two or three sentences from authored word tiles.
 * - **Explorers (7 to 8):** pick an authored story starter, then type a short paragraph.
 *
 * **Why these are adventure templates.** A saved story is a `StoryArtifact`, which belongs to an
 * `AdventureSession` (one per session, parent-viewable and parent-deletable). Reusing that means
 * the Writing Room needs a catalog adventure per band, so the story shows up in the adventure log
 * and the parent views like every other creation. The steps below are authored content for the
 * existing step types. The Writing Room page (`features/writing-room`) draws them with its own
 * tap and typing UI, and the server composes the saved text from the authored options, so a Sprout
 * or Pathfinder story can never contain anything but authored words. Only an Explorer's paragraph
 * is the child's own text, and the server screens it before storing it
 * (`lai/apps/education/written_story.py`).
 *
 * Nothing here grants a reward, writes a world change or grades anything: there is no wrong story.
 * Encouragement is authored only, and no model ever reads or comments on what the child wrote.
 *
 * The three templates are the only adventures at `castle-writing-room`, one per band, so the card
 * route and the 3D room's desk resolve to the same one for a given child.
 */

export const WRITING_ROOM_LOCATION_SLUG = 'castle-writing-room';
export const WRITING_ROOM_SPROUT_SLUG = 'writing-room-picture-story';
export const WRITING_ROOM_PATHFINDER_SLUG = 'writing-room-sentence-story';
export const WRITING_ROOM_EXPLORER_SLUG = 'writing-room-own-story';

/** Pathfinder sentences a story may hold, and how many a child must build to finish. */
export const PATHFINDER_MIN_SENTENCES = 2;
export const PATHFINDER_MAX_TILES = 8;
/** An Explorer's paragraph, in characters. Mirrored by `lai/apps/education/written_story.py`. */
export const EXPLORER_MIN_CHARACTERS = 30;
export const EXPLORER_MAX_CHARACTERS = 500;

const welcome = (text: string, nextStepId: string): AdventureStep => ({
  id: 'quill-welcome',
  type: 'NARRATIVE',
  objectiveIds: [],
  presentation: { kind: 'narrative', speaker: 'Keeper Quill', text },
  transitions: [{ when: 'always', nextStepId }],
  fallback: { text },
});

const complete = (text: string): AdventureStep => ({
  id: 'complete',
  type: 'COMPLETE',
  objectiveIds: [],
  presentation: { kind: 'complete', text },
  transitions: [],
  fallback: { text },
});

export const WRITING_ROOM_PICTURE_STORY: AdventureDefinition = {
  slug: WRITING_ROOM_SPROUT_SLUG,
  version: 1,
  title: 'My Picture Story',
  locationSlug: WRITING_ROOM_LOCATION_SLUG,
  ageBands: ['SPROUT'],
  entryStepId: 'quill-welcome',
  steps: [
    welcome('Let us fill an empty book. Pick a picture, a friend and a word.', 'pick-the-picture'),
    {
      id: 'pick-the-picture',
      type: 'CREATIVE_CHOICE',
      objectiveIds: ['creative-storytelling'],
      presentation: {
        kind: 'creative-choice',
        prompt: 'Pick a picture for your story.',
        options: [
          { id: 'picture-forest', label: 'The forest' },
          { id: 'picture-sea', label: 'The sea' },
          { id: 'picture-garden', label: 'The garden' },
        ],
      },
      transitions: [{ when: 'always', nextStepId: 'pick-the-character' }],
      hintPolicy: {
        ladder: ['Tap the picture you like best.', 'Any picture makes a good story.'],
      },
      fallback: { text: 'Your story has a place.' },
    },
    {
      id: 'pick-the-character',
      type: 'CREATIVE_CHOICE',
      objectiveIds: ['vocabulary'],
      presentation: {
        kind: 'creative-choice',
        prompt: 'Who is in your story?',
        options: [
          { id: 'character-fox', label: 'The fox' },
          { id: 'character-puppy', label: 'The puppy' },
          { id: 'character-dragon', label: 'The dragon' },
        ],
      },
      transitions: [{ when: 'always', nextStepId: 'pick-the-word' }],
      hintPolicy: {
        ladder: ['Tap the friend you would like to meet.', 'Any friend is a good friend.'],
      },
      fallback: { text: 'Your story has a friend.' },
    },
    {
      id: 'pick-the-word',
      type: 'CREATIVE_CHOICE',
      objectiveIds: ['vocabulary'],
      presentation: {
        kind: 'creative-choice',
        prompt: 'Pick a word for your story.',
        options: [
          { id: 'word-brave', label: 'Brave' },
          { id: 'word-kind', label: 'Kind' },
          { id: 'word-happy', label: 'Happy' },
        ],
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      hintPolicy: {
        ladder: ['Tap the word you like.', 'Brave, kind and happy are all lovely words.'],
      },
      fallback: { text: 'Your story has a word.' },
    },
    complete('You filled a book with your own picture story!'),
  ],
};

/** Word tiles for one sentence. Any order is allowed: it is the child's sentence. */
const sentence = (
  id: string,
  prompt: string,
  tiles: readonly string[],
  nextStepId: string,
  hints: readonly string[],
): AdventureStep => ({
  id,
  type: 'CREATIVE_CHOICE',
  objectiveIds: ['creative-storytelling', 'sequencing'],
  presentation: {
    kind: 'creative-choice',
    prompt,
    options: tiles.map((label, index) => ({ id: `${id}-tile-${index + 1}`, label })),
  },
  transitions: [{ when: 'always', nextStepId }],
  hintPolicy: { ladder: [...hints] },
  fallback: { text: 'Your story has a sentence.' },
});

export const WRITING_ROOM_SENTENCE_STORY: AdventureDefinition = {
  slug: WRITING_ROOM_PATHFINDER_SLUG,
  version: 1,
  title: 'My Sentence Story',
  locationSlug: WRITING_ROOM_LOCATION_SLUG,
  ageBands: ['PATHFINDER'],
  entryStepId: 'quill-welcome',
  steps: [
    welcome(
      'Let us write a short story in two or three sentences. Tap the word tiles to build each one.',
      'sentence-1',
    ),
    sentence(
      'sentence-1',
      'Build the first sentence. Who is in your story, and where are they?',
      [
        'Once upon a time',
        'the little fox',
        'a brave dragon',
        'lived',
        'in a castle',
        'by the sea',
      ],
      'sentence-2',
      [
        'Start with who is in your story.',
        'Then say what they did, and where.',
        'Try: Once upon a time, the little fox lived by the sea.',
      ],
    ),
    sentence(
      'sentence-2',
      'Build the second sentence. What happened next?',
      ['Then', 'they', 'found', 'a shiny key', 'a secret door', 'a magic book'],
      'sentence-3',
      [
        'Say what happened next.',
        'Who found something? What did they find?',
        'Try: Then they found a shiny key.',
      ],
    ),
    sentence(
      'sentence-3',
      'You can build a third sentence, or finish now. How does the story end?',
      ['At last', 'everyone', 'smiled', 'and', 'shared', 'a big cake'],
      'complete',
      [
        'Say how the story ends.',
        'A good ending says how everyone feels.',
        'Try: At last, everyone smiled.',
      ],
    ),
    complete('You wrote a story with your own sentences!'),
  ],
};

export const WRITING_ROOM_STORY_STARTERS = [
  { id: 'starter-door', label: 'The door behind the bookshelf creaked open, and' },
  { id: 'starter-lamp', label: 'The lamp in the tower began to glow, so' },
  { id: 'starter-letter', label: 'A letter with no name on it arrived at the castle, and' },
] as const;

export const WRITING_ROOM_OWN_STORY: AdventureDefinition = {
  slug: WRITING_ROOM_EXPLORER_SLUG,
  version: 1,
  title: 'My Own Story',
  locationSlug: WRITING_ROOM_LOCATION_SLUG,
  ageBands: ['EXPLORER'],
  entryStepId: 'quill-welcome',
  steps: [
    welcome(
      'The first empty book is yours. Pick a story starter, then write what happens next.',
      'pick-a-starter',
    ),
    {
      id: 'pick-a-starter',
      type: 'CREATIVE_CHOICE',
      objectiveIds: ['creative-storytelling'],
      presentation: {
        kind: 'creative-choice',
        prompt: 'Pick a story starter.',
        options: WRITING_ROOM_STORY_STARTERS.map((starter) => ({ ...starter })),
      },
      transitions: [{ when: 'always', nextStepId: 'write-the-story' }],
      hintPolicy: {
        ladder: ['Pick the starter that makes you curious.', 'Any starter can lead to a good story.'],
      },
      fallback: { text: 'Your story has a beginning.' },
    },
    {
      id: 'write-the-story',
      type: 'REFLECTION',
      objectiveIds: ['creative-storytelling', 'vocabulary'],
      presentation: {
        kind: 'reflection',
        prompt:
          'Write what happens next. A few sentences is plenty. Tell us who is there, what they do, and how it ends.',
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      hintPolicy: {
        ladder: [
          'Who is in your story?',
          'What do they do first?',
          'How does your story end?',
          'Try a describing word, like shiny, tiny or brave.',
        ],
      },
      fallback: { text: 'Your story has a middle and an end.' },
    },
    complete('You wrote a story of your very own!'),
  ],
};

export const WRITING_ROOM_STORIES: AdventureDefinition[] = [
  WRITING_ROOM_PICTURE_STORY,
  WRITING_ROOM_SENTENCE_STORY,
  WRITING_ROOM_OWN_STORY,
];

/** Authored encouragement, shown after a story is saved. Never produced by a model. */
export const WRITING_ROOM_ENCOURAGEMENT: Readonly<Record<'SPROUT' | 'PATHFINDER' | 'EXPLORER', string>> = {
  SPROUT: 'What a lovely story! Keeper Quill put it on the shelf for you.',
  PATHFINDER: 'What a great story! Keeper Quill put your sentences on the shelf.',
  EXPLORER: 'What a story! Keeper Quill put your words on the shelf, just as you wrote them.',
};

/** Shown when an Explorer's paragraph is not accepted. Kind, and it never repeats the text. */
export const WRITING_ROOM_REFUSAL =
  'Let us try that again with different words. Keeper Quill likes stories with kind, gentle words.';
