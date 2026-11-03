import { describe, expect, it } from 'vitest';
import { ALL_ITEMS, ALL_REWARD_RULES } from '../../rewards/content';
import {
  CASTLE_TROPHY_INTERACTIONS,
  OPEN_PEDESTAL_TEXT,
  TROPHY_SLOTS,
  trophyDisplay,
} from './castleTrophies';
import { ALL_ENTITY_IDS, TROPHY_PEDESTAL_SPOTS, ZONES } from './storykeeperCastleRegion';

/**
 * The Trophy Room's display contract. What matters: it shows the child's
 * real inventory and nothing else, it promises only treasures that can be
 * earned, an open pedestal is an honest empty state, and walking up to a
 * pedestal can never grant, change or record anything.
 */

describe('trophy slots', () => {
  it('has one slot per pedestal the region places, in the region order', () => {
    expect(TROPHY_SLOTS.map((slot) => slot.pedestalEntityId)).toEqual(
      TROPHY_PEDESTAL_SPOTS.map((spot) => spot.entityId),
    );
    for (const slot of TROPHY_SLOTS) {
      expect(ALL_ENTITY_IDS).toContain(slot.pedestalEntityId);
      expect(ZONES.map((zone) => zone.id)).toContain(slot.zoneId);
    }
    expect(new Set(TROPHY_SLOTS.map((slot) => slot.id)).size).toBe(TROPHY_SLOTS.length);
  });

  it('binds only to items the catalog knows, each at most once', () => {
    const bound = TROPHY_SLOTS.flatMap((slot) => (slot.itemId ? [slot.itemId] : []));
    for (const id of bound) expect(ALL_ITEMS.map((item) => item.id)).toContain(id);
    expect(new Set(bound).size).toBe(bound.length);
  });

  it('promises only treasures a child can earn: every bound item is granted by a reward rule', () => {
    const granted = new Set(ALL_REWARD_RULES.flatMap((rule) => rule.itemIds));
    for (const slot of TROPHY_SLOTS) {
      if (slot.itemId)
        expect(granted.has(slot.itemId), `${slot.itemId} is never granted`).toBe(true);
    }
  });

  it('keeps open pedestals for SC-R07: at least four are unbound', () => {
    expect(TROPHY_SLOTS.filter((slot) => !slot.itemId).length).toBeGreaterThanOrEqual(4);
  });
});

describe('trophyDisplay', () => {
  it('shows every pedestal as empty for a child who owns nothing, and says so honestly', () => {
    const entries = trophyDisplay([]);
    expect(entries).toHaveLength(TROPHY_SLOTS.length);
    expect(entries.filter((entry) => entry.state === 'on-display')).toEqual([]);
    for (const entry of entries) expect(entry.text.startsWith('An empty pedestal')).toBe(true);
    expect(
      entries.filter((entry) => entry.state === 'open').every((e) => e.text === OPEN_PEDESTAL_TEXT),
    ).toBe(true);
  });

  it('puts an owned castle treasure on its pedestal, with its catalog name and words', () => {
    const entries = trophyDisplay(['storykeepers-quill']);
    const quill = entries.find((entry) => entry.slot.itemId === 'storykeepers-quill')!;
    const item = ALL_ITEMS.find((candidate) => candidate.id === 'storykeepers-quill')!;
    expect(quill.state).toBe('on-display');
    expect(quill.name).toBe(item.displayName);
    expect(quill.text).toBe(`${item.displayName}. ${item.description}`);
    // The other bound pedestal still waits.
    expect(entries.find((entry) => entry.slot.itemId === 'blank-page-storybook')?.state).toBe(
      'waiting',
    );
  });

  it('ignores items it does not display and items it has never heard of', () => {
    const entries = trophyDisplay(['ember-scale', 'an-item-from-a-newer-version']);
    expect(entries.filter((entry) => entry.state === 'on-display')).toEqual([]);
  });

  it('is pure: the same inventory gives the same room, and it never mutates its input', () => {
    const owned = Object.freeze(['storykeepers-quill', 'blank-page-storybook']);
    expect(trophyDisplay(owned)).toEqual(trophyDisplay([...owned]));
    expect(trophyDisplay(owned).filter((entry) => entry.state === 'on-display')).toHaveLength(2);
  });
});

describe('trophy walk-up interactions', () => {
  it('only describe: no action grants an item, records a change, starts anything or moves the child', () => {
    for (const interaction of CASTLE_TROPHY_INTERACTIONS) {
      expect(interaction.action.kind, interaction.id).toBe('SHOW_MESSAGE');
      expect(interaction.trigger).toBe('APPROACH');
    }
  });

  it('give a bound pedestal an owned and a waiting line with opposite item requirements', () => {
    for (const slot of TROPHY_SLOTS.filter((candidate) => candidate.itemId)) {
      const owned = CASTLE_TROPHY_INTERACTIONS.find((i) => i.id === `${slot.id}-owned`)!;
      const waiting = CASTLE_TROPHY_INTERACTIONS.find((i) => i.id === `${slot.id}-waiting`)!;
      expect(owned.requirements).toEqual([{ type: 'ITEM_OWNED', itemId: slot.itemId }]);
      expect(waiting.requirements).toEqual([{ type: 'ITEM_ABSENT', itemId: slot.itemId }]);
      expect(owned.zoneId).toBe(slot.zoneId);
      expect(waiting.zoneId).toBe(slot.zoneId);
    }
  });

  it('give an open pedestal one always-available line', () => {
    for (const slot of TROPHY_SLOTS.filter((candidate) => !candidate.itemId)) {
      const matching = CASTLE_TROPHY_INTERACTIONS.filter((i) => i.zoneId === slot.zoneId);
      expect(matching).toHaveLength(1);
      expect(matching[0].requirements).toEqual([{ type: 'ALWAYS' }]);
    }
  });

  it('say exactly what the display says, so the room and the list cannot disagree', () => {
    const entries = trophyDisplay(['storykeepers-quill']);
    for (const entry of entries) {
      const lines = CASTLE_TROPHY_INTERACTIONS.filter((i) => i.zoneId === entry.slot.zoneId);
      const texts = lines.map((i) => (i.action.kind === 'SHOW_MESSAGE' ? i.action.message : ''));
      expect(texts, entry.slot.id).toContain(entry.text);
    }
  });

  it('have unique ids and read aloud without an em dash', () => {
    const ids = CASTLE_TROPHY_INTERACTIONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const interaction of CASTLE_TROPHY_INTERACTIONS) {
      const text = `${interaction.title} ${interaction.action.kind === 'SHOW_MESSAGE' ? interaction.action.message : ''}`;
      expect(text).not.toMatch(/—|–/);
    }
  });
});
