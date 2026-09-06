import { describe, expect, it } from 'vitest';
import {
  BINDING_SOCKET_COUNT,
  isStoryPlateEntity,
  ORDER_THE_STORY_STEP_ID,
  seatedPlatesToOrder,
  STORY_PLATE_ENTITY_IDS,
} from './castleBindingLectern';
import { THE_STORYKEEPERS_TALE } from '../../adventures/content/theStorykeepersTale';
import { getCastleChoiceBindingsForStep, THE_STORYKEEPERS_TALE_SLUG } from './castleChoiceBindings';

/**
 * SC-5's central exit criterion, in one file: **the plate route and the HUD
 * list route produce identical session state**.
 *
 * `AdventureStepCard` renders `OrderingStep` for `order-the-story`, and
 * `OrderingStep` submits `{ kind: 'ordering', order }` where `order` is a
 * permutation of the step's own `presentation.items` ids. So proving the
 * lectern equivalent means proving that seating three plates produces a
 * permutation of the same ids - for every seating, not just the right one,
 * because a wrong order has to reach the engine and be graded wrong rather
 * than be silently dropped or corrected by the room.
 */

const orderingStep = THE_STORYKEEPERS_TALE.steps.find(
  (step) => step.id === ORDER_THE_STORY_STEP_ID,
);

function orderingPresentation() {
  if (!orderingStep || orderingStep.presentation.kind !== 'ordering') {
    throw new Error(`"${ORDER_THE_STORY_STEP_ID}" is not an ordering step`);
  }
  return orderingStep.presentation;
}

/** Every arrangement of the plates a child could physically seat. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe('the binding lectern stands for the ordering step', () => {
  it('has one plate per socket, and one socket per authored story beat', () => {
    expect(STORY_PLATE_ENTITY_IDS).toHaveLength(BINDING_SOCKET_COUNT);
    expect(orderingPresentation().items).toHaveLength(BINDING_SOCKET_COUNT);
  });

  it('binds every plate to `order-the-story`, and every item to exactly one plate', () => {
    const bindings = getCastleChoiceBindingsForStep(
      THE_STORYKEEPERS_TALE_SLUG,
      ORDER_THE_STORY_STEP_ID,
    );
    expect(bindings.map((binding) => binding.entityId).sort()).toEqual(
      [...STORY_PLATE_ENTITY_IDS].sort(),
    );
    expect(bindings.map((binding) => binding.optionId).sort()).toEqual(
      orderingPresentation()
        .items.map((item) => item.id)
        .sort(),
    );
  });

  it('recognises the plates and nothing else', () => {
    for (const entityId of STORY_PLATE_ENTITY_IDS) {
      expect(isStoryPlateEntity(entityId)).toBe(true);
    }
    expect(isStoryPlateEntity('binding-lectern')).toBe(false);
    expect(isStoryPlateEntity('gallery-portrait-fox')).toBe(false);
  });
});

describe('seatedPlatesToOrder', () => {
  const itemIds = orderingPresentation().items.map((item) => item.id);

  it('turns every possible seating into an answer the HUD list could also have submitted', () => {
    for (const seating of permutations(STORY_PLATE_ENTITY_IDS)) {
      const order = seatedPlatesToOrder(seating);
      expect(order, seating.join(' > ')).not.toBeNull();
      // A permutation of the step's own items: same three ids, no repeats.
      expect([...order!].sort()).toEqual([...itemIds].sort());
    }
  });

  /** The room never corrects the child: exactly one seating is the answer. */
  it('produces the correct order only when the plates are seated in it', () => {
    const correct = orderingPresentation().correctOrder;
    const matching = permutations(STORY_PLATE_ENTITY_IDS).filter(
      (seating) => seatedPlatesToOrder(seating)?.join(',') === correct.join(','),
    );
    expect(matching).toHaveLength(1);
  });

  /**
   * The one that has already been wrong once. The plates start lying on a
   * table in an authored left-to-right order, and if that order is the
   * *answer* then seating them left to right without reading them scores a
   * sequencing step the child never did - a bug no engine test can see,
   * because the answer it receives is genuinely correct.
   *
   * So the table must start where the HUD list starts: the step's own
   * authored `items` order, which `theStorykeepersTale.ts` deliberately
   * shuffles away from `correctOrder`.
   */
  it('starts the plates in the same shuffled order the HUD list starts in', () => {
    const presentation = orderingPresentation();
    const fromTheTable = seatedPlatesToOrder(STORY_PLATE_ENTITY_IDS);
    expect(fromTheTable).toEqual(presentation.items.map((item) => item.id));
    expect(fromTheTable).not.toEqual([...presentation.correctOrder]);
  });

  it('refuses a row that is not an answer yet, rather than guessing at one', () => {
    expect(seatedPlatesToOrder([])).toBeNull();
    expect(seatedPlatesToOrder(STORY_PLATE_ENTITY_IDS.slice(0, 2))).toBeNull();
    expect(seatedPlatesToOrder([...STORY_PLATE_ENTITY_IDS, STORY_PLATE_ENTITY_IDS[0]])).toBeNull();
  });

  it('refuses a row holding the same plate twice, or something that is not a plate', () => {
    const [first, second] = STORY_PLATE_ENTITY_IDS;
    expect(seatedPlatesToOrder([first, first, second])).toBeNull();
    expect(seatedPlatesToOrder([first, second, 'gallery-portrait-fox'])).toBeNull();
  });
});
