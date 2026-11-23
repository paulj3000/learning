# #247: bundled asset references in Asset Library dependency reporting (design)

Status: **Proposed, design only** (Agent 4, Game Engine Core, 2026-11-23). Nothing here is
implemented. The cross-system work waits for owner approval. Trello #247, which depends on #246 (LAI 07 W2
registry). Baseline `main` @ `aa8adb33` (includes Asset Library W1).

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

## 5. Owner decision needed

Should a shipped-scene usage **block** retiring the asset?

- **Recommended: list only.** Retirement cannot remove the model (section 3). It returns collision
  to the engine default, which is the tested signed-out behaviour. Blocking would also prevent
  retiring any of the 104 bundled ids, which may be intended ("bundled assets are permanent"), but
  that is a product rule to state, not an accident of tracking.
- **Alternative: block** with code `bundled_scene_dependency`. The message says to change the
  manifest and ship a client build first.

Either way, staff guidance: "Collision profile changes on these assets apply to the shipped scenes
immediately."

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
