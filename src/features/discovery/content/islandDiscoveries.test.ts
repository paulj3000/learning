/**
 * Content-integrity checks for the island's secrets. These enforce the
 * Phase 26 design rules that are otherwise easy to erode by editing content:
 * a secret must be openable by something that exists, a locked secret must
 * still say something kind, and no secret may stand between a child and
 * learning content.
 */
import { describe, expect, it } from 'vitest';
import { ISLAND_DISCOVERIES, ISLAND_DISCOVERY_IDS, findIslandDiscovery } from './islandDiscoveries';
import { isDiscoveryOpen } from '../discovery';
import { ISLAND_ITEMS, ISLAND_REWARD_TABLE } from '../../rewards/content';
import { ISLAND_QUESTS } from '../../quests/content';
import { ISLAND_LOCATIONS } from '../../island/locations';
import { ADVENTURE_TEMPLATES } from '../../adventures/content';
import {
  BOLTS_WORKSHOP_INTERACTIONS,
  CASTLE_WRITING_ROOM_INTERACTIONS,
  DRAGONS_SANCTUARY_INTERACTIONS,
  FOSSIL_RIDGE_CAMP_INTERACTIONS,
  PIRATE_BUILDER_BAY_INTERACTIONS,
  STORYKEEPER_CASTLE_INTERACTIONS,
  WELCOME_HARBOR_INTERACTIONS,
  WONDERWILD_FOREST_INTERACTIONS,
} from '../../island-map/worldObjects';
import type { DiscoveryContext } from '../types';

const ITEM_IDS = new Set(ISLAND_ITEMS.map((item) => item.id));
const QUEST_IDS = new Set(ISLAND_QUESTS.map((quest) => quest.id));

/**
 * Welcome Harbor is the island hub rather than an `IslandLocation` card
 * (`src/features/island/locations.ts` deliberately omits it), so it is added
 * here by name. Every other slug must be a real location.
 */
const LOCATION_SLUGS = new Set([
  'welcome-harbor',
  ...ISLAND_LOCATIONS.map((location) => location.slug),
]);

/** Every world-change key any authored adventure or quest can record. */
const RECORDABLE_CHANGE_KEYS = new Set([
  ...ADVENTURE_TEMPLATES.flatMap((template) =>
    template.steps
      .map((step) => step.presentation)
      .filter((presentation) => presentation.kind === 'world-change')
      .map((presentation) => presentation.payload.changeKey),
  ),
  ...ISLAND_QUESTS.flatMap((quest) => [
    ...quest.stages.flatMap((stage) => (stage.worldChanges ?? []).map((c) => c.changeKey)),
    ...(quest.completion.worldChanges ?? []).map((c) => c.changeKey),
  ]),
]);

/** Item ids the reward table can actually put in a backpack. */
const GRANTABLE_ITEM_IDS = new Set(ISLAND_REWARD_TABLE.flatMap((rule) => [...rule.itemIds]));

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

const REACHED_DISCOVERY_IDS = new Set(
  ALL_INTERACTIONS.filter((interaction) => interaction.action.kind === 'DISCOVER').map(
    (interaction) => (interaction.action as { kind: 'DISCOVER'; discoveryId: string }).discoveryId,
  ),
);

describe('ISLAND_DISCOVERIES', () => {
  it('has unique ids, and exports them as the vocabulary stored ids are checked against', () => {
    expect(new Set(ISLAND_DISCOVERY_IDS).size).toBe(ISLAND_DISCOVERIES.length);
    expect([...ISLAND_DISCOVERY_IDS].sort()).toEqual(
      ISLAND_DISCOVERIES.map((discovery) => discovery.id).sort(),
    );
  });

  it('hides something in every region Phases 10, 11, 13, and 14 built', () => {
    const slugs = new Set(ISLAND_DISCOVERIES.map((discovery) => discovery.locationSlug));
    for (const slug of [
      'welcome-harbor',
      'pirate-builder-bay',
      'wonderwild-forest',
      'storykeeper-castle',
    ]) {
      expect(slugs.has(slug), `nothing is hidden in ${slug}`).toBe(true);
    }
  });

  it('covers every kind Phase 26 names, so no deliverable is only theoretical', () => {
    const kinds = new Set(ISLAND_DISCOVERIES.map((discovery) => discovery.kind));
    expect(kinds.has('HIDDEN_CAVE')).toBe(true);
    expect(kinds.has('SECRET_PASSAGE')).toBe(true);
    expect(kinds.has('LOCKED_DOOR')).toBe(true);
  });

  it('hides everything at a real island location', () => {
    for (const discovery of ISLAND_DISCOVERIES) {
      expect(LOCATION_SLUGS.has(discovery.locationSlug), discovery.id).toBe(true);
    }
  });

  /**
   * The rule that matters most for a child: a locked door whose key nothing
   * grants is a dead end they could walk up to forever. Checked per
   * requirement against the content that feeds it.
   */
  it('only requires things the island can actually produce', () => {
    for (const discovery of ISLAND_DISCOVERIES) {
      for (const requirement of discovery.requirements) {
        const where = `${discovery.id}: ${requirement.type}`;
        switch (requirement.type) {
          case 'ALWAYS':
            break;
          case 'ITEM_OWNED':
            expect(ITEM_IDS.has(requirement.itemId), `${where} names an unknown item`).toBe(true);
            expect(
              GRANTABLE_ITEM_IDS.has(requirement.itemId),
              `${where} names "${requirement.itemId}", which no reward rule grants`,
            ).toBe(true);
            break;
          case 'WORLD_CHANGE_PRESENT':
            expect(
              RECORDABLE_CHANGE_KEYS.has(requirement.changeKey),
              `${where} names "${requirement.changeKey}", which nothing records`,
            ).toBe(true);
            break;
          case 'DISCOVERY_PRESENT':
            expect(
              ISLAND_DISCOVERY_IDS.includes(requirement.discoveryId),
              `${where} names an unknown discovery`,
            ).toBe(true);
            break;
        }
      }
    }
  });

  /**
   * Requiring something is only safe if the thing that provides it can be
   * reached without already having passed through this secret. Walking the
   * chain forward from an empty child proves there is no knot: every secret
   * becomes reachable eventually, and none of them waits on itself.
   */
  it('can be fully explored starting from a child who has done nothing', () => {
    const owned = new Set<string>();
    const found = new Set<string>();
    const changes = new Set<string>();

    // The two world changes the authored chain needs come from adventures a
    // child plays normally, not from a secret; seeding them models the child
    // having simply played the island.
    for (const key of RECORDABLE_CHANGE_KEYS) changes.add(key);

    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const discovery of ISLAND_DISCOVERIES) {
        if (found.has(discovery.id)) continue;
        const context: DiscoveryContext = {
          worldChangeKeys: [...changes],
          ownedItemIds: [...owned],
          discoveredIds: [...found],
        };
        if (!isDiscoveryOpen(discovery, context)) continue;
        found.add(discovery.id);
        progressed = true;
        for (const rule of ISLAND_REWARD_TABLE) {
          if (rule.trigger.type === 'DISCOVERY' && rule.trigger.discoveryKey === discovery.id) {
            for (const itemId of rule.itemIds) owned.add(itemId);
          }
        }
      }
    }

    expect([...found].sort()).toEqual([...ISLAND_DISCOVERY_IDS].sort());
  });

  it('is reachable in the world: every secret has an interaction that opens it', () => {
    for (const discovery of ISLAND_DISCOVERIES) {
      expect(
        REACHED_DISCOVERY_IDS.has(discovery.id),
        `${discovery.id} has no world interaction pointing at it`,
      ).toBe(true);
    }
  });

  it('has no world interaction pointing at a secret that does not exist', () => {
    for (const discoveryId of REACHED_DISCOVERY_IDS) {
      expect(findIslandDiscovery(discoveryId), `nothing defines "${discoveryId}"`).not.toBeNull();
    }
  });

  it('starts only quests that exist', () => {
    for (const discovery of ISLAND_DISCOVERIES) {
      if (!discovery.startsQuestId) continue;
      expect(QUEST_IDS.has(discovery.startsQuestId), discovery.id).toBe(true);
    }
  });

  it('records world changes only at real island locations', () => {
    for (const discovery of ISLAND_DISCOVERIES) {
      if (!discovery.worldChange) continue;
      expect(LOCATION_SLUGS.has(discovery.worldChange.locationSlug), discovery.id).toBe(true);
    }
  });

  it('states requirements explicitly, so an empty array can only be a slip', () => {
    for (const discovery of ISLAND_DISCOVERIES) {
      expect(discovery.requirements.length, discovery.id).toBeGreaterThan(0);
    }
  });

  /**
   * A locked secret is never a taunt. Both lines must exist and say
   * something, including on secrets that are open to everyone: requirements
   * can be added later, and a missing line would then leave a child staring
   * at nothing.
   */
  it('gives every secret both a reveal line and a kind locked line', () => {
    for (const discovery of ISLAND_DISCOVERIES) {
      expect(discovery.title.length, discovery.id).toBeGreaterThan(0);
      expect(discovery.revealMessage.length, discovery.id).toBeGreaterThan(0);
      expect(discovery.lockedMessage.length, discovery.id).toBeGreaterThan(0);
      expect(discovery.lockedMessage, discovery.id).not.toMatch(
        /you can't|you cannot|not allowed|denied|no entry|go away/i,
      );
    }
  });

  it('avoids em dashes in child-facing copy (CLAUDE.md section 13)', () => {
    for (const discovery of ISLAND_DISCOVERIES) {
      for (const line of [discovery.title, discovery.revealMessage, discovery.lockedMessage]) {
        expect(line, `${discovery.id}: "${line}"`).not.toContain('—');
      }
    }
  });

  /**
   * CLAUDE.md pillar 7 and the roadmap's calm-engagement rules both rule out
   * putting a lesson behind a puzzle. No secret may unlock a location, and
   * no adventure or story may sit behind one: everything a secret gives is
   * treasure, flavor, or an optional quest.
   */
  it('gates no learning content: no secret unlocks a location', () => {
    const unlockKeys = new Set(
      ISLAND_LOCATIONS.map((location) => location.unlockRequirement?.changeKey).filter(
        (key): key is string => Boolean(key),
      ),
    );
    for (const discovery of ISLAND_DISCOVERIES) {
      if (!discovery.worldChange) continue;
      expect(
        unlockKeys.has(discovery.worldChange.changeKey),
        `${discovery.id} unlocks a location`,
      ).toBe(false);
    }
  });

  it('grants no reward that is required to reach an adventure', () => {
    // Every `START_ADVENTURE` interaction on the island, and what it needs.
    const adventureRequirements = ALL_INTERACTIONS.filter(
      (interaction) => interaction.action.kind === 'START_ADVENTURE',
    ).flatMap((interaction) => interaction.requirements ?? []);

    for (const requirement of adventureRequirements) {
      expect(requirement.type).not.toBe('ITEM_OWNED');
      expect(requirement.type).not.toBe('DISCOVERY_PRESENT');
    }
  });
});

describe('findIslandDiscovery', () => {
  it('finds authored content and returns null otherwise', () => {
    expect(findIslandDiscovery('harbor-tide-pool')?.kind).toBe('HIDDEN_OBJECT');
    expect(findIslandDiscovery('not-a-secret')).toBeNull();
  });
});
