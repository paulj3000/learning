# Challenge Standard

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-002, ADR-003, ADR-012, ADR-020, ADR-033, ADR-046, ADR-047

A Challenge is any activity whose result the server grades and records as learning evidence: a
graded adventure step, a Treasure Rush chest, a 3D Area puzzle, or a published Question Studio
question. Terminology: [realm-standard.md](realm-standard.md). Learning content rules:
[educational-content-standard.md](educational-content-standard.md).

## 1. Correctness is application code

- Gameplay correctness is evaluated by application code, never by a model. **Binding:**
  CLAUDE.md §7, ADR-002, ADR-003
- Grading runs on the server. The client and the Three.js engine render, report touches or
  answers, and show the result; they never grade, award progress or call AI. **Binding:**
  ADR-020, CLAUDE.md §19
- The expected answer never reaches the client: `public_challenge` is the only shape a client
  sees, `grade_answer` is the only place correctness is decided (`lai/apps/education/challenges.py`).
- A replayed or repeated answer never grants twice (`409 attempt_already_answered`, TR-D12).

## 2. Challenge kinds on `main`

| Kind | Model | Authoring | Graded by |
|---|---|---|---|
| Adventure step | `catalog.AdventureStep` (`step_type`: `CHOICE`, `NUMBER_INPUT`, `ORDERING`, `MATCHING`, `SHORT_RESPONSE`, `CREATIVE_CHOICE`, and non-graded `NARRATIVE`, `REFLECTION`, `WORLD_CHANGE`, `COMPLETE`) | Export, then Django revisions | The Python adventure engine (LAI-0601), golden-vector parity with TypeScript |
| Parameterised math challenge | `education.ChallengeSpec` (one row per slot and age band: `skill_id`, value range, `response_mode` `CHOICE` or `NUMBER_INPUT`, `choice_count`) | Seed, then Django revisions | `education.challenges.grade_answer` with a server-chosen seed |
| Treasure chest | `regions.TreasureChest` (`ChestPresentation`: `CHEST`, `HIDDEN`, `PUZZLE`, `REPLAY`) using a `ChallengeSpec` or a Question Studio pool | Seed | As above; `REPLAY` grants nothing permanent (TR-D29) |
| 3D Area puzzle | `regions.AreaPuzzle` (`PuzzleKind`: `OBSERVE_FEATURES`, `PLACE_PLATFORMS`, `VALVE_SEQUENCE`, `COLLECT_OBJECT`, `RETURN_TO_NPC`) | Seed for mechanic and placements; Django revisions for per-band parameters | `lai/apps/regions/puzzles.py`, against the session's pinned revision |
| Published question | `question_studio.QuestionRevision` (from a staff `Question`; `MULTIPLE_CHOICE`, `NUMERIC`, `SHORT_ANSWER`) | Question Studio draft, review, approve, publish | The existing challenge and grading path. **Binding:** ADR-046 |

At a chest, a published Question Studio question with a usable pool is chosen first; otherwise
the chest's `ChallengeSpec` is used. **Binding:** ADR-047 (relationship to ADR-046)

## 3. Adding a new kind

- A new puzzle kind is a code change: its parameter schema and grader in
  `lai/apps/regions/puzzles.py`, its scene in the client, and a `PuzzleKind` value. It is never an
  administrator-authored script. **Binding:** ADR-047 (decision F)
- Reuse an existing kind when the learning objective fits. A new kind needs an owner decision in
  the specification ([templates/challenge-specification.md](templates/challenge-specification.md)).
- Puzzle kinds that need a physics dependency the project has not approved (tilting, rolling,
  ropes) are out of scope.

## 4. Identity and naming

| Thing | Convention |
|---|---|
| `ChallengeSpec.slug` | kebab-case, unique, at most 80 characters |
| `AreaPuzzle.puzzle_id` | kebab-case, unique within its 3D Area |
| `AreaPuzzle.world_change_key` | UPPER_SNAKE_CASE, globally unique (database constraint), prefixed by the place |
| Step ids | unique within their Adventure |
| `ChallengeSpec.title` | Admin-only label, never shown to a child |

## 5. Learning objective and age bands

- Every graded Challenge names one learning objective code (`skill_id`, `objective_ids`,
  `skill_code`). Evidence is recorded against that code.
- Difficulty, reading volume, response mode and interaction length derive from the age band and
  demonstrated ability. **Binding:** CLAUDE.md §3
- `ChallengeSpec` rows are validated against the skill's age-band rules on every save
  (`validate_parameters`); a row can never hold parameters the generator would refuse.
- Band differences live in content parameters, never in engine branches (Firepeak FP-D2).
- A Challenge does not ask for arithmetic unrelated to the activity (Firepeak FP-D5, FP-D6).

## 6. Hints and fallback

- Use the five-rung hint ladder: encouragement, attention cue, strategy hint, partial scaffold,
  guided completion ([../ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md)). The server records the hint
  level it gave (`AdventureSession.hint_levels`, `ChallengeAttempt.hint_level`); the client never
  supplies it.
- Supported completion counts as participation, not independent mastery (`support_level > 0`).
- Every AI-varied hint or line has an authored fallback in code. **Binding:** CLAUDE.md §7
- At least one adaptive hint path per adventure. **Binding:** CLAUDE.md §11 (item 7)

## 7. Accessibility

- Every spatial Challenge has a non-spatial equivalent that grades the same way. Example on
  `main`: Firepeak's lava crossing (`PLACE_PLATFORMS`) can be solved by carrying stones in the
  scene or in a full panel alternative (FP-6).
- Answers are large buttons or touch targets, never drag-only or timing-only.
- No time limit on any answer. **Binding:** ADR-053
- Full rules: [accessibility-standard.md](accessibility-standard.md).

## 8. Jumping integration

A Challenge may use jumping (answer-by-jumping, stepping stones), but the adventure must offer a
non-jumping way to give the same answer. See [jumping-standard.md](jumping-standard.md).

## 9. Progress evidence

| Record | Written when |
|---|---|
| `game_sessions.AdventureAction` | Each graded step attempt, with hint level |
| `game_sessions.ChallengeAttempt` | Each chest attempt; immutable once answered |
| `game_sessions.PuzzleAttempt` | Each puzzle submission, with the pinned revision |
| `education.SkillEvidence` | One per graded result, from exactly one source (session, story progress or challenge attempt) |
| `education.SkillProgress` | Folded from evidence once per new evidence row (`education/mastery.py`) |
| `progression.WorldChange` | The Challenge's visible consequence, once per child and key |

Nothing a browser sends and nothing a model says reaches the mastery counters.

## 10. Content safety

Child-facing text in any Challenge passes the publish checks: length per age band, no em dashes,
plain text only, no markup or URLs. **Binding:** ADR-047 (decision D)

## 11. Acceptance criteria

- [ ] Specification from [templates/challenge-specification.md](templates/challenge-specification.md).
- [ ] Graded on the server; expected answer never in a client payload.
- [ ] Parameters validate for every supported age band.
- [ ] Hint ladder and authored fallback present.
- [ ] Accessible alternative grades identically; tested.
- [ ] Replay and concurrency tests: no double grant.
- [ ] Evidence recorded with the right objective code and support level.
- [ ] Child-scoping test for every endpoint the Challenge uses.
