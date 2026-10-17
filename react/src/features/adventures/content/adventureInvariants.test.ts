/**
 * Invariants every authored adventure must hold, whatever phase wrote it.
 *
 * The existing content tests are per-arc or per-story, so a new adventure
 * added at a real island location was covered by none of them. Pirate
 * Builder Bay now holds three band variants of the same place, which makes
 * the "which one does a child get" question load-bearing, and an authoring
 * slip in any of them reaches a child directly.
 */
import { describe, expect, it } from 'vitest';
import {
  ADVENTURE_TEMPLATES,
  LEARNING_OBJECTIVES,
  getAdventureTemplatesForLocation,
} from './index';
import { ISLAND_LOCATIONS } from '../../island/locations';

const OBJECTIVE_CODES = new Set(LEARNING_OBJECTIVES.map((objective) => objective.code));

describe('every authored adventure', () => {
  it('names only learning objectives that exist', () => {
    for (const template of ADVENTURE_TEMPLATES) {
      for (const step of template.steps) {
        for (const code of step.objectiveIds) {
          expect(OBJECTIVE_CODES.has(code), `${template.slug}/${step.id}: ${code}`).toBe(true);
        }
      }
    }
  });

  /**
   * A choice whose `correctOptionId` names no option can never be answered
   * correctly, so the step loops forever on its own `incorrect` transition.
   */
  it('gives every choice step a correct option that is actually offered', () => {
    for (const template of ADVENTURE_TEMPLATES) {
      for (const step of template.steps) {
        if (step.presentation.kind !== 'choice') continue;
        const ids = step.presentation.options.map((option) => option.id);
        expect(ids, `${template.slug}/${step.id}`).toContain(step.presentation.correctOptionId);
      }
    }
  });

  it('points every transition at a step that exists', () => {
    for (const template of ADVENTURE_TEMPLATES) {
      const known = new Set([...template.steps.map((step) => step.id), 'complete']);
      for (const step of template.steps) {
        for (const transition of step.transitions) {
          expect(known.has(transition.nextStepId), `${template.slug}/${step.id}`).toBe(true);
        }
      }
    }
  });

  it('avoids em dashes in child-facing copy (CLAUDE.md section 13)', () => {
    for (const template of ADVENTURE_TEMPLATES) {
      expect(template.title, template.slug).not.toContain('—');
      for (const step of template.steps) {
        for (const line of step.hintPolicy?.ladder ?? []) {
          expect(line, `${template.slug}/${step.id}`).not.toContain('—');
        }
        expect(step.fallback?.text ?? '', `${template.slug}/${step.id}`).not.toContain('—');
      }
    }
  });
});

describe('band coverage at real island locations', () => {
  /**
   * `resolveAdventureForAgeBand` takes the first template at a location
   * matching the child's band, so two matching the same band would make which
   * one a child gets an accident of authoring order.
   */
  it('never offers two adventures for the same band at one location', () => {
    for (const location of ISLAND_LOCATIONS) {
      const templates = getAdventureTemplatesForLocation(location.slug);
      for (const ageBand of ['SPROUT', 'PATHFINDER', 'EXPLORER'] as const) {
        const matching = templates.filter((template) => template.ageBands.includes(ageBand));
        expect(matching.length, `${location.slug} @ ${ageBand}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('covers all three bands at Pirate Builder Bay, the first location a child reaches', () => {
    const templates = getAdventureTemplatesForLocation('pirate-builder-bay');
    const bySlug = (band: 'SPROUT' | 'PATHFINDER' | 'EXPLORER') =>
      templates.filter((template) => template.ageBands.includes(band)).map((t) => t.slug);

    expect(bySlug('SPROUT')).toEqual(['three-planks-for-the-bridge']);
    expect(bySlug('PATHFINDER')).toEqual(['repair-the-moonlight-bridge']);
    expect(bySlug('EXPLORER')).toEqual(['the-tide-gate-calculation']);
  });

  /**
   * Sprout steps stay one-decision and picture-sized; Explorer steps are
   * allowed the input types younger bands are not (CLAUDE.md section 3).
   */
  it('keeps the Sprout bay adventure to one-step decisions', () => {
    const sprout = ADVENTURE_TEMPLATES.find((t) => t.slug === 'three-planks-for-the-bridge');
    expect(sprout).toBeDefined();
    expect(sprout!.steps.length).toBeLessThanOrEqual(6);
    for (const step of sprout!.steps) {
      expect(step.type).not.toBe('NUMBER_INPUT');
      expect(step.type).not.toBe('ORDERING');
      if (step.presentation.kind === 'choice') {
        expect(step.presentation.options.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('pitches the Explorer bay adventure above the Pathfinder one', () => {
    const explorer = ADVENTURE_TEMPLATES.find((t) => t.slug === 'the-tide-gate-calculation');
    expect(explorer).toBeDefined();
    // Numbers past ten are the point: an Explorer adventure that only counted
    // to four would be the Pathfinder adventure with a different name.
    const values = explorer!.steps
      .map((step) =>
        step.presentation.kind === 'number-input' ? step.presentation.correctValue : 0,
      )
      .filter(Boolean);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toBeGreaterThan(10);
  });
});
