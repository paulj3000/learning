import { describe, expect, it } from 'vitest';
import { archwayRotationY, wallPanelPlacements } from './storykeeperCastleScene';
import { ARCHWAYS, ROOMS, WALL_SEGMENTS, WALL_THICKNESS } from './storykeeperCastleRegion';

/**
 * `createStorykeeperCastleEngine` itself stays untested, like every other
 * scene file: it needs a real WebGL/DOM context. What is tested here is the
 * pure placement math it feeds the renderer, and specifically the one class
 * of mistake that a collider test cannot catch and a child would obey
 * anyway: a wall panel drawn across an archway. The collider would still
 * let them through, so the flood fill in `storykeeperCastleRegion.test.ts`
 * would keep passing while the castle showed them a solid wall.
 */

/**
 * The world-space footprint of one placed panel, as a rect.
 *
 * `thickness` inflates the thin axis. A panel is a plane, so its own
 * footprint is a zero-thickness line - and comparing a zero-thickness line
 * against an archway gap is very nearly vacuous, because a panel sitting
 * legitimately on its room's inner face lands exactly on the gap rect's
 * boundary and a strict overlap test then always reports "no". Inflating
 * the thin axis by the same half-wall-thickness the panel is inset by puts
 * the panel back in the wall band the gap is cut through, so the long-axis
 * comparison is the one that decides - which is the comparison that matters.
 */
function panelFootprint(
  placement: {
    position: { x: number; z: number };
    rotationY?: number;
    scale?: { x?: number };
  },
  thickness = 0,
) {
  const width = 2 * (placement.scale?.x ?? 1);
  const angle = placement.rotationY ?? 0;
  // `runPlacements` lays a panel's local X along its run, so the panel's
  // half-extent runs along (cos, -sin) from its centre.
  const halfX = Math.abs((Math.cos(angle) * width) / 2);
  const halfZ = Math.abs((-Math.sin(angle) * width) / 2);
  // Whichever axis the panel does not span is the thin one.
  const padX = halfX < halfZ ? thickness : 0;
  const padZ = halfZ < halfX ? thickness : 0;
  return {
    minX: placement.position.x - halfX - padX,
    maxX: placement.position.x + halfX + padX,
    minZ: placement.position.z - halfZ - padZ,
    maxZ: placement.position.z + halfZ + padZ,
  };
}

const ALL_PANELS = WALL_SEGMENTS.flatMap((wall) =>
  wallPanelPlacements(wall).map((placement) => ({
    wallId: wall.id,
    ...panelFootprint(placement, WALL_THICKNESS / 2),
  })),
);

describe('castle wall panels', () => {
  it('covers each wall segment end to end, with no overhang past it', () => {
    for (const wall of WALL_SEGMENTS) {
      const panels = wallPanelPlacements(wall).map(panelFootprint);
      const spanMinX = Math.min(...panels.map((panel) => panel.minX));
      const spanMaxX = Math.max(...panels.map((panel) => panel.maxX));
      const spanMinZ = Math.min(...panels.map((panel) => panel.minZ));
      const spanMaxZ = Math.max(...panels.map((panel) => panel.maxZ));

      const alongX = wall.maxX - wall.minX >= wall.maxZ - wall.minZ;
      if (alongX) {
        expect(spanMinX, wall.id).toBeCloseTo(wall.minX);
        expect(spanMaxX, wall.id).toBeCloseTo(wall.maxX);
      } else {
        expect(spanMinZ, wall.id).toBeCloseTo(wall.minZ);
        expect(spanMaxZ, wall.id).toBeCloseTo(wall.maxZ);
      }
    }
  });

  /**
   * The invariant this file exists for. An archway gap is 2m wide and a
   * panel is 2m wide, so an off-by-one in the tiling maths puts a whole
   * panel squarely in a doorway.
   */
  it('never draws a panel across an archway gap', () => {
    /*
      Panels are meant to end exactly where a gap begins, so an exact
      boundary comparison reports an overlap on floating-point dust alone
      (a panel run of length 9.25 split five ways lands its last edge on
      -0.9999999999999998 rather than -1). A doorway is 2m wide, so
      anything that genuinely stands in one overlaps it by tens of
      centimetres; 1cm is comfortably below real and comfortably above
      noise.
    */
    const TOLERANCE_METERS = 0.01;
    for (const archway of ARCHWAYS) {
      const gap = archway.gap;
      for (const panel of ALL_PANELS) {
        const overlapX = Math.min(panel.maxX, gap.maxX) - Math.max(panel.minX, gap.minX);
        const overlapZ = Math.min(panel.maxZ, gap.maxZ) - Math.max(panel.minZ, gap.minZ);
        const blocks = overlapX > TOLERANCE_METERS && overlapZ > TOLERANCE_METERS;
        expect(blocks, `${panel.wallId} blocks ${archway.id}`).toBe(false);
      }
    }
  });

  /**
   * Panels are drawn on each room's own inner face rather than on the
   * shared centre line, so two rooms sharing an edge get two surfaces half
   * a wall-thickness apart instead of two coplanar ones that z-fight.
   */
  it('insets every panel onto its own room-facing side of the wall', () => {
    for (const wall of WALL_SEGMENTS) {
      const [, roomId, side] = wall.id.split(':');
      const room = ROOMS.find((candidate) => candidate.id === roomId);
      expect(room, wall.id).toBeDefined();
      const centreX = (wall.minX + wall.maxX) / 2;
      const centreZ = (wall.minZ + wall.maxZ) / 2;

      for (const placement of wallPanelPlacements(wall)) {
        if (side === 'north' || side === 'south') {
          const inward = side === 'north' ? -1 : 1;
          expect(placement.position.z - centreZ, wall.id).toBeCloseTo(
            (inward * WALL_THICKNESS) / 2,
          );
        } else {
          const inward = side === 'east' ? -1 : 1;
          expect(placement.position.x - centreX, wall.id).toBeCloseTo(
            (inward * WALL_THICKNESS) / 2,
          );
        }
      }
    }
  });
});

describe('archwayRotationY', () => {
  it('turns each archway to span its own gap', () => {
    for (const archway of ARCHWAYS) {
      const gap = archway.gap;
      const rotation = archwayRotationY(gap);
      const spansX = gap.maxX - gap.minX >= gap.maxZ - gap.minZ;
      expect(rotation, archway.id).toBeCloseTo(spansX ? 0 : -Math.PI / 2);
    }
  });

  /** Every gap is a doorway, so every one must be clearly long on one axis and thin on the other. */
  it('is unambiguous for every authored gap', () => {
    for (const archway of ARCHWAYS) {
      const width = archway.gap.maxX - archway.gap.minX;
      const depth = archway.gap.maxZ - archway.gap.minZ;
      expect(Math.abs(width - depth), archway.id).toBeGreaterThan(1);
    }
  });
});
