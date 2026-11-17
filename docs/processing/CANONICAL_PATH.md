# Canonical background processing path (ADR-064)

Owner decision, 2026-11-17: Django `apps.jobs`, SQS, Lambda and ADR-055 are the one
background-processing architecture. This page records how the serverless processing pull
requests were reconciled with it and what remains to re-land.

## The path

| Concern | Implementation on `main` |
|---|---|
| Job record | `apps.jobs.ProcessingJob` (one table, one admin, one sweep) |
| Reliable submission | Transactional outbox: committed `PENDING` row, on-commit send under `FOR UPDATE SKIP LOCKED`, `dispatched_at`; `services.relay()` in the consumer re-sends undispatched rows once a minute; 5 failed sends fail the job (`submit_failed`) |
| Work queues | `lai-<env>-jobs-ai`, `lai-<env>-jobs-media`, each with a DLQ after 3 receives |
| Workers | Zip-packaged arm64 Lambda functions outside the VPC (`lambda/jobs_worker`), no database access |
| Completion | Result in S3 (`jobs/results/`) first, then a schema-1 message to `lai-<env>-job-results` (DLQ after 5 receives, 14-day retention) |
| Consumer | `jobs_consume_results` (`lai-jobs-consumer.service`), the only consumer |
| Database outage | `SELECT 1` before every receive; no receive while PostgreSQL is down; the rest of a batch is released on a mid-batch database error; the sweep does not time jobs out while results are queued |
| Idempotency | Duplicate and late results ignored under a row lock; Studio slot uniqueness; S3 results written before the message |
| Cancellation, retries | Admin fail action (`fail_processingjob`); Studio cancel and retry (`cancel_generationbatch`, `retry_generationbatch`); SQS redelivery bounded by DLQs |
| Monitoring | One CloudWatch alarm per DLQ; Lambda, jobs and Django log groups; Django Admin job list |
| IAM | Instance: send to work queues, consume results. Workers: own queue, send results, own S3 prefix; AI worker: US inference profile and Guardrail in the Bedrock Region |
| Flags | `EnableLambdaProcessing`, `LAI_JOBS_BACKEND`, `LAI_STUDIO_RUN_MODE`, `LAI_DEV_NATIVE_ENABLED`; `LAI_ASSET_ASYNC_VALIDATION` (approved, default off) arrives with the contract kinds |
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

To re-land on this path (LAI-LAMBDA-002 and 004 stay open until then):

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
| `lai_processing` library: contracts, codec, limits, errors, idempotency, lifecycle, retry, registry, execution engine, ports, reference processor, CLI, fakes | PR #40 (LAI-LAMBDA-001) | `processing/lai_processing/` (identical to the wave3 branch), tests in `tests/processing/` |
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
| Live AWS acceptance (LAI-LAMBDA-011): deploy Django and the worker zip, run a flag-on upload, a failure and a DLQ redrive in dev | Open; every deploy needs owner approval |
| Media worker IAM: the role has `s3:GetObject` on the asset bucket but no `s3:ListBucket`, so S3 answers 403 (not 404) for a missing key. The worker treats it as a transient storage error: the message is retried and lands in the media DLQ instead of failing as `input_missing`. `asset.inspect` has the same behaviour | Recommendation: add `s3:ListBucket` on the asset bucket (scoped to `assets/`) to the media role. Owner-approved IAM change needed; not made |
| GLB input limit (owner decision 2026-11-17): `LAI_ASSET_MAX_GLB_BYTES`, default 52,428,800 bytes (50 MiB), bounds 1,048,576 (1 MiB) to 52,428,800 (`LAI_ASSET_GLB_CEILING_BYTES`, the `glb-default` profile's `max_input_bytes`, below the 64 MiB `asset.inspect` hard ceiling); effective value min of it and `LAI_ASSET_MAX_UPLOAD_BYTES`. Applied to the Admin upload (`too_large` before hashing or storing), the `asset.validate_model` request (`max_input_bytes = min(profile, setting)`; a larger version is refused with `resource_limit_exceeded` before any job exists) and `asset.inspect` (`max_bytes` in the payload; Django refuses with `object_too_large` before submitting and the worker before reading; a payload without the field keeps 64 MiB). nginx `client_max_body_size 55m` covers it | Done on `fix/can-glb-limit`; deploy the worker zip before or with Django (an old worker refuses `max_bytes` as `invalid_payload`) |
| Artifact writes (for example `write_report: true`) | Not supported on this path: the worker's storage port is read-only for the `assets` store, so the engine classifies a write as `permission_denied`. Needs its own design before any kind writes artifacts |
| Wave 4 workloads (LAI-LAMBDA-008, 009, 010, 013) | Not started; see `WAVE4_HANDOFF.md` |
