# Interactive learning: scoring, evidence and compatibility (issue #102)

- **Status:** Development Complete on `feature/interactive-learning-scoring`; not integrated, not
  owner-accepted.
- **Tickets:** GitHub [#102](https://github.com/paulj3000/learning/issues/102), Trello #258.
- **Owners:** LAI 06 (scoring and progression) for this document and the server contracts. LAI 01
  (Treasure Rush) owns the story, content, seed and scenes. LAI 04 (Game Engine) owns the
  gameplay event contract and the shared HUD.

Treasure Rush is moving from repeated coin-count chest questions to story-led puzzles. This
document says how those puzzles earn rewards and record learning, and what stays compatible.

## 1. What already existed, reused

| Need | Existing system, reused unchanged |
|---|---|
| Gameplay events | `lai.gameplay-event` v1 (`game/src/contracts/gameplayEvents.ts`, mirrored by `apps/scoring/engine_events.py`). Every claim is SERVER_RECORD, DEFERRED or INFORMATIONAL; scoring derives from server records, never from claims |
| Puzzles | `regions.AreaPuzzle` (versioned admin content, age-band parameters, hints, variants) graded by `apps/regions/puzzles.py` in `game_sessions.play.solve_puzzle` |
| Skill evidence | `education.SkillEvidence` from each graded attempt, right or wrong (FPV-D10), folded into `SkillProgress` by `education.mastery.apply_evidence` |
| Mastery | `education.mastery`: INTRODUCED, DEVELOPING, PROFICIENT, MASTERED from independent successes; error patterns STALLED and NEEDS_SUPPORT |
| Adventure progress, checkpoints, save and resume | `AdventureSession` (one open REGION session per child and region; content pinned per visit, LAI-0813) and `WorldChange` stage keys (`requiresChangeKeys`) |
| Quests | `quests.refresh_active_quests` after every solve |
| Rewards and achievements | `catalog.RewardRule` through `inventory.grant_reward_rule` (one `GrantedRule` per child and rule) |
| Scoring | `apps.scoring` collectors and the append-only ledger, idempotent per `(source kind, ref, currency, group)`. Off by default (`LAI_SCORING_ENABLED`) until the owner accepts the economy |
| Replay | FPV-D6 practice replay: a solved quiz puzzle is graded for feedback and records nothing |
| Parent dashboard | `GET children/{id}/skill-progress/`, `progress.practice`, the dashboard's "Recent adventures", "Skills practised", "Mastery by area" and "Focus areas to consider" |

## 2. Educational event contracts

### 2.1 Mechanics and puzzle kinds

Each mechanic is a puzzle kind with a server grader. The child's action *is* the answer, so a
puzzle is never a quiz gate in front of the fun.

| Mechanic | Kind | Submission | The grader checks |
|---|---|---|---|
| Map assembly | `ORDER_SEQUENCE` (presentation `MAP_PIECES`), or `COLLECT_OBJECT` pieces then a skill puzzle | `{variantId, order}` | the pieces in the authored order |
| Navigation puzzles | `NAVIGATE_ROUTE` (new) or `CHOOSE_ANSWER` `PATHS` | `{variantId, moves: [N/E/S/W]}` | the route reaches the goal, never leaves the map or enters a blocked cell, within `maxMoves` |
| Number sequences | `ORDER_SEQUENCE` `PATH` | `{variantId, order}` | the stepping stones in number order |
| Pattern recognition | `CHOOSE_ANSWER` or `ORDER_SEQUENCE` | as the kind | what comes next, or the pattern's order |
| Sorting and classification | `SORT_ITEMS` (new) | `{variantId, placements: {item: bin}}` | every item in its bin |
| Arithmetic | `CHOOSE_ANSWER` (`CARDS`, `PLATFORMS`) | `{variantId, choice}` | the right total |
| Distribution and measurement | `SHARE_ITEMS` (new), or `PLACE_PLATFORMS` with a `skill` | `{variantId, counts: {container: n}}` | each container holds its target (equal shares, or a measured amount) |
| Reading comprehension | `CHOOSE_ANSWER` or `ORDER_SEQUENCE` `STORY` | as the kind | the answer the text supports |
| Environmental problem solving | `VALVE_SEQUENCE` with a `skill` | `{sequence}` | where the steam (or water) ends |

The three new kinds are quiz kinds like `CHOOSE_ANSWER`: a required band `skill`, up to eight
`variants` (replay variation), an optional per-variant `skill`, `hints` and `hintAfterAttempts`.
Admin publishing refuses an unsolvable route, a bin with no item, or shares that do not add up.
No scene renders them yet: the client's bootstrap accepts them and `parsePuzzleParams` returns
null, so an Area can be published before LAI 01 and LAI 04 build the scenes.

### 2.2 Accomplishments versus demonstrated skills

| Kind of thing | Earns | Skill evidence |
|---|---|---|
| Coins and other pickups | `PICKUP_COLLECTED` coins | Never |
| Jumping, platform courses (`jump.*`, `course.*`) | Nothing authoritative (DEFERRED) | Never |
| `COLLECT_OBJECT`, `RETURN_TO_NPC`, `OBSERVE_FEATURES` | `PUZZLE_SOLVED` | Never |
| `PLACE_PLATFORMS`, `VALVE_SEQUENCE` without `skill` | `PUZZLE_SOLVED` | None (an accomplishment) |
| `PLACE_PLATFORMS`, `VALVE_SEQUENCE` with `skill` | `PUZZLE_SOLVED` | The named skill: the grader checks the concept (a stone matching its gap is comparing lengths) |
| Quiz kinds | `PUZZLE_SOLVED` | The answered variant's skill, else the band's |
| A movement that *is* the answer ("jump onto the stone showing 7") | as `CHOOSE_ANSWER` `PLATFORMS` | From the graded choice, never from the jump |

`apps/regions/puzzles.py`: `SKILL_KINDS` (quiz kinds, always a skill), `OPTIONAL_SKILL_KINDS`
(movement kinds that may name one), `EVIDENCE_KINDS` (their union). Jumping alone never counts as
mathematics mastery.

### 2.3 Hints

- `POST .../solve/` takes an optional `hintsUsed`, stored on `PuzzleAttempt.hints_used`. It is
  capped at the band's hint count, and null means not counted.
- LAI 04 agreed an additive optional v1 event field,
  `learning.answer.submitted.hintsUsed?: number`, where absent means unknown. Golden vectors:
  valid with 0, with 2 and with the field absent; invalid with -1, 1.5, "2" and null. The owner
  approved it on 2026-11-27. It is LAI 04's PR #114, which carries the engine type, the golden
  file and Django's `engine_events.py` validator together, because the parity test needs all
  three. **Not on this branch**: the solve route field does not depend on it. Connecting the host's
  hint count to the solve request is LAI 06's follow-up PR, after this one.
- The value is reported by the client, like the chest's `hintLevel`. It can only mark evidence as
  supported, so a client that under-reports gains independent credit and nothing else: no reward,
  XP or world change depends on it.

## 3. Progression rules

| Situation | What happens |
|---|---|
| Successful first try, no hints | Evidence CORRECT, support 0 (independent); world change; reward rule once; `PUZZLE_SOLVED` once |
| Incorrect attempt | Evidence INCORRECT (exposure only, never a penalty); `TRY_AGAIN`; nothing debited; hints offered after `hintAfterAttempts` |
| Hint-assisted completion | Evidence CORRECT with support = hints opened (at least 1 after an earlier wrong answer this visit); same world change, reward and XP as a first try |
| Retries | Each attempt is evidence; the reward and `PUZZLE_SOLVED` key exist once |
| Age-band difficulty | Parameters per band (Sprouts picture and symbol based); the session pins the version |
| Skill mastery | Independent successes only (3 for PROFICIENT, 5 with a streak of 3 for MASTERED); `MASTERY_MILESTONE` pays once per level |
| Adventure completion | Quest and realm collectors, proven keys only (`realms.proven_change_keys`) |
| Checkpoints | `requiresChangeKeys` stage order and the resumed REGION session; `course.checkpoint.reached` stays informational |
| Replay | Practice: graded feedback, nothing recorded (`practice: true`, `skillPracticed: null`) |
| Duplicate rewards | Ledger idempotency keys, one `GrantedRule` per rule, `already_solved` |

Nothing punishes a mistake. Stars measure goals done, never speed, hints, attempts or falls
(`rules.stars_for`).

## 4. Compatibility with existing players

- **Puzzles that open chests.** LAI 01's seed lets a puzzle record a chest's existing
  `world_change_key`.
  - A child who opened the chest before keeps the chest, its `LEARNING_CHALLENGE` award and the
    reward-rule grant. The puzzle reads as solved (its key exists) and records nothing new.
  - A new child earns `PUZZLE_SOLVED` and the same reward rule instead.
  - Neither child is paid twice: the keys differ by source, and `GrantedRule` is unique per child
    and rule.
- **Stars.** A chest covered by a puzzle and that puzzle are **one** star goal, met either way.
  - Before this change the two counted separately, so nobody could reach full stars.
  - Stars already in the ledger are never removed. Recounting can only add stars.
- **Trust.** `PUZZLE_SOLVED` for `CHOOSE_ANSWER` and `ORDER_SEQUENCE` now reads as GRADED
  (they always were server-graded).
  - Trust is not part of an idempotency key, and no shipped rule requires GRADED, so no award
    changes.
- **Existing rows.**
  - `PuzzleAttempt.hints_used` is null for every row before #102, read as no hints: the same
    support level as before.
  - Chest `ChallengeAttempt`s, pickups, quests, world changes and ledger keys are untouched.
- **Migrations.**
  - `game_sessions/0008_puzzle_attempt_hints_used` adds a nullable column.
  - `regions/0010_interactive_learning_kinds` widens the `AreaPuzzle.kind` choices and check
    constraint.
  - No data migration and no backfill.
- **Client compatibility.**
  - `hintsUsed` is optional both ways.
  - `skillPracticed` is absent from older servers and reads as null.
  - A new kind loads but does not render until its scene exists.

## 5. Shared HUD (LAI 04, GE-101)

- The child sees compact, transient feedback: a one-line toast (`showToast`) and the puzzle
  panel's own result step.
- The solve response carries `skillPracticed` for that step.
- Stars per area come from `GET children/{id}/scoring/` (`adventures[].stars`, `maxStars`) and
  new stars from `.../scoring/awards/`. Both are economy-gated (`enabled: false` until the owner
  approves the economy).
- The HUD fetches stars after the solve completes. When the summary says `enabled: false`
  there is no star UI at all, never "0 stars". This is LAI 04's GE-101 contract,
  `docs/engineering/game-engine/gameplay-ui-contract.md` section 4.
- XP and support level are not shown to the child. Support level is a parent view.

## 6. Parent reporting

| A parent sees | Source | Never includes |
|---|---|---|
| Adventures completed | sessions, quests, the dashboard's "Recent adventures" | coins |
| Skills practised | `SkillProgress.exposure_count`, `progress.practice` | coins, jumps, pickups, movement without a named concept |
| Demonstrated mastery | `recentLevel` PROFICIENT or MASTERED (independent successes) | supported successes alone, coins |
| Needs more practice | `errorPattern` NEEDS_SUPPORT or STALLED ("Focus areas to consider") | a single mistake |

Coins are a reward currency in the scoring summary only. They never create evidence and never
appear as mastery.
`apps/scoring/tests/test_interactive_learning.py::test_a_parent_can_tell_adventures_practice_mastery_and_needs_practice_apart`
pins this.

## 7. Skill mapping for Treasure Rush

These are LAI 01's chosen objectives. All are catalog codes, so `puzzle_skill_report --strict` is
clean for them:

| Stage | Mechanic | Objectives |
|---|---|---|
| Pirate Landing | waymarker route (`CHOOSE_ANSWER` `PATHS`, later `NAVIGATE_ROUTE`) | `observation`, `position-and-direction` (compass clues), `following-instructions` (elimination), `reading-comprehension` |
| Crocodile Creek | stepping stones in number or pattern order | `counting-sets`, `comparing-and-ordering-numbers`, `patterns` |
| Supply Dock | cargo crates (later `SORT_ITEMS`, `SHARE_ITEMS`) | `counting-sets`, `equal-sharing`, `addition-within-ten`, later `classification` |
| Forgotten Cave | rune order from symbols or a riddle | `observation`, `reading-comprehension`, `patterns` |
| Finale | torches in journey order | `sequencing` |

**Position and direction (owner-approved 2026-11-27).** `position-and-direction`, "Using
directions and positions on a map", is in the catalog (numeracy, next to `shapes-and-geometry`).
A grid route of N, E, S and W moves around obstacles is spatial reasoning, so `NAVIGATE_ROUTE`
names it. The cove map's compass variants name it too (Pathfinder p2; Explorer e1, e2 and e4).
Landmark matching stays `observation`, and "not by the sand, not by the stones" (p3) stays
`following-instructions`. The objective reaches Django through the content export and
`manage.py load_content`, like every catalog objective, so an environment that has not loaded
the new export logs a solve under it as an unmapped code rather than recording evidence.
