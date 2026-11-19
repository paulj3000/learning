import type { WorldRequirement } from '../../../../worldObjects';
import { TROPHY_SLOTS } from '../../../castleTrophies';
import { TROPHY_PEDESTAL_HALF, TROPHY_PEDESTAL_SPOTS } from '../../../storykeeperCastleRegion';
import type { ScenerySpec } from '../../locationManifest';
import { box, solid, type RoomVisuals } from './castleVisualKit';

/**
 * The Trophy Room's look (SC-R03-03, SC-R07-02): warm cream plaster, a
 * crimson carpet, and six cream stone pedestals. A pedestal whose keepsake is
 * owned shows the keepsake on its top; one whose keepsake is not owned stands
 * bare, which is the calm empty state. The castle's usual item requirements
 * decide it when the scene is built, so a keepsake earned in this visit
 * appears on the next entry to the room. The accessible list (`CastleGuide`)
 * is live.
 *
 * Each keepsake is a primitive mesh (ADR-028: no production asset committed);
 * `artifactPedestal.ts` is the reusable pedestal that will host a sourced
 * model with scale normalisation and a primitive fallback once art exists.
 * The separate gold plate of SC-R03-03 was folded away here: six keepsakes
 * plus six plates would cost four draw calls the castle's 300 ceiling does not
 * have (`storykeeperCastleBudgets.test.ts`), and a bare pedestal says "empty"
 * just as well.
 *
 * Presets are all reused (budget: 16 of 16), and the room is held to its own
 * scenery budget in `storykeeperCastleBudgets.test.ts`.
 */

const PEDESTAL_STONE = 0xd8c9a8;
const FEATHER = 0xf5f0e6;
const BOOK_COVER = 0x7a1f2f;
const SEAL_GOLD = 0xd8b45a;
const BRUSH_RED = 0xb8483e;
const LENS_GLASS = 0x9fd3e6;
const KEY_SILVER = 0xc8ccd4;
const SHELF_WOOD = 0x6b4a2a;

const PEDESTAL_HEIGHT = 0.9;

const gated = (spec: ScenerySpec, requirements: readonly WorldRequirement[]): ScenerySpec =>
  ({ ...spec, requirements }) as ScenerySpec;

/** A keepsake's primitive look: id, colour, half width (x), half depth (z), height. */
const TREASURE_SHAPES: Readonly<
  Record<string, { id: string; color: number; hx: number; hz: number; h: number }>
> = {
  'storykeepers-quill': { id: 'castle-trophy-quill', color: FEATHER, hx: 0.03, hz: 0.14, h: 0.3 },
  'blank-page-storybook': { id: 'castle-trophy-book', color: BOOK_COVER, hx: 0.14, hz: 0.1, h: 0.06 },
  'great-storybook-seal': { id: 'castle-trophy-seal', color: SEAL_GOLD, hx: 0.12, hz: 0.12, h: 0.05 },
  'painted-words-brush': { id: 'castle-trophy-brush', color: BRUSH_RED, hx: 0.025, hz: 0.025, h: 0.3 },
  'three-clues-lens': { id: 'castle-trophy-lens', color: LENS_GLASS, hx: 0.1, hz: 0.02, h: 0.2 },
  'secret-door-key': { id: 'castle-trophy-key', color: KEY_SILVER, hx: 0.13, hz: 0.03, h: 0.05 },
};

/** What stands on a bound pedestal when its keepsake is owned. */
function treasure(itemId: string, x: number, z: number): ScenerySpec | undefined {
  const shape = TREASURE_SHAPES[itemId];
  if (!shape) return undefined;
  const top = PEDESTAL_HEIGHT;
  return box(
    shape.id,
    shape.color,
    x - shape.hx,
    x + shape.hx,
    z - shape.hz,
    z + shape.hz,
    top,
    top + shape.h,
  );
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
      const shown = slot.itemId ? treasure(slot.itemId, x, z) : undefined;
      if (!slot.itemId || !shown) return [pedestal];
      // The keepsake shows only while it is owned; otherwise the pedestal stands bare.
      return [pedestal, gated(shown, [{ type: 'ITEM_OWNED', itemId: slot.itemId }])];
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
