import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AwardEntry, AwardFeed } from './types';

const getScoringAwards = vi.fn<(childId: string, after?: string) => Promise<AwardFeed>>();
vi.mock('./api', () => ({ getScoringAwards: (...args: [string, string?]) => getScoringAwards(...args) }));

const { useScoringClaims } = await import('./useScoringClaims');

function award(id: string, overrides: Partial<AwardEntry> = {}): AwardEntry {
  return {
    id,
    entryKind: 'AWARD',
    currency: 'XP',
    amount: 50,
    sourceKind: 'QUEST_COMPLETED',
    sourceRef: 'lost-map',
    scopeKey: '',
    recordedAt: '2026-11-18T10:00:00Z',
    ...overrides,
  };
}

const questClaim = {
  schema: 'lai.gameplay-event',
  version: 1,
  type: 'quest.completed',
  eventId: 'evt-quest-completed-1',
  occurredAt: '2026-11-18T10:00:00Z',
  sessionRef: null,
  realmId: 'treasure-rush',
  adventureId: 'treasure-cove',
  areaId: null,
  payload: { questId: 'lost-map' },
};

const jumpClaim = {
  ...questClaim,
  type: 'jump.challenge.completed',
  eventId: 'evt-jump-completed-1',
  payload: { challengeId: 'gap-1', routeId: 'ramp' },
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  getScoringAwards.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useScoringClaims', () => {
  it('never re-celebrates awards from before the visit and confirms a claim with the server amount', async () => {
    getScoringAwards.mockResolvedValueOnce({ awards: [award('old')], cursor: 'old', hasMore: false });
    const { result } = renderHook(() => useScoringClaims('child-1', { pollMs: 100 }));
    await flush();

    act(() => result.current.onGameplayEvent(questClaim));
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.confirmed).toEqual([]);

    getScoringAwards.mockResolvedValueOnce({ awards: [award('new', { amount: 250 })], cursor: 'new', hasMore: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(getScoringAwards).toHaveBeenLastCalledWith('child-1', 'old');
    expect(result.current.pending).toEqual([]);
    expect(result.current.confirmed.map((c) => [c.award.id, c.award.amount])).toEqual([['new', 250]]);
  });

  it('creates no pending entry for a deferred jump claim and never polls for it', async () => {
    getScoringAwards.mockResolvedValueOnce({ awards: [], cursor: 'c', hasMore: false });
    const { result } = renderHook(() => useScoringClaims('child-1', { pollMs: 100 }));
    await flush();
    act(() => result.current.onGameplayEvent(jumpClaim));
    expect(result.current.pending).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getScoringAwards).toHaveBeenCalledTimes(1);
  });

  it('does not poll while scoring is off and lets pending entries expire quietly', async () => {
    getScoringAwards.mockResolvedValueOnce({ awards: [], cursor: null, hasMore: false });
    let clock = 0;
    const now = () => clock;
    const { result } = renderHook(() => useScoringClaims('child-1', { pollMs: 1000, now }));
    await flush();
    act(() => result.current.onGameplayEvent(questClaim));
    for (let tick = 0; tick < 25; tick += 1) {
      clock += 1000;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(getScoringAwards).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toEqual([]);
    expect(result.current.confirmed).toEqual([]);
  });

  it('ignores invalid claims and never celebrates corrections', async () => {
    getScoringAwards.mockResolvedValueOnce({ awards: [], cursor: 'c', hasMore: false });
    const { result } = renderHook(() => useScoringClaims('child-1', { pollMs: 100 }));
    await flush();
    act(() => result.current.onGameplayEvent({ ...questClaim, payload: { questId: 'x', points: 9 } }));
    expect(result.current.pending).toEqual([]);

    act(() => result.current.onGameplayEvent(questClaim));
    getScoringAwards.mockResolvedValueOnce({
      awards: [award('fix', { entryKind: 'CORRECTION', amount: -50 })],
      cursor: 'fix',
      hasMore: false,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.confirmed).toEqual([]);
  });

  it('dismisses a confirmed award', async () => {
    getScoringAwards.mockResolvedValueOnce({ awards: [], cursor: 'c', hasMore: false });
    const { result } = renderHook(() => useScoringClaims('child-1', { pollMs: 100 }));
    await flush();
    act(() => result.current.onGameplayEvent(questClaim));
    getScoringAwards.mockResolvedValueOnce({ awards: [award('a')], cursor: 'a', hasMore: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    act(() => result.current.dismiss('a'));
    expect(result.current.confirmed).toEqual([]);
  });
});

describe('useScoringClaims gating', () => {
  it('makes no request and ignores claims while scoring is disabled', async () => {
    const { result } = renderHook(() => useScoringClaims('child-1', { enabled: false, pollMs: 100 }));
    await flush();
    act(() => result.current.onGameplayEvent(questClaim));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getScoringAwards).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual([]);
  });
});
