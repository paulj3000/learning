/**
 * What The Heart of Firepeak offers the Great Storybook in Storykeeper's Castle
 * (`docs/firepeak/STORYKEEPER_INTEGRATION.md`, FPV-22), as typed constants. The castle registers
 * them in its own branch; nothing here imports the castle. A Vitest test checks every id against
 * the content export so the two cannot drift.
 */

export const FIREPEAK_STORYBOOK_PAGE_ID = 'firepeak-heart';

export const FIREPEAK_STORYBOOK_CONTRACT = {
  pageId: FIREPEAK_STORYBOOK_PAGE_ID,
  title: 'The Heart of Firepeak',
  bands: ['PATHFINDER', 'EXPLORER'],
  /** Optional: a required page would change every band's completion. */
  required: false,
  source: {
    kind: 'WORLD_CHANGE',
    changeKey: 'FIREPEAK_HEART_COMPLETE',
    locationSlug: 'firepeak-heart',
  },
  /** The quest whose completion records the source world change. */
  producerQuestId: 'the-heart-of-firepeak',
  hint: 'Help the Heart of Firepeak glow again.',
  restoredText:
    'The explorer carried four crystals up the mountain, and the Heart of Firepeak glowed again.',
  discovery: {
    placeSlug: 'firepeak-heart',
    areaRoute: (childId: string) => `/island/${childId}/explore/firepeak-heart`,
  },
  trophies: {
    primary: 'fh-badge-heart-of-firepeak',
    all: [
      'fh-badge-heart-of-firepeak',
      'fh-badge-volcano-scientist',
      'fh-badge-crystal-collector',
      'fh-badge-master-explorer',
    ],
  },
  observatory: {
    changeKey: 'FIREPEAK_HEART_COMPLETE',
    line: 'Far away, Firepeak glows warm and calm.',
  },
} as const;
