import type { AgeBandValue } from '../child-profile/constants';

/**
 * The castle's offline quiet lines (ADR-065, SC-R09-01).
 *
 * **This is not a catalog.** Django owns the Castle Director's events: they are authored,
 * reviewed, published and retired in Django Admin (`CastleEvent`, `lai/apps/regions/castle_events.py`),
 * and the server alone decides eligibility. The client has no event list, no conditions and no
 * eligibility rules. It keeps exactly one calm line per room and age band, shown only when the
 * Director API is unavailable (offline, an error, or a room with no approved event), so the
 * castle stays fully playable without the server.
 *
 * Do not edit these to change what children are told online: edit the event in Django Admin.
 * `castleDefaultLines.test.ts` fails if a line drifts from the quiet default in the seed
 * (`lai/apps/regions/castle_events.json`), so this stays a read-only snapshot of it.
 */

export type CastleDefaultLines = Readonly<Record<AgeBandValue, string>>;

export const CASTLE_DEFAULT_LINES: Readonly<Record<string, CastleDefaultLines>> = {
  'entry-hall': {
    SPROUT: 'The torches glow softly.',
    PATHFINDER: 'The torches glow softly in the Entry Hall.',
    EXPLORER: 'The torches glow softly in the Entry Hall, and the old stones feel calm.',
  },
  'story-hall': {
    SPROUT: 'The hearth crackles.',
    PATHFINDER: 'The hearth crackles quietly in the Story Hall.',
    EXPLORER: 'The hearth crackles quietly in the Story Hall, and the shelves smell of old paper.',
  },
  'character-gallery': {
    SPROUT: 'The portraits look friendly.',
    PATHFINDER: 'The portraits look down kindly from the walls.',
    EXPLORER: 'The portraits look down kindly from the walls, each one holding a story of its own.',
  },
  'costume-room': {
    SPROUT: 'The costumes sway a little.',
    PATHFINDER: 'The costumes sway a little on their hooks.',
    EXPLORER: 'The costumes sway a little on their hooks, as if they remember every play.',
  },
  'east-corridor': {
    SPROUT: 'The corridor is quiet.',
    PATHFINDER: 'The corridor is quiet, and the candles burn steadily.',
    EXPLORER: 'The corridor is quiet, and the candles burn steadily along the stone walls.',
  },
  'setting-tower': {
    SPROUT: 'The windows show the sky.',
    PATHFINDER: 'The tall windows show a wide, calm sky.',
    EXPLORER: 'The tall windows show a wide, calm sky, and the clouds drift past like slow ships.',
  },
  'illustration-studio': {
    SPROUT: 'The paints sparkle.',
    PATHFINDER: 'The paints sparkle in their little pots.',
    EXPLORER: 'The paints sparkle in their little pots, ready for any picture you can imagine.',
  },
  'great-library': {
    SPROUT: 'The books rest on the shelves.',
    PATHFINDER: 'The books rest quietly on their shelves.',
    EXPLORER: 'The books rest quietly on their shelves, and a page turns by itself, just once.',
  },
  'trophy-room': {
    SPROUT: 'The pedestals shine.',
    PATHFINDER: 'The pedestals shine in the soft lantern light.',
    EXPLORER: 'The pedestals shine in the soft lantern light, each one keeping a treasure safe.',
  },
  'secret-chamber': {
    SPROUT: 'The lantern glows.',
    PATHFINDER: 'The little lantern glows in the quiet room.',
    EXPLORER: 'The little lantern glows in the quiet room, and the mural seems to listen.',
  },
};

/** The offline line for a room and age band, or undefined for a room the castle does not have. */
export function castleDefaultLine(roomId: string, band: AgeBandValue): string | undefined {
  return CASTLE_DEFAULT_LINES[roomId]?.[band];
}
