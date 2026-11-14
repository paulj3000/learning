import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DjangoAiApi } from '../../api/ai/djangoAi';

const { current } = vi.hoisted(() => ({ current: { api: null as DjangoAiApi | null } }));

vi.mock('../../api/ai/djangoAi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/ai/djangoAi')>();
  return { ...original, currentDjangoAiApi: () => current.api };
});

import { requestTutorTurn } from './api';

const BASE_INPUT = {
  childProfileId: 'child-1',
  ageBand: 'PATHFINDER' as const,
  skillId: 'addition-within-ten',
  hintLevel: 3,
  authoredBaseText: 'Count the planks you already have, then count the new ones.',
};

describe('requestTutorTurn (AMP-05: Django only)', () => {
  beforeEach(() => {
    current.api = null;
  });

  it('never reaches the network when a parent has AI off', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const tutorTurn = vi.fn();
    current.api = { companionTurn: vi.fn(), tutorTurn };
    const result = await requestTutorTurn({ ...BASE_INPUT, aiEnabled: false });
    expect(result.source).toBe('FALLBACK');
    expect(result.turn.spokenText).toBe(BASE_INPUT.authoredBaseText);
    expect(tutorTurn).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('never calls the model for a skill with no authored vocabulary', async () => {
    const tutorTurn = vi.fn();
    current.api = { companionTurn: vi.fn(), tutorTurn };
    const result = await requestTutorTurn({ ...BASE_INPUT, skillId: 'sequencing' });
    expect(result.source).toBe('FALLBACK');
    expect(tutorTurn).not.toHaveBeenCalled();
  });

  it('keeps the authored hint ladder in a build without Django', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const giving = await requestTutorTurn(BASE_INPUT);
    expect(giving).toMatchObject({
      source: 'FALLBACK',
      turn: { strategy: 'GIVE_HINT', spokenText: BASE_INPUT.authoredBaseText },
    });
    // ENCOURAGE and ASK_GUIDING_QUESTION withhold the hint even as a fallback.
    const withholding = await requestTutorTurn({ ...BASE_INPUT, hintLevel: 1 });
    expect(withholding.turn.spokenText).not.toBe(BASE_INPUT.authoredBaseText);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('has no Amplify AI Kit route, data client or browser audit left', () => {
    const source = readFileSync(join(process.cwd(), 'src/features/tutor/api.ts'), 'utf8');
    expect(source).not.toMatch(/lib\/data-client|aws-amplify|amplify\/data/);
    expect(source).not.toMatch(/generations\.|AIInteractionAudit|SafetyEvent\.create/);
    expect(source).not.toMatch(/mastery\/api|quests\/api/);
  });
});
