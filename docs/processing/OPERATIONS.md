# Processing operations

Updated for Wave 2 (2026-11-17). **Nothing on this page is deployed or provisioned.** The
commands, systemd units, CDK stacks and alarms below exist in the repository (built and tested
locally, synthesized by CDK), but no queue, DLQ, Lambda function, image, alarm or SSM setting
exists in AWS. Deploying them needs explicit owner approval (A9, ADR-019 G7). Items still only
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
| Reconciliation | Django host | `manage.py jobs_reconcile` | RDS | No. **Planned**: no timer or schedule runs it yet; run it by hand |
| Legacy ADR-055 consumer | Django host | `lai-jobs-consumer.service` (`jobs_consume_results`) | | Unchanged; legacy kinds only |

There is no Docker requirement on EC2: the worker image is built in GitHub Actions and pushed to
ECR. The small EC2 instance is not a heavy-processing fallback (card 012); runs longer than 15
minutes go to the ECS Fargate fallback (card 010, Wave 4).

Both processing units carry `ExecCondition=/usr/bin/test "${LAI_PROCESSING_BACKEND}" = sqs`:
while the backend is `disabled` (phase 1 of the stack, or before a worker image exists) systemd
skips them rather than restarting a failing command. Logs go to
`/var/log/lai/jobs-dispatch.log` and `/var/log/lai/jobs-completions.log` (and the `/lai/dev/jobs`
log group). Units run as `lai` with the hardening of the other `lai-*` units, `Restart=on-failure`,
`RestartSec=30`, `TimeoutStopSec` 40 (dispatch) and 60 (completions).

Production runs the same two commands as the `jobs-dispatch` and `jobs-completions` services of
`deploy/ec2/docker-compose.yml` (same image, settings and database as `django`, no port). They
start, stop and roll back with the rest of the compose project and idle unless
`LAI_PROCESSING_BACKEND` is `sqs`.

## 2. Commands (built)

| Command | Options | Behaviour |
|---|---|---|
| `manage.py jobs_dispatch` | `--once`, `--interval S` (default 2), `--limit N` (default 50, 1 to 500) | Relays due outbox rows (`relay_outbox`). SIGTERM finishes the pass and exits. A database error closes the connection and backs off (2^n s, at most 60). Backend `disabled`: exits 0. `inline`: a pass also runs the jobs in-process. `--once` prints `{"sent": n}` |
| `manage.py jobs_consume_completions` | `--once`, `--max-messages N` (1 to 10, default 10), `--wait-seconds S` (0 to 20, default 20), `--visibility S` (30 to 3600, default 300) | Runs `SELECT 1` before every receive and receives nothing while PostgreSQL is down. Applies completions (`apply_completion`) and acknowledges only after commit. `invalid`: neither acked nor released (reaches the DLQ after 5 receives). Transient (`CompletionDeferred`) or an unexpected error: released with `min(300, 5 x 2^(receive_count - 1))` s. After a database failure the rest of the batch is handed back with delay 0. Receive and database errors back off (2^n s, at most 60). Backend `disabled` or `inline`: exits 0. `--once` prints `{"received", "acked", "released", "left"}`; when the pre-receive check fails it prints those as 0 with `"database": "unavailable"` and exits 2 |
| `manage.py jobs_reconcile` | `--dry-run`, `--stuck-minutes M` (1 to 1440, default 15) | Expires open contract jobs past `expires_at` (`failed`, `job_expired`) and counts outbox rows unsent for more than M minutes (logs `processing.outbox_stuck`). Prints `{"dryRun", "expired_due", "expired", "stuck_outbox"}` |
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
2. Stop `lai-jobs-dispatch` (no new work leaves; equivalent to pausing dispatch).
3. Stop `lai-jobs-completions`.
4. Stop `lai-jobs-consumer` (legacy), then `lai-gunicorn`.

Exits 0 unless the action is invalid. Stopping the consumer mid-message is safe: an unacknowledged
completion is delivered again and recognised as a duplicate.

### `power-native.sh verify` (after the instance starts)

1. nginx and `lai-gunicorn` active, database reachable, readiness 200.
2. Start `lai-jobs-consumer`, then `lai-jobs-completions` (drains the overnight backlog), then
   `lai-jobs-dispatch`.
3. Apply a pending release when `/lai/dev/deploy/apply-pending-on-start` is true.

**Planned:** running `jobs_reconcile` after verify. Until it is scheduled, run
`manage.py jobs_reconcile --dry-run` and then without `--dry-run` by hand after a long outage.

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

## 8. DLQ handling and replay

| DLQ | Typical cause | Procedure |
|---|---|---|
| Work DLQ | Undecodable work (`work.invalid` in the worker log), or a worker crash, timeout or completion-send failure five times | Diagnose from the worker log group (closed telemetry fields only). If transient, redrive to the source queue. If the job needs a fresh attempt (expired, input changed, processor fixed), **requeue it from Django Admin instead** (requires the job to be `failed`; use `jobs_reconcile` or wait for expiry otherwise): new attempt id, new artifact keys, new outbox row. A redriven old attempt that Django has since superseded is `STALE` on completion |
| Completion DLQ | `processing.completion_invalid` (undecodable or contract-invalid), a consumer bug, repeated database failures in the middle of batches (section 7) | Fix the cause, then redrive. `DUPLICATE`, `STALE` and `REJECT` are all safe outcomes. Undecodable events stay for analysis and are deleted only by an operator |

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
later deploy keeps them. **Planned (006):** the replay runbook and any replay command.

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

**Planned (006):** a log metric filter and alarm on the consumer's
`processing.completion_rejected` warnings (no such filter exists; consumer logs are on the
instance and in `/lai/dev/jobs`).

## 10. Cost notes (estimates; see `processing-infrastructure.md` section 11)

- About $5 a month in dev and $37 in prod at the assumed volumes; idle about $2 per environment
  (SQS polling, ECR storage, alarms, logs).
- No NAT gateway, VPC endpoint, load balancer or KMS key is added.
- ECR keeps the newest 30 images (rollback targets must be among them); untagged images expire
  after 7 days.
- Stopping EC2 and RDS overnight does not stop SQS or Lambda charges, which are usage based.
