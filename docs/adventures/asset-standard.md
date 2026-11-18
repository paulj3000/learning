# Asset Standard

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-020, ADR-028, ADR-030, ADR-035, ADR-042, ADR-045, ADR-047, ADR-064

How 3D models, images, textures and audio files are sourced, identified, validated, versioned,
published and loaded for any Realm, Place, 3D Area or Adventure. This standard summarizes and
links; the canonical detail lives in:

| Topic | Canonical document |
|---|---|
| Asset Library (models, lifecycle, storage, resolver, delivery, admin) | [ASSET_LIBRARY.md](../ASSET_LIBRARY.md) |
| Authoring conventions (units, pivots, colliders, clips, LOD, instancing, quality tiers) | [THREE_WORLD_ASSET_CONVENTIONS.md](../THREE_WORLD_ASSET_CONVENTIONS.md) |
| Licence ledger for every third-party file in the repository | [ASSET_LICENCES.md](../ASSET_LICENCES.md) |
| Where art and audio come from, and what was imported | [ASSET_SOURCING.md](../ASSET_SOURCING.md) |
| Background processing path | [processing/CANONICAL_PATH.md](../processing/CANONICAL_PATH.md) |
| Decisions | [DECISIONS.md](../DECISIONS.md) |

Related standards: [adventure-standard.md](adventure-standard.md),
[realm-standard.md](realm-standard.md), [npc-standard.md](npc-standard.md),
[audio-standard.md](audio-standard.md), [accessibility-standard.md](accessibility-standard.md).

Rules tagged **Binding** already apply through the cited source. Untagged rules are proposals
of ADR-072 and bind only once the owner accepts it.

## 1. Two asset paths

The platform has two ways an asset reaches a scene. Every new asset uses one of them.

| Path | What it is | Where binaries live | When to use |
|---|---|---|---|
| Asset Library | `catalog.ContentAsset` identity plus immutable `assets.AssetVersion` binaries, authored in Django Admin | Private storage: `lai/.asset-storage/` locally, the private asset bucket in AWS | Every new model, texture, image or audio file that staff should be able to replace without a deploy |
| Bundled manifest | `react/src/features/island-map/three/assets/manifest.ts` ids served from `react/public/models/` | Git (`react/public/models/`) | Generated grey-box assets, the existing normalised imports, and the runtime fallback |

- **Binding:** ADR-035. `catalog.ContentAsset` is the one asset identity. Do not add a second
  asset catalog, table or loader for one feature (also **Binding:** CLAUDE.md §20).
- **Binding:** ADR-030, ADR-035 item 8. The bundled manifest stays the runtime fallback. A
  resolver answer of `unavailable` or `retired`, or any network failure, falls back to the
  bundled file if one exists, otherwise to a placeholder. A scene never fails to load because
  the Asset Library is unreachable.
- **Binding:** ADR-047 decision I. Content (adventures, quests, NPCs, 3D Area copy) references
  assets by stable id only, validated against `ContentAsset` of the right kind.
- Components and engine code never hold a URL or object key. `noHardCodedAssetUrls.test.ts`
  (`react/src/features/island-map/three/assets/`) enforces this for the bundled path.

## 2. Asset Manager workflow (Django Admin)

**Binding:** ADR-045. Django Admin is the only staff surface for assets. There is no React staff
asset manager and no administrator asset REST API. React and Three.js consume published assets
only. The full action table, permissions and groups are in
[ASSET_LIBRARY.md](../ASSET_LIBRARY.md) section 21.

Lifecycle, in short (**Binding:** ADR-035, ADR-045):

```text
create definition -> upload version (checksum + validate) -> VALIDATED -> publish -> PUBLISHED
                                                         \-> REJECTED
PUBLISHED -> retire -> RETIRED -> (rollback, after re-verifying bytes) -> PUBLISHED
```

| Step | Who | Rule |
|---|---|---|
| Create definition | `catalog.add_contentasset` | Stable id, `kind`, category, name, tags. `origin=DJANGO` |
| Upload | `assets.add_assetversion` | Always a new version number and a server-made key. A failing file is never stored |
| Publish | `assets.publish_assetversion` | Re-verifies SHA-256; first published version becomes the default |
| Make default, roll back | `assets.publish_assetversion` | Points an unpinned reference at another published version |
| Retire | `assets.retire_assetversion` | Refused for the default version unless another takes over |
| Delete | `assets.delete_assetversion` | Never-published versions only |

- Groups come from `manage.py ensure_asset_roles`. Every lifecycle action is in Django Admin
  history.
- React never chooses a version because a file exists. Django resolves; React renders
  (**Binding:** ADR-045 item 4).
- A ticket that adds an asset states the asset id, kind, source, licence and who publishes it.

## 3. Identifiers and references

- **Binding:** ADR-035. An asset id is a stable lower-case slug shared with the bundled manifest
  namespace (for example `npc-pip`, `treasure-chest`). A reference is `id` (follows the
  default version) or `id@n` (pinned).
- An id names what the asset is in the game, not the file or the vendor
  (`foliage-tree`, not `kenney-tree-large`). Vendor names belong in the licence ledger.
- An id is never reused for a different object. Replace the file with a new version instead.
- State variants (`hearth` and `hearth-lit`) keep matching ids and identical shared geometry;
  see "State-variant relationships" in
  [THREE_WORLD_ASSET_CONVENTIONS.md](../THREE_WORLD_ASSET_CONVENTIONS.md).

## 4. Versioning

- **Binding:** ADR-035. Published and retired versions are immutable (key, checksum, size,
  metadata, clips). A new file is always a new version and a new object key; bytes are never
  overwritten.
- Pin (`id@n`) only when gameplay depends on exact geometry (graded lengths, counted objects,
  state-variant pairs). Otherwise follow the default so a publish needs no content change.
- **Binding:** ADR-054 item 5. NPC releases freeze each asset reference to a published version;
  retiring a version an active or rollback-able NPC release depends on is refused.

## 5. Formats and compatibility

**Binding:** ADR-035 item 3, enforced by `lai/apps/assets/validation.py` and
`validation_media.py`.

| Family | Accepted | Refused |
|---|---|---|
| 3D model | GLB (glTF 2.0 binary); self-contained `.gltf` with every buffer and image as an embedded `data:` URI | External `uri` references, FBX, Blender, ZIP, RAR |
| Image or texture | PNG, JPEG, WebP (size and dimension limits in ASSET_LIBRARY.md section 21.2) | SVG, GIF, BMP, TIFF |
| Audio | MP3, WAV (PCM or float), Ogg (Vorbis or Opus) | AAC, FLAC |

- Format is read from the bytes, never the extension.
- glTF extensions that need a decoder are refused: `KHR_draco_mesh_compression`,
  `EXT_meshopt_compression` and `KHR_texture_basisu` (KTX2/Basis). The app configures no
  decoders. Meshopt and KTX2 are not supported on `main`; GLB optimization is pending
  LAI-LAMBDA-010 work and would need its own ADR for a container worker (ADR-064 item 9).
- Supported extensions are the explicit list `SUPPORTED_EXTENSIONS` in `validation.py`. Adding
  one is a code change with a test.
- Default upload limit 50 MB (`LAI_ASSET_MAX_UPLOAD_BYTES`). Treat any single model over about
  10 MB as needing review: the whole bundled world was about 3 MB when this was measured.

## 6. Validation

- **Binding:** ADR-035. Validation is server-side, in one service used by upload, import and
  publish. It never executes content and never follows a URI. Any `error` finding rejects.
- Checks include structure and bounds, embedded-only resources, supported extensions, mesh,
  node and accessor limits, a default scene with geometry, bounding box, and animation names.
  The list is in [ASSET_LIBRARY.md](../ASSET_LIBRARY.md) sections 5 and 21.3.
- **Asynchronous work.** Upload validation is synchronous on `main`. The `asset.inspect` job
  kind (`lai/apps/assets/jobs.py`) runs on the canonical `apps.jobs` path and returns read-only
  metadata kept on the job; it never rewrites a version (**Binding:** ADR-064 item 1: one job
  path, no second queue or consumer). `asset.validate_model` and the
  `LAI_ASSET_ASYNC_VALIDATION` flag (approved, default off) are not on `main` yet; they re-land
  on the same path (ADR-064 item 10).
- A background result never publishes and never changes a published version.

## 7. Materials and textures

- Generated assets are texture-free by design (flat vertex or material colour). See
  "Texture-free, by design" in the conventions doc.
- Runtime procedural surfaces (material presets, `DataTexture` patterns, world-scaled UVs,
  quality tiers) live in `react/src/features/island-map/three/runtime/visual/`. They need no
  image file and no licence.
- **Binding:** ADR-028. Procedural art is interim, not production art. A ticket that ships
  procedural surfaces records the production-art follow-up.
- A textured imported model must keep the texture test path working: see "The texture test
  path" in the conventions doc before landing the first textured file in a test.
- Prefer one material per mesh, power-of-two textures (non-power-of-two is a validation
  warning) and the smallest texture size that reads at tablet distance.

## 8. Animations

- **Binding:** THREE_WORLD_ASSET_CONVENTIONS.md and `validation.py`. Clip names come from the
  vocabulary in `react/src/features/island-map/three/assets/animationVocabulary.ts`, mirrored as
  `CLIP_VOCABULARY` in `validation.py`:
  `Idle, Walk, Talk, Wave, Point, Celebrate, ReactHappy, ReactConcerned, Open, Close, Activate`.
- A new version must keep every clip its asset already declares (`missing_clip` error).
- Exporter default take names (`mixamo.com`, `Armature|...|Layer0`, `Action.001`, `Take 1`) are
  flagged `generic_clip_name`. Rename each action to what it shows before upload. Do not map a
  generic clip to a state without having watched it.
- NPC models map runtime states (`idle`, `walk`, `talk`, ...) to real clip names through the
  variant's `animation_map`; see [npc-standard.md](npc-standard.md).
- Content for ages 3 to 8 has no combat clips. Strip unused clips at import (ASSET_SOURCING.md
  records 24 clips stripped to 3 for a character).

## 9. Units, pivots and collision

- **Binding:** THREE_WORLD_ASSET_CONVENTIONS.md. 1 unit = 1 metre, +Y up, ground-pivoted
  origin. Convert third-party scale and axes at import, not in the loader.
- **Binding:** ADR-028 (measurement 2) and THREE_WORLD_ASSET_CONVENTIONS.md "Collider proxy".
  Collision comes from authored data (`RectZone` to `Box3`), never from a mesh's bounding box. A
  replacement mesh must not change where a child can walk.
- Interaction targets use the scene root or a named part; add an `InteractionAnchor` node only
  when the silhouette needs one.
- Jumping, platforms and the player footprint are pending merge (PR #26, PR #36, PR #37). Assets
  that a child will stand on follow [jumping-standard.md](jumping-standard.md) once merged.

## 10. Licensing and sourcing

- **Binding:** ADR-028. Every third-party file in the repository has a row in
  [ASSET_LICENCES.md](../ASSET_LICENCES.md) (source, licence, attribution) in the same commit
  that adds it. Files not listed are original to the project.
- Prefer CC0 sources already vetted in [ASSET_SOURCING.md](../ASSET_SOURCING.md). Any licence
  with an attribution or share-alike obligation needs owner approval before import.
- Record the source archive's SHA-256 in the ledger so a re-download is verifiable.
- Assets uploaded to the Asset Library need the same provenance in the ticket; the Asset Library
  has no licence fields yet (ADR-035 acceptance lists them as follow-up work).
- No asset may depict a real person, use a brand, or contain text a child must read without a
  localizable alternative.

## 11. Binary files in Git

The current repository policy, from `.gitignore`, ASSET_SOURCING.md and ADR-030:

| Committed | Not committed |
|---|---|
| Generated `.gltf` pack from `npm run assets:generate` (`scripts/generate-world-assets.ts`) under `react/public/models/` | Third-party source archives (`assets/*.zip`, ignored; re-downloadable, hashes in ASSET_LICENCES.md) |
| Normalised third-party imports the importers write to `react/public/models/` (`npm run assets:import-kenney`, `npm run assets:import-characters`): five `.glb` and two character `.gltf` files listed in ASSET_LICENCES.md | Local Asset Library storage `lai/.asset-storage/` and child photo storage `lai/.child-photo-storage/` (ignored) |
| `content/models/npc-pip-pirate.glb`, an owner-supplied model loaded by `manage.py add_pip_pirate_variant` | Anything uploaded through Django Admin (lives in private storage, ADR-030) |

Rules:
- **Binding:** ADR-030. Admin-uploaded models do not go in Git.
- Do not commit new binaries outside the rows above without owner approval in the ticket.
- New production art goes through the Asset Library, not `react/public/models/`.

## 12. Publication and delivery

- **Binding:** ADR-035 items 6 and 7. Children get assets only through
  `GET /api/v1/children/<child_id>/assets/?ids=` (parent token, child-scoped) returning
  `resolved`, `unavailable` or `retired`. Drafts are indistinguishable from unknown ids.
- Delivery URLs are self-authorizing and short-lived (`django` signed token or `s3` presign).
  Re-resolve the id on a 403 or 404; never cache a URL as an identifier.
- **Binding:** ADR-045. Nothing reaches a child unpublished.

## 13. Storage

- **Binding:** ADR-035 item 4. `LAI_ASSET_STORAGE` selects `local` (development, under
  `lai/.asset-storage/`), `memory` (tests) or `s3`. Production refuses to start without `s3`.
- **Binding:** ADR-042. Game assets and child photos use separate private buckets. The asset
  library never stores child photos and the photo subsystem never uses asset publication.
- Keys are server-made: `assets/<models|images|audio>/<asset id>/<version uuid>/...`. No client
  supplies a key. Never put credentials or bucket names in Vite configuration.
- Creating, changing or deploying buckets is an owner approval (CLAUDE.md §18).

## 14. Derived artifacts (proposed, not on `main`)

A design for derived files (conversions, thumbnails, optimized models) exists on
`feature/lambda-derived-artifacts-design` (proposal) and `feature/lambda-derived-artifacts`
(LAI-LAMBDA-014 shared foundation). Neither is on `main`, and its ADR is not in the `main`
registry. Its key rules, which any future implementation must keep:
- processing never auto-publishes;
- a reviewed derivative is promoted by staff into a new, unpublished `AssetVersion` through the
  normal upload path, then published by the normal publish step;
- workers never write to the live delivery prefix.

## 15. Placeholders and procedural interim art

- **Binding:** ADR-028. Generated grey-box and runtime procedural surfaces are acceptable
  interim art. A placeholder ships only with a tracked follow-up for production art.
- A placeholder keeps the final asset's id, scale, pivot, clips and collision so the swap needs
  no code change.
- A missing or failed asset renders the bundled file or a neutral placeholder; it never blocks
  play or shows an error to a child.

## 16. Rendering performance

- Budget per Place, measured on the reference tablet, recorded in the adventure specification
  (`templates/adventure-specification.md`, "Performance"): draw calls, triangle count, texture
  memory and total download.
- Reuse loaded assets through the loader cache and `cloneAsset`; instance repeated scenery (see
  "Instancing" and "Runtime loading, cloning and the cache" in the conventions doc).
- Provide LOD variants for large scenery (`*-lod1`).
- Respect quality tiers (`renderQuality.ts`): LOW is chosen automatically on small devices.
  Tiers change appearance only, never gameplay.
- Dispose geometries, materials and textures on unmount.

## 17. Tests and checks

Follow [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) ("When to run which checks"). For asset
changes, run the relevant targeted tests, for example:

```bash
cd react && npx vitest run --maxWorkers=2 src/features/island-map/three/assets
.venv/bin/python -m pytest -q lai/apps/assets
```

A new bundled asset updates `manifest.ts` and passes `manifest.test.ts`. Asset Library changes
include validation tests for the new rule.
