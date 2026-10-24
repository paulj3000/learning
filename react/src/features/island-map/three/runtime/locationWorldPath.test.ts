import { matchPath } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LOCATION_WORLD_ROUTE, locationWorldPath } from './locationWorldPath';

describe('locationWorldPath', () => {
  it('builds a path the generic route matches, round-tripping both params', () => {
    const path = locationWorldPath('child-1', 'welcome-harbor');
    expect(path).toBe('/island/child-1/explore/welcome-harbor');
    expect(matchPath(LOCATION_WORLD_ROUTE, path)?.params).toEqual({
      childId: 'child-1',
      regionId: 'welcome-harbor',
    });
  });

  it('encodes ids so an odd id cannot escape its segment', () => {
    expect(locationWorldPath('a/b', 'x?y')).toBe('/island/a%2Fb/explore/x%3Fy');
  });

  it('stays clear of the 2D location card and Phaser world routes', () => {
    expect(
      matchPath('/island/:childId/locations/:locationSlug', locationWorldPath('c', 'r')),
    ).toBeNull();
    expect(matchPath('/island/:childId/world/*', locationWorldPath('c', 'r'))).toBeNull();
  });
});
