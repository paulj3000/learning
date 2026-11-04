import { CASTLE_ROOMS, type CastleRoomNode } from '../../castleLayout';

/**
 * Where each room's tile goes on the castle map (SC-R03-06), computed from the
 * canonical layout so a tile is exactly where its room's floor is. Pure: no
 * React, so it is tested on its own and kept out of the component file.
 */

/** The castle's extent, fixed over *every* room so the map never changes size when a secret appears. */
const EXTENT = CASTLE_ROOMS.reduce(
  (box, room) => ({
    minX: Math.min(box.minX, room.floor.minX),
    maxX: Math.max(box.maxX, room.floor.maxX),
    minZ: Math.min(box.minZ, room.floor.minZ),
    maxZ: Math.max(box.maxZ, room.floor.maxZ),
  }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
);

export const MAP_WIDTH_METERS = EXTENT.maxX - EXTENT.minX;
export const MAP_DEPTH_METERS = EXTENT.maxZ - EXTENT.minZ;

/** The tile's place on the map, in percent, north at the top (the castle's +Z is north). */
export function tileBox(room: CastleRoomNode): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  const { minX, maxX, minZ, maxZ } = room.floor;
  return {
    left: `${((minX - EXTENT.minX) / MAP_WIDTH_METERS) * 100}%`,
    top: `${((EXTENT.maxZ - maxZ) / MAP_DEPTH_METERS) * 100}%`,
    width: `${((maxX - minX) / MAP_WIDTH_METERS) * 100}%`,
    height: `${((maxZ - minZ) / MAP_DEPTH_METERS) * 100}%`,
  };
}
