/**
 * Content-integrity checks for the island's treasure. These enforce the
 * Phase 24 design rules that are otherwise easy to erode by editing content:
 * rewards must attach to content that actually exists, rarity must stay
 * descriptive, and not every reward has to be educational.
 */
import { describe, expect, it } from 'vitest';
import {
  CASTLE_KEEPSAKE_IDS,
  ISLAND_COLLECTIBLE_SETS,
  ISLAND_ITEMS,
  ISLAND_REWARD_TABLE,
  findCollectibleSet,
  findItem,
} from './islandItems';
import { findUnknownRewardItemIds } from '../rewardTable';
import { findUnknownSetItemIds } from '../sets';
import { ADVENTURE_TEMPLATES } from '../../adventures/content';
import { STORY_DEFINITIONS } from '../../story/content';
import { ISLAND_NPCS } from '../../npc/content';
import { ISLAND_QUESTS } from '../../quests/content';
import { RELATIONSHIP_LEVEL_ORDER } from '../../npc/types';
import { ISLAND_DISCOVERIES, ISLAND_DISCOVERY_IDS } from '../../discovery/content';
import { STORYBOOK_PAGES } from '../../great-storybook/pages';

const ITEM_IDS = ISLAND_ITEMS.map((item) => item.id);

describe('ISLAND_ITEMS', () => {
  it('has unique item IDs', () => {
    expect(new Set(ITEM_IDS).size).toBe(ITEM_IDS.length);
  });

  it('gives every item child-facing name and description copy', () => {
    for (const item of ISLAND_ITEMS) {
      expect(item.displayName.length, item.id).toBeGreaterThan(0);
      expect(item.description.length, item.id).toBeGreaterThan(0);
    }
  });

  it('avoids em dashes in child-facing copy (CLAUDE.md section 13)', () => {
    for (const item of ISLAND_ITEMS) {
      expect(item.displayName, item.id).not.toContain('—');
      expect(item.description, item.id).not.toContain('—');
    }
  });

  it('gives every cosmetic a slot, and no non-cosmetic one', () => {
    for (const item of ISLAND_ITEMS) {
      if (item.category === 'COSMETIC') {
        expect(item.cosmeticSlot, item.id).toBeDefined();
      } else {
        expect(item.cosmeticSlot, item.id).toBeUndefined();
      }
    }
  });

  it('hides only collectibles, since hiddenness is about how a thing is found', () => {
    for (const item of ISLAND_ITEMS.filter((entry) => entry.hidden)) {
      expect(item.category, item.id).toBe('COLLECTIBLE');
    }
  });

  it('points every setId at a real set', () => {
    const setIds = new Set(ISLAND_COLLECTIBLE_SETS.map((set) => set.id));
    for (const item of ISLAND_ITEMS.filter((entry) => entry.setId)) {
      expect(setIds.has(item.setId as string), item.id).toBe(true);
    }
  });

  it('carries no learning objective anywhere: some treasure is simply treasure', () => {
    // The roadmap makes this an explicit Phase 24 design rule. An item has
    // nowhere to record a skill or objective, and this asserts no content
    // has smuggled one in under another name.
    for (const item of ISLAND_ITEMS) {
      const keys = Object.keys(item);
      expect(
        keys.filter((key) => /skill|objective|learning|mastery|grade/i.test(key)),
        item.id,
      ).toEqual([]);
    }
  });

  it('includes purely-for-delight treasure with no quest or lesson behind it', () => {
    // Guards the same rule from the other direction: if every item became a
    // quest item, the island would have lost its plain treasure.
    const forDelight = ISLAND_ITEMS.filter(
      (item) => item.category === 'COLLECTIBLE' || item.category === 'COSMETIC',
    );
    expect(forDelight.length).toBeGreaterThan(0);
  });

  it('spreads rarity across the scale without making rare items numerous', () => {
    const rare = ISLAND_ITEMS.filter((item) => item.rarity === 'RARE');
    const common = ISLAND_ITEMS.filter((item) => item.rarity === 'COMMON');
    expect(common.length).toBeGreaterThanOrEqual(rare.length);
  });
});

describe('ISLAND_COLLECTIBLE_SETS', () => {
  it('has unique set IDs', () => {
    const ids = ISLAND_COLLECTIBLE_SETS.map((set) => set.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names only defined items, prizes included', () => {
    expect(findUnknownSetItemIds(ISLAND_COLLECTIBLE_SETS, ISLAND_ITEMS)).toEqual([]);
  });

  it('offers only cosmetics as completion prizes, never something a child needs', () => {
    for (const set of ISLAND_COLLECTIBLE_SETS) {
      if (!set.completionItemId) continue;
      expect(findItem(set.completionItemId)?.category, set.id).toBe('COSMETIC');
    }
  });

  it('keeps every set finishable, with at least one visible item to start from', () => {
    for (const set of ISLAND_COLLECTIBLE_SETS) {
      expect(set.itemIds.length, set.id).toBeGreaterThan(0);
      const visible = set.itemIds.filter((itemId) => !findItem(itemId)?.hidden);
      expect(visible.length, `${set.id} has no visible items`).toBeGreaterThan(0);
    }
  });
});

describe('ISLAND_REWARD_TABLE', () => {
  it('has unique rule IDs', () => {
    const ids = ISLAND_REWARD_TABLE.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('grants only defined items', () => {
    expect(findUnknownRewardItemIds(ISLAND_REWARD_TABLE, ITEM_IDS)).toEqual([]);
  });

  it('gives every rule a child-facing message with no em dash', () => {
    for (const rule of ISLAND_REWARD_TABLE) {
      expect(rule.message.length, rule.id).toBeGreaterThan(0);
      expect(rule.message, rule.id).not.toContain('—');
    }
  });

  it('grants at least one item per rule, so no rule fires with nothing to show', () => {
    for (const rule of ISLAND_REWARD_TABLE) {
      expect(rule.itemIds.length, rule.id).toBeGreaterThan(0);
    }
  });

  it('triggers on adventures that actually exist', () => {
    const slugs = new Set(ADVENTURE_TEMPLATES.map((template) => template.slug));
    for (const rule of ISLAND_REWARD_TABLE) {
      if (rule.trigger.type !== 'ADVENTURE_COMPLETED') continue;
      expect(slugs.has(rule.trigger.templateSlug), rule.id).toBe(true);
    }
  });

  it('triggers on stories that actually exist', () => {
    const slugs = new Set(STORY_DEFINITIONS.map((story) => story.slug));
    for (const rule of ISLAND_REWARD_TABLE) {
      if (rule.trigger.type !== 'STORY_COMPLETED') continue;
      expect(slugs.has(rule.trigger.storySlug), rule.id).toBe(true);
    }
  });

  it('triggers on NPCs and relationship levels that actually exist', () => {
    const npcIds = new Set(ISLAND_NPCS.map((npc) => npc.id));
    for (const rule of ISLAND_REWARD_TABLE) {
      if (rule.trigger.type !== 'NPC_RELATIONSHIP') continue;
      expect(npcIds.has(rule.trigger.npcId), rule.id).toBe(true);
      expect(
        (RELATIONSHIP_LEVEL_ORDER as readonly string[]).includes(rule.trigger.level),
        rule.id,
      ).toBe(true);
    }
  });

  /**
   * The gap that let a real bug ship: `reward-bridge-world-change` named
   * `bridge-repaired` while every authored world change is
   * `BRIDGE_REPAIRED`, so the rule could never fire. A trigger that matches
   * nothing fails silently by design (`resolveRewards` simply returns no
   * grants), so only a content test can catch it.
   */
  it('triggers on world-change keys some adventure can actually record', () => {
    const authoredKeys = new Set(
      ADVENTURE_TEMPLATES.flatMap((template) =>
        template.steps
          .map((step) => step.presentation)
          .filter((presentation) => presentation.kind === 'world-change')
          .map((presentation) => presentation.payload.changeKey),
      ),
    );
    const questKeys = new Set(
      ISLAND_QUESTS.flatMap((quest) => [
        ...quest.stages.flatMap((stage) => (stage.worldChanges ?? []).map((c) => c.changeKey)),
        ...(quest.completion.worldChanges ?? []).map((c) => c.changeKey),
      ]),
    );
    // Phase 26: a secret records a world change too, so a rule may
    // legitimately trigger on one.
    const discoveryKeys = new Set(
      ISLAND_DISCOVERIES.map((discovery) => discovery.worldChange?.changeKey).filter(
        (key): key is string => Boolean(key),
      ),
    );

    // SC-R07-01: a story's completion records a world change too (the Secret Door's key).
    const storyKeys = new Set(STORY_DEFINITIONS.map((story) => story.completionWorldChange.changeKey));

    for (const rule of ISLAND_REWARD_TABLE) {
      if (rule.trigger.type !== 'WORLD_CHANGE') continue;
      expect(
        authoredKeys.has(rule.trigger.changeKey) ||
          questKeys.has(rule.trigger.changeKey) ||
          discoveryKeys.has(rule.trigger.changeKey) ||
          storyKeys.has(rule.trigger.changeKey),
        `${rule.id} triggers on "${rule.trigger.changeKey}", which nothing records`,
      ).toBe(true);
    }
  });

  it('triggers on quests that actually exist', () => {
    const questIds = new Set(ISLAND_QUESTS.map((quest) => quest.id));
    for (const rule of ISLAND_REWARD_TABLE) {
      if (rule.trigger.type !== 'QUEST_COMPLETED') continue;
      expect(questIds.has(rule.trigger.questId), rule.id).toBe(true);
    }
  });

  /**
   * Phase 26 gave `DISCOVERY` its first producer. Same rule as every other
   * trigger here: a key that names no authored secret can never fire, and it
   * fails silently by design, so only a content test catches it.
   */
  it('triggers on secrets that actually exist', () => {
    const discoveryIds = new Set(ISLAND_DISCOVERY_IDS);
    for (const rule of ISLAND_REWARD_TABLE) {
      if (rule.trigger.type !== 'DISCOVERY') continue;
      expect(discoveryIds.has(rule.trigger.discoveryKey), rule.id).toBe(true);
    }
  });

  /**
   * The other direction, and the one that matters to a child: a secret with
   * no reward rule is a place they walk into that gives them nothing. Not
   * every secret has to grant an item in principle, but every authored one
   * does today, and losing that silently would be a regression nobody sees.
   */
  it('gives every authored secret something to find', () => {
    const rewardedKeys = new Set(
      ISLAND_REWARD_TABLE.filter((rule) => rule.trigger.type === 'DISCOVERY').map(
        (rule) => (rule.trigger as { type: 'DISCOVERY'; discoveryKey: string }).discoveryKey,
      ),
    );
    // SC-R08-02: the Secret Chamber's star is observation only and grants nothing by design. The
    // mouse door grants one optional keepsake (Final F), so it is not quiet and must be rewarded.
    const QUIET_FINDS = new Set(['castle-chamber-star']);
    for (const discovery of ISLAND_DISCOVERIES) {
      if (QUIET_FINDS.has(discovery.id)) {
        expect(rewardedKeys.has(discovery.id), `${discovery.id} must grant nothing`).toBe(false);
        continue;
      }
      expect(rewardedKeys.has(discovery.id), `${discovery.id} grants nothing`).toBe(true);
    }
  });

  /**
   * Phase 24 authored four shells and a set prize, and three of the four had
   * no source at all - `moon-shell`, `rainbow-shell`, and `singing-shell`
   * were unobtainable, which also made `beachcomber-hat` unreachable. Phase
   * 26 is what made the set completable, and this asserts it stays that way.
   */
  it('makes every item in every collectible set reachable', () => {
    const grantable = new Set(ISLAND_REWARD_TABLE.flatMap((rule) => [...rule.itemIds]));
    for (const set of ISLAND_COLLECTIBLE_SETS) {
      for (const itemId of set.itemIds) {
        expect(grantable.has(itemId), `${itemId} has no source`).toBe(true);
      }
    }
  });

  it('has no rule offering a choice among items, which would imply a roll', () => {
    // Every rule grants its whole itemIds list. There is no "oneOf" field to
    // author, and this asserts none has appeared.
    for (const rule of ISLAND_REWARD_TABLE) {
      const keys = Object.keys(rule);
      expect(
        keys.filter((key) => /oneOf|chance|weight|odds|random|roll|pity/i.test(key)),
        rule.id,
      ).toEqual([]);
    }
  });
});

describe('chamber mouse door keepsake (Final F)', () => {
  it('is one optional discovery rule for one item outside every set', () => {
    const rules = ISLAND_REWARD_TABLE.filter((rule) => rule.itemIds.includes('tiny-brass-knob'));
    expect(rules).toHaveLength(1);
    expect(rules[0]!.trigger).toEqual({
      type: 'DISCOVERY',
      discoveryKey: 'castle-chamber-mouse-door',
    });
    expect(rules[0]!.itemIds).toEqual(['tiny-brass-knob']);
    const item = findItem('tiny-brass-knob');
    expect(item?.setId).toBeUndefined();
    expect(item?.hidden).toBeUndefined();
    expect(CASTLE_KEEPSAKE_IDS as readonly string[]).not.toContain('tiny-brass-knob');
    expect(findCollectibleSet('castle-keepsakes')?.itemIds).not.toContain('tiny-brass-knob');
    expect(`${item?.displayName} ${item?.description} ${rules[0]!.message}`).not.toMatch(/\u2014|\u2013/);
  });

  it('leaves the star find granting nothing', () => {
    expect(
      ISLAND_REWARD_TABLE.some(
        (rule) => rule.trigger.type === 'DISCOVERY' && rule.trigger.discoveryKey === 'castle-chamber-star',
      ),
    ).toBe(false);
  });
});

describe('lookup helpers', () => {
  it('finds authored content and returns null otherwise', () => {
    expect(findItem('spiral-shell')?.displayName).toBe('Spiral Shell');
    expect(findItem('not-an-item')).toBeNull();
    expect(findCollectibleSet('harbor-shells')?.displayName).toBe('Harbor Shells');
    expect(findCollectibleSet('not-a-set')).toBeNull();
  });
});

describe('castle keepsakes (SC-R07-01)', () => {
  it('lists six keepsakes, all defined, all in the castle-keepsakes set, with no completion prize', () => {
    expect(CASTLE_KEEPSAKE_IDS).toHaveLength(6);
    const set = findCollectibleSet('castle-keepsakes');
    expect(set?.itemIds).toEqual([...CASTLE_KEEPSAKE_IDS]);
    expect(set?.completionItemId).toBeUndefined();
    for (const id of CASTLE_KEEPSAKE_IDS) {
      expect(findItem(id)?.setId, id).toBe('castle-keepsakes');
      expect(findItem(id)?.hidden, id).toBeUndefined();
    }
  });

  it('grants each new keepsake from one server-graded trigger', () => {
    const triggers = new Map(
      ISLAND_REWARD_TABLE.flatMap((rule) => rule.itemIds.map((id) => [id, rule.trigger] as const)),
    );
    expect(triggers.get('painted-words-brush')).toEqual({
      type: 'ADVENTURE_COMPLETED',
      templateSlug: 'the-painted-words',
    });
    expect(triggers.get('three-clues-lens')).toEqual({
      type: 'WORLD_CHANGE',
      changeKey: 'SECRET_DOOR_CLUES_COLLECTED',
    });
    expect(triggers.get('secret-door-key')).toEqual({
      type: 'WORLD_CHANGE',
      changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE',
    });
  });

  it('keys every castle WORLD_CHANGE rule off a Great Storybook page source, which Django protects', () => {
    const pageKeys = new Set(
      STORYBOOK_PAGES.flatMap((page) =>
        page.source.kind === 'WORLD_CHANGE' ? [page.source.changeKey] : [],
      ),
    );
    const castleRules = ISLAND_REWARD_TABLE.filter((rule) =>
      rule.itemIds.some((id) => (CASTLE_KEEPSAKE_IDS as readonly string[]).includes(id)),
    );
    expect(castleRules.some((rule) => rule.trigger.type === 'WORLD_CHANGE')).toBe(true);
    for (const rule of castleRules) {
      if (rule.trigger.type !== 'WORLD_CHANGE') continue;
      expect(pageKeys.has(rule.trigger.changeKey), rule.id).toBe(true);
    }
  });
});
