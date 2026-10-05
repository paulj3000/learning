import { describe, expect, it } from 'vitest';
import { ADVENTURE_TEMPLATES } from '../../../adventures/content';
import { CASTLE_CHOICE_BINDINGS } from '../castleChoiceBindings';
import { WONDER_WALL_BINDINGS } from '../wonderWallBindings';
import { ALL_ENTITY_IDS as CASTLE_ENTITY_IDS } from '../storykeeperCastleRegion';
import { ALL_ENTITY_IDS as FOREST_ENTITY_IDS } from '../wonderwildForestRegion';
import {
  bindingsForStep,
  boundSteps,
  entityForOption,
  findAdventureBindingIssues,
  resolveEntityBinding,
  seatedEntitiesToOrder,
  stepOptionIds,
  type AdventureBindingIssueKind,
  type AdventureStepBinding,
  type BindableAdventure,
} from './adventureStepBindings';

/**
 * A tale with a choice step and an ordering step, and a second adventure
 * reusing the same two things in the room for its own two options - the
 * cross-band case (one set of rooms, two age bands) that makes an
 * unqualified lookup a bug.
 */
const ADVENTURES: readonly BindableAdventure[] = [
  {
    slug: 'the-tale',
    steps: [
      {
        id: 'choose-hero',
        presentation: { kind: 'choice', options: [{ id: 'hero-fox' }, { id: 'hero-owl' }] },
      },
      {
        id: 'order-the-beats',
        presentation: { kind: 'ordering', items: [{ id: 'beat-start' }, { id: 'beat-end' }] },
      },
      { id: 'the-end', presentation: { kind: 'narrative' } },
    ],
  },
  {
    slug: 'the-little-tale',
    steps: [
      {
        id: 'pick-an-animal',
        presentation: { kind: 'choice', options: [{ id: 'picture-fox' }, { id: 'picture-owl' }] },
      },
    ],
  },
];

const PLACED = ['fox-portrait', 'owl-portrait', 'plate-start', 'plate-end', 'tapestry'];

const BINDINGS: readonly AdventureStepBinding[] = [
  {
    entityId: 'fox-portrait',
    templateSlug: 'the-tale',
    stepId: 'choose-hero',
    optionId: 'hero-fox',
  },
  {
    entityId: 'owl-portrait',
    templateSlug: 'the-tale',
    stepId: 'choose-hero',
    optionId: 'hero-owl',
  },
  {
    entityId: 'plate-start',
    templateSlug: 'the-tale',
    stepId: 'order-the-beats',
    optionId: 'beat-start',
  },
  {
    entityId: 'plate-end',
    templateSlug: 'the-tale',
    stepId: 'order-the-beats',
    optionId: 'beat-end',
  },
  {
    entityId: 'fox-portrait',
    templateSlug: 'the-little-tale',
    stepId: 'pick-an-animal',
    optionId: 'picture-fox',
  },
  {
    entityId: 'owl-portrait',
    templateSlug: 'the-little-tale',
    stepId: 'pick-an-animal',
    optionId: 'picture-owl',
  },
];

function kindsOf(
  bindings: readonly AdventureStepBinding[],
  placedEntityIds: readonly string[] = PLACED,
): AdventureBindingIssueKind[] {
  return findAdventureBindingIssues(bindings, { adventures: ADVENTURES, placedEntityIds }).map(
    (issue) => issue.kind,
  );
}

describe('stepOptionIds', () => {
  it('reads options, items, or neither', () => {
    expect(stepOptionIds(ADVENTURES[0]!.steps![0]!)).toEqual(['hero-fox', 'hero-owl']);
    expect(stepOptionIds(ADVENTURES[0]!.steps![1]!)).toEqual(['beat-start', 'beat-end']);
    expect(stepOptionIds(ADVENTURES[0]!.steps![2]!)).toEqual([]);
  });
});

describe('resolveEntityBinding', () => {
  it('resolves an entity within the adventure being played', () => {
    expect(resolveEntityBinding(BINDINGS, 'fox-portrait', 'the-tale')?.optionId).toBe('hero-fox');
    expect(resolveEntityBinding(BINDINGS, 'fox-portrait', 'the-little-tale')?.optionId).toBe(
      'picture-fox',
    );
  });

  it('returns undefined for a thing that is not a choice, and for another adventure', () => {
    expect(resolveEntityBinding(BINDINGS, 'tapestry', 'the-tale')).toBeUndefined();
    expect(resolveEntityBinding(BINDINGS, 'plate-start', 'the-little-tale')).toBeUndefined();
  });

  it('takes the first match when no adventure is named', () => {
    // Which is why a caller that knows the adventure must say so.
    expect(resolveEntityBinding(BINDINGS, 'fox-portrait')?.templateSlug).toBe('the-tale');
  });
});

describe('bindingsForStep and boundSteps', () => {
  it('lists a step’s entities in authored order', () => {
    expect(bindingsForStep(BINDINGS, 'the-tale', 'choose-hero').map((b) => b.entityId)).toEqual([
      'fox-portrait',
      'owl-portrait',
    ]);
    expect(bindingsForStep(BINDINGS, 'the-tale', 'the-end')).toEqual([]);
  });

  it('lists each (adventure, step) pair once, in authored order', () => {
    expect(boundSteps(BINDINGS)).toEqual([
      { templateSlug: 'the-tale', stepId: 'choose-hero' },
      { templateSlug: 'the-tale', stepId: 'order-the-beats' },
      { templateSlug: 'the-little-tale', stepId: 'pick-an-animal' },
    ]);
  });
});

describe('entityForOption', () => {
  it('finds the thing to light for an option already recorded on the session', () => {
    expect(entityForOption(BINDINGS, 'the-tale', 'choose-hero', 'hero-owl')).toBe('owl-portrait');
  });

  it('returns undefined for no answer yet, or for another step', () => {
    expect(entityForOption(BINDINGS, 'the-tale', 'choose-hero', null)).toBeUndefined();
    expect(entityForOption(BINDINGS, 'the-tale', 'choose-hero', undefined)).toBeUndefined();
    expect(entityForOption(BINDINGS, 'the-tale', 'the-end', 'hero-owl')).toBeUndefined();
  });
});

describe('seatedEntitiesToOrder', () => {
  it('translates a row of seated things into the order the step grades', () => {
    expect(
      seatedEntitiesToOrder(BINDINGS, 'the-tale', 'order-the-beats', ['plate-end', 'plate-start']),
    ).toEqual(['beat-end', 'beat-start']);
  });

  it('is null for a malformed row rather than a wrong answer against the child', () => {
    const order = (seated: string[]) =>
      seatedEntitiesToOrder(BINDINGS, 'the-tale', 'order-the-beats', seated);
    expect(order(['plate-start'])).toBeNull();
    expect(order(['plate-start', 'plate-start'])).toBeNull();
    expect(order(['plate-start', 'tapestry'])).toBeNull();
  });
});

describe('findAdventureBindingIssues', () => {
  it('accepts bindings whose every reference resolves', () => {
    expect(
      findAdventureBindingIssues(BINDINGS, { adventures: ADVENTURES, placedEntityIds: PLACED }),
    ).toEqual([]);
  });

  it('accepts one entity meaning one thing in each of two adventures', () => {
    // One set of rooms serving two age bands, which is the castle's SC-10.
    expect(kindsOf(BINDINGS)).toEqual([]);
  });

  it('reports an unknown adventure, step or option', () => {
    const [first, ...rest] = BINDINGS;
    expect(kindsOf([{ ...first!, templateSlug: 'no-such-tale' }, ...rest])).toEqual([
      'UNKNOWN_ADVENTURE',
      'UNBOUND_STEP_OPTION',
    ]);
    expect(kindsOf([{ ...first!, stepId: 'no-such-step' }, ...rest])).toEqual([
      'UNKNOWN_ADVENTURE_STEP',
      'UNBOUND_STEP_OPTION',
    ]);
    expect(kindsOf([{ ...first!, optionId: 'hero-badger' }, ...rest])).toEqual([
      'UNKNOWN_STEP_OPTION',
      'UNBOUND_STEP_OPTION',
    ]);
  });

  it('reports an adventure whose steps the registry does not carry at all', () => {
    expect(
      findAdventureBindingIssues(BINDINGS.slice(0, 1), {
        adventures: [{ slug: 'the-tale' }],
      }).map((issue) => issue.kind),
    ).toEqual(['UNKNOWN_ADVENTURE_STEP']);
  });

  it('reports an option of a bound step that no entity stands for', () => {
    // The room offers one of two heroes and nothing else complains.
    expect(kindsOf(BINDINGS.filter((binding) => binding.entityId !== 'owl-portrait'))).toEqual([
      'UNBOUND_STEP_OPTION',
      'UNBOUND_STEP_OPTION',
    ]);
  });

  it('reports an entity bound twice within one adventure', () => {
    const doubled: AdventureStepBinding = {
      entityId: 'fox-portrait',
      templateSlug: 'the-tale',
      stepId: 'order-the-beats',
      optionId: 'beat-start',
    };
    expect(kindsOf([...BINDINGS, doubled])).toEqual(['DUPLICATE_BINDING', 'UNBOUND_STEP_OPTION']);
  });

  it('reports an entity the region does not place, and skips the check without a list', () => {
    // The option is still bound - to a thing that is not in the room, which
    // is exactly the renamed-prop case this check exists for.
    const [first, ...rest] = BINDINGS;
    expect(kindsOf([{ ...first!, entityId: 'ghost-portrait' }, ...rest])).toEqual([
      'UNPLACED_ENTITY',
    ]);
    expect(
      findAdventureBindingIssues([{ ...first!, entityId: 'ghost-portrait' }, ...rest], {
        adventures: ADVENTURES,
      }),
    ).toEqual([]);
  });

  it('names the binding in its path so an author can find it', () => {
    const [first, ...rest] = BINDINGS;
    expect(
      findAdventureBindingIssues([first!, ...rest, { ...first!, optionId: 'hero-badger' }], {
        adventures: ADVENTURES,
      })[0],
    ).toMatchObject({ kind: 'DUPLICATE_BINDING', path: 'adventureBindings[6]' });
  });
});

/**
 * The two tables that already exist in the tree, checked by the generic
 * checker against the real adventure content. This is what makes the shared
 * layer a replacement for the two hand-written authoring tests rather than a
 * third opinion: if it passes here it would have passed there.
 */
describe('the shipped binding tables (Phase 8)', () => {
  it('Storykeeper Castle binds only real steps and options of placed entities', () => {
    expect(
      findAdventureBindingIssues(CASTLE_CHOICE_BINDINGS, {
        adventures: ADVENTURE_TEMPLATES,
        placedEntityIds: CASTLE_ENTITY_IDS,
      }),
    ).toEqual([]);
  });

  it('Wonderwild Forest binds only real steps and options of placed entities', () => {
    expect(
      findAdventureBindingIssues(WONDER_WALL_BINDINGS, {
        adventures: ADVENTURE_TEMPLATES,
        placedEntityIds: FOREST_ENTITY_IDS,
      }),
    ).toEqual([]);
  });
});
