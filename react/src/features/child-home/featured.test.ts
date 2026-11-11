import { describe, expect, it } from 'vitest';
import type { ChildHome, HomeRegion } from '../../api/play/homeApi';
import { pickFeatured } from './featured';

const region = (regionId: string, overrides: Partial<HomeRegion> = {}): HomeRegion => ({
  regionId,
  title: regionId,
  description: '',
  placeTitle: 'Somewhere',
  available: true,
  status: 'NOT_STARTED',
  chestsTotal: 0,
  chestsOpened: 0,
  canResume: false,
  ...overrides,
});

const home = (overrides: Partial<ChildHome> = {}): ChildHome => ({
  lastRegion: null,
  resume: [],
  nextRegions: [],
  progress: {
    completedSessions: 0,
    worldChanges: 0,
    items: 0,
    questsCompleted: 0,
    questsActive: 0,
  },
  recentItems: [],
  ...overrides,
});

describe('pickFeatured (AP-02)', () => {
  it('resumes an adventure the child left open first', () => {
    const featured = pickFeatured(
      home({
        resume: [region('open', { canResume: true })],
        lastRegion: region('last'),
        nextRegions: [region('next')],
      }),
    );
    expect(featured).toEqual({
      kind: 'RESUME',
      region: expect.objectContaining({ regionId: 'open' }),
    });
  });

  it('otherwise returns to the last place played', () => {
    expect(
      pickFeatured(home({ lastRegion: region('last'), nextRegions: [region('next')] })),
    ).toMatchObject({ kind: 'RETURN', region: { regionId: 'last' } });
  });

  it('otherwise suggests the server’s next place', () => {
    expect(pickFeatured(home({ nextRegions: [region('next')] }))).toMatchObject({
      kind: 'START',
      region: { regionId: 'next' },
    });
  });

  it('never features a place the child cannot play', () => {
    const unavailable = region('closed', { available: false });
    expect(
      pickFeatured(
        home({ resume: [unavailable], lastRegion: unavailable, nextRegions: [unavailable] }),
      ),
    ).toBeNull();
  });

  it('features nothing for a brand new child', () => {
    expect(pickFeatured(home())).toBeNull();
  });
});
