import { describe, expect, it } from 'vitest';
import { DINOSAUR_EXPEDITION } from './dinosaurExpedition';
import { ROBOT_RESCUE } from './robotRescue';
import { SAVE_THE_BUTTERFLY_GARDEN } from './saveTheButterflyGarden';
import { THE_CASTLES_SECRET_DOOR } from './theCastlesSecretDoor';
import { STORY_DEFINITIONS } from './index';
import { validateStoryDefinition, resolveNarrativeText } from '../engine';
import { getAdventureTemplate, LEARNING_OBJECTIVES } from '../../adventures/content';

/**
 * Structural guards for the four Adventure Library arcs added in Phase 15
 * (docs/ROADMAP.md), applied together rather than one file per arc: they
 * are the same shape by design, and a shared suite means a fifth arc gets
 * the same checks for free.
 */
const LIBRARY_ARCS = [
  DINOSAUR_EXPEDITION,
  ROBOT_RESCUE,
  SAVE_THE_BUTTERFLY_GARDEN,
  THE_CASTLES_SECRET_DOOR,
];

const resolveAdventureTemplateSlug = (slug: string) => getAdventureTemplate(slug) !== undefined;

describe.each(LIBRARY_ARCS)('$title ($slug)', (story) => {
  it('is structurally valid', () => {
    expect(validateStoryDefinition(story, resolveAdventureTemplateSlug)).toEqual([]);
  });

  it('embeds a real, resolvable adventure for every ADVENTURE scene', () => {
    for (const chapter of story.chapters) {
      for (const scene of chapter.scenes) {
        if (scene.kind === 'ADVENTURE') {
          expect(getAdventureTemplate(scene.templateSlug)).toBeDefined();
        }
      }
    }
  });

  it('only embeds adventures authored for the same age bands as the arc', () => {
    for (const chapter of story.chapters) {
      for (const scene of chapter.scenes) {
        if (scene.kind !== 'ADVENTURE') continue;
        const template = getAdventureTemplate(scene.templateSlug);
        expect([...(template?.ageBands ?? [])].sort()).toEqual([...story.supportedAgeBands].sort());
      }
    }
  });

  it('embeds at least two graded challenges, so the arc is more than narration', () => {
    const adventureScenes = story.chapters.flatMap((chapter) =>
      chapter.scenes.filter((scene) => scene.kind === 'ADVENTURE'),
    );
    expect(adventureScenes.length).toBeGreaterThanOrEqual(2);
  });

  it('sets exactly one story flag, from a bounded curated choice with no free text', () => {
    const choiceScenes = story.chapters.flatMap((chapter) =>
      chapter.scenes.filter((scene) => scene.kind === 'CHOICE'),
    );
    expect(choiceScenes).toHaveLength(1);
    for (const scene of choiceScenes) {
      if (scene.kind !== 'CHOICE') throw new Error('Expected a choice scene.');
      expect(scene.flagKey.length).toBeGreaterThan(0);
      expect(scene.options.length).toBeGreaterThanOrEqual(2);
      for (const option of scene.options) {
        expect(option.flagValue.length).toBeGreaterThan(0);
      }
    }
  });

  it('branches a later narrative on that flag, with a default for every unset case', () => {
    const flagKeys = new Set(
      story.chapters
        .flatMap((chapter) => chapter.scenes)
        .filter((scene) => scene.kind === 'CHOICE')
        .map((scene) => (scene.kind === 'CHOICE' ? scene.flagKey : '')),
    );
    const branched = story.chapters
      .flatMap((chapter) => chapter.scenes)
      .filter((scene) => scene.kind === 'NARRATIVE' && scene.branches);
    expect(branched.length).toBeGreaterThan(0);
    for (const scene of branched) {
      if (scene.kind !== 'NARRATIVE' || !scene.branches) throw new Error('Expected branches.');
      const values = new Set<string>();
      for (const branch of scene.branches) {
        expect(flagKeys).toContain(branch.when.flagKey);
        expect(resolveNarrativeText(scene, { [branch.when.flagKey]: branch.when.equals })).toBe(
          branch.text,
        );
        values.add(branch.when.equals);
      }
      expect(values.size).toBe(scene.branches.length);
      expect(resolveNarrativeText(scene, {})).toBe(scene.text);
    }
  });

  it('offers a branch for every option of the choice that sets the flag', () => {
    const choice = story.chapters
      .flatMap((chapter) => chapter.scenes)
      .find((scene) => scene.kind === 'CHOICE');
    if (choice?.kind !== 'CHOICE') throw new Error('Expected a choice scene.');
    const branchedValues = new Set(
      story.chapters
        .flatMap((chapter) => chapter.scenes)
        .filter((scene) => scene.kind === 'NARRATIVE')
        .flatMap((scene) => (scene.kind === 'NARRATIVE' ? (scene.branches ?? []) : []))
        .filter((branch) => branch.when.flagKey === choice.flagKey)
        .map((branch) => branch.when.equals),
    );
    for (const option of choice.options) {
      expect(branchedValues).toContain(option.flagValue);
    }
  });

  it('ends on a reflection, not a graded challenge', () => {
    const finalChapter = story.chapters.find((chapter) => !chapter.nextChapterId);
    const lastScene = finalChapter?.scenes[finalChapter.scenes.length - 1];
    expect(lastScene?.kind).toBe('REFLECTION');
  });

  it('only cites learning objective codes that exist', () => {
    const codes = new Set(LEARNING_OBJECTIVES.map((objective) => objective.code));
    for (const chapter of story.chapters) {
      for (const scene of chapter.scenes) {
        if (scene.kind !== 'REFLECTION') continue;
        for (const objectiveId of scene.objectiveIds) {
          expect(codes).toContain(objectiveId);
        }
      }
    }
  });

  it('records its own completion world change at its own pseudo-location', () => {
    expect(story.completionWorldChange.changeType).toBe('STORY_COMPLETED');
    expect(story.completionWorldChange.changeKey.length).toBeGreaterThan(0);
    expect(story.completionWorldChange.locationSlug.length).toBeGreaterThan(0);
  });
});

describe('the story registry', () => {
  it('has one distinct slug per arc', () => {
    const slugs = STORY_DEFINITIONS.map((story) => story.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('gives every arc a unique completion change key, so world changes never collide', () => {
    const keys = STORY_DEFINITIONS.map((story) => story.completionWorldChange.changeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every age band across the library', () => {
    const bands = new Set(STORY_DEFINITIONS.flatMap((story) => story.supportedAgeBands));
    expect(bands).toContain('SPROUT');
    expect(bands).toContain('PATHFINDER');
    expect(bands).toContain('EXPLORER');
  });
});
