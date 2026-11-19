# Game Engine Core: Phase 1 audit

- **Status:** Proposed
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-033, ADR-056, ADR-057, ADR-058, ADR-059, ADR-060, ADR-063 (the last six Reserved on `main`, Proposed on the movement branches)
- **Related tickets:** GE-001, LAI-JMP-01, LAI-JMP-01a, LAI-JMP-01c, LAI-JMP-02, LAI-JMP-04, LAI-2002
- **Canonical sources:** branch heads measured 2026-11-18 after `git fetch`; [jumping standard](../../adventures/jumping-standard.md); [THREEJS_ENGINE_CONVERSION](../../THREEJS_ENGINE_CONVERSION.md); `docs/firepeak/REALM_ENGINE_REQUIREMENTS.md` on `feature/firepeak-volcano-adventure` @ `3e2b513c`

## 1. Branch baseline

| Stream | Branch (head) | Relation to the engine |
|---|---|---|
| Movement stack | `feature/shared-jump-controller` (PR #26) → `feature/third-person-avatar` (#27) → `feature/player-avatar-assets` (#28) → `feature/player-running` (#29) → `integration/p1-movement-base` → `feature/interactive-platforms` (#37) → `feature/treasure-rush-palm-trees` (#36) @ `420f1afd` | **Canonical movement baseline.** Holds the jump controller, camera, avatar, running, platforms, footprint, and the avatar-drift and wall-penetration fixes |
| Firepeak | `feature/firepeak-volcano-adventure` | Contains `420f1afd` |
| North Pole | `feature/north-pole-adventure` | Contains `420f1afd` and Firepeak |
| Pirate's Leap | `feature/pirates-leap` | Contains the platforms branch; Treasure Rush contains every Pirate's Leap commit |
| Storykeeper's Castle | `feature/storykeeper-castle-completion` | Contains the platforms branch, not `420f1afd` |
| Scoring | `core/ge-scoring` | Consumes the engine's gameplay event contracts (GE-100 to GE-110) |
| `main` | `8bd19fb7` | No jump, gravity, platforms, third-person camera or avatar (jumping standard, "Status on 2026-11-18") |

Decision: `core/gameengine` is **stacked on `420f1afd`** and brought up to date with `main`
(merge `5b300e30`), as the jumping standard requires ("new jumping work stacks on them"). It
therefore merges after PR #36.

## 2. Existing engine implementation (on the baseline)

All paths under `react/src/features/island-map/three/` unless noted.

| Area | Implementation | Size (lines) | State |
|---|---|---|---|
| Location runtime | `runtime/createLocationEngine.ts` (one runtime for every 3D location; manifests in `runtime/manifests/`) | 1679 | Live; edited by North Pole and Storykeeper branches |
| Scene kit | `sceneKit.ts` | 211 | Live |
| Movement controller | `firstPersonController.ts`: gravity, jump, coyote time, buffer, air control, step-up, head bumps, cylindrical footprint, sub-stepped collision, escape-only overlap, recovery | 859 | Live, QA'd |
| Jump and gait tuning | `jumpConfiguration.ts`, `locomotionConfiguration.ts`, `playerCollision.ts` | 183, 169, 116 | Live, validated limits |
| Input | `pointerControls.ts` (keyboard, pointer, touch), `gamepadInput.ts` | 313, 166 | Live |
| Camera | `playerCamera.ts`, `cameraHeightFollower.ts`, `cameraPreference.ts`, `playerPresentation.ts` | 403 and others | Live (third-person default, first-person option) |
| Avatar and animation | `playerAvatar.ts`, `playerAnimation.ts`, `playerAvatarCatalog.ts`; root-motion pinning (`withoutRootMotionFor`) | 434, 361, 177 | Live; imports child-profile and NPC Manager feature code |
| Platforms | `platforms/platformSpec.ts`, `platformSystem.ts`, `platformMotion.ts`, `platformPresentation.ts` (static, moving, plates, switches, signals, appearing, vanishing, bounce, turntables) | 466, 563, 165, 215 | Live; imports manifest and world-object types |
| Collision derivation | `runtime/derivedColliders.ts`, `runtime/collisionProfile.ts`, `runtime/collisionDebug.ts` | 337 and others | Live |
| Triggers | `runtime/worldTriggerTracker.ts` | | Live |
| Event bus | `worldEngineEvents.ts` (`WorldEngineEventBus`) | 136 | Live; the Phaser bus `worldEvents.ts` is separate (ADR-008) |
| Assets | `assets/*` (loader, resolver, clone, glTF assembler, manifest, primitives) | | Live |
| Region data | `*Region.ts` (Welcome Harbor, Pirate Builder Bay, Clockwork Harbor, Dragon's Sanctuary, Wonderwild Forest and Hive, Storykeeper Castle) and `castle*.ts` | 183 to 941 each | Live |
| Atmosphere | `runtime/visual/atmosphere.ts` (fog, SNOW, sky ribbons) | | North Pole branch only |

Phaser still serves eight 2D worlds (`features/island-map/scenes/*Scene.ts`). They get no new
features (ADR-020) and are out of engine scope.

## 3. Shared and duplicated functionality found

| Duplication | Where | Engine answer |
|---|---|---|
| Two event buses with the same shape | `worldEngineEvents.ts` (Three.js) and `worldEvents.ts` (Phaser) | One generic `createEventBus` in `game/src/core/eventBus.ts`; the Phaser bus retires with Phaser |
| Per-world scene bootstraps | Region files each assemble scene, colliders and interactions | `EngineRuntime` + capabilities + SDK definitions (GE-003, GE-050) |
| Two checkpoint lists | Course checkpoints in platform data and region-play `effects.checkpoints` (Firepeak Heart data) | One checkpoint tracker (GE-027) referenced by hazards (GE-042) |
| Hazard recovery presentation only for region-play lava | Region-play UI | Recovery reason and hazard id on the presentation event; UI stays the realm's (Firepeak, agreed) |
| Collider truth in three places | Manifest colliders, derived asset colliders, platform boxes | One `PhysicsProvider` over one live collider list (GE-021) |
| Camera follow and avatar follow each reading controller fields | `playerCamera.ts`, `playerAvatar.ts` | One canonical `PlayerTransform` (GE-005) both read |
| Atmosphere presets inside a realm | North Pole `runtime/visual/atmosphere.ts` | Weather and lighting as data (GE-045); NP migrates after parity (GE-074) |
| Footstep cues per surface authored but never played | North Pole `snowStep`, `iceStep` | Surface profiles carry `footstepCue` (GE-022, GE-043) |

## 4. Extract versus rewrite

| Module | Decision | Why |
|---|---|---|
| `firstPersonController`, `jumpConfiguration`, `locomotionConfiguration`, `playerCollision` | **Extract** (git mv to `game/src/movement`, shim at old path) | Pure (imports only `three` and each other); QA'd fixes must be kept byte-for-byte; no realm branch edits them |
| `gamepadInput`, `pointerControls` | **Extract** to `game/src/input` | Pure; no realm branch edits them |
| `cameraHeightFollower`, `playerPresentation`, `playerCamera`, `cameraPreference` | **Extract** to `game/src/camera` | Pure (plus DOM storage); no realm branch edits them |
| `worldEngineEvents` | **Keep**, mirror as `EnginePresentationEventMap` with a parity test | Imported widely; its React-side consumers move with GE-076 |
| `playerAvatar`, `playerAnimation` | **Keep**, build pure engine equivalents | They import child-profile and NPC Manager code (not allowed in `game/`) |
| `platforms/*` | **Keep**, engine components port the pure math with a source note | They import manifest and world-object types; Pirate's Leap, Firepeak and North Pole content depends on them; retire in GE-076 |
| `runtime/createLocationEngine` | **Keep**, adopt the engine piece by piece | 1679 lines and edited on North Pole and Storykeeper branches; moving it now would turn every realm merge into a conflict (LAI-ENG-002 blocker B6) |
| `sceneKit`, `assets/*` | **Keep** for now | LAI-2102 lists them, but they import the asset catalogue that realm branches extend; port the loader behind the Asset Manager port first |

## 5. Gaps no branch implements (engine scope)

Wind and external forces; surface friction and ice sliding; swimming; ladders and climbing;
maximum walkable slope; telegraphed moving hazards; crumble-then-fall; equipment sockets; a
generic animation state machine with blending; a fixed-timestep runtime with capabilities; the
Realm and Adventure SDK, content compatibility validator and scaffolding; versioned gameplay
claims for scoring; a dev-only Playground with collision visualization.

## 6. Decisions reviewed

| Decision | Bearing on the engine |
|---|---|
| ADR-020 (Accepted) | Three.js only; `game/` package; engine emits typed semantic events and never validates, awards or calls AI; Sprouts guided profile is a configuration |
| ADR-063 (Reserved; branch "ADR-055") | Jumping is standard movement in the shared controller; only authored low obstacles are jumpable |
| ADR-056, ADR-057, ADR-058 (Reserved) | One camera controller (first and third person); avatar catalogue over the Asset Manager; gaits of one controller |
| ADR-059 (Reserved) | Platforms are jumpable boxes in the controller's collider list; layout seed-authored, tuning staff-authored |
| ADR-060 (Reserved) | Cylindrical footprint (0.35 m + 0.02 m skin); gait follows achieved movement |
| ADR-033 (Accepted) | One Django backbone; no second catalog, progress or reward model for one feature |
| ADR-053 (Accepted) | No play-time limits; the validator rejects timer fields |
| ADR-072 (Accepted) | Standards are the final authority after the owner; multi-agent rules |
| LAI-JMP-01, 01a, 01c, 02 | Implemented on the movement stack; the engine extracts them unchanged |
