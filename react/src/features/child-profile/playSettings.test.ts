import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { ApiError } from '../../api/errors';
import { getChildProfile } from './api';
import { getChildPlaySettings, parsePlaySettings } from './playSettings';

vi.mock('./api', () => ({ getChildProfile: vi.fn() }));

function client(request: ApiClient['request']): ApiClient {
  return { request: vi.fn(request) };
}

describe('getChildPlaySettings', () => {
  it('reads the child from Django in Django sign-in mode, never from Amplify', async () => {
    const api = client(async () => ({
      status: 200,
      data: { id: 'c1', ageBand: 'EXPLORER', aiEnabled: false, sessionMinutes: 15 },
    }));
    await expect(getChildPlaySettings('c1', { mode: 'django', client: api })).resolves.toEqual({
      ageBand: 'EXPLORER',
      aiEnabled: false,
      sessionMinutes: 15,
    });
    expect(api.request).toHaveBeenCalledWith('GET', 'children/c1/');
    expect(getChildProfile).not.toHaveBeenCalled();
  });

  it('is null for a child Django does not show this parent', async () => {
    const api = client(async () => {
      throw new ApiError('not_found', { status: 404 });
    });
    await expect(getChildPlaySettings('other', { mode: 'django', client: api })).resolves.toBeNull();
  });

  it('passes other failures on, so the page can show its error state', async () => {
    const api = client(async () => {
      throw new ApiError('network');
    });
    await expect(getChildPlaySettings('c1', { mode: 'django', client: api })).rejects.toThrow();
  });

  it('keeps reading Amplify in Cognito mode', async () => {
    vi.mocked(getChildProfile).mockResolvedValueOnce({
      ageBand: 'SPROUT',
      aiEnabled: null,
      sessionMinutes: 6,
    } as never);
    await expect(getChildPlaySettings('c1', { mode: 'cognito' })).resolves.toEqual({
      ageBand: 'SPROUT',
      aiEnabled: true,
      sessionMinutes: 6,
    });
  });

  it('rejects a response without a known age band', () => {
    expect(parsePlaySettings({ ageBand: 'TEEN' })).toBeNull();
    expect(parsePlaySettings(null)).toBeNull();
    expect(parsePlaySettings({ ageBand: 'PATHFINDER' })).toEqual({
      ageBand: 'PATHFINDER',
      aiEnabled: true,
      sessionMinutes: null,
    });
  });
});
