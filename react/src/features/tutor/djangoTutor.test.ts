import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DjangoAiApi } from '../../api/ai/djangoAi';
import { ApiError } from '../../api/errors';

const { generateTutorTurn, createAudit, listSkillProgress, listQuestStates, current } = vi.hoisted(
  () => ({
    generateTutorTurn: vi.fn(),
    createAudit: vi.fn(),
    listSkillProgress: vi.fn(),
    listQuestStates: vi.fn(),
    current: { api: null as DjangoAiApi | null },
  }),
);

vi.mock('../../lib/data-client', () => ({
  client: {
    generations: { generateTutorTurn },
    models: { AIInteractionAudit: { create: createAudit }, SafetyEvent: { create: vi.fn() } },
  },
}));
vi.mock('../mastery/api', () => ({ listSkillProgress }));
vi.mock('../quests/api', () => ({ listQuestStates }));
vi.mock('../../api/ai/djangoAi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/ai/djangoAi')>();
  return { ...original, currentDjangoAiApi: () => current.api };
});

import { requestTutorTurn, type RequestTutorTurnInput } from './api';

const INPUT: RequestTutorTurnInput = {
  childProfileId: 'child-1',
  ageBand: 'PATHFINDER',
  skillId: 'counting-sets',
  hintLevel: 3,
  authoredBaseText: 'Try touching each gap and counting out loud.',
  templateId: 'repair-the-moonlight-bridge',
  sessionId: 'session-1',
  stepId: 'count-planks',
};

function djangoApi(result: unknown) {
  const tutorTurn = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result as Awaited<ReturnType<DjangoAiApi['tutorTurn']>>;
  });
  current.api = { companionTurn: vi.fn(), tutorTurn };
  return tutorTurn;
}

const HINT_TURN = {
  spokenText: 'Point to each gap as you count.',
  strategy: 'GIVE_HINT',
  emotion: 'ENCOURAGING',
  safetyDisposition: 'ALLOW',
};

describe('requestTutorTurn with the Django backend (LAI-0706)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current.api = null;
  });

  it('calls Django with the step context and makes no browser reads or writes', async () => {
    const call = djangoApi({ turn: HINT_TURN, source: 'AI', requestId: 'r1' });
    const result = await requestTutorTurn(INPUT);
    expect(result).toEqual({ turn: HINT_TURN, source: 'AI' });
    expect(call).toHaveBeenCalledWith('child-1', {
      skillId: 'counting-sets',
      templateId: 'repair-the-moonlight-bridge',
      hintLevel: 3,
      authoredBaseText: 'Try touching each gap and counting out loud.',
      sessionId: 'session-1',
      stepId: 'count-planks',
    });
    expect(generateTutorTurn).not.toHaveBeenCalled();
    expect(listSkillProgress).not.toHaveBeenCalled();
    expect(listQuestStates).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
  });

  it('keeps the hint ladder: a model turn with another strategy falls back', async () => {
    djangoApi({ turn: { ...HINT_TURN, strategy: 'EXPLAIN' }, source: 'AI', requestId: 'r' });
    const result = await requestTutorTurn(INPUT);
    expect(result.source).toBe('FALLBACK');
    expect(result.turn).toMatchObject({
      strategy: 'GIVE_HINT',
      spokenText: 'Try touching each gap and counting out loud.',
    });
  });

  it('keeps a server redirect even though its strategy differs', async () => {
    const redirect = {
      spokenText: "Let's save that one for a grown-up. Want to keep going with our adventure?",
      strategy: 'ENCOURAGE',
      emotion: 'CALM',
      safetyDisposition: 'REDIRECT',
    };
    djangoApi({ turn: redirect, source: 'FALLBACK', requestId: 'r' });
    expect(await requestTutorTurn(INPUT)).toEqual({ turn: redirect, source: 'FALLBACK' });
  });

  it('withholds the hint on a withholding rung when Django is unreachable', async () => {
    djangoApi(new ApiError('network'));
    const result = await requestTutorTurn({ ...INPUT, hintLevel: 1 });
    expect(result.turn.spokenText).toBe('You are working hard on this. Keep going!');
  });

  it('falls back on an unauthorized child', async () => {
    djangoApi(new ApiError('not_found', { status: 404 }));
    expect((await requestTutorTurn(INPUT)).source).toBe('FALLBACK');
  });

  it('never calls Django for an untutorable skill or with AI off', async () => {
    const call = djangoApi({ turn: HINT_TURN, source: 'AI', requestId: 'r' });
    await requestTutorTurn({ ...INPUT, skillId: 'fractions' });
    await requestTutorTurn({ ...INPUT, aiEnabled: false });
    expect(call).not.toHaveBeenCalled();
  });
});
