# GE-247: bundled asset references in Asset Library dependency reporting

Status: **Owner-approved direction (2026-11-23); in implementation** (Agent 4 / LAI 04, Game Engine
Core). Trello #247. Shipped-scene references are listed, never blocking (S6 not required). Branch
`feature/ge-247-bundled-asset-references`, from `main` @ `1b0a50a3`, with `main` merged in at
`3132b151` (LAI 07's W2-1 registry, #65). Section 8 records what is built.

## 1. Summary

The deterministic, build-time reference manifest the ticket asks for **already exists**. It
already reaches Django, so no new file, script or runtime coupling is needed:

```text
location manifests + WorldExtension.assetIds + catalogue LOD pairs
  -> locationAssetIds()                    (runtime/locationAssetUsage.ts, pure)
  -> sceneAssetIndex.test.ts               (Vitest file snapshot; fails on drift)
  -> content/derived/scene-asset-index.json  (committed, sorted, ids only)
  -> content export `locationAssets`       (content-export/build.ts, schema 3, LAI-0304)
  -> manage.py load_content
  -> catalog.LocationAsset(location, asset, position, last_seen_release)
```

#247 therefore reduces to three things:

1. A Django **usage provider** over `catalog.LocationAsset` with the right semantics.
2. Closing three **coverage gaps** in that pipeline.
3. An **owner decision** on whether shipped-scene usage blocks retirement.

The engine keeps owning what the index contains and how it is computed. Django keeps owning how
usages are reported. The engine never reads Django's view.

## 2. Inventory (task 3), verified on `aa8adb33`

| Source | How it is referenced | In the committed index? | Resolves through |
|---|---|---|---|
| Shipped location manifests (`runtime/manifests/`: castle-writing-room, clockwork-harbor, dragons-sanctuary, pirate-builder-bay, storykeeper-castle with castleRooms/*, welcome-harbor, wonderwild-forest) | buildings (wall, roof, door), scenery (except FLAT_PLANE and BOX), npcs, props, collectibles, ambient appearances | Yes: 7 regions, 104 distinct ids (of 114 catalogue entries) | `BUNDLED_ASSET_RESOLVER` (`ASSET_MANIFEST`, `public/models/`) |
| LOD low-detail twins | computed from the catalogue (`lowDetailIdOf`) | Yes (added next to their high-detail id) | bundled |
| `WorldExtension.assetIds(config)` (castleTale, regionPlay, tideTrial; others declare none) | evaluated against each shipped binding's config | Yes | bundled |
| Clockwork Harbor NPCs (`npc-harbor-master`, `npc-professor-ticktock`) | manifest `npcs` | Yes (clockwork-harbor) | bundled |
| Welcome Harbor hub | manifest | **Exported, but skipped by the importer** (no `Location` record; 11 ids) | bundled |
| `avatar.default` (`game/src/engine/standardEngine.ts`) | engine default `AvatarDefinition.assetId` | No | The host's `AvatarLoaderPort`. It is **not** an `ASSET_MANIFEST` entry and not a library asset, so it is an engine-reserved placeholder id. |
| Sandbox (`sandboxScene.ts`, `npc-pip`) | developer sandbox route | No | bundled. Dev-only; `npc-pip` is already in the index through shipped regions. |
| Test fixtures (`testExplorerCove.ts`, `react/src/test/*`) | tests only | No (correctly) | n/a |
| Django-served regions (Treasure Cove, Firepeak, North Pole, Pirate's Leap) | `WorldRegion` rows and `scene` JSON | Not this index; covered by the W2-3 `regions` provider | Django resolver, bundled fallback |
| Player avatars, NPC releases, sound releases | Django rows | Not this index; their own W2 providers | Django |

Every bundled id is also a Django `ContentAsset`: the export's `assets` (the whole `ASSET_MANIFEST`)
creates them with `bundled_path`. So staff **can** retire `rock`, `crate`, `archway` and the rest
in Django Admin today.

## 3. What retirement does to a shipped scene (fact b)

Verified in code; the pinning test is in section 7, step S2.

- **Model: unchanged.** Shipped regions load through the bundled resolver and never ask Django for a
  model.
- **Collision: reverts to the engine's built-in footprint.** `lai/apps/assets/resolver.py` attaches
  `collision` only when the entry's status is `resolved` or `unavailable`. A retired asset
  answers `status: "retired"` with no collision. `regionAssetsFor` applies Django collision
  profiles to shipped regions for a signed-in child. With no profile,
  `derivedColliders.footprintFor` uses the built-in footprint, or no box for an id with none. The
  result is exactly what a signed-out child, or a build without the Django API, already gets.
- **Profile edits matter more than retirement.** Changing an asset's collision profile changes
  every shipped region that places that id, immediately, with no release. This is the coupling the
  #246 registry should surface. Retirement is the lesser case.

Consequence: retiring a bundled-matching asset never leaves a shipped scene without its model. It
only drops the staff collision profile back to the engine default.

## 4. Proposed contract

### 4.1 Engine-owned (Agent 4)

| Contract | Owner | Consumers | Change rule |
|---|---|---|---|
| `locationAssetIds(manifest, sources)` and `assetUsageByRegion` (`runtime/locationAssetUsage.ts`): which ids a scene can load | Agent 4 | sceneAssetIndex test, admin Island page, `createLocationEngine` (the ids it requests collision profiles for) | Pure; covered by `locationAssetUsage.test.ts` |
| `content/derived/scene-asset-index.json` v1 `{generatedBy, regions: [{regionSlug, assetIds}]}`: regions sorted by slug, ids in first-use order, unique, ids only (no spatial data) | Agent 4 (generated) | content export (LAI 05 / catalog), Django importer | Regenerated only by `sceneAssetIndex.test.ts -u`, then `content:export` and `golden:generate`. Schema changes are coordinated with LAI 05 and LAI 07 through the export `schemaVersion`. |
| `WorldExtension.assetIds(config)` must list every id an extension loads; the runtime enforces this | Agent 4 | the index | Unchanged |
| Engine-reserved ids: `avatar.default` | Agent 4 | none in Django | Proposed: Django refuses creating a `ContentAsset` with a reserved id (S5) |
| Collision precedence: Django profile, then built-in footprint, then none; a retired id has no profile | Agent 4 (client), LAI 07 (resolver) | shipped and Django-served regions | Pinned by tests on both sides (S2) |

### 4.2 Asset Library-owned (LAI 07), proposed

The `catalog` usage provider (`apps/catalog`, registered from its `AppConfig.ready()`, per #246
rule 1; it already lists `LocationAsset` rows on the W2 branch, and S1 refines it):

- **Source:** `LocationAsset` rows whose `last_seen_release` is the latest applied
  `ContentRelease`. Older rows are stale and are reported as "last seen in release N, not in
  the current build". The importer keeps unseen rows and only counts them as `missing`.
- **Asset-level only.** Version retirement never matters: bundled scenes do not use library
  versions.
- **Label:** `Shipped scene <location slug> (bundled model)`.
- **Detail text:** "Shipped with the app: the model stays. Retiring removes this asset's collision
  profile there, so the engine's built-in footprint applies."
- **Blocking:** list only by default (`blocks_retirement=False`). See section 5.
- **Also surfaced on collision-profile edits:** the Asset Manager collision profile page lists the
  same usages. A profile change applies to shipped scenes with no release, so the warning belongs
  there.

### 4.3 Not proposed

- No new committed file such as `content/bundled-asset-usage.json`. It would duplicate
  `scene-asset-index.json` and its drift test.
- No runtime scraping of TypeScript by Django, and no Django read of the repository at request
  time.
- No engine runtime change.

## 5. Owner decision (2026-11-23)

**List only.** A shipped scene's reference is shown wherever staff inspect or retire the asset,
and never blocks retirement. Retirement cannot remove the bundled model (section 3). Collision
profile changes have immediate gameplay consequences, so they are reported on the collision
profile page. S6 (blocking) is not required.

Further decisions (owner, 2026-11-24):

- **Retired and bundled keeps collision.** A retired asset that still ships with the app keeps its
  collision profile (section 8.4). The resolver change is LAI 07's (`assets/resolver.py`).
- **The hub stays out of Place records for now.** Welcome Harbor's references stay in the release
  report (section 8.3).

## 6. Ownership boundaries (task 6)

| Path | Owner | #247 role |
|---|---|---|
| `react/src/features/island-map/three/runtime/manifests/**`, `locationAssetUsage.ts`, `sourceLocationAssetUsage.ts`, `sceneAssetIndex.test.ts`, `extensions/**` `assetIds` | Agent 4 | Read-only unless an S-step below says otherwise |
| `content/derived/scene-asset-index.json` | Agent 4 (generated by its test) | Not hand-edited |
| `game/src/engine/standardEngine.ts` (`avatar.default`) | Agent 4 | Read-only |
| `react/src/features/island-map/three/runtime/derivedColliders.ts`, `react/src/api/assets/djangoAssetResolver.ts`, `features/region-play/regionAssets.ts` | Agent 4 (engine collision and resolution) | Pinning tests only (S2) |
| `react/src/features/content-export/**`, `scripts/export-content.ts`, golden vectors | LAI 05 (integration) | Unchanged unless the export schema changes |
| `lai/apps/catalog/importer.py`, `models.py` (`LocationAsset`) | Catalog owner (LAI 07 coordinates) | S3 (hub gap) |
| `lai/apps/assets/dependencies.py`, `resolver.py`, admin | LAI 07 | S1, S4 |
| `lai/apps/regions/dependencies.py` | LAI 07 implementation; region semantics coordinated with Agent 4 | Separate (W2-3) |

## 7. Implementation sequence

Every step is independently testable and mergeable. Steps S1 to S5 need owner approval of this
design; S6 needs the section 5 decision.

| Step | Owner | Change | Tests |
|---|---|---|---|
| S1 | LAI 07 | Refine the `catalog` provider already on the W2 branch (`3196e38c`; no second provider for the same table): current-release `LocationAsset` rows only, asset-level only (nothing listed for a single-version question), list only, with the section 4.2 label and text; stale rows reported as such | pytest: seeded release, then current, stale and hub-skipped cases; `blocks_retirement` False; refusal unchanged for other providers |
| S2 | Agent 4 + LAI 07 | Pin fact (b). Client: a Vitest test that a shipped-region id answered `retired` by the Django resolver keeps the bundled model and falls back to the built-in footprint. Django: a resolver test that a retired asset carries no `collision`. | `djangoAssetResolver.test.ts` / `regionAssets.test.ts`; `apps/assets/tests/test_resolver_api.py` |
| S3 | Catalog owner (LAI 07) + owner | Welcome Harbor hub gap: record the hub's ids (a `Location` for the hub, or a hub-scoped usage row). Decision first; this is a catalog model question, not an engine one. | importer test: the hub's 11 ids become usages |
| S4 | LAI 07 | The Asset Manager collision profile page lists shipped-scene usages | admin test |
| S5 | LAI 07 (+ Agent 4 review) | Reserve engine ids: refuse creating a `ContentAsset` named `avatar.default` (and any future reserved id) | model or validation test |
| S6 | LAI 07 | Only if the owner picks "block": `bundled_scene_dependency` refusal | pytest |
| (opt) S7 | Agent 4, own GE ticket | Index v2: per-id use kinds (placement, LOD, extension, NPC, building) for richer labels; export schema bump coordinated with LAI 05 | `sceneAssetIndex.test.ts`, `contentExport.test.ts`, `golden:check`, catalog importer test |

Release-order note: `LocationAsset` reflects the last `load_content`, not the client build that
is deployed. A client release that changes a manifest must be followed by the content import
(`content:check` already fails CI if the committed export is stale). Record this in the release
checklist (LAI 05).

## 8. Implementation (2026-11-23)

### 8.1 Built, independent of W2-1

| Piece | Where | Behaviour |
|---|---|---|
| Hub references survive import | `lai/apps/catalog/importer.py` (`SCENE_ASSETS_WITHOUT_PLACE`) | A scene with no Place record keeps its skip message. Its asset ids are now also stored in `ContentRelease.report["scene_assets_without_place"]`, for example `{"welcome-harbor": [11 ids]}`. No migration. |
| Which shipped scenes use an asset | `lai/apps/catalog/scene_usage.py` | `shipped_scene_usages(asset)` returns `SceneUsage(scene, has_place, release_id, current)` from `LocationAsset` rows (current = last seen in the latest release) and the latest release's hub entry. A missing or malformed entry lists nothing and never raises. `retirement_note(asset)` describes current behaviour; it mentions collision only when the asset has a profile. |
| Asset definition page | `catalog/admin.py` `used_by` | `bay; welcome-harbor (no Place record)`, with stale scenes marked `last seen in release N`. |
| Retire action | `catalog/admin.py` `retire_assets` | Never refused for a shipped scene. After retiring, a warning names the current scenes and the note. |
| Collision profile page (S4) | `assets/admin.py` `CollisionProfileAdmin.shipped_scenes` (read-only; additive) | Lists the current shipped scenes and says saving changes collision there on the child's next visit. A profile for a non-default version says it does not change them. |
| Reserved engine ids (S5) | `ContentAsset.asset_id` is a `SlugField` | `avatar.default` already fails validation (the dot). Pinned by a test; no code change. |
| Client pinning (S2, client half) | `react/src/api/assets/djangoAssetResolver.test.ts` | A `retired` answer still loads the bundled model, and the client honours a collision profile on a retired entry when the server sends one. |

### 8.2 S1: the catalog usage provider (built on W2-1, 2026-11-24)

- `lai/apps/catalog/dependencies.py` `catalog_usages`, registered as source `catalog` from
  `CatalogConfig.ready()` through `register_usage_provider`. It is the only catalog provider.
- It wraps `shipped_scene_usages` and returns `[]` for a version question (a shipped scene draws
  the bundled model, never a library version).
- Each usage: code `shipped_scene`, the label from `SceneUsage.label`, `blocks_retirement=False`,
  no admin link, and `details={"scene", "release", "current", "note"}`, where `note` is
  `retirement_note(asset)`.
- A malformed or missing hub entry lists nothing. Any other error raises, and the registry then
  refuses retirement with `dependency_check_failed` (fail closed, ASSET_LIBRARY.md 25.2 rule 4).
- `manage.py asset_usage rock` now prints `[listed] catalog: Shipped scene bay (bundled model)`
  and the hub line. The W2-5 admin panel can render `details["note"]`.
- Tests: `apps/catalog/tests/test_catalog_usage_provider.py`.

### 8.3 Welcome Harbor: why not a Place record yet

Audited on `7ea078aa`. A first-class hub `Location` cannot go into `ISLAND_LOCATIONS`: the client
would render the hub twice (WorldHubPage, parent dashboard region list, IslandLocationPage, realm
cards), because it already renders it from `WelcomeHarbor.tsx`. An export-only record on the home
island (the Firepeak pattern) avoids that, but it has these Django side effects:

- The child islands API (`game_sessions/discovery.py`, island places) would send the hub as a
  Place with 0 adventures.
- `AvailabilityView`, the NPC, question-studio and audio place pickers, and the audio coverage
  report would gain a hub entry.
- 4 pinned tests change: `contentExport.test.ts` (the `region-without-location-record` ambiguity),
  `test_importer.py` (2 skip messages) and `test_export_content.py` (the hub NPC allowance).
  `locations.json`, `manifest.json` and the golden content digest are regenerated.

So the hub's references use the release report: an interim home with no schema change. A nullable
`LocationAsset.location` was rejected (a migration on a PROTECT FK that every consumer relies on).
**Owner decision (2026-11-24): keep the interim.** The hub does not become a Place for now.
Revisiting it means accepting or suppressing the side effects above (for example an inactive row,
which needs a `discovery.py` change).

### 8.4 Collision safety

- **The model never disappears.** Every shipped-scene id is an `ASSET_MANIFEST` entry, and shipped
  regions load only through the bundled loader (`regionAssets.test.ts` "keeps the bundled loader
  for a source-controlled region").
- **Collision can disappear today.** The resolver drops `collision` for a retired asset. 75 of the
  104 shipped-scene ids have no built-in footprint (kit pieces such as `archway`, `bookshelf`,
  `shipwreck`, `wall-stone`), so a staff profile on one of them is the only derived collider. The
  scene's authored colliders and building walls are separate and unaffected.
- **Fix approved by the owner (2026-11-24); LAI 07 writes it (`assets/resolver.py`):** a retired
  asset with a `bundled_path` keeps its `collision` (status stays `retired`, no URL). The client
  half is already pinned (section 8.1). Until the resolver change is on `main`, the staff note
  still describes current behaviour (the profile stops applying). The note changes together with
  the resolver, so it never claims protection the server does not give.
- **Deployed profiles: nothing to audit yet.** LAI 05 verified on 2026-11-23, read-only, that no
  DEV stack or deploy run exists. When an environment exists, LAI 05 runs
  `collision_clearance_audit` and the profiled-and-shipped query read-only and reports ids only.

### 8.5 S1 to S7 disposition

| Step | Disposition |
|---|---|
| S1 | Built: helper, admin uses and the registered `catalog` provider (8.2) |
| S2 | Client half built; resolver half (owner-approved 2026-11-24) is LAI 07's |
| S3 | Hub references kept through import in the release report; staying there is the owner's decision (8.3) |
| S4 | Built (collision profile page) |
| S5 | Already enforced by the schema; pinned by a test |
| S6 | Not required (owner) |
| S7 | Not recommended now: per-id use kinds would only enrich labels. Every consumer here needs only "which scene uses this id", and a v2 index means an export schema bump, a golden digest change and an importer change for no staff-visible decision. Revisit if staff need "placed vs LOD twin" in the UI. |
