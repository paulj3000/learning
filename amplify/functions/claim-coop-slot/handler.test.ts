import { describe, expect, it } from 'vitest';
import { decideClaim, type CoopSessionItem } from './handler';

function coopSession(overrides: Partial<CoopSessionItem> = {}): CoopSessionItem {
  return {
    id: 'coop-1',
    hostParentProfileId: 'parent-sub-1',
    templateSlug: 'repair-the-moonlight-bridge',
    templateVersion: 1,
    participantChildProfileIds: ['child-a', 'child-b'],
    status: 'ACTIVE',
    sharedState: { slots: {}, presence: [] },
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('decideClaim', () => {
  it('rejects a caller whose sub does not match the session host', () => {
    const decision = decideClaim(coopSession(), 'someone-else-sub', 'child-a', 'count-planks');
    expect(decision).toEqual({ outcome: 'not-host' });
  });

  it('rejects a childProfileId that is not a participant', () => {
    const decision = decideClaim(coopSession(), 'parent-sub-1', 'child-z', 'count-planks');
    expect(decision).toEqual({ outcome: 'not-participant' });
  });

  it('rejects a claim against a non-active session', () => {
    const decision = decideClaim(
      coopSession({ status: 'COMPLETED' }),
      'parent-sub-1',
      'child-a',
      'count-planks',
    );
    expect(decision).toEqual({ outcome: 'inactive' });
  });

  it('allows the claim when the slot is open', () => {
    const decision = decideClaim(coopSession(), 'parent-sub-1', 'child-a', 'count-planks');
    expect(decision).toEqual({ outcome: 'claim' });
  });

  it('treats a re-claim by the same child who already holds the slot as idempotent', () => {
    const session = coopSession({
      sharedState: { slots: { 'count-planks': 'child-a' }, presence: [] },
    });
    const decision = decideClaim(session, 'parent-sub-1', 'child-a', 'count-planks');
    expect(decision).toEqual({ outcome: 'already-claimed-by-caller' });
  });

  it('rejects a second child claiming a slot the first child already filled, without treating it as their own', () => {
    const session = coopSession({
      sharedState: { slots: { 'count-planks': 'child-a' }, presence: [] },
    });
    const decision = decideClaim(session, 'parent-sub-1', 'child-b', 'count-planks');
    expect(decision).toEqual({ outcome: 'rejected' });
  });

  it('allows a different, still-open slot to be claimed even after another slot is filled', () => {
    const session = coopSession({
      sharedState: { slots: { 'count-planks': 'child-a' }, presence: [] },
    });
    const decision = decideClaim(session, 'parent-sub-1', 'child-b', 'order-planks');
    expect(decision).toEqual({ outcome: 'claim' });
  });

  it('treats a session with no sharedState yet as having every slot open', () => {
    const session = coopSession({ sharedState: null });
    const decision = decideClaim(session, 'parent-sub-1', 'child-a', 'count-planks');
    expect(decision).toEqual({ outcome: 'claim' });
  });
});
