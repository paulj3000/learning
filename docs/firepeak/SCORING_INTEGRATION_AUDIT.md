# Firepeak and North Pole: scoring integration audit and mapping (GE-100, FPV-18)

Status: audit and data mapping for the scoring lead (`core/ge-scoring`, `apps.scoring.contracts`),
2026-11-18. Written on `feature/firepeak-volcano-adventure`; North Pole rows come from
`feature/north-pole-adventure`.

**This document is data, not code.** It adds no ledger, no XP or achievement model and no change to
`RewardRule`, `GrantedRule` or `inventory.services`. Existing grants stay the source of truth. The
scoring lead turns the tables in section 4 into `AwardRule` selectors in the scoring fixtures, which
the scoring branch owns. The economy stays off until the owner approves it. ADR-011 (no
XP/coins/level economy, `docs/DECISIONS.md`) is unchanged until the scoring ADR supersedes it.

## 1. What the realms grant today

| Record | Where | Idempotency key | Timestamp | Scoring source kind |
|---|---|---|---|---|
| `GrantedRule` | `lai/apps/inventory/models.py` (unique `granted_rule_once`) | `(child, rule)` | `granted_at` | `REWARD_RULE_GRANTED`, `source_ref` = `RewardRule.rule_id` |
| `InventoryItem` | same file (unique `inventory_item_once`) | `(child, item)` | `acquired_at` | none of its own (derived from the rule). `source_rule` is nullable SET_NULL |
| Set completion item | `inventory.services._complete_sets` (FPV-18, commit a2a96ca5) | the completion item's `InventoryItem`, so `(child, set_id)` | `acquired_at` | no `GrantedRule` row is written: count it from the `InventoryItem` with `source_rule` = the rule that finished the set |
| `WorldChange` (append-only) | `lai/apps/progression/models.py` (unique `world_change_once`) | `(child, location_slug, change_key)` | `created_at` | `PUZZLE_SOLVED`, `PICKUP_COLLECTED`, `SECRET_DISCOVERED`, `REALM_MILESTONE`, `ADVENTURE_COMPLETED` (section 4.2) |
| `QuestProgress` | `lai/apps/quests/models.py` (unique `(child, quest)`) | `(child, quest)` where `status=COMPLETED` | `completed_at` | `QUEST_COMPLETED` |
| `PuzzleAttempt` | `lai/apps/game_sessions` | one row per attempt (not one per award) | | `ANSWER_CORRECT` / `LEARNING_CHALLENGE` evidence only |
| `SeasonalCompletion` (NP) | `lai/apps/seasons/models.py` (unique `(child, event, season_year)`) | `(child, event, season_year)` | `completed_at` | candidate: a yearly `REALM_MILESTONE`. Needs its own collector, or skip it because `NORTH_POLE_ADVENTURE_COMPLETE` already counts once |

Grant paths, all on the server: `solve_puzzle` grants `body["rewardRuleId"]`; `collect_pickup` grants
`placement.pickup_reward_rule`; `submit_chest_answer` grants `chest.reward_rule`
(`lai/apps/game_sessions/play.py`). A rule's `WORLD_CHANGE` trigger is a label: Django never looks a
rule up by its trigger. Practice replays (FPV-19) and already-solved puzzles grant nothing
(`lai/apps/regions/tests/test_firepeak_heart_play.py`, NP `test_north_pole_seed.py`).

No XP, points, score, stars, coins or ledger exist anywhere today. `NpcRelationship.relationship_points`
is NPC friendship, not a reward, and must not be counted.

## 2. Preservation requirements

1. The scoring ledger never writes to `GrantedRule`, `InventoryItem`, `WorldChange`, `QuestProgress`
   or `SeasonalCompletion`, and never revokes an item.
2. Backfill and live awards share the idempotency key `<source_kind>:<source_ref>:<currency>`, so a
   child who finished Firepeak before scoring existed is paid exactly once.
3. Hints, wrong answers, respawns and practice replays never reduce or withhold anything (FPV-D6,
   FP-D10). Practice replays earn nothing.
4. Hidden collectibles stay optional: no score depends on a jump-only route (FPV-D7, NP-D5).
5. No child-facing ranking or comparison (CLAUDE.md pillar 7).

## 3. Realms, places and quests

| Realm (`World.slug`) | Place / Area (`location_slug`) | Quest | Stages | Completion world change |
|---|---|---|---|---|
| `learning-adventure-island` | `firepeak-volcano` | `the-volcano-awakens` | 5 | `FIREPEAK_VOLCANO_AWAKENED` |
| `learning-adventure-island` | `firepeak-heart` | `the-heart-of-firepeak` | 7 (14 objectives) | `FIREPEAK_HEART_COMPLETE` |
| `north-pole` | `north-pole-village` | `np-q01-welcome` to `np-q09-christmas-eve` | 1 each | `NORTH_POLE_Q01_COMPLETE` to `NORTH_POLE_Q09_COMPLETE`; q09 also writes `NORTH_POLE_ADVENTURE_COMPLETE` |

Age bands: Firepeak is Pathfinders and Explorers (FP-D2, FPV-D3); North Pole is all three bands.

## 4. Mapping tables for `AwardRule` selectors

### 4.1 Reward rules to award class

Award classes: **ACHIEVEMENT** (a keepsake badge), **TROPHY** (a major keepsake), **QUEST_ITEM**
(story progress item), **COLLECTIBLE** (optional pickup), **JOURNAL** (learning entry),
**COSMETIC**. A rule with several items takes the highest class in this order: TROPHY, ACHIEVEMENT,
QUEST_ITEM, JOURNAL, COLLECTIBLE, COSMETIC. Items are listed so per-item selectors are possible too.

Heart of Firepeak (`firepeak-heart`, change keys prefixed `FIREPEAK_HEART_`):

| rule_id | Class | Granted by | Items |
|---|---|---|---|
| `fh-rule-first-steps` | ACHIEVEMENT | puzzle `fh-landing-map` | `fh-badge-first-steps` |
| `fh-rule-emberwood` | ACHIEVEMENT | puzzle `fh-emberwood-count` | `fh-crystal-forest`, `fh-badge-emberwood-explorer` |
| `fh-rule-lava` | QUEST_ITEM | puzzle `fh-lava-compare` | `fh-crystal-magma` |
| `fh-rule-caverns` | QUEST_ITEM | puzzle `fh-caverns-arrange` | `fh-crystal-cavern`, `fh-journal-rocks` |
| `fh-rule-forge` | ACHIEVEMENT | puzzle `fh-forge-circuit` | `fh-crystal-forge`, `fh-badge-forge-master` |
| `fh-rule-scientist` | ACHIEVEMENT | puzzle `fh-summit-island` | `fh-badge-volcano-scientist`, `fh-journal-magma`, `fh-journal-volcano-layers`, `fh-journal-island` |
| `fh-rule-heart` | TROPHY | puzzle `fh-heart-return` | `fh-badge-heart-of-firepeak` |
| `fh-rule-shard-landing` | COLLECTIBLE | pickup | `fh-shard-item-landing` |
| `fh-rule-shard-emberwood` | COLLECTIBLE (secret) | pickup | `fh-shard-item-emberwood` |
| `fh-rule-shard-lava` | ACHIEVEMENT (secret) | pickup, optional jump route | `fh-shard-item-lava`, `fh-badge-lava-jumper` |
| `fh-rule-shard-caverns` | COLLECTIBLE (secret) | pickup | `fh-shard-item-caverns` |
| `fh-rule-shard-forge` | COLLECTIBLE | pickup | `fh-shard-item-forge` |
| `fh-rule-shard-summit` | ACHIEVEMENT | pickup | `fh-shard-item-summit`, `fh-badge-summit-explorer` |
| `fh-rule-shard-heart` | COLLECTIBLE | pickup | `fh-shard-item-heart` |

Set completion (no rule of its own; count from the completion item):

| set_id | Members | Completion item | Class |
|---|---|---|---|
| `fh-set-elemental-crystals` | 4 crystals | `fh-badge-crystal-collector` | ACHIEVEMENT |
| `fh-set-ember-shards` | 7 shards | `fh-badge-master-explorer` | ACHIEVEMENT |

Counts: 9 achievement badges (7 rule-granted, 2 set-granted), 4 elemental crystals, 7 ember shards
(3 hidden: emberwood, lava, caverns), 4 journal entries.

The Volcano Awakens (`firepeak-volcano`):

| rule_id | Class | Granted by | Items |
|---|---|---|---|
| `reward-firepeak-telescope` | JOURNAL | puzzle `firepeak-telescope` | `journal-volcano-crater`, `journal-lava`, `journal-steam-vents` |
| `reward-firepeak-crystal` | QUEST_ITEM | puzzle `firepeak-heart-crystal` | `heart-crystal-fragment-1`, `journal-volcanic-minerals`, `journal-heart-crystal` |
| `reward-firepeak-complete` | ACHIEVEMENT | puzzle `firepeak-return` | `volcano-explorer-badge` |

Set `firepeak-discovery-journal` (5 journal entries) has no completion item.

North Pole (`north-pole-village`, change keys prefixed `NORTH_POLE_`):

| rule_id | Class | Items |
|---|---|---|
| `np-rule-welcome` | ACHIEVEMENT | `np-badge-north-pole-explorer` |
| `np-rule-workshop-gifts` (chest) | COLLECTIBLE | `np-gift-wrapped-present` |
| `np-rule-workshop` | ACHIEVEMENT | `np-badge-master-toymaker`, `np-journal-patterns` |
| `np-rule-forest` | ACHIEVEMENT | `np-badge-candy-cane-trailblazer` |
| `np-rule-lake` | ACHIEVEMENT | `np-badge-ice-hopper`, `np-journal-snow-and-ice` |
| `np-rule-reindeer` | ACHIEVEMENT | `np-badge-reindeer-rescuer`, `np-reindeer-token` |
| `np-rule-gingerbread` | ACHIEVEMENT | `np-badge-gingerbread-builder` |
| `np-rule-mountain` | ACHIEVEMENT | `np-badge-snowflake-mountain-champion`, `np-journal-water-states` |
| `np-rule-star` | TROPHY | `np-trophy-christmas-star`, `np-journal-stars` |
| `np-rule-christmas-eve` | ACHIEVEMENT | `np-badge-santas-helper`, `np-cosmetic-santa-hat`, `np-cosmetic-elf-backpack` |
| `np-rule-fragment-{village,workshop,forest,lake,stables,gingerbread,mountain}` | QUEST_ITEM | `np-star-fragment-{zone}` |
| `np-rule-snowflake-01` to `-10` | COLLECTIBLE (01 to 07 need a jump) | `np-snowflake-NN` |
| `np-rule-candy-cane-1` to `-5` | COLLECTIBLE | `np-candy-cane-N` |
| `np-rule-ornament-1` to `-5` | COLLECTIBLE (secret) | `np-ornament-N` |
| `np-rule-cookie-1` to `-3` | COLLECTIBLE | `np-cookie-N` |
| `np-rule-golden-bell-1` to `-3` | COLLECTIBLE (secret, ice cave after the finale) | `np-golden-bell-N` |
| `np-rule-snowball-found` | QUEST_ITEM | `np-snowball-collar` |

North Pole sets: `np-set-star-fragments`, `np-set-snowflakes`, `np-set-candy-canes`,
`np-set-ornaments`, `np-set-cookies`, `np-set-golden-bells`. Only `np-set-snowflakes` has a
completion item, `np-cosmetic-snowflake-scarf` (COSMETIC). The server grants it once the North Pole
branch includes a2a96ca5 (merged 2026-11-18, commit fe53e9aa, tested by
`test_the_tenth_snowflake_completes_the_set_and_gives_the_scarf_once`). The two mountain lever
chests and the two practice chests have no rule.

### 4.2 World-change keys to source kind

| Key (location) | Source kind | Note |
|---|---|---|
| `FIREPEAK_VOLCANO_AWAKENED` (`firepeak-volcano`) | `ADVENTURE_COMPLETED` | quest completion world change |
| `FIREPEAK_HEART_COMPLETE` (`firepeak-heart`) | `ADVENTURE_COMPLETED` | quest completion world change |
| `FIREPEAK_HEART_EMBERWOOD_DONE`, `_LAVA_CROSSED`, `_CAVERN_LIT`, `_FORGE_RESTORED`, `_SUMMIT_REACHED`, `_CELEBRATED` | `REALM_MILESTONE` | one per zone restored (stage ends) |
| `FIREPEAK_HEART_SHARD_EMBERWOOD`, `_SHARD_LAVA`, `_SHARD_CAVERNS` | `SECRET_DISCOVERED` | hidden shards |
| `FIREPEAK_HEART_SHARD_LANDING`, `_FORGE`, `_SUMMIT`, `_HEART` | `PICKUP_COLLECTED` | visible shards |
| `FIREPEAK_HEART_MAP_READ`, `_PATTERN_SOLVED`, `_LAVA_BRIDGE`, `_SHAPES_MATCHED`, `_FORGE_POWERED`, `_ROCKS_NAMED`, `_CRYSTALS_SET`, `_RESTORED` | `PUZZLE_SOLVED` | `payload.puzzleId` names the puzzle |
| `FIREPEAK_FEATURES_OBSERVED`, `FIREPEAK_HEART_CRYSTAL_FOUND`, `FIREPEAK_REPORTED_TO_EMBER` and the other Volcano Awakens puzzle keys (`firepeak-volcano`) | `PUZZLE_SOLVED` | `FIREPEAK_HEART_CRYSTAL_FOUND` is The Volcano Awakens' Heart Crystal fragment, not the Heart Area: match on `(location_slug, change_key)`, never on a `FIREPEAK_HEART_` prefix alone |
| `NORTH_POLE_ADVENTURE_COMPLETE` | `ADVENTURE_COMPLETED` | also creates the yearly `SeasonalCompletion` |
| `NORTH_POLE_Q01_COMPLETE` to `NORTH_POLE_Q09_COMPLETE` | none (`QUEST_COMPLETED` comes from `QuestProgress`) | count once: these duplicate quest completion |
| `NORTH_POLE_WORKSHOP_RESTORED`, `_FOREST_DONE`, `_LAKE_DONE`, `_SNOWBALL_HOME`, `_GINGER_REPAIRED`, `_MOUNTAIN_SUMMIT`, `_STAR_RESTORED`, `_CHRISTMAS_EVE` | `REALM_MILESTONE` | one per zone restored |
| `NORTH_POLE_ORNAMENT_N`, `NORTH_POLE_GOLDEN_BELL_N` | `SECRET_DISCOVERED` | hidden collectibles |
| `NORTH_POLE_FRAGMENT_*`, `NORTH_POLE_SNOWFLAKE_NN`, `_CANDY_CANE_N`, `_COOKIE_N`, `_SNOWBALL_FOUND` | `PICKUP_COLLECTED` | |
| other `NORTH_POLE_*` puzzle and chest keys (`WELCOME_LOOKED`, `LAKE_BRIDGE`, `MOUNTAIN_BRIDGE_ONE`, `FRAGMENTS_PLACED` and so on) | `PUZZLE_SOLVED` | |

Selectors should match `(location_slug, change_key)` by exact value, never by realm-specific code.
The authoritative key lists are the content exports
(`react/src/features/content-export/firepeakHeartContent.ts`, `firepeakContent.ts`, NP
`northPoleContent.ts`) and `content/exported/`. A fixture test on the scoring branch should load the
export and fail when a key in this table is missing.

### 4.3 Movement sources

`JUMP_CHALLENGE` and `PLATFORM_COURSE` (deferred in the scoring contract) have no server record in
these realms. Optional jump routes end in pickups (`fh-rule-shard-lava`, `np-snowflake-01` to `07`),
so they are already counted as `PICKUP_COLLECTED` / `SECRET_DISCOVERED` with server-bounded trust.
The client's `CourseCheckpointReached` and `PlatformGoalReached` events are `CLIENT_REPORTED` and must
never pay.

## 5. Evidence

- Grants and idempotency: `lai/apps/inventory/tests/test_grants.py` (grant once, set completion
  once), `lai/apps/game_sessions/tests/test_concurrency.py` (two grants of one rule grant once).
- Firepeak: `lai/apps/regions/tests/test_firepeak_heart_play.py` (all 14 puzzles complete the quest,
  each pickup once, practice grants nothing), `test_firepeak.py`,
  `lai/apps/catalog/tests/test_firepeak_heart_import.py`, `react/src/features/content-export/firepeakHeartContent.test.ts`.
- North Pole: `lai/apps/regions/tests/test_north_pole_seed.py` (rewards once, practice, scarf),
  `lai/apps/seasons/tests/test_seasons.py` (once per season year).
- 2026-11-18 run on the North Pole merge (PostgreSQL 16, local): seasons 35 passed;
  `test_north_pole_seed.py` 22 passed; grants, Heart security, realm quest places, discoveries
  70 passed (with one seasons fixture fix).
