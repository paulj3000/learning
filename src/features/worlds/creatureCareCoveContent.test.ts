/**
 * Creature Care Cove's content invariants (docs/ROADMAP.md Phase 29).
 *
 * The island's own content files each carry a test asserting that nothing
 * they author can strand a child (`islandQuests.test.ts`,
 * `islandItems.test.ts`, `islandDiscoveries.test.ts`). A second world needs
 * the same floor under it, and it needs one thing those files never had to
 * check: that the world is playable by *every* band it claims to support,
 * since a child who sails to an island and finds nothing for them there has
 * been sent on a pointless journey.
 */
import { describe, expect, it } from 'vitest';
import { CREATURE_CARE_COVE_ADVENTURES } from '../adventures/content/creatureCareCoveAdventures';
import { ADVENTURE_TEMPLATES, getAdventureTemplatesForLocation } from '../adventures/content';
import { CREATURE_CARE_COVE_QUESTS } from '../quests/content/creatureCareCoveQuests';
import {
  CREATURE_CARE_COVE_ITEMS,
  CREATURE_CARE_COVE_REWARD_TABLE,
} from '../rewards/content/creatureCareCoveItems';
import { ISLAND_LOCATIONS } from '../island/locations';
import { getWorld } from './worlds';
import { CREATURE_CARE_COVE_SLUG } from './slugs';

const COVE_ADVENTURE_CHANGE_KEYS = new Set(
  ADVENTURE_TEMPLATES.flatMap((template) =>
    template.steps
      .map((step) => step.presentation)
      .filter((presentation) => presentation.kind === 'world-change')
      .map((presentation) => presentation.payload.changeKey),
  ),
);

const QUEST_CHANGE_KEYS = new Set(
  CREATURE_CARE_COVE_QUESTS.flatMap((quest) => [
    ...quest.stages.flatMap((stage) =>
      (stage.worldChanges ?? []).map((change) => change.changeKey),
    ),
    ...(quest.completion.worldChanges ?? []).map((change) => change.changeKey),
  ]),
);

const GRANTABLE_ITEM_IDS = new Set(
  CREATURE_CARE_COVE_REWARD_TABLE.flatMap((rule) => [...rule.itemIds]),
);

/**
 * The two `RewardTrigger` kinds anything actually fires today
 * (`syncQuestProgress` and `openDiscovery`). The other four, `WORLD_CHANGE`
 * included, are still dormant platform-wide - a Phase 24 limitation, not a
 * cove one. A rule keyed on a dormant trigger reads perfectly and grants
 * nothing, so the cove's treasure would be unreachable content.
 */
const LIVE_TRIGGER_TYPES = new Set(['QUEST_COMPLETED', 'DISCOVERY']);

describe("the cove's adventures", () => {
  it('are all played at the care beach', () => {
    for (const adventure of CREATURE_CARE_COVE_ADVENTURES) {
      expect(adventure.locationSlug, adventure.slug).toBe('cove-care-beach');
    }
  });

  /**
   * The point of authoring three: a Sprout, a Pathfinder, and an Explorer
   * each get the care round pitched at their own band, so nobody sails to
   * the cove and is told the island is not for them.
   */
  it('cover every band the world claims to support, one adventure each', () => {
    const world = getWorld(CREATURE_CARE_COVE_SLUG);
    expect(world).toBeDefined();

    const templates = getAdventureTemplatesForLocation('cove-care-beach');
    for (const band of world!.supportedAgeBands) {
      const matching = templates.filter((template) => template.ageBands.includes(band));
      expect(matching.length, `${band} at the care beach`).toBe(1);
    }
  });

  /**
   * All three are the same act at three bands, so they record the same key.
   * The cove's quest and both of its reward rules hang off it, and a
   * per-band key would have quietly given Pathfinders a payoff nobody else
   * could reach.
   */
  it('all record the same world change, so every band reaches the same payoff', () => {
    for (const adventure of CREATURE_CARE_COVE_ADVENTURES) {
      const keys = adventure.steps
        .map((step) => step.presentation)
        .filter((presentation) => presentation.kind === 'world-change')
        .map((presentation) => presentation.payload.changeKey);
      expect(keys, adventure.slug).toEqual(['COVE_CREATURES_FED']);
    }
  });

  it('keeps the Sprout adventure to one-step decisions (CLAUDE.md section 3)', () => {
    const sprout = CREATURE_CARE_COVE_ADVENTURES.find((adventure) =>
      adventure.ageBands.includes('SPROUT'),
    );
    expect(sprout).toBeDefined();
    expect(sprout!.steps.length).toBeLessThanOrEqual(6);
    for (const step of sprout!.steps) {
      expect(step.type, step.id).not.toBe('NUMBER_INPUT');
      expect(step.type, step.id).not.toBe('ORDERING');
      if (step.presentation.kind === 'choice') {
        expect(step.presentation.options.length, step.id).toBeLessThanOrEqual(3);
      }
    }
  });

  it('pitches the Explorer adventure past ten, so it is not the younger one renamed', () => {
    const explorer = CREATURE_CARE_COVE_ADVENTURES.find((adventure) =>
      adventure.ageBands.includes('EXPLORER'),
    );
    const values = explorer!.steps
      .map((step) =>
        step.presentation.kind === 'number-input' ? step.presentation.correctValue : 0,
      )
      .filter(Boolean);

    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toBeGreaterThan(10);
  });
});

describe("the cove's quest", () => {
  const quest = CREATURE_CARE_COVE_QUESTS[0]!;

  /**
   * The gate that keeps the journal honest: a child who has never sailed to
   * the cove is never offered cove work. This is the same failure the
   * journal's age filter was written to prevent.
   */
  it('waits on the arrival record the travel system writes', () => {
    const arrivalKey = getWorld(CREATURE_CARE_COVE_SLUG)?.arrival?.changeKey;
    expect(arrivalKey).toBeTruthy();
    expect(quest.prerequisites).toEqual([{ type: 'WORLD_CHANGE', changeKey: arrivalKey }]);
  });

  it('is offered to every band the world supports', () => {
    expect([...quest.ageBands].sort()).toEqual(
      [...getWorld(CREATURE_CARE_COVE_SLUG)!.supportedAgeBands].sort(),
    );
  });

  it('names no NPC giver, since the cove has no character a child can talk to yet', () => {
    expect(quest.giverNpcId).toBeUndefined();
  });

  it('only names objectives that content existing today can satisfy', () => {
    const locationSlugs = new Set(ISLAND_LOCATIONS.map((location) => location.slug));
    for (const stage of quest.stages) {
      for (const objective of stage.objectives) {
        const where = `${quest.id}/${objective.id}`;
        switch (objective.kind) {
          case 'EXPLORE':
            expect(locationSlugs.has(objective.locationSlug), where).toBe(true);
            break;
          case 'BUILD':
            expect(
              COVE_ADVENTURE_CHANGE_KEYS.has(objective.changeKey) ||
                QUEST_CHANGE_KEYS.has(objective.changeKey),
              where,
            ).toBe(true);
            break;
          case 'FIND':
            expect(GRANTABLE_ITEM_IDS.has(objective.itemId), where).toBe(true);
            break;
          // A `DELIVER`/`TALK_TO`/`HELP_NPC` objective would need an NPC the
          // cove does not have; the default below fails rather than skips.
          default:
            throw new Error(`${where}: unexpected objective kind "${objective.kind}"`);
        }
      }
    }
  });
});

describe("the cove's treasure", () => {
  it('gives every item a way to be earned', () => {
    for (const item of CREATURE_CARE_COVE_ITEMS) {
      expect(GRANTABLE_ITEM_IDS.has(item.id), item.id).toBe(true);
    }
  });

  it('hangs every rule on a trigger something actually fires', () => {
    for (const rule of CREATURE_CARE_COVE_REWARD_TABLE) {
      expect(LIVE_TRIGGER_TYPES.has(rule.trigger.type), rule.id).toBe(true);
    }
  });

  it('names a quest that exists on every quest-completion rule', () => {
    const questIds = new Set(CREATURE_CARE_COVE_QUESTS.map((quest) => quest.id));
    for (const rule of CREATURE_CARE_COVE_REWARD_TABLE) {
      if (rule.trigger.type !== 'QUEST_COMPLETED') continue;
      expect(questIds.has(rule.trigger.questId), rule.id).toBe(true);
    }
  });

  it('gives a cosmetic slot to every cosmetic and none to anything else', () => {
    for (const item of CREATURE_CARE_COVE_ITEMS) {
      if (item.category === 'COSMETIC') {
        expect(item.cosmeticSlot, item.id).toBeTruthy();
      } else {
        expect(item.cosmeticSlot, item.id).toBeUndefined();
      }
    }
  });
});

describe("the cove's child-facing copy", () => {
  it('avoids em dashes (CLAUDE.md section 13)', () => {
    const lines = [
      ...CREATURE_CARE_COVE_ITEMS.flatMap((item) => [item.displayName, item.description]),
      ...CREATURE_CARE_COVE_REWARD_TABLE.map((rule) => rule.message),
      ...CREATURE_CARE_COVE_QUESTS.flatMap((quest) => [
        quest.title,
        quest.summary,
        quest.completion.journalNote,
        ...quest.stages.flatMap((stage) => [
          stage.title,
          ...stage.objectives.map((objective) => objective.label),
        ]),
      ]),
    ];

    for (const line of lines) expect(line).not.toContain('—');
  });
});
