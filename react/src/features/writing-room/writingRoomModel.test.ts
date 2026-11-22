import { describe, expect, it } from 'vitest';
import {
  ADVENTURE_TEMPLATES,
  getAdventureTemplatesForLocation,
  LEARNING_OBJECTIVES,
} from '../adventures/content';
import {
  EXPLORER_MAX_CHARACTERS,
  EXPLORER_MIN_CHARACTERS,
  WRITING_ROOM_ENCOURAGEMENT,
  WRITING_ROOM_REFUSAL,
  WRITING_ROOM_STORIES,
} from '../adventures/content/writingRoomStories';
import {
  canFinishSentences,
  choiceSteps,
  paragraphProblem,
  partsFor,
  sentenceIsComplete,
  sentencePreview,
  textStep,
  writingStoryFor,
} from './writingRoomModel';

describe('the Writing Room stories, one per age band (CLAUDE.md section 3)', () => {
  it('resolves exactly one story for each band, never another band', () => {
    expect(writingStoryFor('SPROUT')?.slug).toBe('writing-room-picture-story');
    expect(writingStoryFor('PATHFINDER')?.slug).toBe('writing-room-sentence-story');
    expect(writingStoryFor('EXPLORER')?.slug).toBe('writing-room-own-story');
    for (const story of getAdventureTemplatesForLocation('castle-writing-room')) {
      expect(story.ageBands).toHaveLength(1);
    }
  });

  it('gives Sprouts three one-tap choices: a picture, a character and a word', () => {
    const steps = choiceSteps(writingStoryFor('SPROUT')!);
    expect(steps.map((step) => step.id)).toEqual([
      'pick-the-picture',
      'pick-the-character',
      'pick-the-word',
    ]);
    for (const step of steps) {
      expect(step.options.length).toBeGreaterThanOrEqual(2);
      expect(step.options.length).toBeLessThanOrEqual(3);
    }
    expect(textStep(writingStoryFor('SPROUT')!)).toBeUndefined();
  });

  it('gives Pathfinders word tiles for two or three sentences, and no typing', () => {
    const story = writingStoryFor('PATHFINDER')!;
    const steps = choiceSteps(story);
    expect(steps.map((step) => step.id)).toEqual(['sentence-1', 'sentence-2', 'sentence-3']);
    for (const step of steps) expect(step.options.length).toBeGreaterThanOrEqual(5);
    expect(textStep(story)).toBeUndefined();
  });

  it('gives Explorers authored starters and one typed paragraph', () => {
    const story = writingStoryFor('EXPLORER')!;
    expect(choiceSteps(story).map((step) => step.id)).toEqual(['pick-a-starter']);
    expect(textStep(story)?.id).toBe('write-the-story');
  });

  it('has a hint ladder on every choosing or writing step', () => {
    for (const story of WRITING_ROOM_STORIES) {
      for (const step of [...choiceSteps(story), ...(textStep(story) ? [textStep(story)!] : [])]) {
        expect(step.hints.length, `${story.slug}/${step.id}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('uses only real learning objectives, no arithmetic step types and no em dashes', () => {
    const codes = new Set(LEARNING_OBJECTIVES.map((objective) => objective.code));
    const copy: string[] = [...Object.values(WRITING_ROOM_ENCOURAGEMENT), WRITING_ROOM_REFUSAL];
    for (const story of WRITING_ROOM_STORIES) {
      copy.push(story.title);
      for (const step of story.steps) {
        for (const code of step.objectiveIds) expect(codes.has(code)).toBe(true);
        expect(['NUMBER_INPUT', 'CHOICE', 'ORDERING', 'MATCHING']).not.toContain(step.type);
        copy.push(step.fallback.text, ...(step.hintPolicy?.ladder ?? []));
        const p = step.presentation;
        if ('prompt' in p) copy.push(p.prompt);
        if ('text' in p) copy.push(p.text);
        if ('options' in p) copy.push(...p.options.map((option) => option.label));
      }
    }
    for (const line of copy) expect(line, line).not.toContain('—');
  });

  it('is registered with the other adventures, with unique step ids in each', () => {
    for (const story of WRITING_ROOM_STORIES) {
      expect(ADVENTURE_TEMPLATES).toContain(story);
      expect(new Set(story.steps.map((step) => step.id)).size).toBe(story.steps.length);
      expect(story.steps.at(-1)?.type).toBe('COMPLETE');
    }
  });
});

describe('sentence building (Pathfinders)', () => {
  it('capitalises the first tile and ends with a full stop, as the server does', () => {
    expect(sentencePreview(['the little fox', 'lived', 'by the sea'])).toBe(
      'The little fox lived by the sea.',
    );
    expect(sentencePreview([])).toBe('');
  });

  it('needs two tiles for a sentence and two sentences to finish', () => {
    expect(sentenceIsComplete(['a'])).toBe(false);
    expect(sentenceIsComplete(['a', 'b'])).toBe(true);
    expect(canFinishSentences(1)).toBe(false);
    expect(canFinishSentences(2)).toBe(true);
  });
});

describe('the Explorer paragraph', () => {
  it('is bounded in length, whatever the words', () => {
    expect(paragraphProblem('Too short.')).toBe('too-short');
    expect(paragraphProblem('x'.repeat(EXPLORER_MIN_CHARACTERS))).toBeNull();
    expect(paragraphProblem('x'.repeat(EXPLORER_MAX_CHARACTERS))).toBeNull();
    expect(paragraphProblem('x'.repeat(EXPLORER_MAX_CHARACTERS + 1))).toBe('too-long');
  });
});

describe('what is sent to be saved', () => {
  it('sends option ids only for Sprouts and Pathfinders, and the paragraph only for Explorers', () => {
    const picks = { 'pick-the-picture': ['picture-sea'], 'sentence-3': [] };
    expect(partsFor('SPROUT', picks, 'ignored')).toEqual([
      { stepId: 'pick-the-picture', optionIds: ['picture-sea'] },
    ]);
    expect(partsFor('PATHFINDER', picks, 'ignored')).toEqual([
      { stepId: 'pick-the-picture', optionIds: ['picture-sea'] },
    ]);
    const explorer = partsFor('EXPLORER', { 'pick-a-starter': ['starter-door'] }, 'My story');
    expect(explorer).toEqual([
      { stepId: 'pick-a-starter', optionIds: ['starter-door'] },
      { stepId: 'write-the-story', text: 'My story' },
    ]);
  });
});
