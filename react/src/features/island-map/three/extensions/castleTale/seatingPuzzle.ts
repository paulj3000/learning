import { Object3D } from 'three';
import type { WorldExtensionContext } from '../../runtime/extensionRegistry';

/**
 * A row of things a child carries, one at a time, into a row of slots
 * (engine Phase 9, lifted from `storykeeperCastleScene.ts`).
 *
 * Storykeeper Castle has three of these: three story plates into a lectern
 * (beat 6), three clues onto a wall (beat 9), three rods into a lock (beat
 * 10). They differ only in what the things are and where the slots sit, so
 * they share one implementation - if they did not, the day one of them
 * stopped letting a child lift a seated item back out would be the day two
 * beats disagreed about whether a mistake costs anything.
 *
 * **It owns where things are and no part of whether the row is right.**
 * Seating the last one emits `BuildActionRequested` with the arrangement
 * and stops; the bindings turn it into an answer and the Adventure Engine
 * grades it.
 *
 * It works through the generic runtime rather than around it: each piece is
 * a manifest prop, so the runtime created its root, raycasts it and labels
 * it. Carrying one re-parents that root to the camera - which also takes it
 * out of the raycast by itself, since a plate hanging 15cm off the end of
 * the camera would otherwise be the nearest hit every frame and the child
 * could never aim at the lectern.
 */
export interface SeatingPuzzleOptions {
  context: WorldExtensionContext;
  /** The entity a completed row is reported against - the lectern, the wall, the lock. */
  targetEntityId: string;
  /** The pieces, in the order the manifest places them. */
  pieceEntityIds: readonly string[];
  /** Where each piece sits once seated, in order. */
  slots: readonly { x: number; y: number; z: number }[];
  /** The yaw a seated piece takes, so a row reads as a row. */
  seatedYaw: number;
  /** How far in front of the eyes a carried piece rides, and how far below them. */
  carry: { forward: number; drop: number };
}

export interface SeatingPuzzle {
  readonly targetEntityId: string;
  holdsPiece(entityId: string): boolean;
  carriedId(): string | null;
  /** Picks one up, lifting it back out of a slot if that is where it was. */
  pickUp(entityId: string): void;
  /** Seats what is carried in the next free slot, reporting the row once it is full. */
  seatCarried(): void;
  /**
   * Empties every slot and lays everything back where it started.
   *
   * `active` names the pieces the adventure being played actually uses, and
   * the rest are hidden. Two adventures share the castle's three plates: the
   * Pathfinder tale orders three, the Sprouts picture story orders two.
   * Leaving the spare on the table would let a three-year-old fill a slot
   * with a piece that can never be part of an answer.
   */
  reset(active?: readonly string[]): void;
  /** Keeps a carried piece in front of the camera. Called once per frame. */
  frame(): void;
}

export function createSeatingPuzzle(options: SeatingPuzzleOptions): SeatingPuzzle {
  const { context } = options;
  /** Where each piece was authored, read once from the root the runtime placed. */
  const homes = new Map<string, { x: number; y: number; z: number; yaw: number }>();
  for (const entityId of options.pieceEntityIds) {
    const root = context.entityRoot(entityId);
    if (!root) continue;
    homes.set(entityId, {
      x: root.position.x,
      y: root.position.y,
      z: root.position.z,
      yaw: root.rotation.y,
    });
  }

  const seated: string[] = [];
  let carried: string | null = null;
  let active: readonly string[] = options.pieceEntityIds;

  const rootOf = (entityId: string): Object3D | undefined => context.entityRoot(entityId);

  const restAtHome = (entityId: string): void => {
    const root = rootOf(entityId);
    const home = homes.get(entityId);
    if (!root || !home) return;
    if (root.parent === context.camera) context.scene.add(root);
    context.setFocusable(entityId, true);
    root.position.set(home.x, home.y, home.z);
    root.rotation.y = home.yaw;
  };

  const restSeated = (): void => {
    seated.forEach((entityId, index) => {
      const root = rootOf(entityId);
      const slot = options.slots[index];
      if (!root || !slot) return;
      if (root.parent === context.camera) context.scene.add(root);
      context.setFocusable(entityId, true);
      root.position.set(slot.x, slot.y, slot.z);
      root.rotation.y = options.seatedYaw;
    });
  };

  return {
    targetEntityId: options.targetEntityId,
    holdsPiece: (entityId) => homes.has(entityId),
    carriedId: () => carried,
    pickUp(entityId) {
      if (!homes.has(entityId) || !active.includes(entityId)) return;
      const seatedAt = seated.indexOf(entityId);
      if (seatedAt >= 0) {
        seated.splice(seatedAt, 1);
        restSeated();
      }
      carried = entityId;
      const root = rootOf(entityId);
      if (root) context.camera.add(root);
      // Out of the reticle's reach while it is in their hands, so the child
      // can aim at somewhere to put it down.
      context.setFocusable(entityId, false);
      context.bus.emit('CollectiblePickedUp', { entityId });
    },
    seatCarried() {
      if (!carried) return;
      if (seated.length >= Math.min(active.length, options.slots.length)) return;
      seated.push(carried);
      carried = null;
      restSeated();
      if (seated.length === active.length) {
        context.bus.emit('BuildActionRequested', {
          entityId: options.targetEntityId,
          order: [...seated],
        });
      }
    },
    reset(nextActive) {
      carried = null;
      seated.length = 0;
      if (nextActive && nextActive.length > 0) active = nextActive;
      for (const entityId of options.pieceEntityIds) {
        restAtHome(entityId);
        const root = rootOf(entityId);
        if (root) root.visible = active.includes(entityId);
      }
    },
    frame() {
      if (!carried) return;
      const root = rootOf(carried);
      if (!root || root.parent !== context.camera) return;
      // In front of the eyes and a little below them: the child can see what
      // is in their hands, and the reticle still reads past it.
      root.position.set(0, -options.carry.drop, -options.carry.forward);
      root.rotation.set(0, 0, 0);
      root.updateMatrix();
    },
  };
}
