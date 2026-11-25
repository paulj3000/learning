import { afterEach, describe, expect, it, vi } from 'vitest';
import { castleTaleExtension } from '../../extensions/castleTale/castleTaleScene';
import { ARCHWAYS, ROOMS } from '../../storykeeperCastleRegion';
import type { CollisionProfile, CollisionProfiles } from '../collisionProfile';
import { mount, walk, type Harness } from '../testing/engineHarness';
import { STORYKEEPER_CASTLE_MANIFEST } from './storykeeperCastle';

/**
 * Storykeeper Castle under Asset Library collision profiles on `archway` (Trello #247, the
 * GE-L16 follow-up; found by LAI 02). Profiles reach shipped regions with no release, so one
 * staff box over the archway's whole bounds, or an Automatic one, must never seal a doorway:
 * the engine carves the opening out of it. Every room and every archway stays reachable.
 */

const WHOLE = { minX: -1.3, minY: 0, minZ: -0.3, maxX: 1.3, maxY: 3, maxZ: 0.3 };
const SETUPS: [string, CollisionProfile | undefined][] = [
  ['no profile', undefined],
  ['a Solid box over the whole archway', { behavior: 'SOLID', shape: 'BOX', boxes: [WHOLE] }],
  [
    'an Automatic box over the whole archway',
    { behavior: 'SOLID', shape: 'AUTOMATIC', boxes: [WHOLE] },
  ],
  [
    'two jamb boxes',
    {
      behavior: 'SOLID',
      shape: 'COMPOUND',
      boxes: [
        { ...WHOLE, maxX: -1, maxY: 2.6 },
        { ...WHOLE, minX: 1, maxY: 2.6 },
      ],
    },
  ],
];

const centre = (zone: { minX: number; maxX: number; minZ: number; maxZ: number }) => ({
  x: (zone.minX + zone.maxX) / 2,
  z: (zone.minZ + zone.maxZ) / 2,
});

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  vi.restoreAllMocks();
});

async function castleWith(profile: CollisionProfile | undefined) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const profiles: CollisionProfiles = new Map(profile ? [['archway', profile]] : []);
  harness = mount({
    manifest: STORYKEEPER_CASTLE_MANIFEST,
    extensions: [castleTaleExtension],
    collisionProfiles: () => Promise.resolve(profiles),
  });
  await harness.engine.ready;
  return harness;
}

/** What the child cannot stand on with the archway adding nothing at all (furniture, hearths). */
async function blockedWith(profile: CollisionProfile | undefined) {
  const castle = await castleWith(profile);
  const result = {
    rooms: ROOMS.filter((room) => !castle.engine.placeChild(centre(room.floor))).map((r) => r.id),
    arches: ARCHWAYS.filter((arch) => !castle.engine.placeChild(centre(arch.gap))).map((a) => a.id),
  };
  castle.engine.dispose();
  harness = null;
  return result;
}

describe('Storykeeper Castle archways under collision profiles', () => {
  it.each(SETUPS)(
    '%s: blocks no room centre and no archway opening that an archway without collision leaves open',
    async (_, profile) => {
      const baseline = await blockedWith({ behavior: 'SOLID', shape: 'BOX', boxes: [] });
      // Only the secret passage, which stays shut until the child discovers it.
      expect(baseline.arches).toEqual(['arch-secret']);
      const blocked = await blockedWith(profile);
      expect(blocked.rooms).toEqual(baseline.rooms);
      expect(blocked.arches).toEqual(baseline.arches);
    },
    60_000,
  );

  it.each(SETUPS)(
    '%s: the child walks from the entry through the entry hall archway',
    async (_, profile) => {
      const castle = await castleWith(profile);
      castle.engine.placeChild({ x: -12, z: 0 });
      castle.setDrive(walk(Math.PI / 2));
      castle.runFrames(300);
      expect(castle.camera().position.x).toBeGreaterThan(-8);
    },
    60_000,
  );
});
