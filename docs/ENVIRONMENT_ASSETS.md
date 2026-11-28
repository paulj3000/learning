# Environmental image assets and materials (LAI-ENV-01 to 03)

Status: **Contract `env-assets/1` agreed by LAI 07 and LAI 04 on 2026-11-28** (LAI 04's answers
and amendments A1 to A4 are on Trello #273, and are applied here). It is not yet in effect: it
takes effect with PR #116. LAI 07 wrote it on 2026-11-27, on branch
`feature/environmental-image-assets` from `main` `d812ad71` (merged up to `c14392b0` on
2026-11-28).

- The owner decided D-1 to D-4 on 2026-11-28 (section 9). The design is approved.
- The ADR number 074 is reserved by registry-only PR #117. The draft decision text is in section
  13; its final text is written once LAI 04 agrees the interface.
- The Django side (sections 3 to 7) is implemented on this branch. It is not merged.
- The runtime side belongs to LAI 04. Nothing in `react/` or `game/` was changed.
- The interface is agreed (section 8). Any change to it now needs both owners and a new schema
  version.

Trello: parent #272 (LAI-ENV-00); #273 (01, audit and contract), #274 (02, Asset Library) and #275
(03, optimization and delivery). Downstream cards are #276 to #282.

Ownership:

- **LAI 07 owns** the asset schemas, metadata, Django Admin, uploads, validation, storage,
  publishing, the delivery contract, dependency tracking and image-processing integration.
- **LAI 04 owns** Three.js rendering: terrain, materials, sprites, billboards, decals, skyboxes,
  particles, texture caching and disposal, and runtime performance.

## 1. Audit: what existed on `main` `d812ad71`

Sources: the Django apps (`assets`, `catalog`, `regions`, `jobs`), `processing/`, `lambda/`,
`infra/`, `react/src/features/island-map/three/`, `react/src/api/assets/`, `game/`, and ADR-064
to ADR-071 (`docs/processing/adr/`).

Legend:

- **I**: implemented.
- **P**: partially implemented.
- **M**: missing.
- **L4**: needs LAI 04.
- **ADR**: needs an architecture decision.

| Requirement | State before this branch | Evidence | Status | This branch |
|---|---|---|---|---|
| Image asset kinds | `texture`, `image` and `sprite` kinds, image family, PNG/JPEG/WebP | `catalog/models.py` `ASSET_KINDS`; `assets/formats.py` `KIND_FAMILY` | I | Reused. No new image kind |
| Semantic roles (surface, map, sprite, decal, sky, particle) | None. Only the broad categories `texture` and `image` exist | `AssetCategory` | M | `ImageProfile.role` (section 3) |
| Image upload and validation | Bounded PNG/JPEG/WebP structure walk with CRCs and trailing-data refusal. Limits: 10 MB, 4096 px a side, 16 Mpx. EXIF/GPS warning | `validation_media.py`, ASSET_LIBRARY s.21.3, s.27 | I | Adds `hasAlpha` and `colourModel` to new versions' metadata |
| Transparency facts | Not recorded | `validate_image` stores width and height only | M | Recorded at upload (section 3.4) |
| Texture references and sampling | Region scenes name model ids. No field anywhere takes a texture, sprite, decal or sky id | `regionLayout.ts`, `locationManifest.ts` | M, L4 | Contract fields (section 5). Scene fields are LAI 04's |
| Material definitions | Engine-only `MaterialPresetSpec` (procedurally painted, no image files). Nothing in Django | `locationManifest.ts:495` | P (engine), M (library) | `material` kind and `MaterialDefinition` (section 4) |
| Region and scenery authoring | `WorldRegion.scene` JSON, seed-owned spatial layout (ADR-047 H, LAI-0805) | `regions/models.py` | I | Unchanged. No layout editing |
| Published asset delivery | Child-scoped resolver: signed URLs, `cache.key`, `media {width,height}` | `resolver.py`, ASSET_LIBRARY s.7, s.21.7 | I | Additive `render` block, material entries |
| Asset versioning | Immutable `AssetVersion`, publish, default, rollback | `assets/models.py`, `services.py` | I | Reused for every image |
| Content versioning (authored JSON) | `ContentRevision` draft, submit, publish, rollback (ADR-047) | `catalog/authoring.py` | I | Reused for materials |
| Dependency tracking | One registry, providers per app, `CheckClass`. The regions provider walks every `...AssetId` key | `assets/dependencies.py`, `regions/dependencies.py` | I | New `materials` provider, with indirect region reporting |
| Retirement protection | Retirement guard asks every provider. Fails closed | ASSET_LIBRARY s.25 | I | Covers textures used by materials |
| Local filesystem and S3 storage | `memory`, `local` and `s3` behind one interface. Keys under `assets/images/` | `storage.py` | I | Reused. No new prefix, no IAM change |
| Thumbnails and optimization | Pillow image function: convert, resize, thumbnails. `purpose=data` keeps values. Derived artifacts reviewed and promoted by staff. Control `LAI_IMAGE_CONVERSION=off` | ADR-068, `image_conversion.py`, `admin_image.py` | I (code), not deployed | Purpose defaults from the profile |
| Lambda image jobs | `asset.convert_image` worker, queue and IaC synthesized, not deployed | `lambda/image_worker`, `infra/lib/processingWorkers.ts` | I (code) | Untouched |
| Local image job runner | The `inline` backend has no runner for `asset.convert_image`. Pillow is deliberately not a Django dependency (ADR-068). Only `scripts/processing/local-demo.sh` runs it | `jobs/core/tasks.py`, `artifact_results.py:100` | M | Reported, not built (needs an owner decision, section 9) |
| KTX2 / Basis | Embedded glTF `KHR_texture_basisu` validator, optimizer and loader exist. `LAI_GLB_KTX2=off`. The client refuses standalone `.ktx2` URLs. `texture.compressed` role declared, never produced | ADR-070, `gltfDecoders.ts:98`, `GLB_OPTIMIZATION.md` | P, L4 | Not enabled (section 7) |
| Three.js texture loading | `mediaAssets.ts` `TextureLoader` with cache and dispose. Always sRGB. No wrap or repeat. **No scene calls it** | `mediaAssets.ts:35-105` | P, L4 | Contract says when to use linear |
| Image-based scenery | None. Sky and ground are flat colours; particles are coloured points. Castle surfaces are painted in code | audit of `runtime/visual/*` | M, L4 | LAI-ENV-04 to 06 |
| Provenance and licence | Pack imports record `metadata.provenance`. Admin uploads record nothing | `model_packs.py:152` | P | Upload form provenance and a `licence_unknown` warning (section 6) |
| Bundled engine references | Scene asset index lists model ids only (INFORMATIONAL) | `catalog/scene_usage.py`, #247 | P, L4 | Unchanged. Images in TS manifests are future work |

Facts that shaped the design:

1. Every binary already flows through `ContentAsset` and `AssetVersion`, with one storage
   interface and one resolver. A second image store would duplicate all of that, so none is
   added.
2. Authored JSON that must be versioned already has ADR-047. A material is authored JSON (map
   references and factors), so it uses `ContentRevision` instead of a new versioning scheme.
3. Per-asset staff settings that apply wherever an asset is drawn already have a pattern:
   `CollisionProfile` (one default row per asset, optional per-version override). Image render
   settings follow it.
4. The regions dependency provider already treats any `...AssetId` key in a 3D Area scene as a
   use. A scene naming `materialAssetId` or `skyAssetId` is therefore tracked with no regions
   change.

## 2. Architecture

```text
ContentAsset (kind texture | sprite | image)        ContentAsset (kind material, no files)
   │ versions: AssetVersion (PNG/JPEG/WebP, immutable)     │
   │ ImageProfile (role, colour space, tiling, sprite,     │ MaterialDefinition (Authorable)
   │   decal, sky, sheet; default + per-version override)  │   published body ← ContentRevision
   │                                                       │   maps → texture asset ids
   └──────────────► resolver: image entry + render ◄───────┘ resolver: material entry, maps inlined
                                     │
                     LAI 04 runtime adapter (Three.js; a Unity adapter later)
```

- **Kinds.** A new kind, `material`, accepts no file: an upload to it is refused
  (`no_files_for_kind`). Image kinds are unchanged:
  - `texture`: surfaces, material maps and sky;
  - `sprite`: sprites, decals, particles and backdrops;
  - `image`: pictures, backdrops and sky.
- **No new storage prefix, no IAM change, no new dependency.** No Pillow in Django, no
  Three.js type in Python.
- **Runtime independence.** Every field is plain data: metres, degrees, 0 to 1 anchors, enums
  and the colour space as `srgb` or `linear`. Nothing names a Three.js class. A Three.js adapter
  maps `ALPHA_BLEND` to `transparent: true`; a Unity adapter would map it to a transparent queue.
  Section 10 covers mobile.

## 3. Image profiles (`apps.assets.ImageProfile`)

There is one default row per image asset (`version` empty), plus an optional row for one
version, exactly like collision profiles. Without a profile, the resolver sends no `render`
block and the client keeps today's behaviour.

### 3.1 Roles

| Role | Kinds | For | Colour space default |
|---|---|---|---|
| `SURFACE` | texture | Tiling ground and wall colour (sand, grass, snow, ice, dirt, stone, wood, cobblestone, volcanic rock, asphalt), or a material's base colour or emissive map | sRGB |
| `MATERIAL_MAP` | texture | Non-colour data: normal, roughness, metalness, occlusion, ORM, opacity, height | linear (required) |
| `SPRITE` | sprite | Shells, starfish, plants, flowers, butterflies, minor scenery, educational visuals | sRGB |
| `DECAL` | sprite | Footprints, treasure X, runes, road markings, cracks, moss, arrows, clues | sRGB |
| `PARTICLE` | sprite | Fire, smoke, snow, rain, dust, magic, as a single image or a sheet | sRGB |
| `BACKDROP` | sprite, image, texture | Distant islands, mountains, cloud cards | sRGB |
| `SKY` | texture, image | Equirectangular panorama or cube map | sRGB |
| `PICTURE` | image | A flat picture (island art, UI) | sRGB |

### 3.2 Fields

| Field | Applies to | Meaning |
|---|---|---|
| `role` | all | Section 3.1 |
| `colour_space` | all | `SRGB` (colour) or `LINEAR` (data). `MATERIAL_MAP` must be `LINEAR`; the other roles must be `SRGB` |
| `data_channel` | MATERIAL_MAP | `NORMAL`, `ROUGHNESS`, `METALNESS`, `OCCLUSION`, `ORM` (R occlusion, G roughness, B metalness, the glTF packing), `OPACITY` (read from G, A2), `HEIGHT` (accepted; ignored by the web runtime in v1) |
| `normal_convention` | MATERIAL_MAP, NORMAL only | Required and must be `OPENGL` (+Y up, which Three.js expects). `DIRECTX` is refused: flip the green channel and upload again (A1). Sent as `render.normalConvention` |
| `alpha_mode` | all | `OPAQUE`, `MASK` (cut-out at `alpha_cutoff`) or `BLEND`. `MASK` and `BLEND` need an image with alpha |
| `alpha_cutoff` | MASK | 0 to 1, default 0.5 |
| `seamless` | SURFACE, MATERIAL_MAP | Staff confirm the image tiles without seams |
| `wrap` | SURFACE, MATERIAL_MAP | `REPEAT`, `MIRROR` or `CLAMP` |
| `metres_per_repeat` | SURFACE, MATERIAL_MAP | Physical size of one tile, in metres. Empty: one repeat per surface |
| `repeat_u`, `repeat_v` | SURFACE, MATERIAL_MAP | Default repeat count when `metres_per_repeat` is empty |
| `rotation_degrees` | SURFACE, MATERIAL_MAP, DECAL | Texture orientation, 0 to 359 |
| `world_width_m`, `world_height_m` | SPRITE, DECAL, PARTICLE, BACKDROP | Default world size. One may be empty and comes from the aspect ratio (of a frame, for a sheet) |
| `anchor_x`, `anchor_y` | SPRITE, BACKDROP | Pivot in image space, origin top left, 0 to 1. The default `[0.5, 1.0]` is bottom centre, standing on the ground (E-1, E-2) |
| `placement` | SPRITE, BACKDROP | `GROUND` (flat on the ground), `UPRIGHT` (fixed vertical card), `BILLBOARD` (faces the camera), `BILLBOARD_Y` (turns about the vertical only) |
| `decal_depth_m` | DECAL | Projection depth into the surface. Default 0.25 |
| `opacity` | DECAL, PARTICLE, BACKDROP | 0 to 1, default 1 |
| `sheet_columns`, `sheet_rows`, `frame_count`, `frames_per_second`, `loop` | SPRITE, PARTICLE, DECAL | Sprite sheet. Frames run left to right, top to bottom. 1 x 1 means no sheet |
| `blending` | PARTICLE | `NORMAL` or `ADDITIVE` |
| `sky_layout` | SKY | `EQUIRECTANGULAR` (2:1), `CUBE_STRIP` (6:1, faces left to right +X, -X, +Y, -Y, +Z, -Z) or `CUBE_GRID` (3:2: row 1 is +X, -X, +Y; row 2 is -Y, +Z, -Z; A3) |
| `recommended_usage`, `notes` | all | Staff text, never sent to children |

### 3.3 Validation (`ImageProfile.clean`, every rule a finding staff can read)

- The role must suit the asset's kind (section 3.1).
- Colour space must match the role. A data map is never sRGB.
- A `MASK` or `BLEND` profile on an image recorded as having no alpha is refused. It is only a
  warning on older versions, uploaded before alpha was recorded.
- Sky layouts check the version's dimensions: 2:1, 6:1 or 3:2, to within 1 %. The faces of a
  cube must come out square.
- A sheet's width and height must divide by its columns and rows, and `frame_count` may not
  exceed `columns × rows`.
- Sizes are positive, anchors and opacity are 0 to 1, the cutoff is 0 to 1, and repeats are 0.01
  to 1000.
- **Collision never comes from an image profile.** Sprites, decals, particles, backdrops and sky
  are decorative. The resolver attaches collision to models only, as today, so a gameplay object
  that should block must be authored as a placement with its own collision.

### 3.4 What upload records

New image versions' immutable metadata gain two fields:

- `hasAlpha`: PNG colour types 4 and 6, palette or grey with `tRNS`, a WebP `VP8X` alpha flag or
  `VP8L` alpha bit. JPEG never has alpha.
- `colourModel`: `grey`, `rgb`, `palette` or `cmyk`. A CMYK JPEG gets the warning `image_cmyk`.

Versions uploaded earlier have neither field. The resolver then sends `hasAlpha: null`. They are
never rewritten (published metadata is immutable).

## 4. Materials (`material` kind, `apps.assets.MaterialDefinition`)

- **Identity.** A `ContentAsset` of kind `material` holds the id, name, category, tags and
  status, and retires and reactivates through the existing actions. It has no versions and
  accepts no upload.
- **Content.** `MaterialDefinition` is `Authorable` (ADR-047). Its body is versioned as
  `ContentRevision`s of kind `material`: draft, optional submit and approve, publish, rollback.
  It is never deleted. Publishing re-validates everything and copies the body into the row.
  `texture_asset_ids` is kept for dependency queries.
- **Body** (every map optional; a material with no maps is factors only):

```json
{
  "materialId": "tr-wooden-dock",
  "maps": {
    "baseColor": {"assetId": "tr-dock-planks-albedo"},
    "normal": {"assetId": "tr-dock-planks-normal", "scale": 1.0},
    "orm": {"assetId": "tr-dock-planks-orm"},
    "emissive": null,
    "opacity": null
  },
  "factors": {
    "baseColor": 16777215, "roughness": 0.9, "metalness": 0.0,
    "emissive": 0, "emissiveIntensity": 1.0, "opacity": 1.0, "occlusionStrength": 1.0
  },
  "alphaMode": "OPAQUE", "alphaCutoff": 0.5, "doubleSided": false,
  "uv": {"metresPerRepeat": 2.0, "repeat": [1, 1], "rotationDegrees": 0, "offset": [0, 0]}
}
```

- **Slots:**
  - `baseColor` and `emissive` are colour and need `SURFACE` (sRGB).
  - `normal`, `roughness`, `metalness`, `occlusion`, `orm`, `opacity` and `height` are data and
    need `MATERIAL_MAP` with the matching `data_channel` (linear).
  - `orm` excludes separate `roughness`, `metalness` and `occlusion`.
  - Channels follow glTF and Three.js: occlusion R, roughness G, metalness B, opacity G (A2).
    A grey map works either way. `height` is accepted and ignored by the web runtime in v1.
  - A normal map must be OpenGL (A1).
  - A referenced texture must be an active `texture` asset. A texture without a profile is
    accepted for `baseColor` only (it defaults to sRGB). A data slot needs a profile, so a normal
    map is never sampled as colour.
- **Colours** are integers from 0 to 16777215, as in `environment.backgroundColor`.
- **UV:** `metresPerRepeat` wins over `repeat`. When a material does not set it, each map's own
  profile sampling applies.
- **Unpublished** maps do not block publishing a material (as with `artAssetId`). They resolve
  as `unavailable`, and the runtime draws that slot from its factor.

## 5. Delivery contract `env-assets/1` (additive to ASSET_LIBRARY s.21.7)

`GET /api/v1/children/<child>/assets/?ids=...` is unchanged for every existing field. These are
new, and existing clients ignore them.

**Image entries** (`family: "image"`):

- `media` gains `hasAlpha` (true, false or null) and `colourModel` (or null).
- A `render` block is sent when the asset has a profile:

```json
"render": {
  "schema": "env-assets/1",
  "role": "SURFACE", "colourSpace": "srgb", "dataChannel": null, "normalConvention": null,
  "alphaMode": "OPAQUE", "alphaCutoff": 0.5,
  "sampling": {"wrap": "REPEAT", "seamless": true, "metresPerRepeat": 1.5,
               "repeat": [1, 1], "rotationDegrees": 0},
  "sprite": null, "decal": null, "sheet": null, "sky": null, "particle": null
}
```

Each block is filled only for roles that use it:

- `sprite`: `{widthM, heightM, anchor: [x, y], placement}`.
- `decal`: `{widthM, heightM, depthM, opacity, rotationDegrees}`.
- `sheet`: `{columns, rows, frameCount, framesPerSecond, loop, frameWidth, frameHeight}`.
- `sky`: `{layout, faceSize}`.
- `particle`: `{blending, opacity}`.

**Material entries** (`kind: "material"`, `family: "material"`):

```json
{"ref": "tr-wooden-dock", "id": "tr-wooden-dock", "status": "resolved", "kind": "material",
 "family": "material", "version": 3, "revisionId": "<uuid>",
 "cache": {"key": "tr-wooden-dock@<revision uuid>", "immutable": true, "ttl": 3600},
 "material": {"schema": "env-assets/1", "factors": {...}, "alphaMode": "OPAQUE",
   "alphaCutoff": 0.5, "doubleSided": false, "uv": {...},
   "maps": {"baseColor": {<a full image entry, as above>}, "normal": {...}, ...}}}
```

- A map whose texture is unpublished or retired is sent as
  `{"id": ..., "status": "unavailable" | "retired"}` with no URL.
- A material with no published revision answers `unavailable`; a retired one answers `retired`.
- Materials have no URL. Their texture URLs carry the usual expiry, and a client re-resolves the
  material id for fresh ones.
- **Cache (A4).** A material's `cache.key` is `material@revision`, and `immutable` covers only the
  material body: factors, uv, alpha and which map ids fill which slots. It does not cover the
  resolved map entries. A map's texture can get a new default version without a new material
  revision, so the runtime caches each map by that map entry's own image `cache.key`, never by
  the material key.

**Fallbacks** (who does what):

| Situation | Library answer | Runtime (LAI 04) |
|---|---|---|
| Image unpublished, unknown or retired | `unavailable` or `retired`, no URL | Scene's authored fallback: flat colour, painted preset or no sprite. Never an error shown to a child |
| Material map unavailable | Slot `status: unavailable` | Draw the slot from its factor (base colour) or skip it (normal, ORM) |
| Material unavailable or retired | `unavailable` or `retired` | Scene's fallback colour or `MaterialPresetSpec` |
| No profile | No `render` | Current behaviour: sRGB, default sampling |
| URL expired (403 or 404) | Re-resolve | Re-resolve once, then fall back |
| `hasAlpha: null` (old version) | As stored | Trust `alphaMode` |

Today's client parser (`djangoAssetResolver.ts` `toPublished`) rejects an unknown family, so an
existing build treats a material as `not-published` and falls back. That is safe: no current
scene names a material.

## 6. Provenance and licence

- The Django Admin upload form takes optional provenance: source URL, creator or publisher, SPDX
  licence id (or `proprietary` or `original`), attribution text, source version, modification
  notes, and a "licence confirmed" box with who confirmed it.
- They are stored in `metadata.provenance` (the shape pack imports already use, so
  `artifact_promotion` keeps copying it to derived versions). The original filename is already
  recorded on every version.
- When an image is uploaded with no confirmed licence (no "licence confirmed by"), the Admin
  upload shows the warning `licence_unknown`. It is a page message; the file is still stored.
- **D-3 enforcement** (owner, 2026-11-28; `apps/assets/licences.py`). Only new environmental
  assets are affected; there is no global restriction:
  - A version of an image asset that has an image profile publishes only with a verified,
    permitted licence. Otherwise it is refused with `licence_required` and left `VALIDATED`, not
    rejected.
  - Verified means `provenance.licenceStatus` is `confirmed`. Permitted means `CC0-1.0`,
    `original` or `proprietary` (a commercial licence with no in-product attribution duty).
  - A material cannot publish a map whose texture's default version is not licensed.
  - Saving an image profile on an unlicensed image warns `licence_required`. The image keeps
    resolving; nothing is unpublished.
  - Images without a profile (every existing image) publish and resolve exactly as before, and
    only warn.
- **Legacy remediation** is a separate task (Trello #283, LAI-ENV-02a):
  - a read-only report of image versions without verified provenance;
  - back-filling provenance as new versions (published metadata is immutable);
  - then an owner decision on enforcing the licence globally.
- **ADR-028 still applies:** CC-BY and other attribution licences are barred until an in-product
  attribution surface exists. CC0, original work and commercially licensed files with no
  attribution duty are fine.
- Production images are never committed to Git. Test fixtures are tiny, generated in code and
  original.

## 7. Image processing and KTX2

The existing Pillow function (ADR-068) already does everything LAI-ENV-03 lists:

- bounded decode, decompression-bomb refusal and safe handling of malformed images;
- alpha kept;
- sRGB for artwork, with data values preserved (`purpose=data`: lossless, untagged, band-wise
  box filter);
- WebP, PNG and JPEG output, thumbnails, and EXIF and GPS removed from every output;
- derivatives that are versioned, reviewed and promoted, with the original never changed.

**Local development (D-2, owner 2026-11-28).** Pillow stays out of Django (ADR-068).

- The Admin's Convert, Resize and Thumbnail actions therefore do not work in a local Django
  server. Keep `LAI_IMAGE_CONVERSION=off` locally; the actions then answer "Image conversion is
  switched off".
- The `inline` jobs backend has no runner for `asset.convert_image`.
- `scripts/processing/local-demo.sh` is the local route. It runs the real Pillow converter when
  Pillow is importable (`LAI_DEMO_PILLOW_SITE`), on synthetic images, with in-memory SQS and S3
  and its own database.
- It does not convert a file uploaded to the local Admin. For local content, prepare the image
  in an editor (sRGB colour, linear data maps, metadata removed) and upload the result.

This branch only connects it to profiles. The Convert and Resize actions default `purpose` to
`data` when the version's profile is a `MATERIAL_MAP` (and to `artwork` otherwise), so a normal
map is not colour-managed by mistake. Nothing runs in the web process.

KTX2 stays off:

- The client accepts KTX2 only inside glTF. A standalone `.ktx2` texture would need:
  - a format row and a validator here;
  - a producer for the declared `texture.compressed` role;
  - LAI 04's loader to accept the URL;
  - ADR-070's open gates closed: browser transcode, tablet acceptance and ETC1S quality.
- Until then, WebP is the compressed delivery format for environment images (section 8, E-6).

## 8. Interface decisions with LAI 04 (agreed 2026-11-28)

LAI 04 agreed all ten on Trello #273 (2026-11-28), reviewing `26b69273` against the engine code
on `main`. It made four amendments, applied in sections 3 to 5:

- **A1:** normal maps must be OpenGL, and `render.normalConvention` is sent.
- **A2:** an opacity map is read from G.
- **A3:** the 3:2 grid's cell order is fixed.
- **A4:** cache scope (section 5).

Notes from LAI 04, recorded as part of the agreement:

- **E-1:** rotation is about the texture centre. The runtime computes repeat per mesh as size /
  `metresPerRepeat`.
- **E-2:** the default anchor is written `[0.5, 1.0]`.
- **E-5:** v1 decals are ground quads with polygon offset. `depthM` is used only by projected
  decals, which come later.
- **E-7:** bare `assetId` keys are tracked too (tested).
- **E-10:** the client will check kind per field when materials land.

The runtime work is LAI 04's, on the existing card #276 (LAI-ENV-04), not a new one: loader
colour space and sampling, the material parser and builder, map caching and the catalog kind
check. It is not started; it waits for #116 to merge and for the owner to schedule it.

| # | Question | Agreed |
|---|---|---|
| E-1 | Field names and units in `render` and `material` (section 5) | As written: metres, degrees, 0 to 1 anchors, image-space origin top left |
| E-2 | Sprite placement modes and default anchor | `GROUND`, `UPRIGHT`, `BILLBOARD`, `BILLBOARD_Y`; default anchor `[0.5, 1.0]` (bottom centre, top-left image space) |
| E-3 | Cube map layouts and face order | Equirectangular plus 6:1 strip and 3:2 grid, in the order +X, -X, +Y, -Y, +Z, -Z. **A3:** 3:2 grid row 1 +X, -X, +Y; row 2 -Y, +Z, -Z; the strip runs left to right |
| E-4 | Single roughness or metalness maps: which channel is read | G for roughness, B for metalness, R for occlusion (glTF). Grey images work either way. **A2:** opacity is read from G. **A1:** normal maps must be OpenGL, sent as `render.normalConvention`. Height is accepted and ignored in v1 |
| E-5 | Decal projection (mesh decal, projected box, or a ground quad for flat ground) | Runtime choice; the library sends size, depth, opacity and rotation only |
| E-6 | KTX2 for environment images | Not before ADR-070's gates. WebP until then |
| E-7 | How scenes reference these (field names in `ThreeLocationManifest` and Django `scene`) | Use `...AssetId` names (`materialAssetId`, `skyAssetId`, `spriteAssetIds`), so the regions dependency provider tracks them with no change |
| E-8 | Colour space. `mediaAssets.ts` always sets `SRGBColorSpace` | Rule (owner follow-up 2, 2026-11-28): **colour images are sRGB; data maps are never sampled or colour-managed as sRGB.** In Three.js terms: `render.colourSpace === "linear"` (every `MATERIAL_MAP`: normal, roughness, metalness, occlusion, ORM, opacity, height) → `texture.colorSpace = NoColorSpace`; `"srgb"`, or no `render` block at all → `SRGBColorSpace`. Wrap, repeat and rotation come from `sampling`. The library side guarantees this: a material map must be linear (form rule and database constraint); a material's data slot accepts only a matching material map; conversion of a map is lossless and untagged. The loader change is LAI 04's |
| E-9 | Bundled image fallbacks in TS manifests (#247) | Not in v1. The scene asset index would need image ids first |
| E-10 | The region catalog (`game_sessions/play_state.py` `region_catalog`) lists every `...AssetId` a scene names, with `deliverable` true only for a default version or a bundled file. A material has neither | **Done** (owner follow-up 3, 2026-11-28): for kind `material`, `deliverable` is true once its content has a published revision. A material asset with no definition row, or with no published revision, is false. Tested with a nested scene. LAI 04 to confirm the client treats `kind: "material"` catalog rows correctly |

## 9. Owner decisions

| # | Question | Owner decision (2026-11-28) |
|---|---|---|
| D-1 | Accept this design (a material kind on `ContentAsset` with ADR-047 revisions, and `ImageProfile` on the CollisionProfile pattern) and reserve an ADR number on `main` | **Approved.** Number 074 confirmed free on `main` `c14392b0` and every remote branch; reserved by PR #117 (registry only, for the owner to merge). Final ADR text after LAI 04 agrees the interface |
| D-2 | Local image conversion: the `inline` jobs backend cannot run `asset.convert_image` without Pillow in Django | **Approved.** Pillow stays out of Django; `local-demo.sh` is the local route; limitations in section 7 |
| D-3 | Unknown licences | **Approved with conditions.** Existing images stay compatible and warn. New environmental assets need a verified, permitted licence before published realm content uses them. No global restriction. A separate task handles legacy remediation. Implemented as in section 6 |
| D-4 | Environment images above 4096 px a side or 16 Mpx (a large sky) | **Approved.** The limits stay; raising them needs benchmarks and approval |

## 10. Mobile (Unity) compatibility

- The canonical data is the stored file (PNG, JPEG or WebP, never a runtime format) plus profile
  and material JSON in plain units. A future Unity adapter reads the same resolver answer.
- Runtime-specific derivatives (for example KTX2 for one GPU family) would be derived artifacts
  of the same version, promoted as new versions or kept as artifacts. Originals are never
  duplicated or replaced.
- No Unity code is part of this work.

## 11. Staff guide: upload, configure, publish, reference

1. **Texture or sprite.**
   1. Go to Catalog > Content assets > Add.
   2. Set the id (for example `tr-beach-sand`), the kind (`texture` for surfaces and maps,
      `sprite` for sprites, decals and particles, `image` for pictures or a sky), a category and
      tags.
2. **File.**
   1. Go to Asset versions > Add and upload the PNG, JPEG or WebP.
   2. Fill in provenance (section 6).
   3. Read the findings (`not_power_of_two`, `image_metadata_present`, `image_cmyk`) and the
      `licence_unknown` message.
3. **Profile.**
   1. Go to Asset library > Image profiles > Add and choose the role (Asset publishers).
   2. Fill in only the fields for that role (section 3.2). The page shows a tiling preview for
      surfaces and the frame grid for sheets.
4. **Optimize (optional, when `LAI_IMAGE_CONVERSION` is on).**
   1. Run Convert or Resize from the version list. A material map defaults to data.
   2. Review and promote the output on its artifact page.
5. **Publish.** Publish the version and make it the default (publisher permission).
6. **Material.**
   1. Create a content asset of kind `material`.
   2. Go to Asset library > Material definitions > Add and pick the asset.
   3. On its page, choose "Edit content (start a draft)". Enter texture ids in the slots you need
      (leave the others empty) and set the factors. Saving checks every slot.
   4. Publish the draft from its content-version page. This needs the Content publishers group
      (`ensure_content_roles`); drafting needs Content editors.
7. **Reference.** Scenes name asset ids only, never URLs. The field names are LAI 04's (E-7).
   LAI 01 wires them into Treasure Rush.
8. **Replace.** Upload a new version, publish it and make it the default. Roll back from the
   version list. For a material, edit a new draft and publish it, or roll back.
9. **Retire.** Use Retire on the asset. The page lists every use, including materials and the 3D
   Areas that use those materials, and refuses while published content depends on it.

## 12. Treasure Rush pilot (handoff to LAI 01, card #279)

| Asset (proposed id) | Kind | Role and key settings |
|---|---|---|
| `tr-beach-sand` | texture | SURFACE, seamless, REPEAT, about 2 m per repeat |
| `tr-wet-sand` | texture | SURFACE, seamless. Optionally a material with a lower roughness factor |
| `tr-grass` | texture | SURFACE, seamless |
| `tr-rock` | texture | SURFACE, seamless. Optional `tr-rock-normal` MATERIAL_MAP NORMAL |
| `tr-wooden-dock` | material | baseColor `tr-dock-planks-albedo` (SURFACE). Optional normal and ORM maps (MATERIAL_MAP) |
| `tr-seashell-*`, `tr-starfish-*` | sprite | SPRITE, BLEND or MASK, GROUND or BILLBOARD_Y, about 0.2 to 0.3 m wide, bottom-centre anchor |
| `tr-footprint` | sprite | DECAL, MASK, about 0.3 m by 0.15 m, depth 0.1 |
| `tr-treasure-x` | sprite | DECAL, BLEND, about 1 m square |
| `tr-distant-island-*` | sprite | BACKDROP, UPRIGHT or BILLBOARD_Y, tens of metres wide |
| `tr-clouds-*` | sprite or image | BACKDROP (cards), or SKY EQUIRECTANGULAR |
| `tr-campfire-flame` | sprite | PARTICLE or SPRITE with a sheet, ADDITIVE, BILLBOARD |
| `tr-smoke-puff` | sprite | PARTICLE, NORMAL blending, BLEND |

Every file needs a confirmed licence that ADR-028 allows, before it is published. None is
sourced yet. Treasure Rush gameplay and layouts are not changed by this work.

## 13. Decision record, final text (number 074, reserved by PR #117)

This is the final text, written after LAI 04 agreed the interface on 2026-11-28. It uses the
placeholder `ADR-NNN` because the registry check refuses a number until its reservation is on
`main`. Once the owner merges PR #117, this text moves into `docs/DECISIONS.md` as ADR 074, and
its registry row replaces the `Reserved` one. That move is a commit on this branch; `main` is
never edited directly.

```text
## ADR-NNN: Environmental image assets and materials in the Asset Library

Status: Proposed for acceptance (design approved by the owner, D-1, 2026-11-28; interface
agreed by LAI 07 and LAI 04 on 2026-11-28, Trello #273). Accepted when the owner merges it.

Context. Realms need image-based environment detail (surfaces, sprites, decals, skies,
particles) and reusable materials, not a model for every detail. The Asset Library already
stores, validates, versions, delivers and protects image files; ADR-047 already versions
authored JSON; ADR-068 already converts images off the web server.

Decision.
1. Images stay ContentAsset + AssetVersion (kinds texture, sprite, image). How an image is drawn
   is an ImageProfile (asset default plus optional per-version override, the CollisionProfile
   pattern): role, colour space, alpha, sampling, sprite/decal/particle sizing, sheets, sky
   layout, and normal convention (OpenGL only). Profiles never produce collision. Image space
   has its origin at the top left; the default sprite anchor is [0.5, 1.0].
2. A material is a ContentAsset of kind material that holds no file, with an ADR-047
   authorable MaterialDefinition (kind "material") whose published body names texture asset
   ids by slot (glTF and Three.js channels: occlusion R, roughness G, metalness B, opacity G)
   plus factors and UV defaults. A material's cache key covers its body only; each map is
   cached by its own image key.
3. Delivery is additive to the child-scoped resolver (contract env-assets/1): image entries
   gain media.hasAlpha, media.colourModel and a render block; material entries inline their
   maps' image entries. Colour images are sRGB; data maps are linear and never colour-managed
   (the runtime uses NoColorSpace for them).
4. Scenes reference these by ids under keys ending in AssetId / AssetIds, so the existing
   regions dependency provider protects them (bare assetId keys too); the region catalog marks a
   material deliverable once published; a new authoritative materials provider protects
   textures used by published materials and reports the 3D Areas reached through them.
5. New environmental assets need a verified, permitted licence (CC0-1.0, original,
   proprietary; attribution licences barred by ADR-028) before published content uses them;
   existing images are unaffected.
6. No new storage prefix, IAM grant, dependency or runtime-specific type; KTX2 for standalone
   images waits for ADR-070's gates.

Consequences. One catalog, one storage path and one versioning model serve every asset family;
runtimes (Three.js now, a possible Unity adapter later) read the same plain-unit answer. LAI 04
owns rendering, scene fields and the client parser for material entries.
```
