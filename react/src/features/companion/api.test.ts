import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DjangoAiApi } from '../../api/ai/djangoAi';

const { current } = vi.hoisted(() => ({ current: { api: null as DjangoAiApi | null } }));

vi.mock('../../api/ai/djangoAi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/ai/djangoAi')>();
  return { ...original, currentDjangoAiApi: () => current.api };
});

import { requestCompanionTurn } from './api';
import { FALLBACK_TURNS } from './fallback';

const INPUT = {
  childProfileId: 'child-1',
  ageBand: 'PATHFINDER' as const,
  intent: 'HINT' as const,
  stepSummary: 'counting missing planks',
  authoredBaseText: 'Count the planks again.',
};

describe('requestCompanionTurn (AMP-05: Django only)', () => {
  beforeEach(() => {
    current.api = null;
  });

  it('returns the authored line, without any network call, when AI is off', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const companionTurn = vi.fn();
    current.api = { companionTurn, tutorTurn: vi.fn() };
    const result = await requestCompanionTurn({ ...INPUT, aiEnabled: false });
    expect(result).toEqual({
      turn: { ...FALLBACK_TURNS.HINT, spokenText: 'Count the planks again.' },
      source: 'FALLBACK',
    });
    expect(companionTurn).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('returns the authored line, without any network call, in a build without Django', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await requestCompanionTurn({ ...INPUT, intent: 'CELEBRATE' });
    expect(result).toEqual({ turn: FALLBACK_TURNS.CELEBRATE, source: 'FALLBACK' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('has no Amplify AI Kit route, data client or browser audit left', () => {
    const source = readFileSync(join(process.cwd(), 'src/features/companion/api.ts'), 'utf8');
    expect(source).not.toMatch(/lib\/data-client|aws-amplify|amplify\/data/);
    expect(source).not.toMatch(/generations\.|AIInteractionAudit|SafetyEvent\.create/);
  });
});
