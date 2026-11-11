import type { WorldInteraction } from '../worldObjects';

/**
 * The Observatory's observing points (SC-R03-04). The reboot roadmap merges
 * the Observatory into the Setting Tower, so these live in the tower and the
 * tower keeps its stable id, its three story windows and its zones.
 *
 * **Flavour only, by design.** Each is a `SHOW_MESSAGE` that describes what
 * a child is looking at and may invite them to count. Nothing here grades an
 * answer, records progress, grants an item, starts an adventure or changes
 * the world, so the outcome of looking is always the same: deterministic,
 * with no state to get wrong. New *graded* educational content is a separate
 * decision (reboot roadmap section 7), and this does not make it.
 *
 * Copy is read aloud and kept short enough for Pathfinders and simple enough
 * for Sprouts to have read to them. It names no number a child could be
 * marked wrong about.
 */
export const OBSERVATORY_CHART_STAR_COUNT = 5;

export const CASTLE_OBSERVATORY_INTERACTIONS: readonly WorldInteraction[] = [
  {
    id: 'castle-observatory-telescope',
    type: 'OBJECT',
    trigger: 'APPROACH',
    title: 'Look through the big telescope',
    targetId: 'observatory-telescope',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'You look through the big telescope. Far away, tiny lights twinkle in the dark.',
    },
    zoneId: 'observatory-telescope',
  },
  {
    id: 'castle-observatory-chart',
    type: 'OBJECT',
    trigger: 'APPROACH',
    title: 'Read the star chart',
    targetId: 'observatory-chart',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'A star chart is pinned to the wall. Count the gold stars. How many can you find?',
    },
    zoneId: 'observatory-chart',
  },
];
