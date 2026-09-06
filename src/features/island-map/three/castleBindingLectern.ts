import {
  BINDING_LECTERN_SPOT,
  BINDING_SOCKET_LOCAL_X,
  STORY_PLATE_SPOTS,
} from './storykeeperCastleRegion';
import { resolveCastleChoiceBinding, THE_STORYKEEPERS_TALE_SLUG } from './castleChoiceBindings';

/**
 * Beat 6's binding lectern, as pure logic
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-5, and the storyboard's beat
 * 6). The room lets a child pick up three stone plates and seat them in
 * three sockets; this file is the one place that says what a seated row of
 * plates *means*, and it says it in exactly one sentence:
 *
 *   three seated plate entity ids  ->  the three option ids the HUD
 *                                      ordering list would have submitted
 *
 * That is the whole point. `order-the-story` is an `ORDERING` step whose
 * items the adventure already owns, and `AdventureStepCard` already renders
 * a drag-to-order list for it. The lectern is a *second way in*, never a
 * second implementation: it converts positions in a room into the very same
 * `{ kind: 'ordering', order }` answer, and the Adventure Engine grades it.
 * `castleBindingLectern.test.ts` asserts that equivalence over every
 * permutation, which is SC-5's "the plate route and the HUD list route
 * produce identical session state" exit criterion.
 *
 * Nothing here decides correctness. `seatedPlatesToOrder` will happily hand
 * back a wrong order; whether it is wrong is the engine's business.
 *
 * Pure data and pure lookups: no `three` import, no React, unit tested.
 */

/** The lectern itself, as an entity id the scene raycasts and the region places. */
export const BINDING_LECTERN_ENTITY_ID = BINDING_LECTERN_SPOT.entityId;

/** The step a filled lectern answers. */
export const ORDER_THE_STORY_STEP_ID = 'order-the-story';

/**
 * The three plates, in the order they sit on the table - which is
 * deliberately *not* the correct story order. A child who seats them left
 * to right without thinking gets a wrong answer and a second try, the same
 * as a child who submits the HUD list untouched.
 */
export const STORY_PLATE_ENTITY_IDS: readonly string[] = STORY_PLATE_SPOTS.map(
  (spot) => spot.entityId,
);

/** How many plates make a complete answer. One per socket, by construction. */
export const BINDING_SOCKET_COUNT = BINDING_SOCKET_LOCAL_X.length;

export function isStoryPlateEntity(entityId: string): boolean {
  return STORY_PLATE_ENTITY_IDS.includes(entityId);
}

/**
 * The ordering answer a row of seated plates stands for, or `null` when the
 * row is not yet an answer at all.
 *
 * `null` rather than a partial order for the two cases that are not a
 * child's mistake but a caller's: fewer (or more) plates than sockets, and
 * an entity that is not a plate of this step. Both are authoring errors
 * caught by the test, so returning `null` here keeps a malformed row from
 * ever reaching `submitAnswer` and being recorded as a wrong answer against
 * the child.
 */
export function seatedPlatesToOrder(seated: readonly string[]): string[] | null {
  if (seated.length !== BINDING_SOCKET_COUNT) return null;
  if (new Set(seated).size !== seated.length) return null;

  const order: string[] = [];
  for (const entityId of seated) {
    const binding = resolveCastleChoiceBinding(entityId);
    if (
      !binding ||
      binding.templateSlug !== THE_STORYKEEPERS_TALE_SLUG ||
      binding.stepId !== ORDER_THE_STORY_STEP_ID
    ) {
      return null;
    }
    order.push(binding.optionId);
  }
  return order;
}
