# The Heart of Firepeak: architecture, content contract and workstreams

Status: **development complete on `feature/firepeak-volcano-adventure` (2026-11-18), unit-tested only.**
Nothing is merged, deployed or browser-verified. This document is the shared contract for the parallel workstreams.
Identifiers in it are fixed; a workstream that needs to change one updates this file in the same
commit and says so in its report.

Branch base: `feature/treasure-rush-palm-trees` at `420f1afd` (the shared jump controller,
third-person camera, platforms, collision footprint and movement fixes live only there; Firepeak
reuses them instead of building a second movement system). The draft PR targets
`integration/gameplay-environment-qa`.

## 1. Audit summary (Wave 0, FPV-01)

| Area | Found | Consequence |
|---|---|---|
| Firepeak today | Place `firepeak-volcano`, one 3D Area, quest `the-volcano-awakens`, NPC `professor-ember`, 5 puzzles, owner-playtested 2026-11-01 (FP-1 to FP-13, `docs/FIREPEAK_VOLCANO_ROADMAP.md`) | Preserved unchanged. Its ids, saves and world changes stay valid. |
| One Area per Place | DB constraint `regions_one_area_per_place` (ADR-041 B) | The seven-zone adventure is a **new Place with one large Area**, not a second Area on `firepeak-volcano`. |
| Taxonomy | Code: World > Location > WorldRegion (Island > Place > 3D Area); "Realm" is the child-facing word for Island; quests have stages | Realm "Firepeak" = the Firepeak Places on the home Island; Adventure = quest; Zone = a section of the Area. No new model. |
| Movement | Jump (coyote 120 ms, buffer 150 ms, no double jump), run/sprint, third-person camera, platforms (static, moving, vanish, bounce, spin, gated), course checkpoints and ground-level hazards | Reused. Lava under jump routes uses `platforming.hazards` (height-aware). Checkpoints stay at ground level (elevated respawn is unsupported). |
| Puzzle kinds | Closed registry; client assumes one puzzle per kind | Two new **multi-instance** kinds: `CHOOSE_ANSWER`, `ORDER_SEQUENCE` (section 5). |
| Achievements | No model by design (ADR-033); badges are `KEEPSAKE` items via idempotent reward rules | Achievements are keepsakes granted by reward rules. |
| Question Studio | Bank serves only Treasure Rush chests (integer math) | Firepeak math questions are authored variants; bank adoption is a documented extension point (section 11). |
| Sound | Django cues (ADR-050); client zone ambience table is Treasure Rush-named | Firepeak cue table + region-keyed zone ambience. |
| Storybook / trophies | Castle-scoped, no Firepeak, contract changes needed on the active Storykeeper branch | Firepeak side of the contract only (section 13). |
| Trello | Only `[Subproject] Firepeak / Volcano Adventure`; ids FP-1 to FP-13 already used | New task ids are **FPV-01 to FPV-24** (FP-n stay with The Volcano Awakens). |

## 2. Decisions (recorded as ADR-070 in `docs/DECISIONS.md`)

- **FPV-D1. New Place, one Area.** Place slug `firepeak-heart`, 3D Area `firepeak-heart`, on the
  home Island. Title "Heart of Firepeak". The adventure is the quest `the-heart-of-firepeak`.
- **FPV-D2. Not gated on The Volcano Awakens.** The primary adventure must never be blocked by a
  secondary one. Completing The Volcano Awakens first only changes one line of Flint's greeting.
- **FPV-D3. Age bands** PATHFINDER and EXPLORER (FP-D2 carried over). Band differences live in
  puzzle parameters and dialogue, never in engine branches.
- **FPV-D4. NPC names.** "Ember" already names Professor Ember (owner-playtested). Two Embers
  would confuse a five-year-old, so the fire-spirit companion is **Kindle**. Flint, Professor
  Basalt, Cinder and Ignis keep their proposed names.
- **FPV-D5. Answers are visible to the client** (the existing puzzle design rule: every kind is
  fully described by its parameters, the client may simulate, the server is the only judge).
- **FPV-D6. Practice replay.** A solved `CHOOSE_ANSWER` or `ORDER_SEQUENCE` puzzle still grades a
  submission and answers `practice: true`, recording and granting nothing.
- **FPV-D7. Safe failure.** Lava and falls return the child to the last checkpoint they touched,
  after a short supportive message. No lives, no timers, nothing lost.
- **FPV-D8. Every jump has a no-jump route** (stairs of 0.2 m rises are walkable: the controller
  steps up 0.25 m). Optional jump routes lead only to optional rewards.
- **FPV-D9. Steam vents** are gates: a steam plume plus a solid collider that a solved puzzle
  removes (`effects.openings`). No timed push hazard. Falling rocks are not built (deferred:
  they need a telegraphed moving-hazard runtime the shared engine does not have).

## 3. Story

The Heart of Firepeak is an ancient crystal (island magic, and the copy says so) that keeps the
mountain calm. It has gone dim: the old machines have stopped and the paths have closed. Flint,
an explorer, welcomes the child at Explorer's Landing and gives them the map. Kindle, a small
friendly fire spirit, joins in Emberwood Forest and offers hints. Each zone returns one
elemental crystal. Professor Basalt explains real volcano science in the Crystal Caverns and at
the summit. Cinder, the old forge keeper, needs help restarting the Ancient Forge. Ignis, the
gentle guardian, waits at the summit and asks the child to set the crystals in the order of their
journey. The Heart glows again, the mountain settles, and everyone celebrates.

Fantasy and science are separated: Professor Basalt's lines start from real facts ("Real
volcanoes..."), and anything magical is called island magic.

## 4. Area layout: `firepeak-heart`

`bounds`: `halfExtentX 32`, `halfExtentZ 96`, `wallThickness 1`. The route runs from +z to -z.
Zones are joined by **gate colliders** (a centre segment removed by `effects.openings` when the
previous zone's completion key exists), with fixed wall segments either side.

| # | Zone id | z range (approx.) | Entry checkpoint (effects + course) | Gate opened by |
|---|---|---|---|---|
| 1 | `explorers-landing` | 94 to 66 | `fh-cp-landing` (spawn, default) | none |
| 2 | `emberwood-forest` | 64 to 38 | `fh-cp-emberwood` | `FIREPEAK_HEART_MAP_READ` |
| 3 | `lava-crossing` | 36 to 8 | `fh-cp-lava-near` (z ~34), `fh-cp-lava-far` (z ~10) | `FIREPEAK_HEART_EMBERWOOD_DONE` |
| 4 | `crystal-caverns` | 6 to -22 | `fh-cp-caverns` | `FIREPEAK_HEART_LAVA_CROSSED` |
| 5 | `ancient-forge` | -24 to -48 | `fh-cp-forge` | `FIREPEAK_HEART_CAVERN_LIT` |
| 6 | `firepeak-summit` | -50 to -76 | `fh-cp-summit` | `FIREPEAK_HEART_FORGE_RESTORED` |
| 7 | `heart-chamber` | -78 to -94 | `fh-cp-heart` | `FIREPEAK_HEART_SUMMIT_REACHED` |

Effects checkpoints carry `whenChangeKey` = the gate key, so resuming places the child at the
furthest zone reached. Course checkpoints (`scene.platforming.checkpoints`) at the same spots are
the respawn targets for hazards. Every checkpoint is at ground level, outside lava, not on a
platform.

Zone content (seed-authored; exact coordinates are the seed's):
1. **Explorer's Landing.** Spawn, Flint, map sign (`OBSERVE_FEATURES` map puzzle), a movement
   tutorial zone message, an optional jump-tutorial log (0.45 m jumpable) beside a walk-around
   path, the first ember shard, campfire-style landmark, gate north.
2. **Emberwood Forest.** Trees, fallen logs (jumpable boxes), rocks, a small stream (decoration),
   Kindle, two puzzles (pattern, counting), a hidden ember shard behind trees, a log-hop route
   with an always-open walk-around path.
3. **Lava Crossing.** Animated lava river (`effects.lava` with `visualOnly: true`) plus a
   `platforming.hazards` rect for respawn. Main route: the numbered-platform puzzle; solving it
   signals `world:FIREPEAK_HEART_LAVA_BRIDGE`, which makes a wide basalt bridge appear
   (`activation SIGNAL`, `hiddenUntilActive`). Optional advanced route: stepping stones (gaps
   <= 1.6 m, top <= 0.5 m) with one `vanish STAND` stone, ending at the Lava Jumper shard. A
   second puzzle (number comparison path choice) on the far bank completes the zone.
4. **Crystal Caverns.** Cave wall colliders, crystal stand-ins with point lights, Professor Basalt,
   shape puzzle, crystal arrangement puzzle, elevated ledge (static platforms with a 0.2 m stair
   alternative) holding a hidden shard, a secret passage collider opened by the arrangement key,
   a glowing exit arch as landmark.
5. **Ancient Forge.** Gears (decorative `spin` platforms out of reach, or stand-ins), switches,
   Cinder, switch-sequence puzzle, circuit path puzzle, steam vents across the north gate
   (opened by `FIREPEAK_HEART_FORGE_RESTORED`), a lift platform (`SIGNAL world:FIREPEAK_HEART_FORGE_POWERED`)
   to an optional shard.
6. **Firepeak Summit.** Ascending platforms (rises <= 0.6 m, gaps <= 1.4 m) with an always-present
   stair route (0.2 m rises), one optional moving platform, Professor Basalt's science stones (rock
   samples puzzle, island formation sequence), the Summit Explorer shard at the top, Ignis's gate.
7. **Heart Chamber.** Pedestal, the dim Heart, Ignis, crystal order puzzle, restoration
   (`COLLECT_OBJECT`), return to Ignis (`RETURN_TO_NPC`), exit portal back to the landing
   (`effects.returns`).

Layout iteration uses the Pirate's Leap version gate (`scene["firepeakHeartVersion"]`) so an
existing development database can be upgraded; the seed writes a JSON snapshot
(`lai/apps/regions/firepeak_heart_scene.json`) that Vitest loads (no hand-mirrored fixture).

## 5. New puzzle kinds (backend + client contract)

Both kinds are multi-instance: the client keys all state by `puzzleId`.

### `CHOOSE_ANSWER`

Per-band parameters:

```json
{
  "presentation": "PLATFORMS | SAMPLES | SHAPES | PATHS | CRYSTALS | CARDS",
  "subject": "MATHEMATICS | EARTH_SCIENCE | LITERACY | LOGIC",
  "skill": "slug, e.g. addition-within-10",
  "optionEntities": {"a": "fh-lava-stone-a", "b": "...", "c": "..."},
  "variants": [
    {"id": "v1", "prompt": "<= 200 chars, readable aloud",
     "options": [{"id": "a", "label": "7", "symbol": "circle"}],
     "answer": "a",
     "explanation": "<= 240 chars, supportive, says why"}
  ],
  "hints": ["..."], "hintAfterAttempts": 2
}
```

Rules: 1 to 8 variants; 2 to 4 options per variant; option ids are slugs, unique per variant;
`answer` is one of them; `symbol` is optional (from `circle, square, triangle, star, diamond,
hexagon, heart, moon`) and makes options distinguishable without colour; when `optionEntities`
is present every variant's option ids equal its keys and every entity id is in the puzzle's
`entity_ids`. Submission `{"variantId": "v1", "choice": "a"}`; an unknown variant or choice is
`invalid_submission`.

### `ORDER_SEQUENCE`

```json
{
  "presentation": "SWITCHES | CRYSTALS | STORY | PATH",
  "subject": "...", "skill": "...",
  "itemEntities": {"red": "fh-forge-switch-red"},
  "variants": [
    {"id": "v1", "prompt": "...",
     "items": [{"id": "red", "label": "Fire switch", "symbol": "triangle"}],
     "answer": ["red", "blue", "gold"],
     "explanation": "..."}
  ],
  "hints": [], "hintAfterAttempts": 2
}
```

Rules: 1 to 8 variants; 2 to 6 items; `answer` is a permutation of the item ids; `itemEntities`
as for `optionEntities`. Submission `{"variantId": "v1", "order": ["red", "blue", "gold"]}`;
not a permutation of that variant's items is `invalid_submission`.

### Shared behaviour

- Variant choice is the client's: the first unsolved visit uses
  `variants[hash(sessionId + puzzleId) % n]`; "Try a different one" and practice move to the next.
  After a wrong answer the same question stays, with supportive feedback; the hint appears after
  `hintAfterAttempts`.
- **Practice (FPV-D6):** when the puzzle is already solved, the server grades the submission and
  returns `{"correct": bool, "alreadySolved": true, "practice": true}`; no attempt, world change
  or grant is recorded. Other kinds keep returning `alreadySolved` without grading.
- `puzzleLine` parts `intro`, `completeMessage`, `scienceNote` work for the new kinds unchanged.
- Golden vectors in `tests/golden/area-puzzles.json` cover both kinds (Python and TS graders agree).

## 6. Puzzles, change keys and rewards

All change keys are recorded at location `firepeak-heart`.

| # | Puzzle id | Kind (presentation) | Zone | Requires | World change key | Reward rule |
|---|---|---|---|---|---|---|
| 1 | `fh-landing-map` | OBSERVE_FEATURES | 1 | none | `FIREPEAK_HEART_MAP_READ` | `fh-rule-first-steps` |
| 2 | `fh-emberwood-pattern` | CHOOSE_ANSWER (CRYSTALS) | 2 | 1 | `FIREPEAK_HEART_PATTERN_SOLVED` | none |
| 3 | `fh-emberwood-count` | CHOOSE_ANSWER (CARDS) | 2 | 2 | `FIREPEAK_HEART_EMBERWOOD_DONE` | `fh-rule-emberwood` |
| 4 | `fh-lava-numbers` | CHOOSE_ANSWER (PLATFORMS) | 3 | 3 | `FIREPEAK_HEART_LAVA_BRIDGE` | none |
| 5 | `fh-lava-compare` | CHOOSE_ANSWER (PATHS) | 3 | 4 | `FIREPEAK_HEART_LAVA_CROSSED` | `fh-rule-lava` |
| 6 | `fh-caverns-shapes` | CHOOSE_ANSWER (SHAPES) | 4 | 5 | `FIREPEAK_HEART_SHAPES_MATCHED` | none |
| 7 | `fh-caverns-arrange` | ORDER_SEQUENCE (CRYSTALS) | 4 | 6 | `FIREPEAK_HEART_CAVERN_LIT` | `fh-rule-caverns` |
| 8 | `fh-forge-switches` | ORDER_SEQUENCE (SWITCHES) | 5 | 7 | `FIREPEAK_HEART_FORGE_POWERED` | none |
| 9 | `fh-forge-circuit` | CHOOSE_ANSWER (PATHS) | 5 | 8 | `FIREPEAK_HEART_FORGE_RESTORED` | `fh-rule-forge` |
| 10 | `fh-summit-rocks` | CHOOSE_ANSWER (SAMPLES) | 6 | 9 | `FIREPEAK_HEART_ROCKS_NAMED` | none |
| 11 | `fh-summit-island` | ORDER_SEQUENCE (STORY) | 6 | 10 | `FIREPEAK_HEART_SUMMIT_REACHED` | `fh-rule-scientist` |
| 12 | `fh-heart-crystals` | ORDER_SEQUENCE (CRYSTALS) | 7 | 11 | `FIREPEAK_HEART_CRYSTALS_SET` | none |
| 13 | `fh-heart-restore` | COLLECT_OBJECT | 7 | 12 | `FIREPEAK_HEART_RESTORED` | none |
| 14 | `fh-heart-return` | RETURN_TO_NPC (Ignis) | 7 | 13 | `FIREPEAK_HEART_CELEBRATED` | `fh-rule-heart` |

Learning content per puzzle (Pathfinder / Explorer):

| Puzzle | Pathfinder (5 to 6) | Explorer (7 to 8) |
|---|---|---|
| map | find 3 map places | find 5 map places |
| pattern | AB / ABC crystal pattern, what comes next | growing patterns, number sequences (2, 4, 6, ?) |
| count | count embers to 10, more or fewer | skip counting, counting in groups (multiplication as groups) |
| lava numbers | addition and subtraction within 10 | two-digit add/subtract, simple multiplication facts |
| lava compare | bigger/smaller number to 20 | compare and order to 100, halves (basic fractions) |
| shapes | circle, triangle, square, hexagon by sides | faces/sides/corners, halves and quarters of a shape |
| arrange | smallest to largest crystal | order by number of sides, or by fraction size |
| switches | 3-step cause and effect machine sequence | 4-step sequence with a condition ("before the gears turn, the water must cool") |
| circuit | which path reaches the lamp | which path completes the circuit; division as sharing crystals equally |
| rocks | lava vs magma; hot rock cools and hardens | igneous rocks (basalt, pumice, obsidian), active vs dormant |
| island | 3-step island story | 4 to 5 steps: magma rises, erupts, lava cools, layers build, island forms |
| crystals | order the four crystals by journey | same, with a reading-comprehension clue |

Collectibles (`COLLECTIBLE` placements with `pickup_change_key` and a pickup rule granting one
shard item each): `fh-shard-landing`, `fh-shard-emberwood` (hidden), `fh-shard-lava-jumper`
(end of the optional stepping stones), `fh-shard-caverns` (elevated ledge), `fh-shard-forge`
(lift), `fh-shard-summit` (summit top), `fh-shard-heart`. Pickup keys
`FIREPEAK_HEART_SHARD_<ZONE>` (e.g. `FIREPEAK_HEART_SHARD_LANDING`).

## 7. Items, sets, reward rules (content export)

Module: `react/src/features/content-export/firepeakHeartContent.ts`, merged by `build.ts` like
`firepeakContent.ts`.

- **Place** `firepeak-heart` (home Island, subjects SCIENCE and MATHEMATICS, volcano theme).
- **Elemental crystals** (`QUEST_ITEM`, set `fh-set-elemental-crystals`, completion item
  `fh-badge-crystal-collector`): `fh-crystal-forest`, `fh-crystal-magma`, `fh-crystal-cavern`,
  `fh-crystal-forge`.
- **Ember shards** (`COLLECTIBLE`, set `fh-set-ember-shards`, completion item
  `fh-badge-master-explorer`): `fh-shard-item-landing`, `-emberwood`, `-lava`, `-caverns`,
  `-forge`, `-summit`, `-heart`.
- **Achievements** (`KEEPSAKE`): `fh-badge-first-steps` (First Steps into Firepeak),
  `fh-badge-emberwood-explorer`, `fh-badge-lava-jumper`, `fh-badge-crystal-collector`,
  `fh-badge-forge-master` (Master of the Forge), `fh-badge-volcano-scientist`,
  `fh-badge-summit-explorer`, `fh-badge-heart-of-firepeak`, `fh-badge-master-explorer`
  (Firepeak Master Explorer).
- **Journal** entries (items with `journal` metadata, subject EARTH_SCIENCE): `fh-journal-magma`,
  `fh-journal-rocks`, `fh-journal-volcano-layers`, `fh-journal-island`.
- **Reward rules** (trigger `WORLD_CHANGE` on the named key; the puzzle or pickup names the rule):
  - `fh-rule-first-steps` -> first-steps badge
  - `fh-rule-emberwood` -> forest crystal + emberwood badge
  - `fh-rule-lava` -> magma crystal
  - `fh-rule-caverns` -> cavern crystal + `fh-journal-rocks`
  - `fh-rule-forge` -> forge crystal + forge badge
  - `fh-rule-scientist` -> scientist badge + `fh-journal-magma`, `fh-journal-volcano-layers`, `fh-journal-island`
  - `fh-rule-heart` -> heart badge
  - one `fh-rule-shard-<zone>` per shard; `fh-rule-shard-lava` also grants the lava-jumper badge;
    `fh-rule-shard-summit` also grants the summit-explorer badge.
- **Quest** `the-heart-of-firepeak`, giver `flint`, bands PATHFINDER/EXPLORER, prerequisite ALWAYS,
  seven stages `fh-stage-landing`, `-emberwood`, `-lava`, `-caverns`, `-forge`, `-summit`,
  `-heart`, each with one `BUILD` objective per puzzle key of that zone; completion records
  `FIREPEAK_HEART_COMPLETE` (UNLOCK) and a journal note.

Grants are idempotent through `GrantedRule(child, rule)`; set completion items come from the
existing collectible-set path.

## 8. NPCs

| NPC id | Name | Role | Placement entity | Zone |
|---|---|---|---|---|
| `flint` | Flint | Explorer and guide; movement teacher; quest giver | `fh-flint` | 1 |
| `kindle` | Kindle | Friendly fire spirit companion; hints; crystals; voices the Lava Crossing puzzles (zone 3 has no NPC of its own) | `fh-kindle`, `fh-kindle-heart` | 2, 7 |
| `professor-basalt` | Professor Basalt | Volcano scientist; real Earth science | `fh-basalt`, `fh-basalt-summit` | 4, 6 |
| `cinder` | Cinder | Ancient forge keeper; sequences and logic | `fh-cinder` | 5 |
| `ignis` | Ignis | Gentle guardian of the Heart; final challenge | `fh-ignis` | 7 |

Catalog dialogue (export) is the reliable baseline: greeting, help, hint and thanks nodes per
NPC, `puzzleLine` intro/complete/scienceNote per puzzle and band, conditions on world change
keys. NPC Manager records (character, persona, behavior profile, model variant, animation map,
placement) are created by `seed_npc_firepeak` (create-only, not published by default), with
authored fallbacks for AI hints (`allowAiHint` only on hint nodes; mode HYBRID) and captions when
Polly is unavailable. Chatty-style rules apply: never claims to be human, no private questions.

## 9. Sound (`lai/apps/audio/firepeak_cues.py`)

Cue ids (ADR-050 regex): `music.firepeak.realm`, `music.firepeak.finale`,
`ambient.firepeak.landing`, `ambient.firepeak.forest`, `ambient.firepeak.lava`,
`ambient.firepeak.cave`, `ambient.firepeak.forge`, `ambient.firepeak.summit_wind`,
`ambient.firepeak.heart`, `sfx.firepeak.machinery`, `sfx.firepeak.crystal_collect`,
`sfx.firepeak.switch`, `sfx.firepeak.puzzle_complete`, `sfx.firepeak.checkpoint`,
`sfx.firepeak.lava_respawn`, `sfx.firepeak.restore`, `sfx.firepeak.complete`,
`voice.firepeak.npc_greet`. Jump and landing reuse the shared movement cues. All are
`wired` only where the client plays them; missing audio is silent, never an error.

## 10. Assets (`docs/firepeak/FIREPEAK_ASSET_INVENTORY.md`)

Flat slugs prefixed `firepeak-`; declared as `ContentAsset` rows (origin DJANGO, no version,
tag `firepeak-heart`) by the seed, each with a stand-in. Characters use `firepeak-flint`,
`firepeak-kindle`, `firepeak-professor-basalt`, `firepeak-cinder`, `firepeak-ignis` in both the
Area placements and the NPC Manager variants. New stand-in shapes added to the closed
list: `TREE`, `LOG`, `GEAR`, `SWITCH`, `ROCK`, `ARCH`. No binary is committed.

## 11. Extension points (not playable)

- Question Studio: a `CHOOSE_ANSWER` puzzle may later name a `QuestionPool` (same
  `region_id`/`entity_id` scoping); published bank questions would win over authored variants
  (ADR-046 precedence). Not implemented: the bank serves only integer challenges at chest time.
- Future adventures (`docs/firepeak/FIREPEAK_FUTURE_ADVENTURES.md`): specifications only, never
  offered or listed as playable.

## 12. Shared-engine changes (isolated commits)

1. Django `scene.colliders` keep `minY`, `maxY`, `jumpable` (`regionManifest.ts readColliders`).
2. `effects.lava[].visualOnly`: draw the lava, never respawn from it (hazards do).
3. Reduced-motion respawn vignette no longer stays on screen (`.respawnFlash`).
4. New stand-in shapes (section 10).

## 13. Storykeeper and Realm Explorer contracts

- Realm Explorer: the Place appears through the served islands API once the Area is published
  (`useServedPlaces`); no second explorer, no coming-soon card for unpublished content.
- Great Storybook: Firepeak's proposed page (`WORLD_CHANGE FIREPEAK_HEART_COMPLETE`,
  `locationSlug firepeak-heart`) and trophy bindings (`fh-badge-heart-of-firepeak`) are recorded in
  `docs/firepeak/STORYKEEPER_INTEGRATION.md` and exported as data from
  `react/src/features/region-play/firepeak/storybookContract.ts`; registering them in the castle
  waits for the Storykeeper branch (it needs quest producers in `producersOf` and served-catalog
  trophy lookup).

## 14. Workstream ownership (Wave 1)

| Workstream | Branch / worktree | Owns |
|---|---|---|
| BE: puzzle kinds | `fp/puzzle-kinds` | `lai/apps/regions/{models.py,puzzles.py,authoring_kinds.py,migrations/}`, `lai/apps/game_sessions/{play.py,play_views.py,serializers*}`, `tests/golden/` (Python side) |
| FE: puzzle UI | `fp/puzzle-ui` | `react/src/api/play/`, `react/src/features/region-play/areaPuzzles.ts`, `areaPuzzleUi.ts`, `extensions/regionPlay/{AreaPuzzleLayer.tsx,areaPuzzleScene.ts,ui/*}`, `react/src/test/golden/` |
| Content | `fp/content` | `react/src/features/content-export/firepeakHeartContent.ts`, `build.ts`, `content/exported/` |
| Engine | `fp/engine` | `regionManifest.ts readColliders`, `areaEffectsScene.ts`, `regionPlayConfig.ts`, `areaStandIns.ts`, `AreaPuzzlePanels.module.css` (`.respawnFlash` only) |
| Audio | `fp/audio` | `lai/apps/audio/firepeak_cues.py` + command, `react/src/features/region-play/audio/` |
| NPC Manager | `fp/npc` | `lai/apps/npcs/management/commands/seed_npc_firepeak.py`, its tests |

Wave 2 (after merge): seed and layout (`lai/apps/regions/firepeak_heart_seed.py`, commands, scene
snapshot), engine walkthrough tests, Realm/Storybook contracts, docs. The coordinator owns
`docs/IMPLEMENTATION_STATUS.md`, `docs/DECISIONS.md`, this file, and merges.

## 15. As built (2026-11-18)

- Layout: `lai/apps/regions/firepeak_heart_layout.py` (geometry), `firepeak_heart_content.py`
  (14 puzzle bodies, 3 to 5 variants per band), `firepeak_heart_seed.py` (seed, version gate,
  snapshot `firepeak_heart_scene.json`), commands `seed_firepeak_heart`, `publish_firepeak_heart`.
- 33 platforms, 18 gate colliders, 4 jumpable logs, 166 placements; zone table in section 4 holds.
- Collectible-set completion items are now granted by the server (`inventory.services`), which
  Crystal Collector and Firepeak Master Explorer need (previously only the retired client did it).
- Realm Explorer: the islands API adds `questCount`, `questsCompleted`, `questsInProgress`,
  `completed` per Place (additive).
- A managed NPC (NPC Manager release) whose entity is an unsolved, unlocked `RETURN_TO_NPC` target
  keeps the legacy dialogue panel so the return step is always reachable.
- Known limitation: `entity_ids` is the union of both bands, so Pathfinder switch and story
  puzzles leave one or two extra answer objects that carry no label and do nothing.
