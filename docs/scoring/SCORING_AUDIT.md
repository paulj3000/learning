# Scoring Audit (GE-101)

- **Status:** Audit record, 2026-11-18. Facts about code; no decisions.
- **Baseline:** `core/gameengine` @ `f10e3a1e` (stacked on `feature/treasure-rush-palm-trees`).
  Realm branches were read without checkout: `feature/firepeak-volcano-adventure`,
  `feature/north-pole-adventure`, `feature/treasure-rush-palm-trees` and
  `feature/storykeeper-castle-completion`. The realm owners confirmed or corrected the findings
  (Firepeak and North Pole: `docs/firepeak/SCORING_INTEGRATION_AUDIT.md` @ `3e2b513c`;
  Treasure Rush: in review messages, inventory doc to follow).

## 1. Headline

No branch has XP, points, coins, stars, scores, personal bests, timers or leaderboards. Every
reward is a catalog `ItemDefinition`, granted by a deterministic `RewardRule` once per child
through `inventory.GrantedRule`. This follows ADR-011 part A and the scoring standard, both of
which prohibit a points economy. That is the conflict raised on GE-100 (see
[the ADR draft](ADR_DRAFT_SCORING_ECONOMY.md)).

## 2. Existing reward and progress model (kept unchanged)

| Concern | Where | Behaviour |
|---|---|---|
| Items and rules | `catalog.ItemDefinition`, `catalog.RewardRule` (`trigger` JSON, M2M items) | Categories COLLECTIBLE, COSMETIC, QUEST_ITEM, KEEPSAKE; rarity is descriptive only |
| Grants | `inventory.services.grant_reward_rule` | `GrantedRule` claimed first under a unique constraint, then `InventoryItem` rows; replays grant nothing |
| Set completion | Firepeak branch `_complete_sets` (commit `a2a96ca5`) | Server grants a set's completion item; not on the base or North Pole branch yet |
| Trigger types in content | `content/exported/rewards.json` | WORLD_CHANGE 9, DISCOVERY 6, QUEST_COMPLETED 6, ADVENTURE_COMPLETED 3, STORY_COMPLETED 1, NPC_RELATIONSHIP 1 (base). Realm branches add only WORLD_CHANGE rules |
| World changes | `progression.WorldChange`, `record_world_change` | Append-only, once per (child, location, key) |
| Quests | `quests.QuestProgress`, `refresh_quest`, `save_quest_state` | Refresh checks real state; the client state route checks ids and order only |
| Adventures | `game_sessions.submit_answer`, `_on_completion` | Graded steps; completion fires ADVENTURE_COMPLETED rules and quest refresh |
| 3D Area play | `game_sessions.play` | Chests (graded challenge, REPLAY practice), pickups (no proximity check), puzzles (graded kinds, plus COLLECT_OBJECT/RETURN_TO_NPC accepted) |
| Learning evidence and mastery | `education.SkillEvidence`, `SkillProgress`, `mastery.py` | Evidence per graded attempt with support level; LOCKED to MASTERED with review decay; thresholds shared with TypeScript (golden vectors) |
| Question Studio | `question_studio`, chest challenges from bank (`_create_attempt_from_bank`) | Published items reach children as chest challenges, graded on the server |
| Parent dashboard | `react/src/features/parent-dashboard/` | Mastery overview, weekly summary, adventure support, by skill, no transcripts |
| Client reward helpers | `react/src/features/rewards/` | `resolveRewards`, set progress, display only |

## 3. Realm-specific findings

| Realm | Reward behaviour | Scoring impact |
|---|---|---|
| Treasure Rush / Treasure Cove | Chests, REPLAY spyglass (unlimited practice), PUZZLE-presentation pedestal chest, pickups, Pip's quest, legacy `treasure-rush-cove` quest completing on the same chest | REPLAY excluded; pedestal counted as a chest; only active quests counted |
| Pirate's Leap (`feature/treasure-rush-palm-trees`) | Riddle chest, medal chest (completes quest `pirates-leap`), shell and feather pickups; jump and course events client-only | Jumps and courses deferred |
| Firepeak (FPV-18) | Nine KEEPSAKE achievements, crystal and ember shard sets with server set completion, journal items, 18 WORLD_CHANGE rules; practice puzzle kinds (CHOOSE_ANSWER, ORDER_SEQUENCE) | Achievements and trophies projected from inventory; GrantedRule as the adapter |
| North Pole | Firepeak content plus 62 WORLD_CHANGE rules, 10 sets; `seasons.SeasonalCompletion` via a `post_save` on WorldChange (client-postable) | Seasons skipped; set completion arrives with the Firepeak merge |
| Storykeeper Castle | Protected world-change keys, client world-change proofs, quest `claim_is_proven`, keepsake backfill; display-only rank titles behind `CASTLE_RANKS.enabled=false` | Raises quest trust once merged; ranks stay presentational |

## 4. Learning Journey (AP-05)

AP-05 "Learning Journey progression" (Backlog) asks for an age-adaptive skill pathway and
mastery indicators driven by Django, without blocking island exit. The scoring engine adds
mastery milestones and a subject summary derived from the same `SkillProgress` counters. It
adds no thresholds of its own, so it neither replaces nor blocks AP-05. A separate card, also
labelled AP-05 ("Featured Realm"), is unrelated to scoring.

## 5. Risks recorded

- **Migration collision between realm branches:** `regions/0007` is used by both the Firepeak/
  North Pole branches and the Storykeeper branch. Scoring uses its own app, so it adds none.
- **Client-assertable sources:** the world-change POST, quest state saves, pickup proximity and
  region session completion (see [TRUST_BOUNDARY.md](TRUST_BOUNDARY.md)).
- **No engine scoring events existed** before `lai.gameplay-event` v1 (`f10e3a1e`). Earlier
  engine events (`PlayerJumped`, `PlatformGoalReached`, etc.) feed audio and toasts only.
