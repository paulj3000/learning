import { ISLAND_ITEMS } from '../../rewards/content/islandItems';
import type { WorldInteraction } from '../worldObjects';
import { TROPHY_PEDESTAL_SPOTS, ZONES } from './storykeeperCastleRegion';

/**
 * The Trophy Room's display contract (SC-R03-03): which treasure stands on
 * which pedestal, and what a pedestal says when a child walks up to it.
 *
 * **There is no second reward store here.** What a child owns is
 * `ownedItemIds` from the existing inventory (`rewards/`, Django-backed), and
 * what an item is called and says comes from the existing item catalog
 * (`ISLAND_ITEMS`). This module only decides *where* an owned item stands. It
 * stores nothing and grants nothing.
 *
 * Persistent artifacts (new items earned by castle play, with their own
 * reward rules) are SC-R07. Until then two pedestals are reserved for the
 * castle items that already exist, the Storykeeper's Quill and the Book with
 * a Blank Page, and four are **open**: empty, labelled as waiting for a
 * treasure, ready for SC-R07 to bind an item id to each. The empty state is
 * the honest state for most children today.
 */

export interface TrophySlot {
  id: string;
  /** The pedestal's `EntitySpot` id in the region. */
  pedestalEntityId: string;
  /** The walk-up zone in front of it. */
  zoneId: string;
  /** The reward item this pedestal is for, or `undefined` for an open pedestal. */
  itemId?: string;
}

/**
 * Pedestal order is the region's. Two are bound to existing castle items,
 * in the order a child usually earns them: finish the Tale, then find the
 * book behind the tapestry (either order is fine; it is only the layout).
 */
const BOUND_ITEMS: readonly (string | undefined)[] = [
  'storykeepers-quill',
  'blank-page-storybook',
  undefined,
  undefined,
  undefined,
  undefined,
];

export const TROPHY_SLOTS: readonly TrophySlot[] = TROPHY_PEDESTAL_SPOTS.map((spot, index) => ({
  id: `trophy-slot-${index + 1}`,
  pedestalEntityId: spot.entityId,
  zoneId: `trophy-slot-${index + 1}`,
  itemId: BOUND_ITEMS[index],
}));

export type TrophyState = 'on-display' | 'waiting' | 'open';

export interface TrophyEntry {
  slot: TrophySlot;
  state: TrophyState;
  /** Child-facing, from the item catalog. Present for a slot bound to an item. */
  name?: string;
  /** What a child hears on walking up to it. Readable aloud. */
  text: string;
}

const itemById = (id: string) => ISLAND_ITEMS.find((item) => item.id === id);

/** Said at an open pedestal. */
export const OPEN_PEDESTAL_TEXT =
  'An empty pedestal. A treasure you earn will be kept here one day.';

/**
 * What the Trophy Room shows for what a child owns. Pure: the same inventory
 * always gives the same room. A bound pedestal is `on-display` when the item
 * is owned and `waiting` when it is not; an unbound one is `open`. An item id
 * the catalog does not know is treated as not owned, never an error.
 */
export function trophyDisplay(ownedItemIds: readonly string[]): readonly TrophyEntry[] {
  return TROPHY_SLOTS.map((slot): TrophyEntry => {
    if (!slot.itemId) return { slot, state: 'open', text: OPEN_PEDESTAL_TEXT };
    const item = itemById(slot.itemId);
    if (!item) return { slot, state: 'open', text: OPEN_PEDESTAL_TEXT };
    if (ownedItemIds.includes(item.id)) {
      return {
        slot,
        state: 'on-display',
        name: item.displayName,
        text: `${item.displayName}. ${item.description}`,
      };
    }
    return {
      slot,
      state: 'waiting',
      name: item.displayName,
      text: `An empty pedestal. ${item.displayName} will be kept here once you have it.`,
    };
  });
}

/**
 * The walk-up interactions, one or two per pedestal, built from the same
 * slots and the same catalog so the words cannot drift from the items. They
 * are `SHOW_MESSAGE` only: looking at a treasure changes nothing and grants
 * nothing. A bound pedestal has an owned and a waiting interaction with
 * opposite item requirements, the castle's usual before-and-after shape; an
 * open one has one.
 */
export const CASTLE_TROPHY_INTERACTIONS: readonly WorldInteraction[] = TROPHY_SLOTS.flatMap(
  (slot): WorldInteraction[] => {
    if (!ZONES.some((zone) => zone.id === slot.zoneId)) {
      throw new Error(`Trophy slot "${slot.id}" has no zone`);
    }
    const base = {
      type: 'OBJECT',
      trigger: 'APPROACH',
      targetId: slot.pedestalEntityId,
      zoneId: slot.zoneId,
    } as const;
    const item = slot.itemId ? itemById(slot.itemId) : undefined;
    if (!item) {
      return [
        {
          ...base,
          id: `${slot.id}-open`,
          title: 'An empty pedestal',
          requirements: [{ type: 'ALWAYS' }],
          action: { kind: 'SHOW_MESSAGE', message: OPEN_PEDESTAL_TEXT },
        },
      ];
    }
    return [
      {
        ...base,
        id: `${slot.id}-owned`,
        title: item.displayName,
        requirements: [{ type: 'ITEM_OWNED', itemId: item.id }],
        action: { kind: 'SHOW_MESSAGE', message: `${item.displayName}. ${item.description}` },
      },
      {
        ...base,
        id: `${slot.id}-waiting`,
        title: 'An empty pedestal',
        requirements: [{ type: 'ITEM_ABSENT', itemId: item.id }],
        action: {
          kind: 'SHOW_MESSAGE',
          message: `An empty pedestal. ${item.displayName} will be kept here once you have it.`,
        },
      },
    ];
  },
);
