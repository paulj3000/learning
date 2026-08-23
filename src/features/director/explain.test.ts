/**
 * The selection log is adult-facing by design. These tests are the guard on
 * the "not exposed to the child" half of the Phase 28 deliverable: they
 * check the output is *addressed to an adult about content*, so an edit that
 * starts writing to the child fails here rather than in front of one.
 */
import { describe, expect, it } from 'vitest';
import { describeReason, explainRanking, explainSelection } from './explain';
import type { SelectionRecord } from './types';

const record: SelectionRecord = {
  adventureSlug: 'repair-the-moonlight-bridge',
  title: 'Repair the Moonlight Bridge',
  score: 5,
  reasons: [
    { kind: 'PRACTISES_SKILL', skillId: 'counting-sets', status: 'INTRODUCED', weight: 3 },
    { kind: 'CONTINUES_STORY', storyId: 'dragon-of-ember-mountain' },
    { kind: 'PLAYED_RECENTLY', penalty: 3 },
  ],
};

describe('describeReason', () => {
  it('describes every reason kind', () => {
    expect(describeReason({ kind: 'NO_SKILLS_NEEDED' })).toMatch(/no skill/i);
    expect(describeReason({ kind: 'ALREADY_COMPLETED', penalty: 4 })).toMatch(/completed/i);
    expect(
      describeReason({ kind: 'PRACTISES_SKILL', skillId: 'x', status: 'DEVELOPING', weight: 2 }),
    ).toMatch(/developing/);
  });
});

describe('explainSelection', () => {
  it('names the adventure and the terms that moved its score', () => {
    const text = explainSelection(record);
    expect(text).toContain('Repair the Moonlight Bridge');
    expect(text).toContain('score 5');
    expect(text).toContain('counting-sets');
  });

  /**
   * The rule this whole module exists under. Selection reasoning is written
   * about content for an adult, never to a child about themselves: a line
   * saying "you are still developing counting" is precisely the remediation
   * framing CLAUDE.md pillar 7 and section 3 forbid.
   */
  it('never addresses the child or labels them', () => {
    const text = explainSelection(record).toLowerCase();
    for (const forbidden of [' you ', 'you are', 'your ', 'struggling', 'behind', 'weak at']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('explains a whole ranking in order', () => {
    const lines = explainRanking([record, { ...record, title: 'Second', score: 1 }]);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Second');
  });
});
