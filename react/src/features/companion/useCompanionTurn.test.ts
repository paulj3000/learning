import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCompanionTurn } from './useCompanionTurn';
import { requestCompanionTurn } from './api';
import type { CompanionTurnResult } from './api';

vi.mock('./api', () => ({
  requestCompanionTurn: vi.fn(),
}));

const mockedRequest = vi.mocked(requestCompanionTurn);

const baseInput = {
  childProfileId: 'child-1',
  ageBand: 'PATHFINDER' as const,
  intent: 'HINT' as const,
  stepSummary: 'counting missing planks',
};

describe('useCompanionTurn', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useCompanionTurn());
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('moves through loading to a ready AI turn', async () => {
    mockedRequest.mockResolvedValue({
      source: 'AI',
      turn: {
        spokenText: 'Count the gaps!',
        emotion: 'CURIOUS',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
      },
    });
    const { result } = renderHook(() => useCompanionTurn());

    let pending!: Promise<CompanionTurnResult | undefined>;
    act(() => {
      pending = result.current.request(baseInput);
    });
    expect(result.current.state.status).toBe('loading');

    await act(async () => {
      await pending;
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'ready',
        source: 'AI',
        turn: {
          spokenText: 'Count the gaps!',
          emotion: 'CURIOUS',
          intent: 'HINT',
          safetyDisposition: 'ALLOW',
        },
      }),
    );
  });

  it('surfaces a fallback turn as ready with source FALLBACK', async () => {
    mockedRequest.mockResolvedValue({
      source: 'FALLBACK',
      turn: {
        spokenText: 'Take a closer look. You can do this!',
        emotion: 'ENCOURAGING',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
      },
    });
    const { result } = renderHook(() => useCompanionTurn());

    await act(async () => {
      await result.current.request(baseInput);
    });

    expect(result.current.state.status).toBe('ready');
    if (result.current.state.status === 'ready') {
      expect(result.current.state.source).toBe('FALLBACK');
    }
  });

  it('moves to error state if the request unexpectedly throws', async () => {
    mockedRequest.mockRejectedValue(new Error('unexpected'));
    const { result } = renderHook(() => useCompanionTurn());

    await act(async () => {
      await result.current.request(baseInput);
    });

    expect(result.current.state).toEqual({ status: 'error' });
  });
});
