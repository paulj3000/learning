# Player Running and Sprinting

Status: development complete on `feature/player-running`, unit-tested only. Not yet seen in a
browser, on a touch device or with a gamepad. Trello: "Shared Player Running & Sprinting".
Decision record: ADR-058.

**Depends on** PR #28 (LAI-JMP-01c, `feature/player-avatar-assets`), which depends on PR #27
(LAI-JMP-01a) and PR #26 (LAI-JMP-01). None were merged when this branch was made. Merge #26,
#27, #28, then this.

Children can walk, run and sprint, and jump from any of them, in every free-roaming 3D
adventure. It extends the one shared movement controller (`FirstPersonController`); there is no
new controller, camera, animation or input system. No stamina, cooldowns or penalties: a child can
sprint as long as they like.

## How it works

- **The controller stays authoritative.** Speed comes from the input's strength and the gait:
  - keys walk at full walking pace, exactly as before;
  - analog input (a joystick drag, a stick) scales up to walking pace, then rises continuously to
    running pace at full deflection;
  - sprint (Shift, L3, a drag past the joystick edge) moves at sprinting pace.
- **Smooth gait changes.** Above walking pace speed rises at most `gaitAcceleration` (8 m/s²) and
  falls at most `gaitDeceleration` (10 m/s²) while moving: walk to sprint takes about a third of a
  second. Starting and stopping keep their existing snappy rates.
- **States.** `IDLE`, `WALK`, `RUN`, `SPRINT` on the ground (from the real speed, with a small
  margin so states do not flicker), then the existing `JUMP_START`, `AIRBORNE`, `FALLING`,
  `LANDING`.
- **Running jumps carry momentum.** Take-off speed is kept through the air (air control
  unchanged), so a running jump goes further than a walking one and a sprinting one further still.
  Jump height, gravity and landing are untouched.
- **No tunnelling.** Horizontal movement is now tested in steps of at most 10 cm, so even a long
  frame (the engine clamps to 0.1 s, 0.65 m at sprint) cannot skip a wall. A test checks that no
  authored collider in any adventure (including Treasure Cove's layout) is that thin.
- **Gates stay closed.** Solid colliders still block at every height, so sprinting and jumping at
  a locked gate, the broken bridge or the world's edge changes nothing. Zones, checkpoints and
  story interactions are unchanged.

## Movement settings

`ThreeLocationManifest.movement.locomotion`, or `scene.movement.locomotion` on a Django region
(no schema change), validated with the manifest. Any field may be left out.

| Field | Default | Limits | Meaning |
|---|---|---|---|
| `walkSpeed` | **4.0** m/s | 0.5 to 8 | Full keyboard input. Kept at the speed every adventure already had. |
| `runSpeed` | **5.5** m/s | 0.5 to 10 | Full analog input. Never below walking. |
| `sprintSpeed` | **6.5** m/s | 0.5 to 12 | Sprint. Never below running. |
| `acceleration` | 20 /s | 1 to 100 | Easing toward the target while moving (as before). |
| `deceleration` | 25 /s | 1 to 100 | Easing to a stop with no input (as before). |
| `gaitAcceleration` | 8 m/s² | 0.5 to 50 | Most the speed rises per second above walking pace. |
| `gaitDeceleration` | 10 m/s² | 0.5 to 50 | Most it falls per second above walking pace while moving. |
| `runEnabled` | `true` | | Off: analog input tops out at walking. |
| `sprintEnabled` | `true` | | Off: the sprint control does nothing (and the Shift setting is hidden). |

The suggested 3 / 4.5 / 6 m/s was adjusted because the existing walking speed is 4 m/s and the
brief says to keep it: run and sprint keep roughly the suggested ratios above it (1.4x and 1.6x).

Camera: `player.camera.sprintFovBoost` (default 3 degrees, 0 to 8) widens the view slightly while
sprinting, eased over about half a second. 0 turns it off; it is always off under reduced motion.

Storykeeper Castle: `locomotion: { runSpeed: 4.8, sprintSpeed: 5.6 }`, so a child does not shoot
through the small rooms and passages. Walking pace is unchanged.

## Controls

| Action | Desktop | Phone / tablet | Gamepad |
|---|---|---|---|
| Walk | W A S D / arrows | Short drag on the left half (up to 40 px, as before) | Left stick partly tilted |
| Run | (keys walk; see note) | Longer drag (40 to 60 px) | Left stick fully tilted |
| Sprint | **Hold Shift** (or tap Shift, setting) | Drag past 72 px | **L3** (press the left stick); ends when you stop |
| Jump | Space | Jump button | A / Cross |
| Interact | E / Enter | Action prompt | X / Square |
| Camera view | V | View button | Y / Triangle |
| Look | Mouse | Drag on the right half | Right stick |

- Keyboard keys are on or off, so the keyboard has two speeds: walking, and sprinting with Shift.
  Running is the analog middle speed of a joystick or stick.
- "Sprint with Shift" under the stage chooses **Hold Shift** (default) or **Tap Shift to switch**;
  remembered per child in this browser, like the camera view. A tapped sprint, and an L3 sprint,
  end when the child stops moving.
- Nothing happens while typing in a text field. Sprint is cleared when the window loses focus,
  the tab is hidden, or a panel opens.
- No new HUD buttons: on touch screens a child just drags further. Movement and look drags stay
  separate touches, so running, turning and jumping work together.
- The gamepad sprint button is `GamepadBindings.sprint` (default 10, L3), rebindable.

## Animation

Through the existing player animation controller and the published avatar pipeline:

| Movement | With a `Run` clip | Without one |
|---|---|---|
| Walk | `Walk` at 0.6x to 1.25x of its speed | same |
| Run / Sprint | `Run` at 0.8x to 1.3x (speed / run speed) | `Walk`, sped up to at most 1.7x |
| Jump from a run | `Jump`, `Fall`, `Land` as before | as before |
| Land while still running | back to `Run` | back to `Walk` |

Never a celebration or gesture as a fallback. Root motion is stripped as before; the controller
alone moves the child.

## Camera

Both perspectives track a running child unchanged: first-person keeps the eye at the feet with
no added bobbing; third-person follows with the existing damping (the lag at sprint stays under a
metre), keeps its wall avoidance and the castle's ceiling. The only sprint effect is the optional
3-degree widening above.

## Sound

The engine emits, on the world event bus:

- `PlayerGaitChanged { gait: 'idle' | 'walk' | 'run' | 'sprint' }`, once per change, on the ground;
- `PlayerFootstep { gait }`, one per stride (0.75 m walking, 1.0 m running, 1.2 m sprinting), so
  steps follow the real speed.

Treasure Rush plays the optional cue `sfx.player.footstep` (Django catalogue, `wired=False`) at a
volume by gait. No audio is needed: without it, movement is silent and unaffected.

## Adventures

| Adventure | Running & sprinting | Notes |
|---|---|---|
| Treasure Cove | **Yes** (defaults) | Engine test: sprint-jumping at the closed ruins gate never passes it. |
| Storykeeper Castle | **Yes** (gentler run 4.8, sprint 5.6) | Indoor tuning; camera ceiling unchanged. |
| Pirate Builder Bay | **Yes** (defaults) | Engine test: sprint-jumping with long frames never crosses the broken bridge. |
| Welcome Harbor, Wonderwild Forest, Clockwork Harbor, Dragon's Sanctuary, Firepeak | **Yes** (defaults) | Same shared runtime, no per-location code. |
| Phaser 2D worlds | No | ADR-020. |

## Known limitations

- The keyboard has walk and sprint only (no middle "run" speed), as keys are not analog.
- Footstep audio needs an asset assigned to `sfx.player.footstep`; none exists yet.
- The placeholder avatar has no clips; a model with a `Run` clip is needed to see a true run cycle.
- The sprint setting is per browser, like the camera view (cross-device sync is LAI-JMP-01d).
- Not yet checked in a browser, on a device or with a gamepad.

## Owner QA checklist

**Desktop**

- [ ] Treasure Cove: W walks at the same pace as before; holding Shift speeds up smoothly (no
  jerk) to a sprint; letting go eases back to walking; letting go of W stops promptly.
- [ ] Choose "Tap Shift to switch": one tap sprints, another walks; stopping ends the sprint.
- [ ] Sprint and jump: the jump goes noticeably further than a walking jump, no higher.
- [ ] Sprint into ruin walls, grove boulders and the closed gate: never through, never past.
- [ ] Typing in an answer box with Shift does nothing to the explorer.
- [ ] Switch windows while sprinting and come back: walking, not sprinting.
- [ ] In third-person the explorer runs (or walks faster if the model has no Run clip), lands back
  into a run, and the camera follows without lurching; sprinting widens the view very slightly.
- [ ] With reduce motion on: no widening.
- [ ] Storykeeper Castle: running and sprinting are gentler; the camera still stays inside rooms.
- [ ] Pirate Builder Bay: the broken bridge cannot be crossed however fast you go.

**Phone and tablet (portrait and landscape)**

- [ ] A short drag walks, a longer drag runs, a long drag sprints; no new buttons appear and
  Jump, View, Backpack, Hint and Exit are unchanged.
- [ ] Run, turn the camera and tap Jump at the same time.

**Gamepad**

- [ ] Partly tilted stick walks, fully tilted runs; L3 sprints until you stop.
- [ ] Right stick, A, X and Y work as before.
