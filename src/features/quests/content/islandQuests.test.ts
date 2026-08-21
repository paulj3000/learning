import { describe, expect, it } from 'vitest';
import { ISLAND_QUESTS } from './islandQuests';
import { QUEST_DEFINITIONS, getQuestDefinition, getQuestsOfferedBy } from './index';
import { allObjectives, getStage } from '../quest';
import { ISLAND_NPCS } from '../../npc/content';
import { ISLAND_ITEMS } from '../../rewards/content';
import { ADVENTURE_TEMPLATES } from '../../adventures/content';
import { ISLAND_LOCATIONS } from '../../island/locations';
import type { QuestDefinition } from '../types';

const ADVENTURE_SLUGS = new Set(ADVENTURE_TEMPLATES.map((template) => template.slug));
const ITEM_IDS = new Set(ISLAND_ITEMS.map((item) => item.id));
const NPC_IDS = new Set(ISLAND_NPCS.map((npc) => npc.id));
const LOCATION_SLUGS = new Set(ISLAND_LOCATIONS.map((location) => location.slug));

/** Every world-change key any authored adventure can actually record. */
const ADVENTURE_WORLD_CHANGE_KEYS = new Set(
  ADVENTURE_TEMPLATES.flatMap((template) =>
    template.steps
      .map((step) => step.presentation)
      .filter((presentation) => presentation.kind === 'world-change')
      .map((presentation) => presentation.payload.changeKey),
  ),
);

/** Every memory flag some authored dialogue node can actually set. */
const SETTABLE_MEMORY_FLAGS = new Set(
  ISLAND_NPCS.flatMap((npc) => npc.dialogue.flatMap((node) => [...(node.setsMemoryFlags ?? [])])),
);
/** Plus the flags quests themselves set on completion. */
for (const quest of ISLAND_QUESTS) {
  for (const entry of quest.completion.setsNpcMemoryFlags ?? []) {
    for (const flag of entry.flags) SETTABLE_MEMORY_FLAGS.add(flag);
  }
}

/** Keys quests record themselves, which a later objective may legitimately watch for. */
const QUEST_WORLD_CHANGE_KEYS = new Set(
  ISLAND_QUESTS.flatMap((quest) => [
    ...quest.stages.flatMap((stage) => (stage.worldChanges ?? []).map((c) => c.changeKey)),
    ...(quest.completion.worldChanges ?? []).map((c) => c.changeKey),
  ]),
);

describe('island quest content', () => {
  it('defines a quest for every questId an NPC offers', () => {
    const offeredIds = ISLAND_NPCS.flatMap((npc) => npc.questOffers.map((offer) => offer.questId));

    expect(offeredIds.length).toBeGreaterThan(0);
    for (const questId of offeredIds) {
      expect(getQuestDefinition(questId), `no quest defined for offer "${questId}"`).toBeDefined();
    }
  });

  it('names a real NPC as the giver, matching that NPC own offer', () => {
    for (const quest of QUEST_DEFINITIONS) {
      if (!quest.giverNpcId) continue;
      expect(NPC_IDS.has(quest.giverNpcId)).toBe(true);
      expect(getQuestsOfferedBy(quest.giverNpcId).map((q) => q.id)).toContain(quest.id);
    }
  });

  it('uses unique quest, stage, and objective ids', () => {
    const questIds = QUEST_DEFINITIONS.map((quest) => quest.id);
    expect(new Set(questIds).size).toBe(questIds.length);

    for (const quest of QUEST_DEFINITIONS) {
      const stageIds = quest.stages.map((stage) => stage.id);
      expect(new Set(stageIds).size, `duplicate stage id in ${quest.id}`).toBe(stageIds.length);

      const objectiveIds = allObjectives(quest).map((objective) => objective.id);
      expect(new Set(objectiveIds).size, `duplicate objective id in ${quest.id}`).toBe(
        objectiveIds.length,
      );
    }
  });

  it('points every entry stage, branch, and fallthrough at a stage that exists', () => {
    for (const quest of QUEST_DEFINITIONS) {
      expect(getStage(quest, quest.entryStageId), `${quest.id} entry stage`).toBeDefined();

      for (const stage of quest.stages) {
        for (const branch of stage.branches ?? []) {
          expect(
            getStage(quest, branch.nextStageId),
            `${quest.id}/${stage.id} branch -> ${branch.nextStageId}`,
          ).toBeDefined();
        }
        if (stage.nextStageId) {
          expect(
            getStage(quest, stage.nextStageId),
            `${quest.id}/${stage.id} -> ${stage.nextStageId}`,
          ).toBeDefined();
        }
      }
    }
  });

  it('reaches every authored stage from the entry stage', () => {
    for (const quest of QUEST_DEFINITIONS) {
      const reachable = new Set<string>();
      const queue = [quest.entryStageId];
      while (queue.length > 0) {
        const stageId = queue.shift();
        if (!stageId || reachable.has(stageId)) continue;
        reachable.add(stageId);
        const stage = getStage(quest, stageId);
        if (!stage) continue;
        for (const branch of stage.branches ?? []) queue.push(branch.nextStageId);
        if (stage.nextStageId) queue.push(stage.nextStageId);
      }

      for (const stage of quest.stages) {
        expect(reachable.has(stage.id), `${quest.id}/${stage.id} is unreachable`).toBe(true);
      }
    }
  });

  it('terminates: following fallthroughs from the entry stage always reaches an end', () => {
    for (const quest of QUEST_DEFINITIONS) {
      const seen = new Set<string>();
      let stageId: string | undefined = quest.entryStageId;
      while (stageId && !seen.has(stageId)) {
        seen.add(stageId);
        stageId = getStage(quest, stageId)?.nextStageId;
      }
      expect(stageId, `${quest.id} loops through ${[...seen].join(' -> ')}`).toBeUndefined();
    }
  });

  /**
   * The rule that matters most for a child: an objective naming content
   * that cannot be produced is a dead end they could accept and never
   * leave. Checked per primitive against the authored content that feeds it.
   */
  it('only names content that exists, so no quest can strand a child', () => {
    for (const quest of QUEST_DEFINITIONS) {
      for (const objective of allObjectives(quest)) {
        const where = `${quest.id}/${objective.id}`;
        switch (objective.kind) {
          case 'SOLVE':
            expect(ADVENTURE_SLUGS.has(objective.adventureSlug), `${where}: adventure`).toBe(true);
            break;
          case 'FIND':
          case 'CRAFT':
            expect(ITEM_IDS.has(objective.itemId), `${where}: item`).toBe(true);
            break;
          case 'COLLECT':
            for (const itemId of objective.itemIds) {
              expect(ITEM_IDS.has(itemId), `${where}: item ${itemId}`).toBe(true);
            }
            break;
          case 'TALK_TO':
          case 'HELP_NPC':
            expect(NPC_IDS.has(objective.npcId), `${where}: npc`).toBe(true);
            expect(SETTABLE_MEMORY_FLAGS.has(objective.memoryFlag), `${where}: flag`).toBe(true);
            break;
          case 'DELIVER':
            expect(ITEM_IDS.has(objective.itemId), `${where}: item`).toBe(true);
            expect(NPC_IDS.has(objective.npcId), `${where}: npc`).toBe(true);
            expect(SETTABLE_MEMORY_FLAGS.has(objective.memoryFlag), `${where}: flag`).toBe(true);
            break;
          case 'BUILD':
            expect(
              ADVENTURE_WORLD_CHANGE_KEYS.has(objective.changeKey) ||
                QUEST_WORLD_CHANGE_KEYS.has(objective.changeKey),
              `${where}: world change`,
            ).toBe(true);
            break;
          case 'EXPLORE':
            expect(LOCATION_SLUGS.has(objective.locationSlug), `${where}: location`).toBe(true);
            break;
          case 'DISCOVER':
            // Phase 26 owns discovery keys; nothing can satisfy one yet, so
            // authoring one today would be exactly the dead end this test
            // exists to prevent.
            expect.fail(`${where}: DISCOVER is not satisfiable until Phase 26`);
            break;
          case 'LEARN':
            expect(objective.learningObjectiveCode.length).toBeGreaterThan(0);
            break;
        }
      }
    }
  });

  it('records world changes only at real island locations', () => {
    for (const quest of QUEST_DEFINITIONS) {
      const changes = [
        ...quest.stages.flatMap((stage) => stage.worldChanges ?? []),
        ...(quest.completion.worldChanges ?? []),
      ];
      for (const change of changes) {
        expect(LOCATION_SLUGS.has(change.locationSlug), `${quest.id}: ${change.locationSlug}`).toBe(
          true,
        );
      }
    }
  });

  it('sets completion memory flags only on NPCs that exist', () => {
    for (const quest of QUEST_DEFINITIONS) {
      for (const entry of quest.completion.setsNpcMemoryFlags ?? []) {
        expect(NPC_IDS.has(entry.npcId), `${quest.id}: ${entry.npcId}`).toBe(true);
      }
    }
  });

  /**
   * Phase 23 authored two dialogue conditions - Pip's offer gate and
   * Quill's returning-author greeting - on flags nothing could set, since
   * completing a quest was what should set them. This asserts the loop is
   * now closed, and would fail again if a future edit dropped either.
   */
  it('sets the NPC flags Phase 23 left dangling', () => {
    const questFlags = new Set(
      ISLAND_QUESTS.flatMap((quest) =>
        (quest.completion.setsNpcMemoryFlags ?? []).flatMap((entry) => [...entry.flags]),
      ),
    );

    expect(questFlags.has('bridgeQuestCompleted')).toBe(true);
    expect(questFlags.has('finishedAStory')).toBe(true);
  });

  it('gives every quest child-facing copy on every stage and objective', () => {
    for (const quest of QUEST_DEFINITIONS) {
      expect(quest.title.length).toBeGreaterThan(0);
      expect(quest.summary.length).toBeGreaterThan(0);
      expect(quest.completion.journalNote.length).toBeGreaterThan(0);
      expect(quest.ageBands.length).toBeGreaterThan(0);

      for (const stage of quest.stages) {
        expect(stage.title.length, `${quest.id}/${stage.id}`).toBeGreaterThan(0);
        for (const objective of stage.objectives) {
          expect(objective.label.length, `${quest.id}/${objective.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('avoids em dashes in child-facing copy (CLAUDE.md section 13)', () => {
    const copy = (quest: QuestDefinition) => [
      quest.title,
      quest.summary,
      quest.completion.journalNote,
      ...quest.stages.flatMap((stage) => [
        stage.title,
        ...stage.objectives.map((objective) => objective.label),
      ]),
    ];

    for (const quest of QUEST_DEFINITIONS) {
      for (const line of copy(quest)) {
        expect(line, `${quest.id}: "${line}"`).not.toContain('—');
      }
    }
  });
});
