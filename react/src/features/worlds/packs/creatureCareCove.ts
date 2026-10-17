import { CREATURE_CARE_COVE_SLUG } from '../slugs';
import type { WorldContentPack } from '../types';

/**
 * Everything Creature Care Cove owns (docs/ROADMAP.md Phase 29).
 *
 * Worth reading beside `homeIsland.ts` for what it does *not* contain: no
 * NPCs, no discoveries, and no stories. Those three are not missing by
 * oversight, they are the parts of the platform that need an explorable
 * Phaser map to be reachable at all, and the cove does not have one yet.
 * Authoring them anyway would have put a character nobody could talk to and
 * a secret nobody could walk up to on the island, which is the dead end
 * every content file in this repo is written to avoid.
 */
export const CREATURE_CARE_COVE_PACK: WorldContentPack = {
  worldSlug: CREATURE_CARE_COVE_SLUG,
  version: 1,
  locationSlugs: ['cove-care-beach', 'lantern-tide-pools'],
  adventureSlugs: ['breakfast-at-the-cove', 'the-morning-care-round', 'the-cove-care-plan'],
  questIds: ['helping-at-the-cove'],
  itemIds: ['lantern-shell', 'keepers-tally-book', 'cove-keepers-apron'],
  collectibleSetIds: [],
  npcIds: [],
  discoveryIds: [],
  storySlugs: [],
};
