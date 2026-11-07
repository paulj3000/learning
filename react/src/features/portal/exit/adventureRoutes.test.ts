import { describe, expect, it } from 'vitest';
import { locationWorldPath } from '../../island-map/three/runtime/locationWorldPath';
import {
  isIslandExplorerPath,
  isLeftIslandState,
  islandExplorerPath,
  portalPath,
} from './adventureRoutes';

const CHILD = 'child-1';

describe('portalPath', () => {
  it.each([
    [{ kind: 'island-explorer' } as const, '/island/child-1'],
    [{ kind: 'sailing-dock' } as const, '/island/child-1/travel'],
    [
      { kind: 'island', worldSlug: 'creature-care-cove' } as const,
      '/island/child-1/worlds/creature-care-cove',
    ],
    [
      { kind: 'place', locationSlug: 'pirate-builder-bay' } as const,
      '/island/child-1/locations/pirate-builder-bay',
    ],
    [
      {
        kind: 'adventure',
        locationSlug: 'pirate-builder-bay',
        templateSlug: 'bridge-repair',
      } as const,
      '/island/child-1/locations/pirate-builder-bay/adventures/bridge-repair',
    ],
    [{ kind: 'adventure-log' } as const, '/island/child-1/log'],
    [{ kind: 'quest-journal' } as const, '/island/child-1/quests'],
    [{ kind: 'library' } as const, '/island/child-1/library'],
  ])('builds %o', (destination, expected) => {
    expect(portalPath(CHILD, destination)).toBe(expected);
  });

  it('builds a 3D area path identical to the engine route', () => {
    expect(portalPath(CHILD, { kind: 'area', regionId: 'wonderwild-forest' })).toBe(
      locationWorldPath(CHILD, 'wonderwild-forest'),
    );
  });

  it('encodes segments', () => {
    expect(portalPath('a/b', { kind: 'place', locationSlug: 'x y' })).toBe(
      '/island/a%2Fb/locations/x%20y',
    );
  });
});

describe('the Island Explorer hub', () => {
  it('is the child homepage', () => {
    expect(islandExplorerPath(CHILD)).toBe('/island/child-1');
  });

  it('recognises itself, with or without a trailing slash, and nothing deeper', () => {
    expect(isIslandExplorerPath('/island/child-1', CHILD)).toBe(true);
    expect(isIslandExplorerPath('/island/child-1/', CHILD)).toBe(true);
    expect(isIslandExplorerPath('/island/child-1/travel', CHILD)).toBe(false);
    expect(isIslandExplorerPath('/island/child-2', CHILD)).toBe(false);
  });

  it('recognises the arrival state from "Leave island" only', () => {
    expect(isLeftIslandState({ leftIsland: true })).toBe(true);
    expect(isLeftIslandState({ leftIsland: 'yes' })).toBe(false);
    expect(isLeftIslandState(null)).toBe(false);
    expect(isLeftIslandState(undefined)).toBe(false);
  });
});
