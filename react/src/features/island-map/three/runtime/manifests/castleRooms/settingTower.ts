import { OBSERVATORY_CHART_STAR_COUNT } from '../../../castleObservatory';
import { box, solid, type RoomVisuals } from './castleVisualKit';

/**
 * The Setting Tower's look (SC-R02-04d): cool stone and a star-dust sky.
 * The tower is also the castle's Observatory (the reboot roadmap merges the
 * two), so its first brass instrument arrives here: a small orrery in the
 * north-east corner. SC-R03-04 adds the telescope and the observing
 * interactions. The compass medallion on the floor reuses the Entry Hall's
 * blue and gold tile preset.
 *
 * The three windows are the room's choice (`choose-setting`), made by
 * standing at one, so their zones (x 6.3 to 9.6, z 5.4 to 9.6) and the
 * arrival zone (x 5.4 to 6.2, z 6.6 to 8.4) stay clear. The orrery stands
 * in the one corner none of them touches.
 */

const BRASS_DARK = 0x6b5a3a;
const BRASS = 0xc9a24a;
const PLANET = 0x4a7ac2;
const TELESCOPE_BODY = 0x3d4f6e;
const LENS = 0xcfe6f0;
const CHART_FRAME = 0x5a3b25;
const CHART_NIGHT = 0x1b2a55;
const CHART_STAR = 0xf2c94c;

/**
 * The big telescope in the south-west corner (SC-R03-04). Its base is solid;
 * the tube is a stylised box above the walkway's height and never solid.
 * Standing at it is the `castle-observatory-telescope` zone.
 */
export const TOWER_TELESCOPE = { x: 5.9, z: 5.8, half: 0.25, height: 0.9 } as const;

/** The star chart on the west wall, clear of the archway frame (z 6.5 to 8.5, and a hand either side). */
export const TOWER_STAR_CHART = { x: 5.29, minZ: 9, maxZ: 9.65, minY: 1.1, maxY: 2.2 } as const;

/** The orrery's centre, matching nothing authored: the north-east corner is free floor. */
export const TOWER_ORRERY = { x: 9.05, z: 9.05, half: 0.4 } as const;

/** Where the chart's gold stars sit, as [distance along the chart, height]. Exactly `OBSERVATORY_CHART_STAR_COUNT` of them. */
const STAR_DOTS: readonly (readonly [number, number])[] = [
  [0.14, 1.95],
  [0.32, 1.75],
  [0.5, 1.98],
  [0.22, 1.45],
  [0.46, 1.3],
];
if (STAR_DOTS.length !== OBSERVATORY_CHART_STAR_COUNT) {
  throw new Error(
    'The star chart must draw exactly the number of stars the message invites a child to count',
  );
}

export const SETTING_TOWER_VISUALS: RoomVisuals = {
  look: {
    roomId: 'setting-tower',
    floor: 'flagstone-tower',
    walls: 'ashlar-tower',
    ceiling: 'plaster-entry',
    trim: 'trim-dark-wood',
    mood: { color: 0xcfe0ff, priority: 3 },
    // A compass medallion under the room's centre.
    inlays: [
      {
        id: 'compass',
        materialId: 'tiles-entry-inlay',
        area: { minX: 6.5, maxX: 8.5, minZ: 6.5, maxZ: 8.5 },
      },
    ],
    // Star dust, cool and slow.
    motes: { color: 0xcfe0ff, count: 30, minY: 0.5, maxY: 2.8, size: 0.04, seed: 11 },
  },
  materials: [
    {
      id: 'flagstone-tower',
      pattern: 'FLAGSTONE',
      baseColor: 0x9aa3ad,
      accentColor: 0x6d7680,
      roughness: 0.85,
      metersPerRepeat: 2,
      seed: 71,
    },
    {
      id: 'ashlar-tower',
      pattern: 'ASHLAR',
      baseColor: 0xa9b1bb,
      accentColor: 0x78818c,
      roughness: 0.9,
      metersPerRepeat: 2,
      seed: 72,
    },
  ],
  decor: [
    box(
      'castle-orrery-base',
      BRASS_DARK,
      TOWER_ORRERY.x - TOWER_ORRERY.half,
      TOWER_ORRERY.x + TOWER_ORRERY.half,
      TOWER_ORRERY.z - TOWER_ORRERY.half,
      TOWER_ORRERY.z + TOWER_ORRERY.half,
      0,
      0.9,
    ),
    box(
      'castle-orrery-ring',
      BRASS,
      TOWER_ORRERY.x - 0.3,
      TOWER_ORRERY.x + 0.3,
      TOWER_ORRERY.z - 0.3,
      TOWER_ORRERY.z + 0.3,
      0.9,
      0.94,
    ),
    box(
      'castle-orrery-planet',
      PLANET,
      TOWER_ORRERY.x - 0.1,
      TOWER_ORRERY.x + 0.1,
      TOWER_ORRERY.z - 0.1,
      TOWER_ORRERY.z + 0.1,
      0.94,
      1.14,
    ),
    // The big telescope: a solid stand, a tube and a lens, pointing out along the south-west corner.
    box(
      'castle-telescope-stand',
      TELESCOPE_BODY,
      TOWER_TELESCOPE.x - TOWER_TELESCOPE.half,
      TOWER_TELESCOPE.x + TOWER_TELESCOPE.half,
      TOWER_TELESCOPE.z - TOWER_TELESCOPE.half,
      TOWER_TELESCOPE.z + TOWER_TELESCOPE.half,
      0,
      TOWER_TELESCOPE.height,
    ),
    box(
      'castle-telescope-tube',
      TELESCOPE_BODY,
      TOWER_TELESCOPE.x - 0.09,
      TOWER_TELESCOPE.x + 0.09,
      TOWER_TELESCOPE.z - 0.45,
      TOWER_TELESCOPE.z + 0.3,
      1.1,
      1.28,
    ),
    box(
      'castle-telescope-lens',
      LENS,
      TOWER_TELESCOPE.x - 0.07,
      TOWER_TELESCOPE.x + 0.07,
      TOWER_TELESCOPE.z - 0.5,
      TOWER_TELESCOPE.z - 0.45,
      1.12,
      1.26,
    ),
    // The star chart: a night-blue panel in a wooden frame, with gold stars to count.
    box(
      'castle-star-chart-frame',
      CHART_FRAME,
      TOWER_STAR_CHART.x,
      TOWER_STAR_CHART.x + 0.09,
      TOWER_STAR_CHART.minZ,
      TOWER_STAR_CHART.maxZ,
      TOWER_STAR_CHART.minY,
      TOWER_STAR_CHART.maxY,
    ),
    box(
      'castle-star-chart-sky',
      CHART_NIGHT,
      TOWER_STAR_CHART.x + 0.05,
      TOWER_STAR_CHART.x + 0.12,
      TOWER_STAR_CHART.minZ + 0.05,
      TOWER_STAR_CHART.maxZ - 0.05,
      TOWER_STAR_CHART.minY + 0.05,
      TOWER_STAR_CHART.maxY - 0.05,
    ),
    ...STAR_DOTS.map(([along, y], index) =>
      box(
        `castle-star-chart-star-${index + 1}`,
        CHART_STAR,
        TOWER_STAR_CHART.x + 0.12,
        TOWER_STAR_CHART.x + 0.15,
        TOWER_STAR_CHART.minZ + along - 0.03,
        TOWER_STAR_CHART.minZ + along + 0.03,
        y - 0.03,
        y + 0.03,
      ),
    ),
  ],
  colliders: [
    solid(
      'tower-telescope',
      TOWER_TELESCOPE.x - TOWER_TELESCOPE.half,
      TOWER_TELESCOPE.x + TOWER_TELESCOPE.half,
      TOWER_TELESCOPE.z - TOWER_TELESCOPE.half,
      TOWER_TELESCOPE.z + TOWER_TELESCOPE.half,
      TOWER_TELESCOPE.height,
    ),
    solid(
      'tower-orrery',
      TOWER_ORRERY.x - TOWER_ORRERY.half,
      TOWER_ORRERY.x + TOWER_ORRERY.half,
      TOWER_ORRERY.z - TOWER_ORRERY.half,
      TOWER_ORRERY.z + TOWER_ORRERY.half,
      1.14,
    ),
  ],
};
