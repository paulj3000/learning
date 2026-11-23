# LAI-LAMBDA-013 derived artifact design: where thumbnails and conversions live

Part of the LAI-LAMBDA-013 feasibility study (`LAI-LAMBDA-013-image-and-thumbnails.md`). Answers
WAVE4_HANDOFF decision W4-4 for this card. Design only; no model, migration or IAM change is made.

## 1. What the existing models allow

- **`catalog.ContentAsset`** is the one definition per asset id (ADR-030, ADR-035): `kind`,
  `status` (`ACTIVE`, `RETIRED`), `default_version`. Its `kind` fixes the file family it accepts
  (`formats.KIND_FAMILY`): a `character`, `prop`, `collectible` or `kit-piece` takes models only;
  `texture`, `image` and `sprite` take images only.
- **`assets.AssetVersion`** is one stored file: `storage_key` (unique), `sha256`, `size_bytes`,
  `format`, `metadata`, `validation_report`, lifecycle `DRAFT > VALIDATED | REJECTED`,
  `VALIDATED > PUBLISHED | REJECTED`, `PUBLISHED > RETIRED`, `RETIRED > PUBLISHED` (rollback).
  `IMMUTABLE_FIELDS` (`models.py:50-69`) freeze key, bytes, metadata and report once published;
  published versions are never deleted. There is no field linking a version to another version.
- **Keys** come only from `storage.object_key`:
  `assets/<models|images|audio>/<asset id>/<version uuid>/<stem>.<format>`; every storage call
  refuses other prefixes (`storage._check_key`), and the Django instance policy covers exactly
  those three prefixes (`infra/lib/assetStorageStack.ts:23`, `ASSET_KEY_PREFIXES`).
- **The resolver** (`resolver.py`) serves published versions only, through the definition's
  `default_version` or a pinned `asset-id@n`. Anything that is not an `AssetVersion` is never
  resolvable.
- **Workers** read the asset bucket only (`s3:GetObject`, `devPlatformStack.ts:1125`); the
  contract storage port refuses every write (`contract.py:58`). Any design in which a worker
  writes a file needs an **owner-approved write grant**.
- **`lai_processing`** already defines an `artifacts` store with attempt-scoped, create-only keys
  `processing/artifacts/<namespace>/<job id>/<attempt id>/<logical id>.<ext>` and an
  `ArtifactReference` (store, key, SHA-256, size, content type, source job and attempt,
  processor, profile). The canonical path does not use them yet.

## 2. Options

### Option A: every derived file is a new unpublished `AssetVersion`

- An image conversion becomes version n+1 of the same image asset, `VALIDATED`, never published
  automatically. A thumbnail of a model cannot be a version of the model's asset (wrong family),
  so each model would need a second `ContentAsset` of kind `image` to hold its thumbnails.
- **For:** one storage scheme, one admin, the existing publish and rollback rules; a promoted
  conversion is exactly what the game needs.
- **Against:** thumbnails pollute the catalog (one extra definition per model, and version
  numbers consumed by previews); every preview carries a publishing lifecycle it does not need;
  no lineage field exists (adding one changes the immutable model); if the worker creates the
  object, it needs write access to `assets/images/`, the live delivery prefix.

### Option B: a separate derived-object record linked to the source version

- A new model in `apps.assets`, for example `DerivedObject`: `source_version` (FK to
  `AssetVersion`, `PROTECT`), `purpose` (`thumbnail`, `conversion`), `format`, `width`, `height`,
  `size_bytes`, `sha256`, `storage_key` (outside `assets/`), `source_sha256`, processor and
  profile identity, `job` (FK to `ProcessingJob`, `SET_NULL`), `created_at`; immutable rows.
- **For:** previews stay out of the catalog and the resolver by construction; clear lineage;
  regenerable (a new processor version adds rows; old ones can be pruned); published versions
  untouched.
- **Against:** on its own it gives no way for a converted texture to reach the game, and serving
  derived objects to children would be a second catalog and delivery path (ADR-033 forbids it).

### Option C (recommended): staff-only previews as derived objects, reviewed deliverables as new unpublished versions

- **Thumbnails and previews** (images and models) are `DerivedObject` rows (Option B), shown only
  in Django Admin through a staff route with the same hardening as the media route
  (`nosniff`, `default-src 'none'; sandbox`, checksum verified, `assets.view_assetversion`).
- **Conversions** are produced as derived objects too. A staff member reviews one (side by side
  with the original) and chooses **Promote to new version**. Django, not the worker, reads the
  derived bytes and calls `services.upload_version` with them, so the new version passes exactly
  the synchronous validation every upload passes, gets a fresh `object_key`, is `VALIDATED` and
  unpublished, and records its lineage at creation in `metadata["derivedFrom"]` (source version
  id, source SHA-256, processor, profile, job id). Publishing stays the explicit, permission-
  checked action (ADR-045). A promoted file identical to an existing version is refused as
  `duplicate_version`, as today.
- **For:** previews never enter the catalog; deliverables enter it only through the existing,
  audited door; no worker ever writes under `assets/`; originals and published versions are never
  modified; lineage is recorded without changing any immutable field after publication.
- **Against:** one new model and migration; one extra staff click to promote a conversion.

## 3. Comparison

| Concern | A | B | C |
|---|---|---|---|
| Originals preserved | Yes | Yes | Yes |
| Published versions immutable | Yes | Yes | Yes |
| Previews kept out of catalog and resolver | No | Yes | Yes |
| Deliverables can reach the game | Yes | No | Yes, after review and explicit publish |
| Lineage | Needs a new field | Yes | Yes (rows, and `metadata["derivedFrom"]` on promoted versions) |
| Worker write scope | `assets/images/` (live prefix) | A derived prefix only | A derived prefix only |
| Schema change | Lineage field, extra definitions | One model | One model |
| Fits ADR-033 (one backbone) and ADR-045 (Admin authoring) | Partly | Partly | Yes |

## 4. Storage and access for Option C

| Item | Proposal | Needs |
|---|---|---|
| Where derived bytes live | The asset bucket (versioned, retained, encrypted like originals), outside `assets/` so never resolvable: `derived/<asset id>/<version uuid>/<purpose>-<side>.<ext>` for thumbnails Django stores itself (phase 1, staff browser capture), and the contract's artifacts prefix `processing/artifacts/<namespace>/<job id>/<attempt id>/<logical id>.<ext>` for worker outputs (phase 2). Keys made only by code, as `object_key` is today | Owner decision. Not the dev artifacts bucket: its `jobs/results/` expire after 7 days |
| Django write (phase 1) | Instance policy gains `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `derived/*` (create-only writes, as `S3AssetStorage.put` already does with `IfNoneMatch="*"`) | Owner-approved IAM change (the instance policy covers the three `assets/` prefixes only) |
| Worker write (phase 2) | Image worker role: `s3:PutObject` on `<asset bucket>/processing/artifacts/*` only, create-only (`IfNoneMatch="*"`, and an `s3:if-none-match` policy condition if available in the Region; to be verified), plus `s3:GetObject` on `assets/images/*` and `assets/models/*` | **Owner-approved IAM change** (workers are read-only today) |
| Missing-object semantics | `s3:ListBucket` scoped to `assets/` on the same role, as already recommended for the media worker in `CANONICAL_PATH.md` | Same approval |
| Django access (phase 2) | Instance policy gains `s3:GetObject` and `s3:DeleteObject` on `processing/artifacts/*` (to serve previews, promote and prune) | Owner-approved IAM change |
| Contract | The worker's storage port allows writes to the `artifacts` store only, for kinds that declare outputs; results carry `ArtifactReference`s; Django verifies each reference (key under the job's attempt prefix, size, SHA-256 re-read) before creating a row | Implementation card |
| Retention | Thumbnails kept while their source version exists; superseded rows (older processor version) pruned after 30 days; derived objects of a deleted never-published version deleted with it | Owner decision on retention |
| Orphans | `audit_storage` extended to the derived prefix (objects with no row older than a day) | Implementation card |

## 5. Shared with LAI-LAMBDA-010

The same record and promotion path serve 010's optimised GLBs and textures: an optimised file is
a derived object until a staff member promotes it to a new unpublished version, which the game
cannot load until the loader and validator support it (W4-6). The derived-object model is
**shared design owned by 013**; 010 adds its purposes (for example `optimized_model`), not a
second model.
