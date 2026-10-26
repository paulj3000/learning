import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client';
import { ApiError } from './errors';
import {
  isBackendGap,
  isUnsupported,
  selectApi,
  setActiveBackendForTests,
  supports,
  unsupported,
} from './select';

interface DemoApi {
  read(id: string): Promise<string>;
  write(id: string): Promise<void>;
}

const amplify: DemoApi = {
  read: vi.fn(async (id: string) => `amplify:${id}`),
  write: vi.fn(async () => undefined),
};

const DJANGO = { backend: 'django', baseUrl: 'https://select.example' } as const;

describe('selectApi', () => {
  it('returns the Amplify adapter itself on an Amplify build', () => {
    expect(selectApi<DemoApi>('story', { amplify }, { backend: 'amplify' })).toBe(amplify);
  });

  it('uses Django for the operations it provides and refuses the rest, never Amplify', async () => {
    const django = vi.fn((client: ApiClient) => ({
      read: async (id: string) => `django:${id}:${typeof client.request}`,
    }));
    const api = selectApi<DemoApi>('story', { amplify, django }, DJANGO);

    await expect(api.read('a')).resolves.toBe('django:a:function');
    const error = await api.write('a').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'unsupported', code: 'story_unavailable' });
    expect((error as ApiError).details.operation?.[0]?.message).toBe('write');
    expect(amplify.write).not.toHaveBeenCalled();
  });

  it('refuses every operation of an area with no Django routes at all', async () => {
    const api = selectApi<DemoApi>('npc', { amplify }, DJANGO);
    await expect(api.read('a')).rejects.toMatchObject({ code: 'npc_unavailable' });
    expect(amplify.read).not.toHaveBeenCalled();
  });

  it('fails every operation on a misconfigured build', async () => {
    const api = selectApi<DemoApi>(
      'npc',
      { amplify },
      { backend: 'misconfigured', reason: 'invalid_api_base' },
    );
    await expect(api.read('a')).rejects.toMatchObject({ kind: 'disabled', code: 'invalid_api_base' });
    expect(amplify.read).not.toHaveBeenCalled();
  });
});

describe('capability reporting', () => {
  it('reports Django support per operation', () => {
    selectApi<DemoApi>('quests', { amplify, django: () => ({ read: async () => 'x' }) }, DJANGO);
    setActiveBackendForTests('django');
    try {
      expect(supports('quests', 'read')).toBe(true);
      expect(supports('quests', 'write')).toBe(false);
      expect(supports('mastery', 'read')).toBe(false);
    } finally {
      setActiveBackendForTests('amplify');
    }
    expect(supports('quests', 'write')).toBe(true);
  });

  it('tells a backend gap apart from a transient failure', () => {
    expect(isUnsupported(unsupported('story'))).toBe(true);
    expect(isBackendGap(unsupported('story'))).toBe(true);
    expect(isBackendGap(new ApiError('disabled'))).toBe(true);
    expect(isBackendGap(new ApiError('network'))).toBe(false);
    expect(isBackendGap(new Error('boom'))).toBe(false);
  });
});
