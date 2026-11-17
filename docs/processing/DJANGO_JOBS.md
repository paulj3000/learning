# Django processing jobs (LAI-LAMBDA-004)

Owner: Wave 2 workstream C. Trello: https://trello.com/c/tMJsWpFd. Binding interfaces:
`WAVE2_INTERFACES.md` sections 0, 4, 5 and 6. Lifecycle rules: `LIFECYCLE.md`. Decision:
ADR-062 (one job backbone), on ADR-033, ADR-055 and ADR-061.

Wave 3 (LAI-LAMBDA-006 and 007, `WAVE3_INTERFACES.md`) adds the completion hook registry and
`subject_outcome` (section 3.1, migration `jobs.0003`) and the reconcile advisory lock (section 5).

## 1. One backbone, two families of kinds

`apps.jobs.ProcessingJob` stays the only job table, admin and sweep. No new Django app and no
second job model exist.

| Family | Kinds | Messages | Code | Consumer |
|---|---|---|---|---|
| Legacy | `studio.generate_chunk`, `speech.synthesize`, `asset.inspect` | schema-1 envelope (`core/envelope.py`) | `services.py` | `jobs_consume_results` |
| Contract | `asset.validate_model`, `reference.checksum` | `lai_processing` contracts (`ProcessingJobRequest`, `CompletionEvent`) | `processing.py`, `processing_transport.py` | `jobs_consume_completions` |

How they stay apart:

- `models.CONTRACT_KINDS` names the contract kinds. `envelope.KINDS` and `envelope.KIND_QUEUE`
  do **not** contain them, so `services.submit` refuses them (`unknown_kind`) and a legacy
  result envelope naming one is `invalid`.
- A database check (`jobs_contract_fields`) requires a contract kind to have a `state`,
  `namespace` and `idempotency_key`, and a legacy kind to have an empty `state`.
- `services.sweep` (`jobs_sweep`) excludes contract kinds from both the 60-minute timeout and
  the completed-job pruning; `services.fail_job` (and the admin "Mark failed" action) refuses
  them. Contract kinds expire through `jobs_reconcile` instead, so an overnight backlog of
  queued contract jobs is never timed out by the legacy rule.
- Legacy behaviour, envelopes, queues, worker zip, consumer and tests are unchanged.

## 2. Models (migration `jobs.0002_processing_contract_kinds`)

`ProcessingJob` gains fields used only by contract kinds (blank or null for legacy rows, so the
migration keeps every existing row as it is):

| Field | Meaning |
|---|---|
| `state` | `JobState` (`created`, `uploading`, `queued`, `processing`, `validated`, `ready_for_review`, `failed`, `cancelled`); blank for legacy |
| `namespace`, `idempotency_key` | The contract namespace and `ik1:` key; unique together where the key is non-empty (`jobs_idempotency_key_unique`) |
| `profile_id`, `profile_version` | The profile the job runs |
| `processor_id`, `processor_version` | The processor Django expects (`default_registry()` at submission) |
| `input_ref`, `input_sha256`, `input_size`, `input_content_type` | Input identity: `{"store","key","version_id"}` and what the bytes must be |
| `correlation_id` | The request id at submission (log tracing only) |
| `current_attempt` | The attempt most recently created (FK to `JobAttempt`) |
| `expires_at` | Submission + `LAI_PROCESSING_JOB_TTL_HOURS` |
| `cancel_requested_at`, `cancelled_by` | Staff cancellation |
| `subject_outcome` | Wave 3, migration `jobs.0003_processing_subject_outcome` (`CharField`, 64, blank): the safe code the subject's completion hook returned (section 3.1), or `hook_error`; blank when no hook ran |

For contract kinds `payload` holds the attempt-1 `ProcessingJobRequest.to_dict()` (ids, keys,
checksums and resolved options; no content), the template from which every later attempt is
re-encoded, and `result` holds the applied `ProcessingJobResult.to_dict()`. `queue` is
`processing`, `subject_type`/`subject_id` hold the contract subject (`subject_id` widened to 128
characters, the contract maximum).

New models:

| Model | Purpose | Key constraints |
|---|---|---|
| `JobAttempt` | One execution attempt: `attempt_id` (UUID), `number`, `outcome` (`pending`, `succeeded`, `failed`, `cancelled`, `abandoned`), dispatched/completed/applied times, result, verdict, retry class, error code, processor, duration | `attempt_id` unique; (`job`, `number`) unique; number 1 to 100 |
| `JobOutbox` | The transactional outbox: the canonical request body per attempt, `available_at`, `sent_at`, `cancelled_at`, `send_attempts`, `last_error_code` | one row per attempt; index (`sent_at`, `available_at`) |
| `CompletionReceipt` | Every completion event received and the decision taken (`action`, `reason`) | `event_id` unique (the same event seen twice is recognised) |
| `JobArtifact` | Artifact references of an applied success, including a by-reference `job-result` | (`attempt`, `logical_id`) unique |

`JobAttempt.applied_at` is the applied-attempt ledger that `decide_completion` reads
(`JobSnapshot.applied_attempt_ids`), so a DUPLICATE is detected across restarts. New indexes:
(`state`, `created_at`), (`namespace`, `state`), `expires_at`. Check constraints cover the state
values, the contract-field rule above, attempt numbers and outcomes.

The migration is reversible. Backwards it drops the new tables and columns and restores the
legacy kind constraint; that only succeeds when no contract-kind rows exist (they would violate
the old constraint), which is the case for any environment that has not yet used them.

`JobState` is declared in `models.py` (a test keeps it equal to
`lai_processing.core.lifecycle.JobState`) so the models, admin and `manage.py check` load
without the processing package on the path; `processing.py` and the commands import it.

### Status mapping

The coarse `status` the existing admin, filters and sweep use is kept in step with `state`
(`models.STATE_STATUS`) on every transition:

| `state` | `status` |
|---|---|
| `created`, `uploading`, `queued` | `pending` |
| `processing` | `running` |
| `validated`, `ready_for_review` | `completed` |
| `failed`, `cancelled` | `failed` |

## 3. Services (`apps.jobs.processing`)

| Symbol | Behaviour |
|---|---|
| `submit_processing_job(*, job_type, subject, input, profile, options=None, asset=None, user=None)` | Resolves the profile and options with `default_registry()` (`resolve_options` fills defaults), computes the idempotency key **including the expected processor version**, and returns the existing job for that key, or creates job + attempt 1 + outbox row in one `transaction.atomic()` (`created -> queued` through `check_transition`). A concurrent duplicate loses on the unique constraint and gets the winner. `disabled` raises `ProcessingDisabled`; invalid requests raise `ProcessingJobsError` with the contract's error code. `subject` may be a `SubjectRef` or a (type, id) pair, `profile` a `ProfileRef` or (id, version), `input` an `InputObject` or a mapping (store, key, version_id, sha256, size_bytes, content_type). |
| `relay_outbox(queue, *, limit=50, ignore_delay=False) -> int` | Sends due rows, one per short transaction, claimed with `select_for_update(skip_locked=True)`; marks `sent_at` after the send. `LAI_PROCESSING_DISPATCH=paused` sends nothing. `QueueFull` or any transport error increments `send_attempts`, sets `available_at` with full-jitter backoff (`RetryPolicy`, at most 900 s) and ends the pass; the job is never failed for a transient send. A message the queue can never accept (`ValueError`, too large) is noted on the row and committed; a second transaction then locks the job first, fails it (`message_too_large`) and cancels the row, so the job-then-outbox lock order of cancel, requeue and expiry is kept. |
| `apply_completion(body, *, storage) -> CompletionOutcome(action, ack, reason, job_id)` | See section 4. |
| `cancel_job(job, *, user) -> bool` | `created/uploading/queued/processing -> cancelled`; unsent outbox rows are cancelled and pending attempts abandoned. A later completion is STALE. |
| `requeue_job(job, *, user) -> bool` | Only from `failed`: the manual `failed -> queued` (`check_transition(..., manual=True)`), a new attempt (new uuid, next number, same key) with a new expiry window and an outbox row. The renewed `submitted_at` and `expires_at` are written into `job.payload`, so later automatic retries keep the new expiry. A `cancelled` job cannot be requeued (see "Open decision" below). |
| `reconcile(*, dry_run=False, stuck_minutes=15)` | Open jobs past `expires_at` become `failed` / `job_expired` (rows cancelled, attempts abandoned); counts outbox rows unsent for longer than `stuck_minutes`. |
| `retry_eligible(job)` | True when a staff requeue is allowed. |
| `run_inline()` | The `inline` backend's in-process loop (section 6). |

Every state change happens on a row held by `select_for_update()` and goes through
`lifecycle.check_transition`. `requeue_job` checks for `failed` explicitly because
`queued -> queued` is also a legal transition (the automatic retry) and must never be a staff
action. Nothing in these services changes an `AssetVersion` or publishes anything; since Wave 3
the only path from a completion to a subject row is a registered completion hook (section 3.1).

**Open decision: resubmitting cancelled work.** `cancelled` is terminal in the lifecycle, so
`requeue_job` refuses it, and `submit_processing_job` for the same work (same idempotency key)
returns the cancelled job. Workaround: delete the draft version and upload it again (a new
version is a new subject, so a new key). Recorded for the owner (`IMPLEMENTATION_STATUS.md`).

`apps.assets.processing.submit_model_validation(version, *, user)` builds an
`asset.validate_model` request for an `AssetVersion` (input store `assets`, its storage key,
SHA-256, size and content type; subject `asset_version`/version uuid; the asset context; profile
`glb-default` v1) and submits it. It changes neither the version's status nor its metadata or
validation report, and never publishes. `default_registry()` registers `asset.glb_validator`
(LAI-LAMBDA-002), so the job runs the real validator.

### 3.1 Completion hooks (Wave 3, `WAVE3_INTERFACES.md` section 3)

The registry lives in `apps.jobs.hooks` (no `lai_processing` imports, so an app can register from
`AppConfig.ready()` while `manage.py check` runs without `processing/` on the path) and is
re-exported by `apps.jobs.processing`.

| Symbol | Behaviour |
|---|---|
| `HookResult(code: str, review_ready: bool = False)` | What a hook did. `code` is stored in `subject_outcome` (cut to 64 characters); `review_ready` moves a `validated` job to `ready_for_review` |
| `register_completion_hook(job_type, subject_type, hook)` | Explicit, no discovery. `job_type` must be a contract kind and `subject_type` 1 to 64 characters, else `ImproperlyConfigured`. The same callable again is a no-op (a second `ready()`); another callable for a registered pair raises `ImproperlyConfigured` |
| `completion_hook(job_type, subject_type)` | The registered hook or `None` |
| `set_completion_hooks_for_tests(mapping or None)` | Replaces the registry and returns the previous one, for restoring |

`_run_completion_hook` is called by `_apply_locked` after every **APPLY** (a succeeded, failed or
cancelled result), inside the completion transaction, under the job row lock and in a savepoint.
It never runs for DUPLICATE, STALE, RETRY or REJECT, so a subject is changed at most once per
job. A `DatabaseError` (an `IntegrityError` included) propagates: the whole completion rolls back
and is deferred. Any other exception rolls back the hook's savepoint only; the job keeps its
applied result with `subject_outcome = "hook_error"` and `processing.hook_error job=.. kind=..
type=<class>` is logged at ERROR. A hook must not change the job object: `apps.jobs.processing`
owns it and saves it after the hook, so an in-memory change would be saved even when the hook
then failed. Lock order: job row, then the hook's own rows.

Registered hooks: `("asset.validate_model", "asset_version")` ->
`apps.assets.completion.apply_model_validation`, from `AssetsConfig.ready()`. Its outcome codes
are in `LIFECYCLE.md` section 10.2. `reference.checksum` has no hook and is applied as before.

## 4. Applying a completion (WAVE2_INTERFACES section 5)

1. `decode_event` with the message size limit. Undecodable or contract-invalid:
   `processing.completion_invalid` is logged (code and field only) and the outcome is
   `invalid` with `ack=False`: the consumer neither acknowledges nor releases it, so it reaches
   the completion DLQ after 5 receives. Nothing is recorded.
2. An event for another namespace is rejected without touching any job.
3. A by-reference result is read with `ObjectStorage.read` (at most 4 MiB) only for a job that
   exists, then decoded and checked with `event.verify_result`. A storage failure raises
   `CompletionDeferred` (transient); a result that does not match is REJECT `result_mismatch`.
4. In one transaction under the job row lock: an `event_id` already received is DUPLICATE
   `event_seen`; otherwise `decide_completion(JobSnapshot, event, result)` decides, followed by
   Django's own checks for APPLY and RETRY: the attempt must be one of the job's attempts
   (`unknown_attempt`) with the same number, the processor id **and version** must equal the
   expected ones (`processor_mismatch`), the profile must match (`profile_mismatch`), the
   observed input store, key, pinned version and size must match (`input_mismatch`), a success
   must have read and verified its input (`input_unverified`), and every artifact must belong to
   the job, the attempt and the namespace (`artifact_foreign`). A by-reference result whose
   artifacts include one with the `job-result` logical id would break the artifact uniqueness
   constraint on every delivery, so it is rejected (`artifact_duplicate`).
5. Persist and record a `CompletionReceipt`:

| Action | Effect |
|---|---|
| APPLY (succeeded) | `validated`; attempt `succeeded` and applied; result, verdict, metadata and findings stored; `JobArtifact` rows |
| APPLY (failed or cancelled) | `failed` (permanent, manual, retries exhausted) or `cancelled`; the primary error code is the job's `error_code` |
| RETRY | Attempt `failed` and applied; job stays `queued`; a new attempt (new uuid, number + 1) and its outbox row with the policy delay, re-encoded from the template with only `attempt_id` and `attempt_number` replaced |
| DUPLICATE, STALE | Receipt only (info log) |
| REJECT | Receipt and `logger.warning("processing.completion_rejected job=%s attempt=%s reason=%s")` (ids and reason only) |

Every action except `invalid` returns `ack=True`, after the transaction has committed. A
`DatabaseError` anywhere raises `CompletionDeferred("database_error")` (its `__cause__` is the
database error). An `IntegrityError` is retried once in-process: it is a race on a receipt
inserted without the job row lock (two consumers, the same unknown-job or other-namespace event,
or an `event_id` reused across jobs), and the second run resolves to DUPLICATE or REJECT. One
that persists raises `CompletionDeferred("integrity_error")`, which
`processing.is_database_outage` does not count as an outage.

**Decision: processor or profile mismatch is a REJECT, not a warning.** The idempotency key
includes the expected processor version, so a result from another processor id, version or
profile is not this job's logical work. The job stays `queued` on its current attempt; it is
retried by a correct redelivery or expires through `jobs_reconcile` and can be requeued. Django
and the worker ship the same `lai_processing` release, so a mismatch is version skew during a
rollout or a forged message; drain in-flight jobs before changing a processor version.

A delayed completion never replaces a newer result: once a job is `validated` (or terminal)
every later event is STALE `job_finished`, an older attempt is STALE `superseded_attempt`, and
results and artifacts are keyed by attempt.

## 5. Management commands

| Command | Behaviour |
|---|---|
| `jobs_dispatch [--once] [--interval S] [--limit N]` | Outbox relay loop. SIGTERM finishes the current pass and exits. A `DatabaseError` closes the connection and backs off (2^n s, at most 60). `disabled`: exits 0. `inline`: a pass runs the jobs in-process. Prints `{"sent": n}` with `--once`. |
| `jobs_consume_completions [--once] [--max-messages N] [--wait-seconds S] [--visibility S]` | Completion consumer. Runs `SELECT 1` before every receive and receives nothing while PostgreSQL is down (backing off 2, 4, 8 s up to 60 s; with `--once` it prints `{"database": "unavailable", ...}` and exits 2). Acknowledges only after `apply_completion` returned (committed). `invalid`: left for the DLQ. `CompletionDeferred` or an unexpected error: `release` with `min(300, 5 * 2^(receive_count-1))` seconds; a database outage (not an `IntegrityError`) also closes the connection, hands the rest of the batch back with delay 0 and backs off before the next receive. A failure after a receive still counts as a receive for that batch (`OPERATIONS.md` section 7). `--wait-seconds` is passed to adapters whose `receive` accepts `wait_seconds`; otherwise an empty receive sleeps briefly. `disabled` and `inline`: exits 0. |
| `jobs_reconcile [--dry-run] [--stuck-minutes M]` | Expires overdue open jobs (`job_expired`) and reports stuck outbox rows (logged as `processing.outbox_stuck`). Prints counts. On PostgreSQL a run that changes rows holds the session advisory lock `RECONCILE_LOCK_KEY`, so two runs never overlap: the second prints `{"dryRun": false, "skipped": "already_running"}` and exits 0. `--dry-run` takes no lock. An unexpected error logs `processing.reconcile_failed type=<class>` and exits 1. Scheduled on native dev by `lai-jobs-reconcile.timer` (`OPERATIONS.md` section 6.1). |

## 6. Transport and settings

`apps.jobs.processing_transport` is the only factory: `work_queue()`, `completion_queue()`,
`object_storage()`, plus `set_transport_for_tests()` and `reset_transport()`.

| Backend | Queues | Storage |
|---|---|---|
| `sqs` | `lai_processing_runtime.SqsMessageQueue(client, url, max_message_bytes=240 KiB)` | `S3ObjectStorage(client, {assets: LAI_ASSET_BUCKET, quarantine: LAI_PROCESSING_BUCKET, artifacts: LAI_PROCESSING_BUCKET}, writable=frozenset())` |
| `local` | `LocalDirectoryQueue(<root>/queues/work)` and `.../completions` | `FilesystemObjectStorage({assets: LAI_ASSET_LOCAL_ROOT, quarantine: <root>, artifacts: <root>}, writable=frozenset())` |
| `inline` | `lai_processing.testing.MemoryQueue`, one pair per process | `assets` read through Django's asset storage (read-only); `quarantine` and `artifacts` in memory |
| `disabled` | `ProcessingTransportDisabled` | same |

The runtime adapters and boto3 are imported lazily inside the factory. Django never writes to
processing storage (it only reads by-reference results).

Settings (`config/settings/base.py`, exactly WAVE2_INTERFACES section 4):

| Name | Default | Validation |
|---|---|---|
| `LAI_PROCESSING_BACKEND` | `inline` (production: `disabled`) | `disabled`, `inline`, `local`, `sqs`; production allows `disabled` or `sqs` only |
| `LAI_PROCESSING_NAMESPACE` | `local` (tests: `test`) | `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, at most 32; production requires it set explicitly with `sqs` |
| `LAI_PROCESSING_WORK_QUEUE_URL`, `LAI_PROCESSING_COMPLETION_QUEUE_URL` | empty | required for `sqs`; https SQS queue URLs (same pattern as `LAI_JOBS_*`) |
| `LAI_PROCESSING_BUCKET` | empty | required for `sqs`; an S3 bucket name |
| `LAI_PROCESSING_LOCAL_ROOT` | `lai/.processing-local` | the `local` backend's stores and queues (must be gitignored) |
| `LAI_PROCESSING_DISPATCH` | `enabled` | `enabled` or `paused` |
| `LAI_PROCESSING_MAX_ATTEMPTS` | 3 | 1 to 10 (`RetryPolicy.max_attempts`) |
| `LAI_PROCESSING_JOB_TTL_HOURS` | 72 | 1 to 336 |

`config/settings/test.py` uses `inline` and namespace `test`.

## 7. Admin and permissions

The existing "background job" admin (staff with `jobs.view_processingjob`, everything read-only)
also serves contract kinds:

- search by id, subject id, idempotency key and correlation id; filters for status, kind, state,
  namespace, queue and backend;
- for contract jobs: state, namespace, key, correlation id, profile, expected processor,
  formatted input identity, expiry, cancellation, requeue eligibility, verdict, findings table,
  safe error details (codes, retry classes, fixed messages, scalar details) and pretty, escaped
  metadata; read-only inlines for attempts, artifacts and completion receipts;
- the request template (`payload`) is shown to superusers only, as for legacy jobs;
- actions: **Cancel** needs `jobs.cancel_processingjob`, **Requeue** needs
  `jobs.requeue_processingjob` (both also need view); "Mark failed" (`jobs.fail_processingjob`)
  never touches contract kinds. There is no publish action, and no child data exists here.
- `subject_outcome` is not shown on the job page; for asset validation jobs it appears, with the
  result summary and findings, in the asset version's read-only "Background validation" section
  (`ASSET_LIBRARY.md` section 23).

Legacy jobs show exactly the fields and the action they did before.

## 8. Local usage

- Tests and the default development settings use `inline`: a submission runs after its
  transaction commits, in-process, through the same `ExecutionEngine` and `apply_completion`
  path a Lambda worker and the consumer use. Retries run straight away (`ignore_delay`).
  Never use `inline` for real traffic: it runs work in the committing process.
- `local`: run `manage.py jobs_dispatch` and `manage.py jobs_consume_completions` beside the
  local worker from `lai_processing_runtime` (Workstream B); queues and processing stores live
  under `LAI_PROCESSING_LOCAL_ROOT`.
- Django needs `processing/` on its import path for contract kinds (pytest sets
  `pythonpath = ["lai", "processing"]`; the release must ship the package, WAVE2_INTERFACES
  section 8). Legacy kinds, the admin and `manage.py check` work without it.

## 9. Logging

Logs carry job ids, attempt ids, kinds, actions, reasons and error codes only: never message
bodies, object keys, metadata, findings or anything a worker read (ADR-025, `apps.core.privacy`).
