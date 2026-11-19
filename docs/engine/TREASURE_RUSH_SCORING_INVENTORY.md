# Treasure Rush: rewards and progress inventory for shared scoring (GE-100)

- **Status:** Audit (development only). Proposes a mapping; decides nothing.
- **Branch:** `feature/treasure-rush-palm-trees`, audited at `420f1afd`.
- **Audience:** the scoring lead (`core/ge-scoring`, Trello GE-100 and GE-109).
- **Last reviewed:** 2026-11-18.
- **Companion document:** [TREASURE_RUSH_ENGINE_HANDOFF.md](TREASURE_RUSH_ENGINE_HANDOFF.md).

Treasure Rush builds **no ledger, XP, coins, points or stars of its own**. Its existing
server-side facts stay the source of truth, and shared scoring reads them.

## 1. Governing decisions (conflict recorded, not resolved)

- ADR-011 ("No XP/coins/level economy", `docs/DECISIONS.md:427-454`), ADR-013 (no currency,
  `:614-637`), TR-D1 (the reward is a keepsake, not coins: `docs/TREASURE_RUSH_ROADMAP.md:217-220`)
  and the mandatory scoring standard (`docs/adventures/scoring-standard.md` on `main`, ADR-072)
  prohibit XP, coins, levels and numeric scores as the centre of play.
- GE-100 asks for XP, learning points, coins, adventure score, stars and levels, and says "do not
  activate unapproved economy".
- The scoring lead is drafting an ADR (number not yet reserved) for owner decision. Until it is
  accepted, the economy is off: a settings flag defaults to false, and each policy needs an owner
  economy approval before it can award outside dev and test.

## 2. Saved progress: models that must be preserved

Every per-child row extends `core.ChildOwnedModel` (`lai/apps/core/models.py:18-51`), which
deletes with the child (CASCADE) and rejects links to another child's session. The parent-to-child
chain is resolved by `ChildScopedMixin` (`lai/apps/users/scoping.py:33-65`). The game WebView
cookie is limited to one child and region (`game_sessions/runtime_auth.py`).

| Model | Key constraint | Meaning |
|---|---|---|
| `game_sessions.AdventureSession` | one open session per child and region (`models.py:159-163`) | the visit; pins content revisions |
| `game_sessions.ChallengeAttempt` | one ISSUED attempt per session and target; attempt number unique; immutable once answered (`models.py:390-441`) | each learning question and its snapshot |
| `game_sessions.PuzzleAttempt` | none (`models.py:513-543`) | area puzzle submissions (Firepeak; none in the cove) |
| `progression.WorldChange` | unique (child, location_slug, change_key); append-only (`progression/models.py:44-57`) | chest opened, key found, quest complete |
| `inventory.GrantedRule` | unique (child, rule) (`inventory/models.py:53`) | a reward rule fired, once per child ever |
| `inventory.InventoryItem` | unique (child, item) (`:35-37`) | owned keepsakes; no quantities |
| `quests.QuestProgress` | unique (child, quest); COMPLETED is final (`quests/models.py:21-45`) | quest status, stages, objectives |
| `education.SkillEvidence` | OneToOne to the attempt (`education/models.py:116`) | learning evidence with support level |
| `education.SkillProgress` | unique (child, objective) | mastery counters |
| `progression.NpcRelationship` | unique (child, npc_id) | Pip memory flags (no points from Treasure Rush) |

There is no JSON progress blob. `GET progress/` (`play_state.child_progress`, `play_state.py:184-195`)
derives everything from these rows. Chest "open" and "locked" are derived from `WorldChange` and
owned items (`play.py:200-236`).

## 3. Every reward-bearing event

Mechanics shared by all of them:

- `record_world_change` (`progression/services.py:9-48`) is `get_or_create` and returns
  `(row, created)`.
- `grant_reward_rule` (`inventory/services.py:18-41`) claims `GrantedRule` first, then adds
  items. **It is called again on every repeated pickup and quest-accept refresh and returns
  `granted=False`** (`play.py:480-484`, `play_views.py:193`). Only a created row is a new fact.
- Grants come from the chest or placement `reward_rule` foreign key, not from the rule's
  `trigger` JSON. The `WORLD_CHANGE` triggers in `content/exported/rewards.json` are
  documentation for chests and pickups. Only `QUEST_COMPLETED` is matched by trigger
  (`quests/services.py:209-222`).
- There are no amounts anywhere: an item is owned or not.

| Event | Endpoint (under `children/<child_id>/`) | Persisted | Idempotency | Grant | Replay |
|---|---|---|---|---|---|
| Chest challenge issued | `POST sessions/{s}/chests/{e}/challenge/` (`issue_chest_challenge`, `play.py:239-314`) | `ChallengeAttempt` | one outstanding attempt, returned again; open chest gives 409 | none | n/a |
| Chest answered wrong | `POST attempts/{a}/answer/` (`submit_chest_answer`, `play.py:365-400`) | attempt ANSWERED/incorrect; `SkillEvidence` INCORRECT | second answer gives 409 | none; retry allowed | n/a |
| Chest answered right, first time | same (`play.py:409-430`) | evidence CORRECT; `WorldChange` UNLOCK; `GrantedRule` and item; quest refresh | WorldChange and GrantedRule unique, one transaction | the chest's rule | no |
| REPLAY chest right (Lookout spyglass) | same (`play.py:405-408`) | attempt and evidence only | `TreasureChest.clean` forbids a rule (`regions/models.py:389-395`) | none | **unlimited**; evidence every time |
| Ruins pedestal (chest with presentation PUZZLE) | same path | `WorldChange` `TREASURE_COVE_RUINS_PUZZLE_SOLVED` (type UNLOCK) | WorldChange | **no reward rule** | no |
| Pickup collected | `POST sessions/{s}/pickups/{e}/` (`collect_pickup`, `play.py:457-494`) | `WorldChange` COLLECTIBLE_FOUND; pickup rule grant | WorldChange; GrantedRule | the item | no (200, `pickedUp:false`) |
| Talk to Pip | `POST sessions/{s}/npcs/{e}/talk/` (`talk_to_npc`, `play.py:508-569`) | memory flags; quest refresh | flags only set true | via quest completion | no |
| Quest accepted | `POST quests/{q}/accept/` (`start_quest`, `quests/services.py:68-91`) | `QuestProgress` | unique (child, quest) | via completion if already done | no |
| Quest objective or stage | any outcome above (`refresh_quest`, `:146-189`) | completed id lists (only grow) | row lock | none | no |
| Quest completed | same (`grant_quest_completion_rewards`, `:200-223`) | `completed_at`; rule grant; completion world changes | `just_completed` once; GrantedRule | `QUEST_COMPLETED` rules | no |
| Area puzzle solved (Firepeak only) | `POST sessions/{s}/puzzles/{p}/solve/` (`solve_puzzle`, `play.py:684-764`) | `PuzzleAttempt` each submission; `WorldChange` PUZZLE_SOLVED | already-solved check; GrantedRule | `rewardRuleId` resolved at grant time | no |

### 3.1 Treasure Cove content

| Source (seed) | World change key | Rule and item |
|---|---|---|
| `cove-chest`, Pirate Landing (`treasure_rush_seed.py:200-216`) | `TREASURE_RUSH_COVE_CHEST_OPENED` | `reward-treasure-rush-cove-chest`, golden doubloon (KEEPSAKE) |
| `cove-grove-chest`, HIDDEN until the landing chest (`pips_treasure_seed.py:175-195`) | `TREASURE_COVE_GROVE_CHEST_OPENED` | palm grove pearl (KEEPSAKE) |
| `cove-brass-key` pickup (`:157-173`) | `TREASURE_COVE_KEY_FOUND` | `reward-treasure-cove-key`, old brass key (**QUEST_ITEM**; unlocks the beach chest) |
| `cove-beach-chest`, needs the grove chest and the key (`:196-217`) | `TREASURE_COVE_BEACH_CHEST_OPENED` | shipwreck compass |
| `cove-ruins-pedestal` (`:218-239`) | `TREASURE_COVE_RUINS_PUZZLE_SOLVED` | none |
| `cove-final-chest` (`:241-260`) | `TREASURE_COVE_FINAL_CHEST_OPENED` | ruins sunstone |
| Pip's Missing Treasure completes (four objectives, then talk to Pip) | `TREASURE_COVE_QUEST_COMPLETE` (location `pirate-builder-bay`, UNLOCK; opens the gate and bridge) | `reward-pips-missing-treasure-complete`, treasure cove explorer |
| `cove-lookout-spyglass`, REPLAY, needs the quest (`:263-289`) | `TREASURE_COVE_LOOKOUT_REPLAY` (never recorded) | none |
| `cove-leap-riddle`, optional (`pirates_leap_seed.py:284-300`) | `PIRATES_LEAP_RIDDLE_SOLVED` (also raises the plank bridge, signal `world:PIRATES_LEAP_RIDDLE_SOLVED`) | pirates leap sea star |
| `cove-leap-chest` (`:302-319`) | `PIRATES_LEAP_CHEST_OPENED` (completes quest `pirates-leap`) | pirates leap medal |
| `cove-leap-shell`, `cove-leap-feather` pickups (`:262-281`) | `PIRATES_LEAP_SHELL_FOUND`, `PIRATES_LEAP_FEATHER_FOUND` | shell, feather |
| `pirates-leap` quest | none of its own | **no completion rule** |
| Legacy `treasure-rush-cove` quest | completes on the landing chest | no completion rule |

**Legacy quest (content decision for the owner).** `treasure-rush-cove` is still
`active=True` in the catalogue (`CatalogFields.active`, `catalog/models.py:81`). Since
`upgrade_pips_treasure` (`pips_treasure_seed.py:292-309`) it is no longer offered in the cove,
but it stays in the catalogue so a child who started it keeps their progress. It completes on the
same landing chest as Pip's quest, so a quest collector counting `active=True` quests would count
it. Either retire it (`active=False`, keeping its `QuestProgress` rows) or exclude it by id.

### 3.2 Events that persist nothing

- Lookout Point arrival, zone entry toasts, the campfire, vegetation: client-only, nothing
  written.
- Pirate's Leap jumps, platform goals and course checkpoints: engine bus events used for toasts
  and audio only. Checkpoints reach the server only as `WorldState.last_checkpoint_id` through
  `PATCH world-state` (`saveCheckpoint`, `react/src/features/discovery/api.ts:174`), filtered to
  authored ids. That is a resume position, not an achievement.
- `WorldState.discovered_objects` is written only by Castle discoveries
  (`progression/discoveries.py:121`).
- Treasure Cove never uses the client world-change write (`recordWorldChangeOnce`); that path
  serves collectibles in TypeScript source manifests only (`ThreeLocationWorldView.tsx:346`).
- The `sfx.coin.collect` cue exists, but there is no coin pickup mechanic (`wired=False`,
  `audio/treasure_rush_cues.py:126`).

## 4. Learning challenges

- **Selection:** a Question Studio bank first (`pick_bank_challenge`,
  `question_studio/selection.py:136-158`). The pool is the one enabled for that chest, else the
  whole region's. Only ACTIVE revisions, with grades mapped from the age band, and none repeated
  in a session. The fallback is the chest's per-band `ChallengeSpec` with a server seed
  (`play.py:277-311`). Not adaptive: mastery is not consulted.
- **Grading:** server only, against the stored snapshot (`education/challenges.py:194-204`). The
  answer never reaches the client.
- **Recorded:** the attempt, plus `SkillEvidence` (`support_level = hint_level`, `duration_ms`),
  then `SkillProgress` once per evidence row.
- **Hints:** `hintLevel` 0 to 10 is **client-supplied** (`serializers.py:44`). Do not gate
  anything on it. The client never sends `durationMs`.
- **No penalty:** nothing is removed for a wrong answer or a hint. Mastery counts hinted success
  as supported rather than independent (`mastery.py:58-68`); that is learning state, not a
  penalty.

## 5. Mapping onto shared scoring (agreed with the scoring lead, 2026-11-18)

Values are provisional and off by default. The scoring lead's contract is at
`lai/apps/scoring/contracts.py` on `core/ge-scoring` (commit 085993dc). Its idempotency key is
`<source_kind>:<source_ref>:<currency>`. Collectors read existing rows; nothing in Treasure Rush
changes.

| Treasure Rush fact | Shared scoring source | Trust | Counts |
|---|---|---|---|
| First correct answer at a CHEST, HIDDEN or PUZZLE chest (including the ruins pedestal) | its `ChallengeAttempt` | server-graded | LEARNING_CHALLENGE, once per chest |
| Correct answer at a REPLAY chest (spyglass) | attempt | server-graded | **nothing**; excluded from awards and stars (TR-20 kept) |
| Wrong answer, hint | none | n/a | never penalised; `hintLevel` never read |
| Pickup of a COLLECTIBLE item (shell, feather) | the authored pickup key | server-bounded | PICKUP_COLLECTED, once per placement |
| Pickup of a QUEST_ITEM (brass key) | the authored pickup key, with item category | server-bounded | no coins (the development coin rule pays COLLECTIBLE only) |
| Reward rule granted | `GrantedRule` row created | server | reward event; keepsake unchanged |
| Quest completed (Pip's Missing Treasure, Pirate's Leap) | `QuestProgress` COMPLETED, `quest.active=True` | server | QUEST_COMPLETED, once |
| `TREASURE_COVE_QUEST_COMPLETE` and other bare world changes | none | n/a | never counted (avoids double counting the quest) |
| Jumps, course checkpoints, platform goals | none on the server | client-reported | deferred |
| Lookout and exploration | none | n/a | nothing persisted; a server-side discovery would be a new owner-approved feature |

## 6. Migration risks for scoring

1. **Double awards:** hook only on created `GrantedRule`, `WorldChange` or `QuestProgress`
   completion inside the same transaction, never on view responses or NPC triggers. (Agreed:
   `post_save` hooks plus an idempotent reconcile under a unique key.)
2. **One fact, several events:** a chest open, its grant, quest progress and quest completion
   can all land in one transaction. Each source kind is counted once; bare world changes are not
   sources.
3. **Backfill:** existing children already hold these rows with timestamps (`created_at`,
   `granted_at`, `completed_at`, `answered_at`). A backfill must use the same deterministic keys
   as the live path. `source_session` can be null (the accept path, and SET_NULL on deletion).
4. **Shared services:** `grant_reward_rule` and `record_world_change` also serve Firepeak puzzles,
   Castle discoveries and `ADVENTURE_COMPLETED`. A hook there scores other games too.
5. **Rule drift:** an admin can re-link a chest's `reward_rule`. Map from the foreign key, never
   from `rewards.json` triggers.
6. **Deletion and privacy:** ledger rows must be `ChildOwnedModel` (CASCADE, LAI-0602 deletion
   service) and must not PROTECT catalogue rows from retirement.
7. **Keep existing guarantees:** attempts immutable, world changes append-only, a completed quest
   final, grading server-only. The ledger must never become a second source for "chest open" or
   "item owned".

## 7. Authorization coverage and gaps

Covered: authentication on every play route (`test_play_api.py:84-109`), other-family 404
(`:112-119`), sibling isolation (`:122-131`, `test_pips_treasure.py:262`,
`test_lookout_replay.py:85`), the runtime cookie scoped to child and region
(`test_game_launch.py`, `users/tests/test_tenant_isolation.py:380-420`), idempotency and
concurrency (`test_concurrency.py`, `test_chest_play.py`, `test_pips_treasure.py`,
`test_pirates_leap.py`, `test_lookout_replay.py`).

Gaps, to add before or with the scoring migration: no cross-family test for the talk or pickup
endpoints (only sibling and cookie-route tests), and the play-API route list in
`test_play_api.py:84-95` omits pickups, talk and puzzles.
