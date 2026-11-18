# Challenge Standard

- **Status:** Mandatory policy (ADR-072, accepted by the owner 2026-11-18). These standards are the final authority after the owner.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-002, ADR-003, ADR-012, ADR-016, ADR-020, ADR-033, ADR-046, ADR-047, ADR-053; pending merge: ADR-059, ADR-063
- **Canonical sources:** [docs/ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md) (step types, hint ladder), [lai/apps/education/challenges.py](../../lai/apps/education/challenges.py) (chest challenges), [lai/apps/regions/models.py](../../lai/apps/regions/models.py) (`TreasureChest`, `AreaPuzzle`, `PuzzleKind`), [lai/apps/game_sessions/models.py](../../lai/apps/game_sessions/models.py) (`ChallengeAttempt`, `PuzzleAttempt`), [docs/PLAY_API.md](../PLAY_API.md)

A challenge is one learning, exploration, movement or puzzle activity. It is the smallest unit a
child completes and the place where learning evidence is recorded.

## Challenge forms in the code

There is no single challenge model. Pick the existing form that fits; do not add a new one for
one adventure.

| Category | Form | Where | Graded by |
|---|---|---|---|
| Learning (step) | Answerable `AdventureStep` (`CHOICE`, `NUMBER_INPUT`, `ORDERING`, `MATCHING`, `SHORT_RESPONSE`, `CREATIVE_CHOICE`, `REFLECTION`) | `catalog.AdventureStep`, `AdventureSession`, `AdventureAction` | Deterministic engine on the server (ADR-012, LAI-0601) |
| Learning (in the world) | Chest challenge: `TreasureChest` with a `ChallengeSpec` per age band, or a published Question Studio pool | `regions`, `education`, `ChallengeAttempt` | Django (`challenges.py`; ADR-046 for Question Studio) |
| Puzzle | `AreaPuzzle` of a closed `PuzzleKind`: `OBSERVE_FEATURES`, `PLACE_PLATFORMS`, `VALVE_SEQUENCE`, `COLLECT_OBJECT`, `RETURN_TO_NPC` | `regions.AreaPuzzle`, `PuzzleAttempt` | Django against the session's pinned revision |
| Puzzle (touch the answer) | `TreasureChest` with `PUZZLE` presentation and answer objects | `regions` | Django (TR-D23) |
| Exploration | Discovery, room discovery, `EXPLORE` objective, observe-features puzzle | `WorldState.discovered_objects`, `WorldChange` (ADR-051) | Server records; no correctness |
| Collectible | Pickup on a `COLLECTIBLE` placement (`pickup_change_key`, `pickup_reward_rule`) | `regions.WorldObjectPlacement` | Server records once |
| Movement | Platforming course: platforms, checkpoints, hazards, goals | `scene.platforming` | Pending merge (`feature/interactive-platforms`); the engine reports a goal, it never awards progress |

Further puzzle kinds (`CHOOSE_ANSWER`, `ORDER_SEQUENCE`) exist on the Firepeak and North Pole
branches: pending merge, not available on `main`.

## Identifiers

- Within a 3D Area: `entity_id`, `puzzle_id` and chest ids are kebab-case slugs, unique in the
  Area, prefixed with the adventure (`firepeak-steam`, `cove-chest`).
- `ChallengeSpec.slug`: kebab-case, unique.
- Step ids: unique within their step adventure.
- The world change key a challenge records: UPPER_SNAKE_CASE with an adventure prefix.
- Full rules: [realm standard, Identifiers](realm-standard.md#identifiers).

## Required fields (specification)

Use the [challenge specification template](templates/challenge-specification.md). Every
challenge states:

| Field | Rule |
|---|---|
| Form and kind | One row of the table above |
| Learning objective codes | Existing `LearningObjective.code` values; none for pure movement or exploration, stated as such |
| Age-band parameters | One set per supported band (for example `ChallengeSpec` per band, or the puzzle's per-band `parameters`). Band differences live in content, never in engine branches |
| Required or optional | Required challenges gate progress; optional ones never do |
| Prerequisites | World change keys that must exist first (`requires`, `required_world_change_key`) |
| Consequence | The world change key recorded and the reward rule, if any |
| Hint path | At least one adaptive hint path (CLAUDE.md section 11 item 7), following the hint ladder |
| Accessible alternative | How the challenge is completed without precise pointing, without jumping, and with audio off |
| Fallback | Authored copy used when AI or audio is unavailable |

## Rules

1. **The server decides correctness.** The 3D engine shows numbers and reports touches; it never
   validates answers, awards progress or calls AI (ADR-020). AI never decides correctness
   (ADR-002, ADR-003).
2. **The client never sees the answer** before it is graded (`public_challenge`).
3. **Supportive retries.** A wrong answer keeps the child in the activity with encouraging
   feedback; hints step up after attempts. No lives, no penalty, no lost items or progress, no
   "game over".
4. **No time limits.** No countdown, timer or time-scored challenge (ADR-053). A moving or
   vanishing platform is a movement mechanic, not a timer, and may only sit on an optional route
   (see the [jumping standard](jumping-standard.md)).
5. **Evidence is honest.** Independent success and supported success are recorded separately;
   guided completion counts as participation, not mastery ([ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md),
   "Hint ladder").
6. **Closed registries.** A new step type or puzzle kind is a code change with its schema,
   grader, tests and golden vectors, approved through a spec; never content-defined logic
   (ADR-047 F).
7. **Learning is meaningful.** An arithmetic gate must fit the story. Arithmetic is never
   required to leave a Realm, an adventure or the game (see the
   [accessibility standard](accessibility-standard.md#clear-exit)).
8. **One-time consequences.** Recording a world change or granting a reward is idempotent.
   Repeat play uses replay activities (`REPLAY` chests, practice replays), which grant nothing
   permanent.

## Relationships

- A challenge usually satisfies a quest objective (`SOLVE`, `BUILD`, `COLLECT`, `DISCOVER`), or is
  a step in a step adventure. An optional challenge may stand alone.
- Challenges in one 3D Area are ordered by world change prerequisites, not by client code.

## Ownership and publication

- Placement and the mechanic are seed or manifest authored (LAI-0805). Parameters, copy, hints,
  reward rules and required keys are Django-authored revisions (ADR-047). Challenge specs and
  puzzles have DRAFT, PUBLISHED and RETIRED status; only published content is served.
- Question Studio questions keep their own review and publication lifecycle (ADR-046).

## Progress tracking

- `ChallengeAttempt`, `PuzzleAttempt` and `AdventureAction` are typed, child-scoped events
  (ADR-016). They feed `SkillEvidence` and `SkillProgress`.
- Logs never contain child free text, answers tied to names, or identifiers beyond what is
  documented (CLAUDE.md section 13).

## Naming

Child-facing prompts are short, concrete and readable aloud. Admin titles (`ChallengeSpec.title`)
are never shown to a child.

## Acceptance checklist

- [ ] Uses an existing challenge form; any new kind has an approved spec and tests.
- [ ] Graded on the server; the client never holds the answer.
- [ ] Parameters authored for every supported age band.
- [ ] At least one adaptive hint path; authored fallback copy.
- [ ] Accessible alternative: no precise aim, no jump and no audio required to complete it.
- [ ] No timer; retries are supportive; nothing is lost on a wrong answer or a fall.
- [ ] World change and reward recorded once only; replay grants nothing permanent.
- [ ] Unit tests: grading, per-band parameters, prerequisites, idempotency; golden vectors where the kind has them.
- [ ] Owner QA per age band after unit tests.
