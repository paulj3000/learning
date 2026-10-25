import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '../../api/errors';
import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import type { PlayApi } from '../../api/play/playApi';
import type { RegionBootstrap } from '../../api/play/types';
import {
  CHILD_A,
  CHILD_B,
  bootstrapJson,
  challengeJson,
  outcomeJson,
  progressJson,
  questJson,
  sessionJson,
} from '../../test/playFixtures';
import { usePlayerProgress } from './usePlayerProgress';
import { useRegionPlay } from './useRegionPlay';

const REGION = 'treasure-rush-cove';
const bootstrap = (overrides = {}, chest = {}) => read(bootstrapJson(overrides, chest), parse.regionBootstrap);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A fake API per child. Every method is a mock; defaults answer like the server would. */
function fakeApi(overrides: Partial<PlayApi> = {}): PlayApi {
  return {
    getRegion: vi.fn(async () => bootstrap()),
    startSession: vi.fn(async () => ({ value: read(sessionJson(), parse.session), created: true })),
    getSession: vi.fn(async () => read(sessionJson(), parse.session)),
    changeSession: vi.fn(async (_id, action) =>
      read(sessionJson({ status: action === 'pause' ? 'PAUSED' : 'ACTIVE' }), parse.session),
    ),
    acceptQuest: vi.fn(async () => ({
      value: read(questJson({ status: 'ACTIVE', currentStageId: 'open-the-chest' }), parse.quest),
      created: true,
    })),
    requestChestChallenge: vi.fn(async () => ({ value: read(challengeJson(), parse.issuedChallenge), created: true })),
    submitAnswer: vi.fn(async () => read(outcomeJson(true), parse.answerOutcome)),
    getProgress: vi.fn(async () => read(progressJson(), parse.playerProgress)),
    ...overrides,
  };
}

async function readyHook(api: PlayApi, options: { onUnauthenticated?: () => void } = {}) {
  const createApi = vi.fn(() => api);
  const hook = renderHook(({ child }) => useRegionPlay(child, REGION, { createApi, ...options }), {
    initialProps: { child: CHILD_A },
  });
  await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
  return hook;
}

async function inSession(api: PlayApi) {
  const hook = await readyHook(api);
  await act(() => hook.result.current.startSession());
  await act(() => hook.result.current.requestChallenge('cove-chest'));
  return hook;
}

describe('useRegionPlay', () => {
  it('loads the region for the selected child', async () => {
    const api = fakeApi();
    const createApi = vi.fn(() => api);
    const { result } = renderHook(() => useRegionPlay(CHILD_A, REGION, { createApi }));
    expect(result.current.state.status).toBe('loading');
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(createApi).toHaveBeenCalledWith(CHILD_A);
    expect(api.getRegion).toHaveBeenCalledWith(REGION, expect.any(AbortSignal));
    expect(result.current.state.bootstrap?.chests[0].entityId).toBe('cove-chest');
  });

  it('never shows a slow reply for the previous child', async () => {
    const slowA = deferred<RegionBootstrap>();
    const apiA = fakeApi({ getRegion: vi.fn(() => slowA.promise) });
    const apiB = fakeApi({ getRegion: vi.fn(async () => bootstrap({}, { entityId: 'b-chest' })) });
    const createApi = (child: string) => (child === CHILD_A ? apiA : apiB);
    const hook = renderHook(({ child }) => useRegionPlay(child, REGION, { createApi }), {
      initialProps: { child: CHILD_A },
    });
    hook.rerender({ child: CHILD_B });
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    const signal = vi.mocked(apiA.getRegion).mock.calls[0][1];
    expect(signal?.aborted).toBe(true);
    await act(async () => slowA.resolve(bootstrap({}, { entityId: 'a-chest' })));
    expect(hook.result.current.state.bootstrap?.chests[0].entityId).toBe('b-chest');
  });

  it('starts a session without accepting a quest', async () => {
    const api = fakeApi();
    const { result } = await readyHook(api);
    await act(() => result.current.startSession());
    expect(result.current.state.session?.status).toBe('ACTIVE');
    expect(api.acceptQuest).not.toHaveBeenCalled();
  });

  it('accepts a quest when the child chooses to', async () => {
    const api = fakeApi();
    const { result } = await readyHook(api);
    await act(() => result.current.acceptQuest('treasure-rush-cove'));
    expect(api.acceptQuest).toHaveBeenCalledWith('treasure-rush-cove', expect.any(AbortSignal));
    expect(result.current.state.bootstrap?.quests[0].status).toBe('ACTIVE');
  });

  it('pauses and resumes through the server', async () => {
    const api = fakeApi();
    const { result } = await readyHook(api);
    await act(() => result.current.startSession());
    await act(() => result.current.changeSession('pause'));
    expect(result.current.state.session?.status).toBe('PAUSED');
    await act(() => result.current.changeSession('resume'));
    expect(result.current.state.session?.status).toBe('ACTIVE');
    expect(vi.mocked(api.changeSession).mock.calls.map((call) => call[1])).toEqual(['pause', 'resume']);
  });

  it('asks for a challenge only inside a session', async () => {
    const api = fakeApi();
    const { result } = await readyHook(api);
    await act(() => result.current.requestChallenge('cove-chest'));
    expect(api.requestChestChallenge).not.toHaveBeenCalled();
    await act(() => result.current.startSession());
    await act(() => result.current.requestChallenge('cove-chest'));
    expect(result.current.state.challenge?.challenge.choices).toEqual([3, 4, 5, 6]);
  });

  it('shows the server’s reward and then re-reads the region', async () => {
    const api = fakeApi();
    const { result } = await inSession(api);
    vi.mocked(api.getRegion).mockResolvedValueOnce(bootstrap({ session: sessionJson() }, { isOpen: true }));
    await act(() => result.current.submitAnswer({ answer: 5, hintLevel: 1 }));
    expect(api.submitAnswer).toHaveBeenCalledWith(
      'b0e9aa11-0000-4000-8000-000000000002',
      { answer: 5, hintLevel: 1 },
      expect.any(AbortSignal),
    );
    expect(result.current.state.rewards.map((item) => item.itemId)).toEqual(['golden-doubloon']);
    expect(result.current.state.lastOutcome?.questUpdates[0].justCompleted).toBe(true);
    expect(result.current.state.challenge).toBeNull();
    expect(result.current.state.bootstrap?.chests[0].isOpen).toBe(true); // from the server
  });

  it('shows no reward for a wrong answer', async () => {
    const api = fakeApi({ submitAnswer: vi.fn(async () => read(outcomeJson(false), parse.answerOutcome)) });
    const { result } = await inSession(api);
    await act(() => result.current.submitAnswer({ answer: 4 }));
    expect(result.current.state.lastOutcome?.feedback).toBe('TRY_AGAIN');
    expect(result.current.state.rewards).toEqual([]);
  });

  it('sends a double-tapped answer once', async () => {
    const pending = deferred<ReturnType<typeof read>>();
    const api = fakeApi({ submitAnswer: vi.fn(() => pending.promise as never) });
    const { result } = await inSession(api);
    await act(async () => {
      void result.current.submitAnswer({ answer: 5 });
      void result.current.submitAnswer({ answer: 5 });
    });
    expect(api.submitAnswer).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(read(outcomeJson(true), parse.answerOutcome)));
  });

  it('adds no reward on a replayed answer and re-reads the truth instead', async () => {
    const api = fakeApi({
      submitAnswer: vi.fn(async () => {
        throw new ApiError('conflict', { status: 409, code: 'attempt_already_answered' });
      }),
    });
    const { result } = await inSession(api);
    const readsBefore = vi.mocked(api.getRegion).mock.calls.length;
    await act(() => result.current.submitAnswer({ answer: 5 }));
    await waitFor(() => expect(vi.mocked(api.getRegion).mock.calls.length).toBe(readsBefore + 1));
    expect(result.current.state.rewards).toEqual([]);
    expect(result.current.state.challenge).toBeNull();
    expect(result.current.state.error?.code).toBe('attempt_already_answered');
  });

  it('hands an expired sign-in to the app', async () => {
    const onUnauthenticated = vi.fn();
    const api = fakeApi({
      startSession: vi.fn(async () => {
        throw new ApiError('unauthenticated', { status: 401 });
      }),
    });
    const { result } = await readyHook(api, { onUnauthenticated });
    await act(() => result.current.startSession());
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(result.current.state.error?.kind).toBe('unauthenticated');
  });

  it('does not sign anyone out when authentication is only unavailable', async () => {
    const onUnauthenticated = vi.fn();
    const api = fakeApi({
      getRegion: vi.fn(async () => {
        throw new ApiError('unavailable', { status: 503, code: 'authentication_unavailable' });
      }),
    });
    const { result } = renderHook(() =>
      useRegionPlay(CHILD_A, REGION, { createApi: () => api, onUnauthenticated }),
    );
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state.error?.retryable).toBe(true);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('reports retired or foreign content as not found', async () => {
    const api = fakeApi({
      getRegion: vi.fn(async () => {
        throw new ApiError('not_found', { status: 404 });
      }),
    });
    const { result } = renderHook(() => useRegionPlay(CHILD_A, REGION, { createApi: () => api }));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state.error?.kind).toBe('not_found');
  });
});

describe('usePlayerProgress', () => {
  it('reads progress for the selected child and drops a late reply for the previous one', async () => {
    const slowA = deferred<ReturnType<PlayApi['getProgress']> extends Promise<infer T> ? T : never>();
    const apiA = fakeApi({ getProgress: vi.fn(() => slowA.promise) });
    const apiB = fakeApi();
    const createApi = (child: string) => (child === CHILD_A ? apiA : apiB);
    const hook = renderHook(({ child }) => usePlayerProgress(child, { createApi }), {
      initialProps: { child: CHILD_A },
    });
    hook.rerender({ child: CHILD_B });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    const lateA = read({ ...progressJson(), inventory: [] }, parse.playerProgress);
    await act(async () => slowA.resolve(lateA));
    expect(hook.result.current.progress?.inventory).toHaveLength(1); // still child B's
  });
});
