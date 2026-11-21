import { describe, expect, it } from 'vitest';
import { buildContentPackage } from './build';
import {
  HEART_CHANGE_KEYS,
  HEART_COLLECTIBLE_SETS,
  HEART_ITEMS,
  HEART_LOCATIONS,
  HEART_NPCS,
  HEART_PLACE_SLUG,
  HEART_PUZZLE_IDS,
  HEART_QUESTS,
  HEART_QUEST_ID,
  HEART_REWARD_RULES,
} from './firepeakHeartContent';
import { checkIntegrity } from './integrity';

const SPEAKING_PUZZLES = HEART_PUZZLE_IDS.filter((id) => id !== 'fh-heart-restore');
const ALL_LINES = HEART_NPCS.flatMap((npc) =>
  npc.dialogue.filter((n) => n.puzzleLine).map((n) => ({ npc: npc.id, node: n })),
);

describe('Heart of Firepeak content (design sections 6 to 8)', () => {
  it('passes the export integrity check', async () => {
    const report = checkIntegrity(await buildContentPackage());
    expect(report.errors).toEqual([]);
  });

  it('lists the Place on the home Island with the volcano scene', async () => {
    const pkg = await buildContentPackage();
    expect(HEART_LOCATIONS[0]).toMatchObject({
      slug: 'firepeak-heart',
      title: 'Heart of Firepeak',
      subjectAreas: ['SCIENCE', 'MATH'],
    });
    const home = pkg.islands.find((i) => i.slug === 'learning-adventure-island');
    expect(home?.pack.locationSlugs).toContain(HEART_PLACE_SLUG);
    expect(home?.pack.questIds).toContain(HEART_QUEST_ID);
    for (const npc of HEART_NPCS) expect(home?.pack.npcIds).toContain(npc.id);
    // Existing Firepeak content is untouched.
    expect(home?.pack.locationSlugs).toContain('firepeak-volcano');
    expect(home?.pack.npcIds).toContain('professor-ember');
  });

  it('has the five NPCs at the new Place without id collisions', async () => {
    const pkg = await buildContentPackage();
    expect(HEART_NPCS.map((n) => n.id)).toEqual([
      'flint',
      'kindle',
      'professor-basalt',
      'cinder',
      'ignis',
    ]);
    const ids = pkg.npcs.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const interactions = pkg.npcs.map((n) => n.interactionId);
    expect(new Set(interactions).size).toBe(interactions.length);
    for (const npc of HEART_NPCS) {
      expect(npc.homeLocationSlug).toBe(HEART_PLACE_SLUG);
      const dialogueIds = npc.dialogue.map((n) => n.id);
      expect(new Set(dialogueIds).size).toBe(dialogueIds.length);
      // Every choice leads to a node of this NPC.
      for (const node of npc.dialogue)
        for (const c of node.choices) if (c.nextNodeId) expect(dialogueIds).toContain(c.nextNodeId);
      // An unconditioned opener exists, and a conversation never opens on a follow-up.
      expect(
        npc.dialogue.some(
          (n) => !n.followUpOnly && !n.puzzleLine && n.conditions.every((c) => c.type === 'ALWAYS'),
        ),
      ).toBe(true);
    }
    expect(HEART_NPCS.find((n) => n.id === 'flint')?.questOffers.map((o) => o.questId)).toEqual([
      HEART_QUEST_ID,
    ]);
  });

  it('gives Flint the Volcano Awakens greeting before his general one', () => {
    const flint = HEART_NPCS.find((n) => n.id === 'flint')!;
    const order = flint.dialogue.map((n) => n.id);
    const variant = flint.dialogue.find((n) => n.id === 'flint-greeting-awakened')!;
    expect(variant.conditions).toEqual([
      { type: 'WORLD_CHANGE', changeKey: 'FIREPEAK_VOLCANO_AWAKENED' },
    ]);
    expect(order.indexOf('flint-greeting-awakened')).toBeLessThan(order.indexOf('flint-greeting'));
  });

  it('has world change reactions on every NPC', () => {
    for (const npc of HEART_NPCS) {
      const reacting = npc.dialogue.filter((n) =>
        n.conditions.some((c) => c.type === 'WORLD_CHANGE'),
      );
      expect(reacting.length, npc.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('has intro lines for both bands for every puzzle, and a completion line', () => {
    for (const puzzleId of SPEAKING_PUZZLES) {
      for (const band of ['PATHFINDER', 'EXPLORER'] as const) {
        for (const part of ['intro', 'completeMessage'] as const) {
          const heard = ALL_LINES.filter(
            ({ node }) =>
              node.puzzleLine?.puzzleId === puzzleId &&
              node.puzzleLine.part === part &&
              (node.ageBands ?? ['PATHFINDER', 'EXPLORER']).includes(band),
          );
          expect(heard.length, `${puzzleId} ${part} ${band}`).toBe(1);
        }
      }
    }
    // Every puzzle line is spoken by exactly one NPC.
    for (const puzzleId of HEART_PUZZLE_IDS) {
      const speakers = new Set(
        ALL_LINES.filter(({ node }) => node.puzzleLine?.puzzleId === puzzleId).map((l) => l.npc),
      );
      expect(speakers.size, puzzleId).toBeLessThanOrEqual(1);
    }
  });

  it('gives the science puzzles a science note for each band', () => {
    for (const puzzleId of ['fh-summit-rocks', 'fh-summit-island', 'fh-caverns-arrange']) {
      for (const band of ['PATHFINDER', 'EXPLORER']) {
        expect(
          ALL_LINES.some(
            ({ node }) =>
              node.puzzleLine?.puzzleId === puzzleId &&
              node.puzzleLine.part === 'scienceNote' &&
              (node.ageBands ?? [band]).includes(band as 'PATHFINDER'),
          ),
          `${puzzleId} ${band}`,
        ).toBe(true);
      }
    }
  });

  it('keeps puzzle lines follow-up only, with no choices or conditions', () => {
    for (const { node } of ALL_LINES) {
      expect(node.followUpOnly).toBe(true);
      expect(node.choices).toEqual([]);
      expect(node.conditions).toEqual([]);
    }
  });

  it('keeps Pathfinder lines shorter than Explorer lines for the science notes', () => {
    const note = (puzzle: string, band: string) =>
      ALL_LINES.find(
        ({ node }) =>
          node.puzzleLine?.puzzleId === puzzle &&
          node.puzzleLine.part === 'scienceNote' &&
          node.ageBands?.[0] === band,
      )!.node.text.length;
    expect(note('fh-summit-rocks', 'PATHFINDER')).toBeLessThan(note('fh-summit-rocks', 'EXPLORER'));
    expect(note('fh-summit-island', 'PATHFINDER')).toBeLessThan(
      note('fh-summit-island', 'EXPLORER'),
    );
  });

  it('keeps real science accurate and separate from island magic', () => {
    const text = (id: string) => ALL_LINES.find((l) => l.node.id === id)!.node.text;
    const rocks = text('basalt-summit-rocks-scienceNote-explorer');
    expect(rocks).toMatch(/igneous/);
    expect(rocks).toMatch(/pumice/);
    expect(rocks).toMatch(/obsidian/);
    expect(rocks).toMatch(/active.*dormant.*extinct/);
    expect(text('basalt-summit-rocks-scienceNote-pathfinder')).toMatch(/magma.*lava/);
    expect(text('basalt-summit-island-scienceNote-explorer')).toMatch(/Hawaii/);
    expect(text('basalt-caverns-arrange-scienceNote-explorer')).toMatch(/island magic/);
  });

  it('has every id from the design document', () => {
    const itemIds = new Set(HEART_ITEMS.map((i) => i.id));
    const expectedItems = [
      'fh-crystal-forest',
      'fh-crystal-magma',
      'fh-crystal-cavern',
      'fh-crystal-forge',
      ...['landing', 'emberwood', 'lava', 'caverns', 'forge', 'summit', 'heart'].map(
        (z) => `fh-shard-item-${z}`,
      ),
      'fh-badge-first-steps',
      'fh-badge-emberwood-explorer',
      'fh-badge-lava-jumper',
      'fh-badge-crystal-collector',
      'fh-badge-forge-master',
      'fh-badge-volcano-scientist',
      'fh-badge-summit-explorer',
      'fh-badge-heart-of-firepeak',
      'fh-badge-master-explorer',
      'fh-journal-magma',
      'fh-journal-rocks',
      'fh-journal-volcano-layers',
      'fh-journal-island',
    ];
    for (const id of expectedItems) expect(itemIds.has(id), id).toBe(true);
    expect(itemIds.size).toBe(expectedItems.length);
    expect(
      HEART_ITEMS.filter((i) => i.journal).every((i) => i.journal?.subject === 'EARTH_SCIENCE'),
    ).toBe(true);
    expect(HEART_COLLECTIBLE_SETS.map((s) => [s.id, s.completionItemId])).toEqual([
      ['fh-set-elemental-crystals', 'fh-badge-crystal-collector'],
      ['fh-set-ember-shards', 'fh-badge-master-explorer'],
    ]);

    const rules = new Map(HEART_REWARD_RULES.map((r) => [r.id, r]));
    const key = (id: string) => {
      const t = rules.get(id)?.trigger;
      return t?.type === 'WORLD_CHANGE' ? t.changeKey : undefined;
    };
    expect(key('fh-rule-first-steps')).toBe('FIREPEAK_HEART_MAP_READ');
    expect(key('fh-rule-emberwood')).toBe('FIREPEAK_HEART_EMBERWOOD_DONE');
    expect(key('fh-rule-lava')).toBe('FIREPEAK_HEART_LAVA_CROSSED');
    expect(key('fh-rule-caverns')).toBe('FIREPEAK_HEART_CAVERN_LIT');
    expect(key('fh-rule-forge')).toBe('FIREPEAK_HEART_FORGE_RESTORED');
    expect(key('fh-rule-scientist')).toBe('FIREPEAK_HEART_SUMMIT_REACHED');
    expect(key('fh-rule-heart')).toBe('FIREPEAK_HEART_CELEBRATED');
    expect(key('fh-rule-shard-landing')).toBe('FIREPEAK_HEART_SHARD_LANDING');
    expect(rules.get('fh-rule-scientist')?.itemIds).toEqual([
      'fh-badge-volcano-scientist',
      'fh-journal-magma',
      'fh-journal-volcano-layers',
      'fh-journal-island',
    ]);
    expect(rules.get('fh-rule-shard-lava')?.itemIds).toContain('fh-badge-lava-jumper');
    expect(rules.get('fh-rule-shard-summit')?.itemIds).toContain('fh-badge-summit-explorer');
    expect(rules.get('fh-rule-caverns')?.itemIds).toEqual([
      'fh-crystal-cavern',
      'fh-journal-rocks',
    ]);
    for (const zone of ['landing', 'emberwood', 'lava', 'caverns', 'forge', 'summit', 'heart'])
      expect(rules.has(`fh-rule-shard-${zone}`), zone).toBe(true);
    expect(HEART_REWARD_RULES.length).toBe(14);
  });

  it('builds the seven-stage quest from the puzzle change keys', () => {
    const quest = HEART_QUESTS[0]!;
    expect(quest.id).toBe('the-heart-of-firepeak');
    expect(quest.giverNpcId).toBe('flint');
    expect(quest.ageBands).toEqual(['PATHFINDER', 'EXPLORER']);
    expect(quest.stages.map((s) => s.id)).toEqual([
      'fh-stage-landing',
      'fh-stage-emberwood',
      'fh-stage-lava',
      'fh-stage-caverns',
      'fh-stage-forge',
      'fh-stage-summit',
      'fh-stage-heart',
    ]);
    const keys = quest.stages.flatMap((s) =>
      s.objectives.map((o) => (o.kind === 'BUILD' ? o.changeKey : '')),
    );
    expect(quest.stages.every((s) => s.objectives.every((o) => o.kind === 'BUILD'))).toBe(true);
    const puzzleKeys = Object.values(HEART_CHANGE_KEYS).filter(
      (k) => k !== 'FIREPEAK_HEART_COMPLETE',
    );
    expect([...keys].sort()).toEqual([...puzzleKeys].sort());
    expect(quest.completion.worldChanges).toEqual([
      {
        locationSlug: 'firepeak-heart',
        changeType: 'UNLOCK',
        changeKey: 'FIREPEAK_HEART_COMPLETE',
      },
    ]);
  });

  it('uses no em or en dashes in child-facing text', () => {
    const texts: string[] = [];
    for (const npc of HEART_NPCS) {
      texts.push(npc.displayName, npc.role);
      for (const n of npc.dialogue) texts.push(n.text, ...n.choices.map((c) => c.label));
      for (const o of npc.questOffers) texts.push(o.summary);
    }
    for (const i of HEART_ITEMS) texts.push(i.displayName, i.description);
    for (const r of HEART_REWARD_RULES) texts.push(r.message);
    for (const s of HEART_COLLECTIBLE_SETS) texts.push(s.displayName, s.completionMessage);
    for (const q of HEART_QUESTS) {
      texts.push(q.title, q.summary, q.completion.journalNote);
      for (const st of q.stages) texts.push(st.title, ...st.objectives.map((o) => o.label));
    }
    for (const l of HEART_LOCATIONS)
      texts.push(l.title, l.tagline, l.description, l.decoration, ...l.skills);
    for (const t of texts) expect(t).not.toMatch(/[–—]/);
  });

  it('never asks for private information or claims to be human', () => {
    const lines = HEART_NPCS.flatMap((n) => n.dialogue.map((d) => d.text)).join(' ');
    expect(lines).not.toMatch(/your name|how old|where do you live|i am (a )?human|our secret/i);
  });
});
