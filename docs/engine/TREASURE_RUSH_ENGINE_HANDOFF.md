# Treasure Rush: Game Engine Core reference migration handoff

- **Status:** Audit and handoff (development only). Nothing here is merged, accepted or deployed.
- **Branch:** `feature/treasure-rush-palm-trees` (PR #36, open), audited at `420f1afd`.
- **Audience:** the engine lead (`core/gameengine`) and the scoring lead (`core/ge-scoring`,
  Trello GE-100). Scoring detail is in
  [TREASURE_RUSH_SCORING_INVENTORY.md](TREASURE_RUSH_SCORING_INVENTORY.md).
- **Last reviewed:** 2026-11-18.
- **Governing rules:** [CLAUDE.md](../../CLAUDE.md) sections 19 and 20 (ADR-020, ADR-033),
  `AGENTS.md` and `docs/adventures/jumping-standard.md` on `origin/main` (ADR-072).

Treasure Rush (Treasure Cove, region `treasure-rush-cove`) is the first adventure to move onto
the unified Game Engine Core. This document records what the shared runtime already does,
what Treasure Rush depends on, what must not regress, and what belongs in the engine versus in
Treasure Rush content.

## 1. Where the engine stands today

1. **One shared runtime already exists.** `createLocationEngine`
   (`react/src/features/island-map/three/runtime/createLocationEngine.ts:389`) drives every
   Three.js location: the six source manifests in `runtime/manifests/` and every Django-served
   region (Treasure Cove, Firepeak) through `features/region-play/regionManifestRepository.ts`.
   The only route is `react/src/routes/LocationWorldPage.tsx:109`, which renders
   `ThreeLocationWorldView`. The engine core is extraction and hardening of this runtime, not a
   rewrite.
2. **The movement stack is not on `main`.** Jumping, gravity, platforms, the third-person
   camera, the avatar, running and the collision footprint exist only on the stacked, unmerged
   branches PR #26, then #27, #28, #29, #37, and finally #36 (this branch). `core/gameengine` is
   built on `5b300e30` = `main` 8bd19fb7 + this branch at 420f1afd (engine lead, 2026-11-18),
   so it has all of it. Firepeak and North Pole are also based on 420f1afd.
3. **ADR numbering collision.** These branches call the jump decision ADR-055, while `main`
   uses ADR-055 for the native dev environment. The owner reserved ADR-063 for the jump
   decision at PR #26 merge. `core/gameengine` already applied that renumbering on its own
   branch. This branch is unchanged until PR #26 merges.

## 2. Reusable implementation locations

Paths are under `react/src/features/island-map/three/`. "Pure" means no DOM, React, Django
client or AWS import.

| Capability | Files and entry points | Pure? | Consumers |
|---|---|---|---|
| Movement controller | `firstPersonController.ts` (`FirstPersonController` :185, `MoveInput` :57, `Gait` :72, `MovementEvent` :84) | Yes | Every location; `sandboxScene.ts` |
| Gaits | `locomotionConfiguration.ts` (`DEFAULT_LOCOMOTION` :43, `resolveLocomotion` :77, `targetSpeed` :110) | Yes | Every location |
| Jumping | `jumpConfiguration.ts` (`DEFAULT_JUMP_CONFIGURATION` :48, `resolveJumpConfiguration` :104, `validateMovementSpec` :137) | Yes | Every location (Castle overrides `jumpHeight` 0.9) |
| Footprint | `playerCollision.ts` (`DEFAULT_PLAYER_COLLISION` :36, `resolvePlayerCollision` :55) | Yes | Every location |
| Camera | `playerCamera.ts` (`PlayerCameraController` :153, `colliderObstruction` :386), `cameraHeightFollower.ts` :31, `playerPresentation.ts` (`resolvePlayerCamera` :124) | Yes | Every location |
| Camera preference | `cameraPreference.ts` (localStorage `lai:camera-mode:<childId>`) | Browser adapter | Every location |
| Avatar | `playerAvatar.ts` (`createPlayerAvatar` :221, `AvatarFacing` :87) | No (imports `child-profile`, `npc-manager`, `avatarAppearance` at :15-17) | Every location |
| Animation | `playerAnimation.ts` (`playerAnimationState` :52, `createPlayerAnimationController` :199, `withoutRootMotionFor` :303), `playerAvatarCatalog.ts`, `assets/animationVocabulary.ts` | No (`npc-manager/contracts/vocabulary` at :11) | Every location |
| Platforms | `platforms/platformSystem.ts` (`PlatformSystem` :120), `platformSpec.ts` (`validatePlatforming` :219, `applyTuning` :416), `platformMotion.ts`, `platformPresentation.ts`, `platformCopy.ts` | Yes except `../../worldObjects` | Pirate's Leap only so far |
| Input | `gamepadInput.ts` (`GamepadReader` :101, pure), `pointerControls.ts` (`attachPointerControls` :122, DOM adapter injected through `deps.attachControls`) | Gamepad yes; pointer is the browser adapter | Every location |
| Derived colliders | `runtime/derivedColliders.ts` (`derivedColliders` :290, `footprintFor` :88), `runtime/collisionProfile.ts` (`parseCollisionProfile` :36), `runtime/sceneLayout.ts` (`solidColliders` :418, `boundaryWallRects` :66, `triggerVolumes` :512) | Mostly; asset ids hard-coded (section 6) | Every location; Asset Manager preview |
| Asset resolution | `assets/assetResolver.ts` (`AssetResolver` :62), `assets/assetLoader.ts` (`createAssetLoader` :154), `assets/cloneAsset.ts`; Django side `react/src/api/assets/djangoAssetResolver.ts`, `features/region-play/regionAssets.ts:45` | Yes, guarded `window.location` | Every location, NPC loader, avatar source |
| Triggers | `runtime/worldTriggerTracker.ts` (`WorldTriggerTracker` :28; zones, approach 2.5 m, focus) | Yes | Every location |
| Event bus | `worldEngineEvents.ts` (`WorldEngineEventMap` :23, `WorldEngineEventBus` :106) | Yes | View, Treasure Rush audio, Castle extensions |
| Extension points | `runtime/extensionRegistry.ts` (`WorldExtension` :151, context :36), `runtime/viewExtensionRegistry.tsx` (`LocationViewExtension` :96) | Scene half yes; view half React | All five extensions |
| Test harness | `runtime/testing/engineHarness.ts` (`mount` :74: fake renderer, manual clock, `drive`, event capture) | Yes | Engine tests |
| Collision debug | `runtime/collisionDebug.ts` (dev only, `?collisionDebug=1`) | No (DOM label) | Dev builds |

The engine lead's plan (2026-11-18): the pure movement and input modules and
`worldEngineEvents` move into `game/src/` (`@lai/game-engine`, ADR-020), with re-export shims
at their old paths. `createLocationEngine`, `derivedColliders`, `collisionProfile`,
`platforms/*`, `playerAvatar` and `playerCamera` stay where they are and gain engine ports.
**Treasure Rush will not change the moved modules on this branch without telling the engine
lead first. Fixes go to the engine lead, who applies them in `game/`.**

## 3. Required movement capabilities

These are the behaviours Treasure Cove relies on. Each is covered by tests, listed in
section 7.

| Behaviour | Value or rule | Source |
|---|---|---|
| Physics substep | 1/120 s; frame capped at 0.1 s | `firstPersonController.ts:159`, `createLocationEngine.ts:340` |
| Gaits | walk 4, run 5.5, sprint 6.5 m/s; acceleration 20, deceleration 25; gait easing 8/10; walk ≤ run ≤ sprint | `locomotionConfiguration.ts:43-94` |
| Run threshold | analog deflection above 0.8 runs; keyboard always walks | `:99-124` |
| Gait from distance covered | a blocked child reads as idle; wall slide reads as walking; platform carry is not walking | `firstPersonController.ts:221, 305, 517-527` |
| Jump | height 1.2 m, gravity 22, air control 0.65, max fall 18, coyote 120 ms, buffer 150 ms, no double jump | `jumpConfiguration.ts:48` |
| Edge-triggered jump | one jump per press; held input never repeats | `firstPersonController.ts:360` |
| Head bumps | only jumpable undersides stop the rise; solids block at every height | `:630-636, 798` |
| Step-up | 0.25 m walked up; supports chosen feet first | `:160, 666` |
| Recovery | NaN, below -10 m, or out of bounds returns to the last safe ground or checkpoint; moving, vanishing and bounce platforms are never safe ground | `:562, 823`; `platforms/platformSystem.ts` |
| Placement | `teleportTo` checks colliders; `teleport` does not | `:382, 482` |
| Facing | yaw 0 faces +Z, right is -X | `:401-405` (fix 294e519d) |
| Running jumps | carry momentum (a walking jump clears 2.5 m; Pirate's Leap gaps are 0.6 to 1.2 m) | `firstPersonController.running.test.ts` |
| Input reset | on blur, hidden tab, and any opened panel | `pointerControls.ts`, `ThreeLocationWorldView.tsx:421` |
| Controls | WASD/arrows, Space jump, E/Enter interact, V camera, Shift sprint (hold or toggle); touch: left half moves, right half looks, Jump button; gamepad A jump, X interact, Y camera, L3 sprint | `pointerControls.ts`, `gamepadInput.ts:35-42` |

## 4. Required camera and animation behaviour

**Camera** (`playerCamera.ts`, `playerPresentation.ts:70`)

- Third person by default with a first-person option, remembered per child in the browser.
  Distance 4 (1.5 to 6), height offset 1.5, follow damping 12, base FOV 70°, first-person eye
  height 1.6.
- Occlusion pulls the camera in front of a collider at once and eases back out. A box containing
  the pivot is ignored.
- **Boundary walls never obstruct the camera** (`SolidCollider.boundary`,
  `createLocationEngine.ts:477`). This is the 420f1afd fix.
- **Boom lift over a wall behind the child:** triggers at 3 m of room, may go to -1.45 rad,
  falls back to the boom with the most room instead of none, and is speed-capped
  (`playerCamera.ts:297-334`). This is the 420f1afd fix; without it, backing into the cove's
  north wall left the child walking off screen.
- Aiming is measured from the child, never from the camera. The camera never moves the player.
  Moves over 3 m snap instead of easing.
- Reduced motion: slower easing, no sprint FOV boost, no landing dip (dip at most 0.07 m
  otherwise).

**Avatar and animation** (`playerAvatar.ts`, `playerAnimation.ts`)

- Model order: location costume, then published model, then bundled model, then a placeholder in
  the child's colours. A load failure keeps the placeholder.
- The avatar only mirrors the controller position (`createLocationEngine.ts:1556-1567`).
- **Root motion is removed, including skeleton root bones** (Mixamo `mixamorigHips`), keeping the
  vertical bob, with CUBICSPLINE handled and cached clips never mutated
  (`withoutRootMotionFor`). Before bc18a083 the body drifted up to 1.5 m from the controller.
- Animation follows `locomotionSpeed`, so a blocked child idles. States Idle, Walk, Run, Jump,
  Fall and Land; a missing Run clip falls back to Walk at a bounded speed; a missing jump clip
  keeps walk or idle in the air.
- Recoloured materials are cloned, so the shared asset cache is never mutated.

## 5. Asset collision requirements

- **Footprint:** a vertical cylinder of radius 0.35 m plus 0.02 m skin (limits 0.15 to 0.6 and 0
  to 0.1), the same in both perspectives, overridable per location as `movement.collision`
  (ADR-060, Reserved on `main`, Proposed on this branch). Collision is circle against
  axis-aligned box, resolved per axis (wall slide), in 0.1 m substeps (no tunnelling), with
  flush stops by bisection (no walk/idle flicker). A child spawned overlapping a box can always
  move away.
- **Solid by default.** A collider blocks at every height unless authored `jumpable` with
  `minY`/`maxY`. Gates (colliders with `requirements`) are never jumpable.
- **Derived colliders:** every placed scenery item, prop or NPC whose asset has a footprint gets
  a box; long pieces are split into segments; a piece up to 1.2 m tall becomes jumpable; an
  authored collider wins; a piece over a checkpoint, entrance or walkable tile is dropped.
- **Collision profiles** (Asset Manager, `runtime/collisionProfile.ts`): SOLID, JUMPABLE,
  WALKABLE and DECORATIVE; at most 32 boxes; extent at most 200. A staff profile replaces the
  built-in footprint. An empty box list never blocks. Profiles arriving mid-visit rebuild only
  derived boxes and never add one where the child stands (`createLocationEngine.ts:668-696`).
- **Treasure Cove's authored colliders** that must keep working: the channel colliders leave a
  bridge gap of exactly 3.2 m (`BRIDGE_HALF_WIDTH` mirrors `treasure_cove_layout.py`), the ruins
  gate, the boundary walls, the campfire (`CYLINDER`, SOLID, r 0.55 m, h 0.45 m, never jumpable;
  layout collider 1.2 m square), the decorative feather, and the Pirate's Leap course, which
  must stay clear of every palm, prop, plant and collider (enforced by a test).
- **Engine quirk to keep or deliberately fix:** a solid box with `min.y > 0` is ignored entirely
  (`firstPersonController.ts:798`); derived solids are extended down to y -1 to compensate
  (`runtime/derivedColliders.ts:331`). Changing either side alone would open holes.

## 6. Engine versus Treasure Rush content

### 6.1 Extract into the shared engine (or keep shared, behind engine ports)

- Everything in section 2.
- **The region-play host**, which is already generic and data-driven: `regionPlayState.ts`,
  `useRegionPlay.ts`, `usePlayerProgress.ts`, `useAdventureLaunch.ts`,
  `regionPlayInteractions.ts`, `regionManifest.ts`, `sceneModel.ts`, `regionLayout.ts`,
  `regionManifestRepository.ts`, `regionRepositoryForChild.ts`, `regionAssets.ts`,
  `instancedModels.ts`, `areaStandIns.ts`, `api/play/*`, and the UI panels `GameDialog`,
  `RewardReveal`, `BackpackPanel`, `SoundPanel`, `LaunchDialog`, `AdventureLaunchChoices`,
  `ReplayDonePanel` and `ChestChallengePanel` (generic flow, Treasure Rush wording through
  `PLAY_COPY`). This is a gameplay layer, not engine: per ADR-020 it stays React and talks to
  the engine only through events and the extension API. It is listed here because other
  region-play adventures (Firepeak, North Pole) share it.
- `PipDialog` is the generic NPC dialog (Firepeak's Ember uses it). Rename it when the split
  happens; do not fork it.

### 6.2 Treasure Rush content that stays outside the engine

- The layout and seeds: `lai/apps/regions/treasure_cove_layout.py` and `.json`,
  `treasure_cove_vegetation.py`, `treasure_rush_seed.py`, `pips_treasure_seed.py`,
  `pirates_leap_seed.py` (CLAUDE.md section 20: Treasure Cove's layout stays in Django seeds
  until the LAI-0805 ADR).
- Cove art: `extensions/regionPlay/proceduralScenery.ts`, `livingCove.ts`.
- Audio wiring: `features/region-play/audio/treasureRushSounds.ts`, `treasureRushMusic.ts`,
  `lai/apps/audio/treasure_rush_cues.py`. The zone, emitter and music mechanism in
  `useTreasureRushAudio.ts` is generic; its `cove-zone-*` ids, `LOOKOUT_ZONE` and
  `ambient.treasure_rush.*` scope are content.
- Copy: Pip, coins, rune, Lookout and bridge strings in `PLAY_COPY` (`regionPlayUi.ts:18-71`).
- Pip content: `lai/apps/npcs/pip_content.py`, `seed_npc_pip`.

### 6.3 Mixed modules that need a split (Treasure Rush owns the split)

| Module | Generic part | Treasure Rush part |
|---|---|---|
| `regionPlayConfig.ts` | parser | `PROCEDURAL_SHAPES` cove art (`BROKEN_PLANKS`, `BRIDGE`, `LANTERNS`, `SPYGLASS`, :150-165); `unlock` shaped on the gate and bridge |
| `pickupLook.ts` | look-by-id mechanism | feather, shell and key regex table (:31) |
| `soundCues.ts` | sink pattern | cue names `stoneRight`, `bridgeOpen`, `keyPickup` |
| `regionPlayUi.ts` | challenge flow, hints | `PLAY_COPY` cove copy; `nextStepHint` special-cases REPLAY as the spyglass (:299-303); coin pictures |
| `RegionPlayCompanion.tsx` | orchestration | rune numbers and puzzle music, `replayIds`, unlock toast and `bridgeOpen`, `nextClue`, Pip naming, Firepeak's return-to-NPC with Ember copy |
| `regionPlayScene.ts` | chest, beacon, instancing, NPC proxy | key, rune stones, pickup primitives, gate and bridge unlock, campfire model |
| `areaPuzzleUi.ts` | puzzle kinds | `AREA_COPY` hard-codes "Professor Ember" (:19, 45) |

### 6.4 Treasure Rush content that has leaked into shared modules

These must become data before the engine package can be content-free:

- `runtime/derivedColliders.ts:49-69` `ASSET_FOOTPRINTS` names `treasure-chest` and
  `wonder-stone-*`; `DEFAULT_WALKABLE_ASSETS` :246.
- `worldEngineEvents.ts:15` `SANDBOX_NPC_ID = 'pirate-pip'`.
- `features/npc-manager/dialogue/triggers.ts:32`
  `ADVENTURE_COMPLETE_CHANGE_KEYS = ['TREASURE_COVE_QUEST_COMPLETE']`.
- `runtime/testing/engineHarness.ts:253` `pipChildHeights` (test helper).

## 7. Known defects and regression tests

### 7.1 Fixed on this branch, owner QA outstanding

| Defect | Fix | Regression tests |
|---|---|---|
| Third-person avatar drifts from the camera when blocked (P0, Trello 139) | bc18a083: skeleton root motion pinned, gait from distance covered, flush stops, boom lift | `avatarSync.test.ts`, `runtime/avatarSync.engine.test.ts` (`runtime/testing/rootMotionRig.ts`) |
| Wall penetration; Castle walls (P0, Trello 140) | e50fd17f: cylindrical footprint, costume racks moved | `playerFootprint.test.ts`, `runtime/playerFootprint.engine.test.ts`, `runtime/collisionDebug.test.ts` |
| Camera loses the child at tall walls (owner QA 2026-11-15) | 420f1afd: boom lift rework; boundary walls ignored by the camera | `avatarSync.test.ts`, `extensions/regionPlay/treasureCoveThirdPerson.engine.test.ts` |
| Signpost launch loops start requests forever (owner QA 2026-11-15) | 420f1afd: `useDjangoAdventureSession` memoizes its default client | `DjangoAdventureRunner.defaultApi.test.tsx` |
| Feather drawn as a key (P1, Trello 142) | 9c87ee34: `pickupLook.ts` | `pickupLook.test.ts`, `pickups.engine.test.ts` |
| Campfire model (P1, Trello 141) | fd2d144f | `campfire.engine.test.ts`, `test_gameplay_prop_packs.py` |
| **Pirate's Leap riddle bridge does not rise until the child re-enters** (found by this audit) | This branch, 2026-11-18: `RegionPlayCompanion` now calls `refreshWorld()` once when the server reports new world changes during the visit, so the view raises `world:<key>` platform signals at once | `RegionPlayCompanion.test.tsx` "re-reads the shared world once when the server records a change mid-visit" (fails without the fix) and "does not re-read the world for changes the child already had on arrival" |

### 7.2 Open engine defects for the engine lead

Not fixed on this branch, because these files are being extracted on `core/gameengine`:

1. `removeCollider` for an authored id leaves the box in the jumpable set and in `solids`
   (`createLocationEngine.ts:620-625`).
2. Colliders added through the extension `addCollider` have no id, so `removeCollider` cannot
   remove them.
3. The extension context's `isBlocked` is a point-in-box test that ignores the footprint and
   height (`:1342`); `teleportPlayer` skips collision checks (`:1372`).
4. The view calls handle members optionally (`engineRef.current?.setSprintMode?.`,
   `signalPlatforms?.`), so the handle type is not trusted. A versioned engine-to-game contract
   should make these required.
5. Camera occlusion tests colliders, not meshes. A tree with no collider can come between the
   camera and the child (`docs/PLAYER_AVATAR_AND_CAMERA.md:240`).
6. Ground is flat everywhere (`groundHeightAt`), and collision is axis-aligned boxes only.
7. `docs/PLAYER_MOVEMENT_AND_JUMPING.md:164-175` still says "no running" and "player is a point
   in x/z". It is stale; the engine docs should replace it.

### 7.3 Open Treasure Rush gameplay defects

1. **Clues with two Pip quests.** `nextClue` (`RegionPlayCompanion.tsx:596`) and `nextStepHint`
   (`regionPlayUi.ts:291`) pick the first unopened chest by `sort_order` (Pip's chests 0 to 5,
   Pirate's Leap 10 and 11), not by the active quest. `PipDialog` prefers an AVAILABLE quest
   over the ACTIVE one (`PipDialog.tsx:63-66`), and `questObjective` shows only the first ACTIVE
   quest (`regionPlayUi.ts:239`). With Pirate's Leap active, the hint can name a Pip's Treasure
   chest. A fix needs a product decision on which quest's clue wins. Not changed.
2. `GET regions/{id}/` is called twice per entry (the manifest repository and `useRegionPlay`).
3. `durationMs` is never sent with answers, and the session is never paused or closed on exit.
   Both are allowed, but they are gaps for scoring.
4. Django marks `sfx.player.*` and `sfx.platform.*` cues as `wired=False`
   (`treasure_rush_cues.py:93-125`), but React plays them.

### 7.4 Regression test baseline (2026-11-18, this branch)

- Vitest, by path: `src/features/island-map/three`, `src/features/region-play`,
  `src/features/npc-manager`, `src/audio`, `src/api/play`. Result: **221 files, 2,895 tests
  passed**. With this branch's fix, `RegionPlayCompanion.test.tsx` has 61 passing tests (2 new).
- pytest on PostgreSQL 16, by path: `lai/apps/game_sessions`, `regions`, `quests`, `inventory`,
  `progression`, `npcs`, `education`, `audio/tests/test_treasure_rush_seed.py`,
  `assets/tests/test_gameplay_prop_packs.py`. Result: **1,060 passed** at 420f1afd. With this
  branch's authorization tests, `test_play_api.py` has 37 passing tests (1 new test; the route
  matrix also gained the pickup, talk and puzzle routes). Without a reachable database these
  tests skip, which is not a pass.
- Playwright (`react/e2e/acceptance/treasure-rush.spec.ts`) exists but was not run (policy). It
  does not cover Pirate's Leap, the campfire, feather or shell pickups, the signpost launch or
  sound.

## 8. Gameplay behaviour baseline (regression requirements)

Every item must behave the same after migration. Test files are the guard.

| Area | Required behaviour | Guards |
|---|---|---|
| Entry and resume | Place page, then `/island/:childId/explore/treasure-rush-cove`. The scene is rebuilt from server state: opened chests drawn open, collected pickups omitted, unlocks from world changes. No re-celebration on resume. One open session per child and region (201 new, 200 resume) | `useRegionPlay.test.tsx`, `treasureCoveView.test.tsx`, `test_play_api.py` |
| Island layout | Layout version, zones (landing, beach, grove, ruins, Lookout Point), 43 palms, 37 barrels and logs, 138 nature placements, boundary walls, spawn | `treasureCoveLayout.engine.test.ts`, `test_treasure_cove_layout.py`, `proceduralScenery.test.ts` |
| Palm trees and uploaded assets | 18 Asset Library ids in the cove catalogue, published v1, delivery bytes match SHA-256; primitive fallback when unpublished or broken | `test_model_packs.py`, `test_gameplay_prop_packs.py`, `regionAssets.test.ts`, `instancedModels` tests |
| Avatar, third person, jumping, collision | Sections 3 to 5 | Section 7 tests; `firstPersonController*.test.ts`, `runtime/thirdPerson.engine.test.ts`, `runtime/jumpIntegration.engine.test.ts`, `runtime/runningIntegration.engine.test.ts` |
| Chests | Touch a closed chest; the server issues one challenge (bank first, then the band's generator); answer by choice or number; the server grades; the lid opens only on the server's yes; wrong answers are encouraged and retried; locked, hidden, not-ready and already-open states | `RegionPlayCompanion.test.tsx`, `test_chest_play.py`, `pipsTreasure.engine.test.ts` |
| Pip's Missing Treasure | Landing chest, hidden grove chest, brass key, key-locked beach chest, ruins pedestal (touch the rune stones), golden chest, return to Pip; gate and bridge open; Lookout spyglass replay | `pipsTreasure.test.ts`, `test_pips_treasure.py`, `lookoutPoint.engine.test.ts` |
| Pirate's Leap | Six sections, four checkpoints, water pools, every section walkable without a jump, riddle drum raises a plank bridge during the visit, crow's-nest treasure, shell and feather pickups, recovery to the checkpoint | `piratesLeap.engine.test.ts`, `test_pirates_leap.py`, `RegionPlayCompanion.test.tsx` (riddle bridge refresh) |
| NPC interactions | Exactly one Pip; managed dialogue through the NPC Manager; quest offer and accept only on the child's yes; talk reported to the server | `RegionPlayCompanion.npc.test.tsx`, `test_treasure_pip_seed.py`, `test_runtime_api.py` |
| Sound and music | Zones, SFX, positional cues, explore, puzzle and victory music, mute through the Sound Manager, silent fallback | `treasureRushAudio.test.tsx`, `test_treasure_rush_seed.py` |
| Learning questions | Question Studio pools by age band; answers never sent to the client; server-only grading; evidence per answer | `test_gameplay.py` (question_studio), `test_challenges.py` |
| Saved progress | `WorldChange`, `GrantedRule`, `InventoryItem`, `QuestProgress`, `ChallengeAttempt`, `SkillEvidence` rows keep meaning and constraints; no progress blob | [Scoring inventory](TREASURE_RUSH_SCORING_INVENTORY.md) section 2 |
| Exit | "Go back to the harbor" with no arithmetic gate; Backpack, Hint and Exit visible in full screen | `treasureCoveView.test.tsx`; Playwright controls suite (not run) |
| No play-time limit | The companion never ends a session for time (ADR-053) | `RegionPlayCompanion.test.tsx` "never ends the session because of play time" |

## 9. Adventure lifecycle requirements for the engine

1. **Create:** `createLocationEngine(parent, bus, manifest, options, deps)`. Options include the
   start checkpoint, world state, quality, reduced motion, camera mode, avatar and sprint mode.
   `ready` settles when every asset load finishes or fails, and a failure never blocks play.
2. **Spawn:** today it comes from the global checkpoint catalogue in `features/discovery`
   (`resolveSpawnCheckpoint`, `ALL_CHECKPOINTS`), which `regionManifestRepository.ts:111`
   mutates through `publishRegionCheckpoints`. The engine should take spawn points from the
   manifest or options instead (blocker 2 in the engine audit).
3. **Frame order** must be preserved: platforms, controls, controller events, camera, gait and
   footsteps, avatar, debug, mixers, extension `onFrame`, focus and triggers, render
   (`createLocationEngine.ts:1470-1598`). Platforms move before the player.
4. **Game to engine:** `QuestStateChanged`, `WorldStateChanged`, `InventoryChanged`,
   `NpcStateChanged`, plus `signalPlatforms('world:<key>')`, which Treasure Rush needs for
   Pirate's Leap's riddle bridge.
5. **Engine to game:** zone enter/leave, `ObjectInteracted`, `InteractableFocused`,
   `NpcApproached`, `CollectiblePickedUp`, jump, land, gait, footstep, recovery, platform,
   plate, bounce, checkpoint and goal events. The engine never grades, grants or calls AI
   (ADR-020). Treasure Rush's companion turns claimed interactions into typed play calls.
6. **Pause:** no pause API exists; `resetInput` on panel open is the only pause. Treasure Rush
   needs input suspended while any panel is open, and nothing more. There must be no time limit
   (ADR-053).
7. **Dispose:** cancels the frame and disposes controls, avatar, extension mounts, platforms and
   owned geometry, then the renderer. It never disposes cached glTF assets. The React host
   disposes on unmount or when `childId:regionId` changes. Refreshing the world snapshot during
   a visit must not rebuild the engine (Treasure Rush relies on this; see 7.1).
8. **Save:** the engine saves nothing. Every save is a server call from the gameplay layer with
   a natural-key idempotency (201/200, 409 conflicts, one-time grants).

## 10. Migration plan for Treasure Rush (incremental, after the SDK is stable)

Treasure Rush migrates only once the engine lead publishes a stable SDK and compatibility
contract. Each step is one commit with its own regression tests, and never combines a backend
domain change with an engine change (CLAUDE.md section 19).

1. **Contract tests first.** Add Treasure-Cove-level contract tests against the SDK's typed
   engine-to-game contract: every event in section 9 that Treasure Rush consumes, and every
   handle member it calls. These must pass on the shims before anything moves.
2. **Imports.** Point Treasure Rush imports at `@lai/game-engine` instead of the shims. No
   behaviour change; the full section 7.4 suite must be unchanged.
3. **Content out of the engine.** Move the leaked content in 6.4 into Treasure Rush or Django
   data (footprints into the Asset Manager collision profiles; the adventure-complete change key
   into NPC content), with tests on both sides.
4. **Split the mixed modules** in 6.3 into a generic region-play host and Treasure Rush
   content, one module per commit.
5. **Spawn from the manifest** once the engine accepts spawn points (9.2), keeping saved
   `last_checkpoint_id` values valid.
6. **Scoring adapter** once GE-100 publishes its contract: Treasure Rush emits nothing new.
   The scoring collectors read existing rows (see the scoring inventory).

Do not delete or rewrite movement, collision, camera or animation code in Treasure Rush at any
step. Treasure Rush consumes the engine's.

## 11. Trello reconciliation (2026-11-18)

| Card | Board state | Code state on this branch | Action |
|---|---|---|---|
| P0 avatar drift (139) | Development Complete | bc18a083 present; tests pass | None; owner QA outstanding |
| P0 collision footprint (140) | Development Complete | e50fd17f present | None; owner QA outstanding |
| P1 campfire (141) | Development Complete | fd2d144f present; the owner's import has not been run | None; owner import and QA outstanding |
| P1 feather as key (142) | Development Complete | 9c87ee34 present; the model is CC-BY-4.0, not CC0 | Owner licence decision outstanding |
| Environment assets (137) | Development Complete | Licence commits 11998bf1 and 355af40 present | TR-NAT-04, -05 and -09 (rocks, ferns, coconuts) not supplied; the owner's asset folder holds no new models |
| LAI-JMP-03 Pirate's Leap (111) | Development Complete | cab4982 to 197a9af present; riddle bridge defect fixed here | Comment added with the fix |
| Treasure Rush Expansion (124) | Backlog | **TR-10 is done** (roadmap section 16, `regionAssets.ts`). **TR-19 sound is implemented** through the Sound Manager (`useTreasureRushAudio`, `seed_treasure_rush_sound`, `SoundPanel`), apart from browser-audible validation. TR-D27, the key and pedestal art and Pip's Cheer/Point clips are still open | The card overstates what is deferred; comment added |
| Camera at tall walls and signpost loop (420f1afd) | **No card** | Fixed and tested | Recorded on the migration card |
| `docs/TREASURE_RUSH_ROADMAP.md` (status 2026-11-02) and `TREASURE_RUSH_PLAYTEST_CHECKLIST.md` ("Sound: there is none yet") | n/a | Stale | Recorded here; not rewritten in this change |

## 12. Open decisions and risks

- **Scoring versus the scoring standard.** GE-100 asks for XP, coins, levels and stars;
  ADR-011, ADR-013, TR-D1 and the mandatory scoring standard (ADR-072) prohibit them. The scoring
  lead is drafting an ADR for owner decision, with the economy off by default. Treasure Rush
  builds no ledger or XP.
- **Feather licence** (CC-BY-4.0 versus the requested CC0): owner decision.
- **Missing art:** rocks, ferns, coconuts, `treasure-key`, the pedestal, bridge and lantern
  models, and Pip's Cheer and Point clips. Every one has a working fallback.
- **Merge order:** Treasure Rush (the PR #26 to #36 stack), then Firepeak's shared work, then
  North Pole. `core/gameengine` depends on the same stack.
- **Owner QA** of every movement, camera, campfire, feather and Pirate's Leap item is outstanding.
  Nothing here has been seen in a browser, on a device or with a gamepad.
