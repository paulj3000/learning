# Proposed decision: derived files (conversions, thumbnails, optimized models) live in staff-only derived-artifact records, and reviewed deliverables are promoted into new unpublished asset versions

**Status: Proposed. Not accepted; no ADR number assigned.** Written 2026-11-17 for Wave 4 owner
decision W4-4 (`../WAVE4_HANDOFF.md` section 6). Nothing here is implemented, approved or
deployed: no model, migration, bucket, IAM statement or S3 write exists for it. If the owner
accepts it, it receives the next free number through the registry check
(`scripts/check-adrs.ts`) and must not be cited before that.

Builds on `../feasibility/LAI-LAMBDA-013-derived-artifacts.md` (the existing analysis, which this
document extends from "image workloads" to every workload) and on ADR-033 (one backbone),
ADR-045 (Django Admin owns the asset lifecycle), ADR-055, ADR-061, ADR-062 and ADR-064. The
integration rules each workload must follow are in `../DERIVED_ARTIFACTS_INTEGRATION.md`.

## Context

- Four workloads will produce files: audio transcode and loudness (008 phase 2), image
  conversion and thumbnails (013a), GLB thumbnails (013b) and GLB or texture optimization (010).
  Without one design each would invent its own record, key scheme and IAM grant.
- `AssetVersion` has no link to another version, and `IMMUTABLE_FIELDS` freezes key, bytes,
  `metadata`, `clips`, `dimensions` and `validation_report` from the moment of publication
  (`lai/apps/assets/models.py:50`). A published or retired version is never deleted.
- Asset keys are made only by `storage.object_key` under `assets/<models|images|audio>/`, which
  is also the live delivery prefix. The resolver serves published versions only.
- Workers are read-only on the asset bucket (`s3:GetObject`, `devPlatformStack.ts:1125`) and the
  contract storage port refuses writes (`jobs/core/contract.py`). ADR-064 and the Wave 4
  handoff (rule 4 and 5) say results never rewrite a published version and no artifact writes
  happen until the owner decides.
- `lai_processing` already defines the pieces a worker needs: `StoreName.ARTIFACTS`,
  `artifact_key` (`processing/artifacts/<namespace>/<job id>/<attempt id>/<logical id>.<ext>`),
  `ArtifactReference` (key under the producing attempt, checksum, size, content type, processor,
  profile) and `ProcessingJobResult.artifacts`. Django's result handling does not read
  `artifacts` today.

## Options

| | A. Every derivative is a new unpublished `AssetVersion` | B. Separate private records linked to the source version | C. Staff-only preview records; reviewed deliverables promoted into new unpublished `AssetVersion`s |
|---|---|---|---|
| Thumbnails | Need a second `ContentAsset` of kind `image` per model (a model asset only accepts model files) | Natural fit | Natural fit |
| Conversions reach the game | Yes, after publish | No path | Yes, after review, promote, then explicit publish |
| Catalog and version numbers | Polluted by previews and by every processor re-run | Untouched | Untouched until a human promotes |
| Lineage | Needs a new field on an immutable model | A foreign key and checksum on the record | Same, plus `metadata["derivedFrom"]` on a promoted version at creation |
| Worker write scope | `assets/images/` (live prefix) | Derived prefix only | Derived prefix only |
| Worker can ever alter live delivery | Possible by misconfiguration | No | No |
| New schema | Lineage field, extra definitions | One model | One model |
| Second delivery path (ADR-033) | No | Yes, if derived rows are ever served to children | No: only promoted `AssetVersion`s reach the resolver |
| Review before publishing | Publish gate only | None | Promote gate, then publish gate |
| Cost of change | Highest (touches the immutable model) | Low | Low, plus one promote action |

Option A is rejected because it places worker writes on the live prefix and spends version
numbers on previews. Option B is rejected on its own because it cannot deliver a conversion to
the game, and extending it to do so recreates Option C. Option C is the preferred candidate on
the merits: it keeps previews out of the catalog, lets only Django create an `AssetVersion`
(through the same validated upload path as any staff upload), and adds one human review step
before the existing publish step. Its costs are one model, one migration and one staff click.

## Proposed decision (for owner review)

### 1. Data model

A new model in `apps.assets` (suggested name `DerivedArtifact`; no model is added by this
document). Rows are written by Django only, from a verified result, and are immutable except for
`state`, `expires_at` and the promotion link.

| Field | Meaning |
|---|---|
| `id` | UUID primary key |
| `source_version` | FK to `AssetVersion`, `PROTECT` (a source with artifacts cannot be deleted; a never-published draft is retired first) |
| `source_sha256` | Checksum of the source bytes the processor read (from the result's `input`); must equal `source_version.sha256` at consume time |
| `processor_name`, `processor_version` | From `ProcessorIdentity`; includes tool versions (for example FFmpeg, Pillow) in `tool_versions` JSON |
| `profile_id`, `profile_version` | The processing profile and its version |
| `job` | FK to `ProcessingJob`, `SET_NULL`; plus `job_id_text` and `attempt_id` (UUIDs) kept as plain values so lineage survives job pruning |
| `artifact_role` | Dotted name from the workload table (for example `audio.transcoded`, `image.thumbnail`) |
| `logical_id` | The worker's logical id within the attempt (one per file) |
| `sha256`, `size_bytes`, `content_type` | Verified by Django before the row is created |
| `storage_key` | Unique; the full key under the derived prefix (section 2) |
| `width`, `height`, `duration_ms` | Optional facts for previews and the promotion check |
| `state` | `READY`, `PROMOTED`, `SUPERSEDED`, `EXPIRED`, `DELETED` (transitions below) |
| `promoted_version` | Nullable one-to-one FK to the `AssetVersion` created by promotion |
| `created_at`, `expires_at` | Retention (section 8); `expires_at` is null while `PROMOTED` |

Constraints: unique `(job_id_text, attempt_id, logical_id)` (the idempotency key for recording);
unique `storage_key`; check that `state` is valid; index on `(source_version, artifact_role,
state)` and on `expires_at` for the sweep. A re-run with a newer processor or profile version adds
rows and marks the older `READY` rows of the same `(source_version, role)` `SUPERSEDED`; it never
edits them.

State transitions: `READY > PROMOTED`, `READY > SUPERSEDED`, `READY | SUPERSEDED > EXPIRED >
DELETED`. `PROMOTED` rows are never deleted while their version exists.

### 2. Storage key scheme

- **Recommended: the existing asset bucket, a dedicated prefix outside `assets/`.** The contract
  already defines it: `processing/artifacts/<namespace>/<job id>/<attempt id>/<logical
  id>.<ext>`, built by `artifact_key` and checked by `ArtifactReference` (a result cannot name
  another job's or attempt's key). It is never under `assets/`, so it is never resolvable or
  reachable through CloudFront (the distribution serves only the paths the owner exposes; this
  design adds none). The bucket is already versioned and encrypted, and a deleted object stays
  recoverable for 30 days.
- Keys are create-only and immutable. The attempt id makes every retry write a new key, so a
  second attempt can never overwrite the first. Extensions come from the workload table, never
  from a filename.
- **Alternative: a separate bucket** (for example `lai-derived-<env>-...`). Stronger blast-radius
  separation and its own lifecycle rules, but a new bucket, key policy and stack change, which
  the owner must approve (ADR-064 decision 1 forbids a second bucket for the processing path
  without a decision). Not recommended for dev. The dev artifacts bucket is excluded: its
  `jobs/results/` objects expire after 7 days, which does not suit review.
- **Not the speech bucket, the child photo bucket or the quarantine prefix.**
- A key for Django-created derivatives (phase 1 staff browser capture, from the 013 study) would
  use `derived/<asset id>/<version uuid>/<purpose>-<side>.<ext>`. This proposal does not need it
  and recommends one scheme only (`processing/artifacts/...`); the choice is owner decision D3.

### 3. Worker IAM (proposed, not applied)

Per worker role that produces files (the media role today; a separate role for any native
function):

| Statement | Allow |
|---|---|
| Write | `s3:PutObject` on `<asset bucket>/processing/artifacts/<namespace>/*` only |
| Create-only | Condition `StringEquals: {"s3:if-none-match": "*"}` on that statement if supported in the Region (to be verified by the infra card), and the client always sends `IfNoneMatch="*"` |
| Read | `s3:GetObject` on `assets/*` (existing) and on its own `processing/artifacts/<namespace>/*` (to verify its own write) |
| Missing-key semantics | The existing `s3:ListBucket` statement, unchanged |

Explicitly not granted: `s3:PutObject` or `DeleteObject` on `assets/*`; any write on the speech
bucket, the child photo bucket, quarantine or the dev artifacts bucket; `s3:DeleteObject`,
`PutObjectAcl` or `PutObjectTagging` anywhere; overwrite of any existing key (the create-only
condition makes S3 answer 412). Cross-job isolation cannot be enforced by IAM, because the job
id is not known to the role. It is enforced by the code that builds keys (`artifact_key`), by the
worker storage port, and by Django, which accepts only keys under the reported attempt's prefix.
The Django instance role gains `s3:GetObject` and `s3:DeleteObject` on `processing/artifacts/*`
(preview, promote, sweep) and no write.

### 4. Result envelope and idempotent recording

The result already carries `artifacts: [ArtifactReference]` (schema 1). Proposed Django rule in
`jobs_consume_results`, inside the same `select_for_update` transaction that finalizes the job:

1. Only a `succeeded` result with a verdict that permits artifacts is read for them; a `failed`
   result's artifacts are ignored (see partial failure).
2. For each reference: the key must start with the prefix for `(namespace, job id, attempt id)`;
   the `source_job_id` must equal the job; the role must be declared by the kind's spec; the
   content type and size must be within the role's bounds; the object is read back (HEAD for size,
   a streamed read for SHA-256, bounded by the size limit) and must match; the job's source
   version checksum must still equal `input.sha256`.
3. A row is created with `get_or_create` on `(job_id_text, attempt_id, logical_id)`. A duplicate
   delivery finds the rows and does nothing. The existing job-level duplicate check
   (`job.is_terminal`) already short-circuits a second terminal message.
4. **Stale results** (the source version has changed or been retired since submission, the
   processor or profile version is older than the current one, or the idempotency key was
   superseded): rows are still created in state `SUPERSEDED` with a short expiry, or not created
   at all (owner decision D7), and the job outcome is a safe code such as
   `stale_source` or `processor_outdated`. Nothing is ever applied to a published version.
5. **Partial failure.** Objects written by an attempt that then failed, or whose result was never
   delivered, have no row. They are orphans, found by the sweep (section 8). If one reference of a
   succeeded result fails verification, the whole result is recorded as a failed outcome
   (`artifact_invalid`) and no row of that attempt is created: all or none per attempt. Retrying
   makes a new attempt with new keys.
6. The consumer never copies or moves objects; it records and verifies. Large results already use
   `result_s3_key`; artifacts are separate from that.

### 5. Staff visibility

Django Admin only. A staff view lists a version's artifacts and streams a derived object with the
same hardening as the media route (`nosniff`, `default-src 'none'; sandbox`, checksum verified on
read, permission `assets.view_assetversion`) or issues a short-lived presigned GET (default 5
minutes, `ResponseContentDisposition: attachment` for non-previewable types). No CloudFront path,
no resolver entry, no child-facing API. Audit: each view of an artifact is an admin-history
entry only when it is a download; previews are not logged (no child data).

### 6. Promotion into an unpublished `AssetVersion`

Staff choose "Promote to new version" on a `READY` artifact whose role is promotable (not
thumbnails). Django, not a worker, reads the artifact bytes and calls
`services.upload_version` on the source's asset (or, for a conversion that changes family, the
target asset named by staff). The new version passes the same synchronous validation as an
upload, gets a fresh `assets/...` key, becomes `VALIDATED` and stays unpublished, and records
`metadata["derivedFrom"]` (source version id, source checksum, artifact id, processor, profile,
job id) at creation. The artifact becomes `PROMOTED` and links `promoted_version`. A file
identical to an existing version is refused as `duplicate_version`. Publication is the existing
explicit, permission-checked action (ADR-045) and, for optimized models, also waits for the
loader and validator to accept the output (W4-6). Permissions: a new
`assets.promote_derivedartifact`, separate from publish.

### 7. Rollback

- Before publish: retire or reject the promoted version through the existing lifecycle; the
  artifact stays `PROMOTED` (lineage kept) or is set back to `READY` by staff action if the
  version was never published and is deleted.
- After publish: the existing retire and reactivate rollback of versions applies unchanged;
  derived rows are not involved.
- A bad processor release: mark its `READY` rows `SUPERSEDED` by `(processor_version)` in one
  admin action; nothing published changes.

### 8. Retention and cleanup

- `READY` artifacts of a source version: kept while the source version is `PUBLISHED`, `VALIDATED`
  or `RETIRED` and no newer artifact of the same role and profile exists. Thumbnails: kept with
  their source.
- `SUPERSEDED`: expire 30 days after supersession. `READY` never reviewed: expire 90 days after
  creation (owner decision D6). `PROMOTED`: no expiry.
- Sweep: extend `asset_storage_audit` (or a sibling command) to list `processing/artifacts/`
  and report objects with no row older than 24 hours (orphans from failed attempts) and rows
  whose object is missing. Deletion needs `--delete` and an operator, as for assets. A scheduled
  run is a later task.
- Bucket rules: add a lifecycle rule on `processing/artifacts/` to expire noncurrent versions
  after 30 days, and abort incomplete multipart uploads after 1 day. Current objects are deleted
  only by Django when a row reaches `EXPIRED`.
- Deleting a never-published source version first expires its artifacts.

### 9. Cost assumptions (dev, estimate to be measured by the first workload)

Bucket storage is the only continuing cost. Order of magnitude: the corpus is six GLBs (23 KB to
3.3 MB) plus 116 `.gltf` files (2.73 MB) and a small audio and image set. At 5 artifacts per
asset and about 300 KB average, 500 assets hold about 750 MB, roughly $0.02 per month in S3
Standard in a typical Region. PUT, GET and HEAD requests are well under $1 per month at staff
volumes. The Lambda compute of the workloads is costed in their own proposals. Versioning plus a
30-day noncurrent rule bounds retained deleted objects. A separate bucket adds no storage cost
but adds approval and stack work. These are assumptions, not measurements.

### 10. Not decided here

Whether audio joins `ASYNC_FORMATS`, whether loader support for compressed models exists, whether
GLB thumbnails can be rendered on Lambda, and the packaging of any native tool. Each stays with
its workload proposal; this decision only fixes where their outputs go.

## Owner decisions

| ID | Decision | Recommendation | Alternatives | Cost |
|---|---|---|---|---|
| D1 | Approve any worker write to S3 | Yes, narrow and create-only (section 3), after D2 and D3 | Keep workers read-only; Django copies results (not possible for a worker-produced file without a worker write) | IAM change in the infra stack; one approval |
| D2 | Which option | C | A, B | C adds one model and migration |
| D3 | Where derived bytes live | Existing asset bucket, prefix `processing/artifacts/` | Separate bucket; Django-made `derived/` prefix as well | Separate bucket: new stack resources and approval; storage cost the same |
| D4 | Promotion permission and step | Separate `promote_derivedartifact` permission, explicit click | Fold into upload permission | None |
| D5 | Presigned GET versus streamed view | Streamed through Django for previewable types; presigned for downloads | Presigned only | None |
| D6 | Retention periods | 90 days unreviewed, 30 days superseded, none when promoted | Longer, or manual only | Pennies per month |
| D7 | Record stale results as `SUPERSEDED` rows or drop them | Drop the rows, keep the job outcome | Record with short expiry | Orphans for the sweep |
| D8 | S3 conditional-write support | Verify `s3:if-none-match` in the target Region before approval | Rely on key uniqueness (attempt id) only | One infra spike |
| D9 | Sweep and lifecycle rules | Extend `asset_storage_audit`, add the two bucket rules | Manual only | Small implementation card |
| D10 | Implementation order | Model, consumer recording and admin view before any worker write | Land with the first workload | Half a sprint |

## Consequences

Positive: one record, one key scheme and one IAM shape for every workload; no worker ever writes
to a live prefix; published versions are untouched; lineage is kept without changing an immutable
field after publication. Negative: one model and migration, a promote step, and a sweep to run.
Reversible: until the first worker write is approved the design costs nothing; the model can be
added and dropped without touching the catalog.

## Test plan (when implemented)

Consumer idempotency (duplicate delivery, stale source, foreign-attempt key, wrong size or
checksum, all-or-none on partial failure); promotion through `upload_version` with a duplicate
refused; admin permission checks; sweep orphan report; IAM policy assertions in the infra tests
(no write outside the prefix, no delete); a test that no resolver path reads a derived key.
