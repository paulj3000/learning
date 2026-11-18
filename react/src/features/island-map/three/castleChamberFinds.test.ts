import { describe, expect, it } from 'vitest';
import { findIslandDiscovery } from '../../discovery/content';
import { ALL_REWARD_RULES } from '../../rewards/content';
import { ISLAND_QUESTS } from '../../quests/content';
import { areRequirementsMet, type WorldInteractionContext } from '../worldObjects';
import { CASTLE_CHAMBER_INTERACTIONS } from './castleChamber';
import { CASTLE_ROOM_IDS, SECRET_PASSAGE_DISCOVERY_ID, castleRoomAt } from './castleLayout';
import { manifestForBand } from './runtime/manifestForBand';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './runtime/manifests/storykeeperCastle';
import { isReached, reachableCells, zoneIsEnterable } from './runtime/testing/castleReachability';
import { CHAMBER_FIND_SPOTS, ZONES, ARCHWAYS } from './storykeeperCastleRegion';
import { STORYKEEPER_CASTLE_CHECKPOINTS } from '../../discovery/checkpoints';

/**
 * SC-R08-02: two more hidden discoveries in the Secret Chamber, following the tapestry nook's
 * pattern. Both are gated on the nook, both are found by walking up (no aim), and finding one
 * records the discovery and nothing else.
 */

const FIND_IDS = ['castle-chamber-star', 'castle-chamber-mouse-door'] as const;
const NOTHING: WorldInteractionContext = { worldChangeKeys: [], ownedItemIds: [], discoveryIds: [] };
const NOOK: WorldInteractionContext = { ...NOTHING, discoveryIds: [SECRET_PASSAGE_DISCOVERY_ID] };
const interactionOf = (id: string) => CASTLE_CHAMBER_INTERACTIONS.find((i) => i.id === id)!;
const zoneOf = (id: string) => ZONES.find((z) => z.id === id)!;
const overlaps = (
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

describe.each(FIND_IDS)('the chamber find %s', (id) => {
  it('is an APPROACH discovery that names itself, with a zone', () => {
    const interaction = interactionOf(id);
    expect(interaction.trigger).toBe('APPROACH');
    expect(interaction.action).toEqual({ kind: 'DISCOVER', discoveryId: id });
    expect(interaction.zoneId).toBe(id);
    expect(zoneOf(id)).toBeDefined();
  });

  it('is unavailable before the nook is found and available after', () => {
    const { requirements } = interactionOf(id);
    expect(areRequirementsMet(requirements, NOTHING)).toBe(false);
    expect(areRequirementsMet(requirements, NOOK)).toBe(true);
  });

  it('is never in a "Things to do" list', () => {
    expect(MANIFEST.hiddenInteractionIds).toContain(id);
  });

  it('is a known discovery in the manifest registry and the island content', () => {
    expect(findIslandDiscovery(id)).not.toBeNull();
  });

  it('has a zone inside the chamber, clear of the exit, the door, the crystals and the other find', () => {
    const zone = zoneOf(id);
    expect(castleRoomAt((zone.minX + zone.maxX) / 2, (zone.minZ + zone.maxZ) / 2)?.id).toBe(
      'secret-chamber',
    );
    const passage = ARCHWAYS.find((a) => a.id === 'arch-secret')!.gap;
    expect(overlaps(zone, passage), 'blocks the way out').toBe(false);
    for (const other of ZONES) {
      if (other.id === id) continue;
      expect(overlaps(zone, other), `overlaps ${other.id}`).toBe(false);
    }
    for (const collider of MANIFEST.colliders) {
      expect(overlaps(zone, collider.rect), `overlaps ${collider.rect.id}`).toBe(false);
    }
    const spawn = STORYKEEPER_CASTLE_CHECKPOINTS[0];
    expect(spawn.x < zone.minX || spawn.x > zone.maxX || spawn.z < zone.minZ || spawn.z > zone.maxZ).toBe(true);
  });

  it('can be reached on foot once the nook is found', () => {
    const reached = reachableCells(MANIFEST, STORYKEEPER_CASTLE_CHECKPOINTS[0], NOOK);
    expect(zoneIsEnterable(reached, zoneOf(id))).toBe(true);
    expect(isReached(reached, -11, -5)).toBe(true);
  });

  it('is the same for a Sprout: walking up is enough, and the reticle is off', () => {
    const sprout = manifestForBand(MANIFEST, 'SPROUT');
    expect(sprout.zones.some((zone) => zone.rect.id === id)).toBe(true);
    expect(sprout.hiddenInteractionIds).toContain(id);
    expect(MANIFEST.noReticleBands).toEqual(['SPROUT']);
  });

  it('grants nothing: no reward rule, quest start or item, only the discovery record and its world change', () => {
    const definition = findIslandDiscovery(id)!;
    expect(definition.startsQuestId).toBeUndefined();
    expect(definition.requirements).toEqual([
      { type: 'DISCOVERY_PRESENT', discoveryId: SECRET_PASSAGE_DISCOVERY_ID },
    ]);
    for (const rule of ALL_REWARD_RULES) {
      expect(JSON.stringify(rule.trigger), rule.id).not.toContain(id);
    }
    for (const quest of ISLAND_QUESTS) {
      expect(JSON.stringify(quest), quest.id).not.toContain(id);
    }
    expect(definition.worldChange?.locationSlug).toBe('storykeeper-castle');
  });

  it('reads aloud: no em dash, short sentences', () => {
    const definition = findIslandDiscovery(id)!;
    for (const text of [definition.title, definition.lockedMessage, definition.revealMessage]) {
      expect(text).not.toMatch(/[—–]/);
      for (const sentence of text.split(/(?<=[.?!])\s+/)) {
        expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(22);
      }
    }
  });
});

describe('the chamber finds as scenery', () => {
  it('stand on the wall faces of the chamber, one box each, and stay inside the chamber budget', () => {
    const boxes = MANIFEST.scenery.filter(
      (item) => item.kind === 'BOX' && /^castle-chamber-(star-glint|mouse-door-small)$/.test(item.id),
    );
    expect(boxes).toHaveLength(2);
    for (const spot of CHAMBER_FIND_SPOTS) {
      expect(castleRoomAt(spot.x, spot.z)?.id).toBe('secret-chamber');
    }
    expect(CASTLE_ROOM_IDS).toContain('secret-chamber');
  });
});
