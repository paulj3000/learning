# Firepeak Volcano: The Volcano Awakens

Status: **in progress on `feature/adr-043-django-content-authoring`, 2026-11-01.** Owner-directed
(FP-D1). Built on ADR-043 (Django content authoring, Accepted 2026-11-01). Nothing is merged,
pushed or deployed. Implementation status and verification status are tracked separately in
section 5; a row is not "accepted" until its verification column says so.

## 1. Summary

A new Place, Firepeak Volcano, on the home Island, with one 3D Area and its first adventure,
"The Volcano Awakens": Professor Ember asks the child to investigate a waking volcano. The
child uses a telescope, repairs a lava crossing, redirects steam with valves, discovers the
first Heart Crystal fragment, and brings it back. Earth science first, with spatial reasoning and
cause and effect; no unrelated arithmetic.

It is built entirely on the canonical backbone (ADR-033) and ADR-043:

| Need | Reused | Added (platform-wide, not Firepeak-only) |
|---|---|---|
| Place, Island, NPC, quest, items, reward rules | Catalog rows from the export (`firepeakContent.ts`) | Optional item `journal` metadata (subject, quest, illustration) |
| 3D layout | `regions` seed rows (ADR-033 item 4, ADR-041 E) | `scene.colliders`, `scene.effects`, extra checkpoints (seed-authored) |
| Stages and puzzles | Quest engine (stage order), world changes, reward grants | `regions.AreaPuzzle` with kinds `OBSERVE_FEATURES`, `PLACE_PLATFORMS`, `VALVE_SEQUENCE`, `COLLECT_OBJECT`, `RETURN_TO_NPC` (LAI-0812) |
| Admin editing | Django Admin, Asset Manager | Content versions, publish, rollback (LAI-0810, LAI-0801 stage 1) |
| Session safety | Region sessions | Version pinning (LAI-0813) |
| Discovery Journal | Collectible set and items, inventory, progress API | Journal entries are items with `journal` metadata |
| Rendering | Three.js location engine, `region-play` | `area-puzzles` and `area-effects` extensions |

## 2. Decisions

- **FP-D1 (owner-directed, 2026-11-01).** Firepeak Volcano is a new Place on the home Island.
  This is a scope addition approved by the owner's request (CLAUDE.md section 5).
- **FP-D2 (owner-decided, 2026-11-01).** Age bands:
  - Pathfinders (5 to 6) and Explorers (7 to 8). Sprouts are excluded for now; the adventure
    is not shown to a Sprouts profile.
  - Band differences live in content (each puzzle's `ageBands` parameters), never in engine
    branches. Pathfinders get visual guidance (stone outlines, a visible steam path) and shorter
    text. Explorers reason from gap sizes and pipe labels.
  - Ages 9 to 12 are a future platform-wide age-band decision.
- **FP-D3 (constraint, ADR-029).** First-person camera: the engine's only controller.
- **FP-D4 (constraint, asset id rules).** Asset ids are flat slugs (`firepeak-volcano-main`).
- **FP-D5.** "Repair the bridge" is a spatial puzzle: each gap takes the stone whose size
  matches it. The server checks the arrangement; no arithmetic is asked.
- **FP-D6.** The steam puzzle is cause and effect. Each valve moves steam from one channel to
  another, and a valve whose channel is empty does nothing. The child follows the steam to the
  sky vent. The server simulates the same rule; there is no hidden order to guess.
- **FP-D7.** The adventure is a quest owned by the Island (ADR-041 D), offered by Professor Ember.
  Its five stages each complete on one puzzle's world change, so stage order and completion are
  the existing server-side quest engine's.
- **FP-D8.** "Secrets of the Crystal Caverns" does not exist. Completing the quest records the
  world change `FIREPEAK_VOLCANO_AWAKENED`, which a future quest can use as its prerequisite. No
  launch is shown for content that does not exist.
- **FP-D9.** Ember's general dialogue is NPC content. Stage-specific, age-specific lines are each
  puzzle's band parameters (`intro`, `completeMessage`, `scienceNote`), because the NPC dialogue
  schema has no age-band field.
- **FP-D10.** Falling into lava returns the child to the last safe checkpoint they reached, after
  a short fade. Nothing earned is lost.

## 3. Science notes (reviewed for accuracy; the Heart Crystal is fiction)

- **Crater:** the bowl-shaped opening at the top of a volcano, where gas and lava come out.
- **Lava:** melted rock that has come out of the ground. Underground it is called magma.
- **Steam vent (fumarole):** a crack that lets out steam and gases heated by magma below.
- **Volcanic minerals and crystals:** as hot, mineral-rich fluid or melted rock cools slowly,
  atoms line up in repeating patterns and form crystals. Slow cooling lets crystals grow bigger.
- The Heart Crystal is island magic, and the copy says so ("a crystal that glows with island
  magic").

## 4. Layout (seed-authored, `lai/apps/regions/firepeak_seed.py`)

One 3D Area, `firepeak-volcano`, laid out along the -z axis, with four sections:

| Section | z range | Contents |
|---|---|---|
| A. Base Camp | 26 to 12 | Spawn, Professor Ember, research tent, telescope, information sign, rocks |
| B. Lava River Crossing | 10 to 2 | Animated lava band, three slot markers, three stones on the near bank, safe banks |
| C. Steam Vent Passage | 0 to -14 | Three valves, pipes, gauges, steam plume, a sealed passage collider |
| D. Crystal Chamber | -16 to -30 | Pedestal, Heart Crystal fragment, crystal formations, glow |

The volcano is in the background (`firepeak-volcano-main`). Checkpoints are at each section's
entry and unlock as stages complete, so resuming returns the child to the furthest section they
reached.

## 5. Tasks

Ids follow the TR-n and SC-n precedent (`FP-n`). Where a task needs a platform task, it depends
on that task rather than copying it.

| Id | Task | Depends | Implementation | Verification |
|---|---|---|---|---|
| FP-1 | Architecture audit and specification (this document, ADR-043) | none | DONE | Owner accepted ADR-043, 2026-11-01 |
| FP-2 | Place and 3D Area configuration: export content, seed, dev publish command | LAI-0810, LAI-0812 | See IMPLEMENTATION_STATUS | pytest |
| FP-3 | Asset manifest and placeholder environment (`docs/regions/firepeak_assets.md`) | FP-2 | See IMPLEMENTATION_STATUS | Not browser-verified |
| FP-4 | Base Camp and Professor Ember | FP-2 | See IMPLEMENTATION_STATUS | Not browser-verified |
| FP-5 | Telescope activity (`OBSERVE_FEATURES`) | FP-4, LAI-0812 | See IMPLEMENTATION_STATUS | Not browser-verified |
| FP-6 | Lava crossing puzzle (`PLACE_PLATFORMS`), lava hazard and respawn | FP-5 | See IMPLEMENTATION_STATUS | Not browser-verified |
| FP-7 | Steam vent puzzle (`VALVE_SEQUENCE`) | FP-6 | See IMPLEMENTATION_STATUS | Not browser-verified |
| FP-8 | Crystal chamber and collection (`COLLECT_OBJECT`) | FP-7 | See IMPLEMENTATION_STATUS | Not browser-verified |
| FP-9 | Orchestration and persistence: quest stages, resume, pinning | LAI-0813 | See IMPLEMENTATION_STATUS | pytest |
| FP-10 | Rewards and Discovery Journal | FP-9 | See IMPLEMENTATION_STATUS | pytest |
| FP-11 | Django Admin authoring and publishing | LAI-0801 stage 1 | See IMPLEMENTATION_STATUS | pytest |
| FP-12 | Unit and integration acceptance | FP-2 to FP-11 | See IMPLEMENTATION_STATUS | pytest and Vitest |
| FP-13 | Browser playtesting and performance verification | FP-12, a real Cognito sign-in (ADR-024 A6) | NOT STARTED | Not run |

## 6. Browser acceptance scenarios (prepared, not executed)

Run against a local Django API with `VITE_BACKEND=django` and a Cognito test parent. Each is a
manual or Playwright scenario; none has been executed.

1. A child enters Firepeak from the Place page ("Explore Firepeak Volcano").
2. The child talks to Professor Ember and accepts "The Volcano Awakens".
3. The telescope activity completes after looking at the crater, the lava flow and the steam vent.
4. The bridge is repaired: each gap gets the stone that fits; the stones glow when placed right.
5. The child crosses the lava on the stones. Stepping into the lava returns them to the near bank.
6. The steam puzzle is solved; the sealed passage opens.
7. The Heart Crystal fragment is collected with its discovery animation.
8. The child returns to Base Camp through the opened shortcut and talks to Ember.
9. The quest completes: badge, fragment, journal entries, and `FIREPEAK_VOLCANO_AWAKENED`.
10. The child leaves after the crossing and re-enters: they appear at the crossing checkpoint, the
    bridge is still built, and the steam puzzle is next.
11. Touch: move with the left-half stick, look with the right half, and use the "Things to do
    here" list and the puzzle panels' buttons for every interaction.
