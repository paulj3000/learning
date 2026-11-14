import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../client';
import { childAvatarFor, childAvatarPath, fetchChildAvatar } from './avatarApi';

function client(
  respond: () => Promise<unknown>,
): ApiClient & { request: ReturnType<typeof vi.fn> } {
  return { request: vi.fn(async () => ({ status: 200, data: await respond() })) } as never;
}

describe('child avatar API (LAI-JMP-01c)', () => {
  it('asks for the child’s own avatar, child-scoped', async () => {
    const api = client(async () => ({
      avatarKey: 'FOX',
      displayName: 'Fox',
      model: null,
      reason: 'not_available',
    }));
    const answer = await fetchChildAvatar(api, 'child 1');
    expect(api.request).toHaveBeenCalledWith('GET', 'children/child%201/avatar/', {});
    expect(answer).toMatchObject({ avatarKey: 'FOX', model: null });
    expect(childAvatarPath('a/b')).toBe('children/a%2Fb/avatar/');
  });

  it('never throws: a failed request or a nonsense answer is null', async () => {
    expect(
      await fetchChildAvatar(
        client(async () => Promise.reject(new Error('offline'))),
        'c1',
      ),
    ).toBeNull();
    expect(
      await fetchChildAvatar(
        client(async () => 'nonsense'),
        'c1',
      ),
    ).toBeNull();
  });

  it('is null without the Django API or a child', async () => {
    expect(await childAvatarFor('', { enabled: true, baseUrl: '' } as never)).toBeNull();
  });
});
