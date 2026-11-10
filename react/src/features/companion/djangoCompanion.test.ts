import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanionTurnBody, DjangoAiApi } from '../../api/ai/djangoAi';
import { ApiError } from '../../api/errors';

const { generateCompanionTurn, createAudit, createSafetyEvent, current } = vi.hoisted(() => ({
  generateCompanionTurn: vi.fn(),
  createAudit: vi.fn(),
  createSafetyEvent: vi.fn(),
  current: { api: null as DjangoAiApi | null },
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    generations: { generateCompanionTurn },
    models: {
      AIInteractionAudit: { create: createAudit },
      SafetyEvent: { create: createSafetyEvent },
    },
  },
}));

vi.mock('../../api/ai/djangoAi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/ai/djangoAi')>();
  return { ...original, currentDjangoAiApi: () => current.api };
});

import { requestCompanionTurn, type RequestCompanionTurnInput } from './api';

const INPUT: RequestCompanionTurnInput = {
  childProfileId: 'child-1',
  ageBand: 'PATHFINDER',
  intent: 'HINT',
  stepSummary: 'counting missing planks',
  authoredBaseText: 'Count the gaps.',
  templateId: 'repair-the-moonlight-bridge',
  sessionId: 'session-1',
  stepId: 'count-planks',
  learningObjectiveCode: 'counting-sets',
  hintLevel: 2,
};

function djangoApi(result: unknown) {
  const companionTurn = vi.fn(async (_childId: string, _body: CompanionTurnBody) => {
    if (result instanceof Error) throw result;
    return result as Awaited<ReturnType<DjangoAiApi['companionTurn']>>;
  });
  current.api = { companionTurn, tutorTurn: vi.fn() };
  return companionTurn;
}

describe('requestCompanionTurn with the Django backend (LAI-0706)', () => {
  beforeEach(() => {
    generateCompanionTurn.mockReset();
    createAudit.mockReset();
    createSafetyEvent.mockReset();
    current.api = null;
  });

  it('calls Django, never the Amplify route, and writes no browser audit', async () => {
    const call = djangoApi({
      turn: {
        spokenText: 'Count each gap!',
        emotion: 'CALM',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
      },
      source: 'AI',
      requestId: 'r1',
    });
    const result = await requestCompanionTurn(INPUT);
    expect(result).toEqual({
      turn: {
        spokenText: 'Count each gap!',
        emotion: 'CALM',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
      },
      source: 'AI',
    });
    expect(call).toHaveBeenCalledWith('child-1', {
      intent: 'HINT',
      templateId: 'repair-the-moonlight-bridge',
      stepSummary: 'counting missing planks',
      authoredBaseText: 'Count the gaps.',
      learningObjectiveCode: 'counting-sets',
      hintLevel: 2,
      allowedChoiceIds: undefined,
      sessionId: 'session-1',
      stepId: 'count-planks',
    });
    expect(generateCompanionTurn).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
    expect(createSafetyEvent).not.toHaveBeenCalled();
  });

  it('never sends the age band, a length limit, or a prompt', async () => {
    const call = djangoApi({ turn: {}, source: 'FALLBACK', requestId: null });
    await requestCompanionTurn(INPUT);
    const body = call.mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['ageBand']));
    expect(body).not.toHaveProperty('maxLength');
    expect(body).not.toHaveProperty('systemPrompt');
  });

  it('keeps a server redirect line', async () => {
    djangoApi({
      turn: {
        spokenText:
          "Let's save that for a grown-up to help with. Want to keep exploring the island?",
        emotion: 'CALM',
        intent: 'REDIRECT',
        safetyDisposition: 'REDIRECT',
      },
      source: 'FALLBACK',
      requestId: 'r2',
    });
    const result = await requestCompanionTurn(INPUT);
    expect(result.source).toBe('FALLBACK');
    expect(result.turn.intent).toBe('REDIRECT');
  });

  it.each([
    ['a network failure', new ApiError('network')],
    ['another family’s child', new ApiError('not_found', { status: 404 })],
    ['a signed-out parent', new ApiError('unauthenticated', { status: 401 })],
    ['a server error', new ApiError('server', { status: 500 })],
  ])('falls back to the authored hint on %s', async (_label, error) => {
    djangoApi(error);
    const result = await requestCompanionTurn(INPUT);
    expect(result).toEqual({
      turn: {
        spokenText: 'Count the gaps.',
        emotion: 'ENCOURAGING',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
      },
      source: 'FALLBACK',
    });
  });

  it('re-validates the turn and falls back when it is unsafe to render', async () => {
    djangoApi({
      turn: {
        spokenText: 'Visit www.parrot.io',
        emotion: 'CALM',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
      },
      source: 'AI',
      requestId: 'r3',
    });
    const result = await requestCompanionTurn(INPUT);
    expect(result.source).toBe('FALLBACK');
    expect(result.turn.spokenText).toBe('Count the gaps.');
  });

  it('does not call Django at all when the parent switched AI off', async () => {
    const call = djangoApi({ turn: {}, source: 'AI', requestId: null });
    const result = await requestCompanionTurn({ ...INPUT, aiEnabled: false });
    expect(call).not.toHaveBeenCalled();
    expect(result.source).toBe('FALLBACK');
  });

  it('uses the authored fallback, never an Amplify route, when the build has no Django API', async () => {
    const result = await requestCompanionTurn(INPUT);
    expect(result).toMatchObject({ source: 'FALLBACK', turn: { spokenText: 'Count the gaps.' } });
    expect(generateCompanionTurn).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
  });

  it('sends only the NPC and node ids for an NPC narration (DJANGO_CATALOG)', async () => {
    const call = djangoApi({
      turn: {
        spokenText: 'Ahoy, friend!',
        emotion: 'CHEERFUL',
        intent: 'NARRATE',
        safetyDisposition: 'ALLOW',
      },
      source: 'AI',
      requestId: 'r',
    });
    const result = await requestCompanionTurn({
      childProfileId: 'child-1',
      ageBand: 'PATHFINDER',
      intent: 'NARRATE',
      stepSummary: 'thanking the child for repairing the harbor bridge',
      authoredBaseText: 'You fixed my bridge!',
      templateId: 'npc:pirate-pip',
      npcNode: { npcId: 'pirate-pip', nodeId: 'pip-bridge-thanks' },
    });
    expect(call).toHaveBeenCalledWith('child-1', {
      intent: 'NARRATE',
      contextSource: 'DJANGO_CATALOG',
      npcId: 'pirate-pip',
      nodeId: 'pip-bridge-thanks',
    });
    expect(result.source).toBe('AI');
  });
});
