# Quest Standard

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-005, ADR-009, ADR-033, ADR-041, ADR-047, ADR-054

A Quest is a multi-stage goal a character gives the child, such as "Pip's Missing Treasure" or
"The Volcano Awakens". This standard covers how a Quest is identified, structured, owned,
published and tracked. Terminology: [realm-standard.md](realm-standard.md).

## 1. Models

| Concern | Model | Notes |
|---|---|---|
| Definition | `catalog.Quest` | `slug`, `title`, `summary`, `world`, `giver_npc_id`, `age_bands`, `adventures`; stages, objectives, branches, prerequisites and completion live in `source` (the export's shape) |
| Child progress | `quests.QuestProgress` | One row per child and quest: `status` (`ACTIVE`, `COMPLETED`), `current_stage_id`, `completed_stage_ids`, `completed_objective_ids`, timestamps |
| Advancement | `lai/apps/quests/engine.py` | Pure Python port of `react/src/features/quests/quest.ts` |
| Offering in a 3D Area | `WorldRegion.offered_quests` | NPCs and objects offer; the child accepts |

## 2. Identity and naming

- `Quest.slug` is lowercase kebab-case and unique (`pips-missing-treasure`,
  `the-volcano-awakens`).
- Stage ids and objective ids are kebab-case and unique within the Quest. Objective ids
  conventionally end in `-done` when one objective completes a stage.
- Age-specific variants of the same story are separate Quests with a band suffix
  (`restore-the-great-storybook-sprouts`, `-pathfinders`, `-explorers`) when their stages differ.
- Titles and objective labels are child-facing: short, readable aloud, localizable, no em dashes.
  **Binding:** CLAUDE.md §13

## 3. Relationships

- A Quest belongs to its Realm (`Quest.world`), not to one Adventure, and may span several Places.
  **Binding:** ADR-041 (decision D)
- `Quest.adventures` is derived on import from its `SOLVE` objectives; never type it twice.
- The giver is an NPC by `giver_npc_id` (`catalog.NpcDefinition.npc_id`). See
  [npc-standard.md](npc-standard.md).
- A Quest belongs to exactly one Realm's content pack. **Binding:** ADR-009

## 4. Structure

A Quest has an entry stage, ordered stages, and a completion block.

| Part | Rule |
|---|---|
| Prerequisites | Conditions that must hold before the Quest is offered (`ALWAYS`, `QUEST_COMPLETED`, `WORLD_CHANGE`, `ITEM_OWNED`, `OBJECTIVE_COMPLETED`) |
| Stage | A title and objectives. It completes when every non-optional objective is complete |
| Next stage | The first matching branch wins, else `nextStageId`. An authored cycle stops (`visited`) |
| Objective kinds the server can prove | `BUILD` (world change), `FIND` and `CRAFT` (item owned), `COLLECT` (items owned, optional `requiredCount`), `SOLVE` (completed adventure session), `TALK_TO` (NPC memory flag set by the server), `DISCOVER` (discovery on `WorldState`) |
| Kinds not yet ported to Django | Relationships, skill status, location unlocks, `HELP_NPC`, `DELIVER` evaluate as not complete on the server. Do not design a Quest that depends on them without first porting the engine |
| Completion | World changes, a journal note, and reward rules triggered by quest completion |

Prefer one objective per stage tied to one puzzle's world change, as Firepeak FP-D7 does: stage
order and completion are then the server quest engine's, with no extra rule.

## 5. Server authority

- The server advances a Quest from facts it can prove; it never credits progress it cannot prove
  (`lai/apps/quests/engine.py` docstring).
- Accepting a Quest is the child's choice; a session never starts a Quest by itself
  (`WorldRegion.offered_quests`).
- The client never writes `QuestProgress` directly. Quest state changes are side effects of
  server-graded answers, world changes and item grants.
- Completion writes persistent world changes. **Binding:** ADR-005

## 6. Ownership and publication

- Quests are authored in TypeScript content modules, exported (`npm run content:export`) and
  imported (`manage.py load_content`). After import Django is authoritative; staff edit stages,
  objectives, branches, prerequisites and completion through versioned revisions, and the existing
  engine evaluates them unchanged. **Binding:** ADR-047 (decision B)
- Publishing validates every reference (items, change keys, adventures). **Binding:** ADR-047
  (decision D)
- A session pins the published revisions it started with. **Binding:** ADR-047 (LAI-0813)
- No second quest model or engine for one feature. **Binding:** ADR-033, CLAUDE.md §20

## 7. Progress tracking

| Question | Answer from |
|---|---|
| Has the child accepted it? | A `QuestProgress` row exists |
| Where are they? | `current_stage_id`, `completed_stage_ids` |
| Is it finished? | `status = COMPLETED` with `completed_at` (database constraint enforces the pair) |
| What did it change? | `progression.WorldChange` rows from completion |
| What did it teach? | `education.SkillEvidence` from the challenges inside it, not from the Quest itself |

Quest progress is resumable across sessions and devices because it is server state.

## 8. Rewards

Quest rewards are `catalog.RewardRule` grants, deterministic and idempotent, with no currency.
See [scoring-standard.md](scoring-standard.md). **Binding:** ADR-011

## 9. Failure recovery

- A Quest never fails. There is no timer, no lives and no lost progress. **Binding:** ADR-053
  (no time limits)
- A child who leaves mid-Quest resumes at the current stage.
- If a stage depends on a Place the child cannot reach, the Quest must not be offered
  (prerequisites), or the stage must say where to go.

## 10. Implemented examples on `main`

| Quest | Realm, Place | Shape |
|---|---|---|
| `pips-missing-treasure` | Home Realm, Pirate Builder Bay (Treasure Cove) | Four chests then return to Pip; completion records `TREASURE_COVE_QUEST_COMPLETE` and lays the bridge (TR-14, TR-17) |
| `the-volcano-awakens` | Home Realm, Firepeak Volcano | Five stages, each completed by one `AreaPuzzle` world change (`BUILD`); completion records `FIREPEAK_VOLCANO_AWAKENED` (FP-D7, FP-D8) |
| `restore-the-great-storybook-*` | Home Realm, Storykeeper Castle | One Quest per age band |

## 11. Acceptance criteria

- [ ] Specification from [templates/quest-specification.md](templates/quest-specification.md).
- [ ] Every objective kind is one the Django engine can prove.
- [ ] Every referenced item, change key, adventure and NPC exists; publish validation passes.
- [ ] Stage labels are child-facing, age-appropriate and readable aloud.
- [ ] Server tests: acceptance, each stage advance, completion, idempotent rewards, resume.
- [ ] Child scoping test: another family's child cannot read or advance it.
- [ ] Parent dashboard shows it by skill, not by transcript ([scoring-standard.md](scoring-standard.md)).
