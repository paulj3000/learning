# Wave 2 shared interface decisions (LAI-LAMBDA-002 to 005)

Owner: the principal integration agent. Frozen for Wave 2 on 2026-11-17. Every Wave 2 agent
builds against this page; no agent may introduce a different setting name, message format, bucket
identity, queue name or retry behaviour. A change goes through the principal and is recorded here.
Owner decisions behind it: ADR-061 (accepted 2026-11-16), ADR-055 (merged native dev environment)
and the Wave 2 brief's A1 to A9; the reconciling decision is ADR-062.

## 0. Why this page exists: two job systems met on `main`

`main` gained `apps.jobs` (ADR-055) while Wave 1 was in review. It already has a Django
`ProcessingJob`, a schema-1 work/result envelope, an `asset.inspect` probe, zip-packaged arm64
Lambda workers on `lai-dev-jobs-{ai,media}`, a results consumer
(`manage.py jobs_consume_results`), the `lai-dev-power` schedule and native systemd deployment.
It lacks an outbox, attempt ids, idempotency keys, a completion ledger, artifact records and
cancellation, all of which Wave 1's `lai_processing` contracts provide.

**Decision (ADR-062): one Django job backbone.** `apps.jobs.ProcessingJob` stays the only job
table, admin and sweep (ADR-033: extend the canonical model, never add a second). Wave 2 adds
*contract kinds* to it, whose work and completion messages are the Wave 1 contracts. Existing
*legacy kinds* (`studio.generate_chunk`, `speech.synthesize`, `asset.inspect`) keep their schema-1
envelope, queues, worker zip and consumer **unchanged**. Moving legacy kinds onto the contracts is a
later, separate task. Nothing here creates a `lai/apps/processing` app.

## 1. Packages and ownership

| Path | What | Dependencies | Owner |
|---|---|---|---|
| `processing/lai_processing/` | Wave 1 core: contracts, engine, registry, ports, fakes, CLI | stdlib only (enforced) | principal (002 adds the GLB processor) |
| `processing/lai_processing/processors/gltf/` (or `glb.py` plus helpers) | GLB validator | stdlib only | 002 |
| `processing/lai_processing_runtime/` | adapters, local worker, Lambda handler | `lai_processing`, boto3 (lazy) | 003 |
| `processing/Dockerfile.lambda`, `processing/runtime-requirements.txt` | Lambda image | | 003 |
| `lai/apps/jobs/` (new modules, new migration) | contract kinds: models, outbox, consumer, admin | Django, `lai_processing`, `lai_processing_runtime` | 004 |
| `infra/lib/processing*.ts`, workflows, `deploy/native/**`, `scripts/aws/native/**` processing changes | CDK, CI/CD, native runtime | | 005 |

`lai_processing_runtime` must never import Django; `lai_processing` must never import boto3 or
`lai_processing_runtime`.

## 2. Job types, processors and profiles

| Job type (`kind`) | Processor id | Version | Profile | Status |
|---|---|---|---|---|
| `reference.checksum` | `reference.checksum` | 1.0.0 | `reference-default` v1 | Wave 1 |
| `asset.validate_model` | `asset.glb_validator` | 1.0.0 | `glb-default` v1 | 002 |

`default_registry()` keeps its explicit list; 002 adds one entry and nothing else touches
`core/registry.py`. Results use the Wave 1 `ProcessingJobResult` (findings in the Asset Library
`code/severity/message/path` shape). The GLB metadata object is documented by 002 in
`docs/processing/CONTRACTS.md`, section "GLB validation metadata"; it is deterministic, carries no
file names supplied by staff, and preserves animation clip names exactly.

## 3. Logical stores

| Store | Physical location (S3) | Physical location (filesystem) | Keys |
|---|---|---|---|
| `assets` | `LAI_ASSET_BUCKET` (the existing asset library bucket) | `<assets root>/<key>`; the root is `LAI_ASSET_LOCAL_ROOT` for Django's local asset storage | `assets/...` (existing keys, read-only for workers) |
| `quarantine` | `LAI_PROCESSING_BUCKET` | `<processing root>/<key>` | `processing/quarantine/<namespace>/...` |
| `artifacts` | `LAI_PROCESSING_BUCKET` | `<processing root>/<key>` | `processing/artifacts/<namespace>/<job>/<attempt>/...` |

Messages never name buckets. S3 integrity uses `ChecksumSHA256` (written with
`ChecksumAlgorithm='SHA256'`, read with `ChecksumMode='ENABLED'`, base64 decoded to hex); a
composite multipart checksum (`...-N`) or a missing one is "unknown" and the engine's streamed
hash decides. **An ETag is never treated as a SHA-256.**

## 4. Settings

### Django (`lai/config/settings/base.py`; SSM `/lai/<env>/django/<NAME>`)

| Name | Values / default | Meaning |
|---|---|---|
| `LAI_PROCESSING_BACKEND` | `disabled`, `inline`, `local`, `sqs`. Default `inline` in base and test; production allows only `disabled` or `sqs`, default `disabled` | How contract jobs are transported |
| `LAI_PROCESSING_NAMESPACE` | default `local`; must match the namespace pattern; production requires it set (`dev` or `prod`) | Contract namespace for every job |
| `LAI_PROCESSING_WORK_QUEUE_URL` | required for `sqs` | Processing work queue |
| `LAI_PROCESSING_COMPLETION_QUEUE_URL` | required for `sqs` | Processing completion queue |
| `LAI_PROCESSING_BUCKET` | required for `sqs` | Private processing bucket |
| `LAI_PROCESSING_LOCAL_ROOT` | default `BASE_DIR / ".processing-local"` (gitignored) | `local` backend: stores and queues |
| `LAI_PROCESSING_DISPATCH` | `enabled` (default) or `paused` | `paused`: the outbox relay sends nothing (jobs stay queued) |
| `LAI_PROCESSING_MAX_ATTEMPTS` | 3 (1 to 10) | `RetryPolicy.max_attempts` |
| `LAI_PROCESSING_JOB_TTL_HOURS` | 72 (1 to 336) | `expires_at` = submission + TTL |

### Worker runtime (Lambda environment, local worker flags)

| Name | Meaning |
|---|---|
| `LAI_PROCESSING_NAMESPACE` | Must equal the Django namespace; the engine refuses other namespaces |
| `LAI_PROCESSING_BUCKET` | `quarantine` and `artifacts` stores |
| `LAI_ASSET_BUCKET` | `assets` store (read-only) |
| `LAI_PROCESSING_COMPLETION_QUEUE_URL` | Where completions go |
| `LAI_PROCESSING_CLEANUP_MARGIN_SECONDS` | Default 30: stop starting work, and cap a job's deadline, this long before the Lambda deadline |
| `LAI_PROCESSING_LOG_LEVEL` | Default `INFO` |

## 5. Transport semantics (003 and 004 both implement exactly this)

- **Work message:** the canonical `encode(ProcessingJobRequest)` bytes. Standard SQS queue, no
  FIFO, no message attributes required.
- **Completion message:** the canonical `encode(CompletionEvent)` bytes; a result that does not
  fit is stored as the `report.job_result` artifact (`ExecutionEngine.complete`).
- **Worker, per work record:**
  1. When the remaining Lambda time is below the cleanup margin, do not start the record and
     report it as a batch item failure.
  2. `decode_and_execute` with `max_execution_seconds` clamped to
     `remaining - margin`, so a deadline becomes `processing_timeout` (retryable), never a
     silent kill.
  3. `complete`.
  4. Send the completion.
  5. Return success for the record only after the completion send succeeded; otherwise report a
     batch item failure (the same attempt reruns; artifacts are create-only and identical
     rewrites are idempotent; the duplicate completion is deduplicated by Django).
  An undecodable work message is a batch item failure and reaches the DLQ after
  `maxReceiveCount` (5); it is logged as `work.invalid` with no body content.
- **Django consumer, per completion delivery,** inside one transaction under the job row lock:
  decode, verify (`verify_result` for by-reference results), `decide_completion`, persist, record
  the receipt; **acknowledge only after commit**.
  - `APPLY`, `RETRY`, `DUPLICATE`, `STALE`, `REJECT`: acknowledge. `REJECT` also logs a
    `processing.completion_rejected` security event (ids and reason only).
  - Undecodable or contract-invalid: do not acknowledge; it reaches the completion DLQ after 5
    receives for inspection (`processing.completion_invalid` logged once per receive).
  - Transient (database error, artifact read failure): release with a bounded backoff, do not
    acknowledge.
- **RETRY:** the new attempt (new `attempt_id`, `attempt_number + 1`) and its outbox row are
  written in the same transaction as the decision; the relay sends it after commit.

The port is `lai_processing.ports.MessageQueue` (`send`, `receive`, `ack`, `release`,
`max_message_bytes`). 003 provides `SqsMessageQueue` and `LocalDirectoryQueue`; 004 builds them
through one factory, `apps.jobs.processing_transport`, from the settings above, and tests against
`lai_processing.testing.MemoryQueue`.

## 6. Django public API (004)

| Symbol | Behaviour |
|---|---|
| `apps.jobs.processing.submit_processing_job(*, job_type, subject, input, profile, options=None, asset=None, user=None) -> ProcessingJob` | Resolves options against the profile, computes the idempotency key, and creates job + attempt 1 + outbox row in one transaction. An existing job with the same key is returned (no second job). |
| `apps.jobs.processing.relay_outbox(queue, *, limit=50) -> int` | Sends due outbox rows (`select_for_update(skip_locked=True)`), marks them sent after the send; a crash between send and mark causes a duplicate send, never a lost job. |
| `apps.jobs.processing.apply_completion(body, *, storage) -> CompletionOutcome` | Section 5; `CompletionOutcome(action, ack, reason)` |
| `apps.jobs.processing.cancel_job(job, *, user)` / `requeue_job(job, *, user)` | Staff actions; requeue is the manual FAILED -> QUEUED transition with a new attempt |
| `manage.py jobs_dispatch [--once] [--interval S]` | Outbox relay loop |
| `manage.py jobs_consume_completions [--once] [--max-messages N] [--wait-seconds S]` | Completion consumer loop |
| `manage.py jobs_reconcile [--dry-run]` | Expires overdue queued jobs (`job_expired`) and reports stuck outbox rows |

Status mapping for contract kinds (the coarse `status` the existing admin, filters and sweep use):
CREATED, UPLOADING, QUEUED -> `pending`; PROCESSING -> `running`; VALIDATED, READY_FOR_REVIEW ->
`completed`; FAILED, CANCELLED -> `failed`. The fine-grained `JobState` lives in a new `state`
field. The legacy `sweep` must skip contract kinds (they have `expires_at` and `jobs_reconcile`),
so an overnight backlog is never timed out by the 60-minute legacy rule.

## 7. AWS names (005)

| Resource | Name |
|---|---|
| Stack (both environments) | `LaiProcessing-<env>` |
| Image repository stack (phase 1) | `LaiProcessingImages-<env>`, ECR repository `lai/processing-<env>` |
| Processing bucket | `lai-processing-<env>-<account>-<region>` |
| Work queue / DLQ | `lai-<env>-processing-work`, `lai-<env>-processing-work-dlq` |
| Completion queue / DLQ | `lai-<env>-processing-completions`, `lai-<env>-processing-completions-dlq` |
| Worker function and role | `lai-<env>-processing-worker` |
| Django managed policy | `lai-django-processing-<env>`, attached by name to `lai-django-ec2-<env>` |
| Image publisher role (GitHub OIDC) | `lai-github-processing-publisher-<env>` |
| Alarm topic | existing `lai-django-alarms-<env>` |

Defaults: worker timeout 600 s (at most 840 s, the Wave 1 ceiling), memory 2048 MB, ephemeral
storage 2048 MB, arm64, batch size 1, `ReportBatchItemFailures`, reserved concurrency 2 (dev);
work queue visibility 3600 s (6 x timeout), completion queue visibility 300 s, retention 14 days,
`maxReceiveCount` 5, SSE-SQS, TLS-only queue policies. The function exists only when an image
digest (`sha256:...`) is supplied (two-phase provisioning: repository, then image, then worker).
Handler `lai_processing_runtime.lambda_handler.handler`; image built from `processing/` with
`processing/Dockerfile.lambda` for `linux/arm64`.

## 8. Native EC2 (005)

Django on the instance imports `lai_processing` and `lai_processing_runtime`: the release must
ship them (a wheel built from `processing/` in the release job, installed offline with the rest),
and so must the production container image. New systemd units `lai-jobs-dispatch.service` and
`lai-jobs-completions.service` run the two commands above; `power-native.sh quiesce` stops them
with the existing consumer, and `verify` starts them after the health check.
