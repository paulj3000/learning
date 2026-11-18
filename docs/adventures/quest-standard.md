# Quest Standard

- **Status:** Mandatory policy (in effect once merged to `main` with owner approval; governance decision ADR-072, Proposed)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-005, ADR-033, ADR-041, ADR-047, ADR-053, ADR-054
- **Canonical sources:** [react/src/features/quests/types.ts](../../react/src/features/quests/types.ts) (quest content shape), [lai/apps/catalog/models.py](../../lai/apps/catalog/models.py) (`Quest`), [lai/apps/quests/models.py](../../lai/apps/quests/models.py) (`QuestProgress`), [docs/engine/05_QUEST_NPC_DISCOVERY_INTEGRATION.md](../engine/05_QUEST_NPC_DISCOVERY_INTEGRATION.md), [docs/PLAY_API.md](../PLAY_API.md)

A quest is an objective-driven sequence of stages within an adventure. It is the narrative and
journal layer: it tells the child what to do next and recognises what they have done. It does
not grade answers, hold layout or grant rewards by itself.

## Model

- Content: `catalog.Quest` (slug, title, summary, `world`, `giver_npc_id`, `age_bands`, derived
  `adventures`), with stages, objectives, branches, prerequisites and completion in its
  versioned content body (ADR-047 B). The authored shape is `QuestDefinition` in
  [quests/types.ts](../../react/src/features/quests/types.ts).
- Child state: `quests.QuestProgress` (`status`, `current_stage_id`, timestamps), one per child
  and quest.
- Ownership: a quest belongs to a **Realm** (`Quest.world`) and may span Places (ADR-041 D). An
  adventure "has" a quest when the quest's objectives target that adventure's Place, 3D Area,
  NPCs or step adventures. North Pole's design (pending merge) models one adventure as a Place's
  nine quests; Firepeak uses one five-stage quest; Storykeeper Castle uses one Realm-level quest,
  `restore-the-great-storybook`.

## Identifiers

- Quest slug: kebab-case, unique (`the-volcano-awakens`, `treasure-rush-cove`).
- Stage and objective ids: kebab-case, unique within the quest (`meet-professor-ember`).
- World change keys written by a stage or completion: UPPER_SNAKE_CASE with an adventure prefix.
- Full rules: [realm standard, Identifiers](realm-standard.md#identifiers).

## Required fields

| Field | Rule |
|---|---|
| `id` / slug | Stable, authored |
| `title`, `summary` | Child-facing, readable aloud, localizable, no em dashes |
| `ageBands` | Explicit; a quest is never shown to a band it was not written for |
| `giverNpcId` | Optional; when set, must match an NPC's quest offer (tested) |
| `prerequisites` | Closed `QuestCondition` list (`ALWAYS`, `QUEST_COMPLETED`, `WORLD_CHANGE`, `ITEM_OWNED`, `RELATIONSHIP_AT_LEAST`, `OBJECTIVE_COMPLETED`) |
| `entryStageId`, `stages` | Every stage reachable; every `nextStageId` and branch target exists |
| Stage `objectives` | Closed kinds only: `TALK_TO`, `HELP_NPC`, `DELIVER`, `FIND`, `COLLECT`, `CRAFT`, `SOLVE`, `BUILD`, `EXPLORE`, `LEARN`, `DISCOVER` |
| `completion` | Child-facing `journalNote`; optional world changes and NPC memory flags |

No executable logic in content. A new objective kind is a code change in the quest engine with
tests, not a content field.

## Relationships

- Objectives point at things other systems own: NPC memory flags, items, step adventures
  (`SOLVE`), world change keys (`BUILD`), Places (`EXPLORE`), skill status (`LEARN`), discoveries
  (`DISCOVER`). The quest engine observes them; it does not create a second state machine
  (engine doc 05).
- A 3D Area offers quests through `WorldRegion.offered_quests`; NPCs offer them through their
  quest offers (ADR-054 NPC releases).
- Rewards for a quest are `RewardRule` rows with a quest trigger, granted once per child by the
  reward service. See the [scoring standard](scoring-standard.md).

## Structure rules

1. **World progress gates the world; quests narrate it.** Gates, doors and puzzles key off world
   change keys, so a child who has not accepted a quest is never stuck. Accepting later credits
   what is already done (Treasure Rush walks a quest forward on accept; North Pole NP-D3 on its
   branch).
2. **Short stages.** Sprouts: one-step decisions. Pathfinders: two or three steps. Explorers:
   multi-stage missions (CLAUDE.md section 3).
3. **Optional objectives never gate.** Use `optional: true` for side errands, collectibles and
   jump routes.
4. **One clear next step.** The HUD cue and hint follow the current stage, from server state.
5. **No time conditions.** No objective, branch or failure depends on elapsed time (ADR-053).
6. **Nothing is lost.** Failing an objective never removes progress, items or completed stages.
7. **Every quest ends with a world consequence** a child can see (ADR-005).

## Ownership and publication

- Authored in TypeScript content, exported, imported with `load_content`; after import, edited
  in Django Admin as versioned revisions (ADR-047). A published administrator edit is never
  overwritten by an import.
- Visibility: the catalog's `active` plus the published revision; the server filters by age band.
- Changing a shipped quest's stage ids or keys breaks children's saved progress. Add stages or a
  new quest instead; if a change is unavoidable, the spec must include a migration of
  `QuestProgress` and owner approval.

## Progress tracking

- Server state only: `QuestProgress.status` (`ACTIVE`, `COMPLETED`) and `current_stage_id`.
  Objective completion is derived from the records the objective points at.
- Stage completion is idempotent; replays do not duplicate world changes or rewards.
- Parents see quest completion summarised by skill and activity, never as a transcript.

## Naming

Quest titles describe the child's goal from the story ("Pip's Missing Treasure", "The Volcano
Awakens"). Stage titles are short actions ("Count the planks"). No pressure words ("hurry",
"before time runs out", "don't fail").

## Acceptance checklist

- [ ] Uses `catalog.Quest` and `QuestProgress`; no feature-specific quest model or engine.
- [ ] Ids follow the identifier rules; giver NPC offer and quest id match (tested).
- [ ] Every stage reachable, every branch target exists, every objective kind is from the closed list.
- [ ] Gating uses world change keys; a child who never accepts the quest can still progress.
- [ ] Optional objectives are marked and never block completion.
- [ ] No time-based conditions; no loss of progress on failure.
- [ ] Completion records a visible world change and its rewards once only.
- [ ] Age bands declared and respected by the server.
- [ ] Unit tests cover stage order, branches, resume after leaving, and idempotent completion.
- [ ] Spec approved by the owner before build; owner QA after unit tests.
