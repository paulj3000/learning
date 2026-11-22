import { describe, expect, it } from 'vitest';
import {
  HEART_CHANGE_KEYS,
  HEART_ITEMS,
  HEART_PLACE_SLUG,
  HEART_QUEST_ID,
  HEART_QUESTS,
} from '../../content-export/firepeakHeartContent';
import { FIREPEAK_STORYBOOK_CONTRACT as C } from './storybookContract';

const quest = HEART_QUESTS.find((q) => q.id === HEART_QUEST_ID)!;

describe('Firepeak Great Storybook contract', () => {
  it('names the Place and quest the content export defines', () => {
    expect(C.discovery.placeSlug).toBe(HEART_PLACE_SLUG);
    expect(C.source.locationSlug).toBe(HEART_PLACE_SLUG);
    expect(C.producerQuestId).toBe(HEART_QUEST_ID);
    expect(quest).toBeDefined();
    expect(quest.ageBands).toEqual(expect.arrayContaining([...C.bands]));
  });

  it('uses the quest completion world change as its source key', () => {
    expect(C.source.changeKey).toBe(HEART_CHANGE_KEYS.complete);
    expect(C.observatory.changeKey).toBe(HEART_CHANGE_KEYS.complete);
    expect(quest.completion.worldChanges).toEqual([
      expect.objectContaining({
        locationSlug: C.source.locationSlug,
        changeKey: C.source.changeKey,
      }),
    ]);
  });

  it('lists only trophies that exist as served items, the primary among them', () => {
    const ids = new Set(HEART_ITEMS.map((item) => item.id));
    for (const id of C.trophies.all) expect(ids.has(id)).toBe(true);
    expect(C.trophies.all).toContain(C.trophies.primary);
  });

  it('is optional, copy has no em dash, and the route is the Realm Explorer Area', () => {
    expect(C.required).toBe(false);
    for (const text of [C.title, C.hint, C.restoredText, C.observatory.line])
      expect(text).not.toContain('—');
    expect(C.discovery.areaRoute('c1')).toBe('/island/c1/explore/firepeak-heart');
  });
});
