# Processing operations

**Nothing on this page is deployed or provisioned.** No queue, DLQ, Lambda function, alarm,
schedule or setting described here exists in `infra/` or AWS at the time of writing. This is the
operating design that LAI-LAMBDA-004 (Django), LAI-LAMBDA-005 (infrastructure,
[card](https://trello.com/c/cgbkYzMc)) and LAI-LAMBDA-006 (enqueue, poison jobs, replay,
stopped-host backlog, [card](https://trello.com/c/SYUqyvWM)) implement. Values marked
"recommended" are proposals for owner approval.

## 1. What runs where

| Piece | Runs on | Needs | Keeps working when EC2 and RDS are stopped |
|---|---|---|---|
| Outbox dispatcher | Django host (management command or systemd service) | RDS, SQS | No (and nothing new is created then) |
| Work queue + DLQ | SQS | nothing | Yes: holds messages |
| Worker | Lambda (container image from ECR, built off-host) | S3, SQS | **Yes**: it needs only S3 and SQS |
| Completion queue + DLQ | SQS | nothing | Yes: completions accumulate |
| Completion consumer | Django host (management command or systemd service) | RDS, SQS | No; drains the backlog on startup |

There is no Docker requirement on EC2 for any of this: the worker image is built in GitHub
Actions and pushed to ECR (cards 005 and 012). The small EC2 instance is not a heavy-processing
fallback (card 012); runs longer than 15 minutes go to the ECS Fargate fallback (card 010).

## 2. Queue settings (recommended)

| Setting | Work queue | Completion queue | Why |
|---|---|---|---|
| Type | Standard | Standard | At-least-once is designed for; FIFO adds nothing the idempotency rules do not already give |
| Message retention | 14 days (SQS maximum) | 14 days | Survives an overnight stop with a wide margin, and a long weekend or an outage |
| Visibility timeout | at least 6 x the Lambda timeout (for 900 s: 5,400 s) | longer than the consumer's worst-case transaction, e.g. 300 s | 6x is the AWS guidance for Lambda event source mappings; the consumer value is a starting point |
| Max message size | 256 KiB (contracts stay at or below 240 KiB) | same | `DEFAULT_MAX_MESSAGE_BYTES` |
| DLQ | yes, `maxReceiveCount` 5 | yes, `maxReceiveCount` 5 | Poison messages stop cycling |
| DLQ retention | 14 days | 14 days | Time to diagnose and replay |
| Encryption | SSE (SQS-managed) | SSE | |
| Queue policy | Send: Django role only. Receive/delete: worker role | Send: worker role only. Receive/delete: Django role | Forged messages (`SECURITY.md`) |
| Long polling | (event source mapping) | `WaitTimeSeconds` 20 | Fewer empty receives |

Lambda event source mapping (recommended): batch size 1 to start (one job per invocation keeps
the time budget simple); `ReportBatchItemFailures` enabled so a failing record in a larger batch
is retried alone (card 005); **reserved concurrency** set low for dev (for example 2) to cap cost
and protect S3 request rates; timeout 900 s; memory and ephemeral storage sized above
`PLATFORM_CEILINGS` (temporary bytes up to 10 GiB) per processor need, measured in 002.

## 3. Overnight shutdown (00:00 to 08:00 Pacific) and manual stop/start

The owner's target allows the dev environment to stop EC2 and RDS overnight. **No schedule
exists in IaC today**; adding one (for example EventBridge Scheduler or an SSM Automation) is an
approval item for 005.

What happens during a stop:

1. Django is down, so no new jobs are created and no outbox rows are sent.
2. Work messages already queued keep being processed by Lambda; it needs only S3 and SQS.
3. Each finished attempt sends a completion event. Events accumulate in the completion queue
   (retention 14 days, well above 8 hours).
4. On start, the completion consumer drains the backlog. Application is idempotent, so a
   message delivered twice, or a message whose processing was interrupted by the stop, is safe.
5. The dispatcher sends any outbox rows committed before the stop but not yet sent.

### Graceful shutdown order

1. Pause dispatch (`LAI_PROCESSING_DISPATCH=paused`, section 4) so no new work leaves.
2. Let the completion consumer drain what is visible (optional: completions are durable anyway).
3. Stop the consumer and dispatcher services, then gunicorn, then EC2 and RDS.

### Startup order

1. RDS, then EC2 and Django.
2. Consumer service starts and drains the completion queue.
3. Dispatcher resumes (`enabled`).
4. Reconciliation (004, "lease/reconciliation") finds jobs `QUEUED` past their expiry or lease
   and fails or re-queues them per policy.

## 4. Dispatch controls per environment (proposed)

| Control | Values | Effect |
|---|---|---|
| `LAI_PROCESSING_DISPATCH` (Django setting, proposed name) | `enabled` | Outbox rows are sent |
| | `paused` | Jobs are created and outbox rows written, but not sent; resume sends them |
| | `disabled` | New processing jobs are refused; the existing synchronous Asset Library path stays the only path |
| Lambda event source mapping | enabled / disabled | Disabled: work messages wait in the queue (up to retention) |
| Reserved concurrency 0 | | Emergency stop for the worker |

The default for an environment without queues is `disabled`. The existing synchronous upload and
validation (`lai/apps/assets/services.py`) keeps working in every mode.

## 5. Job expiry

Each request may carry `expires_at`. Recommended: Django sets it on every attempt, shorter than
queue retention (for example 72 hours; owner choice). A worker refuses an expired request with
`job_expired` (permanent), so a job that waited through a long outage is not processed against
stale assumptions. Staff re-queue an expired job from Django Admin; that creates a new attempt
with a new expiry.

## 6. When RDS is unavailable

The consumer opens a transaction per event. If the database is unreachable, the transaction
fails and the consumer **releases** the message with a backoff delay (it never acks before a
commit). Repeated failures raise the receive count; the backoff should keep a long outage from
pushing healthy messages into the DLQ (for example by stopping the consumer loop after
consecutive database errors rather than cycling messages). Messages that still reach the DLQ are
replayed after recovery (section 7).

## 7. Replay from a DLQ

| DLQ | Typical cause | Procedure |
|---|---|---|
| Work DLQ | Worker crash or timeout five times; undecodable message | Diagnose from logs (closed telemetry fields only). If the cause was transient, redrive to the source queue (SQS redrive). If the job needs a fresh attempt (expired, or the input changed), **re-queue from Django Admin instead**: a new attempt id, new artifact keys, new outbox row. A redriven old attempt that Django has since superseded is simply `STALE` on completion |
| Completion DLQ | Consumer bug, decode failure, long database outage | Fix the cause, then redrive. Application is idempotent (`DUPLICATE`, `STALE` and `REJECT` are all safe outcomes). Undecodable events stay for analysis and are deleted only by an operator |

Replay commands and runbooks are delivered by 006 (card: "poison jobs, replay, stopped-host
backlog").

## 8. CloudWatch metrics and alarms (recommended, 005)

| Alarm | Metric | Suggested threshold |
|---|---|---|
| Work backlog age | `ApproximateAgeOfOldestMessage` on the work queue | above 1 hour while Lambda is enabled |
| Completion backlog age | same, completion queue | above 1 hour during working hours (suppressed during the overnight window) |
| Work DLQ not empty | `ApproximateNumberOfMessagesVisible` on the work DLQ | at least 1 |
| Completion DLQ not empty | same, completion DLQ | at least 1 |
| Worker errors | Lambda `Errors` | at least 1 in 15 minutes |
| Worker throttles | Lambda `Throttles` | at least 1 in 15 minutes |
| Worker duration | Lambda `Duration` p95 | above 80% of the timeout |
| `REJECT` decisions | log metric filter on the consumer's `job.rejected` event (name per 004) | at least 1 |

Alarms go to the environment's existing SNS topic `lai-django-alarms-<env>` (defined in
`LaiDjangoEc2-<env>`), referenced by name like the other stacks do. Log groups get an explicit
retention (card 005).

## 9. Cost notes (unverified, check current AWS pricing)

- SQS: billed per request; long polling keeps an idle consumer to roughly three receives a
  minute. Standard-queue request volume for this workload is small.
- Lambda: billed per request and per GB-second; reserved concurrency caps the worst case.
  Ephemeral storage above the 512 MB default is billed extra.
- ECR: storage of image versions; a lifecycle rule should keep a bounded number (card 012 needs
  old digests for rollback, so do not expire those in use).
- No NAT gateway and no VPC endpoints in the preferred option (`SECURITY.md` section 3).
- CloudWatch: alarms and log ingestion; set log retention.
- Stopping EC2 and RDS overnight does not stop SQS or Lambda charges, which are usage based.
