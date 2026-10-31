import { describe, expect, it, vi } from 'vitest';
import { getChildPlaySettings } from './playSettings';
import type { ChildProfile } from './profileTypes';

vi.mock('./api', () => ({ getChildProfile: vi.fn() }));

const CHILD: ChildProfile = {
  id: 'c1',
  nickname: 'Pip',
  ageBand: 'EXPLORER',
  avatarKey: 'FOX',
  avatarPhotoKey: null,
  interests: [],
  readingMode: 'INDEPENDENT',
  sessionMinutes: 15,
  active: true,
  aiEnabled: false,
  createdAt: null,
  updatedAt: null,
};

describe('getChildPlaySettings', () => {
  it('takes the age band, AI switch and session limit from the profile store', async () => {
    const read = vi.fn(async () => CHILD);
    await expect(getChildPlaySettings('c1', { read })).resolves.toEqual({
      ageBand: 'EXPLORER',
      aiEnabled: false,
      sessionMinutes: 15,
    });
    expect(read).toHaveBeenCalledWith('c1');
  });

  it('is null for a child the store does not show this parent', async () => {
    await expect(getChildPlaySettings('c1', { read: async () => null })).resolves.toBeNull();
  });

  it('is null without a child id, without asking', async () => {
    const read = vi.fn(async () => CHILD);
    await expect(getChildPlaySettings('', { read })).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('lets a failed read reach the caller', async () => {
    const read = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(getChildPlaySettings('c1', { read })).rejects.toThrow('offline');
  });
});
