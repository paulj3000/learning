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

/** The orrery's centre, matching nothing authored: the north-east corner is free floor. */
export const TOWER_ORRERY = { x: 9.05, z: 9.05, half: 0.4 } as const;

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
  ],
  colliders: [
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
