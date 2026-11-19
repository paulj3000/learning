import { describe, expect, it } from 'vitest';
import { STORYKEEPER_CASTLE_CHECKPOINTS } from '../../discovery/checkpoints';
import { ISLAND_NPCS } from '../../npc/content/islandNpcs';
import { selectDialogueNode } from '../../npc/dialogue';
import type { NpcContext } from '../../npc/types';
import { HOME_ISLAND_PACK } from '../../worlds/packs/homeIsland';
import { STORYKEEPER_CASTLE_INTERACTIONS } from '../worldObjects';
import { CASTLE_DOORS, CASTLE_ROOMS, DOOR_ENTRY_OFFSET_METERS } from './castleLayout';
import { OBSERVATORY_CHART_STAR_COUNT } from './castleObservatory';
import {
  CASTLE_PLATFORM_GROUPS,
  padFootprint,
} from './runtime/manifests/castleRooms/castlePlatforms';
import { TOWER_ORRERY, TOWER_STAR_CHART, TOWER_TELESCOPE } from './runtime/manifests/castleRooms/settingTower';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './runtime/manifests/storykeeperCastle';
import {
  EMBER_CASTLE_HALF_METERS,
  EMBER_CASTLE_SPOT,
  ORION_COLLIDER_HALF_METERS,
  PROFESSOR_ORION_ID,
  PROFESSOR_ORION_SPOT,
  ROOMS,
  WALL_SEGMENTS,
  type RectZone,
} from './storykeeperCastleRegion';

/**
 * SC-R05: the castle's supporting characters stand clear of everything the castle already has.
 * Professor Orion (SC-R05-03) is a manifest NPC in the Setting Tower; Ember (SC-R05-02) is placed
 * only by the NPC Manager beside the Story Hall hearth (`lai/apps/npcs/ember_content.py`), so her
 * spot is checked here without a manifest body. Both must keep off every zone (the tower windows
 * are `choose-setting` answers), every platform and its `pad:*` zone, every collider and prop,
 * every doorway's approach, and every safe spot and checkpoint.
 */

const ZONE_GAP = 0.1;
const PAD_GAP = 0.15;
const COLLIDER_GAP = 0.1;
const DOOR_GAP = 0.2;
const SAFE_SPOT_RADIUS = 0.3;

const overlaps = (a: RectZone, b: RectZone, margin = 0): boolean =>
  a.minX < b.maxX + margin && b.minX < a.maxX + margin && a.minZ < b.maxZ + margin && b.minZ < a.maxZ + margin;

const square = (id: string, spot: { x: number; z: number }, half: number): RectZone => ({
  id,
  minX: spot.x - half,
  maxX: spot.x + half,
  minZ: spot.z - half,
  maxZ: spot.z + half,
});

const ORION = square('orion', PROFESSOR_ORION_SPOT, ORION_COLLIDER_HALF_METERS);
const EMBER = square('ember', EMBER_CASTLE_SPOT, EMBER_CASTLE_HALF_METERS);

const PADS = CASTLE_PLATFORM_GROUPS.flatMap((group) => group.pads.map((pad) => padFootprint(group, pad)));

const SAFE_SPOTS = [
  ...CASTLE_ROOMS.map((room) => room.safeSpot),
  ...STORYKEEPER_CASTLE_CHECKPOINTS.filter((cp) => cp.regionId === MANIFEST.regionId),
];

const roomFloor = (roomId: string) => ROOMS.find((room) => room.id === roomId)!.floor;

describe.each([
  { name: 'Professor Orion', footprint: ORION, roomId: 'setting-tower', ownCollider: 'collider:professor-orion' },
  { name: 'Ember (castle visit)', footprint: EMBER, roomId: 'story-hall', ownCollider: '' },
])('$name stands clear of the castle', ({ footprint, roomId, ownCollider }) => {
  it('stands inside its room and off every wall', () => {
    const floor = roomFloor(roomId);
    expect(footprint.minX).toBeGreaterThanOrEqual(floor.minX);
    expect(footprint.maxX).toBeLessThanOrEqual(floor.maxX);
    expect(footprint.minZ).toBeGreaterThanOrEqual(floor.minZ);
    expect(footprint.maxZ).toBeLessThanOrEqual(floor.maxZ);
    for (const wall of WALL_SEGMENTS) {
      expect(overlaps(footprint, wall), wall.id).toBe(false);
    }
  });

  it('keeps off every zone, pad zones and the window zones included, by 0.1 m', () => {
    for (const zone of MANIFEST.zones) {
      expect(overlaps(footprint, zone.rect, ZONE_GAP), zone.rect.id).toBe(false);
    }
  });

  it('keeps 0.15 m from every platform, the two Observatory star stones included', () => {
    for (const pad of PADS) {
      expect(overlaps(footprint, pad, PAD_GAP), pad.id).toBe(false);
    }
    for (const platform of MANIFEST.platforming?.platforms ?? []) {
      const rect = square(platform.id, platform.position, platform.size.width / 2);
      expect(overlaps(footprint, rect, PAD_GAP), platform.id).toBe(false);
    }
  });

  it('keeps off every other collider and prop', () => {
    for (const collider of MANIFEST.colliders) {
      if (collider.rect.id === ownCollider || collider.rect.id.startsWith('wall:')) continue;
      expect(overlaps(footprint, collider.rect, COLLIDER_GAP), collider.rect.id).toBe(false);
    }
    for (const prop of MANIFEST.props) {
      const at = square(prop.entityId, prop.position, 0);
      expect(overlaps(footprint, at, SAFE_SPOT_RADIUS), prop.entityId).toBe(false);
    }
    for (const npc of MANIFEST.npcs) {
      if (footprint === ORION && npc.entityId === PROFESSOR_ORION_ID) continue;
      expect(overlaps(footprint, square(npc.entityId, npc.position, 0.45), COLLIDER_GAP), npc.entityId).toBe(false);
    }
  });

  it('blocks no doorway and no safe spot or checkpoint', () => {
    for (const door of CASTLE_DOORS) {
      const vertical = door.gap.maxX - door.gap.minX < door.gap.maxZ - door.gap.minZ;
      const approach: RectZone = vertical
        ? { ...door.gap, minX: door.centre.x - DOOR_ENTRY_OFFSET_METERS, maxX: door.centre.x + DOOR_ENTRY_OFFSET_METERS }
        : { ...door.gap, minZ: door.centre.z - DOOR_ENTRY_OFFSET_METERS, maxZ: door.centre.z + DOOR_ENTRY_OFFSET_METERS };
      expect(overlaps(footprint, approach, DOOR_GAP), door.id).toBe(false);
    }
    for (const spot of SAFE_SPOTS) {
      expect(overlaps(footprint, square('safe', spot, 0), SAFE_SPOT_RADIUS), `${spot.x}, ${spot.z}`).toBe(false);
    }
  });
});

describe('Professor Orion in the Setting Tower (SC-R05-03)', () => {
  it('is clear of the telescope, the orrery and the star chart', () => {
    expect(overlaps(ORION, square('telescope', TOWER_TELESCOPE, TOWER_TELESCOPE.half), COLLIDER_GAP)).toBe(false);
    expect(overlaps(ORION, square('orrery', TOWER_ORRERY, TOWER_ORRERY.half), COLLIDER_GAP)).toBe(false);
    const chart: RectZone = {
      id: 'chart',
      minX: TOWER_STAR_CHART.x - 0.05,
      maxX: TOWER_STAR_CHART.x + 0.05,
      minZ: TOWER_STAR_CHART.minZ,
      maxZ: TOWER_STAR_CHART.maxZ,
    };
    expect(overlaps(ORION, chart, COLLIDER_GAP)).toBe(false);
  });

  it('is a manifest NPC with a solid collider, the stand-in model and his own talk interaction', () => {
    const npc = MANIFEST.npcs.find((candidate) => candidate.entityId === PROFESSOR_ORION_ID)!;
    expect(npc).toMatchObject({
      npcId: 'professor-orion',
      assetId: 'npc-professor-ticktock',
      label: 'Professor Orion',
      idleClip: 'Idle',
      interactionId: 'talk-to-professor-orion',
    });
    expect(npc.position).toEqual({ x: PROFESSOR_ORION_SPOT.x, z: PROFESSOR_ORION_SPOT.z });
    // Faces into the tower (towards -x, +z).
    expect(Math.sin(npc.yaw!)).toBeLessThan(0);
    expect(Math.cos(npc.yaw!)).toBeGreaterThan(0);
    const collider = MANIFEST.colliders.find((c) => c.rect.id === 'collider:professor-orion')!;
    expect(collider.rect).toEqual({ ...ORION, id: 'collider:professor-orion' });
    const talk = STORYKEEPER_CASTLE_INTERACTIONS.find((i) => i.id === 'talk-to-professor-orion')!;
    expect(talk.action).toEqual({ kind: 'TALK_TO', npcId: 'professor-orion' });
    expect(MANIFEST.interactions.map((i) => i.id)).toContain('talk-to-professor-orion');
  });

  it('is in the island pack, the catalog and the castle schedule, with no quest', () => {
    expect(HOME_ISLAND_PACK.npcIds).toContain('professor-orion');
    const orion = ISLAND_NPCS.find((npc) => npc.id === 'professor-orion')!;
    expect(orion.homeLocationSlug).toBe('storykeeper-castle');
    expect(orion.schedule.every((entry) => entry.locationSlug === 'storykeeper-castle')).toBe(true);
    expect(orion.questOffers).toEqual([]);
  });
});

describe('Professor Orion says the right thing (catalog)', () => {
  const orion = ISLAND_NPCS.find((npc) => npc.id === 'professor-orion')!;
  const context = (overrides: Partial<NpcContext> = {}): NpcContext => ({
    npcId: 'professor-orion',
    timeOfDay: 'MORNING',
    relationshipLevel: 'STRANGER',
    memoryFlags: {},
    worldChangeKeys: [],
    completedQuestIds: [],
    ...overrides,
  });

  it('greets a stranger, and the greeting asks what he sees', () => {
    const node = selectDialogueNode(orion, context());
    expect(node?.id).toBe('orion-greeting');
    expect(node?.setsMemoryFlags).toContain('metOrion');
    expect(node?.choices.find((c) => c.label === 'What do you see?')?.nextNodeId).toBe('orion-telescope');
  });

  it('asks a returning friend to count the chart stars, and every count is praised', () => {
    const node = selectDialogueNode(orion, context({ relationshipLevel: 'ACQUAINTANCE' }));
    expect(node?.id).toBe('orion-returning');
    expect(node?.text).toContain('count the gold stars');
    // He names no number a child could be marked wrong about.
    expect(node?.text).not.toContain(String(OBSERVATORY_CHART_STAR_COUNT));
    const praised = orion.dialogue.find((n) => n.id === node?.choices[0].nextNodeId);
    expect(praised?.text.startsWith('Wonderful counting!')).toBe(true);
    const all = orion.dialogue.map((n) => n.text.toLowerCase()).join(' ');
    for (const unkind of ['wrong', 'incorrect', 'try again']) expect(all).not.toContain(unkind);
  });

  it('notices a told story, and a restored Storybook before that', () => {
    expect(selectDialogueNode(orion, context({ worldChangeKeys: ['FIRST_STORY_TOLD'] }))?.id).toBe('orion-story-told');
    expect(
      selectDialogueNode(orion, context({ worldChangeKeys: ['FIRST_STORY_TOLD', 'GREAT_STORYBOOK_RESTORED'] }))?.id,
    ).toBe('orion-storybook-restored');
  });

  it('gives his narrated lines an authored fallback', () => {
    const narrated = orion.dialogue.filter((node) => node.narration);
    expect(narrated.length).toBeGreaterThan(0);
    for (const node of narrated) expect(node.narration?.fallbackText).toBe(node.text);
  });
});
