# Treasure Cove: Pirate's Leap (LAI-JMP-03)

Status: development complete on `feature/pirates-leap` (2026-11-14), unit- and engine-tested;
owner QA pending. Built on the shared platforms (`docs/PLATFORMING.md`, ADR-059), running and
sprinting (ADR-058), jumping (ADR-055) and the third-person camera (ADR-056), inside the existing
Treasure Cove Realm. No new Realm, no new engine, no purchased assets.

## Story

Pirate Pip hid a secret treasure beyond the old pirate training course. The child learns to jump,
crosses barrels and logs, rides a moving dock and a pirate lift, and finds the treasure in the
crow's nest. Pip offers the quest ("Pirate's Leap") beside his treasure quest, and narrates each
section as the child arrives (zone messages, authored text; no AI needed).

## Where

The cove's empty south-west, x -15 to -35, z -17 to -36, between Palm Tree Grove and the ruins.
Walk from Pirate Landing south-west past the grove; the "Pirate's Leap: training course" signpost
stands at the entrance (-14.8, -16.8).

## Sections

| # | Section | What the child does | Safety |
|---|---|---|---|
| 1 | Learn to Leap | Walk onto a 0.25 m step, hop up 0.5 m and 0.8 m steps | No water; checkpoint "the training yard" |
| 2 | Barrel Crossing | Jump barrel to barrel (0.6 m gaps) over a small pool; a Sparkly Shell on the middle barrel | Water sends them back to the latest checkpoint; walk round the pool instead |
| 3 | Fallen Log Trail | Logs with 1.0 and 1.2 m gaps (a walking jump clears 2.5 m; a running jump more); a Parrot Feather on the last log; an optional sinking barrel | Walk round the pool; checkpoint "the barrel bank" before, "the log landing" after |
| 4 | The Moving Dock | Wait for the ferry (it waits 3 s at each bank), step on (0.2 m), ride across | Checkpoints before and after ("the log landing", "the far dock"); a walking strip beside the pool |
| 5 | The Pirate Lift | Step on the gold plate to wake the lift; it waits 3 s, then rides 3 m up to the ledge | Step on, no jump; it never comes down onto a child |
| 6 | The Secret Treasure | One small step up into the crow's nest; open Pip's secret treasure | An optional bounce drum beside the ledge is a shortcut up |

Interactive mechanisms: the pressure-plate lift, the moving dock, the sinking barrel (vanishes a
while after you stand on it), the bounce drum, and the secret plank bridge raised by solving Pip's
riddle.

## Educational integration (optional, never a gate)

- **Pip's riddle drum** (training yard): an age-banded counting challenge (Sprout counting 1 to 4,
  Pathfinder counting 2 to 8, Explorer addition within 6), served by Django's challenge pipeline
  like every cove chest. Solving it records `PIRATES_LEAP_RIDDLE_SOLVED`, grants a Sea Star, and
  raises the secret plank bridge over the barrel pool at once (platform signal `world:<key>`).
  The adventure never needs it.
- **The secret treasure** opens with a gentle counting challenge (Sprout 1 to 5, Pathfinder 3 to
  10, Explorer addition within 10), with retries, hints and no penalty, like the cove's chests.
- No arithmetic is ever needed to leave the Realm. Questions come from `ChallengeSpec` rows
  (Django-authored), not from the Three.js engine.

## Accessibility

- Every section has a walking alternative: the pools are small and can be walked round; the ferry,
  lift and bridge are stepped onto (tops at most 0.25 m); the nest is one step up. A child who
  cannot jump can finish the adventure.
- Wide tops (at least 0.8 m), short gaps, platforms that wait, destination rings, checkpoint flags,
  blink-before-vanish (dim under reduced motion), reduced-motion slow-down, no timers, no lives.
- Staff can slow or switch off any platform without code (below).

## Difficulty

Beginner route as shipped. Intermediate and advanced variants are future content: longer gaps,
faster ferries or extra moving platforms as additional platforms (or staff tuning), never required
for the core adventure. No scoring expansion.

## Rewards and replay

| Reward | Trigger | Item |
|---|---|---|
| `reward-pirates-leap-chest` | Open the secret treasure (`PIRATES_LEAP_CHEST_OPENED`) | Pirate's Leap Medal |
| `reward-pirates-leap-riddle` | Solve Pip's riddle (`PIRATES_LEAP_RIDDLE_SOLVED`) | Sea Star |
| `reward-pirates-leap-shell` | Pick up the shell (`PIRATES_LEAP_SHELL_FOUND`) | Sparkly Shell |
| `reward-pirates-leap-feather` | Pick up the feather (`PIRATES_LEAP_FEATHER_FOUND`) | Parrot Feather |

The quest `pirates-leap` completes when the treasure opens. Every reward is one-time per child
(the server's existing chest, pickup and reward-rule idempotency). Replay: the course stays
playable; an opened chest stays open and grants nothing more. Items land in the existing backpack.

## Content and authoring

- Non-spatial content (quest, items, reward rules): `react/src/features/content-export/treasureRushContent.ts`,
  exported to `content/` and imported with `manage.py load_content`.
- Layout (platforms, plates, checkpoints, pools, goal, section zones): `lai/apps/regions/pirates_leap_seed.py`,
  written to `WorldRegion.scene["platforming"]` with its own version (`piratesLeapVersion`), so it
  never touches the cove's scenery layout (palm trees, barrels and logs are another workstream).
  Snapshot for frontend tests: `pirates_leap_course.json` (`python -m apps.regions.pirates_leap_seed`).
- Rows (chests, collectibles, signpost, the quest offer): the same seed, run by `seed_treasure_rush`.
- Staff tuning in Django Admin: Regions > 3D Areas > Treasure Cove > Edit content > `platformTuning`,
  e.g. `{"leap-moving-dock": {"speed": 0.8, "pauseSeconds": 4}, "leap-sinking-barrel": {"enabled": false}}`.
  Challenge specs (`pirates-leap-*`) and the chests' clues are edited like every cove chest.

## Sound

Optional platform cues (`sfx.platform.*`, `sfx.player.recover`) through the Sound Manager, plus the
cove's existing chest, reward and quest cues. Missing audio is silent.

## Recommended future assets (not required)

A rope-and-plank ferry model, a pirate lift (crate on ropes), a crow's nest, a drum bounce pad, a
gold pressure plate and a training-course arch. The course uses procedural blocks and the bundled
`barrel` and `signpost` until staff publish models (Asset Manager; collision profiles apply).

## Tests

- React: `src/features/island-map/three/extensions/regionPlay/piratesLeap.engine.test.ts` (valid
  manifest with the course and zones; narration; plate, lift, ledge, nest and goal; the ferry
  crossing; a missed jump back to the checkpoint; a running jump between barrels; the riddle
  bridge appearing and being walkable; staff tuning; third-person; the cove's own route intact).
- Django: `lai/apps/game_sessions/tests/test_pirates_leap.py` (seed and versioning, snapshot, no
  jump needed, quest offered, treasure completes the quest and rewards once, replay grants nothing,
  the riddle is optional, collectibles once, child ownership, wrong answers open nothing).
