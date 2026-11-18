# North Pole: The Missing Christmas Star. Architecture, content contract and workstreams

Status: **in development on `feature/north-pole-adventure` (started 2026-11-18).** Nothing is
merged, deployed, browser-verified or owner-accepted. This document is the shared contract for
the parallel workstreams (NP-001 to NP-008 output). Identifiers in it are fixed; a workstream that
must change one updates this file in the same commit and says so in its report.

Trello: the existing card **SEA-04 "Christmas: North Pole Adventure MVP"** is the parent card
(reused, not duplicated). SEA-01 (seasonal architecture) and SEA-03 (scheduling) are partly
delivered by NP-023 and are cross-referenced, not closed.

## 0. Branch base and dependencies

- Base: `feature/treasure-rush-palm-trees` at `420f1afd`. The shared jump controller, third-person
  camera, platform runtime, cylindrical footprint and the Treasure Rush movement/camera fixes exist
  only there (not on `main`). North Pole reuses them; it does not build a second movement system.
- Merged in unchanged (same commits as Firepeak, so later merges are no-ops):
  - `fp/puzzle-kinds` (CHOOSE_ANSWER, ORDER_SEQUENCE, practice replay; Firepeak design section 5),
  - `fp/engine` (Django colliders keep `minY/maxY/jumpable`; stand-in shapes TREE, LOG, GEAR,
    SWITCH, ROCK, ARCH; reduced-motion respawn flash),
  - `fp/audio` (region-keyed audio registry `regionAudio.ts`).
- **Open dependency:** the React panels for CHOOSE_ANSWER / ORDER_SEQUENCE are Firepeak's
  `fp/puzzle-ui` workstream, not committed when this was written. North Pole consumes them; it
  never builds a second puzzle UI. Until they land, North Pole's choice puzzles are server-complete
  but not answerable in the browser.
- Merge order: Treasure Rush branch, then Firepeak shared work, then North Pole.

## 1. Audit summary (NP-001)

| Area | Found | North Pole consequence |
|---|---|---|
| Existing North Pole content | None in code. Trello SEA-00 epic, SEA-01..08 backlog, SEA-04 is this adventure | Reuse SEA-04 as parent; NP ids are new (no `NP-` ids existed) |
| Hierarchy | Realm = catalog `World` (Island); Place = `Location`; 3D Area = `WorldRegion` (one per Place); quest = `Quest` (stages in JSON) | New Realm `north-pole`, one Place, one Area, **nine Quest rows** |
| Movement | Jump 1.2 m, coyote 120 ms, buffer 150 ms, step-up 0.25 m, footprint 0.35 m, ground flat (y = 0) | Forgiving gaps (<= 1.6 m), every required route walkable |
| Platforms | Max 64 per Area; static jumpable layout colliders do not count | Static ledges as `layout.colliders` (jumpable), platforms only where they move, vanish, bounce or appear |
| Checkpoints | Ground level only; hazards respawn to last checkpoint; rewards never lost | Mountain is terraced so a fall drops one level, no hazard there |
| Puzzles | Closed kinds; CHOOSE_ANSWER / ORDER_SEQUENCE multi-instance (Firepeak); OBSERVE_FEATURES, PLACE_PLATFORMS, COLLECT_OBJECT, RETURN_TO_NPC still one per Area on the client | Each single-instance kind used at most once |
| Chests | Integer math only (count/add/subtract; multiply from Question Studio); Question Studio pool wins over the authored ChallengeSpec (ADR-046) | Arithmetic gates are chests with Question Studio pools + authored specs |
| Area visibility | `area.available` needs at least one non-PUZZLE/REPLAY chest with a published challenge for the band | North Pole has three math chests, every band covered |
| Rewards | `GrantedRule` one-time per child; REPLAY chests and solved-puzzle practice are the repeatable paths; badges are KEEPSAKE items; cosmetics can be owned, not equipped; set completion items are not granted server-side | Same; gaps documented, not worked around |
| NPC Manager | Characters, personas, voice profiles, FOLLOW behaviour, spawn conditions on world changes, OFFER_QUEST choices | Snowball escort = data (FOLLOW placement), no new AI navigation |
| Sound | ADR-050 cues; region-keyed tables (Firepeak) | North Pole cue table + `REGION_AUDIO` entry |
| Assets | `ContentAsset` (origin DJANGO, no version) + stand-in shapes until a GLB is published | Placeholder-first; no binaries committed |
| Seasons | Nothing in the backend; `seasons.ts` is a client-only calendar note | New `apps/seasons` app (section 10) |
| Atmosphere | Sky colour only; no fog, snowfall or aurora reachable from Django | Generic `scene.atmosphere` (section 9) |

## 2. Decisions (recorded as ADR-080 in `docs/DECISIONS.md`)

- **NP-D1. Hierarchy.** Realm `north-pole` (catalog World, not home, no travel requirement),
  Place `north-pole-village` (title "North Pole Village"), 3D Area `north-pole-village`. The
  Adventure "The Missing Christmas Star" is the Place's **nine quests** `np-q01` .. `np-q09`.
- **NP-D2. All three age bands** (SPROUT, PATHFINDER, EXPLORER). Band differences live in puzzle
  parameters, challenge specs and dialogue, never in engine branches.
- **NP-D3. World progress, not quest acceptance, gates the world.** Gates and puzzles key off world
  change keys recorded by puzzles, chests and pickups. Quests are the narrative and journal layer
  with `WORLD_CHANGE` prerequisites, so a child who never taps "accept" is never stuck, and
  accepting later credits everything already done (`QuestAcceptView` refresh).
- **NP-D4. Safe failure.** Wrong answers keep the same question with supportive feedback and a
  hint after attempts; falls return to the last checkpoint; nothing earned is ever removed; no
  timers, no lives.
- **NP-D5. Every jump has a walking route.** Required progress never needs a jump; jump routes
  lead to optional collectibles or shortcuts. Required arithmetic unlocks build walkable bridges.
- **NP-D6. Character names.** "Frosty" is an elf ice-skating guide, never a snowman (avoids a
  third-party character). No red-nosed reindeer. Santa and Mrs. Claus are folklore figures.
- **NP-D7. Science vs magic.** Polaris, Noel and Frosty state real facts ("Real reindeer..."); the
  Star is island magic, and the copy says so. No religious content; the celebration is secular
  (lights, sleigh, friends). Seasonal content stays opt-in through Realm choice.
- **NP-D8. Seasonal infrastructure is generic** (section 10): no holiday is hard-coded in the
  engine or the play API. North Pole is year-round unless staff restrict it.
- **NP-D9. Practice and replay.** Solved choice/order puzzles are practice (FPV-D6); post-story
  REPLAY chests and a secret ice cave give repeatable and post-story activities; completion is
  never locked out.

## 3. Story

A winter storm scattered the Christmas Star (island magic that helps Santa's sleigh find its way)
into seven fragments. Jingle, a cheerful elf, greets the child at Santa's Landing and teaches them
to move, look, jump and collect. Each place on the way needs help, and each helps the child find a
fragment: Tinker's workshop machine, Peppermint's candy cane trail, Frosty's frozen lake, Noel's
missing reindeer calf Snowball, Ginger's and Mrs. Claus's gingerbread village, and the top of
Snowflake Mountain. Polaris the astronomer helps put the Star back together in the observatory.
On Christmas Eve, back at Santa's Landing, Santa thanks the child, the Star lights the sky, and the
sleigh lifts off.

## 4. Area layout: `north-pole-village`

`bounds`: `halfExtentX 66`, `halfExtentZ 100`, `wallThickness 1` (132 x 200 m). x east is
positive, z south is positive; the controller faces +z at yaw 0, so "north" is yaw pi. Spawn
`np-cp-landing` at (0, 92), yaw pi.

Zone rectangles. **The zone ids are also the ids of the narration zones (`platforming.zones`
rect id) and the audio zone ids** (`regionAudio.ts`).

| # | Zone id | x range | z range | Quest |
|---|---|---|---|---|
| 1 | `santas-landing` | -24 .. 24 | 76 .. 98 | Q01 start, Q09 |
| 2 | `christmas-village` | -24 .. 24 | 30 .. 74 | Q01 |
| 3 | `santas-workshop` | -66 .. -26 | 36 .. 98 | Q02 |
| 4 | `candy-cane-forest` | 26 .. 66 | 36 .. 98 | Q03 |
| 5 | `frozen-lake` | -66 .. -26 | -18 .. 34 | Q04 |
| 6 | `reindeer-stables` | 26 .. 66 | -66 .. 34 (stables z 8..34, Pine Hollow z -66..0) | Q05 |
| 7 | `gingerbread-village` | -66 .. -26 | -66 .. -20 | Q06 |
| 8 | `north-road` | -24 .. 24 | -66 .. 28 (connector: lanterns, signposts, snowmen) | all |
| 9 | `snowflake-mountain` | -66 .. -2 | -100 .. -68 | Q07 |
| 10 | `north-pole-observatory` | 2 .. 66 | -100 .. -68 | Q08 |

Zones are separated by snowbank walls (non-jumpable colliders, height >= 2.5 m). Gates are a
snowdrift collider in a gap of the wall, removed by `effects.openings` when the key exists:

| Gate collider id | About | Opened by |
|---|---|---|
| `np-gate-workshop` | x -25, z 54 (village west) | `NORTH_POLE_WELCOME_LOOKED` |
| `np-gate-forest` | x 25, z 54 (village east) | `NORTH_POLE_WORKSHOP_RESTORED` |
| `np-gate-lake` | x -25, z 12 (north road west) | `NORTH_POLE_FOREST_DONE` |
| `np-gate-stables` | x 25, z 20 (north road east) | `NORTH_POLE_LAKE_DONE` |
| `np-gate-gingerbread` | x -25, z -42 (north road west) | `NORTH_POLE_SNOWBALL_HOME` |
| `np-gate-mountain` | x -46, z -67 (gingerbread north) | `NORTH_POLE_GINGER_REPAIRED` |
| `np-gate-observatory` | x 0, z -84 (mountain east) | `NORTH_POLE_MOUNTAIN_SUMMIT` |
| `np-gate-north-road` | x 0, z -67 (north road north end) | `NORTH_POLE_MOUNTAIN_SUMMIT` (a shortcut home) |
| `np-gate-ice-cave` | x 20, z 97 (landing, post-story secret cave) | `NORTH_POLE_CHRISTMAS_EVE` |

Effects checkpoints (resume to the furthest zone reached): `np-cp-landing` (default, no key),
`np-cp-workshop` (`NORTH_POLE_WELCOME_LOOKED`), `np-cp-forest` (`NORTH_POLE_WORKSHOP_RESTORED`),
`np-cp-lake` (`NORTH_POLE_FOREST_DONE`), `np-cp-stables` (`NORTH_POLE_LAKE_DONE`),
`np-cp-gingerbread` (`NORTH_POLE_SNOWBALL_HOME`), `np-cp-mountain` (`NORTH_POLE_GINGER_REPAIRED`),
`np-cp-observatory` (`NORTH_POLE_MOUNTAIN_SUMMIT`), `np-cp-finale` (landing,
`NORTH_POLE_STAR_RESTORED`). Each sits just inside its zone's gate, at ground level. Course
checkpoints (`platforming.checkpoints`) beside every hazard are the respawn points.

Return: `effects.returns` entity `np-observatory-sled` (a sled stand-in) takes the child to
`np-cp-finale` once `NORTH_POLE_STAR_RESTORED` exists.

## 5. Puzzles, chests, pickups and keys

All world change keys are recorded at location `north-pole-village`. Puzzle `requires` lists
world change keys (puzzle, chest or pickup). Every puzzle has all three bands.

| # | Puzzle / chest id | Kind (presentation, subject) | Zone | Requires | Key | Reward rule |
|---|---|---|---|---|---|---|
| 1 | `np-welcome-look` | OBSERVE_FEATURES (3 Sprout / 4 / 5 landmarks) | village | none | `NORTH_POLE_WELCOME_LOOKED` | `np-rule-welcome` |
| 2 | `np-workshop-count` | CHOOSE_ANSWER (CARDS, MATHEMATICS) count toys | workshop | 1 | `NORTH_POLE_WORKSHOP_TOYS_COUNTED` | none |
| 3 | `np-workshop-sort` | CHOOSE_ANSWER (SHAPES, LOGIC) sort presents by colour, shape, category | workshop | 2 | `NORTH_POLE_WORKSHOP_PRESENTS_SORTED` | none |
| 4 | `np-workshop-pattern` | CHOOSE_ANSWER (CARDS, LOGIC) what comes next on the belt | workshop | 3 | `NORTH_POLE_WORKSHOP_PATTERN_FIXED` | none |
| C1 | `np-workshop-gift-chest` | chest CHEST (math spec + Question Studio pool) | workshop | 4 | `NORTH_POLE_WORKSHOP_GIFTS_CHECKED` | `np-rule-workshop-gifts` |
| 5 | `np-workshop-assemble` | ORDER_SEQUENCE (SWITCHES, LOGIC) assemble a toy in order | workshop | C1 | `NORTH_POLE_WORKSHOP_RESTORED` | `np-rule-workshop` |
| 6 | `np-forest-sequence` | CHOOSE_ANSWER (PATHS, MATHEMATICS) number sequences | forest | 5 | `NORTH_POLE_FOREST_SEQUENCE_DONE` | none |
| 7 | `np-forest-signs` | CHOOSE_ANSWER (PATHS, LITERACY) read directional signs | forest | 6 | `NORTH_POLE_FOREST_SIGNS_READ` | none |
| 8 | `np-forest-stripes` | ORDER_SEQUENCE (PATH, LOGIC) candy-stripe pattern | forest | 7 | `NORTH_POLE_FOREST_DONE` | `np-rule-forest` |
| 9 | `np-lake-sums` | CHOOSE_ANSWER (PLATFORMS, MATHEMATICS) the ice floe with the right answer; `optionEntities` floes | lake | 8 | `NORTH_POLE_LAKE_BRIDGE` (raises the ice bridge) | none |
| 10 | `np-lake-order` | ORDER_SEQUENCE (PATH, MATHEMATICS) floes in numerical order | lake | 9 | `NORTH_POLE_LAKE_ORDERED` | none |
| 11 | `np-lake-shapes` | CHOOSE_ANSWER (SHAPES, MATHEMATICS) shapes and fractions | lake | 10 | `NORTH_POLE_LAKE_DONE` | `np-rule-lake` |
| 12 | `np-stables-facts` | CHOOSE_ANSWER (CARDS, LIFE_SCIENCE) reindeer facts | stables | 11 | `NORTH_POLE_STABLES_FACTS_LEARNED` | none |
| 13 | `np-stables-tracks` | CHOOSE_ANSWER (PATHS, LOGIC) footprints: direction, size, distance | stables | 12 | `NORTH_POLE_STABLES_TRACKS_FOLLOWED` | none |
| 14 | `np-stables-supplies` | CHOOSE_ANSWER (SAMPLES, LIFE_SCIENCE) what reindeer eat, what to bring | stables | 13 | `NORTH_POLE_STABLES_SUPPLIES_FOUND` | none |
| P | `np-snowball-collar` | pickup in Pine Hollow beside Snowball | stables | none | `NORTH_POLE_SNOWBALL_FOUND` | `np-rule-snowball-found` |
| 15 | `np-stables-return` | RETURN_TO_NPC (`np-noel`) | stables | 14, P | `NORTH_POLE_SNOWBALL_HOME` | `np-rule-reindeer` |
| 16 | `np-ginger-shapes` | CHOOSE_ANSWER (SHAPES, MATHEMATICS) geometric shapes | gingerbread | 15 | `NORTH_POLE_GINGER_SHAPES_MATCHED` | none |
| 17 | `np-ginger-symmetry` | CHOOSE_ANSWER (SHAPES, MATHEMATICS) complete the symmetric window | gingerbread | 16 | `NORTH_POLE_GINGER_SYMMETRY_DONE` | none |
| 18 | `np-ginger-recipe` | CHOOSE_ANSWER (CARDS, LITERACY) Mrs. Claus's recipe card | gingerbread | 17 | `NORTH_POLE_GINGER_RECIPE_READ` | none |
| 19 | `np-ginger-measure` | CHOOSE_ANSWER (SAMPLES, MATHEMATICS) measurement | gingerbread | 18 | `NORTH_POLE_GINGER_MEASURED` | none |
| 20 | `np-ginger-build` | PLACE_PLATFORMS (cookie beams into wall gaps) | gingerbread | 19 | `NORTH_POLE_GINGER_REPAIRED` | `np-rule-gingerbread` |
| C2 | `np-mountain-lever-1` | chest CHEST (math), raises bridge 1 | mountain | `NORTH_POLE_GINGER_REPAIRED` | `NORTH_POLE_MOUNTAIN_BRIDGE_ONE` | none |
| C3 | `np-mountain-lever-2` | chest CHEST (math), raises bridge 2 | mountain | C2 | `NORTH_POLE_MOUNTAIN_BRIDGE_TWO` | none |
| 21 | `np-mountain-weather` | CHOOSE_ANSWER (CARDS, EARTH_SCIENCE) snow, ice, water states, winter weather | summit | C3 | `NORTH_POLE_MOUNTAIN_SUMMIT` | `np-rule-mountain` |
| 22 | `np-obs-stars` | CHOOSE_ANSWER (CARDS, EARTH_SCIENCE) basic astronomy | observatory | 21 | `NORTH_POLE_OBS_STARS_LEARNED` | none |
| 23 | `np-obs-constellation` | CHOOSE_ANSWER (SHAPES, EARTH_SCIENCE) identify a constellation | observatory | 22 | `NORTH_POLE_OBS_CONSTELLATION_FOUND` | none |
| 24 | `np-obs-sequence` | ORDER_SEQUENCE (STORY, EARTH_SCIENCE) night-sky sequence | observatory | 23 | `NORTH_POLE_OBS_SEQUENCE_DONE` | none |
| 25 | `np-obs-fragments` | ORDER_SEQUENCE (CRYSTALS, LOGIC) set the 7 fragments in journey order; `itemEntities` sockets | observatory | 24 + all 7 fragment keys | `NORTH_POLE_FRAGMENTS_PLACED` | none |
| 26 | `np-obs-final` | CHOOSE_ANSWER (CARDS, MATHEMATICS) age-adjusted final challenge | observatory | 25 | `NORTH_POLE_STAR_RESTORED` | `np-rule-star` |
| 27 | `np-eve-sleigh-bell` | COLLECT_OBJECT (ring Santa's sleigh bell) | landing | 26 | `NORTH_POLE_CHRISTMAS_EVE` | `np-rule-christmas-eve` |
| R1 | `np-replay-workshop-sums` | chest REPLAY (math practice) | workshop | `NORTH_POLE_CHRISTMAS_EVE` | `NORTH_POLE_REPLAY_WORKSHOP` | none |
| R2 | `np-replay-lake-count` | chest REPLAY (math practice) | lake | `NORTH_POLE_CHRISTMAS_EVE` | `NORTH_POLE_REPLAY_LAKE` | none |

NP-024 decisions: ORDER items are capped at 6, so `np-obs-fragments` orders the six fragments
after the village one (the village fragment is the centre piece Jingle sets first), sockets
`np-socket-<zone>`; Sprouts order the first three (band-specific `itemEntities`). `np-lake-order`
keys `a b c d` map to `np-lake-step-1..4`. Details in `NORTH_POLE_CURRICULUM.md`.

`LIFE_SCIENCE` is added to the shared CHOOSE_ANSWER/ORDER_SEQUENCE subject list (additive, one
line, its own commit).

Chest challenge specs (`ChallengeSpec` slugs `np-<chest>-<band>`): SPROUT `counting-sets` 1..5
CHOICE 3; PATHFINDER `addition-within-ten` 1..10 CHOICE 4; EXPLORER `subtraction-within-ten`
2..10 CHOICE 4 (the lever chests: EXPLORER `addition-within-ten`). Each math chest also gets a
disabled-by-default `QuestionPool` scoped to `region_id north-pole-village`, `entity_id <chest>`,
so a published Question Studio set wins when staff enable it (ADR-046); the spec is the fallback.

Platform signals: bridge platforms use `activation {"trigger": "SIGNAL", "source":
"world:<KEY>", "hiddenUntilActive": true}` for `NORTH_POLE_LAKE_BRIDGE`,
`NORTH_POLE_MOUNTAIN_BRIDGE_ONE`, `NORTH_POLE_MOUNTAIN_BRIDGE_TWO`; Santa's sleigh is a platform
(`np-sleigh`, `assetId north-pole-sleigh`) with `motion` mode ONCE up and away, activated by
`world:NORTH_POLE_CHRISTMAS_EVE` (the departure sequence).

### Pickups (COLLECTIBLE placements: `pickup_change_key` + one reward rule each)

| Group | Entity ids | Keys | Rule ids | Item ids |
|---|---|---|---|---|
| Star fragments (7, required for #25) | `np-fragment-village`, `-workshop`, `-forest`, `-lake`, `-stables`, `-gingerbread`, `-mountain` | `NORTH_POLE_FRAGMENT_<ZONE>` (VILLAGE, WORKSHOP, FOREST, LAKE, STABLES, GINGERBREAD, MOUNTAIN) | `np-rule-fragment-<zone>` | `np-star-fragment-<zone>` |
| Snowflakes (10, mostly on jump routes and the mountain) | `np-snowflake-01` .. `-10` | `NORTH_POLE_SNOWFLAKE_01` .. `_10` | `np-rule-snowflake-01` .. | `np-snowflake-01` .. |
| Candy canes (5, forest) | `np-candy-cane-1` .. `-5` | `NORTH_POLE_CANDY_CANE_1` .. | `np-rule-candy-cane-1` .. | `np-candy-cane-1` .. |
| Ornaments (5, hidden around the village and north road) | `np-ornament-1` .. `-5` | `NORTH_POLE_ORNAMENT_1` .. | `np-rule-ornament-1` .. | `np-ornament-1` .. |
| Gingerbread cookies (3) | `np-cookie-1` .. `-3` | `NORTH_POLE_COOKIE_1` .. | `np-rule-cookie-1` .. | `np-cookie-1` .. |
| Golden bells (3, post-story ice cave) | `np-golden-bell-1` .. `-3` | `NORTH_POLE_GOLDEN_BELL_1` .. | `np-rule-golden-bell-1` .. | `np-golden-bell-1` .. |
| Snowball's collar | `np-snowball-collar` | `NORTH_POLE_SNOWBALL_FOUND` | `np-rule-snowball-found` | `np-snowball-collar` |

Fragment placement: village fragment on the jump-tutorial steps (with a stair route), workshop on
the high shelf (conveyor and crate route, stairs too), forest at the end of the peppermint
stepping stones (path around), lake on the far island (reached over the ice bridge), stables in
Pine Hollow beside Snowball, gingerbread on a rooftop (cookie steps and a ramp), mountain at the
summit.

## 6. Quests, items, sets and reward rules (content export)

Module `react/src/features/content-export/northPoleContent.ts`, merged by `build.ts`.

- **Realm** `north-pole` (World; title "North Pole"; not home; all bands; no travel requirement).
- **Place** `north-pole-village` on `north-pole` (title "North Pole Village"; subjects
  MATHEMATICS, SCIENCE, LITERACY; winter theme).
- **Quests** (`giverNpcId`; prerequisites; one stage each with BUILD objectives on the keys of
  section 5, plus the zone's fragment key; completion records `NORTH_POLE_Q0n_COMPLETE`):

| Quest id | Title | Giver | Prerequisite (WORLD_CHANGE) |
|---|---|---|---|
| `np-q01-welcome` | Welcome to the North Pole | `jingle` | ALWAYS |
| `np-q02-toy-workshop` | Trouble in the Toy Workshop | `tinker` | `NORTH_POLE_WELCOME_LOOKED` |
| `np-q03-candy-cane-forest` | Candy Cane Forest | `peppermint` | `NORTH_POLE_WORKSHOP_RESTORED` |
| `np-q04-frozen-lake` | The Frozen Lake | `frosty` | `NORTH_POLE_FOREST_DONE` |
| `np-q05-missing-reindeer` | The Missing Reindeer | `noel` | `NORTH_POLE_LAKE_DONE` |
| `np-q06-gingerbread-mystery` | The Gingerbread Mystery | `ginger` | `NORTH_POLE_SNOWBALL_HOME` |
| `np-q07-snowflake-mountain` | Snowflake Mountain | `jingle` | `NORTH_POLE_GINGER_REPAIRED` |
| `np-q08-restore-the-star` | Restore the Christmas Star | `polaris` | `NORTH_POLE_MOUNTAIN_SUMMIT` |
| `np-q09-christmas-eve` | Christmas Eve Celebration | `santa-claus` | `NORTH_POLE_STAR_RESTORED` |

  `np-q09` completion also records `NORTH_POLE_ADVENTURE_COMPLETE` (UNLOCK).
- **Items**
  - Star fragments `np-star-fragment-<zone>` (QUEST_ITEM, set `np-set-star-fragments`).
  - Snowflakes, candy canes, ornaments, cookies, golden bells (COLLECTIBLE, sets
    `np-set-snowflakes`, `np-set-candy-canes`, `np-set-ornaments`, `np-set-cookies`,
    `np-set-golden-bells`), `np-snowball-collar` (QUEST_ITEM), `np-reindeer-token` (KEEPSAKE),
    `np-gift-wrapped-present` (COLLECTIBLE, workshop chest).
  - Achievements (KEEPSAKE): `np-badge-north-pole-explorer`, `np-badge-master-toymaker`,
    `np-badge-candy-cane-trailblazer`, `np-badge-ice-hopper`, `np-badge-reindeer-rescuer`,
    `np-badge-gingerbread-builder`, `np-badge-snowflake-mountain-champion`,
    `np-badge-santas-helper`; trophy `np-trophy-christmas-star` (KEEPSAKE, RARE).
  - Cosmetics (COSMETIC, owned; equipping is a later shared phase): `np-cosmetic-santa-hat`
    (HAT), `np-cosmetic-elf-backpack` (BACKPACK), `np-cosmetic-snowflake-scarf` (ACCESSORY,
    completion item of `np-set-snowflakes`).
  - Journal (items with `journal`): `np-journal-snow-and-ice` (EARTH_SCIENCE),
    `np-journal-water-states` (EARTH_SCIENCE), `np-journal-stars` (EARTH_SCIENCE),
    `np-journal-patterns` (MATHEMATICS).
- **Reward rules** (trigger WORLD_CHANGE on the key):
  `np-rule-welcome` (WELCOME_LOOKED: explorer badge), `np-rule-workshop-gifts` (GIFTS_CHECKED:
  wrapped present), `np-rule-workshop` (WORKSHOP_RESTORED: toymaker badge, patterns journal),
  `np-rule-forest` (FOREST_DONE: trailblazer badge), `np-rule-lake` (LAKE_DONE: ice hopper badge,
  snow-and-ice journal), `np-rule-reindeer` (SNOWBALL_HOME: rescuer badge, reindeer token),
  `np-rule-gingerbread` (GINGER_REPAIRED: builder badge), `np-rule-mountain` (MOUNTAIN_SUMMIT:
  champion badge, water-states journal), `np-rule-star` (STAR_RESTORED: Christmas Star trophy,
  stars journal), `np-rule-christmas-eve` (CHRISTMAS_EVE: Santa's Helper badge, Santa hat, elf
  backpack), one rule per pickup.
  The two lever chests have **no** reward rule (`TreasureChest.reward_rule` is optional; the
  bridge is the reward), so `np-rule-mountain-bridge-one/-two` in section 5 are not created.
  REPLAY chests never have one (`TreasureChest.clean()`).

Grants are idempotent (`GrantedRule`). Repeatable: REPLAY chests and practice of solved puzzles.

## 7. NPCs

| NPC id | Name | Role (NpcRole) | Placement entity ids | Zone | Voice (Polly) |
|---|---|---|---|---|---|
| `santa-claus` | Santa Claus | QUEST_GIVER | `np-santa` | landing | Matthew |
| `mrs-claus` | Mrs. Claus | TEACHER | `np-mrs-claus` | gingerbread | Joanna |
| `jingle` | Jingle | GUIDE | `np-jingle`, `np-jingle-mountain` | landing, mountain base | Ivy |
| `tinker` | Tinker | QUEST_GIVER | `np-tinker` | workshop | Justin |
| `peppermint` | Peppermint | GUIDE | `np-peppermint` | forest | Salli |
| `frosty` | Frosty (elf skater) | GUIDE | `np-frosty` | lake | Kevin |
| `noel` | Noel | QUEST_GIVER | `np-noel` | stables | Brian |
| `ginger` | Ginger | QUEST_GIVER | `np-ginger` | gingerbread | Emma |
| `polaris` | Polaris | TEACHER | `np-polaris` | observatory | Amy |
| `snowball` | Snowball (reindeer calf) | COMPANION | `np-snowball` (Pine Hollow) | stables | none (captions, sound cue) |

- Catalog dialogue (export) is the reliable baseline: per NPC an unconditioned opener per band,
  greeting, help, hint and thanks nodes (thanks conditioned on the zone's final key and listed
  first), and `puzzleLine` intro / completeMessage / scienceNote nodes for each puzzle the NPC
  hosts, per band.
- NPC Manager records come from `seed_npc_north_pole` (create-only, not published by default):
  character, persona (permitted topics, fallback lines), behaviour, model variant
  (`north-pole-<npc>` character assets), placements derived from the Area's NPC placements,
  OFFER_QUEST choices for each quest giver, voice profile ids equal to the npc id.
- **Snowball escort** (data only): three NPC Manager placements for `snowball`, with spawn
  conditions on world changes: lost in Pine Hollow (no `NORTH_POLE_SNOWBALL_FOUND`), following the
  child with `FOLLOW` (`stopDistance 2`, `speed 3`, `giveUpDistance 40`, bounds radius large
  enough for the trip) while FOUND and not `NORTH_POLE_SNOWBALL_HOME`, and resting in the stable
  after HOME. If following ever fails, nothing is blocked: RETURN_TO_NPC only needs the collar.

## 8. Sound

Cue ids (ADR-050 regex), file `lai/apps/audio/north_pole_cues.py`:
`music.north_pole.village`, `music.north_pole.forest`, `music.north_pole.celebration`,
`ambient.north_pole.landing`, `ambient.north_pole.workshop`, `ambient.north_pole.forest`,
`ambient.north_pole.lake`, `ambient.north_pole.stables`, `ambient.north_pole.gingerbread`,
`ambient.north_pole.mountain_wind`, `ambient.north_pole.observatory`, `ambient.north_pole.wind`,
`sfx.north_pole.snow_step`, `sfx.north_pole.ice_step`, `sfx.north_pole.collect`,
`sfx.north_pole.fragment`, `sfx.north_pole.answer_right`, `sfx.north_pole.answer_retry`,
`sfx.north_pole.quest_complete`, `sfx.north_pole.checkpoint`, `sfx.north_pole.respawn`,
`sfx.north_pole.reindeer`, `sfx.north_pole.sleigh_bells`, `sfx.north_pole.star_restored`,
`voice.north_pole.npc_greet`. Jump and landing reuse `sfx.player.jump` / `sfx.player.land`.
Region entry in `REGION_AUDIO` keyed `north-pole-village`; zone ambience keyed by the zone ids of
section 4. Missing audio is silent, never an error. All recordings must be original, public
domain or licensed (inventory in `docs/north-pole/NORTH_POLE_AUDIO_INVENTORY.md`).

## 9. Shared engine additions (generic, isolated commits)

Data-driven, no holiday names in engine code:

```json
"environment": {
  "backgroundColor": 1979224,
  "lighting": {"ambientColor": 13623551, "ambientIntensity": 0.9, "sunColor": 16773856, "sunIntensity": 0.9}
},
"atmosphere": {
  "fog": {"color": 14543093, "near": 40, "far": 170},
  "precipitation": {"kind": "SNOW", "density": 0.6},
  "skyRibbons": [{"id": "np-aurora-1", "colors": [6222512, 9075954], "x": 0, "y": 60, "z": -140, "width": 220, "height": 30}]
}
```

- `environment.lighting` passes through to the engine's existing manifest lighting (exact field
  mapping documented by the engine workstream); absent means today's lighting.
- `atmosphere.fog`: linear fog; absent means none.
- `atmosphere.precipitation`: falling particles; `kind` SNOW (others later); density 0..1 scaled by
  render tier (LOW: none); reduced motion: slower and sparser.
- `atmosphere.skyRibbons`: gently waving translucent bands (an aurora); static under reduced
  motion; skipped at LOW tier.
- Stand-in shapes added: `PINE`, `STAR`, `GIFT`, `SNOWMAN`, `CANE`, `LANTERN`, `HOUSE`, `DOME`,
  `SLEIGH`, `ANIMAL`, `SIGN`.
- `effects.standIns` and `effects.lights` accept optional `shownWhenChangeKey` /
  `hiddenWhenChangeKey` (as steam already does), so the restored Star and its light appear when
  `NORTH_POLE_STAR_RESTORED` exists.

Ground: `scene.layout.scenery` FLAT_PLANE in snow white (no new ground code); `groundAssetId`
`ground-tile-snow` once an administrator publishes one.

## 10. Seasonal architecture (NP-023, ADR-081)

New Django app `lai/apps/seasons` (own migrations, so no migration-number clash with other
branches):

- `SeasonalEvent`: `slug`, `title`, `theme` (CHRISTMAS, HANUKKAH, THANKSGIVING, HALLOWEEN, EASTER,
  LUNAR_NEW_YEAR, WINTER, OTHER), `description`, `availability` (YEAR_ROUND default, or
  WINDOW_ONLY), `window_start_month/day`, `window_end_month/day` (a window may cross the new year),
  `featured_in_window`, `active`, `realms` (M2M World), `places` (M2M Location), `reward_items`
  (M2M ItemDefinition: the seasonal rewards), `audio_cue_ids`, `decoration_theme`, timestamps.
- `SeasonalCompletion` (child-owned): `child`, `event`, `season_year`, `completed_at`; recorded by
  a `WorldChange` post-save receiver when the event's `completion_change_key` arrives (annual
  replay tracking; never removes anything).
- Pure service `seasons.availability`: `in_window(event, date)`, `is_visible(place, date)`
  (hidden only for an active WINDOW_ONLY event outside its window), `featured(place, date)`.
- Discovery: the served islands API hides a WINDOW_ONLY Place outside its window and adds
  `seasonal: {slug, theme, featured, inWindow}` to Realm and Place entries. Child progress is
  never deleted; an out-of-window Place keeps all saves.
- Admin: list, filter, activate/deactivate, year-round override.
- Seed: event `christmas` (YEAR_ROUND, window Dec 1 to Jan 6, featured in window), realm
  `north-pole`, completion key `NORTH_POLE_ADVENTURE_COMPLETE`.
- Realm Explorer: a "Seasonal" / "Featured" chip from `seasonal.featured`; the `north-pole` slug
  maps to a new `winter` scene in `realmThemes.ts`.

## 11. Assets

Flat ids prefixed `north-pole-` (`lai/apps/regions/north_pole_assets.py` is the single list; the
manifest `docs/north-pole/NORTH_POLE_ASSET_MANIFEST.md` documents use, format, dimensions,
collision, animations, materials, licence, upload steps and placeholder status). Declared as
`ContentAsset` rows (origin DJANGO, no version, tag `north-pole-village`); each entity has a
stand-in. Nothing binary is committed.

## 12. Question Studio and curriculum (NP-005, NP-024)

- Arithmetic gates are chests: authored `ChallengeSpec` per band + a Question Studio
  `QuestionPool` per chest (ADR-046 precedence). Live Bedrock is never needed.
- Choice and order puzzles are authored variants (4 to 6 per band where content allows), checked
  by the shared validators; the client picks a variant per session.
- A CHOOSE_ANSWER puzzle naming a Question Studio pool is a documented extension point (as in
  Firepeak section 11), not built here.
- Curriculum map: `docs/north-pole/NORTH_POLE_CURRICULUM.md` (skills per puzzle per band).

## 13. Workstream ownership (Wave 2)

| Workstream | Branch / worktree | Owns |
|---|---|---|
| NP-010..019 layout | `np/layout` | `lai/apps/regions/north_pole_layout.py`, `north_pole_scene.json`, `lai/apps/regions/tests/test_north_pole_layout.py` |
| NP-024 puzzles | `np/puzzles` | `lai/apps/regions/north_pole_puzzles.py`, its tests, `docs/north-pole/NORTH_POLE_CURRICULUM.md` |
| NP-009/020 content | `np/content` | `react/src/features/content-export/northPoleContent.ts` (+ test), `build.ts`, `integrity.ts`, `content/exported/` |
| NP-020/022 NPC + sound | `np/npc-audio` | `lai/apps/npcs/north_pole_content.py`, `seed_npc_north_pole`, `lai/apps/audio/north_pole_cues.py`, `seed_north_pole_sound`, `regionAudio.ts` entry, their tests, audio inventory doc |
| NP-045 engine | `np/engine` | atmosphere, lighting pass-through, stand-in shapes, conditional lights/stand-ins (`regionManifest.ts`, `regionPlayConfig.ts`, `areaStandIns.ts`, `areaEffectsScene.ts`, new `atmosphere*.ts`) |
| NP-023 seasons | `np/seasons` | `lai/apps/seasons/**`, `lai/config/settings/base.py` (INSTALLED_APPS line), `discovery.py` / `serializers.py` seasonal hook, `react/src/features/realms/**` |
| NP-021/050 assets | `np/assets` | `lai/apps/regions/north_pole_assets.py` (+ test), `docs/north-pole/NORTH_POLE_ASSET_MANIFEST.md` |

Wave 3 (coordinator, after merging Wave 2): `north_pole_seed.py` (assembly: Place lookup, region,
spawn, placements, chests, pools, puzzles, assets), `seed_north_pole` / `publish_north_pole`
commands, end-to-end Django walkthrough test, Realm Explorer check, docs. The coordinator owns
`docs/IMPLEMENTATION_STATUS.md`, `docs/DECISIONS.md`, this file, and all merges.
