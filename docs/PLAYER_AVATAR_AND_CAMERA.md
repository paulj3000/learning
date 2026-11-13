# Player Avatar, Camera and Animation (LAI-JMP-01a)

Status: development complete on `feature/third-person-avatar`; unit-tested only. Not yet seen
in a browser, on a touch device or with a gamepad (see "Owner QA checklist"). Decision record:
ADR-056 in `docs/DECISIONS.md`.

**Depends on LAI-JMP-01** (`feature/shared-jump-controller`, PR #26), which was not merged
when this branch was made. This branch is built on it; merge PR #26 first.

Children can now play every free-roaming 3D adventure in **third-person**, seeing their own
explorer walk, turn, jump and land, or switch back to the original **first-person** view at any
time. Third-person is the default; the child's choice is remembered.

## Shared player architecture

Four separate pieces, each shared by every 3D location. None of them is per adventure.

```text
                       ┌──────────────────────────┐
 Keyboard / mouse ─┐   │ FirstPersonController    │  authoritative: position, velocity,
 Touch drags     ──┼──>│ (LAI-JMP-01, unchanged   │  jump, gravity, collisions, gates,
 Gamepad         ──┘   │  physics)                │  yaw/pitch = where the camera looks
 HUD buttons ────────> └────────────┬─────────────┘
                                    │ read every frame (never written back)
            ┌───────────────────────┼─────────────────────────┐
            v                       v                         v
 PlayerCameraController     PlayerAvatar renderer      PlayerAnimationController
 (playerCamera.ts)          (playerAvatar.ts)          (playerAnimation.ts, over the
 first- or third-person,    model or placeholder,      NPC Manager's animator)
 follow, collision,         feet on the controller,    idle/walk/jump/land/interact,
 aim origin for focus       faces its velocity          speed-matched, no root motion
```

| Piece | File (under `react/src/features/island-map/three/`) | Owns |
|---|---|---|
| Movement controller | `firstPersonController.ts` | Everything about where the player is and what they hit. Only new API: read-only `horizontalVelocity` and `walkSpeed`. |
| Camera controller | `playerCamera.ts` | Both perspectives; third-person follow, orbit, obstruction, ceiling and ground limits; the point interactions are aimed from. |
| Avatar renderer | `playerAvatar.ts` | Which model, the placeholder, pose sync, facing, disposal. |
| Animation controller | `playerAnimation.ts` | Movement state to clip, crossfades (via `createNpcAnimator`), walk speed matching, interact gesture, root-motion stripping. |
| Configuration | `playerPresentation.ts` | `PlayerCameraConfiguration`, `PlayerAvatarConfiguration`, defaults, limits, validation. |
| Preference | `cameraPreference.ts` | The child's chosen perspective, remembered per child in this browser. |
| Wiring | `runtime/createLocationEngine.ts` | Builds all of the above from the manifest; `cameraMode()`, `setCameraMode()`, `toggleCameraMode()`, `camera`, `avatar`. |
| HUD | `WorldHud.tsx`, `runtime/ThreeLocationWorldView.tsx` | Camera-view button, "Camera view" setting, preference load/save. |

Rules that keep it safe:

- **The controller is the only authority on movement.** The camera and avatar read it; nothing
  they do changes position, collision, gates or progress.
- **Camera-relative movement comes free:** the controller's `yaw` is the camera heading in both
  modes, so W walks away from the camera and S walks toward it.
- **Animations carry no root motion** (`withoutRootMotion`), so a clip can never move the avatar
  off the controller's position.
- **Interactions are aimed from the player,** never from the third-person camera. The ray starts
  at the follow point over the avatar's head and runs along the view, which is the line the
  screen-centre reticle sits on. Reach (4 m) is measured from the child. In first-person the
  ray is exactly the old one from the eye.

## Camera perspectives

**Third-person (default).** The camera orbits a follow point 1.5 m above the feet (just over the
avatar's head), 4 m back, looking at it. Mouse, touch drag and the right stick turn it around the
child; pitch is held between looking well down and slightly up so the orbit never goes under
the ground. The follow point eases after the child (tighter sideways than vertically, so jumps
do not lurch). The camera:

- is pulled in front of any solid collider between it and the follow point **on the same
  frame**, so it never shows through a wall;
- eases back out (about a quarter of a second, slower with reduced motion) when the way clears;
- comes right up to the child's shoulder, and hides the avatar, when they stand flush against a
  wall, rather than entering the wall;
- stays under a location's ceiling (`maxHeight`) and above the ground.

It uses the same live collider list the controller walks into, so a door or bridge that an
extension opens stops blocking the camera too.

**First-person.** The original view, unchanged: eye at 1.6 m, step easing and landing dip
(LAI-JMP-01), the avatar hidden.

**Switching.** V on a keyboard, Y / Triangle on a gamepad, the camera-view button on the stage,
or the "Camera view" setting under the stage. Each switch is a clean cut (no swoop). The choice
is saved for the child and used the next time they enter any location that allows switching.

## Avatar rendering

Which model the child is drawn with, in order:

1. the location's `player.avatar.assetKey` (a costume a location needs; validated as a real
   asset);
2. the 3D model registered for the child's `ChildProfile.avatarKey` in
   `PLAYER_AVATAR_ASSET_IDS`;
3. otherwise, and whenever a model fails to load, a **placeholder explorer** built from the
   child's existing avatar choice (`avatarAppearance.ts`): their body and accent colours and
   their ears, antenna, fin or spikes. 1.39 m tall, feet on the ground.

`PLAYER_AVATAR_ASSET_IDS` is **empty today**: no 3D avatar models exist yet, so every child sees
their placeholder (follow-up card LAI-JMP-01c). Nothing is hard-coded to a particular character.

Models load through the location's own loader (`LocationEngineAssets.loadModel`), so the bundled
asset resolver and cache, or the Django asset library for a Django region, are reused. The avatar
root sits at the controller's feet every frame (so it stands on crates and platforms exactly
where the physics put the child) and turns smoothly toward its horizontal velocity, the short way
round; standing still keeps its last facing. On leaving, the placeholder's own geometry and
materials are freed; a loaded model's geometry belongs to the shared cache and is left alone.

## Animation

States from the controller: Idle, Walk, Jump Start, Airborne, Falling, Landing; plus Interact
(a gesture when the child interacts).

| Movement state | Clip played (when the GLB has it) | Without that clip |
|---|---|---|
| Idle | `Idle` | procedural idle bob (NPC animator), none under reduced motion |
| Walk | `Walk`, sped up or slowed to match the walking speed (0.6x to 1.25x) | `Idle` |
| Jump Start / Airborne / Falling | `Jump` | keeps `Walk` or `Idle` (never `Celebrate`) |
| Landing | back to `Walk` or `Idle` | same |
| Interact | `Point`, else `Wave`, once | nothing |

The controller only changes the animator's state when the state changes (no restarting a clip
every frame), and crossfades take 0.2 s. `Run` is in the vocabulary and mapped, ready for a
future run speed; nothing plays it yet. Sprint, swim, climb and emotes would add vocabulary
states and controller states the same way.

## GLB asset preparation

For an avatar model (`kind: 'character'` in the asset manifest, or a character asset in the
Django asset library):

- **Units and pivot:** metres, ground-pivoted (feet at y = 0), facing **+Z**. Use
  `player.avatar.scale` and `rotationOffset` for a model that is not.
- **Height:** about 1.2 to 1.5 m, so the 1.5 m follow point sits just over the head.
- **Clip names** (the closed vocabulary, `assets/animationVocabulary.ts`, mirrored in Django's
  `CLIP_VOCABULARY`): `Idle`, `Walk`, `Jump` (whole jump, or an airborne loop), optionally
  `Run`, `Point`, `Wave`, `Talk`. Rename imported takes to these; generic take names
  (`mixamo.com`, `Action.001`) are rejected by the Django validator.
- **No root motion:** keep the character in place in every clip. Position tracks on the model's
  top-level nodes are stripped at load anyway.
- **No combat or celebration as locomotion.** `Celebrate` is never used as a jump.
- **Rigged models** are cloned with their own skeletons (`cloneAssetScene`), so several children
  never share a pose.
- To make a model a child's avatar: add it to the asset manifest (or publish it in the asset
  library) and add its id to `PLAYER_AVATAR_ASSET_IDS` under the `avatarKey` it represents.

## Adventure configuration

`ThreeLocationManifest.player` (source manifests) or `scene.player` (Django regions), validated
with the rest of the manifest; any field may be left out.

| `player.camera` field | Default | Limits | Meaning |
|---|---|---|---|
| `defaultMode` | `third-person` | `first-person` / `third-person` | The view a child gets unless they chose another. |
| `allowModeSwitch` | `true` | | Whether the child may switch (and whether their saved choice applies). |
| `distance` | 4 | 0.8 to 12 | Third-person distance from the follow point, m. |
| `minDistance` / `maxDistance` | 1.5 / 6 | 0.5 to 15 | Bounds on `distance` (kept in order). The camera may still come closer to avoid a wall. |
| `heightOffset` | 1.5 | 0.5 to 3 | Follow point above the feet, m. |
| `followDamping` | 12 | 1 to 40 | How tightly the camera follows, per second. |
| `rotationSensitivity` | 1 | 0.1 to 4 | Multiplier on mouse, touch and stick look speed. |
| `collisionEnabled` | `true` | | Pull the camera in front of walls. |
| `maxHeight` | none | 1.5 to 50 | Ceiling for the camera, m (indoor locations). |

| `player.avatar` field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Draw the avatar in third-person. |
| `assetKey` | none | A costume every child wears here (must be a real asset). |
| `scale` | 1 | Uniform model scale (0.2 to 5). |
| `rotationOffset` | 0 | Radians added to the model's facing. |

Example (Storykeeper Castle):

```ts
player: {
  camera: { distance: 2.6, minDistance: 1.2, maxDistance: 3.5, heightOffset: 1.45, maxHeight: 2.95 },
},
```

No Django schema change: Django regions carry the block inside their existing `scene` JSON.

## Adventures

| Adventure | Third-person | Camera |
|---|---|---|
| Treasure Cove (Treasure Rush) | **Yes** (default) | Standard outdoor. Engine tests walk landing to ruins with the camera never inside a wall, open the first chest, and fail to pass the closed gate. |
| Storykeeper Castle | **Yes** (default) | Closer indoor camera under the ceilings. Engine test walks through the archway and turns all the way round at eight stops: never inside a wall, never above 2.8 m. |
| Pirate Builder Bay | **Yes** (default) | Standard outdoor. Jumping still cannot cross the broken bridge. |
| Welcome Harbor, Wonderwild Forest, Clockwork Harbor, Dragon's Sanctuary, Firepeak | **Yes** (default) | Standard outdoor; the same shared runtime, no per-location code. |
| Phaser 2D worlds | No | ADR-020: no new features. LAI-JMP-01b covers them after conversion. |

## Controls

| Action | Desktop | Phone / tablet | Gamepad (standard mapping) |
|---|---|---|---|
| Move (camera-relative) | W A S D / arrows | Drag on the left half | Left stick |
| Look / orbit the camera | Mouse (click to lock pointer) | Drag on the right half | Right stick |
| Jump | Space | Jump button | A / Cross |
| Interact | E / Enter, or click the action prompt | Tap the action prompt | X / Square |
| Switch camera view | **V**, or the camera-view button | **Camera-view button** (left of Jump) | **Y / Triangle** |

The gamepad mapping is a `GamepadBindings` object (`gamepadInput.ts`); change one entry to
rebind a button. Move and look drags use separate touches, so a child can walk, turn the camera
and jump at once. The camera-view button sits beside the Jump button on the right edge, clear of
Backpack, Hint and Exit; on narrow portrait phones it shows only its icon. It also appears on
desktops (with a V hint). The same choice is a "Camera view" radio setting under the stage.

## Known limitations

- **No 3D avatar models yet:** every child sees a placeholder in their own colours and
  accessory (LAI-JMP-01c). The child profile has a single `avatarKey`; there is no skin or
  per-part customization data to render.
- **The preference is per browser:** a child switching devices starts in the location default.
  Server sync needs a new child preference field (LAI-JMP-01d).
- **Collision is box-based:** the camera avoids colliders, not visible meshes, so a decorative
  model with no collider (a tree) can come between camera and child.
- **Placeholder has no jump clip:** it uses the NPC animator's gentle procedural bob; a real model
  with `Jump` shows the full Idle, Walk, Jump, Land cycle.
- **Browser acceptance suites** (`e2e/acceptance`) were written in first-person. Their probe drives
  the controller and reads focus from the player, so they should hold, but they have not been
  run on this branch.
- Not yet checked in a browser, on a device or with a gamepad.

## Owner QA checklist

Run `npm run dev`, sign in, open each location. Tick each item.

**Desktop**

- [ ] Treasure Cove opens in third-person: your explorer (in your avatar's colours) stands in
  front of the camera, feet on the sand.
- [ ] W walks away from the camera; S walks toward it and the explorer turns to face you; A/D walk
  sideways; turning is smooth.
- [ ] Space jumps: the explorer leaves the ground, the camera follows without lurching, landing is
  gentle. Jump onto a landing barrel and the explorer stands on top of it.
- [ ] Mouse turns the camera all the way round the explorer.
- [ ] Walk backwards into a ruin wall, a grove boulder and the ruins archway: the camera slides in
  front and never shows through; it eases back out when you move away.
- [ ] Open the first chest and talk to Pip from third-person; the prompt appears at the same
  distance as in first-person.
- [ ] The closed ruins gate still cannot be passed by walking or jumping.
- [ ] V switches to first-person (explorer hidden, original view) and back. Leave and re-enter:
  your last choice is kept. The "Camera view" setting under the stage does the same.
- [ ] Storykeeper Castle: the camera is closer, never goes through walls in the archway, the
  narrow passages or corners, and never above the ceiling even when jumping.
- [ ] Pirate Builder Bay: the broken bridge still cannot be crossed.
- [ ] With "reduce motion" on: no landing dip, gentler camera easing, no idle bob on the explorer.

**Phone and tablet (portrait and landscape)**

- [ ] The camera-view button sits left of Jump and does not cover Jump, Backpack, Hint, Exit or the
  action prompt.
- [ ] Drag left to walk, drag right to turn the camera, tap Jump, all at the same time.
- [ ] The camera-view button switches view; on a narrow phone it shows only its icon.

**Gamepad**

- [ ] Left stick walks relative to the camera, right stick orbits the camera.
- [ ] A / Cross jumps, X / Square interacts, Y / Triangle switches view (once per press).
