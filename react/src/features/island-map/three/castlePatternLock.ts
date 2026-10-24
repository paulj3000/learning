import { LOCK_ROD_RACK_SPOT, LOCK_ROD_SPOTS, SECRET_DOOR_SPOT } from './storykeeperCastleRegion';
import { SECRET_DOOR_CHAPTER_2_SLUG, seatedEntitiesToOrder } from './castleChoiceBindings';

/**
 * Beat 10's pattern lock, as pure logic
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-9, storyboard beat 10).
 *
 * Three rods off a rack - short silver, medium iron, long brass - seated
 * into the door's lock shortest to longest. The third instance of the same
 * puzzle as beat 6's story plates and beat 9's clues, translated by the
 * same `seatedEntitiesToOrder` and graded by the same existing `ORDERING`
 * step.
 *
 * Pure data and pure lookups: no `three` import, no React, unit tested.
 */

/** The lock a completed row is reported against: the door itself. */
export const PATTERN_LOCK_ENTITY_ID = SECRET_DOOR_SPOT.entityId;

/** The rack the three rods rest on, and the thing a child aims at to take one. */
export const LOCK_ROD_RACK_ENTITY_ID = LOCK_ROD_RACK_SPOT.entityId;

/** The step a filled lock answers. */
export const ORDER_THE_KEYS_STEP_ID = 'order-the-keys';

/**
 * The rods, in the order they rest on the rack. Deliberately *not* shortest
 * to longest: a child who seats them in rack order without comparing them
 * must not score a step that grades by length, the same rule the story
 * plates and the clues follow.
 */
export const LOCK_ROD_ENTITY_IDS: readonly string[] = LOCK_ROD_SPOTS.map((spot) => spot.entityId);

export function isLockRodEntity(entityId: string): boolean {
  return LOCK_ROD_ENTITY_IDS.includes(entityId);
}

/**
 * The ordering answer a row of seated rods stands for, or `null` when the
 * row is not an answer yet. See `seatedEntitiesToOrder` for why `null`
 * rather than a partial order.
 */
export function seatedRodsToOrder(seated: readonly string[]): string[] | null {
  return seatedEntitiesToOrder(SECRET_DOOR_CHAPTER_2_SLUG, ORDER_THE_KEYS_STEP_ID, seated);
}
