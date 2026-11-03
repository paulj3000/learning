import type { WorldRequirement } from '../../../../worldObjects';
import { TROPHY_SLOTS } from '../../../castleTrophies';
import { TROPHY_PEDESTAL_HALF, TROPHY_PEDESTAL_SPOTS } from '../../../storykeeperCastleRegion';
import type { ScenerySpec } from '../../locationManifest';
import { box, solid, type RoomVisuals } from './castleVisualKit';

/**
 * The Trophy Room's look (SC-R03-03): warm cream plaster, a crimson carpet,
 * and six cream pedestals with gold tops. A pedestal whose item is not owned
 * shows an empty gold plate; one whose item is owned shows the treasure. Both
 * states use the castle's usual item requirements, evaluated when the scene
 * is built, so a treasure earned in this visit appears on the next entry to
 * the room. The accessible list (`CastleGuide`) is live.
 *
 * Presets are all reused (budget: 16 of 16), and the room is held to its own
 * scenery budget in `storykeeperCastleBudgets.test.ts`.
 */

const PEDESTAL_STONE = 0xd8c9a8;
const PLATE_GOLD = 0xd8b45a;
const FEATHER = 0xf5f0e6;
const BOOK_COVER = 0x7a1f2f;
const SHELF_WOOD = 0x6b4a2a;

const PEDESTAL_HEIGHT = 0.9;

const gated = (spec: ScenerySpec, requirements: readonly WorldRequirement[]): ScenerySpec =>
  ({ ...spec, requirements }) as ScenerySpec;

/** What stands on a bound pedestal when its item is owned. */
function treasure(itemId: string, x: number, z: number): ScenerySpec | undefined {
  const top = PEDESTAL_HEIGHT + 0.03;
  if (itemId === 'storykeepers-quill') {
    return box(
      'castle-trophy-quill',
      FEATHER,
      x - 0.03,
      x + 0.03,
      z - 0.14,
      z + 0.14,
      top,
      top + 0.3,
    );
  }
  if (itemId === 'blank-page-storybook') {
    return box(
      'castle-trophy-book',
      BOOK_COVER,
      x - 0.14,
      x + 0.14,
      z - 0.1,
      z + 0.1,
      top,
      top + 0.06,
    );
  }
  return undefined;
}

const PEDESTALS = TROPHY_PEDESTAL_SPOTS.map((spot, index) => ({
  ...spot,
  number: index + 1,
  slot: TROPHY_SLOTS[index],
}));

export const TROPHY_ROOM_VISUALS: RoomVisuals = {
  look: {
    roomId: 'trophy-room',
    floor: 'carpet-hall-rug',
    walls: 'plaster-hall',
    ceiling: 'plaster-hall',
    trim: 'trim-dark-wood',
    mood: { color: 0xffe6c0, priority: 2 },
    // A little gold dust, like a room that is cared for.
    motes: { color: 0xffe2a0, count: 16, minY: 0.4, maxY: 2.6, size: 0.04, seed: 13 },
  },
  materials: [],
  decor: [
    ...PEDESTALS.flatMap(({ x, z, number, slot }): ScenerySpec[] => {
      const half = TROPHY_PEDESTAL_HALF;
      const pedestal = box(
        `castle-trophy-pedestal-${number}`,
        PEDESTAL_STONE,
        x - half,
        x + half,
        z - half,
        z + half,
        0,
        PEDESTAL_HEIGHT,
      );
      const plate = box(
        `castle-trophy-plate-${number}`,
        PLATE_GOLD,
        x - 0.2,
        x + 0.2,
        z - 0.2,
        z + 0.2,
        PEDESTAL_HEIGHT,
        PEDESTAL_HEIGHT + 0.03,
      );
      if (!slot.itemId) return [pedestal, plate];
      const shown = treasure(slot.itemId, x, z);
      return [
        pedestal,
        // The empty gold plate shows only while the item is not owned.
        gated(plate, [{ type: 'ITEM_ABSENT', itemId: slot.itemId }]),
        ...(shown ? [gated(shown, [{ type: 'ITEM_OWNED', itemId: slot.itemId }])] : []),
      ];
    }),
    // A wall shelf on the north wall, above head height: flat, never solid.
    box('castle-trophy-shelf', SHELF_WOOD, 0.3, 2.4, -6.5, -6.27, 1.4, 1.46),
  ],
  // Each pedestal is solid, so a child walks around the treasure and never through it.
  colliders: PEDESTALS.map(({ x, z, entityId }) =>
    solid(
      entityId,
      x - TROPHY_PEDESTAL_HALF,
      x + TROPHY_PEDESTAL_HALF,
      z - TROPHY_PEDESTAL_HALF,
      z + TROPHY_PEDESTAL_HALF,
      PEDESTAL_HEIGHT,
    ),
  ),
};
