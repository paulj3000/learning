import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import { fakeDjangoClient, type FakeDjangoClient } from '../../test/fakeDjangoClient';

const holder = vi.hoisted(() => ({ client: null as FakeDjangoClient | null }));
vi.mock('../../api/djangoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/djangoClient')>()),
  djangoClient: () => holder.client,
}));

import {
  deleteStoryArtifact,
  getActiveSession,
  listActionsForSessions,
  listAllWorldChanges,
  listSessions,
  listStoryArtifacts,
  recordWorldChangeOnce,
  requestAdventureHint,
  resumeOrStartSession,
  saveStoryArtifact,
  submitAdventureAnswer,
} from './api';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from './content';
import { AdventureUnavailableError } from '../catalog/availabilityApi';

const SESSION = {
  id: 's1',
  adventureSlug: REPAIR_THE_MOONLIGHT_BRIDGE.slug,
  templateVersion: 1,
  status: 'ACTIVE',
  currentStepId: 'count',
  hintLevel: 0,
  startedAt: '2026-11-01T10:00:00+00:00',
  lastActivityAt: '2026-11-01T10:00:00+00:00',
  completedAt: null,
  locationSlug: 'pirate-builder-bay',
};
const START = `children/child-1/adventures/${REPAIR_THE_MOONLIGHT_BRIDGE.slug}/session/`;

let api: FakeDjangoClient;
beforeEach(() => {
  api = fakeDjangoClient();
  holder.client = api;
});

describe('resumeOrStartSession (AMP-03)', () => {
  it('asks the server to start or resume, sending no state of its own', async () => {
    api.on('POST', START, SESSION);
    const session = await resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE);
    expect(session).toMatchObject({
      id: 's1',
      childProfileId: 'child-1',
      templateSlug: REPAIR_THE_MOONLIGHT_BRIDGE.slug,
      currentStepId: 'count',
      status: 'ACTIVE',
    });
    expect(api.calls).toEqual([{ method: 'POST', path: START, body: {} }]);
  });

  it.each([
    ['taken out of play', new ApiError('conflict', { status: 409, code: 'content_unavailable' })],
    ['not in the catalog', new ApiError('not_found', { status: 404, code: 'not_found' })],
  ])('turns an adventure %s into the calm AdventureUnavailableError', async (_, error) => {
    api.on('POST', START, () => {
      throw error;
    });
    await expect(
      resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE),
    ).rejects.toBeInstanceOf(AdventureUnavailableError);
  });

  it('lets any other failure through unchanged', async () => {
    api.on('POST', START, () => {
      throw new ApiError('network');
    });
    await expect(resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE)).rejects.toThrow(
      ApiError,
    );
  });

  it('reads the active session, or null', async () => {
    api.on('GET', START, { session: null });
    expect(await getActiveSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE.slug)).toBeNull();
    api.on('GET', START, { session: SESSION });
    expect((await getActiveSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE.slug))?.id).toBe('s1');
  });
});

describe('submitAdventureAnswer (ADR-012 on Django)', () => {
  const ANSWERS = 'children/child-1/sessions/s1/answers/';

  it('sends only what the child did, with a request id, and reads the server verdict', async () => {
    api.on('POST', ANSWERS, {
      correctness: 'CORRECT',
      supportLevel: 1,
      action: 'ADVANCE',
      nextStepId: 'done',
      attemptNumber: 1,
      replayed: false,
      session: { ...SESSION, currentStepId: 'done' },
    });
    const result = await submitAdventureAnswer(
      'child-1',
      's1',
      'count',
      { kind: 'number-input', value: 3 },
      'req-1',
    );
    expect(result).toMatchObject({
      correctness: 'correct',
      supportLevel: 1,
      action: 'ADVANCE',
      nextStepId: 'done',
      session: { currentStepId: 'done' },
    });
    expect(api.calls[0]?.body).toEqual({
      stepId: 'count',
      answer: { kind: 'number-input', value: 3 },
      requestId: 'req-1',
    });
  });

  it('a retry has no next step, whatever the server echoes', async () => {
    api.on('POST', ANSWERS, {
      correctness: 'INCORRECT',
      supportLevel: 0,
      action: 'RETRY',
      nextStepId: 'ignored',
      session: SESSION,
    });
    const result = await submitAdventureAnswer('child-1', 's1', 'count', {
      kind: 'number-input',
      value: 2,
    });
    expect(result.correctness).toBe('incorrect');
    expect(result.nextStepId).toBeNull();
    expect(typeof api.calls[0]?.body?.requestId).toBe('string');
  });

  it('rejects a response that does not match the contract', async () => {
    api.on('POST', ANSWERS, { correctness: 'MAYBE', action: 'ADVANCE', session: SESSION });
    await expect(
      submitAdventureAnswer('child-1', 's1', 'count', { kind: 'number-input', value: 3 }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('asks the server for the next hint from the level the child saw', async () => {
    api.on('POST', 'children/child-1/sessions/s1/hints/', { hintLevel: 2, hintText: 'x' });
    expect(await requestAdventureHint('child-1', 's1', 'count', 1)).toBe(2);
    expect(api.calls[0]?.body).toEqual({ stepId: 'count', fromLevel: 1 });
  });
});

describe('sessions, actions and world changes', () => {
  it('lists the child sessions and their actions', async () => {
    api.on('GET', 'children/child-1/sessions/', { sessions: [SESSION] });
    api.on('GET', 'children/child-1/adventure-actions/', {
      actions: [
        {
          id: 'a1',
          sessionId: 's1',
          stepId: 'count',
          actionType: 'ANSWER',
          correctness: 'CORRECT',
          normalizedAnswer: '3',
          hintLevel: 0,
          attemptNumber: 1,
          nextStepId: 'done',
          createdAt: '2026-11-01T10:00:00+00:00',
        },
        {
          id: 'a2',
          sessionId: 'other',
          stepId: 'x',
          actionType: 'ANSWER',
          correctness: 'INCORRECT',
          normalizedAnswer: null,
          hintLevel: 0,
          attemptNumber: 1,
          nextStepId: null,
          createdAt: '2026-11-01T10:00:00+00:00',
        },
      ],
    });
    expect((await listSessions('child-1')).map((s) => s.id)).toEqual(['s1']);
    const actions = await listActionsForSessions('child-1', ['s1']);
    expect(actions.map((a) => [a.id, a.normalizedAnswer])).toEqual([['a1', '3']]);
    expect(await listActionsForSessions('child-1', [])).toEqual([]);
  });

  it('records a world change with its provenance and reads them back', async () => {
    const change = {
      id: 'w1',
      locationSlug: 'bay',
      changeType: 'REPAIR',
      changeKey: 'BRIDGE',
      sourceSessionId: 'quest:q1',
      createdAt: '2026-11-01T10:00:00+00:00',
    };
    api.on('POST', 'children/child-1/world-changes/', change);
    api.on('GET', 'children/child-1/world-changes/', { worldChanges: [change] });
    await recordWorldChangeOnce('child-1', 'bay', 'REPAIR', 'BRIDGE', 'quest:q1');
    expect(api.calls[0]?.body).toEqual({
      locationSlug: 'bay',
      changeType: 'REPAIR',
      changeKey: 'BRIDGE',
      sourceSessionId: 'quest:q1',
    });
    expect(await listAllWorldChanges('child-1')).toEqual([
      { ...change, childProfileId: 'child-1' },
    ]);
  });
});

describe('story artifacts', () => {
  const ARTIFACT = {
    id: 'st1',
    sessionId: 's1',
    templateSlug: 'tale',
    title: 'The Tale',
    scenes: [{ stepId: 'a', text: 'Once', source: 'AI' }, { bogus: true }],
    createdAt: '2026-11-01T10:00:00+00:00',
  };

  it('saves the beats against the session and drops malformed saved scenes on read', async () => {
    api.on('POST', 'children/child-1/story-artifacts/', ARTIFACT);
    api.on('GET', 'children/child-1/story-artifacts/', { artifacts: [ARTIFACT] });
    const saved = await saveStoryArtifact('child-1', 's1', [
      { stepId: 'a', text: 'Once', source: 'AI' },
    ]);
    expect(api.calls[0]?.body).toEqual({
      sessionId: 's1',
      scenes: [{ stepId: 'a', text: 'Once', source: 'AI' }],
    });
    expect(saved.scenes).toEqual([{ stepId: 'a', text: 'Once', source: 'AI' }]);
    expect((await listStoryArtifacts('child-1'))[0]?.title).toBe('The Tale');
  });

  it('deletes one story, and a story already gone counts as deleted', async () => {
    api.on('DELETE', 'children/child-1/story-artifacts/st1/', null);
    await deleteStoryArtifact('child-1', 'st1');
    await expect(deleteStoryArtifact('child-1', 'gone')).resolves.toBeUndefined();
  });
});
