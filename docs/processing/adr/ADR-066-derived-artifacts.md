# ADR-066: Derived artifacts (Option C), create-only worker writes and retention

**Status: Accepted (owner, 2026-11-18)** for exactly the decisions in the table below. Every
other point is listed under "Open decisions" and is not accepted. The `docs/DECISIONS.md` row is
added by the principal at integration.

Builds on ADR-033 (one backbone), ADR-045 (Django Admin owns the asset lifecycle), ADR-055,
ADR-061, ADR-062 and ADR-064. Interface: `../DERIVED_ARTIFACTS.md`. Design source:
`DERIVED_ARTIFACTS_INTEGRATION.md` and `proposals/ADR-PROPOSED-derived-artifacts.md`.

## Context

Four workloads produce files: audio transcoding and loudness, image conversion and thumbnails,
GLB thumbnails (staff browser capture) and GLB or texture optimization. Without one design each
would invent its own record, key scheme and IAM grant. `AssetVersion` is immutable once published,
asset keys live under the live `assets/` prefix, and workers were read-only on the asset bucket.

## Decision (accepted)

1. **Option C.** Derived files are staff-only `DerivedArtifact` records, not catalog versions. A
   reviewed deliverable is **promoted** by a staff member into a new unpublished `AssetVersion`
   through the existing validated upload path, then published through the existing explicit
   publication path. No workload publishes, retires or edits a version.
2. **Existing asset bucket, prefix `processing/artifacts/`.** Keys are
   `processing/artifacts/<env>/<job id>/<attempt id>/<logical id>.<ext>` and
   `processing/artifacts/<env>/capture/<artifact id>.<ext>`. Never `assets/`, quarantine, speech,
   child photos or the dev artifacts bucket. Never reachable through CloudFront or the resolver.
3. **Narrow, create-only worker writes.** A worker writes only to its own attempt's prefix with
   `IfNoneMatch="*"`; on a 412 it verifies the existing object's computed SHA-256 before treating
   the write as a success. Workers cannot delete or overwrite. The Django role (cleanup path)
   alone deletes.
4. **Retention.** 90 days for artifacts nobody reviewed, 30 days after supersession; promoted and
   referenced artifacts, artifacts of active jobs and held artifacts are protected. Orphaned
   objects are reconciled by a Django command, not by a bucket rule.
5. **Permissions.** A separate `assets.promote_derivedartifact` permission, distinct from publish.
   Review and capture are their own permissions. No public API.
6. **One consumer.** Results return on the one results queue and are verified and recorded inside
   the existing `jobs_consume_results` locked transaction (`apps.assets.artifact_results`).
7. **Kinds, queues, controls.** `asset.transcode_audio` (audio queue, `LAI_AUDIO_TRANSCODING`),
   `asset.convert_image` (image queue, `LAI_IMAGE_CONVERSION`) and `asset.optimize` (optimize
   queue, `LAI_GLB_MESHOPT` or `LAI_GLB_KTX2`) are submitted only when their control is on and
   their queue is configured; `LAI_THUMBNAIL_CAPTURE` gates staff capture. All default off.

## Consequences

Positive: one record, key scheme, permission model and IAM shape for every workload; no worker
write to a live prefix; published versions untouched; lineage kept without changing an immutable
field after publication. Negative: one model and migration, a promote step, and a cleanup command
to run. Reversible: until an artifact is promoted the rows and objects can be dropped without
touching the catalog.

## Implementation notes (Workstream A)

- Model `apps.assets.DerivedArtifact`, migration `assets.0003_derived_artifact` (depends on
  `assets.0002` and `jobs.0005`); jobs migration `jobs.0005_native_workload_kinds`.
- Roles and bounds are declared in code (`JobTypeSpec.artifact_roles`), so a message cannot
  introduce a role.
- Defence in depth for keys: the worker store refuses any key outside the attempt prefix;
  `ArtifactReference` refuses a key outside the reported attempt; Django re-checks the prefix, the
  extension against the content type and the namespace before it HEADs the object.
- A 403 from the store is never "missing" (a role or bucket-policy problem, not an absent object).

## Open decisions (not accepted; the conservative behaviour is implemented)

| ID | Decision | Implemented behaviour | Alternative |
|---|---|---|---|
| D5 | Streamed through Django versus presigned GET for previews and downloads | Streamed through Django for every type, with checksum verification; no presigned URL is issued | Presigned for large downloads |
| D7 | Stale results: drop rows or record them superseded | Drop the rows, keep the job outcome `stale_source` | Record `superseded` rows with a short expiry |
| D8 | S3 conditional-write (`If-None-Match`) support in the target Region | The client always sends `IfNoneMatch="*"`; the 412 path verifies by computed SHA-256. Key uniqueness by attempt id is the fallback if a Region ignores the header. Needs a Region spike by Workstream G before any deploy | Rely on key uniqueness only |
| O1 | Whether `accepted` artifacts expire | Protected until superseded or promoted | 90 days from acceptance |
| O2 | Whether a `pending_review` artifact may be promoted without a prior accept | Allowed (promotion needs the stronger permission) | Require `accepted` first |
| O3 | Orphan grace period | 48 hours | Shorter |
| O4 | Deleting a never-published source version that has artifacts | Refused until its artifacts are expired | Cascade-expire |
| O5 | Whether `texture.compressed` is promotable into the library | Not until ADR-070 adds a library format for KTX2 | A KTX2 asset family |
| O6 | Bucket lifecycle | No expiry rule; only abort-incomplete-multipart, noted for Workstream G | Noncurrent-version expiry after 30 days |
| O7 | Django instance role needs `s3:DeleteObject` and `s3:GetObject` on `processing/artifacts/*` (no write other than capture) | Code assumes it; infra is Workstream G | Separate cleanup role |
