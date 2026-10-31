import { describe, expect, it, vi, beforeEach } from 'vitest';

const { get, update, create, getCurrentUser } = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      ChildProfile: { get, update, create },
    },
  },
}));

vi.mock('./deletion', () => ({
  deleteChildProfileData: vi.fn(),
  deleteAccountAndAllData: vi.fn(),
}));

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser,
  fetchUserAttributes: vi.fn(),
}));

import { amplifyProfileStore, fromAmplifyChild } from './amplifyProfiles';

const { createChildProfile, ensureChildProfileOwnerSub } = amplifyProfileStore;

describe('ensureChildProfileOwnerSub', () => {
  beforeEach(() => {
    get.mockReset();
    update.mockReset();
    getCurrentUser.mockReset();
  });

  it('backfills ownerSub when the row predates the field', async () => {
    get.mockResolvedValueOnce({ data: { id: 'child-1', ownerSub: null } });
    getCurrentUser.mockResolvedValueOnce({ userId: 'sub-1', username: 'parent' });

    await ensureChildProfileOwnerSub('child-1');

    expect(update).toHaveBeenCalledWith({ id: 'child-1', ownerSub: 'sub-1' });
  });

  it('does nothing when ownerSub is already set', async () => {
    get.mockResolvedValueOnce({ data: { id: 'child-1', ownerSub: 'sub-1' } });

    await ensureChildProfileOwnerSub('child-1');

    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('does nothing when the profile cannot be found', async () => {
    get.mockResolvedValueOnce({ data: null });

    await ensureChildProfileOwnerSub('child-1');

    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('createChildProfile', () => {
  beforeEach(() => {
    create.mockReset();
    getCurrentUser.mockReset();
  });

  it('stamps the created row with the current user’s sub as ownerSub', async () => {
    getCurrentUser.mockResolvedValueOnce({ userId: 'sub-1', username: 'parent' });
    create.mockResolvedValueOnce({ data: { id: 'child-1' }, errors: undefined });

    await createChildProfile('parent-1', {
      nickname: 'Nova',
      ageBand: 'PATHFINDER',
      avatarKey: 'fox',
      avatarPhotoKey: null,
      interests: [],
      readingMode: 'READ_ALONG',
      sessionMinutes: 10,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ parentProfileId: 'parent-1', ownerSub: 'sub-1' }),
    );
  });
});

describe('fromAmplifyChild', () => {
  it('maps an Amplify row to the hand-owned shape with the accepted defaults', () => {
    const row = {
      id: 'c1',
      nickname: 'Pip',
      ageBand: 'SPROUT',
      avatarKey: 'FOX',
      avatarPhotoKey: null,
      interests: ['Space', null],
      readingMode: 'VOICE_FIRST',
      sessionMinutes: 6,
      active: null,
      aiEnabled: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    } as unknown as Parameters<typeof fromAmplifyChild>[0];
    expect(fromAmplifyChild(row)).toEqual({
      id: 'c1',
      nickname: 'Pip',
      ageBand: 'SPROUT',
      avatarKey: 'FOX',
      avatarPhotoKey: null,
      interests: ['Space'],
      readingMode: 'VOICE_FIRST',
      sessionMinutes: 6,
      active: true,
      aiEnabled: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    });
  });
});
