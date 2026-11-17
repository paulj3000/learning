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
4. Only a `DRAFT` is changed.

| `subject_outcome` | Meaning | Version changed |
|---|---|---|
| `version_validated` | Verdict `pass`; draft is now `VALIDATED` (`validated_at` set) | Yes |
| `version_rejected` | Verdict `fail`; draft is now `REJECTED` | Yes |
| `result_recorded` | Version is not a draft (for example published); a manual revalidation. Result stays on the job | No |
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
an active asset, or reports the existing job for the same file. It works whatever the flag says
and never changes the version. It is the way to revalidate an existing or published model
without rewriting its metadata (a non-draft gets `result_recorded`). Retired assets and non-GLB
formats are refused with a message.

## 8. Publication gate

`services.publish_version` refuses a GLB with `processing_required` when the flag is on and no
completed job of this version passes `_has_passing_validation`: verdict `pass`, outcome not a
mismatch, `result_invalid`, `version_missing` or `processing_failed`, `identity_mismatch` clean,
and the result's processor version equal to the one this build runs (`processor_outdated`
otherwise). A draft is still refused first with `not_validated`. The gate does not apply to
rollback, `set_default_version` or republishing, and the flag off leaves publishing unchanged.

`jobs_sweep` deletes completed jobs after `LAI_JOBS_RETENTION_DAYS` (30). A `VALIDATED` GLB whose
passing job was pruned is refused by the gate until staff run Validate in background again.

## 9. Retries, duplicates, timeouts

- **Same logical work.** `submit_model_validation` reuses a job with the same idempotency key
  that is `PENDING`, `RUNNING`, or `COMPLETED` with an applied outcome (`version_validated`,
  `version_rejected`, `result_recorded`). A `FAILED` job, or a completed one whose result was
  refused (a mismatch or `result_invalid`), may be submitted again as a new job with a new attempt
  id.
- **Redelivery.** The worker stores the result in S3 before sending it; a redelivered work
  message re-sends the stored result without a second run, and `apply_result` ignores it as a
  duplicate (the job is terminal). A redelivered result message is ignored the same way.
- **Retryable failures** (for example a transient S3 read during the input copy) are redelivered
  by SQS and land in `lai-<env>-jobs-media-dlq` after 3 receives. The job stays `RUNNING` until
  `jobs_sweep` fails it as `timeout` (after `LAI_JOBS_STALE_MINUTES`, 60, and only when the
  results queue is empty). Staff then run Validate in background again.
- **Execution budget.** The request carries `max_execution_seconds` 90 (the profile allows 300).
  The media function's timeout is 120 s (`infra/lib/devPlatformStack.ts`), so the engine stops
  first with a classified, logged `processing_timeout` (retryable: SQS redelivers it, DLQ after 3
  receives) instead of Lambda ending the run part-way with nothing classified.
- **Expiry.** A request older than 72 hours is refused by the worker with `job_expired`.
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

## 10. Database outage

Unchanged from `main`'s consumer (ADR-064): `jobs_consume_results` runs `SELECT 1` before every
receive and does not receive while PostgreSQL is unreachable, so results wait in the results queue
(14 days) instead of moving to its DLQ. A database error mid-batch releases the rest of the batch.
A database error inside `apply(job)` rolls the whole result application back and the message is
retried. The sweep does not time jobs out while results are queued.

## 11. Local testing

```bash
# Unit and integration tests (no AWS):
.venv/bin/python -m pytest -q tests/processing tests/lambda/test_jobs_worker_contract.py \
  tests/lambda/test_jobs_worker_package.py tests/repo/test_canonical_processing_guard.py \
  lai/apps/jobs/tests/test_contract_kinds.py lai/apps/assets/tests/test_async_upload.py \
  lai/apps/assets/tests/test_model_validation_results.py \
  lai/apps/assets/tests/test_model_validation_canonical.py \
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

## 12. Deployment ordering

- Release Django (migration `jobs.0003`, the new kinds and handlers) and the worker zip in the
  same release. Django is the only sender of the new kinds; a work message reaching a worker
  built before this branch is an unknown kind, is retried into the media DLQ, and its job later
  times out. Do not use Validate in background or switch the flag on until both are deployed.
- The worker zip is built by `scripts/aws/package-lambda.sh` and updated by
  `deploy-dev-lambda.yml`; Django by `deploy-dev-native.yml` (native release tarball with
  `processing/lai_processing`) or `deploy-django-ec2.yml` (image). All three trigger on
  `processing/lai_processing/**`.
- Nothing deploys on merge unless the repository variables are `'true'`
  (`LAI_DEV_NATIVE_ENABLED` for the native release and the Lambda workers, `LAI_DEPLOY_ENABLED`
  for the image workflow). Every deployment is an owner approval; live acceptance is LAI-LAMBDA-011.
- `asset.inspect` payloads for a GLB now carry `max_bytes`. A worker built before this change
  refuses the extra field as `invalid_payload` (a failed inspection job, nothing else), so deploy
  the worker zip before, or with, the Django release that sends it. An old payload still queued
  when the new worker arrives is accepted (64 MiB ceiling).
- Open owner decisions before live use are listed in `CANONICAL_PATH.md`, "Remaining work and
  owner decisions" (media role `s3:ListBucket`, artifact writes). The input ceiling is decided:
  `LAI_ASSET_MAX_GLB_BYTES`, 50 MiB (owner, 2026-11-17).
