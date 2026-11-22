import { describe, expect, it } from 'vitest';
import type { AgeBandValue } from '../child-profile/constants';
import { getQuestDefinition, getQuestsOfferedBy } from '../quests/content';
import {
  GREAT_STORYBOOK_MORE_QUEST_IDS,
  GREAT_STORYBOOK_QUEST_IDS,
} from '../quests/content/islandQuests';
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
      const changes = [
        {
          locationSlug: 'storykeeper-castle',
          changeType: 'CREATE',
          changeKey: 'GREAT_STORYBOOK_RESTORED',
        },
        {
          locationSlug: 'storykeeper-castle',
          changeType: 'CREATE',
          changeKey: 'GREAT_STORYBOOK_RESTORED_V2',
        },
      ];
      // Pathfinders are on edition 2 and write both changes; Sprouts and Explorers write one.
      expect(completion.worldChanges).toEqual(band === 'PATHFINDER' ? changes : [changes[0]]);
      expect(completion.setsNpcMemoryFlags).toEqual([
        {
          npcId: 'keeper-quill',
          flags:
            band === 'PATHFINDER'
              ? ['restoredTheStorybook', 'restoredTheStorybookMore']
              : ['restoredTheStorybook'],
        },
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
    const done = advanceQuest(
      definition,
      start,
      context(['FIRST_STORY_TOLD', 'STUDIO_PAGE_MENDED'], [], true),
    );
    expect(done.state.status).toBe('COMPLETED');
    expect(done.worldChanges.map((c) => c.changeKey)).toEqual([
      'GREAT_STORYBOOK_RESTORED',
      'GREAT_STORYBOOK_RESTORED_V2',
    ]);
    // A finished quest does not complete again.
    const again = advanceQuest(
      definition,
      done.state,
      context(['FIRST_STORY_TOLD', 'STUDIO_PAGE_MENDED'], [], true),
    );
    expect(again.changed).toBe(false);
    expect(again.worldChanges).toEqual([]);
  });
});

describe('the Pathfinder follow-up quest for children who restored edition 1', () => {
  const more = () => {
    const quest = getQuestDefinition(GREAT_STORYBOOK_MORE_QUEST_IDS.PATHFINDER);
    if (!quest) throw new Error('no follow-up quest');
    return quest;
  };

  it('is for Pathfinders, offered by Keeper Quill, after the original is completed', () => {
    const quest = more();
    expect(quest.ageBands).toEqual(['PATHFINDER']);
    expect(quest.giverNpcId).toBe('keeper-quill');
    expect(quest.prerequisites).toEqual([
      { type: 'QUEST_COMPLETED', questId: GREAT_STORYBOOK_QUEST_IDS.PATHFINDER },
    ]);
    expect(getQuestsOfferedBy('keeper-quill').map((q) => q.id)).toContain(quest.id);
  });

  it('has exactly one BUILD objective on the Painted Words change', () => {
    const objectives = allObjectives(more());
    expect(objectives).toHaveLength(1);
    expect(objectives[0]).toMatchObject({ kind: 'BUILD', changeKey: 'STUDIO_PAGE_MENDED' });
  });

  it('completes only with that change, writing the V2 change and nothing else', () => {
    const quest = more();
    const start = startQuest(quest, '2026-11-03T00:00:00Z');
    expect(advanceQuest(quest, start, context([], [], true)).state.status).not.toBe('COMPLETED');
    const done = advanceQuest(quest, start, context(['STUDIO_PAGE_MENDED'], [], false));
    expect(done.state.status).toBe('COMPLETED');
    expect(done.worldChanges.map((c) => c.changeKey)).toEqual(['GREAT_STORYBOOK_RESTORED_V2']);
    const again = advanceQuest(quest, done.state, context(['STUDIO_PAGE_MENDED'], [], false));
    expect(again.changed).toBe(false);
    expect(again.worldChanges).toEqual([]);
  });

  it('grants no second seal: no reward rule names it', () => {
    const id = GREAT_STORYBOOK_MORE_QUEST_IDS.PATHFINDER;
    expect(
      ALL_REWARD_RULES.filter(
        (r) => r.trigger.type === 'QUEST_COMPLETED' && r.trigger.questId === id,
      ),
    ).toEqual([]);
    expect(ALL_REWARD_RULES.filter((r) => r.itemIds.includes('great-storybook-seal'))).toHaveLength(
      3,
    );
  });
});
