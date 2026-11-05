# AI Question Studio worker: operator runbook (LAI-AQS-027, ADR-052)

The Studio worker runs AI Question Studio generation batches in the background. Design and states:
`docs/AI_QUESTION_STUDIO.md` section 14. Release mechanics, SSM settings and log groups:
`docs/platform/DJANGO_EC2_DEPLOYMENT.md`. ADR-052 is **Proposed**: nothing here is deployed, and
every deploy stays an owner-approved action (ADR-037, ADR-019 G7).

## 1. What the worker is

- A Django management command, `python manage.py studio_worker`, in the same image as the API.
- In production it is the `studio-worker` service of `deploy/ec2/docker-compose.yml`: same image and
  `django.env` as `django`, no published port, the private `app` network, read-only root with a
  `/tmp` tmpfs, no capabilities, `no-new-privileges`, `restart: unless-stopped`,
  `stop_grace_period: 150s`, logs to the Django log group with stream
  `studio-worker-<git sha>`.
- It talks only to PostgreSQL and, through the ADR-044 model client, to Bedrock under the instance
  role. No new AWS resource, IAM change or dependency. It adds one Python process (roughly 100 to
  150 MB of memory) to the instance.
- The web request only stores a QUEUED batch and its chunks (`LAI_STUDIO_RUN_MODE=worker`, the
  production default; production refuses `thread` and `inline`). The worker claims the batch, runs
  it chunk by chunk under a lease, and commits each chunk once.
- Each loop it updates its `StudioWorker` row (`last_seen_at`) and touches the heartbeat file
  `LAI_STUDIO_WORKER_HEALTH_FILE` (default `/tmp/lai-studio-worker.alive`). The container health
  check only checks that file is younger than 300 seconds; it does not start Django.

Command options:

| Option | Effect |
|---|---|
| `--once` | Drain every claimable batch, then exit (cron or one-off use) |
| `--concurrency N` | N claim loops as threads in one process, each with its own database connection. Bounded by `LAI_STUDIO_WORKER_CONCURRENCY` (maximum 8) |
| `--poll-seconds S` | Idle wait between claim attempts (default `LAI_STUDIO_WORKER_POLL_SECONDS`, 5) |
| `--max-batches N` | Exit after N batches (process recycling; compose restarts it) |
| `--worker-id ID` | Fixed worker id instead of a generated one (host, process and a random suffix) |

Related commands: `python manage.py studio_worker_health [--max-age SECONDS]` (section 5) and
`python manage.py studio_run_batch [--id UUID]`, which runs queued and stalled batches once in its
own process through the same claim path and prints `<id> <STATUS> produced=n/m`.

## 2. Local development

```bash
make up                                   # PostgreSQL in Docker
make migrate                              # applies question_studio 0002 among others
export DATABASE_URL=...                   # the value from your .env, as make passes it
export LAI_AI_PROVIDER=fake               # sample questions, no AWS
LAI_STUDIO_RUN_MODE=worker make runserver # Admin queues batches only
# second terminal, same DATABASE_URL and LAI_AI_PROVIDER:
cd lai && LAI_STUDIO_RUN_MODE=worker python manage.py studio_worker
```

Stop it with Ctrl+C: the chunk in flight finishes, the batch is released and the process exits 0.
`python manage.py studio_worker --once` drains the queue and exits, which is handy in a test or a
shell session. Without a worker, the base default `thread` mode still runs a batch inside
`runserver` through the same claim and lease, and `studio_run_batch` runs queued batches once.

## 3. Production

- **Enabling it** is part of a normal release: `scripts/aws/deploy-django.sh` brings every compose
  service up with `--wait`, so the first release that contains the `studio-worker` service starts
  it and waits for its health check. No separate step, but the release itself is an owner-approved
  action. Migration `question_studio/0002_job_queue` runs in the release's migrate stage before
  the services start (it is additive, plus a reversible status rename).
- **Settings** are SSM parameters under `/lai/<env>/django/` (DJANGO_EC2_DEPLOYMENT.md section 4.3,
  "any `LAI_*`"); the worker reads the same `django.env` as the API. A configuration change is a
  redeploy of the running commit.
- **Rollback** to a release without the service removes it (`--remove-orphans`). Running batches
  stay RUNNING with an expiring lease and are recovered when a worker returns; until then
  `studio_run_batch` can run them. Rolling the migration back is not automatic and needs owner
  review (`0002` reverses cleanly: `SUCCEEDED` to `COMPLETED`, `PARTIALLY_FAILED` to `PARTIAL`,
  `CANCELLED` to `FAILED`).

## 4. Configuration and bounded throughput

| Lever | Setting (default) | Notes |
|---|---|---|
| Threads per worker | `LAI_STUDIO_WORKER_CONCURRENCY` (1), `--concurrency` | 1 to 8. Each thread holds one database connection while it works |
| Batches running at once, all workers | `LAI_STUDIO_MAX_RUNNING_BATCHES` (2) | 1 to 20. Enforced at claim time under an advisory lock |
| Questions per model call | `LAI_STUDIO_CHUNK_SIZE` (5) | Also the most a crash can cost |
| Attempts per chunk | `LAI_STUDIO_MAX_ATTEMPTS` (2) | On top of the adapter's own `LAI_AI_MAX_ATTEMPTS` inside one call |
| Retry delay | `LAI_STUDIO_RETRY_BACKOFF_SECONDS` (30), `_MAX_SECONDS` (900) | base * 2^(attempt - 1), capped |
| Staff retries per batch | `LAI_STUDIO_MAX_BATCH_RETRIES` (3) | 0 to 10 |
| Lease, heartbeat | `LAI_STUDIO_LEASE_SECONDS` (300), `LAI_STUDIO_HEARTBEAT_SECONDS` (30) | Lease at least 3 heartbeats and twice `LAI_STUDIO_TIMEOUT_SECONDS`; Django refuses to start otherwise |
| Per-call timeout | `LAI_STUDIO_TIMEOUT_SECONDS` (60) | A chunk can take up to this times the adapter's attempts, hence the 150 s stop grace period |
| Quotas | `StudioLimits` row in Admin | Batch size 25, 10 batches per user per day, 200 questions and 200,000 tokens per day by default |
| Kill switch | ADR-044 `AIServiceControl` in Admin, or `StudioLimits.generation_enabled` | Checked before every chunk; remaining chunks fail as `KILL_SWITCH` or `GENERATION_DISABLED` |

With the defaults one worker runs one batch at a time and at most two run across workers. Raise
concurrency only after LAI-AQS-025 has measured real Bedrock latency and cost, and check the
instance's memory and the Bedrock quota first.

## 5. Health diagnostics

Commands with `docker compose -p lai` run on the instance through Session Manager, as root
(`sudo`), as in DJANGO_EC2_DEPLOYMENT.md section 7.

- **Command.** On the instance:
  `docker compose -p lai exec studio-worker python manage.py studio_worker_health`
  (or the same through `django`). It prints the live workers, queue counts (queued, running,
  waiting to retry, stalled) and the oldest queued batch's age. Exit 1 means work is queued or
  stalled but no worker has checked in within `--max-age` (default 120 s); exit 0 otherwise.
- **Container health.** `docker compose -p lai ps studio-worker` shows `healthy` while the heartbeat
  file is younger than 300 s. `scripts/aws/ssm-run.sh <env> status` lists every container.
- **Admin.** Generation batches: the display state (Running, Stalled, Waiting to retry, Waiting for
  a worker, Cancelling), progress, chunks, lease owner, expiry and last heartbeat. **Studio
  workers** (`view_studioworker`): each worker's state, last check-in, current batch, counters and
  an alive flag.
- **Logs.** `scripts/aws/view-logs.sh <env> app --since 30m` reads the Django log group, which
  includes the `studio-worker-<git sha>` stream. Queue lines start `studio.queue event=`:
  `submitted`, `claimed`, `recovered`, `parked`, `chunk`, `finished`, `released`, `lease_lost`,
  `cancel`, `retry`, `internal_error`.

## 6. Common situations

**A batch stays Queued.** No worker is claiming. Run `studio_worker_health`; if it exits 1, check
`docker compose -p lai ps studio-worker` and the worker's log stream, then
`docker compose -p lai restart studio-worker`. Also check whether two batches are already running
(the running cap) and whether `LAI_STUDIO_RUN_MODE` is `manual` (then nothing claims
automatically; run `studio_run_batch`).

**A batch shows Stalled.** Its worker stopped without releasing it (killed, out of memory,
instance restart). Nothing to do if a worker is alive: the next claim after the lease expiry (at
most 5 minutes) recovers it and re-runs only the chunk that was in flight. If no worker is alive,
restart the worker. Do not edit the row by hand.

**A batch shows Waiting to retry.** A chunk hit a retryable failure (timeout, throttling,
unavailable, bad shape) and waits for its backoff. It resumes on its own. Repeated throttling means
the Bedrock quota or concurrency is too high for the account; lower `LAI_STUDIO_MAX_RUNNING_BATCHES`.

**A batch shows Waiting for a worker.** A worker released it during a graceful stop. Any worker
claims it next; if none is running, start one.

**Chunks fail with `WORKER_LOST`.** A chunk crashed its worker on every attempt. Look for
`internal_error` or container restarts (`OOMKilled` in `docker inspect`) around the `recovered`
lines. Check instance memory before raising concurrency again. Staff can retry the failed chunks
once the cause is fixed.

**Kill switch.** Turn model calls off in Admin (`AIServiceControl`, or `StudioLimits`
generation off). Running batches stop before their next chunk and end with the remaining chunks
failed as `KILL_SWITCH` or `GENERATION_DISABLED`; queued batches end the same way when claimed.
After turning calls back on, staff can retry those batches.

**Daily token quota reached.** Remaining chunks fail as `TOKEN_QUOTA`. The quota counts tokens by
the UTC day a batch was created. Retry the batch the next day, or raise the limit in `StudioLimits`
with the owner's agreement.

**Retry a failed batch.** In Admin, open the batch and press "Retry failed chunks" (or use the bulk
action), with `retry_generationbatch`. Only FAILED chunks run again; stored questions are never
duplicated. Refused after `LAI_STUDIO_MAX_BATCH_RETRIES` rounds or when the prompt version changed:
generate a new batch instead.

**Cancel a batch.** "Cancel" (button or bulk action) with `cancel_generationbatch`. Queued and
ownerless batches cancel at once; a running one shows Cancelling and stops before its next chunk.
Drafts already stored stay for review or rejection.

## 7. Safe shutdown and restarts

- `docker compose -p lai stop studio-worker` or `restart studio-worker` sends SIGTERM. The worker
  stops claiming, lets the chunk in flight finish and commit, releases its lease (the batch stays
  RUNNING with no owner and is claimable at once), marks its `StudioWorker` row STOPPED and exits 0.
- The 150 s grace period covers one chunk call with the adapter's retries. If Docker has to kill
  it after that, the result is the same as a hard kill below.
- A hard kill (SIGKILL, out of memory, instance loss) loses at most the chunk in flight: its model
  call and tokens, never a committed question. The lease expires after `LAI_STUDIO_LEASE_SECONDS`
  and the next claim recovers the batch, returning that chunk to pending with its attempt counted.
- Releases and rollbacks restart the worker like any other service; no drain step is needed.

## 8. What is never logged or stored

Worker logs, `last_error` and the `StudioWorker` rows hold ids, host name, process id, counts,
statuses, failure categories and timestamps only. Never a prompt, staff notes, model output, an
exception message, credentials or any child data (ADR-025). `last_error` is always one of the fixed
messages in `docs/AI_QUESTION_STUDIO.md` section 14.9. A bug is logged as its exception type only
(`event=internal_error type=...`).

## 9. Owner acceptance checklist (LAI-AQS-027)

- [ ] ADR-052 accepted (or changed) by the owner.
- [ ] A release containing the `studio-worker` service is approved and deployed to a nonproduction
      environment; `docker compose -p lai ps` shows it healthy.
- [ ] `studio_worker_health` exits 0 with the worker up and 1 after `docker compose stop
      studio-worker` with a batch queued.
- [ ] A batch generated in Admin finishes as Succeeded with the worker running (fake provider, or
      live Bedrock once LAI-AQS-025 is approved).
- [ ] Kill test: during a multi-chunk batch, `docker kill --signal KILL` the worker container. Admin
      shows Stalled; after the lease expiry the restarted worker recovers it (`event=recovered`), the
      batch finishes, and no chunk slot holds two questions.
- [ ] Graceful test: `docker compose restart studio-worker` mid-batch; the chunk in flight commits,
      `event=released` is logged, and the batch continues without a Stalled period.
- [ ] Cancel and "Retry failed chunks" work from Admin with the right permissions and are refused
      without them.
- [ ] The worker's log stream contains no prompt, notes, model output or exception message.
- [ ] Instance memory with the worker running stays within the alarm thresholds
      (DJANGO_EC2_DEPLOYMENT.md section 11).
