import { describe, expect, it } from 'vitest';
import type { AgeBandValue } from '../child-profile/constants';
import { getQuestDefinition, getQuestsOfferedBy } from '../quests/content';
import { GREAT_STORYBOOK_QUEST_IDS } from '../quests/content/islandQuests';
import { advanceQuest, allObjectives, startQuest } from '../quests/quest';
import { EMPTY_QUEST_CONTEXT, type QuestContext } from '../quests/types';
import { ALL_ITEMS, ALL_REWARD_RULES } from '../rewards/content';
import { pagesForBand, storybookProgress } from './pages';

const BANDS: readonly AgeBandValue[] = ['SPROUT', 'PATHFINDER', 'EXPLORER'];

const definitionFor = (band: AgeBandValue) => {
  const quest = getQuestDefinition(GREAT_STORYBOOK_QUEST_IDS[band]);
  if (!quest) throw new Error(`no Great Storybook quest for ${band}`);
  return quest;
};

/** A quest context holding exactly these records, and Quill met or not. */
function context(
  worldChangeKeys: string[],
  discoveryKeys: string[],
  metQuill: boolean,
): QuestContext {
  return {
    ...EMPTY_QUEST_CONTEXT,
    worldChangeKeys,
    discoveryKeys,
    npcMemoryFlags: metQuill ? { 'keeper-quill': { metQuill: true } } : {},
  };
}

/** Every subset of a list. */
function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((all, item) => [...all, ...all.map((s) => [...s, item])], [[]]);
}

describe('the Great Storybook quests', () => {
  it('are three, one per band, each for its own band only', () => {
    for (const band of BANDS) expect(definitionFor(band).ageBands).toEqual([band]);
    expect(new Set(Object.values(GREAT_STORYBOOK_QUEST_IDS)).size).toBe(3);
  });

  it('are offered by Keeper Quill, after the greeting, until the book is restored', () => {
    const offered = getQuestsOfferedBy('keeper-quill').map((quest) => quest.id);
    for (const id of Object.values(GREAT_STORYBOOK_QUEST_IDS)) expect(offered).toContain(id);
  });

  it('turn the page registry into objectives, one for one, with the right ones optional', () => {
    for (const band of BANDS) {
      const objectives = allObjectives(definitionFor(band));
      const pageObjectives = objectives.filter((objective) =>
        objective.id.startsWith('storybook-page-'),
      );
      expect(pageObjectives.map((o) => o.id)).toEqual(
        pagesForBand(band).map((p) => `storybook-${p.id}`),
      );
      for (const page of pagesForBand(band)) {
        const objective = pageObjectives.find((o) => o.id === `storybook-${page.id}`)!;
        expect(Boolean(objective.optional), page.id).toBe(!page.required);
        if (page.source.kind === 'WORLD_CHANGE') {
          expect(objective).toMatchObject({ kind: 'BUILD', changeKey: page.source.changeKey });
        } else {
          expect(objective).toMatchObject({
            kind: 'DISCOVER',
            discoveryKey: page.source.discoveryId,
          });
        }
      }
    }
  });

  it("keep the hidden page's journal line vague: it never names where the secret is", () => {
    for (const band of BANDS) {
      const bonus = allObjectives(definitionFor(band)).find((o) => o.kind === 'DISCOVER')!;
      expect(bonus.label.toLowerCase()).not.toMatch(
        /tapestry|nook|stair|corner|cushion|room|library|hall/,
      );
    }
  });

  it('restore the book, record it once and say so, on completion', () => {
    for (const band of BANDS) {
      const { completion } = definitionFor(band);
      expect(completion.worldChanges).toEqual([
        {
          locationSlug: 'storykeeper-castle',
          changeType: 'CREATE',
          changeKey: 'GREAT_STORYBOOK_RESTORED',
        },
      ]);
      expect(completion.setsNpcMemoryFlags).toEqual([
        { npcId: 'keeper-quill', flags: ['restoredTheStorybook'] },
      ]);
      expect(completion.journalNote).not.toMatch(/—|–/);
    }
  });

  it('give the seal, once, through a reward rule per quest', () => {
    expect(ALL_ITEMS.map((item) => item.id)).toContain('great-storybook-seal');
    for (const id of Object.values(GREAT_STORYBOOK_QUEST_IDS)) {
      const rule = ALL_REWARD_RULES.find(
        (r) => r.trigger.type === 'QUEST_COMPLETED' && r.trigger.questId === id,
      );
      expect(rule?.itemIds).toEqual(['great-storybook-seal']);
    }
  });
});

describe('the quest completes exactly when the book is whole', () => {
  it.each(BANDS)('for %s, across every combination of the records its pages name', (band) => {
    const pages = pagesForBand(band);
    const keys = pages.flatMap((p) =>
      p.source.kind === 'WORLD_CHANGE' ? [p.source.changeKey] : [],
    );
    const discoveries = pages.flatMap((p) =>
      p.source.kind === 'DISCOVERY' ? [p.source.discoveryId] : [],
    );
    const records = [
      ...keys.map((key) => ({ key, discovery: false })),
      ...discoveries.map((key) => ({ key, discovery: true })),
    ];
    const definition = definitionFor(band);
    for (const metQuill of [false, true]) {
      for (const chosen of subsets(records)) {
        const ctx = context(
          chosen.filter((r) => !r.discovery).map((r) => r.key),
          chosen.filter((r) => r.discovery).map((r) => r.key),
          metQuill,
        );
        const book = storybookProgress(
          { worldChangeKeys: ctx.worldChangeKeys, discoveryIds: ctx.discoveryKeys },
          band,
        );
        const result = advanceQuest(
          definition,
          startQuest(definition, '2026-11-03T00:00:00Z'),
          ctx,
        );
        const label = `${band} met=${metQuill} ${JSON.stringify(chosen.map((r) => r.key))}`;
        expect(result.state.status === 'COMPLETED', label).toBe(metQuill && book.complete);
      }
    }
  });

  it('writes the restored world change when, and only when, the quest completes', () => {
    const definition = definitionFor('PATHFINDER');
    const start = startQuest(definition, '2026-11-03T00:00:00Z');
    const early = advanceQuest(definition, start, context([], [], true));
    expect(early.worldChanges).toEqual([]);
    const done = advanceQuest(definition, start, context(['FIRST_STORY_TOLD'], [], true));
    expect(done.state.status).toBe('COMPLETED');
    expect(done.worldChanges.map((c) => c.changeKey)).toEqual(['GREAT_STORYBOOK_RESTORED']);
    // A finished quest does not complete again.
    const again = advanceQuest(definition, done.state, context(['FIRST_STORY_TOLD'], [], true));
    expect(again.changed).toBe(false);
    expect(again.worldChanges).toEqual([]);
  });
});
