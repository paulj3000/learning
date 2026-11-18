# Derived artifacts: integration spec for workloads

Status: design only, for the Proposed decision
`proposals/ADR-PROPOSED-derived-artifacts.md`. No artifact writes are approved, and no code,
model, bucket or IAM statement implements this. Until the owner accepts the proposal, every
workload stays on its phase 1 behaviour (results kept on the job, `result_recorded`).

## 1. Rules every workload follows

1. Use the one shared record and key scheme. A workload never adds a model, bucket, prefix,
   queue, consumer or promotion path of its own (ADR-064 decision 1, ADR-033).
2. The worker writes only through the contract storage port, only to the `artifacts` store, only
   for kinds whose spec declares output roles, and only with
   `artifact_key(namespace, job_id, attempt_id, logical_id, extension)`. Create-only
   (`IfNoneMatch="*"`). Never `assets/*`, quarantine, speech, child photos or another attempt.
3. The worker reports every file in `ProcessingJobResult.artifacts` as an `ArtifactReference`
   with checksum, size, content type, processor identity (tool versions included) and profile
   id and version. A file not in the result does not exist as far as Django is concerned.
4. A result is all or none per attempt. If any output fails the worker's own checks, the job
   fails and the worker deletes nothing (it cannot); the sweep removes the orphans.
5. Django verifies each reference (prefix, role, content type, size bound, size by HEAD, SHA-256
   by read, source checksum still current) before creating a `DerivedArtifact` row, keyed by
   `(job id, attempt id, logical id)` so a duplicate delivery changes nothing.
6. Outputs are staff-only. They are viewed in Django Admin. They reach the game only by
   promotion into a new unpublished `AssetVersion`, then the explicit publish. No workload
   publishes, retires or edits a version, and none writes `metadata` of a published version.
7. Inputs are already-validated staff asset versions with verified checksums, format sniffed
   from bytes. Never child photos, child audio or child text.
8. A workload declares its roles in its `JobTypeSpec` (role name, allowed content types, maximum
   size, maximum count). Django rejects anything outside the declaration.
9. Logical ids are stable per role and side, for example `thumb-256`, `thumb-512`, `opus`, so a
   retry (new attempt) produces the same logical ids under new keys.
10. Nothing in a key or result carries a child name or identifier.

## 2. Roles, content types and bounds

Bounds are proposals to be confirmed by each workload's measurement. "Promotable" means a
staff member may promote the artifact into a new unpublished `AssetVersion`.

| Workload | Job type | Role | Content types | Max size per file | Max files | Promotable | Notes |
|---|---|---|---|---|---|---|---|
| 008 audio (phase 2) | `asset.transcode_audio` | `audio.transcoded` | `audio/ogg`, `audio/mpeg` | 20 MiB (the upload cap) | 2 (Opus, MP3 fallback) | Yes, to a new version of the same audio asset | Loudness-normalized per the profile; duration within 15 minutes; source stays unchanged |
| 008 audio | same | `audio.report` | `application/json` | 64 KiB | 1 | No | Optional; loudness facts may stay on the job result instead |
| 013a images | `asset.convert_image` | `image.converted` | `image/webp`, `image/png`, `image/jpeg` | 8 MiB | 1 per target format | Yes, to a new version of the same image asset | Header limits `MAX_IMAGE_SIDE` 4096 and `MAX_IMAGE_PIXELS` 16,000,000 checked before decoding |
| 013a images | same | `image.resized` | `image/webp`, `image/png` | 8 MiB | 4 | Yes | Texture mip or size variants; the single imaging module is shared with 010 |
| 013a images | `asset.render_thumbnail` | `image.thumbnail` | `image/webp`, `image/png` | 512 KiB | 3 (for example 128, 256, 512 px) | No | Preview only, staff Admin |
| 013b GLB thumbnail | `asset.render_thumbnail` | `model.thumbnail` | `image/webp`, `image/png` | 512 KiB | 3 | No | Only if a renderer is proven on the chosen runtime; deterministic camera and background so reruns match |
| 010 optimization | `asset.optimize` | `model.optimized` | `model/gltf-binary` | 1.5 times the source size or 32 MiB, whichever is smaller (the upload cap) | 1 per profile | Yes, but not publishable until the loader and both validators accept the output (W4-6) | Never accepted if it is larger than the source; records sizes before and after |
| 010 optimization | same | `texture.compressed` | `image/ktx2` | 16 MiB | 4 | Yes, same W4-6 gate | Uses 013a's imaging module for any resize |
| 010 optimization | same | `model.optimize_report` | `application/json` | 64 KiB | 1 | No | Tool, options and measured saving |

Notes: `image/ktx2` and any new content type must also be accepted by the contract's content-type
pattern and added to the format table before a role can be declared. A role absent from this
table is not allowed.

## 3. What Django does with the result (consumer contract)

For a `succeeded` result with artifacts, inside the existing locked transaction:

1. Parse and validate the envelope (already done) and the references against the kind's declared
   roles.
2. Check that the job's source version is the version named in the request and that its
   checksum equals the result's `input.sha256`. A mismatch records a stale outcome and creates
   no row.
3. Verify each object, then `get_or_create` the row by `(job id, attempt id, logical id)`.
4. Set `subject_outcome` to a safe code: `artifacts_recorded`, `artifact_invalid`,
   `stale_source`, `processor_outdated`. These codes are logged without file names.
5. Mark older `READY` rows of the same source, role and profile `SUPERSEDED`.
6. Never call `upload_version`, never publish, never touch a published version's fields.

Failure and retry matrix:

| Case | Behaviour |
|---|---|
| Duplicate result message | Job already terminal: counted as a duplicate delivery; rows unchanged |
| Redelivery after a crash between recording and ack | `get_or_create` finds the rows; no new rows |
| Worker wrote objects, then failed | Failed result carries no artifacts; objects are orphans for the sweep |
| Worker wrote objects, result lost | Job times out as failed; orphans swept; a retry is a new attempt with new keys |
| One reference fails verification | Whole attempt recorded as `artifact_invalid`; no rows |
| Source changed meanwhile | `stale_source`; no rows (or `SUPERSEDED` rows, owner decision D7) |
| Key outside the attempt prefix | `INVALID_OBJECT_REFERENCE` at contract validation; result rejected |

## 4. Promotion and publication

1. Staff open the source version in Admin, view the artifact beside the original, and choose
   "Promote to new version" (permission `assets.promote_derivedartifact`).
2. Django reads the bytes and calls `services.upload_version`. The synchronous validator runs, a
   new `assets/...` key is assigned, the version is `VALIDATED` and unpublished, and
   `metadata["derivedFrom"]` records source version, source checksum, artifact id, processor,
   profile and job id at creation.
3. The artifact becomes `PROMOTED`. A duplicate of an existing version is refused.
4. Publishing is the existing separate action. For `model.optimized` and `texture.compressed`
   it additionally requires loader and validator support (W4-6).

## 5. Per-workload checklist before a workload may write

- Roles, content types and bounds declared in the `JobTypeSpec` and in section 2.
- Profile id and version defined; the processor version bumps when output bytes would change.
- Worker deterministic enough that a retry yields the same logical ids (bytes may differ by tool
  version, which is recorded).
- Unit tests: key builder use, reference verification, duplicate delivery, stale source,
  partial failure, no write outside the artifact prefix.
- Owner approvals recorded: D1 to D3 of the proposal, plus the workload's own decision (native
  packaging, loader support, renderer).
- Infra card: the narrow, create-only IAM statement and bucket lifecycle rules, reviewed before
  any deploy, which needs explicit owner approval.
