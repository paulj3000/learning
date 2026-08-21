/**
 * Content-integrity checks for the authored cast. These guard the seams that
 * are easy to break by editing content alone: the join to the World Engine's
 * rendered bodies, the location slugs, the "always something to say" rule,
 * and the child-facing copy rules in CLAUDE.md section 13.
 */
import { describe, expect, it } from 'vitest';
import { ISLAND_NPCS, findNpc } from './islandNpcs';
import { findDanglingChoices, selectDialogueNode } from '../dialogue';
import { resolveNpcLocation } from '../schedule';
import { RELATIONSHIP_LEVEL_ORDER, TIME_OF_DAY_ORDER, type NpcContext } from '../types';
import { ISLAND_LOCATIONS } from '../../island/locations';
import {
  DRAGONS_SANCTUARY_INTERACTIONS,
  BOLTS_WORKSHOP_INTERACTIONS,
  PIRATE_BUILDER_BAY_INTERACTIONS,
  STORYKEEPER_CASTLE_INTERACTIONS,
  WELCOME_HARBOR_INTERACTIONS,
  WONDERWILD_FOREST_INTERACTIONS,
  CASTLE_WRITING_ROOM_INTERACTIONS,
  FOSSIL_RIDGE_CAMP_INTERACTIONS,
} from '../../island-map/worldObjects';

const ALL_INTERACTIONS = [
  ...WELCOME_HARBOR_INTERACTIONS,
  ...PIRATE_BUILDER_BAY_INTERACTIONS,
  ...WONDERWILD_FOREST_INTERACTIONS,
  ...STORYKEEPER_CASTLE_INTERACTIONS,
  ...DRAGONS_SANCTUARY_INTERACTIONS,
  ...FOSSIL_RIDGE_CAMP_INTERACTIONS,
  ...CASTLE_WRITING_ROOM_INTERACTIONS,
  ...BOLTS_WORKSHOP_INTERACTIONS,
];

const KNOWN_SLUGS = new Set([
  ...ISLAND_LOCATIONS.map((location) => location.slug),
  // The harbor is the island hub, not an entry in the adventure location list.
  'welcome-harbor',
]);

function context(overrides: Partial<NpcContext> = {}): NpcContext {
  return {
    npcId: 'any',
    timeOfDay: 'MORNING',
    relationshipLevel: 'STRANGER',
    memoryFlags: {},
    worldChangeKeys: [],
    completedQuestIds: [],
    ...overrides,
  };
}

describe('ISLAND_NPCS', () => {
  it('has unique NPC IDs', () => {
    const ids = ISLAND_NPCS.map((npc) => npc.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('joins every NPC to an existing NPC-type world interaction', () => {
    for (const npc of ISLAND_NPCS) {
      const interaction = ALL_INTERACTIONS.find((entry) => entry.id === npc.interactionId);
      expect(interaction, `${npc.id} -> ${npc.interactionId}`).toBeDefined();
      expect(interaction?.type, `${npc.id} interaction type`).toBe('NPC');
    }
  });

  it('uses only known location slugs, home and scheduled alike', () => {
    for (const npc of ISLAND_NPCS) {
      expect(KNOWN_SLUGS.has(npc.homeLocationSlug), `${npc.id} home`).toBe(true);
      for (const entry of npc.schedule) {
        expect(KNOWN_SLUGS.has(entry.locationSlug), `${npc.id} @ ${entry.timeOfDay}`).toBe(true);
      }
    }
  });

  it('never schedules an NPC into the same time bucket twice', () => {
    for (const npc of ISLAND_NPCS) {
      const buckets = npc.schedule.map((entry) => entry.timeOfDay);
      expect(new Set(buckets).size, `${npc.id} schedule`).toBe(buckets.length);
    }
  });

  it('is reachable in every time bucket', () => {
    for (const npc of ISLAND_NPCS) {
      for (const timeOfDay of TIME_OF_DAY_ORDER) {
        expect(resolveNpcLocation(npc, timeOfDay).locationSlug, npc.id).toBeTruthy();
      }
    }
  });

  it('always has something to say, at every relationship level', () => {
    for (const npc of ISLAND_NPCS) {
      for (const level of RELATIONSHIP_LEVEL_ORDER) {
        const node = selectDialogueNode(npc, context({ npcId: npc.id, relationshipLevel: level }));
        expect(node, `${npc.id} at ${level}`).not.toBeNull();
        expect(node?.text.length, `${npc.id} at ${level} text`).toBeGreaterThan(0);
      }
    }
  });

  it('has no dialogue choice pointing at a missing node', () => {
    for (const npc of ISLAND_NPCS) {
      expect(findDanglingChoices(npc), npc.id).toEqual([]);
    }
  });

  it('has unique dialogue node IDs within each NPC', () => {
    for (const npc of ISLAND_NPCS) {
      const ids = npc.dialogue.map((node) => node.id);
      expect(new Set(ids).size, npc.id).toBe(ids.length);
    }
  });

  it('avoids em dashes in all child-facing copy (CLAUDE.md section 13)', () => {
    for (const npc of ISLAND_NPCS) {
      for (const node of npc.dialogue) {
        expect(node.text, `${npc.id}/${node.id}`).not.toContain('—');
        for (const choice of node.choices) {
          expect(choice.label, `${npc.id}/${choice.id}`).not.toContain('—');
        }
      }
    }
  });

  it('gives every narration hint an authored fallback matching the node text', () => {
    for (const npc of ISLAND_NPCS) {
      for (const node of npc.dialogue) {
        if (!node.narration) continue;
        expect(node.narration.allowedTopic.length, `${npc.id}/${node.id}`).toBeGreaterThan(0);
        // The fallback must be the authored line itself, so a failed or
        // disabled AI call renders exactly what the designer approved.
        expect(node.narration.fallbackText, `${npc.id}/${node.id}`).toBe(node.text);
      }
    }
  });

  it('keeps most dialogue authored-only rather than silently adding AI surfaces', () => {
    const total = ISLAND_NPCS.flatMap((npc) => npc.dialogue);
    const narrated = total.filter((node) => node.narration);
    expect(narrated.length).toBeLessThan(total.length);
  });

  it('has unique quest IDs across the whole cast', () => {
    const questIds = ISLAND_NPCS.flatMap((npc) => npc.questOffers.map((offer) => offer.questId));
    expect(new Set(questIds).size).toBe(questIds.length);
  });
});

describe('findNpc', () => {
  it('finds an authored NPC and returns null otherwise', () => {
    expect(findNpc('pirate-pip')?.displayName).toBe('Pirate Pip');
    expect(findNpc('not-a-real-npc')).toBeNull();
  });
});
