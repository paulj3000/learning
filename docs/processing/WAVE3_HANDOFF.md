# Wave 3 handoff (LAI-LAMBDA-006 and 007)

> **Superseded in part by `WAVE3_INTERFACES.md` (2026-11-17)**, which is on the Wave 3 branch
> (`feature/serverless-processing-wave3`), not on this one. Where they differ, that page wins.
> Since this page was written: ADR-062 is accepted, the flag name `LAI_ASSET_ASYNC_VALIDATION` is
> approved (default off everywhere; implemented in Wave 3), Option A (section 3) is chosen, and
> the consumer database-outage fix is done in Wave 2 (section 7).

Written 2026-11-17 by the Wave 2 documentation agent, for the Wave 3 implementation agents, their
reviewer and the project owner. Cards:
[LAI-LAMBDA-006](https://trello.com/c/SYUqyvWM) (S3 upload, queue dispatch and completion
integration) and [LAI-LAMBDA-007](https://trello.com/c/WQAi4PAi) (Django Asset Library validation
results and release gates).

Read first: `ARCHITECTURE.md`, `WAVE2_INTERFACES.md` (still frozen), `LIFECYCLE.md` section 9,
`DJANGO_JOBS.md`, `GLB_VALIDATION.md`, `RUNTIME.md`,
`../infrastructure/processing-infrastructure.md`, `../ASSET_LIBRARY.md` sections 3, 21 and 23,
and ADR-045, ADR-061 and ADR-062 in `../DECISIONS.md`. The code wins over this page; correct the
page if they disagree.

**Nothing is deployed.** Every AWS step below needs explicit owner approval (A9, ADR-019 G7).
Never reintroduce a second job model or a `lai/apps/processing` app (ADR-033, ADR-062).

## 1. Starting point: what Wave 2 delivered

Card 006 already records a partial status for the legacy ADR-055 `asset.inspect` flow ("Inspect
in background" in the asset admin, `apps/assets/jobs.py`). That flow is legacy and stays as it
is. Wave 3 builds on the **contract kinds** below, which already cover most of card 006's
transport items.

| Card 006 / 007 item | Wave 2 state | Where |
|---|---|---|
| Durable enqueue, one authoritative dispatch path | **Built**: job + attempt + outbox row in one transaction, relay with `skip_locked` | `apps.jobs.processing.submit_processing_job`, `relay_outbox`, `manage.py jobs_dispatch` |
| Worker reads private original, verifies checksum, validates with the shared library, writes results to S3, sends a completion | **Built** (code; not deployed) | `lai_processing.core.execution.ExecutionEngine`, `lai_processing_runtime.worker.process_work_message`, `lambda_handler.handler`, `processors/gltf/` |
| Separate completion queue consumed by Django, transactional apply, ack after commit | **Built** | `apps.jobs.processing.apply_completion`, `manage.py jobs_consume_completions` |
| Verify job id, attempt, idempotency key, namespace, source checksum, size, key, processor and profile | **Built** (REJECT reasons in `LIFECYCLE.md` 9.3) | `decide_completion`, `processing._check_against_job` |
| Duplicates, out-of-order, stale attempts, cancellation | **Built and tested** | `CompletionReceipt`, `JobAttempt.applied_at`, `cancel_job` |
| Retries, timeouts, expiry, stopped-host backlog | **Built**: `RetryPolicy` retries as new attempts, deadline clamp, `expires_at`, `jobs_reconcile`, quiesce/verify order | `LIFECYCLE.md` 9.5, `OPERATIONS.md` 6 |
| DLQs | **Synthesized** (5 receives) | `infra/lib/processingStack.ts` |
| Expected **asset version** verified on completion | **Not built**: the job stores the subject and input identity, but nothing maps the result to an `AssetVersion` | Wave 3 (section 4) |
| Upload completion triggers processing | **Not built**: `apps.assets.processing.submit_model_validation` exists but nothing calls it | Wave 3 (sections 3 and 4) |
| Presigned uploads | **Not built**; no presigned PUT exists anywhere (only presigned GET delivery) | Wave 3 (section 3) |
| Replay tooling, poison-job runbook | **Not built** | 006 (section 7) |
| Results on the Asset Library version page; release gates | **Not built** | 007 (sections 5 and 6) |

## 2. Implemented interfaces (exact names)

### Django: `apps.jobs.processing`

| Symbol | Signature / behaviour |
|---|---|
| `submit_processing_job` | `(*, job_type, subject, input, profile, options=None, asset=None, user=None) -> ProcessingJob`. Same key returns the existing job. Raises `ProcessingDisabled` (backend `disabled`) or `ProcessingJobsError(code)` |
| `relay_outbox` | `(queue, *, limit=50, ignore_delay=False) -> int` |
| `apply_completion` | `(body, *, storage, max_bytes=DEFAULT_MAX_MESSAGE_BYTES) -> CompletionOutcome(action, ack, reason, job_id)`; raises `CompletionDeferred` |
| `cancel_job`, `requeue_job` | `(job, *, user) -> bool` |
| `retry_eligible` | `(job) -> bool` |
| `reconcile` | `(*, dry_run=False, stuck_minutes=15) -> dict` |
| `run_inline` | `(*, max_rounds=100) -> dict` (tests and default development only) |
| `get_registry`, `set_registry_for_tests`, `retry_policy` | registry and policy access |
| Errors | `ProcessingJobsError`, `ProcessingDisabled`, `CompletionDeferred` |

Transport factory `apps.jobs.processing_transport`: `work_queue()`, `completion_queue()`,
`object_storage()`, `set_transport_for_tests(...)`, `reset_transport()`.

Models (`apps.jobs.models`): `ProcessingJob` (contract fields `state`, `namespace`,
`idempotency_key`, `profile_id`, `profile_version`, `processor_id`, `processor_version`,
`input_ref`, `input_sha256`, `input_size`, `input_content_type`, `correlation_id`,
`current_attempt`, `expires_at`, `cancel_requested_at`, `cancelled_by`; `subject_type`,
`subject_id`, `result`, `error_code`), `JobAttempt`, `JobOutbox`, `CompletionReceipt`,
`JobArtifact`, `JobState`, `STATE_STATUS`, `CONTRACT_KINDS`. Permissions
`jobs.cancel_processingjob`, `jobs.requeue_processingjob`.

Commands: `jobs_dispatch [--once] [--interval S] [--limit N]`,
`jobs_consume_completions [--once] [--max-messages N] [--wait-seconds S] [--visibility S]`,
`jobs_reconcile [--dry-run] [--stuck-minutes M]`.

### Django: `apps.assets.processing`

| Symbol | Behaviour |
|---|---|
| `MODEL_VALIDATION_JOB_TYPE` | `"asset.validate_model"` |
| `MODEL_VALIDATION_PROFILE` | `("glb-default", 1)` |
| `SUBJECT_TYPE` | `"asset_version"` |
| `model_validation_request(version) -> dict` | The `submit_processing_job` arguments (no writes): input store `assets`, `version.storage_key`, `version_id=None`, `sha256`, `size_bytes`, `content_type`; subject `asset_version`/version uuid; `AssetContext(asset_id, asset_version_id, asset_version_number)` |
| `submit_model_validation(version, *, user) -> ProcessingJob` | Submits; never changes the version |

### Worker and processor

`lai_processing_runtime`: `FilesystemObjectStorage`, `LocalDirectoryQueue`, `S3ObjectStorage`,
`SqsMessageQueue`, `QueueError`, `JsonLogTelemetry` (package exports); `worker.process_work_message`;
`local_worker.LocalWorker`; `lambda_handler.handler`; `config.RuntimeConfig.from_env`.
CLI: `python -m lai_processing_runtime {enqueue,worker,status}`.

`lai_processing.processors.gltf.processor.GlbValidatorProcessor`: processor `asset.glb_validator`
1.0.0, job type `asset.validate_model`, profile `glb-default` v1 (options
`max_texture_dimension`, `require_animations`, `write_report`). Result: `verdict` `pass` or
`fail`, findings in the Asset Library shape, metadata per `CONTRACTS.md` "GLB validation
metadata" (animations with exact clip names, `counts`, `material_names`, `triangle_count`,
`vertex_count`, `bounds`, `images`, `skins`, extensions). Optional artifact `glb-report`
(`report.glb_validation`).

## 3. Upload integration (006): two options

### Option A (chosen): existing synchronous upload, then submit

1. Staff upload in Django Admin exactly as today (`AssetVersionAdmin.upload_view` ->
   `services.upload_version`): server-made key, checksum, synchronous validation. A file that
   fails is never stored.
2. When the flag is on (section 4), the version is created `DRAFT` instead of `VALIDATED`, and
   `submit_model_validation(version, user=...)` is called **inside the same transaction** that
   creates the version, so the job, attempt and outbox row commit with it (or not at all).
3. The worker reads the original from the `assets` store (read-only).

No new upload surface, no CORS, no new IAM. It does not lift the 50 MB request-size ceiling.

### Option B (only if large uploads require it): Django-issued presigned PUT into quarantine

| Step | Design |
|---|---|
| 1. Start | Staff choose a file in Django Admin; the admin page computes SHA-256 and size in the browser and asks Django for an upload. Django checks `assets.add_assetversion`, the size limit and the declared type, and creates an upload record (or a `ProcessingJob` in `uploading` via a new `created -> uploading` path) |
| 2. Key | Django builds the key: `processing/quarantine/<namespace>/uploads/<upload uuid>/original` (validated by `check_object_key`; never from the file name) |
| 3. Presign | Django issues a short-lived presigned **PUT** that signs `x-amz-checksum-sha256` (the declared digest, base64), `Content-Length` and `Content-Type`, so S3 refuses any other bytes. Django's policy already allows `s3:PutObject` and `GetObject` on quarantine (`QuarantineObjects`); the URL is generated with the instance role |
| 4. Complete | Staff (or the page) call "complete"; Django `head_object`s the key with `ChecksumMode='ENABLED'` and requires `ChecksumSHA256` equal to the declared digest and the size to match (never the ETag). Missing objects return 403 to Django too (no `ListBucket`) |
| 5. Submit | `submit_processing_job` with input store `quarantine`, the key, the verified digest and size, subject `asset_version` |
| 6. Promote | Only after a passing result, Django copies the object into `assets/models/...` (its existing asset-storage permission) and records the version; quarantine objects expire after 30 days (bucket lifecycle) |

Option B prerequisites: a CORS rule on the processing bucket for the admin origin (none exists in
`processingStack.ts`), the admin Content Security Policy `connect-src` for the bucket, a design
review of the promotion copy (it doubles storage writes), and an owner decision. Do not start it
without that decision.

## 4. AssetVersion hook and feature flag (006)

**Flag.** One Django setting, `LAI_ASSET_ASYNC_VALIDATION` (name approved by the owner on
2026-11-17; `off` by default in every environment, `on`), read in `config/settings/base.py`,
validated like the other `LAI_PROCESSING_*` settings, and refused as `on` while
`LAI_PROCESSING_BACKEND` is `disabled`. It is implemented in Wave 3, not on the Wave 2 branch.
With the flag `off` nothing changes (today's behaviour and every existing test).

**DRAFT flow when `on`.**

| Event | Version | Job |
|---|---|---|
| Upload passes synchronous validation | `DRAFT` (allowed by `ALLOWED_TRANSITIONS`) | Submitted in the same transaction |
| Completion APPLY, verdict `pass` | `DRAFT -> VALIDATED`; job findings and warnings merged into `validation_report`, GLB metadata stored on the version (`metadata`, `clips`) | `validated -> ready_for_review` |
| Completion APPLY, verdict `fail` | `DRAFT -> REJECTED`, findings in `validation_report` | `validated -> ready_for_review` (the failing result is still reviewed) |
| Job `failed` / expired / cancelled | Stays `DRAFT`; staff may requeue the job or delete the draft | as is |
| Version no longer `DRAFT` when the result arrives (deleted, or already moved) | Unchanged; log and record, never overwrite | `ready_for_review` |

**Where the hook runs.** `apps.jobs` must not import `apps.assets`. Add a small, explicit hook
registry in `apps.jobs.processing` keyed by `(job_type, subject_type)`, called from
`_apply_locked` after an APPLY of a succeeded result, inside the same transaction and under the
job row lock; `apps.assets` registers `asset.validate_model`/`asset_version` in its
`AppConfig.ready`. The hook must re-check, under `select_for_update` on the asset then the
version (the same order `publish_version` uses), that the version's `sha256`, `size_bytes` and
`storage_key` equal the job's input identity, and that `AssetContext` names this version.
A `DatabaseError` propagates (the completion is deferred and redelivered); any other mismatch is
a logged no-op, never a REJECT of a valid completion. Published versions are immutable: the hook
never writes to a version that is not `DRAFT`.

## 5. Staff review in Django Admin (007)

- On the `AssetVersion` change page (read-only section): the latest `asset.validate_model` job
  for the version (by `subject_type="asset_version"`, `subject_id=<version uuid>`), its `state`,
  verdict, findings table (reuse the jobs admin's escaping and formatting), warnings, and the
  card's metadata: animation clip names (exact), material names, mesh and primitive counts,
  `triangle_count`, `vertex_count`, bounds, texture dimensions; a link to the job admin page.
- Empty, loading-equivalent (`queued`), failed and expired states each have explicit text; a
  missing job with the flag off shows nothing new.
- Actions: "Validate in background" (submit or return the existing job; needs
  `assets.add_assetversion` or a new permission) and the existing job admin's Cancel and Requeue.
- Job `ready_for_review` means "result available for review", nothing more. **The explicit staff
  Publish action (`assets.publish_assetversion` -> `services.publish_version`) remains the only
  path to `PUBLISHED`.** No action publishes automatically; no completion publishes.
- React stays child and parent only; nothing of this is exposed in an API.

## 6. Publication gates (007)

- `publish_version` keeps re-reading the stored bytes and re-validating synchronously. Do not
  remove it.
- When the flag is `on`, `publish_version` also requires a job with `kind = asset.validate_model`,
  `subject = (asset_version, version uuid)`, `state` in (`validated`, `ready_for_review`),
  verdict `pass`, `input_sha256 == version.sha256`, `input_size == version.size_bytes`, and
  `processor_version` equal to the current registry's `asset.glb_validator` version. Otherwise
  refuse with a new safe `AssetActionRefused` code (for example `processing_required`) and
  message. The gate reads the job without locking it.
- Rollback to an already published version and `set_default_version` are not gated (the
  version passed when it was published; card 007: do not reopen accepted QA).
- Verify Treasure Rush model replacement (section 19.2 of `ASSET_LIBRARY.md`) and AM-11/AM-16
  behaviour with the flag off (unchanged) and on (an extra wait for the job).

## 7. Retry, reconciliation and replay (006)

- Automatic retries, expiry, cancel and requeue are built (`LIFECYCLE.md` 9.5, 9.6). Wave 3 adds:
  a schedule for `jobs_reconcile` (for example a systemd timer installed with the other units,
  and a run after `power-native.sh verify`), and the DLQ runbook in `OPERATIONS.md` section 8.
- Replay (owner decision B7): only authorized operations administrators redrive, with their
  roles listed in the `LaiProcessing-<env>` props `workRedriveRoleArns` or
  `completionRedriveRoleArns` (separate lists); never the Django role, which the stack refuses.
  Prefer requeue from Django Admin for a job that needs a fresh attempt.
- Consumer database outage: done in Wave 2. The consumer runs `SELECT 1` before every receive
  and receives nothing while PostgreSQL is down, hands the rest of a batch back with delay 0
  after a database failure, and backs off up to 60 s (`OPERATIONS.md` section 7). Residual: a
  failure after a receive still spends that receive.
- Expected-version check: covered by the hook's re-check in section 4.

## 8. Operational monitoring

Alarms already synthesized in `LaiProcessing-<env>` (to `lai-django-alarms-<env>`):
`work-oldest-message`, `work-queue-depth`, `completion-backlog`, `work-dead-letters`,
`completion-dead-letters`, and in phase 2 `worker-errors`, `worker-throttles`,
`worker-duration-high`, `worker-concurrency-high` (`processing-infrastructure.md` section 5).
Wave 3 adds a log metric filter and alarm on `processing.completion_rejected` and on
`processing.outbox_stuck` (both logged by Django today, neither alarmed).

## 9. Local testing

| What | How |
|---|---|
| Whole flow, real components | `scripts/processing/local-demo.sh [--keep]` (compose PostgreSQL on 127.0.0.1:5442; own `lai_processing_demo` database; no AWS) |
| End-to-end tests | `lai/apps/jobs/tests/test_processing_wave2_end_to_end.py` (local transport, real GLB validator). Extend it with the flag-on DRAFT flow and the publication gate |
| Unit tests | `lai/apps/jobs/tests/test_processing_*.py`, `lai/apps/assets/tests/test_processing_submit.py`, `lai/apps/assets/tests/test_glb_processing_parity.py`, `tests/processing/` |
| Default dev | `LAI_PROCESSING_BACKEND=inline` runs submitted jobs after commit in-process |

## 10. Required deployment verification in dev (after owner approval only)

Order from `processing-infrastructure.md` sections 6 and 7; every step is an owner-approved
change set.

1. **Phase 1 stack.** Deploy `LaiProcessing-dev` without a digest (bucket, queues, roles, Django
   policy, SSM `LAI_PROCESSING_BACKEND=disabled`, queue alarms). It must exist before the next
   `LaiDevPlatform-dev` update, because that stack attaches `lai-django-processing-dev` by name.
2. **Platform.** Update `LaiDevPlatform-dev` (attaches the policy to `lai-django-ec2-dev`).
3. **Images stack.** Deploy `LaiProcessingImages-dev`; create GitHub environment
   `processing-dev` (approved by the owner under B5; reviewers, `main` only), set
   `LAI_PROCESSING_PUBLISHER_ROLE_ARN`; create the B4 OIDC deploy role (decided, not yet
   created; `processing-infrastructure.md` section 12) and set `LAI_PROCESSING_DEPLOY_ROLE_ARN`;
   set `LAI_PROCESSING_DEPLOY_ENABLED=true` only once the owner authorizes deployment.
4. **Image.** Run `deploy-processing.yml` `build-push` for dev; record the `sha256:...` digest.
5. **Phase 2.** Run `deploy-processing.yml` `deploy` with the digest (change set first, then
   `execute_change_set`): the function, event source mapping and worker alarms appear; SSM
   `LAI_PROCESSING_BACKEND` becomes `sqs`.
6. **Settings.** Confirm `/lai/dev/django/LAI_PROCESSING_{BACKEND,NAMESPACE,WORK_QUEUE_URL,COMPLETION_QUEUE_URL,BUCKET}`
   exist (values not printed); `NAMESPACE` is `dev`.
7. **Release Django** (`deploy-dev-native.yml` or `deploy-pending`) so `render-env-native.sh`
   renders them; the release must contain the `lai_processing` wheel.
8. **Units.** `systemctl status lai-jobs-dispatch lai-jobs-completions` both active (no longer
   skipped by `ExecCondition`); logs in `/var/log/lai/jobs-{dispatch,completions}.log`.
9. **Smoke.** In a Django shell on the instance, `submit_model_validation(<a VALIDATED dev
   version>, user=None)`; within minutes the job is `validated` with a verdict and the version is
   unchanged. Check: one `JobAttempt` applied, one `CompletionReceipt` `apply`, artifacts under
   `processing/artifacts/dev/<job>/<attempt>/` only, worker log lines contain only safe fields.
10. **Idempotency.** Submit the same version again (same job returned). Redrive or resend one
    work message (as an allowed sender) and confirm the second completion is `duplicate` and the
    artifact rewrite succeeded (this exercises `VerifyOwnArtifacts`).
11. **Overnight.** Submit a job just before the 00:00 stop; after 08:00 confirm the completion
    was drained by `verify` and no alarm other than the expected backlog fired.
12. **Negative.** A missing input key surfaces as `permission_denied` (403 without `ListBucket`),
    not as a retry loop.

## 11. Tasks

### LAI-LAMBDA-006: S3 upload, queue dispatch and completion integration

| Item | Content |
|---|---|
| Prerequisites | Wave 1 PR #40 merged (owner presses Merge); Wave 2 (PR #41) merged. Already settled: ADR-062 accepted, flag name `LAI_ASSET_ASYNC_VALIDATION` approved, Option A chosen. AWS verification (section 10) needs separate owner deploy authorization |
| Owns | `lai/apps/assets/services.py` (`upload_version` DRAFT branch, flag-gated), `lai/apps/assets/processing.py` (hook implementation), a hook registry in `lai/apps/jobs/processing.py`, `lai/config/settings/base.py` (the flag), `jobs_reconcile` scheduling (`deploy/native/systemd/`, `scripts/aws/native/` with 005's conventions), `docs/processing/OPERATIONS.md` runbooks, tests (the consumer back-off on database errors is already done in Wave 2) |
| Acceptance | Flag off: no behaviour change (existing suites pass untouched). Flag on: upload creates `DRAFT` and a job atomically; pass moves `DRAFT -> VALIDATED`, fail moves `DRAFT -> REJECTED`, findings and metadata on the version; job reaches `ready_for_review`; duplicates, stale and out-of-order completions change the version at most once; a version whose identity differs from the job's input is never touched; never publishes; reconcile scheduled; DLQ runbook written; dev verification (section 10) done or listed as blocked with reasons |
| Tests | Unit: hook transitions, identity mismatch, non-DRAFT no-op, rollback of the upload transaction leaves no job, duplicate and stale completions, flag validation. End-to-end: extend `test_processing_wave2_end_to_end.py` for flag on |
| Prohibited | A second job model or app; changes to frozen contracts, setting names, queue names or retry behaviour without the principal; any automatic publish; S3 event triggers; changes to legacy kinds or `apps/assets/jobs.py`; worker database access; deploying without approval |
| Status | **BLOCKED** on the Wave 1 merge and the Wave 2 review/merge. Code work is otherwise dependency-ready; option B additionally needs an owner decision |

### LAI-LAMBDA-007: Django Asset Library validation results and release gates

| Item | Content |
|---|---|
| Prerequisites | 006 merged (the hook and flag); Wave 1 and Wave 2 merged |
| Owns | `lai/apps/assets/admin.py` (version page results section, "Validate in background" action), admin templates, the publication gate in `services.publish_version`, `docs/ASSET_LIBRARY.md` sections 3, 21 and 23, tests |
| Acceptance | Staff see clip names, materials, mesh and triangle counts, warnings and errors on the version page, with explicit empty, queued, failed and expired states; publish refused with a safe message unless a passing job matches the version's checksum and current processor version (flag on); re-validation at publish unchanged; explicit staff publish is the only path; Treasure Rush and AM-11/AM-16 verified with the flag off and on; child delivery (signed URLs, CloudFront) unchanged |
| Tests | Admin rendering (escaping, permissions, each state), gate allowed and refused cases, rollback and default-version ungated, flag off unchanged |
| Prohibited | Publishing from a completion or a job state; rewriting published version metadata; exposing results through React or any API; reopening unrelated accepted QA |
| Status | **BLOCKED** on 006 (and therefore on the Wave 1 and Wave 2 merges) |
