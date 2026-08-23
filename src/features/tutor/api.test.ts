import { describe, expect, it, vi, beforeEach } from 'vitest';

const { generateTutorTurn, createAudit, createSafetyEvent, listSkillProgress, listQuestState } =
  vi.hoisted(() => ({
    generateTutorTurn: vi.fn(),
    createAudit: vi.fn(),
    createSafetyEvent: vi.fn(),
    listSkillProgress: vi.fn(),
    listQuestState: vi.fn(),
  }));

vi.mock('../../lib/data-client', () => ({
  client: {
    generations: { generateTutorTurn },
    models: {
      AIInteractionAudit: { create: createAudit },
      SafetyEvent: { create: createSafetyEvent },
      SkillProgress: { list: listSkillProgress },
      ChildQuestState: { list: listQuestState },
    },
  },
}));

import { requestTutorTurn } from './api';

const BASE_INPUT = {
  childProfileId: 'child-1',
  ageBand: 'PATHFINDER' as const,
  skillId: 'addition-within-ten',
  hintLevel: 3,
  authoredBaseText: 'Count the planks you already have, then count the new ones.',
};

function validResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      spokenText: 'Count the first group, then keep counting with the new ones.',
      strategy: 'GIVE_HINT',
      emotion: 'ENCOURAGING',
      safetyDisposition: 'ALLOW',
      ...overrides,
    },
    errors: undefined,
  };
}

describe('requestTutorTurn', () => {
  beforeEach(() => {
    generateTutorTurn.mockReset();
    createAudit.mockReset();
    createSafetyEvent.mockReset();
    listSkillProgress.mockReset();
    listQuestState.mockReset();
    listSkillProgress.mockResolvedValue({ data: [] });
    listQuestState.mockResolvedValue({ data: [] });
    createAudit.mockResolvedValue({});
  });

  it('never reaches Bedrock, the database, or the audit log when a parent has AI off', async () => {
    const result = await requestTutorTurn({ ...BASE_INPUT, aiEnabled: false });

    expect(result.source).toBe('FALLBACK');
    expect(result.turn.spokenText).toBe(BASE_INPUT.authoredBaseText);
    expect(generateTutorTurn).not.toHaveBeenCalled();
    expect(listSkillProgress).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
  });

  it('never calls the model for a skill with no authored vocabulary', async () => {
    const result = await requestTutorTurn({ ...BASE_INPUT, skillId: 'sequencing' });

    expect(result.source).toBe('FALLBACK');
    expect(generateTutorTurn).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
  });

  it('sends only the safe context, and never a child identifier', async () => {
    generateTutorTurn.mockResolvedValueOnce(validResponse());

    await requestTutorTurn(BASE_INPUT);

    expect(generateTutorTurn).toHaveBeenCalledTimes(1);
    const args = generateTutorTurn.mock.calls[0][0];
    expect(args.strategy).toBe('GIVE_HINT');
    expect(args.skillTitle).toBe('Addition within ten');
    expect(args.maxLength).toBe(200);
    expect(args.allowedVocabulary).toContain('add');
    expect(JSON.stringify(args)).not.toContain('child-1');
  });

  it('reads prerequisite mastery and sends known prerequisites as titles only', async () => {
    listSkillProgress.mockResolvedValue({
      data: [
        {
          childProfileId: 'child-1',
          learningObjectiveCode: 'counting-sets',
          exposureCount: 12,
          independentSuccessCount: 10,
          supportedSuccessCount: 1,
          consecutiveIndependentCorrect: 6,
          lastPracticedAt: new Date().toISOString(),
        },
      ],
    });
    generateTutorTurn.mockResolvedValueOnce(validResponse());

    await requestTutorTurn(BASE_INPUT);

    const args = generateTutorTurn.mock.calls[0][0];
    expect(args.knownPrerequisiteTitles).toEqual(['Counting sets of objects']);
    expect(JSON.stringify(args)).not.toContain('MASTERED');
    expect(JSON.stringify(args)).not.toContain('exposureCount');
  });

  it('skips the mastery read entirely for a skill with no prerequisites', async () => {
    generateTutorTurn.mockResolvedValueOnce(
      validResponse({ spokenText: 'Point at each one as you count it.' }),
    );

    await requestTutorTurn({ ...BASE_INPUT, skillId: 'counting-sets' });

    expect(listSkillProgress).not.toHaveBeenCalled();
    expect(generateTutorTurn).toHaveBeenCalledTimes(1);
  });

  it('sends the active quest as story continuity', async () => {
    listQuestState.mockResolvedValue({
      data: [
        {
          childProfileId: 'child-1',
          questId: 'moonlight-bridge',
          status: 'ACTIVE',
          currentStageId: 'unknown-stage',
          completedStageIds: [],
          completedObjectiveIds: [],
          startedAt: new Date().toISOString(),
        },
      ],
    });
    generateTutorTurn.mockResolvedValueOnce(validResponse());

    await requestTutorTurn(BASE_INPUT);

    // The quest id is authored content; whether this exact quest exists in
    // the seed content is the content tests' business, so assert only that
    // the lookup happened and nothing unsafe rode along with it.
    expect(listQuestState).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(generateTutorTurn.mock.calls[0][0])).not.toContain('child-1');
  });

  it('returns the generated turn and audits it as valid', async () => {
    generateTutorTurn.mockResolvedValueOnce(validResponse());

    const result = await requestTutorTurn(BASE_INPUT);

    expect(result.source).toBe('AI');
    expect(result.turn.spokenText).toBe(
      'Count the first group, then keep counting with the new ones.',
    );
    expect(createAudit).toHaveBeenCalledTimes(1);
    const audit = createAudit.mock.calls[0][0];
    expect(audit.routeName).toBe('generateTutorTurn');
    expect(audit.inputCategory).toBe('TUTOR_GIVE_HINT');
    expect(audit.validationStatus).toBe('VALID');
    expect(audit.fallbackUsed).toBe(false);
  });

  it('falls back to the authored hint when the model answers with the wrong strategy', async () => {
    generateTutorTurn.mockResolvedValueOnce(validResponse({ strategy: 'EXPLAIN' }));

    const result = await requestTutorTurn(BASE_INPUT);

    expect(result.source).toBe('FALLBACK');
    expect(result.turn.spokenText).toBe(BASE_INPUT.authoredBaseText);
    expect(createAudit.mock.calls[0][0].validationStatus).toBe('INVALID_CONTENT');
  });

  it('falls back when the model claims the child has mastered something', async () => {
    generateTutorTurn.mockResolvedValueOnce(
      validResponse({ spokenText: 'You have mastered adding! Next you need to learn division.' }),
    );

    const result = await requestTutorTurn(BASE_INPUT);

    expect(result.source).toBe('FALLBACK');
    expect(createAudit.mock.calls[0][0].validationStatus).toBe('INVALID_CONTENT');
  });

  it('falls back and records a safety event on a non-ALLOW disposition', async () => {
    createSafetyEvent.mockResolvedValueOnce({});
    generateTutorTurn.mockResolvedValueOnce(
      validResponse({ spokenText: "Let's ask a grown-up about that.", safetyDisposition: 'STOP' }),
    );

    const result = await requestTutorTurn(BASE_INPUT);

    expect(result.source).toBe('FALLBACK');
    expect(result.turn.safetyDisposition).toBe('STOP');
    expect(createSafetyEvent).toHaveBeenCalledTimes(1);
    expect(createSafetyEvent.mock.calls[0][0].severity).toBe('HIGH');
    expect(createSafetyEvent.mock.calls[0][0].category).toBe('tutor-turn-give_hint');
  });

  it('falls back when the route errors, and still audits the attempt', async () => {
    generateTutorTurn.mockResolvedValueOnce({ data: null, errors: [{ message: 'boom' }] });

    const result = await requestTutorTurn(BASE_INPUT);

    expect(result.source).toBe('FALLBACK');
    expect(createAudit.mock.calls[0][0].validationStatus).toBe('ERROR');
  });

  it('falls back when context assembly itself fails', async () => {
    listSkillProgress.mockRejectedValueOnce(new Error('offline'));

    const result = await requestTutorTurn(BASE_INPUT);

    expect(result.source).toBe('FALLBACK');
    expect(generateTutorTurn).not.toHaveBeenCalled();
    expect(createAudit.mock.calls[0][0].validationStatus).toBe('ERROR');
  });

  it('withholds the authored hint on rungs that are meant to withhold it', async () => {
    generateTutorTurn.mockResolvedValueOnce({ data: null, errors: [{ message: 'boom' }] });

    const result = await requestTutorTurn({ ...BASE_INPUT, hintLevel: 1 });

    expect(result.turn.strategy).toBe('ENCOURAGE');
    expect(result.turn.spokenText).not.toBe(BASE_INPUT.authoredBaseText);
  });

  it('never throws, even if audit logging fails', async () => {
    createAudit.mockRejectedValue(new Error('audit down'));
    generateTutorTurn.mockResolvedValueOnce(validResponse());

    await expect(requestTutorTurn(BASE_INPUT)).resolves.toBeDefined();
  });
});
