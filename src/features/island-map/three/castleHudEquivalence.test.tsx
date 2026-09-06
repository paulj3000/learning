import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AdventureStepCard } from '../../adventures/AdventureStepCard';
import { getAdventureTemplate, getAdventureTemplatesForLocation } from '../../adventures/content';
import { QUILLS_PICTURE_STORY } from '../../adventures/content/quillsPictureStory';
import { THE_STORYKEEPERS_TALE } from '../../adventures/content/theStorykeepersTale';
import {
  SECRET_DOOR_CHAPTER_1_THREE_CLUES,
  SECRET_DOOR_CHAPTER_2_PATTERN_LOCK,
} from '../../adventures/content/castlesSecretDoorAdventures';
import { BOUND_STEPS, getCastleChoiceBindingsForStep } from './castleChoiceBindings';
import type { AdventureDefinition, AdventureStep } from '../../adventures/engine/types';

/**
 * SC-11's HUD-equivalence audit, as a test rather than a paragraph.
 *
 * The standing constraint every phase of
 * `docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` inherits is that **every 3D route
 * has a HUD equivalent driving the identical step**: walking, looking and
 * aiming are never the only way to a learning objective
 * (`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 42).
 * SC-11 asks for that to be audited before the castle may claim to be
 * finished.
 *
 * An audit written as prose is true on the day it is written. This renders
 * the real `AdventureStepCard` - the very component the card route renders -
 * for every step the castle stages as a world object, and asserts the child
 * can reach every option from it without moving. A future phase that binds
 * a step the card cannot answer fails here.
 *
 * What this cannot check is whether the card is *usable* by a three-year-old
 * on a real tablet. That is the playtest SC-11 also requires, and it has not
 * run; see `docs/PILOT_READINESS.md` section 5.
 */

/** Every adventure a child can play inside this region, whatever their band. */
const CASTLE_ADVENTURES: readonly AdventureDefinition[] = [
  ...getAdventureTemplatesForLocation('storykeeper-castle'),
  // The Explorer arc is a story hosted here (ADR-019); its chapters are
  // authored against `castle-secret-passage` but played in this room.
  SECRET_DOOR_CHAPTER_1_THREE_CLUES,
  SECRET_DOOR_CHAPTER_2_PATTERN_LOCK,
];

/**
 * The presentation kinds `AdventureStepCard` renders an *answerable control*
 * for. `narrative`, `reflection`, `world-change` and `complete` advance on a
 * button and carry no objective; anything a child is graded on must be one
 * of these three.
 */
const ANSWERABLE_KINDS = ['choice', 'creative-choice', 'ordering', 'number-input'];

function findStep(definition: AdventureDefinition, stepId: string): AdventureStep {
  const step = definition.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`${definition.slug} has no step "${stepId}"`);
  return step;
}

function renderCard(step: AdventureStep) {
  return render(
    <MemoryRouter>
      <AdventureStepCard
        currentStep={step}
        submitting={false}
        error={null}
        submitAnswer={() => {}}
        hintLevel={0}
        hintText={undefined}
        requestHint={() => {}}
        companionTurn={{ status: 'idle' }}
        representationAid={undefined}
        storyScenes={[]}
        backToMapHref="/island/child-1/locations/storykeeper-castle"
      />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('the castle stages nothing the HUD cannot answer', () => {
  it('has adventures to check', () => {
    expect(CASTLE_ADVENTURES.length).toBeGreaterThanOrEqual(4);
    expect(CASTLE_ADVENTURES.map((definition) => definition.slug)).toEqual(
      expect.arrayContaining([THE_STORYKEEPERS_TALE.slug, QUILLS_PICTURE_STORY.slug]),
    );
  });

  /**
   * The structural half. A bound step is one the room can answer; if its
   * presentation were something the card only *displays*, the room would be
   * the only route to it.
   */
  it.each(BOUND_STEPS.map((bound) => [bound.templateSlug, bound.stepId] as const))(
    '%s/%s is answerable from the card, not only from the room',
    (templateSlug, stepId) => {
      const definition = getAdventureTemplate(templateSlug);
      expect(definition, `${templateSlug} is not a registered adventure`).toBeDefined();
      const step = findStep(definition!, stepId);
      expect(ANSWERABLE_KINDS, `${templateSlug}/${stepId}`).toContain(step.presentation.kind);
    },
  );

  /**
   * The rendered half, and the one that would actually catch a regression:
   * every option the room binds to an entity is on the card too, with the
   * same words. A portrait a child can walk to but not press is a learning
   * objective reachable only by walking.
   */
  it.each(BOUND_STEPS.map((bound) => [bound.templateSlug, bound.stepId] as const))(
    '%s/%s offers every one of its world options on the card',
    (templateSlug, stepId) => {
      const definition = getAdventureTemplate(templateSlug)!;
      const step = findStep(definition!, stepId);
      const { presentation } = step;

      renderCard(step);

      const optionsInTheRoom = getCastleChoiceBindingsForStep(templateSlug, stepId);
      expect(optionsInTheRoom.length).toBeGreaterThan(0);

      const labels =
        presentation.kind === 'ordering'
          ? presentation.items
          : presentation.kind === 'choice' || presentation.kind === 'creative-choice'
            ? presentation.options
            : [];

      for (const binding of optionsInTheRoom) {
        const label = labels.find((candidate) => candidate.id === binding.optionId)?.label;
        expect(
          label,
          `${binding.entityId} -> ${binding.optionId} has no label on the card`,
        ).toBeDefined();
        expect(screen.getByText(label!)).toBeInTheDocument();
      }

      // And a way to commit the answer without touching the world.
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    },
  );

  /**
   * The claim SC-11 actually makes: no learning objective in this region is
   * reachable only by walking, looking or aiming. Every graded step of every
   * castle adventure renders an answerable control, whether or not the room
   * also stages it.
   */
  it.each(CASTLE_ADVENTURES.map((definition) => [definition.slug, definition] as const))(
    'every graded step of %s can be answered from the card alone',
    (_slug, definition) => {
      const gradedSteps = definition.steps.filter((step) => step.objectiveIds.length > 0);
      expect(gradedSteps.length).toBeGreaterThan(0);

      for (const step of gradedSteps) {
        expect(ANSWERABLE_KINDS, `${definition.slug}/${step.id}`).toContain(step.presentation.kind);
        renderCard(step);
        expect(
          screen.getAllByRole('button').length,
          `${definition.slug}/${step.id}`,
        ).toBeGreaterThan(0);
        cleanup();
      }
    },
  );
});
