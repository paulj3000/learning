import { describe, expect, it } from 'vitest';
import { pendingFromEvent } from './engineAdapter';
import { awardEntry } from './fixtures';
import { describeAward, reconcilePending, PENDING_TTL_MS } from './pendingAwards';
import { parseAwardFeed, parseScoringSummary } from './types';
import { enabledSummary } from './fixtures';

function event(type: string, payload: Record<string, unknown>, areaId: string | null = 'cove-1') {
  return {
    schema: 'lai.gameplay-event',
    version: 1,
    type,
    eventId: `evt-${type.replace(/\./g, '-')}-1`,
    occurredAt: '2026-11-18T10:00:00Z',
    sessionRef: null,
    realmId: 'treasure-rush',
    adventureId: 'adv-1',
    areaId,
    payload,
  };
}

describe('engine adapter', () => {
  it('maps claims to pending entries with no amount', () => {
    const p = pendingFromEvent(event('exploration.area.entered', { areaId: 'cove-1' }), 1000);
    expect(p).toMatchObject({ claimType: 'AWARD_CLAIM', hint: { sourceKinds: ['LOCATION_FIRST_VISIT'], sourceRef: 'cove-1' } });
    expect(JSON.stringify(p)).not.toMatch(/amount|currency/i);
    expect(pendingFromEvent(event('puzzle.completed', { puzzleId: 'runes' }))?.hint.sourceRef).toBe('cove-1/runes');
    expect(pendingFromEvent(event('adventure.completed', {}))?.hint.sourceRef).toBe('adv-1');
    expect(pendingFromEvent(event('quest.completed', { questId: 'q1' }))?.hint.sourceKinds).toEqual(['QUEST_COMPLETED']);
    expect(pendingFromEvent(event('exploration.discovery.found', { discoveryId: 'd1' }))?.hint.sourceKinds).toEqual(['SECRET_DISCOVERED']);
    expect(pendingFromEvent(event('collectible.collected', { collectibleId: 'gem', setId: null }))?.hint.sourceKinds).toEqual(['PICKUP_COLLECTED']);
    expect(pendingFromEvent(event('realm.milestone.reached', { milestoneId: 'm1' }))?.hint.sourceKinds).toEqual(['REALM_MILESTONE']);
  });

  it('shows an answer as checking, with no correctness claim', () => {
    const p = pendingFromEvent(
      event('learning.answer.submitted', { learningRef: { kind: 'ADVENTURE_STEP', stepId: 's1' }, choiceId: 'c1' }),
    );
    expect(p?.claimType).toBe('ANSWER_CHECK');
    expect(p?.hint.sourceRef).toBe('adv-1/s1');
  });

  it('creates nothing for deferred, informational or invalid events', () => {
    expect(pendingFromEvent(event('jump.challenge.completed', { challengeId: 'j', routeId: 'r' }))).toBeNull();
    expect(pendingFromEvent(event('course.completed', { courseId: 'c', goalId: 'g' }))).toBeNull();
    expect(pendingFromEvent(event('jump.alternative.used', { challengeId: 'j', routeId: 'r' }))).toBeNull();
    expect(pendingFromEvent(event('adventure.started', {}))).toBeNull();
    expect(pendingFromEvent(event('quest.step.completed', { questId: 'q', stepId: 's' }))).toBeNull();
    expect(pendingFromEvent(event('npc.interaction.completed', { npcId: 'n', interactionId: 'i' }))).toBeNull();
    expect(pendingFromEvent(event('course.checkpoint.reached', { courseId: 'c', checkpointId: 'k' }))).toBeNull();
    expect(pendingFromEvent(event('exploration.area.entered', { areaId: 'has space' }))).toBeNull();
    expect(pendingFromEvent(event('made.up.type', {}))).toBeNull();
    expect(pendingFromEvent('nope')).toBeNull();
  });
});

describe('pending reconciliation', () => {
  const pending = pendingFromEvent(event('exploration.area.entered', { areaId: 'treasure-rush-cove' }), 0)!;

  it('settles a pending entry with the server amount', () => {
    const r = reconcilePending([pending], [awardEntry()], 100);
    expect(r.pending).toEqual([]);
    expect(r.confirmed).toHaveLength(1);
    expect(r.confirmed[0]!.pendingId).toBe(pending.id);
    expect(describeAward(r.confirmed[0]!.award)).toBe('+50 XP');
  });

  it('settles on every currency from the same source', () => {
    const r = reconcilePending([pending], [awardEntry(), awardEntry({ id: 'a2', currency: 'COINS', amount: 5 })], 100);
    expect(r.pending).toEqual([]);
    expect(r.confirmed).toHaveLength(2);
  });

  it('keeps unmatched pending and drops expired ones silently', () => {
    expect(reconcilePending([pending], [], 1000).pending).toHaveLength(1);
    const r = reconcilePending([pending], [], PENDING_TTL_MS + 1);
    expect(r.pending).toEqual([]);
    expect(r.confirmed).toEqual([]);
  });

  it('never celebrates corrections, non-positive amounts or repeats', () => {
    const correction = awardEntry({ id: 'c1', entryKind: 'CORRECTION', amount: -50 });
    const zero = awardEntry({ id: 'z', amount: 0 });
    expect(reconcilePending([pending], [correction, zero], 100).confirmed).toEqual([]);
    expect(reconcilePending([], [awardEntry()], 0, new Set(['a1'])).confirmed).toEqual([]);
    expect(describeAward(correction)).toBeNull();
  });

  it('matches by suffix when only the pickup key is known', () => {
    const p = pendingFromEvent(event('collectible.collected', { collectibleId: 'gem', setId: null }), 0)!;
    const a = awardEntry({ sourceKind: 'PICKUP_COLLECTED', sourceRef: 'treasure-rush-cove/gem' });
    expect(reconcilePending([p], [a], 1).pending).toEqual([]);
  });
});

describe('validators', () => {
  it('accepts the disabled and enabled summaries', () => {
    expect(parseScoringSummary({ enabled: false, contractVersion: 1 })).toEqual({
      ok: true,
      value: { enabled: false, contractVersion: 1 },
    });
    const full = enabledSummary();
    const parsed = parseScoringSummary(JSON.parse(JSON.stringify(full)));
    expect(parsed).toEqual({ ok: true, value: full });
  });

  it('returns a typed error for bad data', () => {
    const bad = parseScoringSummary({ enabled: true, contractVersion: 1 });
    expect(bad.ok).toBe(false);
    expect(parseScoringSummary(null).ok).toBe(false);
    expect(parseAwardFeed({ awards: [{ id: 'x' }], cursor: null, hasMore: false }).ok).toBe(false);
  });

  it('parses the awards feed including corrections', () => {
    const feed = parseAwardFeed({
      awards: [awardEntry(), awardEntry({ id: 'c', entryKind: 'CORRECTION', amount: -5 })],
      cursor: 'c',
      hasMore: false,
    });
    expect(feed.ok && feed.value.awards).toHaveLength(2);
  });
});
