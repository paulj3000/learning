# Processing operations

Updated for Wave 3 operations (LAI-LAMBDA-006, 2026-11-17). **Nothing on this page is deployed
or provisioned, and no step on it has been run against AWS.** The commands, systemd units, CDK
stacks, log metric filters and alarms below exist in the repository (built and tested locally,
synthesized by CDK), but no queue, DLQ, Lambda function, image, alarm, metric filter, timer or
SSM setting exists in AWS. Deploying them needs explicit owner approval (A9, ADR-019 G7). Items still only
planned are marked **Planned**.

Related: `DJANGO_JOBS.md` (Django commands and settings), `RUNTIME.md` (worker),
`../infrastructure/processing-infrastructure.md` (stacks, IAM, alarms, deployment order),
`WAVE3_HANDOFF.md` (dev deployment verification steps).

## 1. What runs where

| Piece | Runs on | Built as | Needs | Keeps working when EC2 and RDS are stopped |
|---|---|---|---|---|
| Outbox relay | Django host | `manage.py jobs_dispatch`, unit `lai-jobs-dispatch.service` | RDS, SQS | No (and nothing new is created then) |
| Work queue + DLQ | SQS | `lai-<env>-processing-work`, `-work-dlq` (`LaiProcessing-<env>`) | nothing | Yes: holds messages (14 days) |
| Worker | Lambda | `lai-<env>-processing-worker`, ECR image `lai/processing-<env>` by digest, built in GitHub Actions | S3, SQS | **Yes**: it needs only S3 and SQS |
| Completion queue + DLQ | SQS | `lai-<env>-processing-completions`, `-completions-dlq` | nothing | Yes: completions accumulate (14 days) |
| Completion consumer | Django host | `manage.py jobs_consume_completions`, unit `lai-jobs-completions.service` | RDS, SQS, S3 (by-reference results) | No; drains the backlog on startup |
| Reconciliation | Django host | `manage.py jobs_reconcile`, `lai-jobs-reconcile.service` (oneshot) started by `lai-jobs-reconcile.timer` every 10 minutes and once by `power-native.sh verify` | RDS | No; one run at start catches up (the timer is not `Persistent`) |
| Legacy ADR-055 consumer | Django host | `lai-jobs-consumer.service` (`jobs_consume_results`) | | Unchanged; legacy kinds only |

There is no Docker requirement on EC2: the worker image is built in GitHub Actions and pushed to
ECR. The small EC2 instance is not a heavy-processing fallback (card 012); runs longer than 15
minutes go to the ECS Fargate fallback (card 010, Wave 4).

The three processing units carry `ExecCondition=/usr/bin/test "${LAI_PROCESSING_BACKEND}" = sqs`:
while the backend is `disabled` (phase 1 of the stack, or before a worker image exists) systemd
skips them rather than restarting a failing command. Logs go to
`/var/log/lai/jobs-dispatch.log`, `jobs-completions.log` and `jobs-reconcile.log`, which the
CloudWatch agent ships to the `/lai/dev/jobs` log group (`setup-native.sh`). Units run as `lai`
with the hardening of the other `lai-*` units. The two long-running ones have
`Restart=on-failure`, `RestartSec=30`, `TimeoutStopSec` 40 (dispatch) and 60 (completions); the
reconcile service is `Type=oneshot` with no restart and `TimeoutStartSec=300` (section 6.1).

Production runs the same two commands as the `jobs-dispatch` and `jobs-completions` services of
`deploy/ec2/docker-compose.yml` (same image, settings and database as `django`, no port). They
start, stop and roll back with the rest of the compose project and idle unless
`LAI_PROCESSING_BACKEND` is `sqs`.

## 2. Commands (built)

| Command | Options | Behaviour |
|---|---|---|
| `manage.py jobs_dispatch` | `--once`, `--interval S` (default 2), `--limit N` (default 50, 1 to 500) | Relays due outbox rows (`relay_outbox`). SIGTERM finishes the pass and exits. A database error closes the connection and backs off (2^n s, at most 60). Backend `disabled`: exits 0. `inline`: a pass also runs the jobs in-process. `--once` prints `{"sent": n}` |
| `manage.py jobs_consume_completions` | `--once`, `--max-messages N` (1 to 10, default 10), `--wait-seconds S` (0 to 20, default 20), `--visibility S` (30 to 3600, default 300) | Runs `SELECT 1` before every receive and receives nothing while PostgreSQL is down. Applies completions (`apply_completion`) and acknowledges only after commit. `invalid`: neither acked nor released (reaches the DLQ after 5 receives). Transient (`CompletionDeferred`) or an unexpected error: released with `min(300, 5 x 2^(receive_count - 1))` s. After a database failure the rest of the batch is handed back with delay 0. Receive and database errors back off (2^n s, at most 60). Backend `disabled` or `inline`: exits 0. `--once` prints `{"received", "acked", "released", "left"}`; when the pre-receive check fails it prints those as 0 with `"database": "unavailable"` and exits 2 |
| `manage.py jobs_reconcile` | `--dry-run`, `--stuck-minutes M` (1 to 1440, default 15) | Expires open contract jobs past `expires_at` (`failed`, `job_expired`) and counts outbox rows unsent for more than M minutes (logs `processing.outbox_stuck`). Prints `{"dryRun", "expired_due", "expired", "stuck_outbox"}`. A run that changes rows holds a PostgreSQL session advisory lock: an overlapping run prints `{"dryRun": false, "skipped": "already_running"}` and exits 0; `--dry-run` only reads and takes no lock. An unexpected error logs `processing.reconcile_failed type=<class>` and exits 1 |
| `scripts/aws/native/processing-native.sh backlog` | `--stuck-minutes M` | Read only: runs `jobs_reconcile --dry-run` with the current release's settings as `lai` and prints one JSON line `{"backend", "dryRun", "expired_due", "expired", "stuck_outbox"}`; output that is not that JSON is refused, never echoed. Exit 0, 1 (report failed), 2 (usage), 3 (no release or no command) |
| `manage.py jobs_sweep` | (existing) | Legacy kinds only; contract kinds are excluded |

Staff actions in Django Admin ("background job" admin): **Cancel selected processing jobs**
(`jobs.cancel_processingjob`) and **Requeue selected failed processing jobs**
(`jobs.requeue_processingjob`). "Mark failed" never touches contract kinds.

## 3. Local worker (built)

```sh
# Default development and tests: LAI_PROCESSING_BACKEND=inline (work runs after commit, in-process).
# Separate local worker: LAI_PROCESSING_BACKEND=local, then in three shells:
cd lai && python manage.py jobs_dispatch
python -m lai_processing_runtime worker --root lai/.processing-local \
    --assets-root lai/.asset-storage --namespace local --concurrency 2 --poll-interval 1
cd lai && python manage.py jobs_consume_completions --wait-seconds 0

# Inspect the local queues:
python -m lai_processing_runtime status --root lai/.processing-local

# Whole flow against a throwaway database (compose PostgreSQL on 127.0.0.1:5442):
scripts/processing/local-demo.sh [--keep]
```

`processing/` must be on `PYTHONPATH` for Django to load contract kinds. `LAI_ASSET_LOCAL_ROOT`
and `LAI_PROCESSING_LOCAL_ROOT` must point the worker and Django at the same directories
(`--assets-root` and `--root`). Worker flags, exit codes and stop behaviour: `RUNTIME.md`
section 4. `local-demo.sh` creates its own database (`lai_processing_demo*` only) and temporary
directories, uses the real upload service, the real GLB validator and the real commands, and
touches nothing in AWS. It ran successfully at integration (job validated, verdict `pass`, clips
`["Idle", "Armature|mixamo.com|Layer0"]`, `AssetVersion` status unchanged at `VALIDATED`).

## 4. Queue and worker settings (as synthesized)

| Setting | Work queue | Completion queue |
|---|---|---|
| Type | Standard, SSE-SQS, TLS-only policy | Standard, SSE-SQS, TLS-only policy |
| Retention | 14 days | 14 days |
| Visibility timeout | 3600 s (6 x the 600 s worker timeout x batch 1; validated at synth) | 300 s |
| DLQ | `maxReceiveCount` 5, 14 days | `maxReceiveCount` 5, 14 days |
| Who may send | Only `lai-django-ec2-<env>` (plus `workRedriveRoleArns`) | Only the worker role (plus `completionRedriveRoleArns`) |
| Consumer | Lambda event source mapping: batch 1, `ReportBatchItemFailures`, `maximumConcurrency` = reserved concurrency | `jobs_consume_completions`, long polling 20 s |

Worker: 600 s timeout (at least 120 s, at most 840 s), cleanup margin 60 s (a job's deadline is
at most 540 s at the 600 s timeout), 2048 MB memory and ephemeral storage, arm64, no VPC,
reserved concurrency dev 2 / prod 5 (configurable; the deployed value is read back from the
`ReservedConcurrency` stack output and kept by `provision.sh`, `deploy-debug.sh` and
`deploy-processing.yml`, as are `AlarmOverrides`, `WorkRedriveRoleArns` and
`CompletionRedriveRoleArns`). Message
bodies stay at or below 240 KiB (`max_message_bytes`); a larger result goes by reference as the
`report.job_result` artifact.

## 5. Dispatch controls per environment

| Control | Values | Effect | State |
|---|---|---|---|
| `LAI_PROCESSING_BACKEND` | `disabled`, `inline`, `local`, `sqs` (production allows `disabled` or `sqs`; default `disabled`) | `disabled`: `submit_processing_job` raises `ProcessingDisabled`, the units are skipped; the synchronous Asset Library path is the only one | Built. SSM `/lai/<env>/django/LAI_PROCESSING_BACKEND` is written by `LaiProcessing-<env>`: `disabled` in phase 1, `sqs` once a worker digest is deployed |
| `LAI_PROCESSING_DISPATCH` | `enabled` (default), `paused` | `paused`: jobs are still created and outbox rows written, but `relay_outbox` sends nothing; resuming sends them | Built. No CDK parameter: an operator may create `/lai/<env>/django/LAI_PROCESSING_DISPATCH`; `render-env-native.sh` renders every parameter under that prefix at the next deploy, rollback or bootstrap, then restart `lai-jobs-dispatch` |
| `LAI_PROCESSING_MAX_ATTEMPTS` | 1 to 10, default 3 | `RetryPolicy.max_attempts` for automatic retries | Built |
| `LAI_PROCESSING_JOB_TTL_HOURS` | 1 to 336, default 72 | `expires_at` of every attempt window | Built |
| Lambda event source mapping | enabled / disabled | Disabled: work waits in the queue (up to retention) | Console or CDK; no command |
| Reserved concurrency 0 | | Emergency stop for the worker | Console or CDK |

The existing synchronous upload and validation (`lai/apps/assets/services.py`) keeps working in
every mode; nothing in Wave 2 calls `submit_model_validation` automatically.

## 6. Overnight shutdown (00:00 to 08:00 `America/Los_Angeles`) and manual stop/start

The dev schedule exists already: ADR-055's `lai-dev-power` state machine runs the power document,
whose body is `scripts/aws/native/power-native.sh` (extended in Wave 2). Production has no
schedule.

What happens during a stop:

1. Django is down, so no new jobs are created and no outbox rows are sent.
2. Work messages already queued keep being processed by Lambda (S3 and SQS only).
3. Each finished attempt sends a completion. Completions accumulate in the completion queue
   (14 days, far above 8 hours). The dev `completion-backlog` alarm threshold is 12 h, so the
   nightly stop does not page.
4. On start, the completion consumer drains the backlog. Application is idempotent.
5. The relay sends outbox rows committed before the stop but not yet sent.
6. Jobs do not expire overnight: `expires_at` is 72 h by default and contract kinds are excluded
   from the legacy 60-minute sweep. A worker still refuses a request that is past `expires_at`
   (`job_expired`).

### `power-native.sh quiesce` (before the instance stops)

1. Wait briefly for a running release to finish (deploy lock, up to 240 s).
2. Stop `lai-jobs-reconcile.timer`, then `lai-jobs-reconcile.service` (stops a run in progress;
   each expiry is its own transaction, so a stop never leaves a half-expired job).
3. Stop `lai-jobs-dispatch` (no new work leaves; equivalent to pausing dispatch).
4. Stop `lai-jobs-completions`.
5. Stop `lai-jobs-consumer` (legacy), then `lai-gunicorn`.

Exits 0 unless the action is invalid. Stopping the consumer mid-message is safe: an unacknowledged
completion is delivered again and recognised as a duplicate.

### `power-native.sh verify` (after the instance starts)

The `lai-dev-power` state machine starts RDS and waits for `available` before it starts EC2, so
the database is normally up before systemd starts anything. `verify` does not rely on that:

1. nginx and `lai-gunicorn` active.
2. **Database gate**: `health-native.sh --db` opens a PostgreSQL connection with the current
   release's settings (`psycopg.connect(..., connect_timeout=10)`; no queue is touched), then needs
   liveness and readiness 200 (readiness also checks pending migrations), retried up to
   `LAI_VERIFY_ATTEMPTS` (40) x `LAI_VERIFY_INTERVAL` (5 s). Until it passes no processing step
   runs; if it never passes, verify ends unhealthy (exit 1) without starting the consumers.
3. Start `lai-jobs-consumer` (legacy), then `lai-jobs-completions` (drains the overnight backlog).
4. **One reconciliation**: `systemctl start lai-jobs-reconcile.service` (a oneshot, so the call
   returns when the run ends; skipped by its condition unless the backend is `sqs`). It runs before
   the relay, so jobs that expired while the instance was off have their outbox rows cancelled
   before anything stale could be sent. A failure is a warning, not an unhealthy start.
5. Start `lai-jobs-dispatch`, then `lai-jobs-reconcile.timer`.
6. **Backlog report**: `processing-native.sh backlog` prints, for example,
   `processing backlog: {"backend":"sqs","dryRun":true,"expired_due":0,"expired":0,"stuck_outbox":3}`.
   `expired_due` should be 0 right after step 4; `stuck_outbox` counts rows that came due while
   the instance was off (delayed retries) and drops once the relay has sent them.
7. Apply a pending release when `/lai/dev/deploy/apply-pending-on-start` is true.
8. Print one summary line, `health: healthy|unhealthy; startup reconciliation
   ok|failed|not-installed; processing backlog <json>|unavailable|not-reported`. Exit 0 when
   healthy, 1 when not.

Steps 4 to 6 are skipped (reported `not-installed` or `not-reported`) for a release that predates
the reconcile units or the backlog script.

### 6.1 The reconciliation timer

| Item | Value |
|---|---|
| Units | `deploy/native/systemd/lai-jobs-reconcile.service` (`Type=oneshot`, no `[Install]`, user `lai`, the runtime and release environment files, the hardening and `ExecCondition` of the other processing units, `TimeoutStartSec=300`, output to `/var/log/lai/jobs-reconcile.log`) and `lai-jobs-reconcile.timer` |
| Schedule | `OnBootSec=10min`, `OnUnitActiveSec=10min`, `RandomizedDelaySec=60`, `AccuracySec=30s`, `Persistent=false` (verify runs one at start) |
| Installed by | Every release (`install_release_config` in `lib-native.sh`, `LAI_TIMER_UNITS`); only the timer is enabled (`LAI_TIMERS`), and a deploy restarts it to re-arm the schedule. A release that predates the units does not install them, so a rollback to one leaves the installed units in place (they still work: `jobs_reconcile` exists since Wave 2) |
| Overlap | The command's PostgreSQL session advisory lock (`RECONCILE_LOCK_KEY`): a manual run during a timer run exits 0 with `skipped: already_running`. systemd also never starts a oneshot that is already running |
| Failure | `processing.reconcile_failed type=<class>` in `jobs-reconcile.log`, exit 1, the unit `failed` until the next run; alarm `lai-dev-processing-reconcile-failed` (section 9.1) |
| Change the schedule | A drop-in, which releases never overwrite: `systemctl edit lai-jobs-reconcile.timer`, then under `[Timer]` an empty `OnUnitActiveSec=` (clears the default) followed by `OnUnitActiveSec=30min`, and the same for `OnBootSec`; then `systemctl daemon-reload` and `systemctl restart lai-jobs-reconcile.timer`. `--stuck-minutes` keeps its default (15); change it with an `ExecStart=` drop-in on the service the same way |
| Stop it | `systemctl stop lai-jobs-reconcile.timer` (until the next deploy or verify starts it again) |

**Reconciliation cannot loop retries.** `processing.reconcile` only moves overdue open jobs to
`failed` (`job_expired`), cancels their unsent outbox rows, marks their pending attempts
`abandoned`, and counts stuck outbox rows. It never creates an attempt or an outbox row and never
sends a message (a unit test asserts this). An expired job runs again only when a person
requeues it in Django Admin. Running reconciliation every 10 minutes, twice, or after a crash is
therefore harmless: each expiry happens once under the job row lock, and the next run finds
nothing due.

## 7. When RDS is unavailable while the consumer runs

Before every receive the consumer runs `SELECT 1`. While PostgreSQL is known to be down it
receives nothing and backs off (2, 4, 8 s and so on, at most 60 s), so the completions wait
untouched in the queue and their receive counts do not grow. With `--once` the failed check
prints `{"database": "unavailable", ...}` and exits 2.

When the database fails after a receive, `apply_completion` raises `CompletionDeferred`; the
consumer closes the connection and releases that message with `min(300, 5 x 2^(receive_count -
1))` s, hands the rest of the batch back with delay 0 without attempting them, and backs off
before the next receive. Messages are acknowledged only after commit. An `IntegrityError` is not
treated as an outage (`processing.is_database_outage`).

Limit: a database failure that happens after a receive still uses up that receive for every
message in the batch, so repeated mid-batch failures can still bring a completion to
`maxReceiveCount` 5 and the DLQ. An outage that is already in progress before the receive cannot.
Tests: `test_processing_commands.py`. On dev the nightly stop is not affected (the consumer is
stopped before RDS).

What the check cannot prevent: a failure **after** a receive still spends that receive. If
PostgreSQL fails between `SELECT 1` and the end of a batch, the message being applied is released
with the backoff and the rest of the batch is released at once, and each of those deliveries has
already counted toward the completion queue's `maxReceiveCount` (5). Five such receives of the same
completion move it to the completion DLQ. That needs five outages that each begin inside a batch
holding that message, so it is rare; the recovery is a redrive (section 8.4), which is safe
because application is idempotent. The consumer logs `processing.consumer database_error` (or
`database_error_in_batch`) each time, which feeds the alarm in section 9.1.

## 8. DLQ runbook, replay and redrive

Nothing here has been exercised against AWS: no queue exists yet. Every step is read-only until
section 8.4 or 8.5 says otherwise, and every write is an operator decision recorded in the
incident notes.

### 8.1 Ground rules

- **Look at metadata, not bodies.** Messages carry ids, checksums, keys and closed codes, never
  child data, but a body is still never pasted into a ticket, chat or log. Record the
  `job_id`, `attempt_id`, `event_id` (completions), `ApproximateReceiveCount`, the first-receive
  timestamp and the closed error code. Never record presigned URLs, object keys outside the
  attempt prefix, or anything from a decoded asset.
- **Prefer a fresh attempt to a replay.** A Django Admin **Requeue** (section 8.4, option B) is
  the normal way to run a job again. A redrive replays an old message as it was, which is right
  only when the message itself is good and the cause was outside it.
- **Never edit and resend a message.** A hand-built work or completion message would be either
  rejected (`REJECT`, identity checks) or, worse, look authentic. There is no replay command by
  design.
- **Who may redrive** (B7): only a specifically authorised operations administrator assuming the
  dedicated operations redrive role that `LaiProcessing-<env>` lists in its redrive role props.
  The work queue and the completion queue have **separate** sender lists: a role allowed to
  redrive the work DLQ is not thereby allowed to redrive completions, and the reverse. SQS
  redrive sends as the caller, so a role not on the matching list is denied by the queue policy.
  Django Admin users, staff permissions and the Django instance role are **never** a redrive
  path: no Django code, admin action or management command sends to a DLQ or redrives one. The
  lists are the stack props `workRedriveRoleArns` and `completionRedriveRoleArns` (see
  "Redrive permissions" below). Nothing is deployed.
- **Messages expire.** Queues and DLQs keep messages 14 days. A message that has sat in a DLQ for
  most of that time has little left once redriven (SQS keeps the original enqueue time).

### 8.2 Triage: which case is it?

| Signal | Where | Case |
|---|---|---|
| `lai-<env>-processing-work-dead-letters` | work DLQ depth | 8.3 work DLQ |
| `lai-<env>-processing-completion-dead-letters` | completion DLQ depth | 8.4 or 8.5 completion DLQ |
| `processing.completion_invalid code=... field=...` in `/lai/dev/jobs` | consumer | poison completion (8.5) |
| `processing.completion_rejected ... reason=...` | consumer, alarm `processing-completion-rejected` | identity or signature failure (8.6), **not** a DLQ case |
| Job `failed` with a verdict `fail` result, or `error_code` such as `model_invalid` | Django Admin | permanent validation failure (8.7), **not** a DLQ case |
| `processing.consumer database_error` repeated, alarm `processing-consumer-database-error` | consumer | temporary database failure (section 7, 8.8) |
| Job `failed` with `retries_exhausted` | Django Admin | retry exhaustion (8.9) |
| Job `queued` long after `expires_at`, or `processing.outbox_stuck` | reconcile | stale attempts (8.10) |

To find the job for a DLQ message without reading its body: open the job in Django Admin by the
`job_id` from the worker log line (`/aws/lambda/lai-<env>-processing-worker`, closed telemetry
fields) or the consumer log line. If the only way to learn the ids is to receive the message from
the DLQ, receive it with a short visibility timeout, read only the message attributes and the
envelope ids, and let it become visible again; do not delete it yet.

### 8.3 Work DLQ

**How a message gets there.** The worker failed to finish the same work message five times: it
could not decode it (`work.invalid` in the worker log: a poison message), it crashed or timed
out, or it could not send its completion. Reporting a failed **verdict** or a permanent error is a
successful run and never puts work in the DLQ.

**Django state meanwhile.** No completion arrived, so the job is still `queued` with the same
current attempt; nothing has changed in the database. The job stays `queued` until a redrive
completes it or `jobs_reconcile` expires it at `expires_at` (default 72 h after submission).

| Cause | Action |
|---|---|
| `work.invalid` (undecodable, schema version unknown, too large) | **Never redrive**: it is malformed and will fail the same way. Record the metadata, delete the message from the DLQ, let reconcile expire the job (or wait for it), then Requeue if the work is still wanted. If the dispatcher produced it, that is a Django bug: fix it first |
| Worker timeout, out of memory, crash on one input | Do not redrive until the processor or sizing is fixed and released (a new image digest). Then prefer **Requeue** once the job is `failed`: the new attempt runs with the current processor |
| Transient: S3 or SQS outage, throttling, a completion send failure, a since-fixed worker bug with the same processor version | **Redrive** the work DLQ to the work queue (option A below) |

**Option A: redrive the work message (reprocess the same attempt).** An authorised operations
administrator starts an SQS message move task from the work DLQ to its source queue (console
"Start DLQ redrive", or `StartMessageMoveTask`), as the operations redrive role.

- The worker runs the **same attempt id**. Its artifacts go to the same attempt-scoped keys with
  create-only writes: identical bytes are a no-op (the worker reads its own artifacts back),
  different bytes are refused as `artifact_conflict`, so earlier partial output is never
  overwritten.
- If the job is still `queued` on that attempt, the completion is `APPLY` (or `RETRY`): the
  normal result, artifacts recorded, the asset hook runs once.
- If an earlier completion for that attempt was already applied, the new one is `DUPLICATE`
  (`already_applied` or `event_seen`); nothing changes.
- If the job has meanwhile expired, been cancelled or been requeued, the completion is `STALE`
  (`job_finished` or `superseded_attempt`); nothing changes, and the old attempt's artifacts are
  orphans for cleanup. A request past `expires_at` is refused by the worker as `job_expired`.
- Database effect: at most one applied result, one receipt per completion event.

**Option B: Django Admin Requeue (a fresh logical attempt, preferred).** Only for a `failed` job
(`jobs.requeue_processingjob`); for a work-DLQ job that means waiting for `jobs_reconcile` to
expire it (or cancelling is not a shortcut: a cancelled job cannot be requeued).

- New `attempt_id` and attempt number (same idempotency key), new expiry window, a new outbox row
  that the relay sends; pending attempts are marked `abandoned`; `error_code`, `result` and
  `finished_at` are cleared.
- New artifact keys under the new attempt's prefix; the old attempt's artifacts are untouched.
- Any later completion of the old attempt (including from a redrive) is `STALE`.
- Then **delete** the old message from the work DLQ after recording it, so nobody redrives it
  later by mistake (it would only produce a `STALE`, but it costs a worker run).

### 8.4 Completion DLQ: redelivering a completion

**How a message gets there.** The consumer received it five times without acknowledging it:
`invalid` (left alone each time, section 8.5), a repeated transient failure after receive
(`database_error` after the pre-receive check, `result_unavailable` when the by-reference result
object could not be read), or an unexpected exception (`processing.consumer apply_error`, a
consumer bug).

**Django state meanwhile.** Nothing from that completion was committed (each attempt rolled back),
so the job is as it was, typically `queued`; the worker's artifacts exist in S3.

**Redrive (option C).** After the cause is fixed (database back, a consumer fix released, the
result object readable), an authorised operations administrator redrives the completion DLQ to
the completion queue as the operations redrive role (completion sender list). The consumer applies
each message through the normal path:

| Outcome | Database effect | Artifacts |
|---|---|---|
| `APPLY` (the job still waits on that attempt) | Result applied, attempt `succeeded` or `failed`, `JobArtifact` rows, a `CompletionReceipt`, the asset hook runs (version validated or rejected, `subject_outcome`) | Recorded as they are; none rewritten |
| `RETRY` | Attempt `failed`, a new attempt and outbox row with the policy delay | New attempt gets new keys |
| `DUPLICATE` (`event_seen`, `already_applied`) | Receipt check only, `deliveries` incremented; nothing else | None |
| `STALE` (`job_finished`, `superseded_attempt`, `not_running`: expired, cancelled or requeued since) | A receipt for audit; state unchanged | The old attempt's artifacts become orphans |
| `REJECT` | A receipt and `processing.completion_rejected`; nothing applied | None |

Receipts (`event_id` unique) make the redrive idempotent: redriving the same completion twice, or
a completion that was in fact applied before an ack was lost, never applies it twice. If the
same `event_id` arrives for a different job or attempt it is `REJECT event_id_reused`.

If the job has meanwhile been requeued (option B), the redriven completion is `STALE` and is
safe to let through; it is equally safe to delete it from the DLQ instead.

### 8.5 Poison and permanently malformed completions

`processing.completion_invalid code=<code> field=<field>` means the body could not be decoded or
breaks the contract (`invalid_input`, `unsupported_schema_version`, `message_too_large`). The
consumer neither acknowledges nor releases it, so it moves to the DLQ after five receives.

- **Never redrive** it: it would fail identically five more times.
- Inspect **metadata only**: the log's code and field, the message attributes, size, sent and
  first-receive timestamps, `ApproximateReceiveCount`, and the envelope ids if they are readable.
  Do not copy the body anywhere.
- Decide whether a sender is broken (a worker release that changed the contract: roll the worker
  back to the previous image digest) or the message is foreign (only the worker role can send to
  the completion queue, so a foreign message means a role is misconfigured or compromised: treat
  it as a security incident).
- Record the findings, then delete the message from the DLQ. Database effect: none (no receipt is
  written for an undecodable message). The affected job, if any, stays `queued` until reconcile
  expires it; then Requeue it if still wanted.

### 8.6 Invalid signatures and identity failures (REJECT, not DLQ)

A completion whose identity does not match Django's record is **`REJECT`ed and acknowledged**:
unknown job, another namespace, `event_id_reused`, unknown attempt, kind, processor, profile or
input mismatch, a result digest that does not match (`result_mismatch`), an artifact outside the
attempt prefix (`artifact_foreign`), a by-reference result too large. It never reaches the DLQ and
redriving cannot change its fate.

- Effect: a `CompletionReceipt` with action `reject` and the reason; the job is untouched; no
  artifact is recorded.
- Signal: `processing.completion_rejected job=<id or -> attempt=<id> reason=<code>` and the alarm
  `lai-dev-processing-completion-rejected` (section 9.1).
- Response: a reject is a **security signal**. Check the reason. `namespace_mismatch` usually
  means two environments share a queue URL (configuration). `input_mismatch`, `result_mismatch`
  or `artifact_foreign` from the real worker means a worker bug or a tampered object: stop the
  worker (event source mapping disabled or reserved concurrency 0, section 5), keep the evidence,
  and escalate. Do not "fix" a job by editing its rows.

A subject mismatch is different: the completion applied, but the asset hook found that the job
validated other bytes than the version now holds (`processing.subject_mismatch job=.. reason=..`,
alarm `processing-subject-mismatch`). The version is left unchanged (it stays `DRAFT`), the job
keeps its result with `subject_outcome` set to the reason. Use **Validate in background** on the
version for a fresh job; never redrive.

### 8.7 Permanent validation failures (not DLQ)

A model that fails validation is a **successful job with a `fail` verdict**: the worker completes,
the completion is `APPLY`, the job is `validated` then `ready_for_review`, and the asset hook moves
a `DRAFT` version to `REJECTED` with the findings in its report. A permanent processing error
(`failed_permanent`, for example an unreadable file) is `APPLY` to `failed`. Neither touches a DLQ,
and neither is fixed by replay: upload a corrected file as a new version. Requeue of a `failed`
job runs the same bytes again, useful only after a processor fix.

### 8.8 Temporary database failures

Covered in section 7. The consumer checks PostgreSQL before every receive and backs off while it
is down, so an outage that starts between batches spends no receives. A failure **after** a
receive spends that receive (the message is released with a backoff, the rest of the batch at
once), and five such failures for one message move it to the completion DLQ: redrive it (8.4)
once the database is healthy. The relay rolls back its row transaction and backs off; nothing is
lost. Reconciliation logs `processing.reconcile_failed type=OperationalError`, exits 1 and runs
again at the next timer tick.

### 8.9 Retry exhaustion

A retryable failure (`processing_timeout`, `temporary_failure`, `throttled`, `storage_failure`)
gets new attempts automatically up to `LAI_PROCESSING_MAX_ATTEMPTS` (default 3). The last one is
applied as `failed` with reason `retries_exhausted`. No message is in a DLQ. After fixing the cause,
**Requeue** (8.3 option B) starts a fresh attempt with a new expiry; the attempt counter continues
(at most 100 attempts per job).

### 8.10 Stale attempts and stuck outbox rows

- A job that is still `queued` (or `processing`) after `expires_at` is expired by the next
  reconciliation run (`failed`, `job_expired`, pending outbox rows cancelled). A late completion
  of its attempt is then `STALE job_finished`. Requeue it if still wanted.
- `processing.outbox_stuck count=N minutes=M` means rows waited unsent for more than M minutes:
  dispatch is paused (`LAI_PROCESSING_DISPATCH=paused`), `lai-jobs-dispatch` is stopped or
  failing (`processing.dispatch send_error` or `processing.dispatcher database_error` in
  `jobs-dispatch.log`), or the work queue refuses sends (policy, permissions). Fix the relay; the
  rows are sent in order once it runs. Do not delete outbox rows by hand.
- Superseded attempts (a retry or requeue happened) are `abandoned`; their late completions are
  `STALE superseded_attempt`.

### 8.11 Safe replay checklist

1. Alarm or log line identified, case chosen from 8.2.
2. Cause fixed and released (or confirmed transient and over).
3. Ids recorded (job, attempt, event, receive count); bodies not copied.
4. Decision: Requeue (preferred for a job that should run again) or redrive (the message is good
   and the cause was outside it) or delete (malformed or superseded).
5. Redrive only as the operations redrive role on the matching sender list; never through Django.
6. Afterwards: DLQ depth back to 0; the job in Django Admin shows the expected state and
   `subject_outcome`; `processing-native.sh backlog` reports no `expired_due` and no lasting
   `stuck_outbox`.

**Redrive permissions (owner decision B7, 2026-11-17).** The queue policies deny
`sqs:SendMessage` on the work queue to everyone except `lai-django-ec2-<env>`, and on the
completion queue to everyone except the worker role. An SQS redrive sends as the caller, so only
authorized operations administrators may redrive: their role ARNs go in the stack props
`workRedriveRoleArns` (work DLQ into the work queue) and `completionRedriveRoleArns` (completion
DLQ into the completion queue), two separate lists, each granting the DLQ message-move actions
and `sqs:SendMessage` on its own source queue only. The stack refuses the Django and worker roles
in either list; redrive never runs as the Django role. Both lists default to empty; keep
`completionRedriveRoleArns` empty unless a completion redrive is under way. The deployed lists
are read back from the `WorkRedriveRoleArns` and `CompletionRedriveRoleArns` stack outputs so a
later deploy keeps them.

## 9. Alarms (as synthesized in `LaiProcessing-<env>`)

All go to the existing `lai-django-alarms-<env>` topic, missing data not breaching; thresholds are
overridable with the `processingAlarms` context. Full table:
`processing-infrastructure.md` section 5.

| Alarm (`lai-<env>-processing-...`) | Signal | Default |
|---|---|---|
| `work-oldest-message` | worker not consuming | at least 3600 s |
| `work-queue-depth` | backlog | dev 50, prod 200 visible |
| `completion-backlog` | consumer not draining | dev 12 h, prod 1 h |
| `work-dead-letters`, `completion-dead-letters` | poison messages | at least 1 |
| `worker-errors`, `worker-throttles` | Lambda health (phase 2 only) | at least 1 in 15 min |
| `worker-duration-high` | jobs near the timeout | p95 above 480,000 ms |
| `worker-concurrency-high` | concurrency cap reached | dev 2, prod 5 |

### 9.1 Processing log alarms (dev, `LaiDevPlatform-dev`)

The Django processing commands log to files on the instance that the CloudWatch agent ships to
`/lai/dev/jobs` (`setup-native.sh`: `jobs-dispatch.log`, `jobs-completions.log`,
`jobs-reconcile.log`, plus the legacy `jobs-consumer.log`). That log group is created and owned by
`LaiDevPlatform-dev` (`devPlatformStack.ts`, `instanceLogs`), so the metric filters live there,
on the owned group (no imported or second group), and the alarms use the same `alarm()` helper and
the same `lai-django-alarms-dev` topic as the stack's other alarms, missing data not breaching (a
stopped instance publishes nothing). Metrics: namespace `LearningAdventureIsland/Processing`,
value 1 per matching line, no default value.

| Alarm (`lai-dev-processing-...`) | Filter (quoted term) | Default | Response |
|---|---|---|---|
| `completion-rejected` | `"processing.completion_rejected"` | at least 1 in 15 min | Section 8.6 |
| `outbox-stuck` | `"processing.outbox_stuck"` | at least 1 in each of 2 x 15 min | Section 8.10 |
| `reconcile-failed` | `"processing.reconcile_failed"` | at least 1 in 15 min | Section 6.1, 8.8 |
| `subject-mismatch` | `"processing.subject_mismatch"` | at least 1 in 15 min | Section 8.6 |
| `hook-error` | `"processing.hook_error"` | at least 1 in 15 min | A completion hook bug: the job kept its result with `subject_outcome = hook_error` and the version was not changed. Fix the hook, then **Validate in background** on the version |
| `consumer-database-error` | `"processing.consumer database_error"` (also matches `database_error_in_batch`) | at least 5 in 15 min | Section 7, 8.8 |

`outbox-stuck` needs two consecutive periods because the startup reconciliation may count delayed
retry rows that came due overnight, which the relay sends a moment later. Thresholds, periods (1,
5, 10, 15, 30 or 60 minutes) and evaluation periods are overridable per alarm with the
`processingLogAlarms` context (environment `LAI_PROCESSING_LOG_ALARMS`), for example
`-c processingLogAlarms='{"ConsumerDatabaseError":{"threshold":10}}'`; invalid values fail the
synth.

The filters match fixed event names. Every one of these lines carries only ids, closed codes,
counts and exception class names (`type=OperationalError`), never message text, content, names,
object keys or presigned URLs, so a metric filter never extracts anything sensitive.

**Prod:** `LaiDjangoEc2-prod` runs Django in containers that log to `/lai/prod/django` and does
not run the processing consumers, relay or reconciliation yet, so no prod log alarms exist. When
the prod deployment gains them, add the same filters on the group that stack owns.

## 10. Cost notes (estimates; see `processing-infrastructure.md` section 11)

- About $5 a month in dev and $37 in prod at the assumed volumes; idle about $2 per environment
  (SQS polling, ECR storage, alarms, logs).
- No NAT gateway, VPC endpoint, load balancer or KMS key is added.
- ECR keeps the newest 30 images (rollback targets must be among them); untagged images expire
  after 7 days.
- Stopping EC2 and RDS overnight does not stop SQS or Lambda charges, which are usage based.
- The six dev processing log alarms (section 9.1) cost about $0.60 a month; metric filters are
  free, and the reconcile log adds a few lines every 10 minutes to the `/lai/dev/jobs` ingestion.
