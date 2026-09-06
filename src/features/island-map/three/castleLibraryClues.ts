import { LIBRARY_CLUE_SPOTS, LIBRARY_CLUE_WALL_SPOT } from './storykeeperCastleRegion';
import { SECRET_DOOR_CHAPTER_1_SLUG, seatedEntitiesToOrder } from './castleChoiceBindings';

/**
 * Beat 9's three clues, as pure logic
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-8, storyboard beat 9).
 *
 * A diary page on a reading table, a library map near the door, a folded
 * note tucked in a shelf: three separate finds in three separate parts of
 * the room, then pinned to the library wall in the order they were written.
 *
 * The same puzzle as SC-5's binding lectern wearing different clothes, and
 * deliberately built out of the same parts - `seatedEntitiesToOrder` turns
 * an arrangement into the `{ kind: 'ordering', order }` the HUD list would
 * have submitted, and the existing `ORDERING` step grades it. The room
 * produces an arrangement and stops.
 *
 * Pure data and pure lookups: no `three` import, no React, unit tested.
 */

/** The wall the three get pinned to, and the entity a completed row is reported against. */
export const LIBRARY_CLUE_WALL_ENTITY_ID = LIBRARY_CLUE_WALL_SPOT.entityId;

/** The step a filled clue wall answers. */
export const ORDER_THE_CLUES_STEP_ID = 'order-the-clues';

/**
 * The three clues, in the order they lie about the room - which is not the
 * order they were written in, for the same reason the story plates do not
 * start in story order: a child who pins them in the order they happened to
 * find them must not score a sequencing step they did not do.
 */
export const LIBRARY_CLUE_ENTITY_IDS: readonly string[] = LIBRARY_CLUE_SPOTS.map(
  (spot) => spot.entityId,
);

/** How many clues make a complete answer. */
export const LIBRARY_CLUE_COUNT = LIBRARY_CLUE_ENTITY_IDS.length;

export function isLibraryClueEntity(entityId: string): boolean {
  return LIBRARY_CLUE_ENTITY_IDS.includes(entityId);
}

/**
 * The ordering answer a row of pinned clues stands for, or `null` when the
 * row is not an answer yet. See `seatedEntitiesToOrder` for why `null`
 * rather than a partial order.
 */
export function seatedCluesToOrder(seated: readonly string[]): string[] | null {
  return seatedEntitiesToOrder(SECRET_DOOR_CHAPTER_1_SLUG, ORDER_THE_CLUES_STEP_ID, seated);
}
