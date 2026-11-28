import { locationWorldPath } from './locationWorldPath';
import { HUB_REGION_ID, SOURCE_LOCATION_MANIFESTS } from './manifests';

/**
 * GE-077: where a `WorldAction` NAVIGATE lands when a child takes it inside a Three.js world.
 *
 * The interaction tables in `worldObjects.ts` are shared with the Phaser worlds, so their `to`
 * values still name Phaser pages: `'world'` is the Phaser harbor and `'world/<slug>'` a Phaser
 * world. Inside 3D those would drop the child out of Three.js. Here they resolve to the 3D
 * location instead whenever one exists:
 * - `'world'` goes to the 3D Welcome Harbor hub (LAI-2201);
 * - `'world/<slug>'` goes to `explore/<slug>` when a 3D manifest has that region id;
 * - everything else (location cards, story pages, a Phaser world with no 3D region yet such as
 *   Fossil Ridge Camp or Bolt's Workshop) is unchanged.
 *
 * The tables are not edited, so the Phaser worlds and `phaserParity.test.ts` are unaffected.
 * A locked 3D region (`entryRequirements`) still shows its own calm locked screen.
 */
export { HUB_REGION_ID };

const PHASER_HUB = 'world';
const PHASER_WORLD_PREFIX = 'world/';

const THREE_REGION_IDS: ReadonlySet<string> = new Set(
  SOURCE_LOCATION_MANIFESTS.map((manifest) => manifest.regionId),
);

/** The 3D region a Phaser `to` stands for, or null when it is not a Phaser world with one. */
export function threeRegionForNavigation(
  to: string,
  regionIds: ReadonlySet<string> = THREE_REGION_IDS,
): string | null {
  if (to === PHASER_HUB) return regionIds.has(HUB_REGION_ID) ? HUB_REGION_ID : null;
  if (!to.startsWith(PHASER_WORLD_PREFIX)) return null;
  const slug = to.slice(PHASER_WORLD_PREFIX.length);
  return regionIds.has(slug) ? slug : null;
}

/** The href for a NAVIGATE taken inside a Three.js world. */
export function threeNavigationHref(
  childId: string,
  to: string,
  regionIds: ReadonlySet<string> = THREE_REGION_IDS,
): string {
  const regionId = threeRegionForNavigation(to, regionIds);
  return regionId ? locationWorldPath(childId, regionId) : `/island/${childId}/${to}`;
}
