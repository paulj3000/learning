# Scoring and Progress Standard

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-005, ADR-011, ADR-013, ADR-016, ADR-053

"Scoring" in this product means recording what a child learned and changing the world in
response. There is no score the child chases. This standard describes the approved, implemented
behaviour and separates it from ideas that need owner approval.

## 1. Binding constraints

| Rule | Source |
|---|---|
| No XP, coins, levels or `PlayerProfile` economy; the world itself is the record of achievement | **Binding:** ADR-011 |
| No drop-rate rarity, stackable or tradable items; `rarity` is never a drop chance, power tier or status rank | **Binding:** ADR-013 |
| No dark patterns, infinite scrolling, loot-box mechanics, public leaderboards or anxiety-driven streaks | **Binding:** CLAUDE.md §4 (pillar 7) |
| No play-time limits, countdowns or session cutoffs; no timed scoring | **Binding:** ADR-053 |
| Learning makes the island grow: a solved problem repairs, unlocks, creates or changes something | **Binding:** CLAUDE.md §1, §4 (pillar 2); ADR-005 |
| Parent dashboard summarises by skill, not raw chat transcripts | **Binding:** CLAUDE.md §11 (item 10) |
| Encouragement without manipulation or shame | **Binding:** CLAUDE.md §1 |
| Correctness and progress are decided by server code, never by a model or the engine | **Binding:** CLAUDE.md §7, ADR-020 |

## 2. Approved behaviour (implemented on `main`)

### 2.1 Educational achievement: evidence and mastery

- Every server-graded result writes one `education.SkillEvidence` row against a learning
  objective code, with `result`, `support_level` and difficulty, from exactly one source
  (adventure session, story progress or challenge attempt).
- `education.SkillProgress` is derived from evidence by `lai/apps/education/mastery.py`
  (LAI-0603), a Python port of `react/src/features/mastery/` pinned by golden vectors
  (`tests/golden/mastery.json`). It keeps exposure, independent success, supported success and
  an internal consecutive-independent counter, and computes a status (`LOCKED`, `INTRODUCED`,
  `DEVELOPING`, `PROFICIENT`, `MASTERED`) and an error pattern (`NONE`, `NEEDS_SUPPORT`,
  `INCONSISTENT`, `STALLED`). The thresholds are constants in that file; do not restate or
  change them in an adventure.
- A correct answer with any hint support counts as supported success, not independent mastery
  ([../ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md), hint ladder).
- A long-unpractised `PROFICIENT` or `MASTERED` skill steps down one level at read time (review
  decay); the stored row is never rewritten by it.
- Evidence is applied once per new row; a retried request cannot count twice.

### 2.2 Quest and adventure completion

- An Adventure is complete when its `AdventureSession` reaches `COMPLETED`; a Quest when its
  `QuestProgress` reaches `COMPLETED` ([quest-standard.md](quest-standard.md)).
- Completion records persistent `progression.WorldChange` rows that change what the child sees
  (Treasure Cove's bridge, `TREASURE_COVE_QUEST_COMPLETE`; Firepeak's `FIREPEAK_VOLCANO_AWAKENED`).

### 2.3 Rewards and collectibles

- Rewards are `catalog.RewardRule` rows: a trigger (`ADVENTURE_COMPLETED`, `QUEST_COMPLETED`,
  `STORY_COMPLETED`, `WORLD_CHANGE`, `DISCOVERY`, `NPC_RELATIONSHIP` in today's content) grants
  items, resolved without randomness.
- Items are `catalog.ItemDefinition` (categories `COLLECTIBLE`, `COSMETIC`, `KEEPSAKE`,
  `QUEST_ITEM`); an item is owned or not, with no quantity. `catalog.CollectibleSet` groups items
  with an optional completion item and message.
- Grants are idempotent: `inventory.InventoryItem` and `inventory.GrantedRule` make "owns this
  item" and "this rule already granted" database facts (`inventory/services.py`
  `grant_reward_rule`).
- Discovery Journal entries are ordinary items whose published content carries `journal`
  metadata (Firepeak FP-10; served by `game_sessions/serializers.py`). No separate journal model.
- One inventory across every Realm. **Binding:** ADR-009

### 2.4 Exploration

- Discoveries are recorded on `progression.WorldState` and can complete `DISCOVER` quest
  objectives or trigger `DISCOVERY` reward rules.
- Arriving in a Realm is a `WorldChange` (ADR-009).

### 2.5 Replay

- Replay is practice, not payout. A Treasure Rush `REPLAY` chest (the Lookout spyglass) issues a
  fresh question each time, grades it, records skill evidence, and grants no world change, item,
  achievement or quest progress (TR-D29, TR-20).
- A replayed answer to the same attempt is refused (`409`) and grants nothing.

### 2.6 Difficulty adjustment

- The Adaptive Adventure Director (`lai/apps/education/director.py`, ADR-016) ranks candidate
  Adventures for the child's age band by skill need, with penalties for completed and recently
  played Adventures. Deterministic; no AI; no writes.
- Within an Adventure, adaptation is modest and explainable: fewer choices, more narration,
  smaller numbers, more specific hints ([../ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md)).
- Do not silently move a child far above or below their age band. **Binding:** CLAUDE.md §3

### 2.7 Parent reporting

- Parents see progress by skill and domain (`react/src/features/parent-dashboard/`,
  `masteryOverview.ts`), in plain-language status labels, not engine vocabulary and not
  transcripts.
- Endpoints are child-scoped (`GET /children/<id>/skill-progress/`, `.../progress/`); a parent
  sees only their own children. **Binding:** CLAUDE.md §10
- Counts, dates and error patterns never reach the Director's ranking; the parent's own
  dashboard is the allowed reader of mastery detail.

## 3. Rules for new adventures

1. Record learning through the existing evidence path. Do not add a per-adventure score, points
   counter or progress model. **Binding:** ADR-033, CLAUDE.md §20
2. Express achievement as a world change the child can see on return.
3. Grant items only through `RewardRule`; make each grant idempotent and tested.
4. Never show the child a number that ranks them, compares them with others, or decays if they
   stay away.
5. Never show the internal consecutive-independent counter as a streak.
6. Celebrate effort and the consequence, not speed. No timed bonuses.
7. A replayable activity records evidence and grants nothing permanent, like `REPLAY` chests.
8. Every new reward type or presentation of progress is an owner decision (section 4).

## 4. Proposed future enhancements (require owner approval)

None of these is approved or implemented. Each needs an owner decision, and an ADR where it
touches ADR-011 or ADR-013:

| Idea | Constraint it must meet |
|---|---|
| A per-Adventure "what you helped with" summary card for the child | Descriptive only; no number, grade or star rating |
| Exploration completeness shown to parents ("found 3 of 5 discoveries") | Parent-facing only; never a child-facing completion meter that pressures |
| Collectible set completion item granted automatically once every member is owned | On `feature/firepeak-volcano-adventure` (FPV-18), not `main` |
| Optional replay variants with different numbers per age band | Evidence only; no rewards |

## 5. Acceptance criteria

- [ ] No XP, coins, levels, points, leaderboards, streak displays or timers added.
- [ ] Every graded result writes `SkillEvidence` with the right objective code and support level.
- [ ] Every reward is a `RewardRule`; idempotency tested (retry, replay, concurrent requests).
- [ ] At least one persistent world change after the adventure. **Binding:** CLAUDE.md §11
  (item 8)
- [ ] Parent dashboard shows the adventure's skills, not transcripts.
- [ ] Child-facing celebration copy follows [educational-content-standard.md](educational-content-standard.md).
