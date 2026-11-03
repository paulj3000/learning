import type {
  ColliderSpec,
  MaterialPresetSpec,
  RectZone,
  ScenerySpec,
} from '../../locationManifest';

/**
 * What a room contributes to the castle's look (SC-R02), and the two
 * helpers every room module shares. A room's visual pass is one module that
 * exports a `RoomVisuals`; `storykeeperCastleVisuals.ts` aggregates them and
 * builds the manifest fields. Nothing here imports the region or the
 * manifest, so a room module can never reach gameplay.
 */

/** A patch of floor in a second material (a floor medallion, a rug), a hair above the main floor. */
export interface RoomInlay {
  id: string;
  materialId: string;
  area: Omit<RectZone, 'id'>;
}

/** A room's look: the preset ids its surfaces wear. Presets are declared in the room's `materials`. */
export interface RoomLook {
  roomId: string;
  floor: string;
  walls: string;
  ceiling: string;
  /** A lower band of different wall material, from the floor up to `height` metres. */
  wainscot?: { materialId: string; height: number };
  /** A low strip along the foot of every wall, and a cornice along the head. */
  trim?: string;
  /** Patches of floor in another material. */
  inlays?: readonly RoomInlay[];
  /** Drifting dust or magic, capped by the render-quality tier. */
  motes?: { color: number; count: number; minY: number; maxY: number; size?: number; seed: number };
}

export interface RoomVisuals {
  look: RoomLook;
  /** Presets only this room wears. Presets several rooms share are declared once in the core. */
  materials: readonly MaterialPresetSpec[];
  /** Decor with no domain meaning: solid-colour boxes, never raycast. */
  decor: readonly ScenerySpec[];
  /** Colliders for the decor that is solid. */
  colliders: readonly ColliderSpec[];
}

export const rect = (
  id: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): RectZone => ({ id, minX, maxX, minZ, maxZ });

/** A solid-colour box of decor over a ground rectangle, from `minY` to `maxY`. */
export const box = (
  id: string,
  color: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minY: number,
  maxY: number,
): ScenerySpec => ({
  kind: 'BOX',
  id,
  color,
  area: rect(`${id}:area`, minX, maxX, minZ, maxZ),
  minY,
  maxY,
});

/** A collider for solid decor. `id` names the thing, not the box. */
export const solid = (
  id: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  maxY: number,
): ColliderSpec => ({
  rect: rect(`collider:${id}`, minX, maxX, minZ, maxZ),
  minY: 0,
  maxY,
});
