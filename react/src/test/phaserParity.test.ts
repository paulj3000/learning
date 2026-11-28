import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BOLTS_WORKSHOP_INTERACTIONS,
  CASTLE_WRITING_ROOM_INTERACTIONS,
  DRAGONS_SANCTUARY_INTERACTIONS,
  FOSSIL_RIDGE_CAMP_INTERACTIONS,
  PIRATE_BUILDER_BAY_INTERACTIONS,
  STORYKEEPER_CASTLE_INTERACTIONS,
  WELCOME_HARBOR_INTERACTIONS,
  WONDERWILD_FOREST_INTERACTIONS,
  type WorldInteraction,
} from '../features/island-map/worldObjects';
import { SOURCE_LOCATION_MANIFESTS } from '../features/island-map/three/runtime/manifests';

/**
 * LAI-2301R: Phaser-table parity for every world (audit
 * `docs/engineering/game-engine/phaser-retirement-audit.md` gate G2/G3).
 *
 * The per-world `*Parity.test.tsx` files mostly compare against 3D views that no longer exist.
 * This test compares each Three.js manifest against the **Phaser** interaction table it replaces:
 * - every Phaser interaction is in the manifest with the same id, action and requirements, or is
 *   listed in `GAPS` (a known gap, with the ticket that closes it) or `RENAMED`;
 * - every world change the Phaser scene renders (tile overrides, gated decor) is named somewhere
 *   in the manifest, or is a listed gap.
 *
 * Gaps may only shrink: a listed gap that the manifest now covers fails until it is removed. A
 * world with no Three.js region (Fossil Ridge Camp, Bolt's Workshop) is checked by
 * `phaserRetirement.test.ts`, not here.
 */

const repo = resolve(__dirname, '../../..');
const islandMap = join(repo, 'react/src/features/island-map');

interface ConvertedWorld {
  world: string;
  regionId: string;
  phaserTable: readonly WorldInteraction[];
  /** The Phaser scene and decor files whose rendered world changes 3D must also show. */
  phaserStateSources: readonly string[];
}

const CONVERTED: readonly ConvertedWorld[] = [
  {
    world: 'Welcome Harbor',
    regionId: 'welcome-harbor',
    phaserTable: WELCOME_HARBOR_INTERACTIONS,
    phaserStateSources: ['scenes/WelcomeHarborScene.ts', 'decor.ts'],
  },
  {
    world: 'Pirate Builder Bay',
    regionId: 'pirate-builder-bay',
    phaserTable: PIRATE_BUILDER_BAY_INTERACTIONS,
    phaserStateSources: ['scenes/PirateBuilderBayScene.ts', 'pirateBuilderBayDecor.ts'],
  },
  {
    world: 'Wonderwild Forest',
    regionId: 'wonderwild-forest',
    phaserTable: WONDERWILD_FOREST_INTERACTIONS,
    phaserStateSources: ['scenes/WonderwildForestScene.ts', 'wonderwildForestDecor.ts'],
  },
  {
    world: 'Storykeeper Castle',
    regionId: 'storykeeper-castle',
    phaserTable: STORYKEEPER_CASTLE_INTERACTIONS,
    phaserStateSources: ['scenes/StorykeeperCastleScene.ts', 'storykeeperCastleDecor.ts'],
  },
  {
    world: "Dragon's Sanctuary",
    regionId: 'dragons-sanctuary',
    phaserTable: DRAGONS_SANCTUARY_INTERACTIONS,
    phaserStateSources: ['scenes/DragonsSanctuaryScene.ts', 'dragonsSanctuaryDecor.ts'],
  },
  {
    world: 'Castle Writing Room',
    regionId: 'castle-writing-room',
    phaserTable: CASTLE_WRITING_ROOM_INTERACTIONS,
    phaserStateSources: ['scenes/CastleWritingRoomScene.ts', 'castleWritingRoomDecor.ts'],
  },
];

/** Phaser interactions the 3D world does not have yet, keyed `regionId/interactionId`. */
const GAPS: Readonly<Record<string, string>> = {
  // LAI-2205 (LAI 04, after the MVP round).
  'dragons-sanctuary/dragons-sanctuary-egg': 'LAI-2205',
  'dragons-sanctuary/dragons-sanctuary-harbor-exit': 'LAI-2205 (the card-page link stands in)',
};

/** Phaser ids the 3D world carries under another id (same action kind). */
const RENAMED: Readonly<Record<string, string>> = {
  'dragons-sanctuary/meet-ember-dragon': 'dragons-sanctuary:talk-to-ember',
};

/** Phaser world changes the 3D world does not render yet, keyed `regionId/changeKey`. */
const STATE_GAPS: Readonly<Record<string, string>> = {};

function manifestFor(regionId: string) {
  const manifest = SOURCE_LOCATION_MANIFESTS.find((m) => m.regionId === regionId);
  if (!manifest) throw new Error(`no manifest for ${regionId}`);
  return manifest;
}

/** Change keys the Phaser files render: tile overrides and decor gated on a change. */
function phaserChangeKeys(files: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const file of files) {
    const text = readFileSync(join(islandMap, file), 'utf8');
    for (const match of text.matchAll(/\b(?:changeKey|requiredChangeKey):\s*'([A-Z0-9_]+)'/g)) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

describe('Phaser-table parity for every converted world (LAI-2301R)', () => {
  it('lists every Phaser world that has a Three.js manifest', () => {
    const scenes = readdirSync(join(islandMap, 'scenes')).filter(
      (f) => f.endsWith('Scene.ts') && f !== 'LocationScene.ts',
    );
    // Eight Phaser scenes: six converted here, Fossil Ridge Camp and Bolt's Workshop not yet.
    expect(scenes).toHaveLength(8);
    expect(CONVERTED.map((w) => w.phaserStateSources[0]).sort()).toEqual(
      scenes
        .filter((f) => !/FossilRidgeCamp|BoltsWorkshop/.test(f))
        .map((f) => `scenes/${f}`)
        .sort(),
    );
    expect(FOSSIL_RIDGE_CAMP_INTERACTIONS.length + BOLTS_WORKSHOP_INTERACTIONS.length).toBe(6);
  });

  for (const world of CONVERTED) {
    describe(world.world, () => {
      it('has every Phaser interaction with the same action and requirements, or a listed gap', () => {
        const byId = new Map(manifestFor(world.regionId).interactions.map((i) => [i.id, i]));
        const missing: string[] = [];
        const differs: string[] = [];
        for (const phaser of world.phaserTable) {
          const key = `${world.regionId}/${phaser.id}`;
          if (key in GAPS) continue;
          const renamed = RENAMED[key];
          const three = byId.get(renamed ?? phaser.id);
          if (!three) {
            missing.push(key);
          } else if (renamed) {
            if (three.action.kind !== phaser.action.kind) differs.push(`${key} (action kind)`);
          } else if (
            JSON.stringify(three.action) !== JSON.stringify(phaser.action) ||
            JSON.stringify(three.requirements ?? []) !== JSON.stringify(phaser.requirements ?? [])
          ) {
            differs.push(key);
          }
        }
        expect(missing, 'Phaser interactions missing in 3D (add them, or list a gap)').toEqual([]);
        expect(differs, 'Phaser interactions whose 3D action or requirements differ').toEqual([]);
      });

      it('lists only gaps that are still gaps (the list may only shrink)', () => {
        const ids = new Set(manifestFor(world.regionId).interactions.map((i) => i.id));
        const prefix = `${world.regionId}/`;
        const closed = Object.keys(GAPS)
          .filter((key) => key.startsWith(prefix))
          .filter((key) => ids.has(key.slice(prefix.length)));
        expect(closed, 'gaps the manifest now covers: remove them from GAPS').toEqual([]);
        const unknown = Object.keys(GAPS)
          .filter((key) => key.startsWith(prefix))
          .filter((key) => !world.phaserTable.some((p) => `${prefix}${p.id}` === key));
        expect(unknown, 'gaps that are not Phaser interactions').toEqual([]);
      });

      it('renders every Phaser world change, or lists it as a gap', () => {
        const manifestText = JSON.stringify(manifestFor(world.regionId));
        const missing: string[] = [];
        const closed: string[] = [];
        for (const changeKey of phaserChangeKeys(world.phaserStateSources)) {
          const key = `${world.regionId}/${changeKey}`;
          const present = manifestText.includes(`"${changeKey}"`);
          if (key in STATE_GAPS) {
            if (present) closed.push(key);
          } else if (!present) {
            missing.push(key);
          }
        }
        expect(missing, 'Phaser world changes the 3D world never names').toEqual([]);
        expect(closed, 'state gaps the manifest now covers: remove them').toEqual([]);
      });
    });
  }

  it('reads tile overrides and gated decor from Phaser source', () => {
    expect(phaserChangeKeys(['scenes/WelcomeHarborScene.ts'])).toContain('BRIDGE_REPAIRED');
  });
});
