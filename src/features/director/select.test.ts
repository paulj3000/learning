import { describe, expect, it } from 'vitest';
import {
  adventureObjectiveIds,
  CONTINUITY_BONUS,
  COMPLETED_PENALTY,
  RECENT_PENALTY,
  hasSkillBasedSignal,
  nextAdventure,
  rankAdventures,
  scoreAdventure,
} from './select';
import { SKILL_NEED_WEIGHT, type DirectorContext } from './types';
import type { AdventureDefinition } from '../adventures/engine/types';

function adventure(
  slug: string,
  objectiveIds: string[],
  overrides: Partial<AdventureDefinition> = {},
): AdventureDefinition {
  return {
    slug,
    version: 1,
    title: overrides.title ?? slug,
    locationSlug: 'pirate-builder-bay',
    ageBands: ['PATHFINDER'],
    entryStepId: 'a',
    steps: [
      {
        id: 'a',
        type: 'NARRATIVE',
        objectiveIds,
        presentation: { kind: 'narrative', speaker: 'Chatty the Parrot', text: 'hello' },
        transitions: [{ when: 'always', nextStepId: 'complete' }],
        fallback: { text: 'hello' },
      },
    ],
    ...overrides,
  } as AdventureDefinition;
}

function context(overrides: Partial<DirectorContext> = {}): DirectorContext {
  return {
    masterySummaries: [],
    completedAdventureSlugs: [],
    recentAdventureSlugs: [],
    storiesInProgress: [],
    ...overrides,
  };
}

describe('adventureObjectiveIds', () => {
  it('lists each objective once however many steps practise it', () => {
    const definition = adventure('a', ['counting-sets']);
    definition.steps.push({ ...definition.steps[0], id: 'b', objectiveIds: ['counting-sets'] });
    expect(adventureObjectiveIds(definition)).toEqual(['counting-sets']);
  });
});

describe('scoreAdventure', () => {
  it('scores an adventure by the needs of the skills it practises', () => {
    const record = scoreAdventure(
      adventure('bridge', ['counting-sets', 'measurement']),
      context({
        masterySummaries: [
          { skillId: 'counting-sets', status: 'INTRODUCED' },
          { skillId: 'measurement', status: 'PROFICIENT' },
        ],
      }),
    );
    expect(record.score).toBe(SKILL_NEED_WEIGHT.INTRODUCED + SKILL_NEED_WEIGHT.PROFICIENT);
    expect(record.reasons).toContainEqual({
      kind: 'PRACTISES_SKILL',
      skillId: 'counting-sets',
      status: 'INTRODUCED',
      weight: SKILL_NEED_WEIGHT.INTRODUCED,
    });
  });

  it('records when an adventure practises nothing the child needs', () => {
    const record = scoreAdventure(adventure('a', ['counting-sets']), context());
    expect(record.score).toBe(0);
    expect(record.reasons).toEqual([{ kind: 'NO_SKILLS_NEEDED' }]);
  });

  it('rewards continuing a story the child has already begun', () => {
    const record = scoreAdventure(
      adventure('chapter-2', []),
      context({ storiesInProgress: ['dragon'] }),
      () => 'dragon',
    );
    expect(record.score).toBe(CONTINUITY_BONUS);
    expect(record.reasons).toContainEqual({ kind: 'CONTINUES_STORY', storyId: 'dragon' });
  });

  it('does not reward a story the child is not in the middle of', () => {
    const record = scoreAdventure(adventure('a', []), context(), () => 'some-other-story');
    expect(record.score).toBe(0);
  });

  /**
   * A finished adventure sinks but stays reachable. Replaying something you
   * liked is a legitimate thing for a child to want, so repetition
   * protection is a penalty rather than an exclusion.
   */
  it('penalises an adventure already completed without removing it', () => {
    const record = scoreAdventure(
      adventure('done', []),
      context({ completedAdventureSlugs: ['done'] }),
    );
    expect(record.score).toBe(-COMPLETED_PENALTY);
    expect(record.reasons).toContainEqual({
      kind: 'ALREADY_COMPLETED',
      penalty: COMPLETED_PENALTY,
    });
  });

  it('penalises only the few most recent sessions, not the whole history', () => {
    const recent = context({
      recentAdventureSlugs: ['s1', 's2', 's3', 'old'],
    });
    expect(scoreAdventure(adventure('s1', []), recent).score).toBe(-RECENT_PENALTY);
    expect(scoreAdventure(adventure('old', []), recent).score).toBe(0);
  });
});

describe('rankAdventures', () => {
  const summaries = [{ skillId: 'counting-sets', status: 'INTRODUCED' as const }];

  it('puts the adventure practising the weakest skill first', () => {
    const ranked = rankAdventures(
      [adventure('other', ['measurement']), adventure('needed', ['counting-sets'])],
      'PATHFINDER',
      context({ masterySummaries: summaries }),
    );
    expect(ranked.map((record) => record.adventureSlug)).toEqual(['needed', 'other']);
  });

  /**
   * Age band is the one hard filter, and it is the Adventure Engine's rule.
   * A skill need can never pull an adventure authored for another band in
   * front of a child (CLAUDE.md section 3).
   */
  it('never offers an adventure outside the child age band, however much it is needed', () => {
    const ranked = rankAdventures(
      [adventure('sprout-only', ['counting-sets'], { ageBands: ['SPROUT'] })],
      'PATHFINDER',
      context({ masterySummaries: summaries }),
    );
    expect(ranked).toEqual([]);
  });

  it('orders equal scores by title so the list is stable between sessions', () => {
    const ranked = rankAdventures(
      [adventure('b', [], { title: 'Bravo' }), adventure('a', [], { title: 'Alpha' })],
      'PATHFINDER',
      context(),
    );
    expect(ranked.map((record) => record.title)).toEqual(['Alpha', 'Bravo']);
  });

  it('ranks a fresh adventure above one just played, all else equal', () => {
    const ranked = rankAdventures(
      [adventure('played', ['counting-sets']), adventure('fresh', ['counting-sets'])],
      'PATHFINDER',
      context({ masterySummaries: summaries, recentAdventureSlugs: ['played'] }),
    );
    expect(ranked[0].adventureSlug).toBe('fresh');
  });
});

describe('nextAdventure', () => {
  it('returns the top-ranked adventure', () => {
    const next = nextAdventure(
      [adventure('a', []), adventure('needed', ['counting-sets'])],
      'PATHFINDER',
      context({ masterySummaries: [{ skillId: 'counting-sets', status: 'INTRODUCED' }] }),
    );
    expect(next?.adventureSlug).toBe('needed');
  });

  it('returns nothing when the band has no adventure at all', () => {
    expect(nextAdventure([], 'EXPLORER', context())).toBeUndefined();
  });
});

describe('hasSkillBasedSignal', () => {
  it('is false when nothing practises a needed skill', () => {
    const ranked = rankAdventures([adventure('a', ['counting-sets'])], 'PATHFINDER', context());
    expect(hasSkillBasedSignal(ranked)).toBe(false);
  });

  it('is true as soon as one adventure practises something needed', () => {
    const ranked = rankAdventures(
      [adventure('a', ['counting-sets'])],
      'PATHFINDER',
      context({ masterySummaries: [{ skillId: 'counting-sets', status: 'DEVELOPING' }] }),
    );
    expect(hasSkillBasedSignal(ranked)).toBe(true);
  });

  it('is false for an empty ranking', () => {
    expect(hasSkillBasedSignal([])).toBe(false);
  });
});
