# Firepeak: future adventures (specifications only, not playable)

Status: specifications, 2026-11-18. **None of these is implemented, offered, listed or launchable.**
Per FP-D8 and FPV-D2, no launch, card or "coming soon" entry is shown for content that does not
exist, and none of them blocks The Heart of Firepeak.

Every future adventure reuses the same backbone: a quest (export), puzzles as `AreaPuzzle` rows of
existing kinds (`CHOOSE_ANSWER`, `ORDER_SEQUENCE`, `OBSERVE_FEATURES`, `COLLECT_OBJECT`,
`RETURN_TO_NPC`), keepsake items and reward rules, seed-authored layout, and the existing NPCs.

## Extension points

| Extension point | How a future adventure uses it |
|---|---|
| Quest prerequisites | `{"type": "WORLD_CHANGE", "changeKey": "FIREPEAK_HEART_COMPLETE"}` or `FIREPEAK_VOLCANO_AWAKENED` (quest prerequisites see every Place's keys). |
| Offered quests | `WorldRegion.offered_quests` on `firepeak-heart` (a second quest in the same Area) or a new Place (a new Area). |
| Puzzles in the existing Area | New `AreaPuzzle` rows with `requiresChangeKeys` from this Place; zone gates and checkpoints already exist. |
| Variants | Adding variants to a puzzle revision in Django Admin is content, not code. |
| Question Studio | A `CHOOSE_ANSWER` puzzle may later name a `QuestionPool`; published bank questions would win (ADR-046). Requires a puzzle-time bank issue endpoint (not built). |
| Sound | New assignments for the existing `*.firepeak.*` cues. |

## 1. The Lost Ember Crystals
- **Premise:** Kindle's seven ember shards were scattered; a gentle scavenger hunt across all zones.
- **Learning:** counting, number sequences, spatial directions (left, right, near, far).
- **Shape:** quest giver Kindle; prerequisite `FIREPEAK_HEART_COMPLETE`; COLLECT objectives over the
  existing shard items; one `CHOOSE_ANSWER` (CARDS) per zone about directions.
- **Reward:** keepsake "Ember Finder".

## 2. Professor Basalt's Expedition
- **Premise:** a field trip to sample rocks and read a volcano's history in its layers.
- **Learning:** igneous rocks (basalt, pumice, obsidian), layers and time order, measurement.
- **Shape:** giver Professor Basalt; three `CHOOSE_ANSWER` (SAMPLES) and one `ORDER_SEQUENCE` (STORY,
  rock layers oldest to newest); journal entries with EARTH_SCIENCE metadata.
- **Science review needed** before content is written.

## 3. The Forgotten Forge
- **Premise:** a hidden wing of the Ancient Forge needs its machines ordered and powered.
- **Learning:** multi-step sequences, if-then conditions, multiplication as repeated groups.
- **Shape:** giver Cinder; `ORDER_SEQUENCE` (SWITCHES) with 4 to 6 steps for Explorers; new
  `SIGNAL` platforms for a moving-gear course.

## 4. Secrets Beneath Firepeak
- **Premise:** the cavern's secret passage leads to an underground lake of glowing crystals.
- **Learning:** shapes and symmetry, fractions of shapes, reading comprehension clues.
- **Shape:** a new Place (a new Area) because the underground needs its own layout; giver
  Professor Basalt; prerequisite `FIREPEAK_HEART_CAVERN_LIT`.

## 5. The Great Lava Crossing
- **Premise:** a replayable crossing course with harder optional routes.
- **Learning:** mental arithmetic within 20 (Pathfinders) and 100 (Explorers), comparison.
- **Shape:** variants only, practice-graded; optional vanish and moving platforms; no timers, no
  scores, no leaderboards (CLAUDE.md section 4, pillar 7).

## 6. Journey to the Summit
- **Premise:** a guided climb with Flint, pausing at science stones.
- **Learning:** how volcanic islands form, active and dormant volcanoes, weather at altitude.
- **Shape:** giver Flint; `ORDER_SEQUENCE` (STORY) and `CHOOSE_ANSWER` (SAMPLES); reuses the summit's
  stair route so no jump is required.
