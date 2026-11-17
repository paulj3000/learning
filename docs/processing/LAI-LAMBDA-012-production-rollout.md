# LAI-LAMBDA-012: production rollout plan for background processing

**Status: plan only. Documentation; nothing is built, deployed or approved by this page.**
Prepared 2026-11-17 from the repository at `2333d9e` (`feature/serverless-processing-canonical`).
Depends on LAI-LAMBDA-011 (`LAI-LAMBDA-011-dev-acceptance.md`) passing in dev and on the owner
decisions in section 12. Every AWS, GitHub and database step is owner-run (`CLAUDE.md` sections 14
and 18). No account ids, secrets or credentials appear here; `<account>` is a placeholder.

Read with: ADR-037 (production Django on EC2), ADR-055, ADR-061, ADR-062, ADR-064 in
`../DECISIONS.md`; `CANONICAL_PATH.md`; `ASYNC_MODEL_VALIDATION.md`;
`../platform/DJANGO_EC2_DEPLOYMENT.md`; `../infrastructure/dev-native-environment.md`.

## 1. Summary

Production today has **no background-processing infrastructure in CDK**: no jobs queues, no
dead-letter queues, no Lambda workers, no worker roles, no results bucket or prefix, no jobs
consumer process and no processing alarms. Production Django defaults to
`LAI_JOBS_BACKEND=disabled`, `LAI_STUDIO_RUN_MODE=manual` and `LAI_ASSET_ASYNC_VALIDATION=off`,
and its settings refuse the flag `on` without `LAI_JOBS_BACKEND=sqs`. So the code of this release
is safe to ship to production with everything off, but **turning processing on in production
needs an approved production jobs stack decision (P1) and new infrastructure, consumer and
pipeline work** before any of sections 5 to 11 can be executed.

The recommended path is two production releases:

1. **Release A (code only, processing off).** Ship the canonical release through the existing
   manual production path (`deploy-django-ec2.yml`, environment `prod`). Migration `jobs/0003`
   applies; nothing is sent to SQS because the backend is `disabled`.
2. **Release B (processing on), after P1 to P12 are decided and built.** Provision the production
   queues, workers and consumer, then switch `LAI_JOBS_BACKEND=sqs`, and only later
   `LAI_ASSET_ASYNC_VALIDATION=on`.

## 2. What production has today (inspected in `infra/`)

| Area | Production (`LAI_ENV=prod`) | Source |
|---|---|---|
| Stacks synthesized | `LaiAssetStorage-prod`, `LaiChildPhotos-prod`, `LaiDjangoRelease`, `LaiDjangoEc2-prod`, `LaiAiGuardrail-prod`, `LaiFrontend-prod` | `infra/bin/app.ts`: `DevArtifactsStack` and `DevPlatformStack` only `if (envName === 'dev')` |
| Django runtime | Docker Compose on one x86_64 EC2 (`InstanceType` default `t3.medium`), image from ECR by digest, ALB with ACM, WAF rate rule on the admin login | `infra/lib/djangoEc2Stack.ts`, `deploy/ec2/docker-compose.yml` (services `django`, `proxy`, and `db` only in the dev `container-db` profile) |
| Database | RDS PostgreSQL 16 `lai-django-prod`, `t4g.micro` default, **Single-AZ unless `LAI_DB_MULTI_AZ=true`**, 14-day backups, deletion protection, TLS forced, pre-migration snapshot before releases with migrations (`premigrationSnapshot` defaults to prod) | `djangoEc2Stack.ts` |
| Instance role `lai-django-ec2-prod` | SSM core, ECR pull, `/lai/prod/django/*` settings, logs, metrics, the asset and child-photo managed policies by name; **no SQS, no Lambda, no results bucket** | `djangoEc2Stack.ts` |
| Asset bucket | `lai-assets-prod-<account>-<region>`, versioned, `assets/models|images|audio/` prefixes; Django policy `lai-django-asset-storage-prod` already has `s3:ListBucket` (no prefix condition) | `infra/lib/assetStorageStack.ts` |
| Runtime settings written by the stack | Hosts, Cognito, asset and child-photo buckets; **no `LAI_JOBS_*`** | `djangoEc2Stack.ts` `settings` |
| Production settings | `LAI_JOBS_BACKEND` default `disabled` (only `sqs` or `disabled`); `LAI_STUDIO_RUN_MODE` default `manual` (only `jobs` or `manual`); `LAI_ASSET_ASYNC_VALIDATION=on` refused unless `LAI_JOBS_BACKEND=sqs` | `lai/config/settings/production.py` |
| Image | Ships `processing/lai_processing` beside `lai/` | `lai/Dockerfile` |
| Alarms | `lai-django-prod-*`: not-ready, target 5xx, memory, disk, system status, database storage; topic `lai-django-alarms-prod` | `djangoEc2Stack.ts`, `DJANGO_EC2_DEPLOYMENT.md` section 11 |
| Scheduled maintenance | **None in production** (no `jobs_sweep`, `speech_cleanup` or `ai_retention` timer; dev has `lai-maintenance.timer`) | `scripts/aws/setup-ec2.sh`, `scripts/aws/native/setup-native.sh` |
| Release pipeline | `deploy-django-ec2.yml`: prod only by manual dispatch while native dev is enabled (the push path needs the Docker dev job), `django-prod` environment with required reviewers | workflow header and `deploy-prod` condition |
| Deployed? | The repository records no production deployment (`CLAUDE.md` section 18: Django deployments are still owner approvals). Verify read-only before planning (section 4) | |

## 3. Discrepancies to resolve before Release B

| # | Discrepancy | Consequence | Decision |
|---|---|---|---|
| D1 | **Production has no jobs queues, DLQs or Lambda workers in CDK.** The canonical path (ADR-064) exists only in `LaiDevPlatform-dev`, which is dev-only | LAI-LAMBDA-012 cannot turn processing on. It needs an approved production jobs stack decision | P1 |
| D2 | **No production results bucket or worker-code bucket.** `LaiDevArtifacts-dev` (worker zips under `lambda/`, results under `jobs/results/`) is dev-only; `LAI_JOBS_BACKEND=sqs` requires `LAI_JOBS_RESULTS_BUCKET` | Need a production bucket (or prefixes in an existing one) with lifecycle rules | P2 |
| D3 | **No production consumer.** `jobs_consume_results` runs as the dev systemd unit `lai-jobs-consumer`; `deploy/ec2/docker-compose.yml` has no consumer service | Results would never be applied; the outbox relay (inside the consumer) would never re-send | P3 |
| D4 | **No production maintenance schedule.** `jobs_sweep` (stale timeouts, retention), `speech_cleanup`, `ai_retention` have no timer in production | Stuck jobs are never failed; completed jobs are never pruned (retention in section 9 would not apply) | P4 |
| D5 | **"Reserved concurrency 5 in prod" (ADR-062) is not implemented anywhere.** Its names (`processingReservedConcurrency`, `LAI_PROCESSING_RESERVED_CONCURRENCY`) belonged to the superseded `LaiProcessing-<env>` stack. Dev limits concurrency with the SQS event source mapping's `MaximumConcurrency` (`LambdaConcurrencyLimit`, default 2, minimum 2) and sets **no** reserved concurrency | The owner's number stands, the mechanism does not exist; see section 10 | P5 |
| D6 | **No production worker deploy pipeline.** `deploy-dev-lambda.yml` and `dev-release.sh lambda-deploy` are dev-only (`lib-dev.sh` refuses any name containing `prod`; environment `dev-backend`). The prod deploy role `lai-github-deploy-prod` may only send the release SSM documents | A prod worker update path must be designed (section 7) | P6 |
| D7 | **Production instance role has no SQS permissions** | Django cannot submit or consume | Part of P1 |
| D8 | **Namespace.** `apps.assets.processing.namespace()` uses `LAI_ENVIRONMENT`, else `local`; dev does not render it (dev jobs use `local`). Production does not set it either | Idempotency keys and requests would say `local` in production | P7 |
| D9 | **Runtime architecture differs.** Production Django is x86_64 Docker; workers are arm64 zips. The zip is pure Python (vendored `jobs_core`, AI providers, `lai_processing`), so this is fine, but dev acceptance does not exercise the production container path (ADR-055 consequences) | Production needs its own acceptance (section 11) | none |
| D10 | **Doc inconsistency.** `dev-native-environment.md` section 2 lists production async work as "in-process (Studio `thread` mode)", but `production.py` refuses `thread` (only `jobs` or `manual`) | Correct that table when this plan is adopted | none (doc fix) |
| D11 | **Results expiry shorter than queue retention (dev).** `jobs/results/` expires after 7 days; the results queue keeps 14 days. A result over 200 KB queued longer than 7 days points at a deleted object | Production should keep result objects at least as long as the results queue | Part of P2 |
| D12 | **90-day validation-job retention and the configurable GLB limit** are not on `2333d9e` (sibling branches `fix/can-retry-retention`, `fix/can-limits`); the media role `s3:ListBucket` is not either (`fix/can-s3-missing`) | Release A must contain them before production | Merge order |

## 4. Read-only facts to collect first (owner)

```bash
# [OWNER, READ-ONLY] production account and Region; never paste the account id
export AWS_REGION=us-west-1 AWS_PAGER=""
aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName,'Lai')].{Name:StackName,Status:StackStatus}" --output table
aws cloudformation describe-stacks --stack-name LaiDjangoEc2-prod --query 'Stacks[0].Outputs' --output table 2>&1 | sed -E 's/[0-9]{12}/<account>/g'
aws sqs list-queues --queue-name-prefix lai-prod- --output json          # expected: none
aws lambda list-functions --query "Functions[?starts_with(FunctionName,'lai-prod-')].FunctionName"   # expected: []
aws rds describe-db-instances --db-instance-identifier lai-django-prod --query 'DBInstances[0].{Class:DBInstanceClass,MultiAZ:MultiAZ,Status:DBInstanceStatus}'
aws lambda get-account-settings --query 'AccountLimit.{Concurrent:ConcurrentExecutions,Unreserved:UnreservedConcurrentExecutions}'
gh variable list --repo paulj3000/learning
gh api repos/paulj3000/learning/environments/django-prod --jq '{protection_rules: [.protection_rules[]?.type], deployment_branch_policy}'
```

Record whether `LaiDjangoEc2-prod` exists at all; if it does not, production provisioning
(`DJANGO_EC2_DEPLOYMENT.md` section 5.12) comes before anything here.

## 4a. Release A: ship the code with processing off

| Step | Command (owner) | Pass |
|---|---|---|
| A-1 Dev acceptance | LAI-LAMBDA-011 accepted | Section 14 of that page complete |
| A-2 Gates | Section 1 of LAI-LAMBDA-011; `LAI_PROD_AUTO_DEPLOY` not `true` | Merge deploys nothing |
| A-3 Settings | `aws ssm get-parameters-by-path --path /lai/prod/django --query 'Parameters[].Name'`; confirm `LAI_JOBS_BACKEND`, `LAI_ASSET_ASYNC_VALIDATION`, `LAI_STUDIO_RUN_MODE` are absent or `disabled`/`off`/`manual` | Processing stays off |
| A-4 Release | `gh workflow run deploy-django-ec2.yml --repo paulj3000/learning --ref main -f environment=prod -f action=deploy`; a `django-prod` reviewer approves | Pre-migration snapshot taken; `jobs/0003` applied; health green |
| A-5 Verify | `scripts/aws/ssm-run.sh prod status`; `scripts/aws/ssm-run.sh prod bootstrap check` | Release healthy; no jobs created (with the backend `disabled`, `services.submit` refuses with `JobsDisabled`, so background actions are refused and nothing reaches AWS) |

Release A's rollback caveat is the same as dev (LAI-LAMBDA-011 section 11.3): after `0003`, code
from before it cannot insert `ProcessingJob` rows. With the backend `disabled` in production no
code path inserts jobs, so a production rollback past `0003` is safe **while processing is off**.

## 5. Production configuration and the flag (Release B)

Set as SSM parameters under `/lai/prod/django/` (the release refuses unknown names; `LAI_*` is
accepted) and applied by a release or a redeploy of the running commit:

| Setting | Production value | Notes |
|---|---|---|
| `LAI_JOBS_BACKEND` | `sqs` | Production refuses `inline`; requires the four values below |
| `LAI_JOBS_AI_QUEUE_URL`, `LAI_JOBS_MEDIA_QUEUE_URL`, `LAI_JOBS_RESULTS_QUEUE_URL` | From the P1 stack outputs | Validated as `https://sqs.<region>.amazonaws.com/<account>/<name>` |
| `LAI_JOBS_RESULTS_BUCKET` | From P2 | |
| `LAI_JOBS_STALE_MINUTES` | 60 (default) | Production is always on; no overnight stop |
| `LAI_JOBS_RETENTION_DAYS` | 30 (default) | Plus the 90-day validation rule (section 9) |
| `LAI_ENVIRONMENT` | `prod` (P7) | Namespace of contract requests; also the dev-bootstrap guard |
| `LAI_STUDIO_RUN_MODE` | stays `manual` until the owner moves Studio to `jobs` | Separate decision |
| `LAI_ASSET_ASYNC_VALIDATION` | `off` at first; `on` only after section 11 passes (P8) | Default off in every environment (ADR-062) |
| `LAI_ASSET_MAX_GLB_BYTES` | 52,428,800 (default, 50 MiB) | Ceiling is the `glb-default` profile limit; raising it needs a new profile version |

Turning processing on in stages: (1) backend `sqs` with only the Admin actions ("Inspect in
background", "Validate in background") used by named staff; (2) speech pre-generation follows
automatically with `sqs`; (3) the flag `on`; (4) Studio `jobs` (separate approval).

## 6. Canonical queue ownership (P1)

ADR-064 allows one job table, one consumer, one queue family and one infrastructure stack per
environment. For production that means the `lai-prod-*` queue family is owned by **one**
production platform stack; a separate `LaiProcessing-prod` stack is the superseded ADR-062 plan
and must not return (`tests/repo/test_canonical_processing_guard.py`).

| Option | What | For | Against |
|---|---|---|---|
| **P1-a (recommended)** | Extend `LaiDjangoEc2-prod` with the queues, DLQs, both workers, their roles and the DLQ alarms, by factoring the dev `queue()`/`workerRole()`/`worker()` code in `devPlatformStack.ts` into a construct both stacks use | One stack per environment, as in dev; the instance role and the queues change together; reuses tested code | Larger change to the production stack; every queue change is a prod stack update with change-set review |
| P1-b | A production-only jobs stack consumed by `LaiDjangoEc2-prod` through managed policies attached by name | Smaller blast radius per update | A second stack per environment, close to the superseded pattern; needs its own ADR |

Names (convention `lai-<env>-*`, ADR-064): `lai-prod-jobs-ai`, `lai-prod-jobs-media`,
`lai-prod-job-results`, each with `-dlq`; functions `lai-prod-jobs-ai`, `lai-prod-jobs-media`;
roles `lai-prod-jobs-ai-worker`, `lai-prod-jobs-media-worker`. Queue settings as dev unless P5
changes them: work queues visibility 6 x function timeout, retention 4 days, DLQ after 3
receives; results visibility 300 s, retention 14 days, DLQ after 5 receives; DLQs 14 days; SSE;
TLS-only queue policies.

## 7. Worker packaging and deployment (P6)

- Same artifact as dev: `scripts/aws/package-lambda.sh` builds the deterministic
  `jobs-worker-<hash16>.zip` from the release commit (`lambda/build.py`, vendored `jobs_core`, the
  Bedrock adapter and `lai_processing`, size budget 2 MiB). No container image, no ECR for workers
  (ADR-064 decision 9).
- Stored under `lambda/` in the P2 bucket with a create-only write (as `dev-release.sh` does with
  `If-None-Match`), kept at least 180 days for rollback.
- Deployment options (pick one):
  - **P6-a (recommended):** a `deploy-workers` job in `deploy-django-ec2.yml`, environment
    `django-prod` (existing, required reviewers), gated by `LAI_DEPLOY_ENABLED`, running after the
    Django `deploy-prod` job (consumer first). The `lai-github-deploy-prod` role gains
    `s3:PutObject` on `lambda/*` and `lambda:UpdateFunctionCode`/`GetFunction` on the two prod
    functions only.
  - P6-b: the stack's worker-code parameter updated by `scripts/aws/provision.sh prod` (change-set
    review, slower, couples code and infrastructure as `deploy-debug.sh` does in dev).
- No `processing-prod` GitHub environment and no `LAI_PROCESSING_*` variables (superseded).

## 8. IAM (production)

| Principal | Allowed | Never |
|---|---|---|
| Instance role `lai-django-ec2-prod` | `sqs:SendMessage`, `GetQueueAttributes` on the two work queues; `ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`, `GetQueueAttributes` on the results queue; `s3:GetObject` (and `ListBucket` scoped) on the results prefix | Send to the results queue; read DLQs; start message moves |
| `lai-prod-jobs-media-worker` | Its work queue; send to the results queue; `GetObject`/`PutObject` on `jobs/results/*`; `GetObject` on the asset bucket; **`s3:ListBucket` on the asset bucket** (the dev fix, so a missing object is 404 and `input_missing`); Polly and the speech prefix if speech moves to prod workers | Write or delete assets; any database, secret or VPC access |
| `lai-prod-jobs-ai-worker` | Its work queue; send results; results prefix; Bedrock invoke on the approved inference profile; `ApplyGuardrail` on the prod Guardrail only; read `LAI_AI_*`/`LAI_STUDIO_*` settings | Same as above |
| GitHub `lai-github-deploy-prod` | Existing release documents; plus (P6-a) worker code update | Queue, DLQ or IAM changes |
| Authorized operations administrators (P9) | `sqs:StartMessageMoveTask`, `ListMessageMoveTasks`, `CancelMessageMoveTask` on the prod DLQs, through a named role or group | Ordinary staff and users, all application roles (ADR-062 B7) |

Lambda stays outside the VPC with no database access (ADR-061 item 4); production keeps one
Region for Bedrock (ADR-064 decision 11: synthesis refuses a different Bedrock Region outside dev).

## 9. Migrations and data retention

- **Migrations:** `jobs/0003_contract_kinds` (constraint replaced, two `NOT NULL` columns without a
  database default; not destructive for the release guard) ships in Release A with the pre-migration
  snapshot. Any Wave 4 jobs migration (`0004_*`) ships the same way, consumer first.
- **Retention:**

| Data | Rule | Where enforced |
|---|---|---|
| Completed `asset.validate_model` jobs | 90 days (owner decision; code pending on `fix/can-retry-retention`) | `jobs_sweep`; needs the P4 schedule in production |
| Other completed jobs | 30 days (`LAI_JOBS_RETENTION_DAYS`) | `jobs_sweep` |
| Failed jobs | Kept for review (the sweep never deletes them) | Decide a cap (P10) |
| Result objects `jobs/results/` | At least 14 days (results queue retention); recommended 30 | P2 bucket lifecycle |
| Worker zips `lambda/` | At least 180 days | P2 bucket lifecycle |
| Queue messages | Work 4 days, results 14 days, DLQs 14 days (from original enqueue) | Queue attributes |
| Logs | Workers and jobs log groups: choose with the production log retention (Django 90 days in prod today) | P1 stack |

A `VALIDATED` GLB whose passing job was pruned is refused by the publication gate until staff run
"Validate in background" again (`ASYNC_MODEL_VALIDATION.md` section 8); the 90-day rule exists to
make that rare.

## 10. Capacity planning (P5)

- **Owner number:** 5 (ADR-062, "Production reserved concurrency is 5 initially and
  configurable"). Open questions: per function or in total, and which mechanism.
- **Recommendation:** set the SQS event source mapping `MaximumConcurrency` to 5 on each worker
  (the dev mechanism, `LambdaConcurrencyLimit`), and, only if capacity must be guaranteed against
  other functions in the account, a reserved concurrency **at least equal** to it. A reserved
  concurrency below the mapping's maximum makes Lambda throttle SQS deliveries, and throttled
  deliveries spend receives: work queues allow only 3 before the DLQ.
- **Downstream limits:** workers never touch RDS, so their concurrency does not consume database
  connections; the single consumer applies results sequentially (batches of up to 10, 20 s long
  poll). Bedrock throughput is bounded by the AI worker's concurrency and Studio's one chunk in
  flight per batch; check the account's Bedrock quotas for the inference profile. Account Lambda
  concurrency: keep at least 100 unreserved (AWS rule) when reserving.
- **Timeouts:** media 120 s with the 90 s request budget; AI 300 s. A model validation is bounded
  by the 50 MiB input limit.
- **Sizing check in dev:** LAI-LAMBDA-011 section 9 records media `Duration` p99 and memory; use it
  to confirm 512 MB.

## 11. Deploy ordering and production acceptance (Release B)

| Step | Action (owner) | Gate |
|---|---|---|
| B-1 | Decisions P1 to P10 recorded (ADR or ADR-064 amendment) | Owner |
| B-2 | Implement and test the P1 stack change, P2 bucket, P3 consumer service, P4 schedule, P6 pipeline on a branch; `npm run infra:synth:prod`; review | Owner review |
| B-3 | `scripts/aws/provision.sh prod` (change sets only), review: queues, DLQs, workers, roles, alarms created; the instance role modified; **no** replacement of EC2, RDS or the ALB | Owner approval |
| B-4 | `scripts/aws/provision.sh prod --execute` | Owner approval |
| B-5 | Django release with the consumer service (P3) and the SSM settings of section 5, `LAI_JOBS_BACKEND=sqs`, flag `off` | `django-prod` reviewers |
| B-6 | Worker zip (P6) | `django-prod` reviewers |
| B-7 | Read-only checks equivalent to LAI-LAMBDA-011 section 2 for `lai-prod-*` | |
| B-8 | One `asset.inspect` and one "Validate in background" on a published synthetic test model: `result_recorded`, nothing changed | |
| B-9 | Flag `on` (P8), one synthetic upload: `DRAFT`, `VALIDATED`, explicit publish; then retire the test asset | Owner approval |
| B-10 | Monitor for one week (section 12a) before Studio `jobs` is considered | |

No RDS outage drill, DLQ drill or ESM toggling in production unless the owner approves a
maintenance window; dev acceptance covers the behaviour.

## 12a. Monitoring (production)

- Alarms to `lai-django-alarms-prod`: one per DLQ on its first message (as dev); additionally
  recommended for production: results queue `ApproximateAgeOfOldestMessage` above 15 minutes,
  Lambda `Errors` above 0 for 10 minutes and `Throttles` above 0 per worker, and the existing
  `not-ready` alarm (the consumer cannot apply while Django's database is down).
- Logs: `/aws/lambda/lai-prod-jobs-*`, the consumer's container log stream in `/lai/prod/django`
  (or its own group, P3), ids and codes only (ADR-025).
- Django Admin, Jobs, Processing jobs, for staff; failed jobs reviewed weekly.

## 12b. Rollback (production)

1. **Flag off**: SSM `LAI_ASSET_ASYNC_VALIDATION=off`, redeploy the running commit.
2. **Processing off**: `LAI_JOBS_BACKEND=disabled`, redeploy. Results already queued stay in the
   results queue (14 days); turn the backend back on to apply them, or accept their loss.
3. **Worker**: point both functions at the previous zip (`aws lambda update-function-code
   --s3-key lambda/jobs-worker-<previous>.zip`), or the P6 job with an older commit.
4. **Django**: `gh workflow run deploy-django-ec2.yml --repo paulj3000/learning --ref main -f environment=prod -f action=rollback [-f rollback_to=<sha>]`
   (`django-prod` approval). Never past `jobs/0003` while processing is on (LAI-LAMBDA-011
   section 11.3); switch processing off first, or roll forward.
5. **Infrastructure**: the queues, workers and roles can stay deployed with the backend
   `disabled`; remove them only by an approved stack update after the queues are empty.

## 12c. Cost assumptions (verify current pricing)

All figures are assumptions for planning, not quotes; check the AWS Pricing Calculator for
us-west-1 before deciding.

| Item | Assumption | Formula |
|---|---|---|
| Lambda (arm64) | Price per GB-second and per million requests as published for us-west-1 (verify current pricing); 512 MB | `invocations x avg duration (s) x 0.5 GB x price` + requests |
| SQS standard | First 1 million requests a month free, then a per-million price (verify) | Consumer idle polling about 3 requests a minute = about 130,000 a month always on, plus 4 to 6 requests per job (send, worker receive and delete, `running` and result sends, consumer receive and delete) |
| S3 results | Small JSON objects, 30-day lifecycle | Storage negligible; PUT/GET per job |
| CloudWatch | Log ingestion per GB and per alarm (verify) | 3 DLQ alarms plus the recommended ones |
| Bedrock, Polly | Unchanged by this plan; bounded by the existing budgets in `LaiAiGuardrail-prod` | |
| Measured baseline | Use the dev measurements of LAI-LAMBDA-011 section 10 as the per-job unit cost | |

Expected order of magnitude at production staff-upload volume: a few dollars a month for Lambda,
SQS and S3 combined; this must be confirmed from dev measurements, not assumed.

## 12d. Operational ownership

| Area | Owner (proposed) |
|---|---|
| Deploy approvals (`django-prod`), flag and backend switches | Project owner |
| DLQ redrive | Named operations administrators only (P9, ADR-062 B7) |
| Failed-job review, resubmission (Admin actions) | Staff with asset upload and view permissions |
| Alarm response | Alarm e-mail recipient (`AlarmEmail`), escalating to the owner |
| Cost review | Owner, monthly, from the budget and Cost Explorer |

## 13. Owner decisions required

| # | Decision | Blocks |
|---|---|---|
| P1 | Production jobs infrastructure: extend `LaiDjangoEc2-prod` (recommended) or a separate stack with its own ADR | Release B |
| P2 | Production bucket for worker zips and `jobs/results/` (new bucket or prefixes), with lifecycle (results at least 14 days, zips at least 180) | Release B |
| P3 | Production consumer: a Compose service running `python manage.py jobs_consume_results` from the same image (recommended), its restart policy and log group | Release B |
| P4 | Production maintenance schedule for `jobs_sweep` (and `speech_cleanup`, `ai_retention` report) | Retention, stale-job handling |
| P5 | Concurrency: "5" per function or total; event source `MaximumConcurrency` and whether to add reserved concurrency (at least equal) | Release B |
| P6 | Worker deployment path in production (job in `deploy-django-ec2.yml` under `django-prod`, recommended) and the deploy role's added permissions | Release B |
| P7 | `LAI_ENVIRONMENT=prod` as the processing namespace | Release B |
| P8 | When to switch `LAI_ASSET_ASYNC_VALIDATION=on` in production | Flag on |
| P9 | Who may redrive production DLQs, and through which role or group | Release B |
| P10 | Failed-job retention cap and log retention for the new groups | Release B |
| P11 | Whether Multi-AZ RDS is wanted before production processing (the consumer tolerates outages, but a single-AZ failover still pauses applications) | Optional |
| P12 | Studio `LAI_STUDIO_RUN_MODE=jobs` in production (separate from this rollout) | Optional |
| P13 | Every deployment and provisioning step above (ADR-019 G7) | All |
