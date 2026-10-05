# Three.js Location Duplication Audit

Phase 0 deliverable of the engine roadmap (`docs/engine/10_IMPLEMENTATION_PHASES.md`).
Written 2026-10-04 against the working tree as it was on disk, including
uncommitted work (Tide Trial, `WorldStage`, full screen). No functional
changes accompanied this audit.

Classification key:

| Tag | Meaning |
|---|---|
| **GENERIC** | Logic every region repeats; belongs in the shared runtime |
| **MANIFEST_DATA** | Serializable facts (bounds, colliders, zones, spots, placements, lighting, copy) |
| **REUSABLE_EXTENSION** | A bespoke mechanic that should sit behind a registered extension id |
| **REGION_SPECIFIC_CONTENT** | Authored content that stays region-owned but should become data |
| **LEGACY** | Superseded or unused; retire once nothing depends on it |

## 1. Baseline (before any change)

Run 2026-10-04, Node 24.14.0. The first attempt failed on every command
because the parent npm workspace (`~/Coding/package.json`, which hoists this
project's dependencies) had an incomplete `node_modules`: `oxlint`,
`@vitejs/plugin-react` and `@playwright/test` were missing. An additive
`npm install` at the workspace root restored them. After that:

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass, warnings only (`no-console` in `.tmp-verify/`, `prefer-tag-over-role` on four Phaser views) |
| `npx vitest run` | 222 files, 2318 tests, all pass |
| `npx vite build` | pass, with the existing >500 kB chunk warning (`LocationScene`, `worldEngineEvents`, `index`) |

No pre-existing code failures.

## 2. Inventory

### Dedicated 3D route pages (`src/app/AppRoutes.tsx`)

Each is 79 to 89 lines of the same shell: read `childId`, `getChildProfile`,
fall back to age band `SPROUT`, handle loading/not-found/error, render
`<IslandLayout><XWorldView/></IslandLayout>`. **GENERIC.**

| Path under `/island/:childId/` | Page | View | Engine |
|---|---|---|---|
| `world/welcome-harbor-3d` | `WelcomeHarborWorldPage` | `WelcomeHarborWorldView` | Three |
| `world/pirate-builder-bay-3d` | `PirateBuilderBayWorldPage3D` | `PirateBuilderBayWorldView` | Three |
| `world/wonderwild-forest-3d` | `WonderwildForestWorldPage3D` | `WonderwildForestWorldView` | Three |
| `world/storykeeper-castle-3d` | `StorykeeperCastleWorldPage3D` | `StorykeeperCastleWorldView` | Three |
| `world/dragons-sanctuary` | `DragonsSanctuaryWorldPage` | `three/DragonsSanctuaryWorldView` | Three |
| `world/clockwork-harbor` | `ClockworkHarborWorldPage` | `ClockworkHarborWorldView` | Three |
| `world/three-sandbox` | `ThreeSandboxWorldPage` | `ThreeSandboxWorldView` | Three |
| `world`, `world/pirate-builder-bay`, `world/wonderwild-forest`, `world/storykeeper-castle`, `world/fossil-ridge-camp`, `world/castle-writing-room`, `world/bolts-workshop` | Phaser pages | Phaser views | Phaser (ADR-021: phased out, not part of this migration) |

There is **no generic 3D route**. `locations/:locationSlug` exists but is the
2D location card (`IslandLocationPage`), whose walk links are a hard-coded
`location.slug === '...'` chain. `world/clockwork-harbor` has no UI entry
point; `world/welcome-harbor-3d` and `world/three-sandbox` are linked only
from `routes/WelcomeHarbor.tsx`.

### Region modules (`src/features/island-map/three/`)

| Region | View | Scene | Region data | Extra |
|---|---|---|---|---|
| Welcome Harbor | 196 | 453 | 183 | |
| Pirate Builder Bay | 480 | 822 | 393 | `TideTrialPanel.tsx`, `../tideTrial.ts` |
| Wonderwild Forest | 437 | 514 | 483 | `wonderwildHiveRegion.ts`, `wonderWallBindings.ts` (runtime-unused) |
| Storykeeper Castle | 1388 | 1829 | 832 | `castle*.ts` helpers (5 files) |
| Dragon's Sanctuary | 337 | 636 | 485 | |
| Clockwork Harbor | 345 | 588 | 298 | |
| Sandbox | 79 | 210 | (`sandboxTriggers.ts`) | `useSandboxBridge.ts` |

### Shared utilities that already exist (keep and build on)

- `ThreeGameContainer.tsx`: engine lifecycle owner, generic over `{ dispose() }`.
- `WorldStage.tsx`: canvas + HUD box and full screen toggle.
- `WorldHud.tsx`: quest cue, companion, focus reticle, toast, backpack.
- `worldEngineEvents.ts`: the renderer-neutral typed bus (ADR-008).
- `npcApproachBridge.ts`: `NpcApproached` to `recordCharacterMet`.
- `sceneKit.ts`: `createSceneBootstrap`, `fitRendererToParent`, `toBox3`,
  `runPlacements`, `placeKitRun`, `placeKitCluster`, `placeWithLod`, and
  shared constants (`APPROACH_RANGE_METERS`, `RAYCAST_RANGE_METERS`,
  `EYE_HEIGHT`, `WALL_HEIGHT`).
- `firstPersonController.ts`, `pointerControls.ts`: movement and input.
- `sandboxTriggers.ts`: `isInsideZone`, `hasApproached`, `isInRange`. Despite
  its name every scene imports it, so it is GENERIC.
- `assets/`: `manifest.ts` (`ASSET_MANIFEST`), `assetLoader.ts`,
  `gltfAssembler.ts`, `primitives.ts`, `animationVocabulary.ts`.
- `../worldObjects.ts`: `WorldInteraction`, `WorldRequirement`,
  `WorldAction`, `isInteractionAvailable`. Already plain data and already
  covers TALK_TO, DISCOVER, START_ADVENTURE, START_STORY, NAVIGATE,
  SHOW_MESSAGE. **This is the binding vocabulary the manifest reuses.**
- `../../discovery/checkpoints.ts`: `RegionCheckpoint`, per-region checkpoint
  lists, `resolveSpawnCheckpoint`.

## 3. What every region duplicates (GENERIC)

### Scene skeleton (all six scenes)

1. `createSceneBootstrap(parent, color, lighting)` (sandbox hand-rolls it, LEGACY).
2. Boundary colliders from a half-extent (`BOUNDARY_WALLS`, written out four
   times per region), plus per-region collider rects to `Box3`.
3. `new FirstPersonController({ colliders })`, then `resolveSpawnCheckpoint`.
4. NPC placeholder box, then `loadAsset` swap, then an `Idle` `AnimationMixer`
   (Welcome Harbor, Bay, Clockwork, Castle).
5. Tiled ground grid (Welcome Harbor, Dragons, Clockwork; Wonderwild has its
   own `tilePlacements`).
6. Open-sided building: wall colliders per side, wall runs, roof, door
   (`buildingWallColliders`/`wallSideRun` in Welcome Harbor,
   `lighthouseWallColliders` in Clockwork, `buildingWallColliders` in
   Dragons). Castle has the indoor equivalent, `buildWallSegments`.
7. Raycast focus over an entity-to-mesh list, and `interact()` that emits
   `ObjectInteracted` with a `:talk`/`:collect`/`:use` suffix.
8. `frame()`: camera from controller, mixers, NPC approach edge, focus edge,
   checkpoint-zone and area-zone enter edges, render.
9. `attachPointerControls`, `fitRendererToParent`, `dispose`.

Checkpoint trigger boxes are built three ways: derived from checkpoint
coordinates with a ±1.5 half size (Welcome Harbor, Clockwork, Dragons), a
±1.2 half size (Wonderwild), and hard-coded `Box3` literals that restate
`checkpoints.ts` (Bay). The derived form is the manifest default.

`dispose()` cancels the frame and disposes the renderer, but no scene
disposes geometries, materials or mixers. The generic runtime should own
this once (acceptance W7).

### View skeleton (all six views)

- An up-front `Promise.all` of world state, companion, inventory, quest
  states (and world changes in four of them), then backpack and quest-cue
  mapping, often repeated verbatim in a `refresh()`.
- Bus wiring: `PlayerEnteredZone` checks `KNOWN_CHECKPOINT_IDS` and calls
  `saveCheckpoint`; `InteractableFocused` maps to a label; toast with a
  4000 ms timer.
- `WorldStage`, `ThreeGameContainer`, `WorldHud`, the instructions
  paragraph, the "Things to do here" list, the "Interact with what you're
  looking at" button, and the "Prefer not to walk in 3D?" link.
- `InteractionPanel`/`InteractionPanelAction` resolving `WorldAction` kinds
  (Bay, Wonderwild, Castle; also a copy in the 2D views).
- `NpcConversation` dialog.

Three variants of NPC approach handling exist: `useNpcApproachBridge`
(Welcome Harbor, Bay, Castle), inline listeners without the
`NpcStateChanged` emit (Dragons, Clockwork), and none (Wonderwild).

Three views (Bay, Dragons, Clockwork) clean up with
`bus.removeAllListeners()`, a hazard Castle and Wonderwild deliberately
avoid; Bay needs a ref workaround because of it. The generic view should
unsubscribe individually.

### Data types

`RectZone` and `isInsideRect` are declared identically in five region
modules and once more as `sceneKit.RectZoneLike`. Entity spots
(`{ entityId | id, label?, x, y?, z }`), kit clusters
(`{ x, z, rotationY?, scale? }[]`), runs (`{ from, to }`), and buildings
(`{ id, label, x, z, halfWidth, halfDepth, height, wallSides, interiorZone }`)
recur with small naming drift. All of it is already plain numbers, with no
`three` import in any `*Region.ts`.

## 4. Per-region classification

### Welcome Harbor (reference region)

- **MANIFEST_DATA:** all of `welcomeHarborRegion.ts` (bounds, two buildings,
  NPC spot, gull path, rock ring, trees, bushes, fence run, collectible
  spot); scene literals for colours, asset ids, tile size 4, water plane,
  gull speed 0.05, checkpoint half size 1.5; view copy (loading,
  instructions, building toasts, alt-nav).
- **GENERIC:** the whole scene and view skeleton above.
- **REUSABLE_EXTENSION:** none.
- **Slug/id branches:** `entityId === NPC_ID` in the view and scene; each one
  becomes manifest data (an NPC entity bound to a `TALK_TO` interaction).
- Conclusion: expressible entirely as a manifest with zero extensions. That
  is proven in Phase 1 by `runtime/manifests/welcomeHarbor.ts`.

### Pirate Builder Bay

- **MANIFEST_DATA:** bounds, channel water colliders, solid props, ground
  patches, decor clusters and runs, NPC and prop spots, three approach zones.
- **REGION_SPECIFIC_CONTENT:** broken/repaired bridge chosen at construction
  from `BRIDGE_REPAIRED` (expressible as a world-change variant); quay walls.
- **REUSABLE_EXTENSION:** `tide-trial` (water level, tide board canvas, deck
  planks, `TideTrialScene` API, collider splice on completion,
  `TideTrialPanel`, the Explorer detour, and its `recordWorldChangeOnce`);
  one-shot prop clip on interact (treasure chest); NPC gesture playback.
- **Coupling to fix:** `TideTrialPanel.tsx` imports the `TideTrialScene` type
  from `pirateBuilderBayScene.ts`.
- **Id branches:** `zoneId === 'bay-bridge-approach' | 'bay-tide-tunnel' |
  'bay-harbor-exit'`, `ageBand === 'EXPLORER'`, `focused === TREASURE_ID`,
  hard-coded `'pirate-builder-bay'` in `recordWorldChangeOnce` and alt link.
- Literal ids to preserve: interactions `bay-broken-bridge`,
  `bay-bridge-repaired`, `meet-pirate-pip`, `bay-rope-coil`, `bay-toolbox`,
  `cove-treasure`, `bay-tide-tunnel`, `bay-harbor-exit`; change key
  `BRIDGE_REPAIRED`; provenance `exploration:beat-the-tide`; checkpoints
  `pirate-builder-bay:{dock,bridge-approach,cove}`.

### Wonderwild Forest

- **MANIFEST_DATA:** glades, trails, pond, 13 zones, entity spots, decor
  coordinates currently hard-coded in the scene (reeds, lily pads,
  mushrooms, logs, ferns, signpost), collider heights, checkpoint half size 1.2.
- **GENERIC (generator):** the tree line derived as the complement of open
  ground, plus seeded scatter (`buildTreeLineSegments`, `scatterPlacements`).
  A reusable "forest boundary" scenery kind, not an extension.
- **REUSABLE_EXTENSION / variant rule:** asset swaps by state
  (`wonder-stone-bee-lit`, `flower-patch-bloomed/bare`, `cave-mouth-lit`,
  butterfly shown on `SAVE_THE_BUTTERFLY_GARDEN_COMPLETE`).
- **LEGACY until WF-3:** `wonderwildHiveRegion.ts` and `wonderWallBindings.ts`
  are imported only by tests.
- Already uses `WorldInteraction` with requirements and actions. This is the
  pattern to standardize on.
- Literal ids to preserve: checkpoints `wonderwild-forest:{harbor-path,
  wonder-wall,hive-clearing,pond,cave-mouth}`, discoveries
  `wonderwild-glowworm-cave`, `wonderwild-glow-moss`, change keys
  `WAGGLE_DANCE_DISCOVERED`, `SAVE_THE_BUTTERFLY_GARDEN_COMPLETE`.

### Dragon's Sanctuary

- **MANIFEST_DATA:** buildings (`keeper-lodge`, `forge`), sealed gates, rune
  and socket spots, roost stones, boulders, scale spots, sky cliffs, area
  zones and labels, ambient dragon path.
- **REUSABLE_EXTENSION:** rune collect into hearth sockets; sealed gate with
  locked message; restoration-stage lighting/VFX; collectible family that
  records `recordWorldChangeOnce` with `exploration:${propId}` provenance.
- **Divergence:** ad-hoc entity-id-set dispatch instead of `WorldInteraction`;
  engine rebuilt via `instanceKey` when state changes.
- **Id branches:** `gate.id.includes('crystal')` for colour,
  `entityId === FORGE_HEARTH.id` in view and scene.
- Literal ids to preserve: checkpoints `dragons-sanctuary:{gate,valley,roost}`,
  zones `dragons-sanctuary:zone:*`, props `dragons-sanctuary:prop:*`,
  `dragon-scale-01..03`, NPC `ember-dragon`, change keys
  `DRAGONS_SANCTUARY_*`.

### Clockwork Harbor

- **MANIFEST_DATA:** districts and labels, lighthouse building, dock deck,
  water zones, market stalls, clock tower, NPC spots (`{ id, label, x, z,
  assetId }`, the best-shaped NPC record), gear spots, gull path.
- **REUSABLE_EXTENSION:** adaptive adventure picker
  (`selectDifficultyLevel` to `resolveAdventureForSkillLevel`); world-change
  driven lighting and prop toggles; spinning gear and clock hand; collectible
  with persistence.
- **LEGACY:** `clockworkHarborRegion.ts` `COLLIDERS` is test-only and
  disagrees with what the scene builds.
- **Gap (not fixed here):** `CollectiblePickedUp` only toasts. Nothing records
  the golden-gear change key, so gears reappear on every visit even though
  `deriveClockworkHarborState` reads it.
- **Id branches:** `npc.id === 'harbor-master'` (placeholder colour),
  `entityId.startsWith('golden-gear-')`, `entityId === LIGHTHOUSE_MECHANISM.id`.

### Storykeeper Castle

- **MANIFEST_DATA:** rooms, archways, every entity spot and wall-mounted
  spot, bookshelves, 20 approach zones, per-room lights, entity-to-asset maps.
- **GENERIC:** indoor room-graph walls (`buildWallSegments`: rooms minus
  archway gaps), `placeWallMounted`, `facingIntoRoom`, `yawTowards`, the
  state-variant toggler (`applyVariants`, `toldVariants`, `openedVariants`),
  an "in-world adventure host" (`CastleTaleSession` and
  `CastleStoryAdventure` are near-duplicates), a story-entry host
  (`CastleSecretDoorStory`), the Sprout reticle rule.
- **REUSABLE_EXTENSION:** seating/ordering puzzle (`createSeatingPuzzle`,
  used three times, already parameterized); entity-to-adventure-option
  bindings (`castleChoiceBindings.ts`, same pattern as
  `wonderWallBindings.ts`); easel composite canvas; NPC gesture director;
  carry-in-front-of-camera; ambient sway.
- **Hard-coding to resolve:** session restore, `reflectChoice` and the easel
  are keyed to `the-storykeepers-tale` with `choose-hero`/`choose-setting`.
  Unverified, so check before relying on it: Sprout play
  (`quills-picture-story`) may not light portraits/windows or restore them on
  resume. `entityId === 'castle-tapestry-stair'`, `'lock-carving-worn'`.
- Recommended last in migration order (most bespoke bindings).

### Sandbox

**LEGACY.** It hand-rolls the bootstrap, redefines sceneKit constants, emits
events nothing consumes, and `useSandboxBridge.ts` is a one-line wrapper.
Retire it once the generic runtime renders Welcome Harbor; do not migrate it.

## 5. Bespoke mechanics that need extensions

| Extension id (proposed) | Source today | Reusable for |
|---|---|---|
| `tide-trial` | Bay scene + `TideTrialPanel` + `tideTrial.ts` | any water-level puzzle |
| `seating-puzzle` | Castle `createSeatingPuzzle`, lectern, library clues, pattern lock | any ordering step |
| `adventure-choice-bindings` | `castleChoiceBindings.ts`, `wonderWallBindings.ts` | spatial CHOICE steps |
| `easel-canvas` | `castleEaselCanvas.ts` | composite picture rewards |
| `rune-sockets` | Dragons runes + hearth | collect-then-place puzzles |
| `adaptive-adventure-entrance` | Clockwork lighthouse picker | any skill-levelled entrance |
| `npc-gestures` | Quill director, Pip gestures | any NPC |

Not extensions; these become generic manifest features (Phase 8):
world-change asset/lighting variants, sealed gates with a locked message,
collectibles that record a world change, spline ambient movers, prop
one-shot clips on interact.

## 6. Recommended order

Welcome Harbor (reference, zero extensions), then Pirate Builder Bay (first
extension: `tide-trial`, plus world-change variants), then Wonderwild,
Clockwork, Dragon's Sanctuary, Storykeeper Castle. The sandbox is retired,
not migrated. This matches `docs/engine/09_MIGRATION_PLAN.md`.
