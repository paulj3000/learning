import { describe, expect, it } from 'vitest';
import { validateStoryDefinition } from './validation';
import type { StoryDefinition } from './types';

const resolveAll = () => true;
const resolveNone = () => false;

function buildStory(overrides: Partial<StoryDefinition> = {}): StoryDefinition {
  return {
    slug: 'test-story',
    title: 'Test Story',
    description: 'A test story.',
    supportedAgeBands: ['PATHFINDER'],
    entryChapterId: 'chapter-1',
    completionWorldChange: {
      changeType: 'STORY_COMPLETED',
      changeKey: 'TEST_STORY_COMPLETE',
      locationSlug: 'test-location',
    },
    chapters: [
      {
        id: 'chapter-1',
        title: 'Chapter One',
        nextChapterId: 'chapter-2',
        scenes: [{ id: 'scene-1', kind: 'NARRATIVE', speaker: 'Chatty', text: 'Hello.' }],
      },
      {
        id: 'chapter-2',
        title: 'Chapter Two',
        scenes: [
          { id: 'scene-2', kind: 'REFLECTION', prompt: 'Think about it.', objectiveIds: [] },
        ],
      },
    ],
    ...overrides,
  };
}

describe('validateStoryDefinition', () => {
  it('reports no errors for a well-formed story', () => {
    expect(validateStoryDefinition(buildStory(), resolveAll)).toEqual([]);
  });

  it('flags an entryChapterId that matches no chapter', () => {
    const story = buildStory({ entryChapterId: 'nowhere' });
    expect(validateStoryDefinition(story, resolveAll)).toContain(
      'entryChapterId "nowhere" does not match any chapter.',
    );
  });

  it('flags a nextChapterId that matches no chapter', () => {
    const story = buildStory();
    story.chapters[0]!.nextChapterId = 'ghost-chapter';
    const errors = validateStoryDefinition(story, resolveAll);
    expect(errors.some((error) => error.includes('ghost-chapter'))).toBe(true);
  });

  it('flags a chapter with no scenes', () => {
    const story = buildStory();
    story.chapters[1]!.scenes = [];
    expect(validateStoryDefinition(story, resolveAll)).toContain(
      'Chapter "chapter-2" has no scenes.',
    );
  });

  it('flags an ADVENTURE scene embedding an unknown template', () => {
    const story = buildStory();
    story.chapters[0]!.scenes = [{ id: 'scene-1', kind: 'ADVENTURE', templateSlug: 'missing' }];
    const errors = validateStoryDefinition(story, resolveNone);
    expect(errors.some((error) => error.includes('missing'))).toBe(true);
  });

  it('flags a CHOICE scene with fewer than two options', () => {
    const story = buildStory();
    story.chapters[0]!.scenes = [
      {
        id: 'scene-1',
        kind: 'CHOICE',
        prompt: 'Pick one.',
        flagKey: 'flag',
        options: [{ id: 'only-option', label: 'Only option', flagValue: 'a' }],
      },
    ];
    const errors = validateStoryDefinition(story, resolveAll);
    expect(errors.some((error) => error.includes('at least two options'))).toBe(true);
  });

  it('flags a chapter chain that never terminates', () => {
    const story = buildStory();
    story.chapters[1]!.nextChapterId = 'chapter-1';
    const errors = validateStoryDefinition(story, resolveAll);
    expect(errors).toContain(
      'Following nextChapterId from the entry chapter never reaches an ending chapter.',
    );
  });

  it('flags a chapter unreachable from the entry chapter', () => {
    const story = buildStory({
      chapters: [
        {
          id: 'chapter-1',
          title: 'Chapter One',
          scenes: [{ id: 'scene-1', kind: 'NARRATIVE', speaker: 'Chatty', text: 'Hello.' }],
        },
        {
          id: 'orphan',
          title: 'Orphan Chapter',
          scenes: [{ id: 'scene-2', kind: 'NARRATIVE', speaker: 'Chatty', text: 'Lost.' }],
        },
      ],
    });
    const errors = validateStoryDefinition(story, resolveAll);
    expect(errors).toContain('Chapter "orphan" is not reachable from entryChapterId.');
  });
});
