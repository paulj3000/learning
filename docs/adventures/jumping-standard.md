# Jumping Standard

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-020, ADR-053, ADR-056, ADR-058, ADR-059, ADR-063

This standard says how adventures use jumping and how they integrate with the shared movement
controller. Sources: Trello cards LAI-JMP-01 (shared jump controller), LAI-JMP-01a (third-person
avatar and camera), LAI-JMP-01c (avatar assets), LAI-JMP-02 and LAI-JMP-04 (platforms,
checkpoints, safe recovery) and LAI-JMP-03 (Pirate's Leap).

## 1. Status: pending merge

Jumping is **not on `main`**. Everything in sections 3 to 6 describes open pull requests:

| Work | Branch | Pull request | Decision |
|---|---|---|---|
| Shared jump controller | `feature/shared-jump-controller` | PR #26 | ADR-063 (Reserved) |
| Third-person avatar and camera | `feature/third-person-avatar` | PR #27 | ADR-056 (Reserved) |
| Running and sprinting | `feature/player-running` | PR #29 | ADR-058 (Reserved) |
| Platforms, checkpoints, safe recovery | `feature/interactive-platforms` | PR #37 | ADR-059 (Reserved) |
| Pirate's Leap | `feature/pirates-leap` (stacked on PR #37) | PR #38 | none |

The branches number the jump decision ADR-055; on `main` that number is the native dev
environment, so the jump decision becomes ADR-063 when PR #26 merges (registry note in
[../DECISIONS.md](../DECISIONS.md)). Branch documents: `docs/PLAYER_MOVEMENT_AND_JUMPING.md` and
`docs/PLATFORMING.md` on those branches.

What `main` has today: a first-person walking controller
(`react/src/features/island-map/three/firstPersonController.ts`) with a safe-return respawn, and
Firepeak's lava hazard, which returns the child to the last safe checkpoint after a short fade
with nothing earned lost (FP-D10, `extensions/regionPlay/areaEffectsScene.ts`).

Until these merge, the rules below are the integration contract for new adventure work, not a
description of shipped behaviour.

## 2. Adventure-level requirement (proposed)

- Every primary free-roaming 3D adventure meaningfully integrates jumping: at least one place
  where jumping helps the child explore, reach something, or express an answer.
- Not every Challenge uses jumping. A reading or counting panel stays a panel.
- Required progress never depends on jumping alone. Give an accessible alternative (section 8).
- An adventure that must keep the child on the ground (for example a castle room with low
  ceilings or a calm story scene) may turn jumping off or lower it, and says why in its
  specification.

## 3. One shared controller

- New adventures reuse the shared controller. No per-adventure physics, no second physics
  engine, no per-location jump code. (PR #26, PR #37)
- The engine emits typed events and never grades, awards progress or calls AI. **Binding:**
  ADR-020, CLAUDE.md §19
- Any new playable environment is Three.js. **Binding:** ADR-020, CLAUDE.md §19. Phaser worlds get
  no jumping (bug fixes only). **Binding:** CLAUDE.md §19

### Controller API (PR #26, pending merge)

| Surface | Purpose |
|---|---|
| `JumpConfiguration` (`jumpConfiguration.ts`) | Per-location tuning, plain JSON |
| `resolveJumpConfiguration(override)` | Defaults overridden field by field, values clamped to limits |
| `validateMovementSpec(movement)` | Reports unknown keys, wrong types and out-of-range values |
| Manifest `movement.jump` or Django `scene.movement.jump` | Where a location authors its tuning; no Django schema change |
| `engine.pressJump()` | The touch Jump button's entry point |
| Bus events `PlayerJumped`, `PlayerLanded`, `PlayerRecovered` | For sound, HUD and analytics-free feedback |
| `ColliderSpec.jumpable` with `minY`/`maxY` | Marks a low obstacle the child may hop onto |

### Parameters (PR #26 defaults and limits)

| Field | Default | Limits |
|---|---|---|
| `enabled` | `true` | |
| `jumpHeight` (m) | 1.2 | 0.2 to 2.5 |
| `gravity` (m/s²) | 22 | 5 to 80 |
| `airControl` (0 to 1) | 0.65 | 0 to 1 |
| `maxFallSpeed` (m/s) | 18 | 2 to 60 |
| `coyoteTimeMs` | 120 | 0 to 400 |
| `jumpBufferMs` | 150 | 0 to 400 |
| `allowDoubleJump` | `false` | no double jump: holding or mashing never flies |

Override only what the location needs (Storykeeper Castle on the branch uses `jumpHeight: 0.9`
for its ceilings). Do not copy the whole block.

## 4. Controls

| Device | Jump | Notes |
|---|---|---|
| Keyboard | Space | Edge-triggered; ignored in text fields; never scrolls the page |
| Touch | Large Jump button on the right edge | Only where jumping is on and the device has a coarse pointer; does not cover exits, Hint or Backpack |
| Gamepad (standard mapping) | A / Cross | Edge-triggered with deadzone |

One press is one jump on every device. Held input is cleared on blur, hidden tab and when a panel
opens.

## 5. Physics, collision and platforms

- Solid colliders block at every height. A jump never carries a child over a wall, boundary,
  locked gate, broken bridge or quest barrier.
- Only authored low obstacles are jumpable. A gated collider can never be jumpable.
- Trigger zones are ground-plane areas: jumping through a required interaction still enters it,
  so story steps cannot be skipped by jumping.
- Landing detection, step-up (0.25 m) and head bumps are the controller's; adventures do not
  reimplement them.
- Platforms (PR #37) are jumpable boxes in the same collider list: static, moving, plate, switch,
  zone, signal, world-state, appearing, vanishing, bounce and turntable. Platforms yield to the
  child and never push them through a wall. Limits are forgiving (tops at least 0.8 m, speeds 0.2
  to 4 m/s, vanish visible at least 1.5 s).
- Platform layout is seed-authored (positions, paths, checkpoints, hazards, goals); staff tune
  speeds and timings per 3D Area in Django Admin. **Binding:** ADR-033, ADR-047 (layout stays
  seed-authored)

## 6. Checkpoints and safe recovery

- No lives, no death, no game over, no timer. **Binding:** ADR-053 (no time limits); the rest is
  the PR #37 design.
- A hazard or a fall returns the child to the latest checkpoint reached this visit, else to the
  last safe ground. Moving or vanishing platforms are never remembered as safe ground.
- Recovery changes position only. Items, quest progress and rewards are server state and are
  never touched.
- Feedback is kind and short, for example "Splash! Back to the old dock. Have another go!"
  ([audio-standard.md](audio-standard.md) for the matching cue).
- Course checkpoints are validated to be inside the 3D Area, not inside an obstacle, and never on
  a moving platform.

## 7. Educational jumping activities

| Activity | Shape | Example rule |
|---|---|---|
| Stepping stones | Each stone shows an answer; the right sequence crosses | The server grades the sequence the child reports, not the landing |
| Answer by jumping | Jump onto the pad that matches the answer | The pad reports a choice; the server grades it |
| Collecting objects | Hop to reach items placed on low ledges | Item grants are server rewards, idempotent |
| Bridges | A solved Challenge raises or reveals platforms (`SIGNAL` or `WORLD_STATE` trigger) | The world change, not the jump, is the consequence |
| Elevated exploration | Optional lookouts and discoveries | Never required for completion |

In every case the jump is input; correctness and rewards stay on the server
([challenge-standard.md](challenge-standard.md)).

## 8. Accessibility alternatives (proposed)

These are proposals for owner decision, not shipped features:

- **Alternate route:** required progress always has a walking route or a panel alternative
  (PR #37 requires this; Pirate's Leap provides one).
- **Tap-to-hop:** tapping a highlighted jumpable target moves the child onto it.
- **Auto-jump assist:** a child setting that jumps automatically at authored gaps.
- **Lower difficulty:** per-band tuning (wider platforms, slower motion, longer vanish time).

Reduced motion: no landing camera dip, platforms and turntables slowed to 60%, vanish warnings as
a steady dim instead of a blink (PR #26, PR #37). See
[accessibility-standard.md](accessibility-standard.md).

## 9. Difficulty by age band (proposed)

| Band | Guidance |
|---|---|
| Sprouts (3 to 4) | Jumping optional everywhere; no moving or vanishing platforms on a required path |
| Pathfinders (5 to 6) | Static and slow moving platforms; generous widths; visible destination rings |
| Explorers (7 to 8) | Multi-step courses, vanishing and bounce platforms, still with checkpoints |

Band differences are tuning and content, not engine branches.

## 10. Camera, animation, audio and visual feedback

- Camera: first-person on `main`. A third-person camera is pending (ADR-056 Reserved, PR #27).
  Adventures must work in first person.
- Animation: movement states map onto the NPC Manager animation vocabulary for a future avatar
  (`playerAnimation.ts`, PR #26).
- Audio: logical cues `sfx.player.jump`, `sfx.player.land`, `sfx.player.recover` and
  `sfx.platform.*`, optional in the cue catalogue; missing audio leaves jumping silent and working
  (PR #26, PR #37). See [audio-standard.md](audio-standard.md).
- Visual: destination rings on moving platforms, checkpoint flags, a toast on checkpoint reached.

## 11. Acceptance criteria for an adventure that uses jumping

- [ ] Uses the shared controller and manifest `movement` block only.
- [ ] Every required step reachable without jumping (alternate route or panel).
- [ ] No barrier, gate or required zone bypassable by jumping; engine test proves it.
- [ ] Hazards and falls recover to a checkpoint with no progress change; tested.
- [ ] Keyboard, touch and gamepad jump checked in owner QA
  ([../engineering/templates/qa-checklist.md](../engineering/templates/qa-checklist.md)).
- [ ] Reduced-motion behaviour checked.
- [ ] If it depends on PR #26 or PR #37, it is developed on an integration branch and is not
  merged before them ([../engineering/integration-policy.md](../engineering/integration-policy.md)).
