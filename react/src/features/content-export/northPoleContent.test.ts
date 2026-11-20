import { describe, expect, it } from 'vitest';
import {
  NORTH_POLE_COLLECTIBLE_SETS,
  NORTH_POLE_ITEMS,
  NORTH_POLE_KEYS,
  NORTH_POLE_LOCATIONS,
  NORTH_POLE_NPC_IDS,
  NORTH_POLE_NPCS,
  NORTH_POLE_PACK,
  NORTH_POLE_PUZZLE_HOSTS,
  NORTH_POLE_QUEST_IDS,
  NORTH_POLE_QUESTS,
  NORTH_POLE_REWARD_RULES,
  NORTH_POLE_WORLD,
  NORTH_POLE_ZONES,
} from './northPoleContent';

const BANDS = ['SPROUT', 'PATHFINDER', 'EXPLORER'] as const;
const allKeys = new Set<string>(Object.values(NORTH_POLE_KEYS));
const pickupKeyPattern =
  /^NORTH_POLE_(FRAGMENT_[A-Z]+|SNOWFLAKE_\d\d|CANDY_CANE_\d|ORNAMENT_\d|COOKIE_\d|GOLDEN_BELL_\d)$/;
const isContractKey = (key: string) => allKeys.has(key) || pickupKeyPattern.test(key);

const unique = (ids: string[]) => new Set(ids).size === ids.length;

function childText(): string[] {
  const out: string[] = [
    NORTH_POLE_WORLD.title,
    NORTH_POLE_WORLD.tagline,
    NORTH_POLE_WORLD.description,
  ];
  for (const l of NORTH_POLE_LOCATIONS) out.push(l.title, l.tagline, l.description, l.decoration);
  for (const i of NORTH_POLE_ITEMS) out.push(i.displayName, i.description);
  for (const s of NORTH_POLE_COLLECTIBLE_SETS) out.push(s.displayName, s.completionMessage);
  for (const r of NORTH_POLE_REWARD_RULES) out.push(r.message);
  for (const q of NORTH_POLE_QUESTS) {
    out.push(q.title, q.summary, q.completion.journalNote);
    for (const s of q.stages) out.push(s.title, ...s.objectives.map((o) => o.label));
  }
  for (const n of NORTH_POLE_NPCS) {
    out.push(n.displayName);
    for (const d of n.dialogue) out.push(d.text, ...d.choices.map((c) => c.label));
    for (const o of n.questOffers) out.push(o.summary);
  }
  return out;
}

describe('North Pole content: ids', () => {
  it('has the Realm, the Place and every contract NPC and quest id, unique', () => {
    expect(NORTH_POLE_WORLD.slug).toBe('north-pole');
    expect(NORTH_POLE_WORLD.isHome).toBeUndefined();
    expect(NORTH_POLE_WORLD.travelRequirement).toBeUndefined();
    expect(NORTH_POLE_WORLD.supportedAgeBands).toEqual([...BANDS]);
    expect(NORTH_POLE_LOCATIONS.map((l) => l.slug)).toEqual(['north-pole-village']);
    expect(NORTH_POLE_NPCS.map((n) => n.id).sort()).toEqual([...NORTH_POLE_NPC_IDS].sort());
    expect(NORTH_POLE_QUESTS.map((q) => q.id)).toEqual([...NORTH_POLE_QUEST_IDS]);
    for (const npc of NORTH_POLE_NPCS) expect(npc.homeLocationSlug).toBe('north-pole-village');
    for (const list of [
      NORTH_POLE_ITEMS.map((i) => i.id),
      NORTH_POLE_REWARD_RULES.map((r) => r.id),
      NORTH_POLE_COLLECTIBLE_SETS.map((s) => s.id),
    ]) {
      expect(unique(list)).toBe(true);
    }
    for (const npc of NORTH_POLE_NPCS) expect(unique(npc.dialogue.map((d) => d.id))).toBe(true);
  });

  it('pack lists exactly its own content', () => {
    expect(NORTH_POLE_PACK.itemIds).toHaveLength(NORTH_POLE_ITEMS.length);
    expect(NORTH_POLE_PACK.npcIds).toHaveLength(10);
    expect(NORTH_POLE_PACK.questIds).toHaveLength(9);
  });

  it('has the seasonal cosmetics and the badges', () => {
    const byId = new Map(NORTH_POLE_ITEMS.map((i) => [i.id, i]));
    expect(byId.get('np-cosmetic-santa-hat')).toMatchObject({ category: 'COSMETIC', cosmeticSlot: 'HAT' });
    expect(byId.get('np-cosmetic-elf-backpack')).toMatchObject({ cosmeticSlot: 'BACKPACK' });
    expect(byId.get('np-cosmetic-snowflake-scarf')).toMatchObject({ cosmeticSlot: 'ACCESSORY' });
    expect(NORTH_POLE_ITEMS.filter((i) => i.id.startsWith('np-badge-'))).toHaveLength(8);
    expect(byId.has('np-trophy-christmas-star')).toBe(true);
    expect(NORTH_POLE_COLLECTIBLE_SETS.find((s) => s.id === 'np-set-snowflakes')?.completionItemId).toBe(
      'np-cosmetic-snowflake-scarf',
    );
  });

  it('every set item and rule item exists, and set members point back to their set', () => {
    const ids = new Set(NORTH_POLE_ITEMS.map((i) => i.id));
    for (const set of NORTH_POLE_COLLECTIBLE_SETS) {
      for (const id of set.itemIds) {
        expect(ids.has(id)).toBe(true);
        expect(NORTH_POLE_ITEMS.find((i) => i.id === id)?.setId).toBe(set.id);
      }
    }
    for (const rule of NORTH_POLE_REWARD_RULES) for (const id of rule.itemIds) expect(ids.has(id)).toBe(true);
  });
});

describe('North Pole content: reward rules', () => {
  it('every rule triggers on a contract world change key, one rule per key', () => {
    const keys = NORTH_POLE_REWARD_RULES.map((r) => {
      expect(r.trigger.type).toBe('WORLD_CHANGE');
      return (r.trigger as { changeKey: string }).changeKey;
    });
    for (const key of keys) expect(isContractKey(key), key).toBe(true);
    expect(unique(keys)).toBe(true);
  });

  it('every pickup has exactly one rule and there are no lever chest rules', () => {
    const counts: Record<string, number> = {
      FRAGMENT: NORTH_POLE_ZONES.length,
      SNOWFLAKE: 10,
      CANDY_CANE: 5,
      ORNAMENT: 5,
      COOKIE: 3,
      GOLDEN_BELL: 3,
    };
    for (const [prefix, n] of Object.entries(counts)) {
      const rules = NORTH_POLE_REWARD_RULES.filter((r) => r.id.startsWith(`np-rule-${prefix.toLowerCase().replace('_', '-')}-`));
      expect(rules, prefix).toHaveLength(n);
      for (const rule of rules) expect(rule.itemIds).toHaveLength(1);
    }
    expect(NORTH_POLE_REWARD_RULES.some((r) => r.id.includes('mountain-bridge'))).toBe(false);
    expect(NORTH_POLE_REWARD_RULES.some((r) => r.id === 'np-rule-snowball-found')).toBe(true);
    for (const id of [
      'np-rule-welcome', 'np-rule-workshop-gifts', 'np-rule-workshop', 'np-rule-forest', 'np-rule-lake',
      'np-rule-reindeer', 'np-rule-gingerbread', 'np-rule-mountain', 'np-rule-star', 'np-rule-christmas-eve',
    ]) {
      expect(NORTH_POLE_REWARD_RULES.some((r) => r.id === id), id).toBe(true);
    }
  });

  it('every item reachable by a rule is granted at most once across rules', () => {
    const granted = NORTH_POLE_REWARD_RULES.flatMap((r) => [...r.itemIds]);
    expect(unique(granted)).toBe(true);
  });
});

describe('North Pole content: quests', () => {
  it('chain through WORLD_CHANGE prerequisites on keys an earlier quest records', () => {
    const expectedPrereq = [
      null, 'WELCOME_LOOKED', 'WORKSHOP_RESTORED', 'FOREST_DONE', 'LAKE_DONE',
      'SNOWBALL_HOME', 'GINGER_REPAIRED', 'MOUNTAIN_SUMMIT', 'STAR_RESTORED',
    ];
    NORTH_POLE_QUESTS.forEach((q, i) => {
      const want = expectedPrereq[i];
      expect(q.prerequisites).toEqual(
        want ? [{ type: 'WORLD_CHANGE', changeKey: `NORTH_POLE_${want}` }] : [{ type: 'ALWAYS' }],
      );
      expect(q.ageBands).toEqual([...BANDS]);
      expect(q.stages).toHaveLength(1);
      expect(q.completion.worldChanges?.[0]).toEqual({
        locationSlug: 'north-pole-village',
        changeType: 'UNLOCK',
        changeKey: `NORTH_POLE_Q0${i + 1}_COMPLETE`,
      });
      for (const o of q.stages[0]?.objectives ?? []) {
        expect(o.kind).toBe('BUILD');
        expect(isContractKey((o as { changeKey: string }).changeKey)).toBe(true);
      }
    });
    const q9 = NORTH_POLE_QUESTS[8];
    expect(q9?.completion.worldChanges?.map((c) => c.changeKey)).toContain('NORTH_POLE_ADVENTURE_COMPLETE');
  });

  it('records the keys of earlier quests that gate the next', () => {
    const recorded = new Set<string>();
    for (const q of NORTH_POLE_QUESTS) {
      for (const p of q.prerequisites) {
        if (p.type === 'WORLD_CHANGE') expect(recorded.has(p.changeKey), p.changeKey).toBe(true);
      }
      for (const o of q.stages.flatMap((s) => s.objectives)) recorded.add((o as { changeKey: string }).changeKey);
    }
  });

  it('every quest has a fragment key objective and the giver offers it', () => {
    for (const q of NORTH_POLE_QUESTS) {
      const keys = (q.stages[0]?.objectives ?? []).map((o) => (o as { changeKey: string }).changeKey);
      if (q.id !== 'np-q08-restore-the-star' && q.id !== 'np-q09-christmas-eve') {
        expect(keys.some((x) => x.includes('FRAGMENT_')), q.id).toBe(true);
      }
      const giver = NORTH_POLE_NPCS.find((n) => n.id === q.giverNpcId);
      expect(giver?.questOffers.some((o) => o.questId === q.id), q.id).toBe(true);
    }
    const q5 = NORTH_POLE_QUESTS[4]?.stages[0]?.objectives.map((o) => (o as { changeKey: string }).changeKey);
    expect(q5).toContain('NORTH_POLE_SNOWBALL_FOUND');
  });
});

describe('North Pole content: dialogue', () => {
  const hosted = Object.entries(NORTH_POLE_PUZZLE_HOSTS);

  it('covers the 27 puzzles', () => {
    expect(hosted).toHaveLength(27);
  });

  it('every puzzle has intro and completeMessage for every band from its host', () => {
    for (const [puzzleId, hostId] of hosted) {
      const npc = NORTH_POLE_NPCS.find((n) => n.id === hostId);
      expect(npc, hostId).toBeDefined();
      for (const part of ['intro', 'completeMessage'] as const) {
        for (const band of BANDS) {
          const lines = (npc?.dialogue ?? []).filter(
            (d) =>
              d.puzzleLine?.puzzleId === puzzleId &&
              d.puzzleLine.part === part &&
              (d.ageBands ?? BANDS).includes(band),
          );
          expect(lines, `${puzzleId} ${part} ${band}`).toHaveLength(1);
        }
      }
    }
  });

  it('puzzle lines follow the catalog rules', () => {
    for (const npc of NORTH_POLE_NPCS) {
      for (const d of npc.dialogue.filter((x) => x.puzzleLine)) {
        expect(d.followUpOnly).toBe(true);
        expect(d.choices).toEqual([]);
        expect(d.conditions).toEqual([]);
      }
    }
  });

  it('each NPC has an unconditioned opener for every band, and thanks comes first', () => {
    for (const npc of NORTH_POLE_NPCS) {
      const talk = npc.dialogue.filter((d) => !d.puzzleLine);
      for (const band of BANDS) {
        expect(
          talk.some((d) => !d.followUpOnly && d.conditions.length === 0 && (d.ageBands ?? BANDS).includes(band)),
          `${npc.id} ${band}`,
        ).toBe(true);
      }
      const firstOpener = talk.findIndex((d) => d.conditions.length === 0);
      expect(talk.slice(0, firstOpener).every((d) => d.conditions[0]?.type === 'WORLD_CHANGE')).toBe(true);
      if (npc.id !== 'snowball') {
        for (const id of ['help', 'hint']) expect(talk.some((d) => d.id === `${npc.id}-${id}`)).toBe(true);
        expect(talk[0]?.id).toBe(`${npc.id}-thanks`);
      }
    }
  });

  it('keeps lines short and choices bounded', () => {
    for (const npc of NORTH_POLE_NPCS) {
      for (const d of npc.dialogue) {
        const sproutOnly = d.ageBands?.length === 1 && d.ageBands[0] === 'SPROUT';
        expect(d.text.length, d.id).toBeLessThanOrEqual(sproutOnly ? 110 : 240);
        expect(d.choices.length).toBeLessThanOrEqual(3);
        for (const c of d.choices) expect(c.label.length, c.id).toBeLessThanOrEqual(40);
      }
    }
  });

  it('mentions the walking way wherever a jump is offered', () => {
    for (const npc of NORTH_POLE_NPCS) {
      for (const d of npc.dialogue.filter((x) => /\b(jump|hop)\b/i.test(x.text))) {
        expect(d.text, d.id).toMatch(/walk/i);
      }
    }
  });

  it('keeps Snowball to short animal captions', () => {
    const snowball = NORTH_POLE_NPCS.find((n) => n.id === 'snowball');
    for (const d of snowball?.dialogue ?? []) expect(d.text.length).toBeLessThanOrEqual(60);
  });
});

describe('North Pole content: child-facing copy', () => {
  const texts = childText();

  it('has no em or en dashes', () => {
    for (const t of texts) expect(t).not.toMatch(/[–—]/);
  });

  it('has no shaming, pressure, or private-question words', () => {
    const forbidden =
      /\b(wrong|fail|failed|failure|hurry|quick|quickly|stupid|dumb|bad|lose|timer|countdown|secret|lonely|human|your (name|address|age))\b/i;
    for (const t of texts) expect(t).not.toMatch(forbidden);
  });

  it('keeps the Christmas Star as island magic and never mentions religion', () => {
    expect(texts.join(' ')).toMatch(/island magic/i);
    expect(texts.join(' ')).not.toMatch(/\b(jesus|church|god|bethlehem|prayer|nativity)\b/i);
  });

  it('has no snowman character name', () => {
    expect(texts.join(' ')).not.toMatch(/rudolph|red nose|red-nosed/i);
  });
});
