# Derived artifacts: the frozen shared foundation (LAI-LAMBDA-014)

Status: interface freeze for Workstream A of the owner-approved completion work (2026-11-18).
Decision: [ADR-066](adr/ADR-066-derived-artifacts.md). Conventions:
[COMPLETION_INTEGRATION.md](COMPLETION_INTEGRATION.md). Design source (reused, now superseded
by this document where they differ): `DERIVED_ARTIFACTS_INTEGRATION.md` and
`proposals/ADR-PROPOSED-derived-artifacts.md` on `feature/lambda-derived-artifacts-design`.

Audio (C), image (D), staff thumbnail capture (E) and optimization (F) integrate against the
names in this document. Do not rename them; ask Workstream A for a change instead. Nothing here
deploys, calls AWS or publishes an asset.

## 1. What a derived artifact is

A file produced from a validated staff asset version (a transcode, a conversion, a thumbnail, an
optimized model) and stored privately under `processing/artifacts/` in the existing asset bucket.
Django records it as a `DerivedArtifact` row only after verifying the object. It is staff-only: it
is viewed in Django Admin, never served to the game, never resolvable, and never public. It
reaches the game only when a staff member **promotes** it into a new, unpublished `AssetVersion`
and then publishes that version through the existing publication path (which keeps its own
gate). Nothing publishes automatically. No row has a "published" state.

## 2. Storage keys (private)

| Producer | Key |
|---|---|
| Worker job output | `processing/artifacts/<env>/<job id>/<attempt id>/<logical id>.<ext>` |
| Staff browser capture | `processing/artifacts/<env>/capture/<artifact id>.<ext>` |

`<env>` is the contract namespace (`LAI_ENVIRONMENT`, `local` when unset). Only trusted
identifiers appear: UUIDs Django generated, a worker-chosen logical id matching
`^[a-z0-9]+(?:[-_][a-z0-9]+)*$`, and an extension that must agree with the declared content type
(`CONTENT_TYPE_EXTENSIONS` in `lai_processing/contracts/job_types.py`). No file name, child name or
user text is ever part of a key. Keys are create-only and immutable: a retry is a new attempt and
therefore a new key.

Builders: `lai_processing.contracts.identifiers.artifact_key / artifact_prefix` (worker and
Django), `apps.assets.artifact_storage.capture_key(artifact_id, ext)` (Django capture).

## 3. Roles, content types and bounds (declared in `JobTypeSpec.artifact_roles`)

`lai_processing.contracts.job_types.ArtifactRoleSpec(role, content_types, max_size_bytes,
max_count, promotable, producer)`. Django rejects any artifact outside its declaration.

| Job type (kind) | Role | Content types | Max size | Max files | Promotable |
|---|---|---|---|---|---|
| `asset.transcode_audio` | `audio.transcoded` | `audio/ogg`, `audio/mpeg` | 20 MiB | 2 | Yes |
| | `audio.report` | `application/json` | 64 KiB | 1 | No |
| `asset.convert_image` | `image.converted` | `image/webp`, `image/png`, `image/jpeg` | 8 MiB | 3 | Yes |
| | `image.resized` | same | 8 MiB | 4 | Yes |
| | `image.thumbnail` | same | 512 KiB | 3 | No |
| `asset.optimize` | `model.optimized` | `model/gltf-binary` | 32 MiB | 1 | Yes (publication gated by ADR-070) |
| | `texture.compressed` | `image/ktx2` | 16 MiB | 4 | Yes (gated by ADR-070) |
| | `model.optimize_report` | `application/json` | 64 KiB | 1 | No |
| staff capture (no job) | `model.thumbnail` | `image/webp`, `image/png` | 512 KiB | 1 per capture | No |

Max files is per result (per attempt). `image/ktx2` is accepted by the contract content-type
pattern; it is **not** an Asset Library upload format, so a `texture.compressed` artifact is not
promotable into an image asset until ADR-070 adds one (promotion refuses a content type with no
library format: `format_not_supported`). Bounds are ceilings for Django's verification; a workload
may declare tighter limits in its profile.

## 4. Result contract (what a worker returns)

A worker returns the ordinary schema-1 `ProcessingJobResult` (ADR-061) with
`status=succeeded`, a `verdict`, an `input` that is `verified`, and `artifacts`: a tuple of
`ArtifactReference` (`lai_processing/contracts/artifacts.py`), one per file:

```
ArtifactReference(artifact_type=<role>, logical_id=<stable id, e.g. "opus", "thumb-256">,
                  ref=ObjectRef(StoreName.ARTIFACTS, key, version_id, namespace),
                  content_type, size_bytes, sha256, source_job_id, source_attempt_id,
                  processor=ProcessorIdentity(id, semver), profile=ProfileRef(id, version))
```

Worker rules:

1. Write only through `ProcessingContext.write_artifact(logical_id=, artifact_type=<role>, data=,
   content_type=, extension=)`. It confines the key to the attempt prefix and records the
   reference. Never write another key, store or bucket.
2. Logical ids are stable per role and side (a retry yields the same logical ids under new keys).
3. A result is all or none per attempt. A failed attempt reports no artifacts; any object it
   already wrote is an orphan that the retention sweep removes.
4. Tool versions go in `result.metadata` (they become safe artifact metadata), never in a key.
5. Never process child audio, photos or text. Inputs are validated staff asset versions.

### Worker storage port (create-only, `lambda/jobs_worker/artifact_store.py`)

`S3ObjectStore(client, bucket, namespace, *, attempt_prefix=None)` implements
`lai_processing.ports.storage.ObjectStorage` for the one asset bucket:

- `head/open/read` for `StoreName.ASSETS` and `StoreName.ARTIFACTS`; a 403 is
  `StoragePermissionDenied`, never "missing".
- `put` only for `StoreName.ARTIFACTS`, only inside `attempt_prefix` (when given: the attempt's
  own directory; always: this namespace and not `capture/`), with `IfNoneMatch="*"` and a
  `ChecksumSHA256`. On `412 PreconditionFailed` (or `409 ConditionalRequestConflict`) it reads the
  existing object, **computes** its SHA-256 (the ETag is never trusted) and returns success only
  when it equals the bytes being written, otherwise raises `ObjectExists`. Nothing else is
  written, deleted or overwritten. `delete` always raises `StoragePermissionDenied`.
- `aws.Runtime.artifact_storage(job_id, attempt_id) -> S3ObjectStore` builds it bound to the
  attempt for a native worker (zip functions import `jobs_worker`).

## 5. Feature controls, queues, kinds

All off by default; submission is refused unless the control is `on` and, on the `sqs` backend,
the queue URL is configured (`apps.jobs.workloads`). Refusal creates no `ProcessingJob`, no outbox
row and no message. Dispatch routes each kind to its own queue; a job whose control was switched
off after it was committed is failed `workload_disabled` instead of sent.

| Kind (`JobKind`) | `JobQueue` | Queue URL setting | Control |
|---|---|---|---|
| `asset.transcode_audio` | `audio` | `LAI_JOBS_AUDIO_QUEUE_URL` | `LAI_AUDIO_TRANSCODING` |
| `asset.convert_image` | `image` | `LAI_JOBS_IMAGE_QUEUE_URL` | `LAI_IMAGE_CONVERSION` |
| `asset.optimize` | `optimize` | `LAI_JOBS_OPTIMIZE_QUEUE_URL` | `LAI_GLB_MESHOPT` or `LAI_GLB_KTX2` (`variant=`) |
| none (staff upload) | none | none | `LAI_THUMBNAIL_CAPTURE` |

Results of every kind return on the one results queue to the one `jobs_consume_results`.
Migration `jobs.0005_native_workload_kinds` (depends on `jobs.0004`) adds the kinds and queues.

## 6. Django submission (the one helper)

```python
from apps.jobs.workloads import submit_workload, workload_enabled, thumbnail_capture_enabled
workload_enabled(kind, variant=None) -> bool
submit_workload(kind, payload, *, variant=None, user=None, subject=None, job_id=None,
                idempotency_key="") -> ProcessingJob   # raises WorkloadUnavailable / JobsDisabled
```

and the shared request builder for asset-version workloads:

```python
from apps.assets.artifact_jobs import submit_derived_job
submit_derived_job(version, *, kind, profile: tuple[str, int], processor_version: str,
                   options: Mapping = {}, limits: ResourceLimits | None = None,
                   variant: str | None = None, user=None) -> ProcessingJob
```

It builds the ADR-061 request (namespace, subject = the version uuid, input = the stored object
with its recorded SHA-256 and size, asset context, a 72-hour expiry, a fresh attempt id, the
`ik1:` idempotency key including `processor_version`), takes the asset row lock, returns the
existing unfinished or recorded job for the same logical work, caps resubmissions at
`LAI_ASSET_VALIDATION_MAX_ATTEMPTS`, and submits through `submit_workload`. The caller supplies the
options already resolved against the profile.

## 7. Result application (inside the `jobs_consume_results` locked transaction)

`apps.assets.artifact_results` is the handler module registered for the three kinds
(`apps.jobs.services.HANDLER_MODULES`). `apply(job)` runs once, under the job row lock, in the
transaction that records the result, and calls:

```python
apply_artifact_result(job) -> str   # a safe outcome code, also stored in job.subject_outcome
```

Checks, in order, each failing closed with **no rows created** and a safe code (no file names in
logs):

| Check | Outcome on failure |
|---|---|
| job completed; result is a valid ADR-061 result of exactly this request (job, attempt, key, type, namespace, profile, verified input) | `processing_failed`, `result_invalid`, `job_mismatch`, `attempt_mismatch`, `key_mismatch`, `identity_mismatch`, `profile_mismatch`, `input_mismatch` |
| source version exists and is not rejected | `stale_source` (deleted or rejected source) |
| source identity equals the request (asset, version, storage key, SHA-256, size), namespace | `stale_source` for a changed key, checksum or size; `asset_mismatch`, `namespace_mismatch`, `subject_mismatch` |
| processor and profile equal the result's; processor not older than this build's (when Django knows the processor) | `processor_outdated` |
| every reference: attempt prefix, store, extension agrees with content type, declared role, content type allowed, size within the role bound, count within the role bound, unique logical id, processor and profile equal the result's | `artifact_invalid` |
| every object: exists, size equals by HEAD, SHA-256 equals by streamed read (bounded by the role bound) | `artifact_invalid` (missing or mismatch); a storage fault or a 403 is **not** an outcome: the application raises `ArtifactStorageUnavailable`, the transaction rolls back and the message is retried |
| otherwise | `artifacts_recorded` (or `result_recorded` when the result carries no artifacts) |

Rows are created with `get_or_create` on `(job id, attempt id, logical id)`; a duplicate delivery
creates nothing. Older `pending_review` and `accepted` rows of the same source version, role,
logical id and profile id become `superseded` (30-day deadline). Stale results drop their rows and
keep the job outcome (open decision D7). A published or retired source version is not stale: the
artifact is still useful for review, and promotion creates a new unpublished version.

A workload that needs subject-specific behaviour keeps its own handler module (replace its entry
in `HANDLER_MODULES`), calls `apply_artifact_result(job)` for the artifacts and records its own
outcome code. A workload whose processor Django knows registers
`artifact_results.PROCESSOR_VERSION_RESOLVERS[job_type] = fn(profile_id, profile_version) ->
(processor_id, version)` so an older processor's result is `processor_outdated`.

## 8. The `DerivedArtifact` model (`apps.assets`, migration `assets.0003_derived_artifact`)

| Field | Meaning |
|---|---|
| `id` | UUID primary key (also names a capture's key) |
| `source_version`, `asset` | FKs to `AssetVersion` and `catalog.ContentAsset`, both `PROTECT` |
| `source_sha256`, `source_storage_key` | The source bytes the processor read (identity at record time) |
| `job` | FK `ProcessingJob`, `PROTECT`, nullable (null for a capture and for expired tombstones); `job_id_text`, `attempt_id` keep the lineage as plain UUIDs |
| `logical_id`, `role` | The worker's logical id and the declared role |
| `producer` | `job` or `staff_capture`; `captured_by` for captures |
| `processor_id`, `processor_version`, `profile_id`, `profile_version` | Provenance |
| `sha256`, `size_bytes`, `content_type`, `storage_key` (unique) | Verified before the row exists |
| `state` | `pending_review`, `accepted`, `rejected`, `superseded`, `promoted`, `expired`, `deleted` (never published) |
| `reviewed_by/at`, `superseded_by/at` | Review and supersession |
| `promoted_version` | Nullable one-to-one `PROTECT` FK to the `AssetVersion` created by promotion; `promoted_by/at` |
| `expires_at`, `retention_hold`, `object_deleted_at` | Retention |
| `metadata` | Safe JSON facts: tool versions, dimensions, duration (never names or paths) |

Constraints: unique `(job_id_text, attempt_id, logical_id)`; unique `storage_key` under
`processing/artifacts/`; valid state, producer and role-shape; `promoted` iff `promoted_version`
is set; `superseded` has `superseded_at`; `accepted` and `promoted` have no `expires_at` and
`pending_review`, `rejected`, `superseded` have one; a job-produced row has a job unless it is a
tombstone (`expired` or `deleted`); a capture has no job. Identity fields are immutable after
creation (`ImmutableArtifact`). Transitions:

```
pending_review -> accepted | rejected | superseded | promoted | expired
accepted       -> rejected | superseded | promoted
rejected       -> accepted | expired
superseded     -> expired
expired        -> deleted
promoted       -> (terminal)
```

## 9. Staff review, preview, permissions (Django Admin only, no public API)

Permissions on `assets.DerivedArtifact`: `view_derivedartifact` (list, detail, preview, download),
`review_derivedartifact` (accept, reject, hold), `promote_derivedartifact` (promote; separate from
publish), `capture_derivedartifact` (record a staff capture). There is no add, change or delete
permission in the UI. `manage.py ensure_asset_roles` grants view, review and capture to "Asset
editors" and additionally promote to "Asset publishers". All metadata is escaped. Admin history records accept, reject, hold and
promote with who and what.

Previews are streamed **through Django** (decision D5 stays open for presigned downloads): the
admin route `admin:assets_derivedartifact_media` re-checks permission and re-verifies the
checksum while streaming, sends `X-Content-Type-Options: nosniff`, `Content-Security-Policy:
default-src 'none'; sandbox`, `Cache-Control: private, no-store`, and serves only image and
audio content types inline (anything else as an attachment). Service functions:
`apps.assets.artifacts.open_for_view(artifact, user) -> IO[bytes]` (permission check, then size and
SHA-256 verification, then the stream).

## 10. Staff capture (Workstream E builds the UI on this)

```python
from apps.assets.artifacts import record_staff_capture
record_staff_capture(source_version, user, data: bytes, content_type: str, *,
                     role: str = "model.thumbnail") -> DerivedArtifact
```

Server-side identity and validation: requires `LAI_THUMBNAIL_CAPTURE=on` and the
`capture_derivedartifact` permission, a source version that is a GLB model (never rejected),
a declared staff-capture role and content type, size within the bound, the format sniffed from
the bytes (PNG or WebP signature; the browser's claim is never trusted), then a create-only write
under `capture/<artifact id>.<ext>` and a `pending_review` row. Raises `ArtifactRefused(code)`.

## 11. Promotion

```python
from apps.assets.artifact_promotion import promote_artifact
promote_artifact(artifact, user) -> AssetVersion
```

Under `select_for_update` (artifact, then asset, then versions, the lock order the asset services
use) it re-verifies the object's SHA-256 and size, refuses a non-promotable role, a state other
than `pending_review` or `accepted`, an artifact whose source is deleted, an asset that is retired,
a duplicate of an existing version, and a content type with no library format; then calls the
existing `services.upload_version(source.asset, stream, ...)` (the existing synchronous validation
and storage), adds `metadata["derivedFrom"]` (source version uuid and number, source SHA-256,
artifact id, role, logical id, processor id and version, profile id and version, job id) and copies
licence and source provenance from the source version's metadata. The new version is
`VALIDATED` (or `DRAFT` with asynchronous validation) and **unpublished**. The artifact becomes
`promoted` with `promoted_version` set. Concurrent promotions serialize on the artifact row: the
second sees `promoted` and is refused. Publication stays the existing explicit action and its
existing latest-validation gate (Workstream B corrects that gate; this module never calls it).
Raises `apps.assets.services.AssetActionRefused(code, message)`.

## 12. Retention and cleanup

Settings: `LAI_ARTIFACT_RETENTION_UNREVIEWED_DAYS=90`, `LAI_ARTIFACT_RETENTION_SUPERSEDED_DAYS=30`,
`LAI_ARTIFACT_ORPHAN_GRACE_HOURS=48`.

| State | Deadline |
|---|---|
| `pending_review` | `created_at` + 90 days |
| `superseded`, `rejected` | supersession or rejection time + 30 days |
| `accepted`, `promoted` | none (protected) |

`manage.py asset_artifact_retention [--apply]` (dry run by default) expires eligible rows
(`expired`, committed first), deletes their objects through the Django-side storage (the cleanup
path; worker roles cannot delete), records `deleted`, and removes the tombstone's job link so job
pruning is not blocked. Protected: `promoted`, `accepted`, `retention_hold`, rows whose job is
pending or running, rows referenced by a promoted version. It also reconciles orphans: objects
under `processing/artifacts/<env>/` with no row and older than the grace period, excluding
objects belonging to a pending or running job. Every candidate is locked and re-checked before
deletion, so a concurrent promotion or recording wins. The run is idempotent and logs counts and
codes only. `asset_storage_audit` is unchanged and still audits `assets/` only.

Bucket lifecycle (note for Workstream G): **no** expiry rule on `processing/artifacts/`. Only an
abort-incomplete-multipart-upload rule is acceptable, because an unconditional expiry would delete
accepted and promoted-lineage artifacts the database still protects.

## 13. Open decisions (not decided by the owner; implemented the conservative way)

See ADR-066, "Open decisions".
