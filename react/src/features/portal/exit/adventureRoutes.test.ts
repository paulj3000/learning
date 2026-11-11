import { describe, expect, it } from 'vitest';
import { locationWorldPath } from '../../island-map/three/runtime/locationWorldPath';
import {
  isLeftIslandState,
  isPortalHubPath,
  portalPath,
  realmExplorerPath,
} from './adventureRoutes';

const CHILD = 'child-1';

describe('portalPath', () => {
  it.each([
    [{ kind: 'island-explorer' } as const, '/island/child-1'],
    [{ kind: 'realm-explorer' } as const, '/island/child-1/realms'],
    [
      { kind: 'realm', realmSlug: 'creature-care-cove' } as const,
      '/island/child-1/realms/creature-care-cove',
    ],
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

describe('the Realm Explorer hub (AP-03, AP-04)', () => {
  it('is where "Leave island" returns', () => {
    expect(realmExplorerPath(CHILD)).toBe('/island/child-1/realms');
  });

  it('counts Home, the Realm Explorer and a Realm preview as hubs, and nothing else', () => {
    expect(isPortalHubPath('/island/child-1', CHILD)).toBe(true);
    expect(isPortalHubPath('/island/child-1/', CHILD)).toBe(true);
    expect(isPortalHubPath('/island/child-1/realms', CHILD)).toBe(true);
    expect(isPortalHubPath('/island/child-1/realms/', CHILD)).toBe(true);
    expect(isPortalHubPath('/island/child-1/realms/creature-care-cove', CHILD)).toBe(true);
    expect(isPortalHubPath('/island/child-1/realmsx', CHILD)).toBe(false);
    expect(isPortalHubPath('/island/child-1/travel', CHILD)).toBe(false);
    expect(isPortalHubPath('/island/child-1/worlds/creature-care-cove', CHILD)).toBe(false);
    expect(isPortalHubPath('/island/child-1/explore/wonderwild-forest', CHILD)).toBe(false);
    expect(isPortalHubPath('/island/child-2', CHILD)).toBe(false);
    expect(isPortalHubPath('/island/child-2/realms', CHILD)).toBe(false);
  });

  it('recognises the arrival state from "Leave island" only', () => {
    expect(isLeftIslandState({ leftIsland: true })).toBe(true);
    expect(isLeftIslandState({ leftIsland: 'yes' })).toBe(false);
    expect(isLeftIslandState(null)).toBe(false);
    expect(isLeftIslandState(undefined)).toBe(false);
  });
});
