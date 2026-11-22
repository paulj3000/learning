# Game Engine Core: legacy retirement plan (GE-076)

- **Status:** Proposed. Dependency audit 2026-11-19 (section 5). Removed so far: the `gamepadInput` and `cameraHeightFollower` shims (checklist item 1)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-19
- **Related ADRs:** ADR-020, ADR-059, ADR-063 (Reserved on `main`)
- **Related tickets:** GE-076, GE-070 to GE-075, GE-090, LAI-2102, LAI-2103
- **Canonical sources:** [migration-matrix.md](migration-matrix.md), [integration-baseline.md](integration-baseline.md), [known-defects.md](known-defects.md)

Rule (owner, 2026-11-18): **no legacy implementation or compatibility path is removed until all its
consumers have migrated and regression evidence exists.** Each removal below names its gate.

## 1. Re-export shims (island-map → `@lai/game-engine`)

Re-measured 2026-11-19 on `core/gameengine` and on the integration tree `568dd278` (every realm
stream integrated); the counts are the same on both. Importers are `react/src` files that import the
shim through a relative path (package imports excluded). The first count was at `fc5c71cf`.

| Shim (`react/src/features/island-map/three/`) | Engine module | Importers (`fc5c71cf` → `568dd278`) | Removal gate |
|---|---|---|---|
| `firstPersonController.ts` | `movement/firstPersonController` | 14 → 12 | Every importer uses the package path, including the realm branches after GE-071 to GE-074 merge |
| `playerPresentation.ts` | `camera/playerPresentation` | 13 → 11 | Same |
| `jumpConfiguration.ts` | `movement/jumpConfiguration` | 6 → 4 | Same |
| `locomotionConfiguration.ts` | `movement/locomotionConfiguration` | 4 → 2 | Same |
| `playerCamera.ts` | `camera/playerCamera` | 4 → 2 | Same |
| `pointerControls.ts` | `input/pointerControls` | 4 → 2 | Same |
| `cameraPreference.ts` | `camera/cameraPreference` | 3 → 1 | Same |
| `playerCollision.ts` | `movement/playerCollision` | 3 → 2 | Same |
| ~~`gamepadInput.ts`~~ | `input/gamepadInput` | 2 → 0 | **Removed** 2026-11-19 (section 5, item 1) |
| ~~`cameraHeightFollower.ts`~~ | `camera/cameraHeightFollower` | 2 → 0 | **Removed** 2026-11-19 (section 5, item 1) |

Every remaining importer is the live location runtime itself (`createLocationEngine.ts`,
`ThreeLocationWorldView.tsx`, `playerAvatar.ts`, `playerAnimation.ts`, `locationManifest.ts`,
`validateLocationManifest.ts`, `sandboxScene.ts`, `WorldHud.tsx`, `testing/engineHarness.ts` and
their tests). No realm file imports a shim: the castle (`castleEngineImports.test.ts`), Firepeak
and North Pole (`firepeak/realmEngineImports.test.ts`) and Treasure Rush
(`treasureRushEngineImports.test.ts`) guards are all on the integration tree.

Treasure Rush already imports from the package and guards it with a test
(`region-play/treasureRushEngineImports.test.ts`, GE-070). The same guard per realm is the evidence
each realm has left the shims.

## 2. Duplicated functionality (engine copy and live copy both exist)

| Concern | Live implementation | Engine implementation | Why both exist now | Retirement gate |
|---|---|---|---|---|
| Platform motion maths | `platforms/platformMotion.ts` | `components/pathMotion.ts` (faithful port, source noted) | The live `platformSystem` still runs North Pole's platforms, the Heart's live platforms (mixed with engine ones) and the castle rooms' platforms | All platforms authored as `gameplay.platforms`, parity tests per course. Pirate's Leap is done (course v4: all 30 platforms on `gameplay.platforms`; `scene.platforming` keeps only Pip's section zones) |
| Platform system (static, moving, plates, switches, appearing, vanishing, bounce) | `platforms/platformSystem.ts`, `platformSpec.ts`, `platformPresentation.ts` | `components/platforms.ts`, `components/triggers.ts` | Same. `platformSpec.ts` is also the manifest type for `locationManifest.ts`, `validateLocationManifest.ts`, `regionManifest.ts` and the castle manifests | Same, then the manifest types move to the engine contracts. Remaining live courses: North Pole (`north_pole_layout._platforming`), the Heart (`firepeak_heart_layout.platforming`), castle (`castleRooms/castlePlatforms.ts`, `castleWritingRoom.ts`) |
| Course checkpoints and hazards | `platforming.checkpoints`, platform hazards, region-play `effects.checkpoints` | `gameplay.checkpoints`, `gameplay.hazards` (via the bridge) | Castle not yet migrated | Firepeak done (`d97f20c4`); North Pole done (layout v5: checkpoints on the bridge); Pirate's Leap done (course v4); castle pending |
| Atmosphere (fog, snow, sky) | `runtime/visual/atmosphere.ts` (still imported by `createLocationEngine.ts` and `regionManifest.ts`) | `environment/weather`, `lighting`, `particles` | Other Areas still use the live atmosphere | North Pole snow done (layout v5: snow on the bridge, parity 0/360/720 per tier); retire when no Area uses `scene.atmosphere` |
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

## 5. Dependency audit and remaining work (2026-11-19, Wave 2 stabilization)

Method: static import analysis (`git grep` of every relative and package import) on
`core/gameengine` and on the integration tree `568dd278`, every branch in the repository, and the
working copies of every worktree on disk (read only). Then a non-test-importer scan of every
module under `island-map/three`.

**Result: nothing is removed.** No legacy engine module is proven unused and safe to remove:

- The 8 shims with importers are imported by the live location runtime itself (section 1).
- `gamepadInput.ts` and `cameraHeightFollower.ts` have 0 importers on `core` and on the
  integration tree. Every branch that still imports them is already an ancestor of `568dd278`.
  But the `sc-final-d` worktree (branch `work/final-d`, already merged) has **uncommitted edits to
  the pre-extraction `cameraHeightFollower.ts` and `playerCamera.ts`**, and its copy of
  `pointerControls.ts` imports `./gamepadInput`. Removing either shim would turn that unmerged work
  into a modify/delete conflict or a broken import. That work belongs to its owner (Storykeeper
  final D); this audit does not touch it.
- Modules with no non-test importer (`assets/gltfAssembler.ts`, `assets/mediaAssets.ts`, the
  `runtime/locations/*.location.ts` definitions, `runtime/testing/*`, `sourceLocationAssetUsage.ts`,
  `wonderWallBindings.ts`, `wonderwildHiveRegion.ts`) are not legacy engine paths:
  `gltfAssembler` is used by `scripts/generate-world-assets.ts`; the location definitions are the
  GE-075 target of the runtime swap; the rest are test helpers or realm content.

Remaining-work checklist, in order (each item: one commit, regression evidence from every consumer):

1. [x] Done 2026-11-19. The castle lead parked the `sc-final-d` edits on
   `park/sc-final-d-20261118` @ `dec87388` (pushed, not for integration; the integration lead's
   W1). Re-check: no worktree has uncommitted use; the only unmerged branch importing either shim
   is that parked branch. `gamepadInput.ts` and `cameraHeightFollower.ts` removed and dropped from
   `LEGACY_WILDCARD_SHIMS`. Evidence: root `npm run typecheck` clean; game-engine React 136 passed
   plus 1 expected fail (GE-S1); island-map/three and region-play 2,040 passed, 0 failed (gated).
   The parked branch also holds untested live reduced-motion edits to `createLocationEngine.ts`,
   `playerCamera.ts`, `platformSystem.ts` and `platformPresentation.ts`. They were not adopted (out of
   stabilization scope); adopting them needs its own ticket, ported to the engine modules.
2. [x] Done 2026-11-22 (GE-S1, branch `fix/GE-S1-import-shims`). The 8 remaining shims
   (`cameraPreference`, `firstPersonController`, `jumpConfiguration`, `locomotionConfiguration`,
   `playerCamera`, `playerCollision`, `playerPresentation`, `pointerControls`) are removed; their
   20 importing files use `@lai/game-engine/camera`, `/movement` and `/input`, which re-export
   every name used (root `npm run typecheck` clean). The `it.fails` pin is a normal test, and
   `LEGACY_WILDCARD_SHIMS` became `RETIRED_SHIMS` (all 10 paths must stay deleted).
3. [ ] Migrate the remaining live courses to `gameplay.platforms` with per-course parity tests:
   North Pole platforms, the Heart's live platforms, and the castle rooms. Owners: the realm leads;
   the engine lead provides capabilities on request.
4. [ ] Castle checkpoints onto `gameplay.checkpoints` (the castle lead).
5. [ ] Move the manifest platform types (`platformSpec.ts`) into the engine contracts. Then
   retire `platformSystem.ts`, `platformMotion.ts` and `platformPresentation.ts` and their
   `createLocationEngine` wiring.
6. [ ] Retire `runtime/visual/atmosphere.ts` when no Area uses `scene.atmosphere`.
7. [ ] Runtime swap per location (section 4, step 3). Then retire `playerAvatar.ts` and
   `playerAnimation.ts` (child-profile and NPC Manager importers first) and
   `createLocationEngine.ts`.
8. [ ] GE-D8: move the leaked content ids (section 3).
9. [ ] Live host `groundHeightAt` for terrain Areas (GE-L14 remainder; not a retirement step,
   listed so the live host change is done once).
