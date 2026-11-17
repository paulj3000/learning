# Asynchronous model validation (`asset.validate_model`, ADR-064)

Operator and developer guide for LAI-LAMBDA-001 to 007 as re-landed on the canonical jobs path
(`CANONICAL_PATH.md`). Code wins over this page: `lai/apps/assets/processing.py`,
`lai/apps/assets/services.py`, `lai/apps/assets/admin.py`, `lai/apps/jobs/core/contract.py`,
`lai/apps/jobs/services.py`, `lambda/jobs_worker/`. Status: developer-complete on
`feature/serverless-processing-canonical`, not merged, not deployed.

## 1. What it does

With `LAI_ASSET_ASYNC_VALIDATION=on`, a GLB model uploaded to the Asset Library is stored as a
`DRAFT` version and a background job runs the full GLB validator (`GLB_VALIDATION.md`) on the
stored bytes. The job's result moves the draft to `VALIDATED` (verdict `pass`) or `REJECTED`
(verdict `fail`). Publishing a GLB then needs a passing result for exactly that file. Nothing is
ever published by a job: publishing stays an explicit staff action.

With the flag `off` (the default in every environment), uploads behave exactly as before
(synchronous checks, `VALIDATED`, no job). Staff can still run a background validation by hand
from Django Admin; the result is shown for review and changes nothing.

## 2. Sequence

```text
Staff upload (Django Admin)          services.upload_version
  synchronous checks pass            store object, then in ONE transaction (asset row locked):
                                       AssetVersion DRAFT + ProcessingJob PENDING (kind asset.validate_model)
  commit                             on-commit send of the schema-1 work envelope
                                       -> SQS lai-<env>-jobs-media (outbox; relay re-sends)
Lambda lai-<env>-jobs-media          parse envelope, send `running`, contract.run():
  (zip, lai_processing vendored)       ProcessingJobRequest.from_dict(payload)
                                       ExecutionEngine: head + read the asset object (read only),
                                       verify SHA-256 and size, run asset.glb_validator
                                     store result in S3 jobs/results/<job_id>.json, then send it
                                       -> SQS lai-<env>-job-results
jobs_consume_results                 apply_result: lock the job row, record COMPLETED or FAILED,
  (lai-jobs-consumer)                  call apps.assets.processing.apply(job) in the same transaction
apply(job)                           verify result vs request, request vs version, then
                                       DRAFT -> VALIDATED | REJECTED; job.subject_outcome = code
Staff publish                        services.publish_version: gate `processing_required`
```

With `LAI_JOBS_BACKEND=inline` (local development and tests) the job runs inside
`services.submit` through the same task code, so the upload returns the version already
`VALIDATED` or `REJECTED`.

## 3. Kinds and envelopes

| Kind | Queue | Handler module | Submitted by |
|---|---|---|---|
| `asset.validate_model` | media | `apps.assets.processing` | Flag-on GLB upload; Admin "Validate in background" |
| `reference.checksum` | media | `apps.jobs.reference` (logs only; result kept on the job) | Tests only; proves the path end to end |
| `asset.inspect` (existing, informational) | media | `apps.assets.jobs` | Admin "Inspect in background" |

Both contract kinds travel in the existing schema-1 envelopes (`lai/apps/jobs/core/envelope.py`):

- Work: `{"schema": 1, "job_id", "kind", "attempt", "submitted_at", "payload"}`, where `payload`
  is an ADR-061 `ProcessingJobRequest` as a dict (`CONTRACTS.md` section 3). Its `job_id` equals
  the `ProcessingJob` primary key.
- Result: `{"schema": 1, "job_id", "kind", "status", "result", "result_s3_key", "error", "worker",
  "finished_at"}`. For `succeeded`, `result` is the ADR-061 `ProcessingJobResult` as a dict
  (`CONTRACTS.md` section 4); results over 200 KB travel as an S3 pointer.

Django's request for `asset.validate_model` (`model_validation_request`): namespace from
`LAI_ENVIRONMENT` (or `local` when unset; the dev release does not render `LAI_ENVIRONMENT`, so
dev uses `local`), subject `("asset_version", <version uuid>)`, asset context (asset id, version
uuid and number), input `ObjectRef("assets", storage_key)` with the version's content type, size
and SHA-256, profile `glb-default` v1 with default options, `max_input_bytes` min(profile 50 MiB,
`LAI_ASSET_MAX_GLB_BYTES`) and `max_execution_seconds` 90 (see section 9), `expires_at` 72 hours
after submission, and the ADR-061 idempotency key.

Worker outcomes (`core/contract.py`):

| Engine result | Schema-1 outcome |
|---|---|
| Succeeded, verdict `pass` or `fail` | `succeeded` with the result. A bad model is a successful job with verdict `fail` |
| Failed, retry class retryable (`storage_failure`, `processing_timeout`, `temporary_failure`, `throttled`) | The worker raises; SQS redelivers the same message (same job id, attempt id). DLQ after 3 receives |
| Failed, permanent, manual or cancelled (for example `input_missing`, `checksum_mismatch`, `job_expired`, `resource_limit_exceeded`, `permission_denied`) | `failed` with the contract error code |
| Payload that is not a valid request, or a request of another job type | `failed`, `invalid_payload` |

The worker's storage port is read-only and serves the `assets` store only; it never writes
artifacts on this path (a request with `write_report: true` would fail with
`permission_denied`). Django never sets that option.

## 4. Verification when a result is applied

`apply(job)` runs under the job row lock inside `apply_result`'s transaction. It checks, in
order, and records the first failing code in `ProcessingJob.subject_outcome`:

1. `result_mismatch(job)`: the result is a valid succeeded ADR-061 result with a verdict, of exactly
   the request in `job.payload` (job, attempt, idempotency key, job type, namespace, profile, and a
   verified input with the same store, key, SHA-256 and size).
2. The version still exists; then the asset row and the version row are locked.
3. `identity_mismatch(job, version)`: the request matches the version as stored now (kind,
   subject, namespace, asset context, storage key with no object version, SHA-256, size, profile).
4. No newer validation job of this version exists (`result_superseded` otherwise; section 9).
5. Only a `DRAFT` is changed.

| `subject_outcome` | Meaning | Version changed |
|---|---|---|
| `version_validated` | Verdict `pass`; draft is now `VALIDATED` (`validated_at` set) | Yes |
| `version_rejected` | Verdict `fail`; draft is now `REJECTED` | Yes |
| `result_recorded` | Version is not a draft (validated, rejected or published); a manual revalidation. Result stays on the job | No |
| `result_superseded` | A newer validation job of this version exists, so this (late) result is recorded on its job only and does not count for the gate | No |
| `processing_failed` | The job failed (no result) | No |
| `version_missing` | The version no longer exists | No |
| `result_invalid` | Not a valid succeeded result with a verdict | No |
| `job_mismatch`, `attempt_mismatch`, `key_mismatch`, `identity_mismatch`, `profile_mismatch`, `input_mismatch` | Result does not belong to this request (`result_mismatch`) | No |
| `kind_mismatch`, `subject_mismatch`, `namespace_mismatch`, `asset_mismatch`, `storage_mismatch`, `checksum_mismatch`, `size_mismatch`, `profile_mismatch` | Request does not match the version's stored file (`identity_mismatch`) | No |

On `version_validated` and `version_rejected`, the validator's findings are appended to
`validation_report` with `"source": "processing"` (at most 200) and a normalized summary is
stored in `metadata["model_validation"]` (`model_validation_summary`). Mismatch outcomes and
`result_invalid` are logged at WARNING; logs carry ids and codes only.

**Lock order:** job row (held by `apply_result`) -> `ContentAsset` row -> `AssetVersion` row, the
same order `publish_version` uses after its asset lock. The publication gate reads jobs and
never locks them. The only exception is the inline backend, where an upload holding its asset
lock runs its own new, uncommitted job: no other transaction can see that row, so no cycle forms.

## 5. Flag

`LAI_ASSET_ASYNC_VALIDATION`: `off` (default) or `on`; any other value refuses to start.
`on` is refused with `LAI_JOBS_BACKEND=disabled`, and production settings require
`LAI_JOBS_BACKEND=sqs`. No deployment switches it on; in dev it would be an SSM parameter under
`/lai/dev/django/` (the renderer accepts `LAI_*` names) followed by a release, an owner decision.
The flag applies to GLB only (`ASYNC_FORMATS = {"glb"}`); `.gltf`, images and audio keep the
synchronous path.

## 6. Upload

`services.upload_version` with the flag on and a GLB that passes the synchronous checks: the
object is stored, then the `DRAFT` row and its job are created in the same transaction
(`_create_draft_and_submit`). If the submission is refused (`JobsError`, `JobsDisabled`
included) the object is deleted, no row or job remains, and the upload fails with
`processing_unavailable` ("Background validation is not available right now, so the file was not
stored."). Any other failure also deletes the object and re-raises. Admin tells staff the version
was stored as a draft and is being validated in the background.

## 7. Django Admin

On the asset version change page, a read-only **Background validation** section appears when
the flag is on or the version has a validation job (otherwise the page is unchanged):

- Processing status: status (Queued, Processing, Completed, Failed, Failed: timed out, Could not
  be sent), outcome, times, worker attempts, deliveries, error code, one explicit sentence, and a
  link to the job page (where a stuck job can be marked failed with `fail_processingjob`).
- Validation result: verdict, processor and profile, error and warning counts, run warnings and
  the findings table.
- Model information: meshes, primitives, triangles, vertices, bounds, generator, extensions,
  materials, textures, skins and animation clips (exact names, durations).

Every value is escaped (`format_html`). Only a passing verdict for exactly this version's file is
reported as passed; a pass by an older processor version says a new validation is needed.

**Validate in background** (bulk action; staff with upload and view permission on asset
versions; at most 50 versions per run): submits `asset.validate_model` for each selected GLB of
an active asset, or reports the existing job for the same file (section 9 says exactly when a new
job is made). It works whatever the flag says and never changes the version. It is the way to revalidate an existing or published model
without rewriting its metadata (a non-draft gets `result_recorded`). Retired assets and non-GLB
formats are refused with a message.

## 8. Publication gate

`services.publish_version` refuses a GLB with `processing_required` when the flag is on and
`_has_passing_validation` is false. That reads the version's completed jobs newest first, skips
those whose outcome is a mismatch, `result_invalid`, `version_missing`, `processing_failed` or
`result_superseded` and those whose request does not match the version's stored file
(`identity_mismatch`), and lets the first remaining one decide: it must have verdict `pass` and
the processor version this build runs (`processor_outdated` otherwise). An older pass never
outvotes a newer accepted `fail`. A draft is still refused first with `not_validated`. The gate does not apply to
rollback, `set_default_version` or republishing, and the flag off leaves publishing unchanged.

The job rows are the gate's only evidence: a `VALIDATED` GLB whose passing job was pruned
(section 10) is refused until staff run Validate in background again.

## 9. Retry and resubmission semantics

Owner decision 2026-11-17: bounded retries, and resubmission of eligible failed, refused or
cancelled validation jobs by authorized staff. There is one job model (`ProcessingJob`), one
retry mechanism for transport (SQS redelivery) and one explicit resubmission path
(`submit_model_validation`, used by the upload and by the Admin action). Nothing resubmits by
itself.

**Input size limits.**

- **Input size.** `LAI_ASSET_MAX_GLB_BYTES` (default 50 MiB = 52,428,800 bytes; bounds 1 MiB to
  50 MiB, checked at start-up with `ImproperlyConfigured`; effective value min of it and
  `LAI_ASSET_MAX_UPLOAD_BYTES`) is the one GLB limit (`docs/ASSET_LIBRARY.md` section 13). The
  upload refuses a larger GLB with `too_large` before hashing or storing it. The request carries
  `limits.max_input_bytes = min(profile, setting)`; a version above it is refused while the
  request is built (`ProcessingError(resource_limit_exceeded)`, mapped to
  `JobsError("resource_limit_exceeded")` by `submit_model_validation`), so no job, no message and
  no draft or publication change remain. The Admin action reports the limit and continues with
  the other versions. The engine also refuses an object above the request's limit
  (`resource_limit_exceeded`, permanent). A previously published GLB above a lowered limit stays
  published and delivered; revalidating it is refused the same way.
- **Inspection size.** `asset.inspect` for a GLB carries `max_bytes` (the same limit) in its
  payload; Django refuses a larger version before submitting (`object_too_large`, no job) and the
  worker refuses a larger object before reading it. A payload without `max_bytes` (sent before
  this change, or for another format) keeps the worker's 64 MiB hard ceiling; a `max_bytes` above
  64 MiB is clamped to it.

**Logical work.** A validation is identified by its ADR-061 idempotency key, which covers the
namespace, the version (subject), the profile and options, the stored file (key, SHA-256, size)
and the processor version. "The same logical work" below means the same key; a new processor
version is new logical work.

**Transport retries (same job).** A retryable engine failure (`storage_failure`,
`processing_timeout`, `temporary_failure`, `throttled`) makes the worker raise; SQS redelivers the
same work message (same job id, attempt id and request), at most 3 receives on the media queue,
then `lai-<env>-jobs-media-dlq`. Django sees the duplicate `running` messages as duplicates and
creates no job. A redelivered message whose result was already stored re-sends that result; a
redelivered result message is ignored once the job is terminal (5 receives on the results
queue). When the work lands in the DLQ the job stays `RUNNING` until `jobs_sweep` fails it with
`timeout` (after `LAI_JOBS_STALE_MINUTES`, 60, and only while the results queue is empty).

**Staff resubmission (new job).** Under the asset row lock (concurrent clicks serialize; the second
sees the first one's job), `submit_model_validation` reads the newest job of the same logical work:

| Newest job of the same logical work | Resubmission does |
|---|---|
| none | submits a new job |
| `PENDING` or `RUNNING` | returns it (never a duplicate) |
| `COMPLETED`, outcome `version_validated` or `result_recorded`, verdict `pass` | returns it |
| `COMPLETED`, verdict `fail` (`version_rejected`, or `result_recorded` for a non-draft) | submits a new job (explicit action only; see below) |
| `COMPLETED`, refused or not applied (`*_mismatch`, `result_invalid`, `version_missing`, `result_superseded`) | submits a new job |
| `FAILED`, any code: `timeout` (swept, DLQ), `submit_failed`, `marked_failed` (operator), `cancelled`, `job_expired`, `input_missing`, `checksum_mismatch`, `resource_limit_exceeded`, `permission_denied`, `invalid_payload`, `internal_error` | submits a new job |

A new job has a new job id, attempt id, correlation id and `expires_at` (72 hours), and the same
idempotency key. The count is bounded: when the logical work already has
`LAI_ASSET_VALIDATION_MAX_ATTEMPTS` jobs (default 5, 1 to 20), resubmission is refused with
`JobsError("attempts_exhausted")` and the Admin says the limit was reached. The idempotency rules
alone bound concurrent duplicates but not a sequence of resubmissions after failures (for example
a file the worker can never read: each attempt costs up to 3 Lambda receives and an hour before it
times out), so the cap is needed. It counts the job rows that exist: failed jobs are kept, so the
count is effectively per file and processor version; a new processor version or a new upload of
the file (a new version) starts again, and an operator may delete failed job rows.

**Cancelled.** `ProcessingJob` has no cancelled status, and none was added. A contract
`CANCELLED` result (`RetryClass.CANCELLED`) leaves the worker as a non-retryable `TaskError` and
becomes a schema-1 `failed` result with error code `cancelled`; an operator's cancel is the jobs
admin's mark failed (`marked_failed`). Both are `FAILED` with `subject_outcome`
`processing_failed`, change no version, and are resubmittable. A `cancelled` contract status
inside a `succeeded` envelope is `result_invalid`.

**A model the validator refuses.** A deterministic `fail` verdict is a successful job
(`version_rejected`); nothing retries it. Staff may resubmit it explicitly (for example after a
processor fix), but a `REJECTED` version never changes again: the new result is
`result_recorded`, whatever its verdict, and `publish_version` refuses it with `not_validated`.
Uploading the same bytes again as a new version is allowed (`REJECTED` versions do not count as
duplicates) and is the way to publish a file a newer processor accepts.

**Attempts exhausted.** After `LAI_ASSET_VALIDATION_MAX_ATTEMPTS` jobs for the same logical work
the Admin refuses another (`attempts_exhausted`). A `DRAFT` or `VALIDATED` version still counts
as a duplicate of its own bytes, so the remedy is to delete the unpublished version (Delete
unpublished version) and upload the file again, which starts a new count. Failed jobs are kept
for review and are not pruned (owner decision pending on pruning them after the validation
retention period).

**A job stuck `RUNNING`.** A job whose work reached the media DLQ stays `RUNNING` until
`jobs_sweep` times it out, which it defers while the results queue holds messages; while it is
`RUNNING`, Validate in background returns the same job. If steady result traffic keeps the sweep
deferring, staff with the jobs permission use "mark failed" on the job, then validate again.

**Late results.** A job's result applies only while the job is unfinished (`apply_result` ignores
anything for a terminal job), and `apply(job)` changes a version only when no newer validation job
of that version exists (`result_superseded` otherwise). The gate reads the newest accepted result
(section 8). So a result from an earlier attempt never overwrites the current one, in either
arrival order.

**Published versions.** Resubmission and every result leave a published version's status,
metadata, report and delivery unchanged (`result_recorded`; the model's immutability guard also
refuses any change).

**Permissions.** Only the Admin action resubmits, and only for staff with upload (`add`) and view
permission on asset versions; view-only staff, staff without an asset role and non-staff cannot.

**Execution budget and expiry.** The request carries `max_execution_seconds` 90 (the profile
allows 300). The media function's timeout is 120 s (`infra/lib/devPlatformStack.ts`), so the
engine stops first with a classified `processing_timeout`. It is retryable (the engine's
classification, kept): a slow run may succeed on another receive, and a deterministic one costs at
most 3 receives before the DLQ and the sweep's `timeout`, after which staff may resubmit within
the cap. A request older than 72 hours is refused by the worker with `job_expired` (permanent,
resubmittable).

| Case | Path | Same job or new | Version |
|---|---|---|---|
| Transient S3 read | `storage_failure`, SQS redelivery (3 receives, DLQ) | same | unchanged until a result |
| Missing input | `input_missing`, `failed` | resubmit: new | unchanged |
| Processing timeout | `processing_timeout`, redelivery, DLQ, sweep `timeout` | resubmit: new | unchanged |
| Validation refusal | succeeded, verdict `fail`, `version_rejected` | explicit resubmit: new, `result_recorded` | `REJECTED` for good |
| Cancelled | `failed`, `cancelled` or `marked_failed` | resubmit: new | unchanged |
| Duplicate submission (double click) | asset row lock, reuse | same | unchanged |
| Duplicate result | `apply_result` DUPLICATE | same | applied once |
| Late result | DUPLICATE (terminal) or `result_superseded` | none | unchanged |
| Expired job | sweep `timeout`, or worker `job_expired` | resubmit: new | unchanged |
| Published version | `result_recorded` | either | never changed |
| Unauthorized staff | action not offered or refused | none | unchanged |

## 10. Retention

Owner decision 2026-11-17: `jobs_sweep` keeps completed `asset.validate_model` jobs for
`LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS` (default 90, 1 to 730; checked at startup) instead of
`LAI_JOBS_RETENTION_DAYS` (30, unchanged for `asset.inspect`, Studio, speech and
`reference.checksum`, which no gate reads). `apps.jobs.services.prunable(stamp)` selects:

- only `COMPLETED` jobs: pending and running jobs are never pruned whatever their age (the sweep
  times them out instead), and failed jobs are kept for review, as for every kind;
- whose `finished_at` is strictly more than the period before the sweep (`finished_at < now -
  period`): a job that finished exactly 90 days ago is kept, one a microsecond older is pruned.

Publication integrity:

- The gate (section 8) reads job rows only. After the passing job of an unpublished `VALIDATED`
  GLB is pruned, `publish_version` refuses it with `processing_required`; staff run Validate in
  background, the new result is `result_recorded`, and only the explicit publish then publishes.
  Pruning never publishes, un-publishes or changes a version.
- A published version is unaffected: the resolver and delivery read the version row and the
  stored object, never jobs, so its status, metadata (including `metadata["model_validation"]`),
  report and delivery stay as they were.

Evidence on the version. `metadata["model_validation"]` holds the applied summary (job and
attempt id, processor and profile, verdict, counts) of the result that moved the draft, so a
pruned job's verdict remains visible on the version. It is not used as gate evidence: it is
written only when a draft is changed (never for a `result_recorded` revalidation), it does not
carry the stored file's identity that `identity_mismatch` checks, and `metadata` is a general
field rather than an append-only record. If revalidating after 90 days becomes a burden, a
compact immutable evidence row (version, SHA-256, size, storage key, profile, processor version,
verdict, job id, completed at; insert-only, protected like published versions) would let the gate
outlive job retention without keeping whole results. That is a design option for the owner and is
not implemented.

## 11. Database outage

Unchanged from `main`'s consumer (ADR-064): `jobs_consume_results` runs `SELECT 1` before every
receive and does not receive while PostgreSQL is unreachable, so results wait in the results queue
(14 days) instead of moving to its DLQ. A database error mid-batch releases the rest of the batch.
A database error inside `apply(job)` rolls the whole result application back and the message is
retried. The sweep does not time jobs out while results are queued.

## 12. Local testing

```bash
# Unit and integration tests (no AWS):
.venv/bin/python -m pytest -q tests/processing tests/lambda/test_jobs_worker_contract.py \
  tests/lambda/test_jobs_worker_package.py tests/lambda/test_jobs_worker_asset_errors.py \
  tests/repo/test_canonical_processing_guard.py tests/deploy/test_upload_body_limit.py \
  lai/apps/jobs/tests/test_contract_kinds.py lai/apps/jobs/tests/test_contract_storage_errors.py \
  lai/apps/jobs/tests/test_migration_rollback.py lai/apps/assets/tests/test_async_upload.py \
  lai/apps/assets/tests/test_model_validation_results.py \
  lai/apps/assets/tests/test_model_validation_canonical.py \
  lai/apps/assets/tests/test_model_validation_retry.py lai/apps/assets/tests/test_glb_limit.py \
  lai/apps/assets/tests/test_publication_gate.py lai/apps/assets/tests/test_admin_validation.py \
  lai/apps/assets/tests/test_glb_processing_parity.py

# Try it in the local Django Admin (jobs run in-process):
LAI_JOBS_BACKEND=inline LAI_ASSET_ASYNC_VALIDATION=on make runserver
```

The library CLI (`python -m lai_processing`, `CONTRACTS.md` section 11) runs a request against a
local file with no Django or AWS.

### The demo

`scripts/processing/local-demo.sh [--keep]` needs the compose PostgreSQL (`make up`) and
recreates its own database (`lai_processing_demo`, never the development database). It runs
Django with `LAI_JOBS_BACKEND=sqs` against in-memory SQS and S3 fakes (placeholder queue URLs,
never contacted) and the jobs worker exactly as packaged in its zip. Steps: flag-off upload for
comparison; flag-on upload committed as a `DRAFT` with its job on the media queue; publication
refused (`not_validated`, `processing_required`); the packaged worker validates and Django
applies the result; a redelivery ignored as a duplicate; the Admin section; explicit publish and
the resolver; a broken model `REJECTED`; and a count showing no AWS calls.

## 13. Deployment ordering

- Release Django (migration `jobs.0003`, the new kinds and handlers) and the worker zip in the
  same release. Django is the only sender of the new kinds; a work message reaching a worker
  built before this branch is an unknown kind, is retried into the media DLQ, and its job later
  times out. Do not use Validate in background or switch the flag on until both are deployed.
- The worker zip is built by `scripts/aws/package-lambda.sh` and updated by
  `deploy-dev-lambda.yml`; Django by `deploy-dev-native.yml` (native release tarball with
  `processing/lai_processing`) or `deploy-django-ec2.yml` (image). All three trigger on
  `processing/lai_processing/**`.
- **Rollback.** Prefer rolling forward. A code-only rollback (the schema stays at `jobs.0003`)
  works for inserts (both new columns keep `DEFAULT ''`), but the earlier release knows neither
  the new kinds nor their handlers, so before it: switch `LAI_ASSET_ASYNC_VALIDATION` off, wait
  for the media queue and results queue to drain, then mark every unfinished
  `asset.validate_model` and `reference.checksum` job failed (Django Admin, Background jobs,
  "mark failed"). Otherwise the older `jobs_sweep` and outbox relay stop on the first such job
  (`KeyError` for an unknown kind). Reversing the migration itself is refused while rows of the
  new kinds exist (a clear error, not a constraint violation); delete them first if the schema
  must go back.
- Nothing deploys on merge unless the repository variables are `'true'`
  (`LAI_DEV_NATIVE_ENABLED` for the native release and the Lambda workers, `LAI_DEPLOY_ENABLED`
  for the image workflow). Every deployment is an owner approval; live acceptance is LAI-LAMBDA-011.
- `asset.inspect` payloads for a GLB now carry `max_bytes`. A worker built before this change
  refuses the extra field as `invalid_payload` (a failed inspection job, nothing else), so deploy
  the worker zip before, or with, the Django release that sends it. An old payload still queued
  when the new worker arrives is accepted (64 MiB ceiling).
- The open owner decision before live use (artifact writes) is listed in `CANONICAL_PATH.md`,
  "Remaining work and owner decisions". Decided (owner, 2026-11-17) and implemented, not
  deployed: the media role's scoped `s3:ListBucket` (`ListAssetBucket`) and the input ceiling,
  `LAI_ASSET_MAX_GLB_BYTES`, 50 MiB.
