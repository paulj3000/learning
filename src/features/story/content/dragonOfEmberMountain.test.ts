import { describe, expect, it } from 'vitest';
import { DRAGON_OF_EMBER_MOUNTAIN } from './dragonOfEmberMountain';
import { validateStoryDefinition, resolveNarrativeText } from '../engine';
import { getAdventureTemplate } from '../../adventures/content';

const resolveAdventureTemplateSlug = (slug: string) => getAdventureTemplate(slug) !== undefined;

describe('DRAGON_OF_EMBER_MOUNTAIN', () => {
  it('is structurally valid', () => {
    expect(validateStoryDefinition(DRAGON_OF_EMBER_MOUNTAIN, resolveAdventureTemplateSlug)).toEqual(
      [],
    );
  });

  it('is scoped to Pathfinders only', () => {
    expect(DRAGON_OF_EMBER_MOUNTAIN.supportedAgeBands).toEqual(['PATHFINDER']);
  });

  it('has all five chapters from the roadmap outline, in order', () => {
    const ids = DRAGON_OF_EMBER_MOUNTAIN.chapters.map((chapter) => chapter.id);
    expect(ids).toEqual([
      'broken-path',
      'whispering-forest',
      'dragon-tracks',
      'dragons-cave',
      'save-the-dragon',
    ]);
  });

  it('has exactly one ending chapter (no nextChapterId)', () => {
    const endings = DRAGON_OF_EMBER_MOUNTAIN.chapters.filter((chapter) => !chapter.nextChapterId);
    expect(endings).toHaveLength(1);
    expect(endings[0]?.id).toBe('save-the-dragon');
  });

  it('embeds a real, resolvable adventure for every ADVENTURE scene', () => {
    for (const chapter of DRAGON_OF_EMBER_MOUNTAIN.chapters) {
      for (const scene of chapter.scenes) {
        if (scene.kind === 'ADVENTURE') {
          expect(getAdventureTemplate(scene.templateSlug)).toBeDefined();
        }
      }
    }
  });

  it('branches the dragon-revelation narrative by the trackDirection flag set in chapter 3', () => {
    const cave = DRAGON_OF_EMBER_MOUNTAIN.chapters.find((chapter) => chapter.id === 'dragons-cave');
    const scene = cave?.scenes.find((candidate) => candidate.id === 'dragon-revelation');
    if (scene?.kind !== 'NARRATIVE') {
      throw new Error('Expected dragon-revelation to be a narrative scene.');
    }
    const withNoFlag = resolveNarrativeText(scene, {});
    const withCaveFlag = resolveNarrativeText(scene, { trackDirection: 'cave' });
    const withVolcanoFlag = resolveNarrativeText(scene, { trackDirection: 'volcano' });
    expect(withCaveFlag).not.toBe(withNoFlag);
    expect(withVolcanoFlag).not.toBe(withNoFlag);
    expect(withCaveFlag).not.toBe(withVolcanoFlag);
  });

  it('sets the trackDirection flag from a bounded, curated choice (never free text)', () => {
    const tracks = DRAGON_OF_EMBER_MOUNTAIN.chapters.find(
      (chapter) => chapter.id === 'dragon-tracks',
    );
    const scene = tracks?.scenes.find((candidate) => candidate.id === 'track-direction');
    if (scene?.kind !== 'CHOICE') {
      throw new Error('Expected track-direction to be a choice scene.');
    }
    expect(scene.flagKey).toBe('trackDirection');
    expect(scene.options.length).toBeGreaterThanOrEqual(2);
  });

  it('ends chapter 4 with an empathy reflection, not a graded challenge', () => {
    const cave = DRAGON_OF_EMBER_MOUNTAIN.chapters.find((chapter) => chapter.id === 'dragons-cave');
    const lastScene = cave?.scenes[cave.scenes.length - 1];
    expect(lastScene?.kind).toBe('REFLECTION');
    if (lastScene?.kind === 'REFLECTION') {
      expect(lastScene.objectiveIds).toContain('empathy');
    }
  });
});
