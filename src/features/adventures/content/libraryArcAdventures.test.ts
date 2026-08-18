import { describe, expect, it } from 'vitest';
import { DINOSAUR_EXPEDITION_ADVENTURES } from './dinosaurExpeditionAdventures';
import { ROBOT_RESCUE_ADVENTURES } from './robotRescueAdventures';
import { BUTTERFLY_GARDEN_ADVENTURES } from './butterflyGardenAdventures';
import { CASTLES_SECRET_DOOR_ADVENTURES } from './castlesSecretDoorAdventures';
import { LEARNING_OBJECTIVES, getAdventureTemplatesForLocation } from './index';
import { ISLAND_LOCATIONS } from '../../island/locations';

/**
 * Structural guards for the eight Adventure Library arc challenges
 * (docs/ROADMAP.md Phase 15), the same checks
 * `emberMountainChapterAdventures.test.ts` applies to the reference story's
 * chapters, plus the rules this phase adds: renderable presentation kinds
 * only, real learning objective codes, and pseudo-locations that cannot
 * leak onto a real island location page.
 */
const LIBRARY_ARC_ADVENTURES = [
  ...DINOSAUR_EXPEDITION_ADVENTURES,
  ...ROBOT_RESCUE_ADVENTURES,
  ...BUTTERFLY_GARDEN_ADVENTURES,
  ...CASTLES_SECRET_DOOR_ADVENTURES,
];

/** Every kind `AdventureRunner` can actually render today (MATCHING and SHORT_RESPONSE have no renderer yet). */
const RENDERABLE_PRESENTATION_KINDS = new Set([
  'narrative',
  'number-input',
  'choice',
  'ordering',
  'creative-choice',
  'reflection',
  'world-change',
  'complete',
]);

describe.each(LIBRARY_ARC_ADVENTURES)('$title ($slug)', (definition) => {
  const stepIds = new Set(definition.steps.map((step) => step.id));

  it('has a valid entry step', () => {
    expect(stepIds.has(definition.entryStepId)).toBe(true);
  });

  it('only transitions to step ids that exist', () => {
    for (const step of definition.steps) {
      for (const transition of step.transitions) {
        expect(stepIds.has(transition.nextStepId)).toBe(true);
      }
    }
  });

  it('has exactly one COMPLETE step with no outgoing transitions', () => {
    const completeSteps = definition.steps.filter((step) => step.type === 'COMPLETE');
    expect(completeSteps).toHaveLength(1);
    expect(completeSteps[0]?.transitions).toHaveLength(0);
  });

  it('every WORLD_CHANGE step always advances somewhere', () => {
    for (const step of definition.steps) {
      if (step.type === 'WORLD_CHANGE') {
        expect(step.transitions).toEqual([{ when: 'always', nextStepId: expect.any(String) }]);
      }
    }
  });

  it('records exactly one world change', () => {
    const worldChanges = definition.steps.filter((step) => step.type === 'WORLD_CHANGE');
    expect(worldChanges).toHaveLength(1);
  });

  it('can reach COMPLETE by always following the "correct"/"always" path', () => {
    const visited = new Set<string>();
    let currentId: string | undefined = definition.entryStepId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const step = definition.steps.find((candidate) => candidate.id === currentId);
      if (!step || step.type === 'COMPLETE') break;
      const rule =
        step.transitions.find((transition) => transition.when === 'correct') ??
        step.transitions.find((transition) => transition.when === 'always');
      currentId = rule?.nextStepId;
    }
    const finalStep = definition.steps.find((step) => step.id === currentId);
    expect(finalStep?.type).toBe('COMPLETE');
  });

  it('gives every answerable step a 5-level hint ladder', () => {
    const answerableTypes = new Set(['NUMBER_INPUT', 'CHOICE', 'ORDERING']);
    for (const step of definition.steps) {
      if (answerableTypes.has(step.type)) {
        expect(step.hintPolicy?.ladder).toHaveLength(5);
      }
    }
  });

  it('gives every step an authored, non-AI fallback', () => {
    for (const step of definition.steps) {
      expect(step.fallback.text.length).toBeGreaterThan(0);
    }
  });

  it('only uses presentation kinds the runner can render', () => {
    for (const step of definition.steps) {
      expect(RENDERABLE_PRESENTATION_KINDS).toContain(step.presentation.kind);
    }
  });

  it('only cites learning objective codes that exist', () => {
    const codes = new Set(LEARNING_OBJECTIVES.map((objective) => objective.code));
    for (const step of definition.steps) {
      for (const objectiveId of step.objectiveIds) {
        expect(codes).toContain(objectiveId);
      }
    }
  });

  it('lives at a story-only pseudo-location, unreachable from an island location page', () => {
    const realSlugs = ISLAND_LOCATIONS.map((location) => location.slug);
    expect(realSlugs).not.toContain(definition.locationSlug);
    expect(getAdventureTemplatesForLocation(definition.locationSlug)).toContain(definition);
  });
});

describe('LIBRARY_ARC_ADVENTURES', () => {
  it('has eight distinct arc challenges', () => {
    const slugs = LIBRARY_ARC_ADVENTURES.map((definition) => definition.slug);
    expect(slugs).toHaveLength(8);
    expect(new Set(slugs).size).toBe(8);
  });

  it('keeps every real island location on exactly the adventure it already had', () => {
    expect(getAdventureTemplatesForLocation('pirate-builder-bay')).toHaveLength(1);
    expect(getAdventureTemplatesForLocation('wonderwild-forest')).toHaveLength(1);
    expect(getAdventureTemplatesForLocation('storykeeper-castle')).toHaveLength(1);
  });

  it('shapes the Sprout-playable nature arc for one-step decisions only', () => {
    for (const definition of BUTTERFLY_GARDEN_ADVENTURES) {
      expect(definition.ageBands).toContain('SPROUT');
      for (const step of definition.steps) {
        expect(step.type).not.toBe('NUMBER_INPUT');
        expect(step.type).not.toBe('ORDERING');
      }
      expect(definition.steps.length).toBeLessThanOrEqual(6);
    }
  });

  it('scopes the Explorer-only mystery arc to Explorers', () => {
    for (const definition of CASTLES_SECRET_DOOR_ADVENTURES) {
      expect(definition.ageBands).toEqual(['EXPLORER']);
    }
  });
});
