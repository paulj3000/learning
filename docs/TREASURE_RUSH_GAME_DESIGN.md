# Treasure Rush: game design (the 2026-11-26 redesign)

GitHub issue #102, Trello card #258. LAI 01, branch `feature/treasure-rush-gameplay-redesign`.

**Status:** Development Complete when its PR's checks pass. **Not owner-accepted:** the owner plays
the redesigned adventure before it is accepted.

## Why

The owner's playtest on 2026-11-26 found the cove boring: every chest stopped play with a counting
question ("how many coins does this chest need?"), five times over. This redesign makes **learning
happen through play**. The child explores, walks to things, crosses a creek on stepping stones,
loads cargo and lights torches. The chests stay, but now they are the **reward** at the end of each
stage, and they open by themselves.

## The adventure: Pip's Missing Treasure, in five stages

The island keeps its four zones (TR-13): Pirate Landing in the centre, Palm Tree Grove to the west,
Shipwreck Beach to the east and the Ancient Treasure Ruins to the south. The stages fit into them;
the only new scenery is the creek.

| # | Stage | Where | What the child does | Mechanic (3D Area puzzle kind) | Opens |
|---|---|---|---|---|---|
| 1 | **The missing map** | Pirate Landing | Find three torn pieces of Pip's map round the landing (by the tent, near the crates, on the way to the dock). Then walk to the waymarker sign the map points to. | 3 × `COLLECT_OBJECT`, then `CHOOSE_ANSWER` (`PATHS`): the three signs are the options | Pip's landing chest |
| 2 | **Crocodile Creek** | The grove path, west of the landing | Cross the creek on the stepping stones in the right order (count, order numbers, follow a pattern). Snappy the crocodile watches. | `ORDER_SEQUENCE` (`PATH`): the stones are the items | The hidden chest in the grove |
| 3 | **The supply dock** | Shipwreck Beach | Find the brass key on the X in the sand (the existing pickup). Then load Pip's boat by walking to the right cargo crate: share equally, add a load, find what is missing, sort food from tools. | `CHOOSE_ANSWER` (`CARDS`): the three crates are the options | The locked chest |
| 4 | **The forgotten cave** | The ruins | Find three carvings hidden in the ruins' corners (a star with 1 dot, a moon with 2, a triangle with 3) and remember them. Then press the rune stones in the order a riddle gives. | 3 × `COLLECT_OBJECT`, then `ORDER_SEQUENCE` (`SWITCHES`): the existing rune stones | The glowing pedestal |
| 5 | **Pip's lost treasure** | The dais behind the pedestal | Light the torches round the golden chest in the order of the adventure (forward, backward, or by a rule). | `ORDER_SEQUENCE` (`SWITCHES`): the torches | The golden chest |

Then the child walks back to Pip, which completes the quest and opens the bridge to Lookout Point
(TR-17), exactly as before.

There are four distinct interactive mechanics: **find and collect** by exploring, **walk to the
answer** (signs, crates), **step in sequence** across the creek, and **switch in order** (rune
stones, torches). Collecting a coin or answering a counting question is never the gate.

### What is code and what is content

- **Mechanics are shared code**: the 3D Area puzzle kinds (`lai/apps/regions/puzzles.py`, ADR-047
  F), graded on the server, drawn by the shared region-play puzzle layer. The redesign adds **no new
  kind and no new engine code**.
- **Parameters are authored content**: `lai/apps/regions/treasure_cove_stages.py` is the seed
  source. The seed records each stage as an `AreaPuzzle` whose first published revision is that
  content; staff then edit it in Django Admin (**Regions, 3D Area puzzles**) as versioned
  revisions, and a re-seed never overwrites their edits.
- **Placement is seed-owned layout**: the stage objects are `WorldObjectPlacement` rows at
  `treasure_cove_layout.STAGE_SPOTS`, and the creek is a water plane in the layout (version 10).

## Learning objectives mapped to gameplay

| Stage | Sprouts (3 to 4) | Pathfinders (5 to 6) | Explorers (7 to 8) | Skill evidence |
|---|---|---|---|---|
| 1 Map (sign) | Match the star on the map to the star on a sign; find the palm trees | Read a landmark clue; "the sun goes down in the west"; rule out places | Multi-part directions; compass (north-west); three-clue elimination | `observation`, `following-instructions`, `reading-comprehension` |
| 2 Creek | Count 1, 2, 3 dots; order by size (small, middle, big fish) | Order numbers; count by twos; count back | Add 3 each time; order two-digit numbers; count back by 5; doubling | `counting-sets`, `comparing-lengths`, `comparing-and-ordering-numbers`, `patterns` |
| 3 Dock | Find the crate with 3; the most fish; which has food | Share 6 equally between 2; 4 + 3; what is missing from 8; only fruit | Balance 9 against 5; share 12 among 3; 3 barrels of 4; tools, not food | `number-recognition`, `counting-sets`, `classification`, `equal-sharing`, `addition-within-ten`, `subtraction-within-ten`, `multiplication-facts` |
| 4 Cave | Press in order of dots; most to fewest | The same, plus "the moon goes first, then fewest to most" | Two-step riddles; "the star is last and the moon is not first" | `observation`, `reading-comprehension` |
| 5 Torches | Three places, forward and backward | Four places, forward, backward, cave first | Four places, plus "the places with water first" | `sequencing`, `reading-comprehension` |

- **Map pieces and carvings** teach exploring and noticing; they carry no skill (a find is not an
  answer), so they never add skill evidence.
- Evidence is recorded by the existing pipeline (`record_puzzle_evidence`) for every graded
  attempt, right or wrong. A right answer after a wrong one in the same visit counts as supported.
  Every skill code above is a catalog objective (`puzzle_skill_report --strict` reports 0
  unmapped).

### Age bands, without a different world

The world is the same for everyone; only the parameters change. Sprouts cross on **3** stones,
Pathfinders on **4**, Explorers on **5** (the band's unused stones are hidden). The finale has 3
torches for Sprouts and 4 for the others. Sprout prompts are one step and picture-led: symbols on
every option (star, moon, circle, square and so on), so nothing depends on reading or on colour.

### Hints, retries and feedback

- Every stage has authored hints for every band (shown when asked, offered after two wrong tries).
- A wrong try opens nothing and costs nothing; the child tries again, or asks for "a different
  one". There is no timer, no lives, no reset to the start, and nothing is taken away.
- Every variant has a kind explanation of why the answer is right, shown on success.
- Pip's clue for each chest (`TreasureChest.clue`) now points at its stage; a chest that a stage
  opens says "This chest opens by itself when you finish the challenge nearby", with the clue.

## Replayability

- Every learning stage has **2 to 4 variants per band**. A visit's first variant is chosen per
  visit, "Try a different one" moves to the next, and a solved stage can be **practised again**:
  graded for feedback only, with nothing granted twice (FPV-D6).
- The answer, and the crate or stone it is on, changes between variants (the creek's numbers are
  dealt onto different stones; the dock's right crate moves).
- The map stage always points to the grove, because the story goes there next; its variants change
  the kind of clue instead.
- The Lookout spyglass (TR-20) stays as optional, repeatable counting practice after the quest.
- **Coins stay** as rewards and collectibles (the Golden Doubloon and the other keepsakes); they are
  never the progression mechanism.

## Progress compatibility (existing children)

Each stage that ends at a chest records **that chest's existing world change key** and grants **its
existing reward rule**. So:

- Pip's quest objectives, the rewards, the TR-17 bridge and the Lookout unlock are unchanged.
- A child who opened chests the old way finds those stages already solved and can carry on. The
  map pieces and carvings they never needed stay to be found; they gate nothing that child has
  already done.
- No reward is granted twice: a reward rule is granted once per child (`GrantedRule`), and
  re-solving a solved stage is practice.
- History is never deleted or rewritten: chest attempts, scores, quest progress and skill evidence
  all remain.

### The one shared rule this needs (for review)

`lai/apps/regions/authoring_kinds.py`: a 3D Area puzzle may now record the world change key of a
**treasure chest in its own 3D Area**. Before, any chest with that key was refused. The sharing has
one defined meaning: the puzzle opens the chest. `game_sessions.play.chest_lock` then gives that
chest the lock reason `PUZZLE`, so it never issues its old question; the server refuses one if
asked. A chest in **another** 3D Area with the key, or another puzzle, is still refused
(`test_a_puzzle_may_record_the_key_of_a_chest_in_its_own_area_only`,
`test_two_puzzles_still_cannot_share_a_key`).

If a stage's puzzle is unpublished, its chest asks its old question again, so staff can roll a
stage back without touching anyone's progress.

## Content and asset requirements

**Nothing new is required to play.** Every stage object is drawn as a recognisable stand-in shape
(`scene.effects.standIns`) until a model is published, like Firepeak.

| Object | Entity ids | Now | Wanted later (nice to have) |
|---|---|---|---|
| Waymarker signs | `cove-way-grove`, `cove-way-beach`, `cove-way-ruins` | Bundled `signpost` model | (none) |
| Cargo crates | `cove-dock-crate-a` to `-c` | Bundled `crate` model | (none) |
| Map pieces | `cove-map-piece-1` to `-3` | MARKER stand-in | A torn parchment fragment |
| Stepping stones | `cove-creek-stone-a` to `-e` | STONE stand-in | A flat river stepping stone |
| Snappy the crocodile | `cove-creek-crocodile` (scenery only) | ANIMAL stand-in | A friendly crocodile |
| Carvings | `cove-cave-carving-1` to `-3` | MARKER stand-in | Carved stone tablets (star, moon, triangle) |
| Torches | `cove-finale-torch-1` to `-4` | LANTERN stand-in | A standing torch |
| Rune stones, chests | unchanged | unchanged | unchanged |

LAI 07's availability check (2026-11-26) confirmed `signpost` and `crate` are bundled and
deliverable, and that no stepping stone, torch or crocodile model exists yet. Pip has Idle, Talk
and Wave only (no Cheer or Point). Audio: the area puzzle layer plays the existing cues; the 16
required cove sounds are still missing and tracked separately
([audio inventory](audio/TREASURE_RUSH_AUDIO_INVENTORY.md)).

## Deferred, and why

| Element | Why not now | Next |
|---|---|---|
| Jumping onto the creek's stones, with a gentle water recovery | Standable stones need the shared engine's platforming bridge (LAI 04). Today the creek is shallow decoration: no hazard, and the child walks stone to stone. | A separate ticket for LAI 04 (owner go-ahead needed) |
| Assembling the map pieces by dragging | No "assemble" scene exists; LAI 06's proposed `MAP_PIECES` presentation needs a client scene | Follow-up after LAI 06's kinds and a scene |
| A route-drawing map, sorting into bins, sharing by counts | LAI 06's proposed `NAVIGATE_ROUTE`, `SORT_ITEMS` and `SHARE_ITEMS` kinds need client scenes (LAI 04 and LAI 01) | Swap the dock and map stages to them when they exist |
| Pip speaking each stage's intro | Puzzle lines are NPC dialogue (an NPC release); the puzzle title is the safe fallback intro | Add `puzzleLine` nodes to Pip's NPC release |
| A cave interior | No cave mesh in the ruins; the bundled `cave-mouth` could frame an entrance | Layout follow-up if the owner wants it |
| Narrated prompts | Polly is off locally; captions only | Unchanged (owner decision) |

## Testing

- `lai/apps/game_sessions/tests/test_treasure_cove_stages.py`: the whole adventure through the play
  API for each age band; story order; the dock needing the key; chests never asking their old
  question; wrong tries and supported evidence; save and resume; practice with no second reward;
  variants; existing children's progress; the seed, the version 2 upgrade, and the shared rule.
- `lai/apps/regions/tests/test_treasure_cove_stages_content.py`: every body passes the server's
  rules; symbols on every option; no em dashes; skills on every variant; spots clear of colliders;
  the frontend snapshot equals the seed.
- `react/src/features/region-play/treasureCoveStages.test.ts`: the client parses every stage for
  every band and agrees with every stored answer; band sizes; variants on replay; stand-in shapes.
- `AreaPuzzleLayer.test.tsx`: many objects to find in one Area; the pick-up button names the object.
- `RegionPlayCompanion.test.tsx`: a chest a stage opens says so and asks nothing.
- Owner playthrough: [the checklist](TREASURE_RUSH_PLAYTEST_CHECKLIST.md), section F.
