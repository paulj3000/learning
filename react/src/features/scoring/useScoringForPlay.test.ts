import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enabledSummary } from './fixtures';
import type { AwardFeed, ScoringSummary } from './types';

const getScoringSummary = vi.fn<(childId: string) => Promise<ScoringSummary>>();
const getScoringAwards = vi.fn<(childId: string, after?: string) => Promise<AwardFeed>>();
vi.mock('./api', () => ({
  getScoringSummary: (childId: string) => getScoringSummary(childId),
  getScoringAwards: (...args: [string, string?]) => getScoringAwards(...args),
}));

const { useScoringForPlay } = await import('./useScoringForPlay');

const claim = {
  schema: 'lai.gameplay-event',
  version: 1,
  type: 'quest.completed',
  eventId: 'evt-quest-completed-9',
  occurredAt: '2026-11-19T10:00:00Z',
  sessionRef: null,
  realmId: 'pirate-builder-bay',
  adventureId: 'treasure-rush-cove',
  areaId: 'treasure-rush-cove',
  payload: { questId: 'pips-missing-treasure' },
};

beforeEach(() => {
  getScoringSummary.mockReset();
  getScoringAwards.mockReset();
});

describe('useScoringForPlay', () => {
  it('stays off with no feed reads and ignores claims while scoring is disabled', async () => {
    getScoringSummary.mockResolvedValue({ enabled: false, contractVersion: 1 });
    const { result } = renderHook(() => useScoringForPlay('child-1'));
    await waitFor(() => expect(getScoringSummary).toHaveBeenCalledWith('child-1'));
    act(() => result.current.onGameplayEvent(claim));
    expect(result.current.enabled).toBe(false);
    expect(result.current.pending).toEqual([]);
    expect(getScoringAwards).not.toHaveBeenCalled();
  });

  it('makes no request at all without a child', async () => {
    const { result } = renderHook(() => useScoringForPlay(undefined));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.enabled).toBe(false);
    expect(getScoringSummary).not.toHaveBeenCalled();
    expect(getScoringAwards).not.toHaveBeenCalled();
  });

  it('accepts claims as pending once Django says scoring is on', async () => {
    getScoringSummary.mockResolvedValue(enabledSummary());
    getScoringAwards.mockResolvedValue({ awards: [], cursor: 'c', hasMore: false });
    const { result } = renderHook(() => useScoringForPlay('child-1'));
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await waitFor(() => expect(getScoringAwards).toHaveBeenCalled());
    act(() => result.current.onGameplayEvent(claim));
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.confirmed).toEqual([]);
  });
});
