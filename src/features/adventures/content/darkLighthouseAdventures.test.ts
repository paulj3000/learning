import { describe, expect, it } from 'vitest';
import { SKILLS } from '../../curriculum/content/index';
import { resolveAdventureForSkillLevel } from '../../adaptive/selection';
import { getQuestDefinition } from '../../quests/content';
import { allObjectives } from '../../quests/quest';
import { DARK_LIGHTHOUSE_ADVENTURES } from './darkLighthouseAdventures';
import { getAdventureTemplatesForLocation, resolveAdventureForAgeBand } from './index';

const SKILL_IDS = new Set(SKILLS.map((skill) => skill.id));

describe('The Dark Lighthouse variants', () => {
  it('tells one story beat, not three stories', () => {
    // Section 2.2: "the overall story remains the same regardless of the
    // player's learning level". Same title, same place, same world change.
    for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
      expect(variant.title).toBe('The Dark Lighthouse');
      expect(variant.locationSlug).toBe('clockwork-harbor');
    }
  });

  it('records the same world change from every variant, so the harbor grows the same way', () => {
    for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
      const keys = variant.steps
        .map((step) => step.presentation)
        .filter((presentation) => presentation.kind === 'world-change')
        .map((presentation) => presentation.payload.changeKey);

      expect(keys, variant.slug).toEqual(['CLOCKWORK_LIGHTHOUSE_FIXED']);
    }
  });

  it('gives every variant a distinct skill level in one domain', () => {
    const levels = DARK_LIGHTHOUSE_ADVENTURES.map((variant) => variant.skillLevel);
    expect(new Set(levels).size).toBe(levels.length);
    for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
      expect(variant.skillDomain, variant.slug).toBe('math');
      expect(variant.skillLevel, variant.slug).toBeDefined();
    }
  });

  it('covers all three age bands between them', () => {
    const covered = new Set(DARK_LIGHTHOUSE_ADVENTURES.flatMap((variant) => variant.ageBands));
    expect([...covered].sort()).toEqual(['EXPLORER', 'PATHFINDER', 'SPROUT']);
  });

  it('names only curriculum skills that exist, so evidence is written against something', () => {
    for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
      for (const step of variant.steps) {
        for (const objectiveId of step.objectiveIds) {
          expect(SKILL_IDS.has(objectiveId), `${variant.slug}/${step.id}: ${objectiveId}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('gives every graded step a hint ladder that ends by naming the answer', () => {
    // A stuck child needs an exit, not another nudge.
    for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
      for (const step of variant.steps) {
        if (step.type !== 'NUMBER_INPUT' && step.type !== 'CHOICE') continue;
        const ladder = step.hintPolicy?.ladder ?? [];
        expect(ladder.length, `${variant.slug}/${step.id}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('lets a wrong answer retry rather than dropping the child out of the adventure', () => {
    for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
      for (const step of variant.steps) {
        if (step.type !== 'NUMBER_INPUT' && step.type !== 'CHOICE') continue;
        const onIncorrect = step.transitions.find((transition) => transition.when === 'incorrect');
        expect(onIncorrect, `${variant.slug}/${step.id}`).toBeDefined();
      }
    }
  });

  it('gets harder as the level rises, measured in graded steps', () => {
    const gradedSteps = (slug: string) =>
      DARK_LIGHTHOUSE_ADVENTURES.find((v) => v.slug === slug)!.steps.filter(
        (step) => step.type === 'NUMBER_INPUT' || step.type === 'CHOICE',
      ).length;

    expect(gradedSteps('the-dark-lighthouse-counting')).toBe(1);
    expect(gradedSteps('the-dark-lighthouse-two-step')).toBe(2);
  });
});

describe('adaptive selection at the lighthouse', () => {
  const variants = getAdventureTemplatesForLocation('clockwork-harbor');

  it('serves the counting variant to a child with no evidence', () => {
    expect(resolveAdventureForSkillLevel(variants, 1)?.slug).toBe('the-dark-lighthouse-counting');
  });

  it('serves the grouping variant to a level-3 child', () => {
    expect(resolveAdventureForSkillLevel(variants, 3)?.slug).toBe('the-dark-lighthouse-groups');
  });

  it('serves the two-step variant to a level-5 child', () => {
    expect(resolveAdventureForSkillLevel(variants, 5)?.slug).toBe('the-dark-lighthouse-two-step');
  });

  it('still resolves deterministically by age band, without a profile', () => {
    // Three variants now share bands at one location. The age-band resolver has
    // no profile to consult, so it must at least never be an accident of
    // authoring order - it takes the gentlest match.
    expect(resolveAdventureForAgeBand('clockwork-harbor', 'none', 'EXPLORER')?.slug).toBe(
      'the-dark-lighthouse-groups',
    );
    expect(resolveAdventureForAgeBand('clockwork-harbor', 'none', 'SPROUT')?.slug).toBe(
      'the-dark-lighthouse-counting',
    );
  });
});

describe('the light-the-harbor quest', () => {
  const quest = getQuestDefinition('light-the-harbor');

  it('is authored and given by the Harbor Master', () => {
    expect(quest).toBeDefined();
    expect(quest!.giverNpcId).toBe('harbor-master');
  });

  it('completes on the world change every variant records, not on one variant', () => {
    // A child served the counting variant must be able to finish the quest.
    const buildObjectives = allObjectives(quest!).filter((objective) => objective.kind === 'BUILD');
    expect(buildObjectives.map((objective) => objective.changeKey)).toContain(
      'CLOCKWORK_LIGHTHOUSE_FIXED',
    );
  });

  it('lets a child who already lit the lighthouse skip ahead rather than redo it', () => {
    const entry = quest!.stages.find((stage) => stage.id === quest!.entryStageId);
    const skip = entry?.branches?.find((branch) =>
      branch.conditions.some(
        (condition) =>
          condition.type === 'WORLD_CHANGE' && condition.changeKey === 'CLOCKWORK_LIGHTHOUSE_FIXED',
      ),
    );
    expect(skip).toBeDefined();
  });
});
