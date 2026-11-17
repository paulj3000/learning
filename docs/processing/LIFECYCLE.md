# Processing job lifecycle

This page explains identities, the four state machines, the transition table, and how
duplicates, stale results, cancellation and retries behave. The pure decision logic is
`lai_processing.core.lifecycle` and the retry policy is `lai_processing.core.retry`. If this page
and the code disagree, the code wins and this page is corrected.

**Delivery guarantee: at-least-once.** Every queue may deliver a message more than once, late,
or out of order. The system never claims exactly-once processing. It claims **idempotent
application**: applying the same completion twice has the effect of applying it once.

## 1. Identities

| Identity | Format | Created by | Stable across | Purpose |
|---|---|---|---|---|
| `idempotency_key` | `ik1:<sha256 hex>` | Django, before creating the job row | Retries, redeliveries, re-submission of the same work | Identity of the **logical work**: one key, one job |
| `job_id` | UUID | Django (the job row) | Every attempt of the job | The authoritative record |
| `attempt_id` | UUID | Django, per attempt | Redeliveries of the same attempt only | One execution attempt; **new on every retry**; prefixes artifact keys |
| `attempt_number` | 1 to 100 | Django | | Ordinal, for retry policy and display |
| `correlation_id` | `[A-Za-z0-9._-]{8,64}` | Django (request id) | | Log tracing only; carries no meaning |
| `event_id` | UUID | Worker, per event | | Diagnostics; not used for deduplication |
| Queue `message_id`, `receipt` | transport | SQS | | Transport only (`ports/queue.py`); never job identity |

**Idempotency key inputs.** SHA-256 over the canonical JSON of: `namespace`, `job_type`,
`subject`, `profile` (id and version), the input identity (`store`, `key`, `version_id`,
`sha256`, `size_bytes`, `content_type`), the **resolved** options (after
`ProcessingProfile.resolve_options`), and the processor version. Excluded on purpose: `job_id`,
attempt ids, correlation ids, timestamps and limits, so a retry or a re-submission of the same
work maps to the same key.

The helper is `lai_processing.core.idempotency`: `idempotency_key(...)`,
`request_idempotency_key(request, processor_version=None)` and `verify_idempotency_key(...)`
(constant-time comparison); `idempotency_material(...)` returns the exact dict that is hashed.
The request has no processor field, so `processor_version` is optional: Django either omits it or
takes it from `default_registry()` for the job's profile. The execution engine accepts a key that
matches either form and refuses any other with `invalid_input` (field `idempotency_key`) before it
reads a byte of input, so a hand-edited or forged request cannot run under another job's
identity. Requests must carry fully resolved options, or the key will not verify.

## 2. Four separate state machines

They are kept apart deliberately. Mixing them is how "processing succeeded" turns into
"published" by accident.

| Machine | States | Owner | Stored in |
|---|---|---|---|
| Application job state | `CREATED`, `UPLOADING`, `QUEUED`, `PROCESSING`, `VALIDATED`, `READY_FOR_REVIEW`, `FAILED`, `CANCELLED` | Django | `apps.jobs.ProcessingJob.state` (Wave 2; lower-case values, coarse `status` kept in step) |
| Worker result | `status`: `succeeded`, `failed`, `cancelled`; `verdict`: `pass`, `fail`, `not_applicable` | Worker | `ProcessingJobResult` |
| Delivery | in flight, acknowledged, released (visible again), dead-lettered | SQS | Queue |
| Asset review and publication | `AssetVersion`: `DRAFT`, `VALIDATED`, `REJECTED`, `PUBLISHED`, `RETIRED` | Django Admin staff | `assets.AssetVersion` |

A succeeded result with verdict `fail` is a **successful job** whose input failed validation:
the job reaches review and, with `LAI_ASSET_ASYNC_VALIDATION=on`, the asset completion hook moves
the `DRAFT` version to `REJECTED`; it is never published (section 10). No transition
in any machine publishes an asset; only the existing staff publish action does (ADR-045).

## 3. Application job transitions

| From | Allowed to | Notes |
|---|---|---|
| `CREATED` | `UPLOADING`, `QUEUED`, `FAILED`, `CANCELLED` | `QUEUED` directly when the input is already stored |
| `UPLOADING` | `QUEUED`, `FAILED`, `CANCELLED` | |
| `QUEUED` | `PROCESSING`, `VALIDATED`, `FAILED`, `CANCELLED`, `QUEUED` | `VALIDATED` directly because the worker cannot report "started"; `QUEUED` to `QUEUED` is a retry with a new attempt |
| `PROCESSING` | `VALIDATED`, `QUEUED`, `FAILED`, `CANCELLED` | `PROCESSING` is only reachable if a future runtime can report start |
| `VALIDATED` | `READY_FOR_REVIEW`, `FAILED` | |
| `FAILED` | `QUEUED` | **Manual only** (staff re-queue); creates a new attempt |
| `READY_FOR_REVIEW` | none | Terminal for processing; review and publication continue on `AssetVersion` |
| `CANCELLED` | none | Terminal |

## 4. Applying a completion: `decide_completion`

`decide_completion(job snapshot, event, result)` is a pure function. Django calls it inside the
transaction that holds the job row lock, then persists what it returns. Every decision ends with
the message **acknowledged after the commit**; none leaves a message to be redelivered forever.

| Decision | When (design) | Effect | Ack |
|---|---|---|---|
| `APPLY` | Event identifies the job's **current** attempt (job id, attempt id, idempotency key, namespace, input checksum all match Django's record), the job is `QUEUED` or `PROCESSING`, and the attempt is not in the applied ledger | Succeeded: job to `VALIDATED` (then `READY_FOR_REVIEW`), findings, metadata and artifacts recorded. Failed with permanent, manual or cancelled class: `FAILED` or `CANCELLED` | After commit |
| `RETRY` | As `APPLY`, but the result failed with a **retryable** error and attempts remain under the policy | Job stays or returns to `QUEUED`; a new attempt (new `attempt_id`) and an outbox row with the policy's delay are written in the same transaction | After commit |
| `DUPLICATE` | This attempt is already in the applied ledger | Nothing changes | After commit (or immediately: nothing to commit) |
| `STALE` | The attempt is real but no longer current (a later attempt exists, or the job is already terminal or cancelled) | Recorded for audit; state unchanged; its artifacts become orphans for cleanup | After commit |
| `REJECT` | Identity mismatch: unknown job, wrong idempotency key or namespace, input checksum differs from Django's record, result digest wrong, artifact outside the attempt prefix | Nothing applied; logged as a **security signal** (closed telemetry fields only) | After commit of the audit record |

A retryable failure with attempts exhausted is applied as `FAILED`.

A malformed message that cannot even be decoded is not passed to `decide_completion`. As built
(Wave 2) the consumer neither acknowledges nor releases it (outcome `invalid`, `ack=False`), so it
becomes visible again after the queue's visibility timeout and after `maxReceiveCount` (5) moves
to the completion DLQ (`OPERATIONS.md`). Section 9 lists the reasons the built consumer records.

## 5. Stale, duplicate and cancel semantics

- **Duplicate work message.** The worker may run the same attempt twice. Artifact keys are the
  same (same `attempt_id`); create-only writes make an identical rewrite a no-op and different
  bytes an `artifact_conflict`. Two completions for one attempt arrive; the second is `DUPLICATE`.
- **Stale result.** An old attempt finishing after Django re-queued the job (for example after a
  visibility timeout and a manual re-queue) is `STALE`. It cannot overwrite the current attempt,
  because results are keyed by `attempt_id` and artifacts live under their own attempt prefix.
- **Cancellation.** Django sets `CANCELLED` under the row lock. A worker already running cannot
  be told (it has no database); its completion arrives later and is `STALE`. The engine also
  supports cooperative cancellation for the local runtime. A cancelled job is never retried.
- **Out of order.** A completion arriving while Django still shows `QUEUED` is normal (section 3).

## 6. How Wave 2 and Wave 3 make this durable (Django and PostgreSQL)

This was the Wave 1 plan. Wave 2 built it under different names (no `lai/apps/processing` app,
ADR-062): `ProcessingAttempt` is `apps.jobs.JobAttempt`, `ProcessingOutbox` is
`apps.jobs.JobOutbox`, and a `CompletionReceipt` ledger was added. Section 9 describes exactly
what exists.

| Mechanism | Guarantees | Task |
|---|---|---|
| Unique constraint on `(namespace, idempotency_key)` (exact columns per 004) | One job per logical work, even under concurrent submits | 004 |
| `select_for_update` on the job row around every transition, validated through the lifecycle module | No two transitions race; illegal transitions are refused | 004 |
| Applied-attempt ledger (`ProcessingAttempt` with a unique attempt id and an applied marker) | `DUPLICATE` detection survives restarts | 004 |
| Transactional outbox (`ProcessingOutbox`) written in the same transaction as `QUEUED` | No lost and no phantom work messages | 004 dispatcher, 006 enqueue after upload |
| Completion consumer acks only after commit | No lost completions | 004, 006 |
| Immutable, attempt-scoped artifact keys plus create-only writes | Redelivery cannot corrupt artifacts; cross-attempt substitution refused | Wave 1 contracts, 003 S3 adapter |
| Lease and reconciliation (card 004) | A job stuck in `QUEUED` past its expiry or lease is found and re-queued or failed by a reconciliation command | 004 |

## 7. Retry and backoff

`RetryPolicy` (`core/retry.py`, Wave 1 design values):

| Setting | Value |
|---|---|
| `max_attempts` | 3 (including the first) |
| Base delay | 30 s |
| Multiplier | 2 |
| Cap | 900 s (the SQS maximum `DelaySeconds`) |
| Jitter | Full jitter: uniform between 0 and the capped exponential delay |
| Retries only | errors whose class is `retryable` (`processing_timeout`, `temporary_failure`, `throttled`, `storage_failure`) |

Two retry layers exist and must not be confused:

| Layer | What retries | Bound |
|---|---|---|
| Application (`RetryPolicy`, in Django) | A completed attempt that reported a retryable failure; each retry is a **new attempt** | 3 attempts |
| Transport (SQS redelivery) | A message whose processing crashed before ack (worker crash, Lambda timeout, consumer crash, RDS down) | `maxReceiveCount` 5, then DLQ |

## 8. Job expiry

A request may carry `expires_at` (after `submitted_at`). A worker that receives an expired
request does not run it and reports `job_expired` (permanent). This bounds how stale a queued
job can be after a long stop (`OPERATIONS.md`). Django re-queues an expired job only on a staff
request, as a new attempt with a new `expires_at`.

## 9. Durable enforcement as built (Wave 2)

Added 2026-11-17 (LAI-LAMBDA-004, integrated). Everything below is code in `lai/apps/jobs`
(`models.py`, `processing.py`, `processing_transport.py`, `admin.py`, the three `jobs_*`
commands) and migration `jobs.0002_processing_contract_kinds`. It applies to contract kinds only
(`models.CONTRACT_KINDS`: `asset.validate_model`, `reference.checksum`); legacy ADR-055 kinds are
unchanged. Detail and settings: `DJANGO_JOBS.md`.

### 9.1 Records and constraints

| Mechanism | As built | Code |
|---|---|---|
| One job per logical work | Unique (`namespace`, `idempotency_key`) where the key is non-empty, constraint `jobs_idempotency_key_unique`. The key includes the expected processor version from `default_registry()`. A concurrent duplicate submit loses on the constraint (`IntegrityError`) and is handed the winning job | `models.ProcessingJob.Meta`, `processing.submit_processing_job` |
| Contract fields required | Check `jobs_contract_fields`: a contract kind has `state`, `namespace` and `idempotency_key`; a legacy kind has an empty `state` | `models.py` |
| Attempts | `JobAttempt`: `attempt_id` unique, (`job`, `number`) unique (`jobs_attempt_number_unique`), number 1 to 100, `outcome` in `pending`, `succeeded`, `failed`, `cancelled`, `abandoned` | `models.JobAttempt` |
| Applied-attempt ledger | `JobAttempt.applied_at`; `_snapshot` passes every applied `attempt_id` to `decide_completion` as `JobSnapshot.applied_attempt_ids`, so `DUPLICATE` survives restarts | `processing._snapshot` |
| Event ledger | `CompletionReceipt` per completion received, `event_id` unique, with `action` and `reason`. The same event seen again is `DUPLICATE event_seen`; a reused `event_id` for another job or attempt is `REJECT event_id_reused` | `models.CompletionReceipt`, `processing._apply_locked` |
| Transactional outbox | `JobOutbox`: one row per attempt (`attempt` one-to-one), canonical request `body`, `available_at`, `sent_at`, `cancelled_at`, `send_attempts`, `last_error_code`; index (`sent_at`, `available_at`) | `models.JobOutbox` |
| Artifacts | `JobArtifact` rows for an applied success (including a by-reference `job-result`); (`attempt`, `logical_id`) unique | `models.JobArtifact`, `processing._record_artifacts` |
| Request template | `ProcessingJob.payload` holds attempt 1's `ProcessingJobRequest.to_dict()`; every later attempt is re-encoded from it with only `attempt_id` and `attempt_number` replaced (and, on a staff requeue, `submitted_at` and `expires_at`). A staff requeue writes the renewed `submitted_at` and `expires_at` into `payload` itself, so the automatic retries that follow keep the new expiry. The idempotency key never changes | `processing._new_attempt` |

### 9.2 Transactions and locks

| Operation | Transaction and lock |
|---|---|
| Submit | One `transaction.atomic()`: job row (`created`), `JobAttempt` 1, `created -> queued` through `check_transition`, `JobOutbox` row. With the `inline` backend, `run_inline` is scheduled with `transaction.on_commit` |
| Relay | One short transaction per row: `JobOutbox.objects.select_for_update(skip_locked=True)` on unsent, uncancelled, due rows, ordered by (`available_at`, `pk`); send; then `sent_at` and `JobAttempt.dispatched_at`. Concurrent relays never send the same row at the same time. A crash after the send and before the commit leaves the row unsent, so it is sent again (duplicate, never lost). A message the queue can never accept (`message_too_large`) is only noted on the row and committed; a second transaction then locks the job first, fails it and cancels the row, keeping the job-then-outbox lock order of cancel, requeue and expiry |
| Completion | `apply_completion` decodes outside the transaction, then `_apply_locked` runs inside one `transaction.atomic()` holding `select_for_update()` on the job row (`processing._locked`) for the decision, the persistence and the receipt. An `IntegrityError` (a race on a receipt inserted without the job row lock, for example two consumers handling the same unknown-job event) is retried once in-process, and the second run resolves to `duplicate` or `reject`; one that persists is deferred as `integrity_error` |
| Cancel, requeue, expire | Each in its own `transaction.atomic()` with the job row locked; every state change goes through `_set_state`, which calls `lifecycle.check_transition` and sets `status` from `STATE_STATUS` |

**Acknowledge after commit.** `apply_completion` returns only after its transaction has
committed; `jobs_consume_completions` calls `queue.ack(delivery)` only then. A failed ack is
logged and left: the redelivery is recognised as `DUPLICATE event_seen`.

### 9.3 Completion outcomes and reasons

`apply_completion(body, *, storage)` returns `CompletionOutcome(action, ack, reason, job_id)`.

| Action | `ack` | Reasons (as recorded on the receipt) | Effect |
|---|---|---|---|
| `invalid` | False | the contract error code (e.g. `invalid_input`, `unsupported_schema_version`, `message_too_large`) | Logged `processing.completion_invalid` (code and field only); no receipt; left for the DLQ |
| `apply` | True | `succeeded`, `cancelled`, `retries_exhausted`, `failed_<retry class>` (`failed_permanent`, `failed_manual`, `failed_cancelled`), `retry_class_unknown` (from `decide_completion`) | Succeeded: job `validated`, attempt `succeeded` and applied, `job.result`, `JobArtifact` rows. Otherwise `failed` or `cancelled` with the primary error code on the job |
| `retry` | True | `retryable_failure` | Attempt `failed` and applied; job stays `queued`; new attempt and outbox row with `RetryPolicy.delay_seconds` in the same transaction |
| `duplicate` | True | `already_applied`, `event_seen` | Receipt only |
| `stale` | True | `job_finished` (job `validated`, `failed`, `cancelled` or `ready_for_review`), `superseded_attempt`, `not_running` | Receipt only |
| `reject` | True | From `decide_completion`: `identity_mismatch`, `result_mismatch`, `input_mismatch`. From Django: `unknown_job`, `namespace_mismatch`, `event_id_reused`, `unknown_attempt`, `attempt_mismatch`, `processor_mismatch`, `profile_mismatch`, `input_unverified`, `artifact_foreign`, `artifact_duplicate` (a by-reference result lists an artifact with the same logical id as its `job-result`), `result_too_large` | Receipt plus `logger.warning("processing.completion_rejected job=... attempt=... reason=...")`; nothing applied |

Order of checks: decode; namespace (an event for another namespace is rejected without touching
any job); a by-reference result is read (at most 4 MiB) only for a job Django knows, then
`verify_result`; under the lock, `event_seen`, then `kind` equals `job_type`, then
`decide_completion`, then (for `apply` and `retry` only) `_check_against_job`.

Transient failures raise `CompletionDeferred` (`database_error`, `integrity_error`,
`result_unavailable`): nothing was committed and the consumer releases the message with
`release_delay(receive_count) = min(300, 5 x 2^(receive_count - 1))` seconds. An unexpected
exception is released the same way (`apply_error`). A database error (never an `IntegrityError`,
`processing.is_database_outage`) also makes the consumer hand the rest of the batch back with
delay 0 and back off; before every receive it runs `SELECT 1` and receives nothing while
PostgreSQL is down (`OPERATIONS.md` section 7).

### 9.4 Status mapping

`models.STATE_STATUS` keeps the coarse `status` used by the existing admin, filters and sweep in
step with `state` on every transition:

| `state` | `status` |
|---|---|
| `created`, `uploading`, `queued` | `pending` |
| `processing` | `running` |
| `validated`, `ready_for_review` | `completed` |
| `failed`, `cancelled` | `failed` |

Nothing sets `uploading` or `processing`: a submission goes `created -> queued` directly and the
worker cannot report a start. Since Wave 3, `validated -> ready_for_review` is set in the
completion transaction when a registered completion hook returns `review_ready` (section 10); a
kind without a hook, or a hook that is not review-ready, leaves the job `validated`.

### 9.5 Reconciliation, expiry and the legacy sweep

- `expires_at` is set at submission to `submitted_at + LAI_PROCESSING_JOB_TTL_HOURS` (default 72)
  and carried in the request; a worker refuses an expired request with `job_expired`.
- `processing.reconcile(dry_run=False, stuck_minutes=15)` (command `jobs_reconcile`): every open
  contract job (`created`, `uploading`, `queued`, `processing`) past `expires_at` is re-checked
  under its row lock and moved to `failed` with `error_code = job_expired`; its unsent outbox
  rows are cancelled and pending attempts `abandoned`. Outbox rows unsent for more than
  `stuck_minutes` are counted and logged as `processing.outbox_stuck`. It never retries.
- `services.sweep` (`jobs_sweep`) excludes contract kinds from both the 60-minute timeout and
  completed-job pruning, and `services.fail_job` (the admin "Mark failed" action) refuses them,
  so an overnight backlog of queued contract jobs is never timed out by the legacy rule.

### 9.6 Cancel and requeue (staff)

| Action | Allowed from | Effect | Permission (admin) |
|---|---|---|---|
| `processing.cancel_job(job, user=)` | `created`, `uploading`, `queued`, `processing` | `cancelled`, `cancel_requested_at`, `cancelled_by`, `error_code = cancelled`; unsent outbox rows cancelled; pending attempts `abandoned`. A later completion is `STALE job_finished` | `jobs.cancel_processingjob` |
| `processing.requeue_job(job, user=)` | `failed` only (checked explicitly, because `queued -> queued` is the automatic retry) | Manual `failed -> queued` (`check_transition(..., manual=True)`): pending attempts `abandoned`, a new attempt (new uuid, next number, same key) with a new expiry window and an outbox row; `error_code`, `result` and `finished_at` cleared | `jobs.requeue_processingjob` |

`processing.retry_eligible(job)` is true only when a requeue is allowed. A relay send that the
queue can never accept (`ValueError`, message too large) cancels the row and fails the job with
`message_too_large` (section 9.2); transient send failures only delay the row.

**Open decision: resubmitting cancelled work.** A `cancelled` job is terminal: it cannot be
requeued (no transition leaves `cancelled`), and submitting the same work again (same namespace
and idempotency key, so the same asset version, processor version and profile) returns the
cancelled job instead of creating a new one. Workaround until the owner decides: delete the draft
version and upload it again, which gives a new key.

### 9.7 Tests

`lai/apps/jobs/tests/test_processing_{models,submit,relay,completions,commands,admin,transport}.py`
and the Wave 2 end-to-end file `test_processing_wave2_end_to_end.py` (local transport, real GLB
validator: valid model, invalid model, redelivered work and duplicate completions applied once,
resubmission returns the same job, paused dispatch).

## 10. Asset version lifecycle with asynchronous validation (Wave 3)

Added 2026-11-17 (LAI-LAMBDA-006 and 007, `WAVE3_INTERFACES.md`). Applies only when
`LAI_ASSET_ASYNC_VALIDATION=on` (default `off` in every environment) and the upload is a GLB
model (`apps.assets.processing.async_validation_applies`). With the flag off, or for images and
audio, the upload is synchronous and the version is created `VALIDATED`, exactly as before.

### 10.1 Two machines, one transaction each

| Step | `AssetVersion` | `ProcessingJob` | Where |
|---|---|---|---|
| Staff upload passes the synchronous checks | created `DRAFT` (`validated_at` empty) | `asset.validate_model` submitted in the same transaction: `created -> queued`, attempt 1, outbox row | `services.upload_version`, `_create_draft_and_submit` |
| Completion `APPLY`, result `succeeded`, verdict `pass` | `DRAFT -> VALIDATED`, `validated_at` set | `queued -> validated -> ready_for_review` | `apply_completion`, then the asset hook `apps/assets/completion.py` |
| Completion `APPLY`, result `succeeded`, any other verdict (`fail`, also `not_applicable`) | `DRAFT -> REJECTED` | `validated -> ready_for_review` | the asset hook |
| Completion `APPLY` of a failed or cancelled result | stays `DRAFT` | `failed` or `cancelled` | the hook returns `processing_failed` |
| `RETRY`, `DUPLICATE`, `STALE`, `REJECT` | unchanged (the hook does not run) | as section 9.3 | `_apply_locked` |
| Staff Publish | `VALIDATED -> PUBLISHED` only with a passing background result (the gate, 10.3) | unchanged (read, never locked) | `services.publish_version` |

The job result is applied first; the hook then runs in a savepoint of the same transaction,
under the job row lock. Both commit together, so a version is changed at most once per job,
however often the completion is delivered.

### 10.2 Hook outcomes (`ProcessingJob.subject_outcome`)

| Outcome code | Situation | Version | Job moves to `ready_for_review` |
|---|---|---|---|
| `version_validated` | `DRAFT`, verdict `pass` | `VALIDATED`; report = upload findings plus processing findings (`source: "processing"`); summary in `metadata["model_validation"]` | Yes |
| `version_rejected` | `DRAFT`, any verdict other than `pass` | `REJECTED`; same report and summary | Yes |
| `result_recorded` | The version is no longer `DRAFT` (validated before the flag, published, retired, rejected): a revalidation through "Validate in background" | Unchanged; published versions are never rewritten | Yes |
| `processing_failed` | The result is not `succeeded` | Unchanged (stays `DRAFT`) | No (the job is `failed` or `cancelled`) |
| `version_missing` | The version row no longer exists | None | No |
| `kind_mismatch`, `subject_mismatch`, `namespace_mismatch`, `asset_mismatch`, `storage_mismatch`, `checksum_mismatch`, `size_mismatch`, `profile_mismatch` | `identity_mismatch(job, version)`: the job did not validate exactly this version's stored bytes. Logged `processing.subject_mismatch job=.. reason=..` | Unchanged | No |
| `hook_error` | The hook raised something other than a `DatabaseError` (a bug). Its savepoint is rolled back; the applied job result is kept; logged `processing.hook_error` | Unchanged | No (the job stays `validated`) |

A `DatabaseError` (an `IntegrityError` included) raised inside the hook is not an outcome: it
rolls back the whole completion, which is deferred and redelivered (and reaches the completion
DLQ if it keeps failing). `clips` and `dimensions` keep their synchronous upload values; exact
clip names and durations are in the summary.

### 10.3 Publication gate

With the flag on, `publish_version` of a GLB version first requires `VALIDATED` (otherwise
`not_validated`), then a job in `validation_jobs(version)` with state `validated` or
`ready_for_review`, verdict `pass`, and `identity_mismatch(job, version,
require_current_processor=True) is None` (exactly this file, by the processor version this build
runs). Otherwise it refuses with `processing_required` and changes nothing. The existing re-read
and synchronous re-validation of the stored bytes still run afterwards. Rollback, set default
and republishing a retired version are not gated. No job state publishes anything.

### 10.4 Lock order

| Path | Locks, in order |
|---|---|
| Completion and asset hook | job row -> `ContentAsset` row -> `AssetVersion` row |
| Upload | `ContentAsset` row; inserts the version, job, attempt and outbox rows |
| Publish, set default, retire, rollback | `ContentAsset` row -> `AssetVersion` row; the gate reads jobs without locking |
| Cancel, requeue, reconcile | job row, then its own outbox and attempt rows |

No path locks a job after an asset or version row, so these paths cannot deadlock each other.

### 10.5 Recovery cases

- **Processing failed or expired.** The version stays `DRAFT`. A staff member with
  `jobs.requeue_processingjob` requeues the failed job; the next applied pass or fail moves the
  draft.
- **Cancelled job.** A cancelled job cannot be requeued, and "Validate in background" returns the
  same cancelled job (same idempotency key). Workaround until the owner decides (9.6): delete the
  draft and upload the file again.
- **Hook error or identity mismatch.** The version stays `DRAFT` and the job keeps its result.
  For the same file and validator, "Validate in background" returns the same finished job and does
  not run the hook again; delete the draft and upload again once the cause is fixed.
- Tests: `lai/apps/assets/tests/test_async_upload.py`, `test_completion_hook.py`,
  `test_publication_gate.py`, `lai/apps/jobs/tests/test_completion_hooks.py` and
  `test_processing_wave3_end_to_end.py`.
