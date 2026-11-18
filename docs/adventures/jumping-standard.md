# Jumping Standard

- **Status:** Mandatory policy (in effect once merged to `main` with owner approval; governance decision ADR-072, Proposed). The adventure-level requirement is policy; the implementation it relies on is Pending merge.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-029, ADR-033, ADR-053; pending merge (Reserved on `main`): ADR-063 (jumping), ADR-056 (camera), ADR-057 (avatar), ADR-058 (running), ADR-059 (platforms), ADR-060 (footprint)
- **Canonical sources:** owner direction 2026-11-17 (Trello: jumping is standard gameplay in every adventure); on branches, read-only: `origin/feature/interactive-platforms:docs/PLAYER_MOVEMENT_AND_JUMPING.md`, `origin/feature/interactive-platforms:docs/PLATFORMING.md`, `origin/feature/interactive-platforms:docs/PLAYER_AVATAR_AND_CAMERA.md`, `origin/feature/treasure-rush-palm-trees:docs/DECISIONS.md` (footprint)

## Status on 2026-11-18

- **Implemented (main): no jumping.** `main`'s `FirstPersonController`, `pointerControls.ts` and
  `WorldHud.tsx` have no jump. Nothing in this document is available on `main` yet.
- **Pending merge:** the shared jump controller (`feature/shared-jump-controller`, PR #26), the
  third-person camera (`feature/third-person-avatar`, PR #27), avatar assets
  (`feature/player-avatar-assets`, PR #28), running (`feature/player-running`, PR #29), the
  cylindrical footprint (`feature/treasure-rush-palm-trees`, PR #36) and platforms
  (`feature/interactive-platforms`, PR #37). They are stacked in that order and are
  development-complete and unit-tested, with owner QA pending.
- **Numbering.** Branch documents call the jump decision "ADR-055". On `main`, ADR-055 is the
  development environment decision; the jump decision is reserved as **ADR-063**. Read every
  branch reference to "ADR-055" in a movement document as ADR-063.

**Until those branches merge, new jumping work stacks on them or is coordinated with their
owner. It never re-implements jumping, gravity, platforms, checkpoints or recovery on `main` or
in an adventure.**

## The requirement

1. **Every primary adventure includes meaningful jumping** (owner direction, 2026-11-17). A
   primary adventure is one played in a 3D Area (see the [adventure standard](adventure-standard.md)).
   "Meaningful" means jumping changes what the child can reach or do: a shortcut, an optional
   collectible, an elevated view, a stepping-stone crossing, an answer chosen by jumping.
2. **Not every challenge needs jumping.** Learning challenges, dialogue and step adventures stay
   jump-free unless the spec gives a reason.
3. **Required progress never needs a jump.** Every required route has a walking alternative;
   jump routes lead to optional rewards, shortcuts or secrets (North Pole NP-D5 and Pirate's
   Leap on their branches already follow this).
4. **No forced timers, no loss of learning progress, safe recovery** (owner direction, ADR-053).

## Shared implementation (pending merge)

One controller and one runtime serve every 3D location. Adventures configure them with data.

| Piece | File on the branches (under `react/src/features/island-map/three/`) |
|---|---|
| Movement controller: gravity, jump, landing, coyote time, buffer, step-up, head bumps, recovery | `firstPersonController.ts` |
| Jump configuration, defaults, limits, validation | `jumpConfiguration.ts` |
| Input: keyboard, gamepad, touch | `pointerControls.ts`, `gamepadInput.ts`, `WorldHud.tsx` |
| Camera (first- and third-person) | `playerCamera.ts`, `cameraHeightFollower.ts` |
| Avatar and animation | `playerAvatar.ts`, `playerAnimation.ts` |
| Footprint | `playerCollision.ts` |
| Platforms, plates, checkpoints, hazards, goals | `platforms/` (`platformSpec.ts`, `platformSystem.ts`, `platformMotion.ts`) |

Configuration is data: `movement.jump` in a TypeScript manifest or `scene.movement.jump` on a
Django 3D Area; `platforming` likewise. Platform layout is seed-authored (LAI-0805); platform
tuning (speed, pauses, bounce, vanish timings, enabled) is staff-authored in Django Admin and
validated on publish.

## Controls (as built on the branches)

| Platform | Move | Look | Jump | Interact |
|---|---|---|---|---|
| Keyboard and mouse | W A S D or arrow keys | Mouse | Space | E or Enter |
| Phone and tablet | Drag on the left half | Drag on the right half | On-screen Jump button, right edge | Action prompt and "Things to do here" |
| Gamepad (standard mapping) | Left stick | Right stick | A (Xbox) or Cross (PlayStation) | X or Square |

- One jump per press; held keys and buttons never repeat. No double jump.
- Space does not scroll the page; in a text field it types a space and the player does not move.
- Held input is cleared on blur, a hidden tab or an opened panel.
- The touch Jump button appears only where jumping is on and the device has a coarse pointer. It
  must not cover Backpack, Hint, the exits or the action prompt, in portrait or landscape.
- Shift sprints (hold or toggle) on the running branch.

## Physics parameters

Defined by the shared controller (`jumpConfiguration.ts` on the branches). Per-location
overrides must stay within the validated limits; adventures do not invent their own physics.

| Field | Default | Limits |
|---|---|---|
| `enabled` | `true` | |
| `jumpHeight` (m) | 1.2 | 0.2 to 2.5 |
| `gravity` (m/s²) | 22 | 5 to 80 |
| `airControl` | 0.65 | 0 to 1 |
| `maxFallSpeed` (m/s) | 18 | 2 to 60 |
| `coyoteTimeMs` | 120 | 0 to 400 |
| `jumpBufferMs` | 150 | 0 to 400 |
| `allowDoubleJump` | `false` | |

Controller constants (not per location): step height 0.25 m, body height 1.7 m, physics substep
1/120 s, recovery depth -10 m. Footprint: a 0.35 m radius cylinder plus 0.02 m skin (ADR-060,
pending merge). Example override on a branch: Storykeeper Castle `jumpHeight` 0.9 to stay under
its ceilings.

## Landing, collision and platforms

- **Solid by default.** A collider blocks at every height unless authored `jumpable: true` with
  `minY`/`maxY`.
- **Gates are never jumpable.** A collider with `requirements` (a locked door, quest gate,
  boundary, broken bridge) rejects `jumpable` in validation and the runtime ignores it.
- **Trigger zones are ground-plane areas.** Checkpoints, walk-in interactions, hazards and audio
  zones are entered by x/z, so jumping over a required story zone still enters it.
- **Platforms** are jumpable boxes in the same collider list: static, moving, pressure-plate,
  switch, zone, signal (a solved challenge), world-state unlocks, appearing bridges, vanishing,
  bounce and turntables. Tops at least 0.8 m; speeds 0.2 to 4 m/s; at most 64 platforms per Area.
  Platforms yield to the child and never push them through walls. Where each type may sit:
  [Platforms on required paths](#platforms-on-required-paths).
- Tilting, seesaw, rolling and rope mechanics are not built; they would need a physics
  dependency the project has not approved. Do not add one without an ADR.

## Educational jumping activities

Jumping serves the adventure's learning goal or exploration, never replaces it. Patterns:

| Pattern | Built from | Rule |
|---|---|---|
| Stepping stones over water or lava | Static platforms, hazards, checkpoints | Optional, or with a walking route beside it |
| Platform paths and elevated exploration | Static or moving platforms | Lead to a view, a secret or a collectible |
| Collecting objects | `COLLECTIBLE` placements on or between platforms | The collectible is optional; the server records it once |
| Answer by jumping | Jump onto the platform or object showing the answer; the server grades it | An equivalent button answer is always offered (as the rune stones' panel does) |
| Bridges built by learning | `SIGNAL` or `WORLD_STATE` activation after a solved challenge | The bridge is walkable once built |
| Counting jumps, sequencing pads | Plates and goals reported as events; Django grades | No timing requirement; an equivalent non-jump answer (buttons or a walking route) is always offered |

The engine only emits events (`PlayerJumped`, `PlayerLanded`, `PlatformGoalReached` and others);
React and Django decide what they mean (ADR-020).

## Checkpoints and safe respawn

- Course checkpoints sit at ground level, inside the Area, never on a moving, vanishing, bouncing
  or appearing platform.
- A hazard or a fall returns the child to the latest checkpoint reached (else the last safe
  ground), with a short, kind message ("Splash! Back to the old dock. Have another go!").
- Recovery moves the player only. Items, quest state, world changes and rewards are server state
  and are never touched.
- Every hazard has a checkpoint beside it. Place hazards so a miss costs seconds, not a section.

## Forgiving recovery

- No lives, no game over, no score loss, no timer, no "try again from the start".
- A missed jump never undoes learning progress or a solved challenge.
- Vanishing platforms warn before they go (blink; a steady dim under reduced motion).

## Platforms on required paths

This is the one platform placement rule; other standards link here. In every age band, moving,
vanishing and bounce platforms sit only on optional routes, never on a required path. Required
paths use static platforms (a bridge that appears after a solved challenge and then stays put
counts as static), and every required step also has a walking route. The band limits below
(speeds, sequence lengths) apply to optional routes.

## Difficulty by age band

Difficulty lives in content (gap sizes, heights, platform speed, number of jumps in a row), never
in engine branches. The spec states, per band, what each jump route asks.

| Band | Expectation |
|---|---|
| Sprouts (3-4) | Single low hops onto wide surfaces; no hazards on any route they need; jump routes purely optional. ADR-008's Sprouts accessibility validation still applies to 3D play |
| Pathfinders (5-6) | Short sequences of static jumps; slow, predictable moving platforms; checkpoint before each section |
| Explorers (7-8) | Longer sequences, moving and vanishing platforms, bounce routes, still with checkpoints and walking alternatives for required progress |

Reference values authored on branches (not new rules): Pirate's Leap gaps of 0.6 to 1.2 m (a
walking jump clears 2.5 m); North Pole gaps up to 1.6 m.

## Camera and animation

- Third-person is the default with a first-person option; the child's choice is remembered (ADR-056,
  pending merge). The camera rides the jump arc; a landing dip of at most 7 cm, none under reduced motion.
- Animation states (idle, walk, jump, airborne, falling, landing) map onto the NPC Manager's
  animation vocabulary. A model without a jump clip keeps walk or idle while airborne.
- No root motion from any rig.

## Audio and visual feedback

- Optional cues `sfx.player.jump`, `sfx.player.land` and the `sfx.platform.*` set, played through
  the Sound Manager by cue id. Missing audio leaves jumping silent and working; it never blocks
  readiness.
- Visual cues: destination rings on moving platforms, checkpoint flags, blink warnings,
  short text toasts that are also readable aloud.

## Accessibility alternatives

- A **non-jump route** for all required progress (mandatory).
- Jumping operable by keyboard, touch button, gamepad and switch (the Jump button works from a
  keyboard or switch).
- Staff tuning can slow or disable any platform per Area without code.
- Reduced motion: no landing dip, gentler easing, platforms slowed to 60%.
- **Proposed (needs owner approval):** a per-child jump assist setting (for example a wider
  coyote window or auto-jump at marked gaps). Not built; do not add it without a spec and an ADR.

## Reuse requirement

- Use the shared controller, platform system, checkpoints and recovery. No per-adventure movement
  code, physics or collision.
- New behaviour (a new platform type, a new activation) is a change to the shared system, made on
  or after the platform branch, with tests for every location.
- Phaser worlds get no jumping (ADR-020): they get it when converted to Three.js.

## Acceptance checklist

- [ ] The adventure has at least one meaningful jump route, named in the spec.
- [ ] Every required step can be completed without jumping.
- [ ] Built on the shared controller and platform system; no new movement code; branch dependency stated.
- [ ] Gates, boundaries and quest barriers are solid; no required zone can be skipped.
- [ ] Every hazard has a checkpoint; recovery never removes progress, items or rewards.
- [ ] No timers on any route; required paths use static platforms only; moving, vanishing and bounce platforms only on optional routes.
- [ ] Per-band jump difficulty stated and within the controller limits.
- [ ] Keyboard, touch and gamepad controls work; the Jump button covers no other control.
- [ ] Reduced-motion behaviour checked.
- [ ] Unit and engine tests for the course (layout validation, checkpoints, hazards, goals).
- [ ] Owner QA on desktop and a touch device, per age band.
