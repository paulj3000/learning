import { describe, expect, it } from 'vitest';
import type { MasterySummary } from '../mastery/types';
import { buildTutorContext, isTutorableSkill } from './context';

const PATHFINDER = 'PATHFINDER' as const;

describe('isTutorableSkill', () => {
  it('accepts a curriculum skill with authored vocabulary', () => {
    expect(isTutorableSkill('addition-within-ten')).toBe(true);
  });

  it('rejects a skill the curriculum graph has never heard of', () => {
    expect(isTutorableSkill('vocabulary')).toBe(false);
  });
});

describe('buildTutorContext', () => {
  it('returns undefined rather than an unbounded context for an untutorable skill', () => {
    expect(
      buildTutorContext({ ageBand: PATHFINDER, skillId: 'sequencing', hintLevel: 3 }),
    ).toBeUndefined();
  });

  it('assembles the skill, its vocabulary, the quest, and the ladder rung', () => {
    const context = buildTutorContext({
      ageBand: PATHFINDER,
      skillId: 'addition-within-ten',
      hintLevel: 3,
      questTitle: 'The Moonlight Bridge',
      questStageTitle: 'Count the planks',
      authoredBaseText: 'Count the planks you already have.',
    });

    expect(context).toBeDefined();
    expect(context?.skillTitle).toBe('Addition within ten');
    expect(context?.strategy).toBe('GIVE_HINT');
    expect(context?.hintLevel).toBe(3);
    expect(context?.maxLength).toBe(200);
    expect(context?.questTitle).toBe('The Moonlight Bridge');
    expect(context?.questStageTitle).toBe('Count the planks');
    expect(context?.authoredBaseText).toBe('Count the planks you already have.');
    expect(context?.allowedVocabulary).toContain('add');
    expect(context?.allowedRepresentations).toContain('numeric');
  });

  it('lists only prerequisites the child has actually reached proficiency on', () => {
    const developing: MasterySummary[] = [{ skillId: 'counting-sets', status: 'DEVELOPING' }];
    const proficient: MasterySummary[] = [{ skillId: 'counting-sets', status: 'PROFICIENT' }];

    expect(
      buildTutorContext({
        ageBand: PATHFINDER,
        skillId: 'addition-within-ten',
        hintLevel: 1,
        masterySummaries: developing,
      })?.knownPrerequisiteTitles,
    ).toEqual([]);

    expect(
      buildTutorContext({
        ageBand: PATHFINDER,
        skillId: 'addition-within-ten',
        hintLevel: 1,
        masterySummaries: proficient,
      })?.knownPrerequisiteTitles,
    ).toEqual(['Counting sets of objects']);
  });

  it('treats an unpractised prerequisite as unknown rather than assumed', () => {
    expect(
      buildTutorContext({
        ageBand: PATHFINDER,
        skillId: 'addition-within-ten',
        hintLevel: 1,
        masterySummaries: [],
      })?.knownPrerequisiteTitles,
    ).toEqual([]);
  });

  it('carries no mastery statuses, counts, or child identifiers on the wire', () => {
    // The roadmap's "not a full child profile or history" deliverable,
    // asserted against the serialized context rather than against the type,
    // so a future field added to `TutorContext` has to pass this too.
    const context = buildTutorContext({
      ageBand: PATHFINDER,
      skillId: 'addition-within-ten',
      hintLevel: 4,
      masterySummaries: [{ skillId: 'counting-sets', status: 'MASTERED' }],
    });

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('MASTERED');
    expect(serialized).not.toContain('PROFICIENT');
    expect(Object.keys(context ?? {}).sort()).toEqual([
      'ageBand',
      'allowedRepresentations',
      'allowedVocabulary',
      'authoredBaseText',
      'hintLevel',
      'knownPrerequisiteTitles',
      'maxLength',
      'questStageTitle',
      'questTitle',
      'skillDescription',
      'skillTitle',
      'strategy',
    ]);
  });

  it('shortens the length budget for younger children', () => {
    const sprout = buildTutorContext({
      ageBand: 'SPROUT',
      skillId: 'counting-sets',
      hintLevel: 2,
    });
    const explorer = buildTutorContext({
      ageBand: 'EXPLORER',
      skillId: 'counting-sets',
      hintLevel: 2,
    });
    expect(sprout?.maxLength).toBe(120);
    expect(explorer?.maxLength).toBe(320);
  });
});
