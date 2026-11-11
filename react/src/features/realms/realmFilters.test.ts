import { describe, expect, it } from 'vitest';
import { buildRealms } from './realmCatalog';
import {
  NO_FILTER,
  ageBandLabel,
  ageOptions,
  ageRangeLabel,
  filterRealms,
  readFilter,
  subjectOptions,
  writeFilter,
} from './realmFilters';
import { testCatalog, testIsland } from './testCatalog';

const realms = buildRealms('child-1', testCatalog());
const slugs = (list: { slug: string }[]) => list.map((realm) => realm.slug);

describe('Realm filters (AP-03)', () => {
  it('offers only the subjects and ages the catalog has', () => {
    expect(subjectOptions(realms)).toEqual(['MATH', 'READING', 'SCIENCE', 'CREATIVITY']);
    expect(ageOptions(realms)).toEqual(['SPROUT', 'PATHFINDER', 'EXPLORER']);

    const mathOnly = buildRealms('child-1', {
      autoSelectIslandId: null,
      islands: [testIsland('isle', { subjectAreas: ['MATH'], ageBands: ['EXPLORER'] })],
    });
    expect(subjectOptions(mathOnly)).toEqual(['MATH']);
    expect(ageOptions(mathOnly)).toEqual(['EXPLORER']);
  });

  it('filters by subject and by age band, together', () => {
    expect(slugs(filterRealms(realms, NO_FILTER))).toEqual(slugs(realms));
    expect(slugs(filterRealms(realms, { subject: 'CREATIVITY', ageBand: null }))).toEqual([
      'learning-adventure-island',
    ]);
    expect(slugs(filterRealms(realms, { subject: 'SCIENCE', ageBand: null }))).toEqual([
      'learning-adventure-island',
      'creature-care-cove',
    ]);
    expect(slugs(filterRealms(realms, { subject: null, ageBand: 'SPROUT' }))).toEqual([
      'learning-adventure-island',
    ]);
    expect(slugs(filterRealms(realms, { subject: 'CREATIVITY', ageBand: 'EXPLORER' }))).toEqual([
      'learning-adventure-island',
    ]);
  });

  it('keeps locked Realms in the results, so a child can see what is coming', () => {
    const science = filterRealms(realms, { subject: 'SCIENCE', ageBand: null });
    expect(science.find((realm) => realm.slug === 'creature-care-cove')?.state).toBe('LOCKED');
  });

  it('round-trips through the URL and ignores values it does not know', () => {
    const params = writeFilter({ subject: 'READING', ageBand: 'PATHFINDER' });
    expect(params.toString()).toBe('subject=READING&age=PATHFINDER');
    expect(readFilter(params)).toEqual({ subject: 'READING', ageBand: 'PATHFINDER' });
    expect(writeFilter(NO_FILTER).toString()).toBe('');
    expect(readFilter(new URLSearchParams('subject=HISTORY&age=ADULT'))).toEqual(NO_FILTER);
  });

  it('labels ages in words a child can hear', () => {
    expect(ageBandLabel('SPROUT')).toBe('Ages 3 to 4');
    expect(ageRangeLabel(['PATHFINDER', 'EXPLORER'])).toBe('Ages 5 to 8');
    expect(ageRangeLabel(['UNKNOWN'])).toBeNull();
  });
});
