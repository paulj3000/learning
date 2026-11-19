# Game Engine Core: legacy retirement plan (GE-076)

- **Status:** Proposed (inventory and plan only; nothing is removed by this document)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-19
- **Related ADRs:** ADR-020, ADR-059, ADR-063 (Reserved on `main`)
- **Related tickets:** GE-076, GE-070 to GE-075, GE-090, LAI-2102, LAI-2103
- **Canonical sources:** [migration-matrix.md](migration-matrix.md), [integration-baseline.md](integration-baseline.md), [known-defects.md](known-defects.md)

Rule (owner, 2026-11-18): **no legacy implementation or compatibility path is removed until all its
consumers have migrated and regression evidence exists.** Each removal below names its gate.

## 1. Re-export shims (island-map → `@lai/game-engine`)

Measured at the Wave 2 baseline `fc5c71cf`. Importers are files under `react/src` that import the
shim's old path (excluding the shim).

| Shim (`react/src/features/island-map/three/`) | Engine module | Importers | Removal gate |
|---|---|---|---|
| `firstPersonController.ts` | `movement/firstPersonController` | 14 | Every importer uses the package path, including the realm branches after GE-071 to GE-074 merge |
| `playerPresentation.ts` | `camera/playerPresentation` | 13 | Same |
| `jumpConfiguration.ts` | `movement/jumpConfiguration` | 6 | Same |
| `locomotionConfiguration.ts` | `movement/locomotionConfiguration` | 4 | Same |
| `playerCamera.ts` | `camera/playerCamera` | 4 | Same |
| `pointerControls.ts` | `input/pointerControls` | 4 | Same |
| `cameraPreference.ts` | `camera/cameraPreference` | 3 | Same |
| `playerCollision.ts` | `movement/playerCollision` | 3 | Same |
| `gamepadInput.ts` | `input/gamepadInput` | 2 | Same |
| `cameraHeightFollower.ts` | `camera/cameraHeightFollower` | 2 | Same |

Treasure Rush already imports from the package and guards it with a test
(`region-play/treasureRushEngineImports.test.ts`, GE-070). The same guard per realm is the evidence
each realm has left the shims.

## 2. Duplicated functionality (engine copy and live copy both exist)

| Concern | Live implementation | Engine implementation | Why both exist now | Retirement gate |
|---|---|---|---|---|
| Platform motion maths | `platforms/platformMotion.ts` | `components/pathMotion.ts` (faithful port, source noted) | Live `platformSystem` runs Pirate's Leap, Firepeak and North Pole platforms | All platforms authored as `gameplay.platforms` (needs GE-066 presentation and carry), parity tests per course |
| Platform system (static, moving, plates, switches, appearing, vanishing, bounce) | `platforms/platformSystem.ts`, `platformSpec.ts`, `platformPresentation.ts` | `components/platforms.ts`, `components/triggers.ts` | Same | Same; GE-071 later step, GE-073 crumble |
| Course checkpoints and hazards | `platforming.checkpoints`, platform hazards, region-play `effects.checkpoints` | `gameplay.checkpoints`, `gameplay.hazards` (via the bridge) | Migrating realm by realm | Firepeak done (`d97f20c4`); North Pole, Pirate's Leap, castle pending |
| Atmosphere (fog, snow, sky) | `runtime/visual/atmosphere.ts` (North Pole branch) | `environment/weather`, `lighting`, `particles` | Bridge did not draw them (GE-066) | North Pole parity test (density per tier, reduced motion, LOW tier off) |
| Avatar and animation | `playerAvatar.ts`, `playerAnimation.ts` (import child-profile and NPC Manager) | `character/avatar.ts`, `animation/*` | Live views still mount the island avatar | Runtime swap of each location (GE-076 step 3) |
| Event bus and presentation events | `worldEngineEvents.ts` (`WorldEngineEventBus`) | `core/eventBus.ts`, `contracts/engineEvents.ts` | Parity test keeps the payloads equal | All hosts on the engine runtime |
| Location runtime | `runtime/createLocationEngine.ts` (about 1,770 lines) | `createEngineRuntime` + capabilities + the bridge | Hot file on realm branches | Every location declared (GE-075) and runtime-swapped |
| Phaser 2D worlds | `features/island-map/scenes/*Scene.ts` | none (out of engine scope) | ADR-020: retired by per-world conversion (LAI-2201+) | Not GE-076 |

## 3. Content leaked into engine code (GE-D8)

| Leak | Where | Target home |
|---|---|---|
| `SANDBOX_NPC_ID = 'pirate-pip'` | `worldEngineEvents.ts` | The sandbox location definition (GE-075) |
| `ASSET_FOOTPRINTS` (treasure-chest, wonder-stone-*) | Live collider derivation | Asset collision profiles (Django) or the realm manifest |
| `ADVENTURE_COMPLETE_CHANGE_KEYS` | `npc-manager` `triggers.ts` | Realm content (adventure definitions) |

Moved by the engine lead after GE-066 merges, using the GE-075 batch 2 relocation report.

## 4. Sequence

1. GE-066 merged (bridge draws, carries, forwards). Realms adopt engine platforms course by course.
2. GE-071 to GE-074 merged into their realm branches with import guards (no shim imports).
3. Runtime swap per location (one commit each, parity tests unchanged): the location's
   `LocationDefinition` drives `createStandardEngine` or the bridge, and the live path is unused.
4. Remove the unused live modules for that location, then the shims, then `createLocationEngine`
   when nothing mounts it. Each removal needs green regression evidence from every consumer.

Integration planning for these steps is coordinated with the infrastructure and integration lead
(LAI-ENG-002, `docs/infrastructure/integration-plan-game-engine-core.md` on
`integration/multi-agent-dev`).
