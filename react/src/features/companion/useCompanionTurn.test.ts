import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCompanionTurn } from './useCompanionTurn';
import { requestCompanionTurn } from './api';
import { setSpeechBinding } from '../../audio/speech/speechBinding';
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

describe('useCompanionTurn speech (SM-P8)', () => {
  it('hands the validated turn to the speech binding a world registered, and only then', async () => {
    const result = {
      source: 'AI' as const,
      turn: {
        spokenText: 'Count the gaps!',
        emotion: 'CURIOUS' as const,
        intent: 'HINT' as const,
        safetyDisposition: 'ALLOW' as const,
      },
      speech: { utteranceId: '8f1b7c0e-6f0e-4b9e-9d3f-0a7a1b2c3d4e', voiceProfile: 'chatty' },
    };
    mockedRequest.mockResolvedValue(result);
    const speakTurn = vi.fn(async () => undefined);
    const { result: hook } = renderHook(() => useCompanionTurn());

    await act(async () => void (await hook.current.request(baseInput)));
    expect(speakTurn).not.toHaveBeenCalled(); // no binding: nothing speaks

    const previous = setSpeechBinding({ speakTurn, speakNpcNode: vi.fn(), stop: vi.fn() });
    try {
      await act(async () => void (await hook.current.request(baseInput)));
      expect(speakTurn).toHaveBeenCalledWith(result);
    } finally {
      setSpeechBinding(previous);
    }
  });
});
