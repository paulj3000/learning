/**
 * The persistence-facing half of the travel system (docs/ROADMAP.md
 * Phase 29).
 *
 * The only impure module in `src/features/worlds/`. Like
 * `src/features/quests/api.ts` and `src/features/discovery/api.ts`, it
 * reaches other engines only through their own public APIs and never writes
 * another engine's table directly (docs/ARCHITECTURE.md, engine
 * boundaries). Phase 29 adds no model of its own: arriving somewhere is
 * recorded as an ordinary `WorldChange`, which is what it is.
 */
import { listAllWorldChanges, recordWorldChangeOnce } from '../adventures/api';
import { getInventory } from '../rewards/api';
import { ALL_ITEMS } from '../rewards/content';
import type { AgeBandValue } from '../child-profile/constants';
import { canTravelTo, listTravelDestinations } from './travel';
import { WORLD_DEFINITIONS, getWorld } from './worlds';
import { loadAllWorldContentPacks } from './packs';
import { summarizeTravelPack, type TravelPackSummary } from './travelPack';
import type { TravelDestination } from './types';

export interface TravelDeck {
  destinations: TravelDestination[];
  worldChangeKeys: string[];
}

/** What the travel deck should show this child right now. */
export async function loadTravelDeck(
  childProfileId: string,
  ageBand: AgeBandValue,
  fromWorldSlug?: string,
): Promise<TravelDeck> {
  const changes = await listAllWorldChanges(childProfileId);
  const worldChangeKeys = changes.map((change) => change.changeKey);
  return {
    destinations: listTravelDestinations({ fromWorldSlug, worldChangeKeys, ageBand }),
    worldChangeKeys,
  };
}

export interface ArrivalResult {
  /** False when the route is not open for this child, or the world is unknown. */
  arrived: boolean;
  /** The authored arrival line, when there is one to read. */
  arrivalText?: string;
}

/**
 * Records that a child has landed in a world, once.
 *
 * Guarded rather than trusting: a child who reaches the route by any means
 * (a bookmarked URL, a back button, a shared link) must still meet the
 * travel requirement, so this re-checks instead of assuming the travel deck
 * already did. The home world has no arrival to record, so this is a no-op
 * there rather than a special case at every call site.
 *
 * Never throws. A failed write means the arrival is not remembered yet, not
 * that the child cannot be at the cove; the next visit records it.
 */
export async function recordArrival(
  childProfileId: string,
  worldSlug: string,
  ageBand: AgeBandValue,
): Promise<ArrivalResult> {
  const world = getWorld(worldSlug);
  if (!world) return { arrived: false };

  const changes = await listAllWorldChanges(childProfileId).catch(() => []);
  const worldChangeKeys = changes.map((change) => change.changeKey);
  if (!canTravelTo(worldSlug, worldChangeKeys, ageBand)) {
    return { arrived: false };
  }
  if (!world.arrival) {
    return { arrived: true };
  }

  await recordWorldChangeOnce(
    childProfileId,
    world.arrival.locationSlug,
    'TRAVEL',
    world.arrival.changeKey,
    // Travel has no adventure session behind it. The world slug is the
    // honest provenance, matching the `discovery:<id>` and `quest:<id>`
    // conventions already in use.
    `travel:${world.slug}`,
  ).catch(() => undefined);

  return { arrived: true, arrivalText: world.arrival.text };
}

/** The child's one backpack, grouped by the world each treasure came from. */
export async function loadTravelPack(childProfileId: string): Promise<TravelPackSummary> {
  const [inventory, packs] = await Promise.all([
    getInventory(childProfileId),
    loadAllWorldContentPacks(),
  ]);
  return summarizeTravelPack(inventory.ownedItemIds, ALL_ITEMS, packs, WORLD_DEFINITIONS);
}
