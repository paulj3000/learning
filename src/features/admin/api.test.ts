import { describe, expect, it } from 'vitest';
import { groupChildrenByParent } from './api';
import type { ChildProfile, ParentProfile } from './api';

function parent(overrides: Partial<ParentProfile> = {}): ParentProfile {
  return {
    id: 'parent-1',
    displayName: 'Parent One',
    timezone: 'UTC',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ParentProfile;
}

function child(overrides: Partial<ChildProfile> = {}): ChildProfile {
  return {
    id: 'child-1',
    parentProfileId: 'parent-1',
    nickname: 'Kid',
    ageBand: 'PATHFINDER',
    avatarKey: 'FOX',
    interests: [],
    readingMode: 'READ_ALONG',
    sessionMinutes: 10,
    active: true,
    aiEnabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ChildProfile;
}

describe('groupChildrenByParent', () => {
  it('groups each child under its own parent', () => {
    const parents = [
      parent({ id: 'p1', displayName: 'Bea' }),
      parent({ id: 'p2', displayName: 'Al' }),
    ];
    const children = [
      child({ id: 'c1', parentProfileId: 'p1', nickname: 'Kid A' }),
      child({ id: 'c2', parentProfileId: 'p2', nickname: 'Kid B' }),
      child({ id: 'c3', parentProfileId: 'p1', nickname: 'Kid C' }),
    ];

    const grouped = groupChildrenByParent(parents, children);

    expect(grouped.map((entry) => entry.parent.id)).toEqual(['p2', 'p1']);
    expect(grouped[1]?.children.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(grouped[0]?.children.map((c) => c.id)).toEqual(['c2']);
  });

  it('sorts parents alphabetically by display name', () => {
    const parents = [
      parent({ id: 'p1', displayName: 'Zed' }),
      parent({ id: 'p2', displayName: 'Ann' }),
    ];

    const grouped = groupChildrenByParent(parents, []);

    expect(grouped.map((entry) => entry.parent.displayName)).toEqual(['Ann', 'Zed']);
  });

  it('gives a parent with no children an empty list rather than omitting them', () => {
    const parents = [parent({ id: 'p1' })];

    const grouped = groupChildrenByParent(parents, []);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.children).toEqual([]);
  });

  it('drops a child whose parent row no longer exists', () => {
    const parents = [parent({ id: 'p1' })];
    const children = [child({ id: 'orphan', parentProfileId: 'missing-parent' })];

    const grouped = groupChildrenByParent(parents, children);

    expect(grouped[0]?.children).toEqual([]);
  });
});
