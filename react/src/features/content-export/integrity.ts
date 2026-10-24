/**
 * Referential integrity of the exported package (LAI-0302). Reads only the package, so it checks
 * exactly what Django would receive.
 *
 * `errors` fail the export. `ambiguities` are facts about the existing content that do not map
 * cleanly onto the Island > Adventure hierarchy; they are recorded in the manifest and never
 * "fixed" by inventing a record.
 */
import { CLOCKWORK_HARBOR_REGION_ID, WONDERWILD_HIVE_REGION_ID } from '../discovery/checkpoints';
import type { ContentPackage } from './types';

export interface Ambiguity {
  kind: string;
  ids: string[];
  detail: string;
}

export interface IntegrityReport {
  errors: string[];
  ambiguities: Ambiguity[];
}

/**
 * `nextStepId: "complete"` ends an adventure without a step of that id. The existing invariants test
 * (`adventureInvariants.test.ts`) treats it as a known terminal marker, so it is not a dangling reference.
 */
export const TERMINAL_STEP_ID = 'complete';

/** Region keys that have interaction tables or checkpoints but no `IslandLocation` record. */
export const HUB_REGION_SLUG = 'welcome-harbor';

/**
 * Regions that are real, authored 3D regions with checkpoints but are deliberately not
 * `IslandLocation` records: a child cannot choose to visit them, an adventure passes through them.
 * Listed explicitly (never inferred) so a typo in a region id still fails the export. Being listed
 * here says the region is a legitimate content reference, not that it is playable.
 */
/**
 * Regions whose NPCs are placed by the 3D scene and have no `WorldInteraction` table. An NPC there may
 * carry an `interactionId` that resolves to nothing; the same id in any other region is an error.
 */
export const regionsWithoutInteractionTable: readonly string[] = [CLOCKWORK_HARBOR_REGION_ID];

export const ADVENTURE_PASSAGE_REGION_SLUGS: readonly string[] = [WONDERWILD_HIVE_REGION_ID];

function ids<T>(items: readonly T[], pick: (item: T) => string): Set<string> {
  return new Set(items.map(pick));
}

export function checkIntegrity(pkg: ContentPackage): IntegrityReport {
  const errors: string[] = [];
  const ambiguities: Ambiguity[] = [];

  const unique = <T>(label: string, items: readonly T[], pick: (item: T) => string) => {
    const seen = new Set<string>();
    for (const item of items) {
      const id = pick(item);
      if (seen.has(id)) errors.push(`${label}: duplicate id "${id}"`);
      seen.add(id);
    }
  };
  const known = (from: string, kind: string, id: string | undefined, set: Set<string>) => {
    if (id !== undefined && !set.has(id)) errors.push(`${from}: unknown ${kind} "${id}"`);
  };

  unique('islands', pkg.islands, (x) => x.slug);
  unique('locations', pkg.locations, (x) => x.slug);
  unique('adventures', pkg.adventures, (x) => x.slug);
  unique('learningObjectives', pkg.learningObjectives, (x) => x.code);
  unique('wonderWallQuestions', pkg.wonderWallQuestions, (x) => x.id);
  unique('stories', pkg.stories, (x) => x.slug);
  unique('quests', pkg.quests, (x) => x.id);
  unique('items', pkg.items, (x) => x.id);
  unique('collectibleSets', pkg.collectibleSets, (x) => x.id);
  unique('rewardRules', pkg.rewardRules, (x) => x.id);
  unique('npcs', pkg.npcs, (x) => x.id);
  unique('discoveries', pkg.discoveries, (x) => x.id);
  unique('checkpoints', pkg.checkpoints, (x) => x.id);
  unique('interactions', pkg.interactions, (x) => x.regionSlug);
  unique('subjects', pkg.subjects, (x) => x.id);
  unique('grades', pkg.grades, (x) => x.id);
  unique('domains', pkg.domains, (x) => x.id);
  unique('skills', pkg.skills, (x) => x.id);
  unique('assets', pkg.assets, (x) => x.id);
  const allInteractions = pkg.interactions.flatMap((r) =>
    r.interactions.map((i) => ({ ...i, regionSlug: r.regionSlug })),
  );
  unique('interaction ids', allInteractions, (x) => x.id);

  const islandSlugs = ids(pkg.islands, (x) => x.slug);
  const locationSlugs = ids(pkg.locations, (x) => x.slug);
  const adventureSlugs = ids(pkg.adventures, (x) => x.slug);
  const objectiveCodes = ids(pkg.learningObjectives, (x) => x.code);
  const storySlugs = ids(pkg.stories, (x) => x.slug);
  const questIds = ids(pkg.quests, (x) => x.id);
  const itemIds = ids(pkg.items, (x) => x.id);
  const setIds = ids(pkg.collectibleSets, (x) => x.id);
  const npcIds = ids(pkg.npcs, (x) => x.id);
  const discoveryIds = ids(pkg.discoveries, (x) => x.id);
  const interactionIds = ids(allInteractions, (x) => x.id);
  const skillIds = ids(pkg.skills, (x) => x.id);
  const assetIds = ids(pkg.assets, (x) => x.id);
  const regionSlugs = new Set([
    ...locationSlugs,
    HUB_REGION_SLUG,
    ...ADVENTURE_PASSAGE_REGION_SLUGS,
  ]);
  const changeKeys = new Set<string>();

  // Islands and their packs
  for (const island of pkg.islands) {
    const from = `island "${island.slug}"`;
    const pack = island.pack;
    for (const slug of pack.locationSlugs) known(from, 'location', slug, locationSlugs);
    for (const slug of pack.adventureSlugs) known(from, 'adventure', slug, adventureSlugs);
    for (const id of pack.questIds) known(from, 'quest', id, questIds);
    for (const id of pack.itemIds) known(from, 'item', id, itemIds);
    for (const id of pack.collectibleSetIds) known(from, 'collectible set', id, setIds);
    for (const id of pack.npcIds) known(from, 'npc', id, npcIds);
    for (const id of pack.discoveryIds) known(from, 'discovery', id, discoveryIds);
    for (const slug of pack.storySlugs) known(from, 'story', slug, storySlugs);
    if (island.arrival) known(from, 'arrival location', island.arrival.locationSlug, locationSlugs);
  }
  for (const location of pkg.locations) {
    const from = `location "${location.slug}"`;
    known(from, 'island', location.worldSlug, islandSlugs);
    const island = pkg.islands.find((x) => x.slug === location.worldSlug);
    if (island && !island.pack.locationSlugs.includes(location.slug)) {
      errors.push(`${from}: not listed in the content pack of island "${location.worldSlug}"`);
    }
  }

  // Adventures
  const pseudoLocations = new Set<string>();
  const storyPseudoLocations = new Set<string>();
  for (const adventure of pkg.adventures) {
    const from = `adventure "${adventure.slug}"`;
    if (!locationSlugs.has(adventure.locationSlug)) pseudoLocations.add(adventure.locationSlug);
    const stepIds = new Set<string>();
    for (const step of adventure.steps) {
      if (stepIds.has(step.id)) errors.push(`${from}: duplicate step "${step.id}"`);
      stepIds.add(step.id);
    }
    known(from, 'entry step', adventure.entryStepId, stepIds);
    const reachableIds = new Set([...stepIds, TERMINAL_STEP_ID]);
    for (const step of adventure.steps) {
      for (const transition of step.transitions) {
        known(`${from} step "${step.id}"`, 'next step', transition.nextStepId, reachableIds);
      }
      for (const code of step.objectiveIds) {
        known(`${from} step "${step.id}"`, 'learning objective', code, objectiveCodes);
      }
      if (step.presentation.kind === 'world-change') {
        changeKeys.add(step.presentation.payload.changeKey);
      }
    }
  }
  if (pseudoLocations.size > 0) {
    ambiguities.push({
      kind: 'adventure-location-without-record',
      ids: [...pseudoLocations].sort(),
      detail:
        'These adventure locationSlug values have no IslandLocation. The source comments call them story-only pseudo-locations for story-arc challenges. They are exported as written; no location record was invented.',
    });
  }

  // Stories
  for (const story of pkg.stories) {
    const from = `story "${story.slug}"`;
    const chapterIds = ids(story.chapters, (c) => c.id);
    known(from, 'entry chapter', story.entryChapterId, chapterIds);
    if (!locationSlugs.has(story.completionWorldChange.locationSlug)) {
      storyPseudoLocations.add(story.completionWorldChange.locationSlug);
    }
    changeKeys.add(story.completionWorldChange.changeKey);
    for (const chapter of story.chapters) {
      known(`${from} chapter "${chapter.id}"`, 'next chapter', chapter.nextChapterId, chapterIds);
      for (const scene of chapter.scenes) {
        if (scene.kind === 'ADVENTURE') {
          known(`${from} scene "${scene.id}"`, 'adventure', scene.templateSlug, adventureSlugs);
        }
        if (scene.kind === 'REFLECTION') {
          for (const code of scene.objectiveIds) {
            known(`${from} scene "${scene.id}"`, 'learning objective', code, objectiveCodes);
          }
        }
      }
    }
  }

  if (storyPseudoLocations.size > 0) {
    ambiguities.push({
      kind: 'story-location-without-record',
      ids: [...storyPseudoLocations].sort(),
      detail:
        'These story completionWorldChange.locationSlug values have no IslandLocation (they name story-only places). They are exported as written; no location record was invented.',
    });
  }

  // Rewards
  for (const item of pkg.items) known(`item "${item.id}"`, 'collectible set', item.setId, setIds);
  for (const set of pkg.collectibleSets) {
    for (const id of set.itemIds) known(`set "${set.id}"`, 'item', id, itemIds);
    known(`set "${set.id}"`, 'completion item', set.completionItemId, itemIds);
  }
  for (const rule of pkg.rewardRules) {
    const from = `reward rule "${rule.id}"`;
    for (const id of rule.itemIds) known(from, 'item', id, itemIds);
    const t = rule.trigger;
    if (t.type === 'ADVENTURE_COMPLETED') known(from, 'adventure', t.templateSlug, adventureSlugs);
    if (t.type === 'STORY_COMPLETED') known(from, 'story', t.storySlug, storySlugs);
    if (t.type === 'QUEST_COMPLETED') known(from, 'quest', t.questId, questIds);
    if (t.type === 'NPC_RELATIONSHIP') known(from, 'npc', t.npcId, npcIds);
    if (t.type === 'DISCOVERY') known(from, 'discovery', t.discoveryKey, discoveryIds);
  }

  // Quests
  const checkCondition = (
    from: string,
    c: ContentPackage['quests'][number]['prerequisites'][number],
  ) => {
    if (c.type === 'QUEST_COMPLETED') known(from, 'quest', c.questId, questIds);
    if (c.type === 'ITEM_OWNED') known(from, 'item', c.itemId, itemIds);
    if (c.type === 'RELATIONSHIP_AT_LEAST') known(from, 'npc', c.npcId, npcIds);
  };
  for (const quest of pkg.quests) {
    const from = `quest "${quest.id}"`;
    known(from, 'giver npc', quest.giverNpcId, npcIds);
    for (const c of quest.prerequisites) checkCondition(from, c);
    const stageIds = ids(quest.stages, (s) => s.id);
    unique(`${from} stages`, quest.stages, (s) => s.id);
    known(from, 'entry stage', quest.entryStageId, stageIds);
    const objectiveIds = new Set<string>();
    for (const stage of quest.stages) {
      const sFrom = `${from} stage "${stage.id}"`;
      known(sFrom, 'next stage', stage.nextStageId, stageIds);
      for (const branch of stage.branches ?? []) {
        known(sFrom, 'branch stage', branch.nextStageId, stageIds);
        for (const c of branch.conditions) checkCondition(sFrom, c);
      }
      for (const change of stage.worldChanges ?? []) {
        known(sFrom, 'location', change.locationSlug, locationSlugs);
        changeKeys.add(change.changeKey);
      }
      for (const o of stage.objectives) {
        if (objectiveIds.has(o.id)) errors.push(`${from}: duplicate objective "${o.id}"`);
        objectiveIds.add(o.id);
        const oFrom = `${sFrom} objective "${o.id}"`;
        if ('npcId' in o) known(oFrom, 'npc', o.npcId, npcIds);
        if ('itemId' in o) known(oFrom, 'item', o.itemId, itemIds);
        if (o.kind === 'COLLECT') for (const id of o.itemIds) known(oFrom, 'item', id, itemIds);
        if (o.kind === 'SOLVE') known(oFrom, 'adventure', o.adventureSlug, adventureSlugs);
        if (o.kind === 'EXPLORE') known(oFrom, 'location', o.locationSlug, locationSlugs);
        if (o.kind === 'LEARN') {
          known(oFrom, 'skill', o.learningObjectiveCode, new Set([...skillIds, ...objectiveCodes]));
        }
      }
    }
    for (const change of quest.completion.worldChanges ?? []) {
      known(from, 'location', change.locationSlug, locationSlugs);
      changeKeys.add(change.changeKey);
    }
    for (const entry of quest.completion.setsNpcMemoryFlags ?? []) {
      known(from, 'npc', entry.npcId, npcIds);
    }
  }
  for (const quest of pkg.quests) {
    for (const stage of quest.stages) {
      for (const c of stage.branches?.flatMap((b) => b.conditions) ?? []) {
        if (
          c.type === 'OBJECTIVE_COMPLETED' &&
          !quest.stages.some((s) => s.objectives.some((o) => o.id === c.objectiveId))
        ) {
          errors.push(
            `quest "${quest.id}" stage "${stage.id}": unknown objective "${c.objectiveId}"`,
          );
        }
      }
    }
  }

  // NPCs
  const npcsWithoutInteraction: string[] = [];
  for (const npc of pkg.npcs) {
    const from = `npc "${npc.id}"`;
    known(from, 'home location', npc.homeLocationSlug, regionSlugs);
    if (interactionIds.has(npc.interactionId)) {
      // resolved
    } else if (
      regionsWithoutInteractionTable.includes(npc.homeLocationSlug) &&
      !pkg.interactions.some((r) => r.regionSlug === npc.homeLocationSlug)
    ) {
      npcsWithoutInteraction.push(npc.id);
    } else {
      errors.push(`${from}: unknown interaction "${npc.interactionId}"`);
    }
    for (const entry of npc.schedule)
      known(from, 'schedule location', entry.locationSlug, regionSlugs);
    const nodeIds = ids(npc.dialogue, (n) => n.id);
    unique(`${from} dialogue`, npc.dialogue, (n) => n.id);
    for (const node of npc.dialogue) {
      for (const choice of node.choices) {
        known(`${from} node "${node.id}"`, 'next node', choice.nextNodeId, nodeIds);
      }
    }
    for (const offer of npc.questOffers) known(from, 'quest', offer.questId, questIds);
  }

  // Discoveries, checkpoints, interactions
  for (const discovery of pkg.discoveries) {
    const from = `discovery "${discovery.id}"`;
    known(from, 'location', discovery.locationSlug, regionSlugs);
    known(from, 'quest', discovery.startsQuestId, questIds);
    if (discovery.worldChange) changeKeys.add(discovery.worldChange.changeKey);
    for (const r of discovery.requirements) {
      if (r.type === 'ITEM_OWNED') known(from, 'item', r.itemId, itemIds);
      if (r.type === 'DISCOVERY_PRESENT') known(from, 'discovery', r.discoveryId, discoveryIds);
    }
  }
  for (const checkpoint of pkg.checkpoints) {
    known(`checkpoint "${checkpoint.id}"`, 'region', checkpoint.regionId, regionSlugs);
  }
  for (const interaction of allInteractions) {
    const from = `interaction "${interaction.id}" (${interaction.regionSlug})`;
    known(from, 'region', interaction.regionSlug, regionSlugs);
    const a = interaction.action;
    if (a.kind === 'START_ADVENTURE') {
      known(from, 'adventure', a.templateSlug, adventureSlugs);
      known(from, 'location', a.locationSlug, locationSlugs);
    }
    if (a.kind === 'DISCOVER') known(from, 'discovery', a.discoveryId, discoveryIds);
    if (a.kind === 'TALK_TO') known(from, 'npc', a.npcId, npcIds);
    if (a.kind === 'START_STORY') known(from, 'story', a.storySlug, storySlugs);
    if (a.kind === 'NAVIGATE') {
      const to = a.to;
      if (to.startsWith('locations/')) known(from, 'location', to.slice(10), locationSlugs);
      else if (to.startsWith('world/')) known(from, 'region', to.slice(6), regionSlugs);
      else if (to !== 'world') errors.push(`${from}: unrecognised navigation target "${to}"`);
    }
    for (const r of interaction.requirements ?? []) {
      if (r.type === 'ITEM_OWNED') known(from, 'item', r.itemId, itemIds);
      if (r.type === 'DISCOVERY_PRESENT') known(from, 'discovery', r.discoveryId, discoveryIds);
    }
  }
  const hubOnly = [
    ...new Set([
      ...pkg.interactions.map((r) => r.regionSlug),
      ...pkg.checkpoints.map((c) => c.regionId),
    ]),
  ].filter((slug) => !locationSlugs.has(slug) && !ADVENTURE_PASSAGE_REGION_SLUGS.includes(slug));
  if (hubOnly.length > 0) {
    ambiguities.push({
      kind: 'region-without-location-record',
      ids: hubOnly.sort(),
      detail:
        'Interaction tables and checkpoints exist for these regions but no IslandLocation does. Welcome Harbor is the home hub. It is exported under its authoring key; it was not added to locations.',
    });
  }

  if (npcsWithoutInteraction.length > 0) {
    ambiguities.push({
      kind: 'npc-interaction-without-record',
      ids: npcsWithoutInteraction.sort(),
      detail:
        'These NPCs name an interactionId but their home region has no WorldInteraction table (Clockwork Harbor is a 3D-only region that opens conversations by NPC id). The ids are exported as written; no interaction was invented.',
    });
  }
  const passage = ADVENTURE_PASSAGE_REGION_SLUGS.filter((slug) =>
    pkg.checkpoints.some((c) => c.regionId === slug),
  );
  if (passage.length > 0) {
    ambiguities.push({
      kind: 'adventure-passage-region',
      ids: [...passage].sort(),
      detail:
        'These regions have checkpoints but no IslandLocation by design: an adventure passes through them and a child cannot choose to visit. They are exported as checkpoint metadata only. Their listing here does not assert that a playable scene exists; geometry and scenes are not part of the content export.',
    });
  }

  // Curriculum and assets
  const gradeIds = ids(pkg.grades, (x) => x.id);
  const domainIds = ids(pkg.domains, (x) => x.id);
  const subjectIds = ids(pkg.subjects, (x) => x.id);
  for (const g of pkg.grades) known(`grade "${g.id}"`, 'subject', g.subjectId, subjectIds);
  for (const d of pkg.domains) known(`domain "${d.id}"`, 'grade', d.gradeId, gradeIds);
  for (const s of pkg.skills) {
    known(`skill "${s.id}"`, 'domain', s.domainId, domainIds);
    for (const p of s.prerequisiteSkillIds) known(`skill "${s.id}"`, 'prerequisite', p, skillIds);
  }
  for (const asset of pkg.assets)
    known(`asset "${asset.id}"`, 'low-detail asset', asset.lod?.lowDetailId, assetIds);

  ambiguities.sort((a, b) => a.kind.localeCompare(b.kind));
  return { errors, ambiguities };
}
