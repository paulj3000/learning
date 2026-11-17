# Canonical background processing path (ADR-064)

Owner decision, 2026-11-17: Django `apps.jobs`, SQS, Lambda and ADR-055 are the one
background-processing architecture. This page records how the serverless processing pull
requests were reconciled with it and what was re-landed.

## The path

The model validation retries and retention, `ListAssetBucket` and `LAI_ASSET_ASYNC_VALIDATION`
in this table arrive with PR #42 (`feature/serverless-processing-canonical`); the rest is on `main`.

| Concern | Implementation on `main` plus PR #42 |
|---|---|
| Job record | `apps.jobs.ProcessingJob` (one table, one admin, one sweep) |
| Reliable submission | Transactional outbox: committed `PENDING` row, on-commit send under `FOR UPDATE SKIP LOCKED`, `dispatched_at`; `services.relay()` in the consumer re-sends undispatched rows once a minute; 5 failed sends fail the job (`submit_failed`) |
| Work queues | `lai-<env>-jobs-ai`, `lai-<env>-jobs-media`, each with a DLQ after 3 receives |
| Workers | Zip-packaged arm64 Lambda functions outside the VPC (`lambda/jobs_worker`), no database access |
| Completion | Result in S3 (`jobs/results/`) first, then a schema-1 message to `lai-<env>-job-results` (DLQ after 5 receives, 14-day retention) |
| Consumer | `jobs_consume_results` (`lai-jobs-consumer.service`), the only consumer |
| Database outage | `SELECT 1` before every receive; no receive while PostgreSQL is down; the rest of a batch is released on a mid-batch database error; the sweep does not time jobs out while results are queued |
| Idempotency | Duplicate and late results ignored under a row lock; Studio slot uniqueness; S3 results written before the message |
| Cancellation, retries | Admin fail action (`fail_processingjob`); Studio cancel and retry (`cancel_generationbatch`, `retry_generationbatch`); SQS redelivery bounded by DLQs; model validation: staff resubmission of a failed, cancelled, refused or superseded job as a new job under the asset row lock, at most `LAI_ASSET_VALIDATION_MAX_ATTEMPTS` (5) per file and processor version, no cancelled status (a contract cancel is `failed` with code `cancelled`; `ASYNC_MODEL_VALIDATION.md` section 9) |
| Retention | `jobs_sweep` deletes completed jobs after `LAI_JOBS_RETENTION_DAYS` (30), completed `asset.validate_model` jobs after `LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS` (90; a job exactly at the limit is kept); pending, running and failed jobs are never deleted. An unpublished GLB whose passing job was pruned needs a new validation; published versions are unaffected (`ASYNC_MODEL_VALIDATION.md` section 10) |
| Monitoring | One CloudWatch alarm per DLQ; Lambda, jobs and Django log groups; Django Admin job list |
| IAM | Instance: send to work queues, consume results. Workers: own queue, send results, own S3 prefix; media worker: read asset objects and list the asset bucket (`ListAssetBucket`, "Asset read errors" below); AI worker: US inference profile and Guardrail in the Bedrock Region |
| Flags | `EnableLambdaProcessing`, `LAI_JOBS_BACKEND`, `LAI_STUDIO_RUN_MODE`, `LAI_DEV_NATIVE_ENABLED`; `LAI_ASSET_ASYNC_VALIDATION` (implemented, default off) |
| Infrastructure | `LaiDevPlatform-dev` only; no ECR in dev |

## Disposition of the pull requests

**PR #40 (`feature/serverless-processing`, LAI-LAMBDA-001, ADR-061).** Not merged; branch kept.
Its `lai_processing` package (versioned contracts, codec, limits, classified errors, lifecycle,
retry policy, processor registry, local CLI) is useful and standard-library only. It re-lands as
the processor library inside the existing zip worker, and its job types become `apps.jobs` kinds.
Superseded: its separate work and completion queues and the `LaiProcessing-<env>` plan.

**PR #41 (`feature/serverless-processing-wave2`, LAI-LAMBDA-002 to 005, ADR-062).** Not merged;
branch kept. Ported to `main` now:

- the consumer that never spends a receive while the database is down (`jobs_consume_completions`
  behaviour, applied to `jobs_consume_results`);
- the outbox relay semantics of `jobs_dispatch`, folded into the existing consumer so no new
  systemd unit is needed.

Re-landed on this path (LAI-LAMBDA-002 and 004, done on `feature/serverless-processing-canonical`;
see "Re-land status" below):

- the `asset.validate_model` and `reference.checksum` kinds, as `JobKind` values on the media
  queue, with their attempt, receipt and artifact records extending `ProcessingJob` (no second
  model);
- the pure-Python GLB validator, packaged into `jobs-worker-<hash16>.zip`;
- the contract envelope, introduced consumer first (Django accepts it before any worker sends it);
- `LAI_ASSET_ASYNC_VALIDATION` (default off) and the Asset Library submission path.

Not taken: `LaiProcessing-<env>`, `LaiProcessingImages-<env>`, the ECR repository and
`Dockerfile.lambda`, `deploy-processing.yml` and the `processing-<env>` GitHub environments, the
processing bucket, `jobs_dispatch` and `jobs_consume_completions` as separate services, and the
`lai-jobs-dispatch` and `lai-jobs-completions` systemd units.

## Separately tracked workloads (do not block the first deployment)

| Workload | Card | Packaging |
|---|---|---|
| GLB optimization (meshopt, Draco, KTX2) | LAI-LAMBDA-010 | Native tools; a container image only after its own ADR |
| Audio transcoding and loudness | LAI-LAMBDA-008 | FFmpeg; a container image only after its own ADR |
| Thumbnails and image conversion | LAI-LAMBDA-013 | Pillow or libvips wheels may fit the zip; decided with the card |

## Re-land status (branch `feature/serverless-processing-canonical`, 2026-11-17)

Developer-complete on `feature/serverless-processing-canonical`; owner review pending, not merged,
not deployed. The flow is described in `ASYNC_MODEL_VALIDATION.md`; the library contracts in
`CONTRACTS.md` and the validator in `GLB_VALIDATION.md`.

### Re-landed (reused from PR #40, PR #41 and `feature/serverless-processing-wave3`)

| Item | Source | Where on this branch |
|---|---|---|
| `lai_processing` library: contracts, codec, limits, errors, idempotency, lifecycle, retry, registry, execution engine, ports, reference processor, CLI, fakes | PR #40 (LAI-LAMBDA-001) | `processing/lai_processing/` (re-landed with the Wave 2/3 review fixes, plus a comment in `core/limits.py`), tests in `tests/processing/` |
| GLB validator (`asset.glb_validator` 1.0.0, profile `glb-default` v1) and its Django parity test | PR #41 (LAI-LAMBDA-002) | `processing/lai_processing/processors/gltf/`, `lai/apps/assets/tests/test_glb_processing_parity.py` |
| `asset.validate_model` and `reference.checksum` as `apps.jobs` kinds on the media queue | PR #41 (LAI-LAMBDA-004), reshaped | `lai/apps/jobs/core/envelope.py` (`KIND_QUEUE`), `models.py` (`JobKind`, `idempotency_key`, `subject_outcome`), `migrations/0003_contract_kinds.py`, `services.submit(job_id=, idempotency_key=)`, `services.HANDLER_MODULES` |
| Contract execution inside the schema-1 envelope (ADR-061 request as `payload`, ADR-061 result as `result`) | new on this branch | `lai/apps/jobs/core/contract.py`, `tasks.RUNNERS` |
| `lai_processing` vendored into the existing worker zip (without `testing/`, `cli/`, `__main__.py`; about 351 KB) | replaces PR #41's ECR image | `lambda/build.py`; asset ports for the new kinds in `lambda/jobs_worker/aws.py` |
| `LAI_ASSET_ASYNC_VALIDATION` (default `off`), DRAFT upload with its job in one transaction, handler `apply(job)`, publication gate `processing_required` | wave3 (LAI-LAMBDA-006, 007), reshaped | `lai/config/settings/base.py`, `production.py`, `lai/apps/assets/processing.py`, `services.py` |
| Django Admin "Background validation" section and "Validate in background" action | wave3 (LAI-LAMBDA-007) | `lai/apps/assets/admin.py` |
| Release and image ship `processing/lai_processing` beside `lai/`; settings add `processing/` to `sys.path` | new on this branch | `scripts/aws/native/package-release.sh` (without contract fixtures), `lai/Dockerfile`, workflow path filters |
| Guard against the superseded plan | new on this branch | `tests/repo/test_canonical_processing_guard.py` |
| Local demonstration (Django plus the packaged worker zip, in-memory SQS and S3) | wave3 demo, rewritten | `scripts/processing/local-demo.sh`, `scripts/processing/canonical_demo.py` |

### Superseded (not taken; confirmed absent on this branch)

| Item | Replaced by |
|---|---|
| `processing/lai_processing_runtime` (local worker, filesystem, S3 and SQS adapters, Lambda handler; LAI-LAMBDA-003) | The existing zip worker `lambda/jobs_worker` with `core/contract.py` |
| `processing/Dockerfile.lambda`, ECR repository, `deploy-processing.yml`, `processing-<env>` environments | `jobs-worker-<hash16>.zip` and `deploy-dev-lambda.yml` |
| `LaiProcessing-<env>`, `LaiProcessingImages-<env>`, separate work and completion queues, processing bucket (LAI-LAMBDA-005) | `lai-<env>-jobs-media` and `lai-<env>-job-results`; results under `jobs/results/` |
| `jobs_dispatch`, `jobs_consume_completions`, `lai-jobs-dispatch` and `lai-jobs-completions` units | `services.relay()` and `jobs_consume_results` |
| `CompletionEvent` transport and result-by-reference artifacts | The schema-1 result envelope (S3 pointer above 200 KB) |
| Completion hook registry `apps.jobs.hooks` and `apps/assets/completion.py` | The kind's handler module (`HANDLER_MODULES`), `apps.assets.processing.apply` |

`tests/repo/test_canonical_processing_guard.py` fails if the stacks, the ECR image, the runtime
package, the processing workflow, the two commands or the two units return in deployable code.

### Remaining work and owner decisions

| Item | State |
|---|---|
| Owner review and merge of this branch | Pending |
| Validation retry and retention (owner decisions 2026-11-17) | Implemented; `fix/can-retry-retention` merged into this branch: bounded staff resubmission, superseded results, newest-result gate, 90-day validation job retention (`ASYNC_MODEL_VALIDATION.md` sections 9 and 10). Open: whether failed validation jobs should also expire after 90 days (kept, as for every kind), and a compact immutable evidence record (not implemented) |
| Live AWS acceptance (LAI-LAMBDA-011): deploy Django and the worker zip, run a flag-on upload, a failure and a DLQ redrive in dev | Open; every deploy needs owner approval |
| Media worker IAM and missing assets | Done in the repository (owner decision 2026-11-17), not deployed: `ListAssetBucket` on the media role and the error classification below. Live 404 verification stays in LAI-LAMBDA-011 |
| GLB input limit (owner decision 2026-11-17): `LAI_ASSET_MAX_GLB_BYTES`, default 52,428,800 bytes (50 MiB), bounds 1,048,576 (1 MiB) to 52,428,800 (`LAI_ASSET_GLB_CEILING_BYTES`, the `glb-default` profile's `max_input_bytes`, below the 64 MiB `asset.inspect` hard ceiling); effective value min of it and `LAI_ASSET_MAX_UPLOAD_BYTES`. Applied to the Admin upload (`too_large` before hashing or storing), the `asset.validate_model` request (`max_input_bytes = min(profile, setting)`; a larger version is refused with `resource_limit_exceeded` before any job exists) and `asset.inspect` (`max_bytes` in the payload; Django refuses with `object_too_large` before submitting and the worker before reading; a payload without the field keeps 64 MiB). nginx `client_max_body_size 55m` covers it | Done; `fix/can-glb-limit` merged into this branch, not deployed; deploy the worker zip before or with Django (an old worker refuses `max_bytes` as `invalid_payload`) |
| Artifact writes (for example `write_report: true`) | Not supported on this path: the worker's storage port is read-only for the `assets` store, so the engine classifies a write as `permission_denied`. Needs its own design before any kind writes artifacts |
| Wave 4 workloads (LAI-LAMBDA-008, 009, 010, 013) | Not started; see `WAVE4_HANDOFF.md` |

## Asset read errors (media worker)

Owner decision, 2026-11-17: the media worker may list the asset bucket so a missing object can be
told apart from a denied one. S3 answers a HeadObject or GetObject of a missing key with 404 only
when the caller is allowed `s3:ListBucket` on the bucket; otherwise it answers 403.

The statement on `lai-dev-jobs-media-worker` (`infra/lib/devPlatformStack.ts`), and on no other
role:

```json
{
  "Sid": "ListAssetBucket",
  "Effect": "Allow",
  "Action": "s3:ListBucket",
  "Resource": "arn:aws:s3:::lai-assets-dev-<account>-<region>",
  "Condition": { "StringLikeIfExists": { "s3:prefix": ["assets/*"] } }
}
```

Why `StringLikeIfExists` and not `StringLike`: a HEAD or GET request carries no `s3:prefix` key,
and in IAM a condition operator other than `...IfExists` (or `Null`) on a key absent from the
request context does not match. A plain `StringLike` on `s3:prefix` would therefore most likely
not apply to the HEAD, and the 403 would stay. `StringLikeIfExists` matches when the key is
absent and still holds an explicit list prefix to `assets/*`. The limitation: it also allows a
`ListObjectsV2` call with no prefix. That is acceptable because the bucket holds only asset
library objects under `assets/models|images|audio/` (`AssetStorageStack`; the Django policy on
the same bucket already lists it without a condition, `docs/ASSET_LIBRARY.md`), child photos and
speech are in their own buckets which this statement does not name, and the worker never calls
`ListObjects`. Object reads are unchanged (`ReadAssets`: `s3:GetObject` on the asset objects
only); the AI worker gains nothing. Not yet verified against S3: LAI-LAMBDA-011 checks a 404 for
a missing key live.

Classification (`lambda/jobs_worker/aws.py` `_asset_error`, `lai/apps/jobs/core/contract.py`
`_storage_error`):

| S3 outcome | Worker code | `asset.inspect` | `asset.validate_model`, `reference.checksum` | Retried |
|---|---|---|---|---|
| NoSuchKey, 404 (HEAD returns `None`) | `object_missing` | failed `object_missing` | failed `input_missing` (`ObjectMissing`) | No |
| NoSuchVersion | `object_missing` | failed `object_missing` | failed `input_missing` | No |
| AccessDenied, 403 (also InvalidAccessKeyId, SignatureDoesNotMatch, AllAccessDisabled, AccountProblem) | `access_denied` | failed `access_denied` | failed `permission_denied` (`StoragePermissionDenied`) | No |
| SlowDown, Throttling, 503, 429 | `throttled` | retried | retried, `throttled` | Yes (SQS, then DLQ) |
| Connection, connect or read timeout, broken response stream | `connection` / `timeout` | retried | retried, `storage_failure` | Yes |
| 5xx InternalError and anything unrecognised | `storage` | retried | retried, `storage_failure` | Yes |

A 403 is never read as "missing". AccessDenied is permanent: a retry cannot cure a policy, key or
bucket-setting problem (it needs a change and a deploy), so retrying would only spend the three
receives and reach the DLQ later; the job fails at once with a distinct code an operator can act
on and is resubmitted after the fix. If the `ListAssetBucket` grant were missing or ineffective, a
missing key would show as `access_denied`/`permission_denied`, which is the signal to check IAM.
An object deleted between the size check and the ranged read is also `object_missing`. Django's
inline ports (`apps.assets.jobs.InlinePorts`) report the same codes.
