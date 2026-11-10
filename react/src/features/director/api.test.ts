import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { ApiError } from '../../api/errors';

vi.mock('../../api/auth', () => ({ getAccessToken: vi.fn(async () => 'token') }));

import {
  NO_SUGGESTION,
  fetchNextLearningActivity,
  getNextLearningActivity,
  parseNextLearningActivity,
} from './api';

const WIRE = {
  suggestions: [
    {
      adventureSlug: 'repair-the-moonlight-bridge',
      title: 'Repair the Moonlight Bridge',
      score: -1,
      reasons: [
        {
          kind: 'PRACTISES_SKILL',
          skillId: 'counting-sets',
          status: 'DEVELOPING',
          weight: 2,
          storyId: null,
          penalty: null,
        },
        {
          kind: 'ALREADY_COMPLETED',
          skillId: null,
          status: null,
          weight: null,
          storyId: null,
          penalty: 4,
        },
        { kind: 'PLAYED_RECENTLY', penalty: 3 },
        { kind: 'CONTINUES_STORY', storyId: 'dragon' },
        { kind: 'SOMETHING_NEW' },
      ],
    },
  ],
  hasPersonalizedSignal: true,
};

function clientReturning(data: unknown) {
  const request = vi.fn().mockResolvedValue({ status: 200, data });
  return { client: { request } as unknown as ApiClient, request };
}

describe('parseNextLearningActivity', () => {
  it('rebuilds the discriminated reasons from the flattened wire shape', () => {
    expect(parseNextLearningActivity(WIRE)).toEqual({
      ranking: [
        {
          adventureSlug: 'repair-the-moonlight-bridge',
          title: 'Repair the Moonlight Bridge',
          score: -1,
          reasons: [
            { kind: 'PRACTISES_SKILL', skillId: 'counting-sets', status: 'DEVELOPING', weight: 2 },
            { kind: 'ALREADY_COMPLETED', penalty: 4 },
            { kind: 'PLAYED_RECENTLY', penalty: 3 },
            { kind: 'CONTINUES_STORY', storyId: 'dragon' },
            // An unknown kind degrades to the reason with nothing to get wrong.
            { kind: 'NO_SKILLS_NEEDED' },
          ],
        },
      ],
      hasPersonalizedSignal: true,
    });
  });

  it('degrades an unknown skill status to LOCKED', () => {
    const parsed = parseNextLearningActivity({
      suggestions: [
        {
          adventureSlug: 'a',
          title: 'A',
          score: 0,
          reasons: [{ kind: 'PRACTISES_SKILL', skillId: 's', status: 'GENIUS', weight: 1 }],
        },
      ],
      hasPersonalizedSignal: false,
    });
    expect(parsed.ranking[0].reasons[0]).toEqual({
      kind: 'PRACTISES_SKILL',
      skillId: 's',
      status: 'LOCKED',
      weight: 1,
    });
  });

  it('refuses a response that is not the documented shape', () => {
    for (const bad of [null, {}, { suggestions: 'x', hasPersonalizedSignal: true }]) {
      expect(() => parseNextLearningActivity(bad)).toThrow(ApiError);
    }
  });
});

describe('fetchNextLearningActivity', () => {
  it('calls the child-scoped Django route with an escaped id', async () => {
    const { client, request } = clientReturning(WIRE);
    const result = await fetchNextLearningActivity(client, 'child/1');
    expect(request).toHaveBeenCalledWith('GET', 'children/child%2F1/next-learning-activity/');
    expect(result.ranking).toHaveLength(1);
  });

  it('refuses an empty id before any request', async () => {
    const { client, request } = clientReturning(WIRE);
    await expect(fetchNextLearningActivity(client, '')).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('getNextLearningActivity', () => {
  it('returns no suggestion, without any request, in a build without the Django API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await getNextLearningActivity('child-1', { enabled: false })).toBe(NO_SUGGESTION);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('never throws: a failed request degrades to no suggestion', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    expect(
      await getNextLearningActivity('child-1', { enabled: true, baseUrl: 'https://api.test' }),
    ).toBe(NO_SUGGESTION);
    fetchSpy.mockRestore();
  });

  it('reads the ranking from Django when it answers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(WIRE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await getNextLearningActivity('child-1', {
      enabled: true,
      baseUrl: 'https://api.test',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.test/api/v1/children/child-1/next-learning-activity/',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.hasPersonalizedSignal).toBe(true);
    expect(result.ranking[0].adventureSlug).toBe('repair-the-moonlight-bridge');
    fetchSpy.mockRestore();
  });
});
