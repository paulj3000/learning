import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors';
import { Reader } from '../parse';
import { childHome, getChildHomeFor } from './homeApi';

export const REGION_JSON = {
  regionId: 'treasure-rush-cove',
  title: 'Treasure Cove',
  description: 'Help Pip find the chests.',
  world: { slug: 'learning-adventure-island', title: 'Learning Adventure Island' },
  location: { slug: 'pirate-builder-bay', title: 'Pirate Builder Bay' },
  ageBands: ['PATHFINDER'],
  available: true,
  lockedReason: null,
  status: 'IN_PROGRESS',
  chestsTotal: 4,
  chestsOpened: 1,
  thumbnailAssetId: null,
  prerequisites: [],
  resume: { sessionId: 's-1', status: 'ACTIVE', lastActivityAt: '2026-11-10T10:00:00Z' },
  lastPlayedAt: '2026-11-10T10:00:00Z',
};

describe('childHome (AP-02)', () => {
  it('reads the regions, counts and newest items the dashboard draws', () => {
    const home = childHome(
      new Reader({
        child: { id: 'child-1' },
        lastRegion: REGION_JSON,
        resume: [REGION_JSON],
        nextRegions: [{ ...REGION_JSON, status: 'NOT_STARTED', resume: null }],
        progress: {
          completedSessions: 3,
          worldChanges: 2,
          items: 5,
          questsCompleted: 1,
          questsActive: 2,
        },
        recentItems: [
          { item: { itemId: 'gold-coin', displayName: 'Gold coin' }, grantedAt: '2026-11-10' },
        ],
        recentActivities: [],
      }),
    );
    expect(home.lastRegion).toMatchObject({
      regionId: 'treasure-rush-cove',
      placeTitle: 'Pirate Builder Bay',
      chestsOpened: 1,
      chestsTotal: 4,
      canResume: true,
    });
    expect(home.nextRegions[0].canResume).toBe(false);
    expect(home.progress).toEqual({
      completedSessions: 3,
      worldChanges: 2,
      items: 5,
      questsCompleted: 1,
      questsActive: 2,
    });
    expect(home.recentItems).toEqual([{ itemId: 'gold-coin', displayName: 'Gold coin' }]);
  });

  it('is disabled in a build without the Django API', async () => {
    await expect(getChildHomeFor('child-1', { enabled: false })).rejects.toBeInstanceOf(ApiError);
  });
});
