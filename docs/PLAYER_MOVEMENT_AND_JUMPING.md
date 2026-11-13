# Player Movement and Jumping (LAI-JMP-01)

Status: development complete on `feature/shared-jump-controller`; unit-tested only. Not yet seen
in a browser, on a touch device or with a gamepad (see "Owner QA checklist"). Decision record:
ADR-055 in `docs/DECISIONS.md`.

Jumping is standard movement in every free-roaming 3D location, alongside walking. It is not a
platforming feature: no location has to become a "platforming adventure" to get it, and the
Jumping & Platforming Adventures subproject (LAI-JMP-03 Pirate's Leap onward) builds on this same
controller rather than a new one.

## Architecture

There is one movement controller and one location runtime. Jumping was added to them; nothing
was duplicated per adventure.

```text
Keyboard (Space)  ─┐
Gamepad (A/Cross) ─┼─> pointerControls.ts ──┐
Touch drag/look   ─┘                         ├─> FirstPersonController ──> createLocationEngine
HUD Jump button ──> engine.pressJump() ──────┘    (walk, jump, gravity,     (camera height,
                                                  collisions, recovery)      bus events)
```

| File (under `react/src/features/island-map/three/`) | Role |
|---|---|
| `firstPersonController.ts` | The shared controller. Now owns vertical velocity, gravity, ground detection, jump impulse, terminal fall speed, air control, landing, head bumps, step-up, coyote time, jump buffer, double-jump rule, safe recovery, movement state and movement events. Pure math, no DOM or renderer. |
| `jumpConfiguration.ts` | `JumpConfiguration`, defaults, limits, `resolveJumpConfiguration`, `validateMovementSpec`. Pure, JSON-shaped. |
| `pointerControls.ts` | The existing input abstraction. Adds Space (edge-triggered, ignored in form fields), gamepad (via `gamepadInput.ts`), and `resetInput()` on blur, hidden tab and panel open. |
| `gamepadInput.ts` | Standard-mapping gamepad reader: sticks, A/Cross jump, X/Square interact, edge-triggered with deadzone. |
| `cameraHeightFollower.ts` | Camera height comfort: rides the jump arc, eases floor-height changes, small landing dip (none under reduced motion). |
| `playerAnimation.ts` | Maps movement states onto the NPC Manager animation vocabulary for a future avatar. |
| `runtime/createLocationEngine.ts` | Builds the controller from the manifest (`movement`, `jumpable` colliders, playable area), drives the camera, emits `PlayerJumped`, `PlayerLanded`, `PlayerRecovered`, exposes `pressJump()`, `jump` and `resetInput()`. |
| `WorldHud.tsx` | The touch Jump button. |
| `runtime/ThreeLocationWorldView.tsx` | Shows the Jump button where jumping is on; resets input when a panel opens over the scene. |

The player is first-person in every location today (`camera = controller position + eye
height`). There is no third-person avatar or orbit camera in the codebase; see "Known
limitations".

## Configuration

`ThreeLocationManifest.movement.jump` (a source manifest) or `scene.movement.jump` (a Django
region such as Treasure Cove) overrides any subset of the defaults. Absent means the defaults,
which include jumping. The validator rejects typos, wrong types and out-of-range values.

| Field | Default | Limits | Why this value |
|---|---|---|---|
| `enabled` | `true` | | Jumping is standard movement. |
| `jumpHeight` (m, feet rise) | `1.2` | 0.2 to 2.5 | Clears a 0.9 m barrel with room to spare at a 1.6 m eye height. |
| `gravity` (m/s²) | `22` | 5 to 80 | About 0.66 s in the air: snappy, not floaty, still steerable by a young child. |
| `airControl` (0 to 1) | `0.65` | 0 to 1 | Can steer onto a rock mid-air; momentum still carries. |
| `maxFallSpeed` (m/s) | `18` | 2 to 60 | No tunnelling or jolts on long drops. |
| `coyoteTimeMs` | `120` | 0 to 400 | A late press just after walking off an edge still jumps. |
| `jumpBufferMs` | `150` | 0 to 400 | An early press just before landing jumps on landing. |
| `allowDoubleJump` | `false` | | Holding or mashing never flies. |

Controller constants (not per location): step height 0.25 m (walked up without jumping), body
height 1.7 m (head bumps), physics substep 1/120 s (frame-rate independence), recovery depth
-10 m. Walking speed and acceleration are unchanged.

Examples:

```ts
movement: { jump: { jumpHeight: 0.9 } }   // Storykeeper Castle: lower hop indoors
movement: { jump: { enabled: false } }    // a location that must keep the child on the ground
```

No Django schema change: a Django region carries the block inside its existing `scene` JSON, and
the client validates it with the rest of the manifest.

## Collision and safety rules

- **Solid colliders (the default) block at every height.** They are tested at ground level
  exactly as before, so walking is unchanged and a jump never carries a child over a wall,
  boundary, locked gate, broken bridge, quest barrier or anything an extension adds at runtime.
- **Jumpable colliders** (`ColliderSpec.jumpable: true`, with authored `minY`/`maxY`) block only
  where they are in height. The child can hop onto them, walk along the top, step off, and bump
  their head on an underside.
- **A gated collider can never be jumpable.** The validator reports `jumpable` on a collider with
  `requirements`, and `solidColliders` ignores the flag there anyway.
- **Trigger zones are ground-plane areas.** Walk-in interactions, checkpoints and audio zones are
  entered by x/z position, so jumping through one still enters it: a required story interaction
  cannot be skipped by jumping over its zone.
- **Safe recovery.** A non-finite position, feet below the recovery depth, or a position outside
  the bounds plus a margin puts the child back at the last place they stood, stopped, and emits
  `PlayerRecovered`. Only position changes: no progress, items or quest state are touched.

## Controls

| Platform | Move | Look | Jump | Interact |
|---|---|---|---|---|
| Desktop | W A S D or arrows | Mouse (click to lock pointer) | **Space** | E or Enter |
| Phone / tablet | Drag on the left half | Drag on the right half | **Jump button** (right edge) | Action prompt / Things to do |
| Gamepad (standard mapping) | Left stick | Right stick | **A** (Xbox) / **Cross** (PlayStation) | X (Xbox) / Square (PlayStation) |

- One jump per press: key auto-repeat, a held key, a held button or a held gamepad button never
  jump again until released.
- Movement and jump work together on every device, including two fingers on a touch screen (the
  Jump button is outside the canvas, so the move drag keeps its own touch).
- Space does not scroll the page during play; in a text field it types a space as usual and
  nothing in the game moves.
- Held input is forgotten when the window loses focus, the tab is hidden or a panel opens over
  the scene, so nothing stays stuck down.

The Jump button shows only where jumping is on and only on a device with a touch screen
(`any-pointer: coarse`). It is 4.75rem across (5.5rem from 900px), on the right edge above the
Hint and Backpack column and below the exit link, so it overlaps neither, and the left half stays
free for the move drag. It jumps on pointer down, and works from a keyboard or switch.

## Camera

First-person. In the air the camera rides the jump arc exactly; on the ground, floor-height
changes (stepping onto a crate, off a ledge) are eased over a fraction of a second; a landing
gives a dip of at most 7 cm that springs back. With `prefers-reduced-motion` there is no dip and
steps ease more gently. Look controls, pitch limits and the near plane are unchanged.

## Animation

`playerAnimation.ts` maps movement states (Idle, Walk, Jump Start, Airborne, Falling, Landing)
onto the existing NPC Manager animation vocabulary (`idle`, `walk`, `jump`) for
`createNpcAnimator`, which already resolves a state to a GLB clip through an avatar's
`animationMap`. An avatar without a jump clip keeps its walk or idle clip while airborne (not the
NPC fallback chain, which would play a celebration). Because the player is first-person, no
avatar is drawn and the driver is not wired yet; it is the contract for the third-person follow-up.

## Sound

The engine emits `PlayerJumped` and `PlayerLanded` on the world event bus. Treasure Rush's audio
(`useTreasureRushAudio`) plays the logical cues `sfx.player.jump` and `sfx.player.land` (landing
only at 3 m/s or more, so small hops are silent) through the existing Sound Manager scope. The
cues are in the Django cue catalogue as optional (`wired=False`): reported in coverage, never a
readiness blocker. No file paths: staff assign audio in Django Admin. Missing audio leaves jumping
silent and fully working.

## Adventures

| Adventure / region | Renderer | Jumping | Notes |
|---|---|---|---|
| Treasure Cove (Treasure Rush) | Shared 3D engine (Django region) | **On** (defaults) | Four landing barrels are jumpable (0.9 m). Ruins gate, channel and bridge gap stay solid. Layout version 5. |
| Storykeeper Castle | Shared 3D engine | **On** (`jumpHeight` 0.9) | Lower hop keeps the eye under the 3.1 m ceilings. All walls and doors solid. |
| Pirate Builder Bay | Shared 3D engine | **On** (defaults) | The low dock-path crate pair (0.8 m) is jumpable. Channel and broken bridge stay solid. |
| Welcome Harbor | Shared 3D engine | **On** (defaults) | No jumpable obstacles authored yet. |
| Wonderwild Forest | Shared 3D engine | **On** (defaults) | No jumpable obstacles authored yet. |
| Clockwork Harbor | Shared 3D engine | **On** (defaults) | No jumpable obstacles authored yet. |
| Dragon's Sanctuary | Shared 3D engine | **On** (defaults) | No jumpable obstacles authored yet. |
| Firepeak Volcano | Shared 3D engine (Django region) | **On** (defaults) | Lava is checked by x/z every frame, so jumping over it still counts as stepping in (safe return, no progress lost). Gates stay solid. |
| Three.js sandbox (dev) | Own scene, shared controller | On | Camera follows the jump. |
| Island overview, Fossil Ridge Camp, Castle Writing Room, Bolts Workshop, and the 2D Pirate Builder Bay / Wonderwild Forest / Storykeeper Castle views | Phaser 2D | **No** | ADR-020: no new features in Phaser worlds. They get jumping when converted to the Three.js runtime. Follow-up card created. |

"No jumpable obstacles authored yet" means the child can jump freely there, but every existing
collider is a wall, so there is nothing to hop onto. Authoring low obstacles is content work: add
`jumpable: true` with `minY`/`maxY` to a collider whose model is low enough.

## Known limitations

- First-person only. There is no third-person avatar or orbit camera, so jump animations are not
  visible yet and "camera clipping" is limited to the near plane. Follow-up card created.
- No running: the controller has one walking speed today. A run speed would add a `RUN` state.
- Ground is flat (height 0) in every location. `groundHeightAt` supports terrain and holes for
  the platforming subproject, but no location authors terrain yet.
- Jumpable colliders are axis-aligned boxes and the player is a point in x/z, as walking always
  was. A rotated or round obstacle needs a box that fits it.
- Changing Treasure Cove's layout takes effect where `seed_treasure_rush` runs and sees the layout
  version bump; nothing is deployed by this branch.
- Not yet checked in a browser, on a device or with a gamepad.

## Owner QA checklist

Run `npm run dev`, sign in, and open each location below. Tick each item.

**Desktop (keyboard and mouse)**

- [ ] Treasure Cove: Space jumps once; holding Space does not keep jumping; release and press
  again jumps again.
- [ ] Walk with W and press Space: a moving jump carries forward; steering with A/D in the air
  works.
- [ ] Jump onto a landing barrel and stand on it; walk off it and land softly.
- [ ] Walking into a barrel without jumping is blocked.
- [ ] The ruins gate and the channel cannot be jumped over or onto (before the quest is done).
- [ ] The page never scrolls when pressing Space during play.
- [ ] In any answer or text box, Space types a space and the player does not jump or move.
- [ ] Hold W, switch to another window, come back: the player is not still walking.
- [ ] Open a chest or talk to Pip mid-jump: on closing the panel nothing is stuck.
- [ ] Storykeeper Castle: jumping works, the hop is lower, the view never goes through a ceiling,
  and no door or wall can be jumped past.
- [ ] Pirate Builder Bay: jump onto the low crate pair by the dock path; the channel and the
  broken bridge cannot be crossed by jumping.
- [ ] Walking everywhere feels exactly as before.
- [ ] With "reduce motion" on in the OS, landing has no dip.

**Phone and tablet**

- [ ] The Jump button appears on the right edge, large enough for a child's thumb, and does not
  cover Backpack, Hint, Exit or the action prompt (portrait and landscape, phone and tablet).
- [ ] Drag to move with the left thumb and tap Jump with the right at the same time.
- [ ] One tap is one jump; holding the button does not repeat.
- [ ] Long-press on the button does not select text or open a menu.
- [ ] The button is absent in a location with jumping turned off (none ship that way today:
  check with a test manifest if needed) and on a desktop with no touch screen.

**Gamepad (Xbox or PlayStation, standard mapping)**

- [ ] Left stick moves, right stick looks.
- [ ] A / Cross jumps once per press; holding does not repeat.
- [ ] X / Square interacts with whatever has focus.
- [ ] Unplugging the pad mid-play leaves nothing stuck.

**Sound** (where `sfx.player.jump` / `sfx.player.land` audio has been assigned in Django Admin)

- [ ] A jump plays the jump sound; landing from a jump or a barrel plays the landing sound;
  walking down a small step is silent. With no audio assigned, jumping works silently.
