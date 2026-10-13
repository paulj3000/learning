# Generic 3D Location Engine: Overview and Status

_As of 2026-10-12, commit `d344c0f`._

This page describes the engine as it stands today. The phase plan it was built
from is [`10_IMPLEMENTATION_PHASES.md`](10_IMPLEMENTATION_PHASES.md), its
acceptance tests are [`11_ACCEPTANCE_TESTS.md`](11_ACCEPTANCE_TESTS.md), and the
decision behind it is ADR-025 in [`../DECISIONS.md`](../DECISIONS.md). The
detailed, phase-by-phase history is in
[`../IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md).

## In one paragraph

Every first-person 3D region on the island runs on one engine. A region is a
**manifest**: plain JSON describing what exists in it and where (ground,
walls, characters, props, collectibles, zones, checkpoints, interactions,
copy). One route serves every region, one React view orchestrates it, and one
runtime turns the manifest into a Three.js scene. A region with a mechanic
the shared vocabulary cannot express registers an **extension** instead of
adding code paths to the engine. The engine never decides correctness,
awards progress or branches on which region it is rendering.

## Status at a glance

| | |
|---|---|
| Regions on the engine | 6 of 6: Welcome Harbor, Pirate Builder Bay, Wonderwild Forest, Storykeeper Castle, Clockwork Harbor, Dragon's Sanctuary |
| Phases complete | 0 to 10, 16 (3D regions), 17 |
| Phases remaining | 11 to 15 (admin authoring) |
| Extensibility proof | Passed: a new location needs only a manifest (plus its checkpoints) |
| Test suite | 249 files, 2,567 tests passing; typecheck, lint and build clean |
| Played by a person since the migration | **No.** Not in a browser, not on a tablet |

## How a visit works

```text
/island/:childId/explore/:regionId
  -> LocationWorldPage            resolves the child profile and age band
  -> ThreeLocationWorldView       loads the manifest and the child's world state
       -> LocationManifestRepository.getPublished(regionId)   (validated, cached)
       -> createLocationEngine(manifest, startCheckpointId)    (the Three.js runtime)
            emits semantic events on WorldEngineEventBus
              PlayerEnteredZone / NpcApproached / InteractableFocused /
              ObjectInteracted / CollectiblePickedUp / ...
       <- the view maps each event to meaning through the manifest
            save a checkpoint, record a character met, open an NPC conversation,
            offer a discovery, start an adventure, record a world change
```

The scene only reports what happened, by semantic id. The view, through the
manifest, decides what it means, and the existing Adventure, Quest,
Discovery, NPC and Rewards engines do the work. Nothing in the 3D layer grades
an answer or grants progress (ADR-008).

## The parts

All paths are under `src/features/island-map/three/` unless stated otherwise.

### Manifest contract: `runtime/locationManifest.ts`

`ThreeLocationManifest`, schema version 1. Its sections:

- **Identity:** `regionId`, optional `locationSlug`, `worldSlug`, `title`, `version`.
- **Space:** `bounds` (boundary walls are derived), `environment` (sky,
  lighting, and state-dependent `variants`), `checkpoints` (referenced by id),
  `colliders`, `buildings` (open-sided kit buildings with an interior zone),
  `lights`.
- **Scenery:** `TILED_GROUND`, `FLAT_PLANE`, `BOX`, `CLUSTER`,
  `LOD_PLACEMENTS`, `MODEL`, `SCATTER` (deterministic fill of unwalkable
  ground) and `RUN`. Any item can carry `requirements`.
- **Things to meet and use:** `npcs`, `props`, `collectibles` (optionally
  bound to a durable `worldChange`), `zones`, `ambient` (decorative motion).
- **Meaning:** `interactions` reuse `WorldInteraction` unchanged, with the
  actions `TALK_TO`, `DISCOVER`, `START_ADVENTURE`, `START_STORY`, `NAVIGATE`
  and `SHOW_MESSAGE`. `adventureBindings` map things in the room to options
  of an adventure step (`runtime/adventureStepBindings.ts`).
- **Behaviour switches:** `extensions`, `hiddenInteractionIds` (secrets),
  `noReticleBands`.
- **Copy:** loading text, instructions, status lines, "Things to do here"
  notes, calm-stop text, checkpoint toasts, and the non-graphical way out
  (`altNav`). All child-facing and readable aloud.

### Validation: `runtime/validateLocationManifest.ts`

A pure function, `validateLocationManifest(manifest, registries)`. It returns
every issue at once rather than throwing on the first. It checks:

- plain-JSON-ness and the schema version;
- world and location ownership;
- that `checkpoints.ids` lists exactly the region's authored checkpoints, in order;
- rect sanity and bounds;
- assets and their animation clips;
- characters, discoveries, adventures (in the right location), stories, items and extensions;
- extension-declared assets;
- that a collectible's world change is gated so it cannot come back;
- adventure step bindings;
- that no child-facing copy is empty.

The registries are injected. `runtime/sourceManifestRegistries.ts` builds them
from the source-controlled content.

### Repository: `runtime/locationManifestRepository.ts`

The interface the runtime reads manifests through (acceptance A4):
`getPublished(regionId)` and `listRegionIds()`. The shipped implementation is
source-controlled. It validates on first request, caches, guards against
duplicate regions and raises typed `LocationManifestNotFoundError` and
`InvalidLocationManifestError`. The manifests themselves are in
`runtime/manifests/`, listed in `runtime/manifests/index.ts`.

### Runtime: `runtime/createLocationEngine.ts`

Turns one manifest into a running scene: renderer, first-person controller,
colliders, scenery, characters, props, collectibles, lights, ambient motion,
trigger volumes, raycast focus and interaction, and the frame loop. Every
outside dependency (renderer, asset loading, input, resize, frame
scheduling, clock, extensions) arrives through `LocationEngineDeps`, so the
whole runtime runs in jsdom under test. Other things it guarantees:

- A model that fails to load keeps its placeholder.
- A model that resolves after disposal is never added.
- On disposal, it frees only what it created.

Supporting pure modules:

- `runtime/sceneLayout.ts`: layout maths such as walls, tiling, scatter and walkability.
- `runtime/worldTriggerTracker.ts`: edge-triggered zone, approach and focus logic.
- `runtime/manifestBindings.ts`: event-to-meaning lookups.

### View: `runtime/ThreeLocationWorldView.tsx`

One React component for any manifest. It does the following:

- Loads the manifest, then the child's world state, companion, inventory, quests and world changes.
- Mounts the engine at the saved checkpoint, and saves only this manifest's checkpoints.
- Records characters met.
- Shows crosshair labels and toasts.
- Opens interactions through `runtime/WorldActionPanel.tsx`, respecting their requirements.
- Lists every interaction in "Things to do here", except hidden ones.
- Runs the session clock and calm stop.
- Shows calm not-found, invalid and progress-unavailable states.

### Extensions: `extensions/`

A bespoke mechanic is registered, never branched on. An extension has up to
two halves:

- **Scene half** (`WorldExtension`, `runtime/extensionRegistry.ts`): mounts
  into the running scene. It can draw inside an entity's root, intercept
  interactions, remove colliders, run per frame, and must declare the asset
  ids it loads (`assetIds`).
- **View half** (`LocationViewExtension`, `runtime/viewExtensionRegistry.ts`):
  can claim interactions and render an `Overlay`, or a `Companion` that stays
  mounted for the whole visit.

| Extension | Halves | Used by | What it does |
|---|---|---|---|
| `tide-trial` | scene + view | Pirate Builder Bay | The Beat the Tide plank mechanic and its panel |
| `castle-tale` | scene + view | Storykeeper Castle | Hosts the story adventure in the room: plates, lectern, easel, nook, Quill |
| `clockwork-machinery` | scene | Clockwork Harbor | Moving machinery drawn into prop roots |
| `adaptive-adventure-entrance` | view | Clockwork Harbor | Picks and opens the right adventure for the child |
| `sanctuary-art` | scene | Dragon's Sanctuary | Art for runes and scales that have no model of their own |

Welcome Harbor, Wonderwild Forest and the test cove use no extensions.

### Assets: `assets/`

- `assets/manifest.ts`: the bundled asset catalogue (ids, urls, clips).
- `assets/assetResolver.ts`: the single step from an asset id to a url.
- `assets/assetLoader.ts`: loading and caching through that resolver.
- `runtime/locationAssetUsage.ts`: derives which location uses which asset,
  from the manifests and extension declarations. The admin Island page reads it.

The database-backed `Asset`/`AssetVersion` path
(`src/features/assets/assetService.ts`, `PUBLISHED_ASSET_RESOLVER`) exists but
is deliberately not wired into children's scenes yet. `Asset` is Admins-only
until the asset manager adds a published read path for parents.

### Routing

- `/island/:childId/explore/:regionId` is the only 3D location route
  (`runtime/locationWorldPath.ts`, `src/routes/LocationWorldPage.tsx`).
- Old 3D URLs (`/world/*-3d`, `/world/clockwork-harbor`,
  `/world/dragons-sanctuary`) redirect through `LegacyLocationWorldRedirect`.
- The Phaser 2D routes (`/world/pirate-builder-bay` and others) are separate
  and still live. See "Known gaps".

## Rules the tests enforce

| Rule | Where |
|---|---|
| The runtime never names a location slug or region id (A2) | `runtime/noLocationBranching.test.ts` |
| Every shipped manifest validates and survives a JSON round trip (A3) | `runtime/manifests/*.test.ts` |
| No asset url outside the catalogue, no S3/CloudFront/Amplify host in `src/` | `assets/noHardCodedAssetUrls.test.ts` |
| An extension cannot load an asset it did not declare | `runtime/createLocationEngine.test.ts` |
| Each migrated region behaves as its old view did | `runtime/manifests/*Parity.test.tsx` |
| Each region runs on the real runtime | `runtime/manifests/*.engine.test.ts` |
| A new location needs no production code (Phase 17) | `runtime/testExplorerCove.test.tsx`, `runtime/testExplorerCove.engine.test.ts` |

## Adding a location

1. Author its checkpoints in `src/features/discovery/checkpoints.ts` and add
   them to `ALL_CHECKPOINTS`. (See gap 2 below.)
2. Write a manifest in `runtime/manifests/` that uses existing asset ids,
   characters, discoveries, adventures and quests.
3. Add it to `SOURCE_LOCATION_MANIFESTS` in `runtime/manifests/index.ts`.
4. Add a manifest test (valid against the real registries, JSON round trip)
   and, if it has anything spatial worth pinning, an engine test using
   `runtime/testing/engineHarness.ts`.
5. Link to it with `locationWorldPath(childId, regionId)`.

There's no route, view, scene or region module to write. If the location needs
a mechanic the vocabulary cannot express, write an extension, register it in
`extensions/index.ts`, and bind it from the manifest. Never add a region check
to the runtime.

`runtime/testing/testExplorerCove.ts` is a complete worked example. It
includes a character, a discovery feeding a quest, an adventure entrance, a
saved collectible and a travel exit.

## Known gaps

1. **No person has played the engine.** All six regions have passed automated
   tests only since moving to the engine. Rendering, controls and feel in a
   real browser and on a tablet are unverified. The old per-region views were
   removed in Phase 16, so the reference for "how it used to behave" is now
   git history.
2. **Checkpoints exist only in code.** Checkpoint ids, labels and positions live in
   `discovery/checkpoints.ts` (the World State layer, ADR-008). Three places
   read that file directly:
   - the engine: `resolveSpawnCheckpoint` and `ALL_CHECKPOINTS`;
   - the view's checkpoint toast: `findCheckpoint`;
   - persistence: `discovery/api.ts` drops any id outside `KNOWN_CHECKPOINT_IDS`.

   This is fine for locations authored in code. A location published from the
   database (Phase 12) could not save checkpoints until there is a published
   checkpoint catalogue that all three read.
3. **The Phaser 2D views are still live.** ADR-021 retires each one only after
   a person has checked its 3D replacement.
4. **Sprouts (ages 3-4) first-person play is unproven.** The accessibility
   playtest has not run, and Storykeeper Castle's SC-11 gate does not pass.
   The card-based location hub stays the required non-graphical route.
5. **Not built yet** (`06_ASSET_SYSTEM.md`):
   - environment GLBs;
   - modular characters and attachment points;
   - a delete guard on `Asset`. When one is needed, `getSourceAssetUsage()` is the dependency check.

## What comes next

| Phase | Scope | Notes |
|---|---|---|
| 11 | Admin location editor v1 (forms) | Manifests may stay source-controlled |
| 12 | Versioned draft and publish in the database | Must resolve gap 2; swap the repository, not the engine |
| 13 | Admin 3D placement editor | An enhancement, not a prerequisite |
| 14 | Admin-authored adventures | Keep `AdventureDefinition` version and session semantics |
| 15 | Content templates | Produce data and manifests only |

Phases 11 to 15 are authoring tools. Children see no change from them, and
they are outside the MVP scope in `CLAUDE.md`. Before starting them, the
recommended next step is a person playing all six regions (gap 1). Then
decide between the authoring track and the child-facing gates (gaps 3 and 4).
