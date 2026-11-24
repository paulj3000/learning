# LAI-LAMBDA-012: production rollout plan for background processing

**Status: plan; infrastructure code implemented (ADR-071, 2026-11-18, section 3a), nothing
deployed.** Owner approvals RELEASE and PRODUCTION (code only) of 2026-11-18 are in force.
Reconciled 2026-11-17 against the Wave 4 integration head `48c98a1`
(`feature/serverless-processing-wave4`: canonical PR #42 plus the Wave 4 kinds), the production
CDK in `infra/`, the workflows in `.github/workflows/` and the scripts in `scripts/aws/`. Depends
on LAI-LAMBDA-011 (`LAI-LAMBDA-011-dev-acceptance.md`) Tier 1 passing in dev and on the owner
decisions in section 13. Every AWS, GitHub and database step is owner-run (`CLAUDE.md` sections 14
and 18). No account ids, secrets or credentials appear here; `<account>` is a placeholder. The
code wins over this page.

Read with: ADR-037 (production Django on EC2), ADR-055, ADR-061, ADR-062, ADR-064 in
`../DECISIONS.md`; `CANONICAL_PATH.md`; `ASYNC_MODEL_VALIDATION.md`; `WAVE4_HANDOFF.md`;
`../platform/DJANGO_EC2_DEPLOYMENT.md`; `../infrastructure/dev-native-environment.md`.

## 1. Summary

Production today has **no background-processing infrastructure in CDK**: no jobs queues, no
dead-letter queues, no Lambda workers, no worker roles, no results bucket or prefix, no jobs
consumer process, no maintenance schedule and no processing alarms. Production Django defaults to
`LAI_JOBS_BACKEND=disabled`, `LAI_STUDIO_RUN_MODE=manual` and `LAI_ASSET_ASYNC_VALIDATION=off`,
and its settings refuse the flag `on` without `LAI_JOBS_BACKEND=sqs`. So the code of this release
is safe to ship to production with everything off, but **turning processing on in production
needs approved decisions (P1 to P15) and new infrastructure, consumer and pipeline work** before
sections 5 to 11 can be executed.

**Dev cannot be copied to production.** Section 3 lists, row by row, what dev has that production
lacks or does differently (runtime, queue ownership, packaging, IAM, deploy path, schedule,
alarms, retention, budget, gates). Treat every dev value as a proposal to be re-decided, not a
default.

The recommended path is two production releases:

1. **Release A (code only, processing off).** Ship the canonical release (and, if P14 says so,
   the Wave 4 kinds) through the existing manual production path (`deploy-django-ec2.yml`,
   environment `django-prod`). Migrations `jobs/0003`, `jobs/0004` and `audio/0005` apply;
   nothing is sent to SQS because the backend is `disabled`.
2. **Release B (processing on), after P1 to P12 are decided and built.** Provision the production
   queues, workers and consumer, then switch `LAI_JOBS_BACKEND=sqs`, and only later
   `LAI_ASSET_ASYNC_VALIDATION=on`.

## 2. What production has today (inspected in `infra/`, workflows and scripts)

| Area | Production (`LAI_ENV=prod`) | Source |
|---|---|---|
| Stacks synthesized | `LaiAssetStorage-prod`, `LaiChildPhotos-prod`, `LaiDjangoRelease` (account-wide), `LaiDjangoEc2-prod`, `LaiAiGuardrail-prod`, `LaiFrontend-prod` | `infra/bin/app.ts`: `DevArtifactsStack` and `DevPlatformStack` only `if (envName === 'dev')`; `npm run infra:synth:prod` |
| Account | **One AWS account shared by dev, prod and other (Amplify) projects**; no separate dev account. Lambda account concurrency, Bedrock quotas and cost are therefore shared with dev and with unrelated workloads | `docs/infrastructure/inventory.md` section 2 |
| Django runtime | Docker Compose on one x86_64 EC2 (`InstanceType` default `t3.medium`), image from ECR by digest, ALB (idle timeout 60 s) with ACM, WAF rate rule on the admin login. Containers are `read_only` with `cap_drop: ALL`, `/tmp` tmpfs 256m | `infra/lib/djangoEc2Stack.ts`, `deploy/ec2/docker-compose.yml` (services `django`, `proxy`; `db` only in the dev `container-db` profile) |
| Upload path | ALB, nginx `client_max_body_size 55m`, then Django's 50 MiB GLB limit (`LAI_ASSET_MAX_GLB_BYTES`) | `deploy/ec2/nginx/default.conf.template` |
| Database | RDS PostgreSQL 16 `lai-django-prod`, `t4g.micro` default, **Single-AZ unless `LAI_DB_MULTI_AZ=true`**, 14-day backups, deletion protection, TLS forced, **pre-migration snapshot** before releases with migrations (`premigrationSnapshot` defaults to prod), database log group 1 month | `djangoEc2Stack.ts`, `deploy-django.sh` step 8 |
| Instance role `lai-django-ec2-prod` | SSM core, ECR pull, `/lai/prod/django/*` settings, logs, metrics, the asset and child-photo managed policies by name; **no SQS, no Lambda, no results bucket** | `djangoEc2Stack.ts` |
| Asset bucket | `lai-assets-prod-<account>-<region>`, versioned, `assets/models|images|audio/` prefixes; Django policy `lai-django-asset-storage-prod` already has `s3:ListBucket` (no prefix condition) | `infra/lib/assetStorageStack.ts` |
| Runtime settings | Rendered from SSM `/lai/prod/django/*` by `scripts/aws/render-env.sh` (allowed: `DJANGO_*`, `COGNITO_*`, `LAI_*`; forbidden: `DJANGO_SETTINGS_MODULE`, `DEBUG`, `AWS_*`). Stack-written values are CDK `StringParameter`s ("change through the stack"); **no `LAI_JOBS_*`**. Unlike dev, `LAI_ENVIRONMENT` is **not** forbidden in production | `render-env.sh`, `djangoEc2Stack.ts` `settings` |
| Production settings | `LAI_JOBS_BACKEND` default `disabled` (only `sqs` or `disabled`); `LAI_STUDIO_RUN_MODE` default `manual` (only `jobs` or `manual`); `LAI_ASSET_ASYNC_VALIDATION=on` refused unless `LAI_JOBS_BACKEND=sqs` | `lai/config/settings/production.py` |
| Image | Ships `processing/lai_processing` beside `lai/` | `lai/Dockerfile` |
| Logs | `/lai/prod/django` 3 months; proxy 1 month; deploy and ssm 1 year | `djangoEc2Stack.ts` |
| Alarms | `lai-django-prod-*`: not-ready, target 5xx, memory, disk, system status, database storage; topic `lai-django-alarms-prod`; Bedrock monthly budget in `LaiAiGuardrail-prod` | `djangoEc2Stack.ts`, `aiGuardrailStack.ts`, `DJANGO_EC2_DEPLOYMENT.md` section 11 |
| Scheduled maintenance | **None in production** (no `jobs_sweep`, `speech_cleanup` or `ai_retention` timer; dev has `lai-maintenance.timer` through `scripts/aws/native/maintenance-native.sh`) | `scripts/aws/setup-ec2.sh`, `deploy/ec2/` |
| Role and content bootstrap | `scripts/aws/bootstrap-django.sh`: `check`, `migrate`, `create-admin`, `ensure-asset-roles`, `load-content`, `seed-treasure-rush`, `import-assets`. **No** `ensure_sound_roles` or `ensure_npc_roles` task (dev's `bootstrap-native.sh ensure-roles` runs every `ensure_*_roles`) | `scripts/aws/bootstrap-django.sh` |
| Release pipeline | `deploy-django-ec2.yml`: prod only by manual dispatch while native dev is enabled; `django-prod` environment with required reviewers; role `lai-github-deploy-prod` sends only the allowlisted SSM documents | workflow header and `deploy-prod` condition |
| Deployed? | The repository records no production deployment (`CLAUDE.md` section 18: Django deployments are still owner approvals). Verify read-only before planning (section 4) | |

### 2.1 Environments and deploy gates (production)

The production path is gated by variables the owner has so far left closed (evidence and exact
checks: `LAI-LAMBDA-011-dev-acceptance.md` section 1, "Deployment gate verification"):

| Gate | Where read | Production effect |
|---|---|---|
| `LAI_DEPLOY_ENABLED` | repository variable; `deploy-django-ec2.yml` `build` | Must be `true` for any Django image to build, including a **manual prod dispatch**. Latest `main` run 44130009375 skipped `build`, `deploy-dev` and `deploy-prod`, so it was not `true` |
| `LAI_DEV_NATIVE_ENABLED` | repository variable | While `true`, `build` runs only for a manual prod dispatch, so a push can never reach prod through `deploy-dev` (a push needs `deploy-dev` to succeed) |
| `LAI_PROD_AUTO_DEPLOY` | repository variable; `deploy-prod` (Django) and `deploy-prod` (site) | Push path only; keep unset or `false`. Production is released by manual dispatch |
| `LAI_SITE_DEPLOY_ENABLED` | repository variable; `deploy-site.yml` | Independent of this plan; keep closed unless the site is released |
| `django-prod` environment | GitHub Settings > Environments | Required reviewers must approve each prod deploy and prod rollback; deployment branches `main`; holds `LAI_DEPLOY_ROLE_ARN` and `LAI_API_BASE_URL` only (environment variables are invisible to job-level `if:`) |
| Prod `rollback` job | `deploy-django-ec2.yml` | **Not** gated by `LAI_DEPLOY_ENABLED` (dispatch only, environment `django-prod`) |

## 3. Dev to production: what cannot be copied, and the gaps

| # | Dev (LAI-LAMBDA-011) | Production today | Gap and decision |
|---|---|---|---|
| D1 | Queues, DLQs, both workers, roles and the three DLQ alarms live in `LaiDevPlatform-dev` (ADR-064) | None in CDK | Needs an approved production jobs stack (P1) |
| D2 | `LaiDevArtifacts-dev` holds worker zips (`lambda/`, 180 days) and results (`jobs/results/`, **7 days**); `LAI_JOBS_RESULTS_BUCKET` points at it | No bucket for either | New bucket or prefixes with lifecycle (P2). Results must live at least as long as the results queue keeps messages (14 days); dev's 7 days is shorter than the queue and is a dev defect, not a template |
| D3 | `jobs_consume_results` runs as systemd unit `lai-jobs-consumer` (`Restart=on-failure`, outbox relay inside) | No consumer; Compose has no such service | A Compose service from the same image (P3) |
| D4 | `lai-maintenance.timer` runs `jobs_sweep`, `speech_cleanup`, `ai_retention` daily | None | Without `jobs_sweep` stuck jobs never fail and completed jobs are never pruned (P4) |
| D5 | Concurrency by the SQS event source mapping `MaximumConcurrency` (`LambdaConcurrencyLimit`, default 2, minimum 2); **no** reserved concurrency | ADR-062's "reserved concurrency 5" is implemented nowhere (its names belonged to the superseded `LaiProcessing-<env>` stack) | The number stands, the mechanism does not exist (P5); the account is shared |
| D6 | Workers deployed by `deploy-dev-lambda.yml` / `dev-release.sh lambda-deploy` (role `LAI_DEV_BACKEND_ROLE_ARN`, environment `dev-backend`); `lib-dev.sh` refuses any name containing `prod` | `lai-github-deploy-prod` may only send the release SSM documents | A prod worker update path must be designed (P6) |
| D7 | Instance role has the SQS and results permissions | `lai-django-ec2-prod` has none | Part of P1 |
| D8 | Namespace `local` (dev's renderer forbids `LAI_ENVIRONMENT`, `render-env-native.sh`) | `render-env.sh` allows it; `apps.assets.processing.namespace()` reads `LAI_ENVIRONMENT`, else `local` | `LAI_ENVIRONMENT=prod` must be set deliberately; dev and prod idempotency keys then differ (P7) |
| D9 | Native ARM64 host, no Docker, wheelhouse tarball | x86_64 Docker, read-only container | Same zip (pure Python) runs on arm64 Lambda either way, but dev acceptance does not exercise the production container path: production needs its own acceptance (section 11). A consumer container must respect `read_only`, `cap_drop`, tmpfs `/tmp` and the awslogs driver |
| D10 | `dev-native-environment.md` section 2 lists production async work as "in-process (Studio `thread` mode)" | `production.py` refuses `thread` (only `jobs` or `manual`) | Doc fix when this plan is adopted |
| D11 | Results objects expire in 7 days, queue keeps 14 | n/a | Part of P2 |
| D12 | Pending sibling branches at `2333d9e` (retention, GLB limit, `ListBucket`) | Merged into the Wave 4 head (`48c98a1`), not into `main` | Release A needs PR #42 and the Wave 4 branch merged first (owner review) |
| D13 | `bootstrap-native.sh ensure-roles` grants `audio.inspect_audiofile` to Sound editors | `bootstrap-django.sh` has no sound or NPC roles task | New tooling gap if Wave 4 ships to production (P14) |
| D14 | Deploy gates: `LAI_DEV_NATIVE_ENABLED` opened only for a dispatch | `LAI_DEPLOY_ENABLED` open is needed for any prod release, and all gates were closed on `main` on 2026-11-17 | Owner verification checklist in section 4a, A-2 (P13) |
| D15 | Dev monthly budget `MonthlyBudgetUsd` (40) in `LaiDevPlatform-dev` | Only the Bedrock budget in `LaiAiGuardrail-prod`; no budget or alarm for Lambda, SQS, S3 or logs | P15 |
| D16 | Dev runs on a schedule (stopped 00:00 to 08:00 Pacific); results wait in the queue | Always on | No overnight recovery to test; the consumer must survive a Django deploy and an RDS failover instead (section 11) |
| D17 | Dev RDS stop drill (A7) | Prod RDS has deletion protection, Single-AZ default, 14-day backups | No drill in production without an approved window (P11) |
| D18 | Dev log groups follow the `LogRetentionDays` parameter | Prod has retention per group (3 months app) and none for the worker log groups yet | P10 |

## 3a. Implementation status (ADR-071, 2026-11-18)

Code on `feature/lambda-production-infrastructure`; details in `PRODUCTION_PROCESSING.md` and
`PROCESSING_RELEASE.md`. "Implemented" means written and covered by CDK assertion or repository
tests; nothing is deployed or verified live.

| # | Status | Where |
|---|---|---|
| D1 | Implemented (code): prod queues, DLQs, five workers, roles, alarms in `LaiDjangoEc2-prod` behind `prodProcessing` (P1-a) | `infra/lib/productionProcessing.ts` |
| D2 | Implemented (code): `lai-prod-artifacts-<account>-<region>`, results 30 days (>= 14), zips and manifests never expire; amounts remain P2 (O10) | same |
| D3 | Implemented (code): Compose service `jobs-consumer` (profile `jobs`) | `deploy/ec2/docker-compose.yml`, `scripts/aws/lib.sh` |
| D4 | Implemented (code): Compose service `jobs-sweep` (daily); `speech_cleanup`/`ai_retention` not scheduled in prod (no speech bucket; G9) | same |
| D5 | Implemented (code): per-workload `MaximumConcurrency` and equal reserved concurrency, configurable; values open (O5) | `productionProcessing.ts` |
| D6 | Implemented (code): `release-prod-workers.yml` (dispatch only, gated, `django-prod`), role `lai-github-workers-prod` (P6-a variant: own workflow, not a job in `deploy-django-ec2.yml`) | `.github/workflows/`, `scripts/release/` |
| D7 | Implemented (code): instance role dispatch/consume/results statements | `productionProcessing.ts` |
| D8 | Pending owner: `LAI_ENVIRONMENT=prod` is operator-set; the pre-enable check refuses another namespace. Separately, live proof that IAM enforces `s3:if-none-match` (O12) | `processing_release.py` |
| D9 | Implemented (code): the consumer is a read-only, `cap_drop` Compose service with awslogs; production acceptance still owner-run | compose file |
| D10 | Pending (principal): `dev-native-environment.md` section 2 wording | |
| D11 | Implemented for prod (30 days); the dev 7-day rule is unchanged (dev file not touched) | |
| D12 | Pending: merges (principal) | |
| D13 | Pending: `bootstrap-django.sh` roles task (P14) | |
| D14 | Implemented (code): new gate `LAI_PROD_PROCESSING_DEPLOY_ENABLED`, typed confirmation; owner sets variables | workflow, tests |
| D15 | Implemented (code): budget only with `processingBudgetUsd` (no default), `CostScope` tag; amount and tag activation are owner decisions (O2, O3) | `productionProcessing.ts` |
| D16 | Implemented (design): consumer restart on deploy and crash; verification owner-run (section 11) | |
| D17 | Unchanged: no prod drill without a window | |
| D18 | Implemented (code): `ProcessingLogRetentionDays` (90); value open (O9) | |

P1 (P1-a), P2 (defaults), P3, P4, P5 (mechanism), P6, P9 (role), P10 (parameter) and P15
(mechanism) have code; their values and every deployment remain owner decisions (ADR-071 "Open
decisions").

## 4. Read-only facts to collect first (owner)

```bash
# [OWNER, READ-ONLY] production account and Region; never paste the account id
export AWS_REGION=us-west-1 AWS_PAGER=""
aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName,'Lai')].{Name:StackName,Status:StackStatus}" --output table
aws cloudformation describe-stacks --stack-name LaiDjangoEc2-prod --query 'Stacks[0].Outputs' --output table 2>&1 | sed -E 's/[0-9]{12}/<account>/g'
aws sqs list-queues --queue-name-prefix lai-prod-          # expected: none
aws lambda list-functions --query "Functions[?starts_with(FunctionName,'lai-prod-')].FunctionName"   # expected: []
aws rds describe-db-instances --db-instance-identifier lai-django-prod --query 'DBInstances[0].{Class:DBInstanceClass,MultiAZ:MultiAZ,Status:DBInstanceStatus}'
aws lambda get-account-settings --query 'AccountLimit.{Concurrent:ConcurrentExecutions,Unreserved:UnreservedConcurrentExecutions}'
aws lambda get-function-concurrency --function-name <other function>   # per function; Unreserved above is the pool left in the shared account
aws ssm get-parameters-by-path --path /lai/prod/django --query 'Parameters[].Name'
# gates and environments (the exact commands and reading are in LAI-LAMBDA-011 section 1.4)
REPO=paulj3000/learning
gh variable list --repo "$REPO"
gh api "repos/$REPO/environments/django-prod" --jq '{protection_rules: [.protection_rules[]? | {type, reviewers: [.reviewers[]?.type]}], deployment_branch_policy}'
gh api "repos/$REPO/environments/django-prod/variables" --jq '.variables[] | "\(.name)=\(.value)"'
gh api "repos/$REPO/environments/site-prod" --jq '{protection_rules: [.protection_rules[]? | {type}]}'
```

Record whether `LaiDjangoEc2-prod` exists at all; if it does not, production provisioning
(`DJANGO_EC2_DEPLOYMENT.md` section 5.12, `scripts/aws/provision.sh prod`) comes before anything
here.

## 4a. Release A: ship the code with processing off

| Step | Command (owner) | Pass |
|---|---|---|
| A-1 Dev acceptance | LAI-LAMBDA-011 Tier 1 accepted (Tier 2 if P14 includes Wave 4) | Section 14 of that page complete |
| A-2 Gates | Verify and set per LAI-LAMBDA-011 section 1: for a manual prod dispatch `LAI_DEPLOY_ENABLED=true` is required (`gh variable set LAI_DEPLOY_ENABLED --repo paulj3000/learning --body true`); `LAI_PROD_AUTO_DEPLOY` unset or `false`; `django-prod` has required reviewers | The next merge deploys nothing to prod; only the dispatch does |
| A-3 Settings | `aws ssm get-parameters-by-path --path /lai/prod/django --query 'Parameters[].Name'`; confirm `LAI_JOBS_BACKEND`, `LAI_ASSET_ASYNC_VALIDATION`, `LAI_STUDIO_RUN_MODE` are absent or `disabled`/`off`/`manual` | Processing stays off |
| A-4 Release | `gh workflow run deploy-django-ec2.yml --repo paulj3000/learning --ref main -f environment=prod -f action=deploy`; a `django-prod` reviewer approves. Read the job list afterwards (`gh run view <id> --json jobs`): with a closed gate the run ends green with every job skipped | Pre-migration snapshot taken; `jobs/0003`, `jobs/0004`, `audio/0005` applied; health green |
| A-5 Verify | `scripts/aws/ssm-run.sh prod status`; `scripts/aws/ssm-run.sh prod bootstrap check` | Release healthy; no jobs created (with the backend `disabled`, `services.submit` refuses with `JobsDisabled`, so background actions are refused and nothing reaches AWS) |
| A-6 Roles (only with P14 and Wave 4) | No supported command today: `bootstrap-django.sh` lacks the task (D13). Either a reviewed change adds `ensure-sound-roles`, or an owner runs `manage.py ensure_sound_roles` in the container by hand as an **owner manual** step | Sound editors hold `audio.inspect_audiofile`; the Audio files page lists files |

Release A's rollback caveat: `jobs/0003`'s columns carry `db_default=""`, so older code can still
insert job rows, and with the backend `disabled` no code path inserts contract jobs. A production
rollback past `0003` or `0004` is therefore safe **while processing is off** (LAI-LAMBDA-011
section 11.3). `deploy-django.sh` never reverses migrations; the record says
`manual_db_review_required`.

## 5. Production configuration and the flag (Release B)

Set as SSM parameters under `/lai/prod/django/` (the renderer refuses unknown names; `LAI_*` is
accepted). Values the stack knows (queue URLs, bucket) should be written by the stack as it does
for dev (`StringParameter`, "change through the stack"); operator-chosen switches
(`LAI_ASSET_ASYNC_VALIDATION`) are operator-set parameters. Applied by a release or a redeploy of
the running commit (`scripts/aws/ssm-run.sh prod deploy ...` through the workflow):

| Setting | Production value | Notes |
|---|---|---|
| `LAI_JOBS_BACKEND` | `sqs` | Production refuses `inline`; requires the four values below |
| `LAI_JOBS_AI_QUEUE_URL`, `LAI_JOBS_MEDIA_QUEUE_URL`, `LAI_JOBS_RESULTS_QUEUE_URL` | From the P1 stack outputs | Validated as `https://sqs.<region>.amazonaws.com/<account>/<name>` |
| `LAI_JOBS_RESULTS_BUCKET` | From P2 | |
| `LAI_JOBS_STALE_MINUTES` | 60 (default) | Production is always on; no overnight stop |
| `LAI_JOBS_RETENTION_DAYS` | 30 (default) | Plus `LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS` 90 for validation jobs |
| `LAI_ASSET_VALIDATION_MAX_ATTEMPTS` | 5 (default) | Staff resubmissions per file and processor version |
| `LAI_ENVIRONMENT` | `prod` (P7) | Namespace of contract requests; its only other use is the dev-bootstrap guard |
| `LAI_STUDIO_RUN_MODE` | stays `manual` until the owner moves Studio to `jobs` | Separate decision (P12) |
| `LAI_ASSET_ASYNC_VALIDATION` | `off` at first; `on` only after section 11 passes (P8) | Default off in every environment (ADR-062) |
| `LAI_ASSET_MAX_GLB_BYTES` | 52,428,800 (default, 50 MiB) | Ceiling is the `glb-default` profile limit (1 MiB to 50 MiB accepted); nginx allows 55 MiB |

Turning processing on in stages: (1) backend `sqs` with only the Admin actions ("Inspect in
background", "Validate in background", and with P14 the Wave 4 inspection actions) used by named
staff; (2) speech pre-generation follows automatically with `sqs`; (3) the flag `on`; (4) Studio
`jobs` (separate approval).

## 6. Canonical queue ownership (P1)

ADR-064 allows one job table, one consumer, one queue family and one infrastructure stack per
environment. For production that means the `lai-prod-*` queue family is owned by **one**
production platform stack; a separate `LaiProcessing-prod` stack is the superseded ADR-062 plan
and must not return (`tests/repo/test_canonical_processing_guard.py`).

| Option | What | For | Against |
|---|---|---|---|
| **P1-a (recommended)** | Extend `LaiDjangoEc2-prod` with the queues, DLQs, both workers, their roles and the DLQ alarms, by factoring the dev `queue()`/`workerRole()`/`worker()` code in `devPlatformStack.ts` into a construct both stacks use | One stack per environment, as in dev; the instance role and the queues change together; reuses tested code | Larger change to the production stack; every queue change is a prod stack update with change-set review (`provision.sh prod`); the factoring must not change dev |
| P1-b | A production-only jobs stack consumed by `LaiDjangoEc2-prod` through managed policies attached by name | Smaller blast radius per update | A second stack per environment, close to the superseded pattern; needs its own ADR |

Names (convention `lai-<env>-*`, ADR-064): `lai-prod-jobs-ai`, `lai-prod-jobs-media`,
`lai-prod-job-results`, each with `-dlq`; functions `lai-prod-jobs-ai`, `lai-prod-jobs-media`;
roles `lai-prod-jobs-ai-worker`, `lai-prod-jobs-media-worker`. Queue settings as dev unless P5
changes them: work queues visibility 6 x function timeout, retention 4 days, DLQ after 3
receives; results visibility 300 s, retention 14 days, DLQ after 5 receives; DLQs 14 days; SSE;
TLS-only queue policies. Bedrock: one Region in production (synthesis refuses a different Bedrock
Region outside dev, `infra/bin/app.ts`).

## 7. Worker packaging and deployment (P6)

- Same artifact as dev: `scripts/aws/package-lambda.sh` builds the deterministic
  `jobs-worker-<hash16>.zip` from the release commit (`lambda/build.py`, vendored `jobs_core`, the
  Bedrock adapter and `lai_processing` including the Wave 4 processors, size budget 2 MiB). No
  container image, no ECR for workers (ADR-064 decision 9; dev has no ECR either).
- Stored under `lambda/` in the P2 bucket with a create-only write (as `dev-release.sh` does with
  `If-None-Match`), kept at least 180 days for rollback.
- Deployment options (pick one):
  - **P6-a (recommended):** a `deploy-workers` job in `deploy-django-ec2.yml`, environment
    `django-prod` (existing, required reviewers), gated by `LAI_DEPLOY_ENABLED`, running after the
    Django `deploy-prod` job (consumer first). The `lai-github-deploy-prod` role gains
    `s3:PutObject` on `lambda/*` and `lambda:UpdateFunctionCode`/`GetFunction` on the two prod
    functions only. This is new workflow and IAM code; nothing in `dev-release.sh` can be reused
    as is because `lib-dev.sh` refuses production names.
  - P6-b: the stack's worker-code parameter updated by `scripts/aws/provision.sh prod` (change-set
    review, slower, couples code and infrastructure as `deploy-debug.sh` does in dev).
- No `processing-prod` GitHub environment and no `LAI_PROCESSING_*` variables (superseded).
- Compatibility during a release is the dev rule (LAI-LAMBDA-011 section 3.7): Django with its
  migrations first, then the worker, no background action and no flag in between; a GLB
  `asset.inspect` carries `max_bytes`, which a worker built before this release refuses
  (`invalid_payload`). In production the window is the gap between the Django approval and the
  worker approval, so approve both in one sitting.

## 8. IAM (production)

| Principal | Allowed | Never |
|---|---|---|
| Instance role `lai-django-ec2-prod` | `sqs:SendMessage`, `GetQueueAttributes` on the two work queues; `ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`, `GetQueueAttributes` on the results queue; `s3:GetObject` (and `ListBucket` scoped) on the results prefix | Send to the results queue; read DLQs; start message moves |
| `lai-prod-jobs-media-worker` | Its work queue; send to the results queue; `GetObject`/`PutObject` on `jobs/results/*`; `GetObject` on the asset bucket; **`s3:ListBucket` on the asset bucket** with the dev statement `ListAssetBucket` (`StringLikeIfExists` on `s3:prefix` = `assets/*`, so a missing object is 404 and `input_missing`, not 403); Polly and the speech prefix if speech moves to prod workers | Write or delete assets; any database, secret or VPC access |
| `lai-prod-jobs-ai-worker` | Its work queue; send results; results prefix; Bedrock invoke on the approved inference profile; `ApplyGuardrail` on the prod Guardrail only; read `LAI_AI_*`/`LAI_STUDIO_*` settings | Same as above |
| GitHub `lai-github-deploy-prod` | Existing release documents; plus (P6-a) worker code update | Queue, DLQ or IAM changes |
| Authorized operations administrators (P9) | `sqs:StartMessageMoveTask`, `ListMessageMoveTasks`, `CancelMessageMoveTask` on the prod DLQs, through a named role or group | Ordinary staff and users, all application roles (ADR-062 B7) |

Lambda stays outside the VPC with no database access (ADR-061 item 4); the results bucket needs
SSE, a public access block and a TLS-only policy like the existing buckets (part of P2). No stored
AWS keys anywhere: OIDC only.

### 8a. Security review points before Release B

- Wave 4 and validation jobs read **staff** content only; child photos, speech and audio never
  enter a job (A9 in dev; carry the same rule into production runbooks).
- Logs carry ids and codes only (ADR-025); worker log groups get the same rule and a retention
  (P10).
- Admin actions are permission-gated (`audio.inspect_audiofile`, `npcs.change_npcmodelvariant`,
  asset upload and view permissions); the production roles must be created before the actions are
  usable (D13).
- A DLQ redrive can replay a message into the consumer; keep it restricted (P9).
- The admin host stays behind the existing WAF and CIDR rules; no new public endpoint is added by
  this plan (the workers and queues have no public ingress).

## 9. Migrations and data retention

- **Migrations:** `jobs/0003_contract_kinds` (constraint replaced, two columns with a database
  default of `''`), `jobs/0004_wave4_inspection_kinds` (kind choices and the check constraint)
  and `audio/0005_audio_file_proxy` (proxy model) ship in Release A with the pre-migration
  snapshot (`deploy-django.sh` step 8, prod, when migrations are pending). None matches the
  destructive-operation guard, so `allow_destructive_migrations` stays `false`; if a run asks for
  it, stop.
- **Retention:**

| Data | Rule | Where enforced |
|---|---|---|
| Completed `asset.validate_model` jobs | 90 days (`LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS`) | `jobs_sweep`; needs the P4 schedule in production |
| Other completed jobs | 30 days (`LAI_JOBS_RETENTION_DAYS`) | `jobs_sweep` |
| Failed jobs | Kept for review (the sweep never deletes them) | Decide a cap (P10) |
| Result objects `jobs/results/` | At least 14 days (results queue retention); recommended 30 | P2 bucket lifecycle |
| Worker zips `lambda/` | At least 180 days | P2 bucket lifecycle |
| Queue messages | Work 4 days, results 14 days, DLQs 14 days (from original enqueue) | Queue attributes |
| Logs | Worker and jobs log groups: choose with the production log retention (Django 3 months in prod today) | P1 stack, P10 |

A `VALIDATED` GLB whose passing job was pruned is refused by the publication gate until staff run
"Validate in background" again (`ASYNC_MODEL_VALIDATION.md` sections 8 and 10); the 90-day rule
exists to make that rare. Audio and animation inspection results stay on the job row (30 days)
and are not evidence for any publication gate.

## 10. Capacity planning (P5)

- **Owner number:** 5 (ADR-062, "Production reserved concurrency is 5 initially and
  configurable"). Open questions: per function or in total, and which mechanism.
- **Recommendation:** set the SQS event source mapping `MaximumConcurrency` to 5 on each worker
  (the dev mechanism), and, only if capacity must be guaranteed against other functions in the
  **shared account**, a reserved concurrency **at least equal** to it. A reserved concurrency
  below the mapping's maximum makes Lambda throttle SQS deliveries, and throttled deliveries
  spend receives: work queues allow only 3 before the DLQ. AWS keeps at least 100 unreserved
  concurrent executions per account; check `get-account-settings` and the other functions'
  reservations (`get-function-concurrency`, section 4) because dev and unrelated projects share the pool.
- **Downstream limits:** workers never touch RDS, so their concurrency does not consume database
  connections (`t4g.micro` has few); the single consumer applies results sequentially (batches of
  up to 10, 20 s long poll). Bedrock throughput is bounded by the AI worker's concurrency and
  Studio's one chunk in flight per batch; the Bedrock quotas are account-wide and shared with
  dev. Wave 4 inspections add media-queue work but only on staff request.
- **Timeouts:** media 120 s with the 90 s request budget; AI 300 s. A model validation is bounded
  by the 50 MiB input limit.
- **Sizing check in dev:** LAI-LAMBDA-011 case G7 (section 4.8) records `Max Memory Used` and
  `Duration` for a near-limit GLB; use it to confirm 512 MB before copying the value.

## 11. Deploy ordering and production acceptance (Release B)

| Step | Action (owner) | Gate |
|---|---|---|
| B-1 | Decisions P1 to P10 and P13 to P15 recorded (ADR or ADR-064 amendment) | Owner |
| B-2 | Implement and test the P1 stack change, P2 bucket, P3 consumer service, P4 schedule, P6 pipeline on a branch; `npm run infra:synth:prod`; review | Owner review |
| B-3 | `scripts/aws/provision.sh prod` (change sets only), review: queues, DLQs, workers, roles, alarms created; the instance role modified; **no** replacement of EC2, RDS or the ALB | Owner approval |
| B-4 | `scripts/aws/provision.sh prod --execute` | Owner approval |
| B-5 | Django release with the consumer service (P3) and the SSM settings of section 5, `LAI_JOBS_BACKEND=sqs`, flag `off` (`gh workflow run deploy-django-ec2.yml ... -f environment=prod -f action=deploy`) | `django-prod` reviewers |
| B-6 | Worker zip (P6) | `django-prod` reviewers |
| B-7 | Read-only checks equivalent to LAI-LAMBDA-011 section 2 for `lai-prod-*` (queues and DLQs, redrive policies, IAM including `ListAssetBucket`, Lambda config with no VPC, alarms) | |
| B-8 | One `asset.inspect` (non-GLB first) and one "Validate in background" on a published synthetic test model: `result_recorded`, nothing changed; with P14 one animation and one audio inspection | |
| B-9 | Flag `on` (P8), one synthetic upload: `DRAFT`, `VALIDATED`, explicit publish; then one near-limit upload through the ALB and nginx (51 MB) to check the upload path and worker memory; retire the test assets | Owner approval |
| B-10 | Monitor for one week (section 12a) before Studio `jobs` is considered | |

No RDS outage drill, DLQ drill or ESM toggling in production unless the owner approves a
maintenance window; dev acceptance covers the behaviour. A production-specific check the dev
acceptance cannot give: deploy a Django release while a job is in flight and confirm the consumer
(a Compose service on a single instance) resumes and applies the result (the outbox relay and
queue retention make this safe by design; verify it once, with a synthetic job).

## 12a. Monitoring (production)

- Alarms to `lai-django-alarms-prod`: one per DLQ on its first message (as dev); additionally
  recommended for production: results queue `ApproximateAgeOfOldestMessage` above 15 minutes,
  Lambda `Errors` above 0 for 10 minutes and `Throttles` above 0 per worker, and the existing
  `not-ready` alarm (the consumer cannot apply while Django's database is down). Dev has none of
  these extras; they are new work (P1).
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
   (`django-prod` approval; not gated by `LAI_DEPLOY_ENABLED`). Code-only rollback past the jobs
   migrations works for inserts (`db_default=""`), but older code does not know the new kinds:
   first flag off, drain the queues and mark unfinished contract-kind jobs failed
   (LAI-LAMBDA-011 section 11.3). Prefer rolling forward.
5. **Infrastructure**: the queues, workers and roles can stay deployed with the backend
   `disabled`; remove them only by an approved stack update after the queues are empty.

## 12c. Cost and budget (P15)

All figures are assumptions for planning, not quotes; check the AWS Pricing Calculator for
us-west-1 before deciding.

| Item | Assumption | Formula |
|---|---|---|
| Lambda (arm64) | Price per GB-second and per million requests as published for us-west-1 (verify current pricing); 512 MB | `invocations x avg duration (s) x 0.5 GB x price` + requests |
| SQS standard | First 1 million requests a month free, then a per-million price (verify) | Production consumer polls always on: about 3 requests a minute = about 130,000 a month idle (dev is stopped overnight, so dev understates this), plus 4 to 6 requests per job |
| S3 results | Small JSON objects, 30-day lifecycle | Storage negligible; PUT/GET per job |
| CloudWatch | Log ingestion per GB and per alarm (verify) | 3 DLQ alarms plus the recommended ones |
| Bedrock, Polly | Unchanged by this plan; bounded by the existing monthly Bedrock budget in `LaiAiGuardrail-prod` | |
| Measured baseline | Use the dev measurements of LAI-LAMBDA-011 section 10 and case G7 as the per-job unit cost; dev's schedule hides always-on costs | |

Expected order of magnitude at production staff-upload volume: a few dollars a month for Lambda,
SQS and S3 combined; this must be confirmed from dev measurements, not assumed. Production has
**no budget or alarm for processing** today (D15): P15 decides a monthly ceiling and a Budgets
notification to `lai-django-alarms-prod`, and activating the `Environment` cost allocation tag so
dev and prod cost can be told apart in the shared account.

## 12d. Operational ownership

| Area | Owner (proposed) |
|---|---|
| Deploy approvals (`django-prod`), gate variables, flag and backend switches | Project owner |
| DLQ redrive | Named operations administrators only (P9, ADR-062 B7) |
| Failed-job review, resubmission (Admin actions) | Staff with asset upload and view permissions |
| Alarm response | Alarm e-mail recipient (`AlarmEmail`), escalating to the owner |
| Cost review | Owner, monthly, from the budget and Cost Explorer |

## 13. Owner decisions required

Existing IDs P1 to P13 are kept; P14 and P15 are new.

| # | Decision | Blocks | Reconciled note (2026-11-17) |
|---|---|---|---|
| P1 | Production jobs infrastructure: extend `LaiDjangoEc2-prod` (recommended) or a separate stack with its own ADR | Release B | Confirmed absent in `infra/`; the factoring must leave dev unchanged |
| P2 | Production bucket for worker zips and `jobs/results/` (new bucket or prefixes), with lifecycle (results at least 14 days, zips at least 180) and the standard bucket protections | Release B | Dev's 7-day results expiry is a defect to avoid, not copy |
| P3 | Production consumer: a Compose service running `python manage.py jobs_consume_results` from the same image (recommended), its restart policy and log group | Release B | Must fit `read_only`, `cap_drop`, awslogs; a deploy restarts it |
| P4 | Production maintenance schedule for `jobs_sweep` (and `speech_cleanup`, `ai_retention` report) | Retention, stale-job handling | No timer exists in `setup-ec2.sh` |
| P5 | Concurrency: "5" per function or total; event source `MaximumConcurrency` and whether to add reserved concurrency (at least equal) | Release B | Shared account: check unreserved pool first |
| P6 | Worker deployment path in production (job in `deploy-django-ec2.yml` under `django-prod`, recommended) and the deploy role's added permissions | Release B | New workflow and IAM code |
| P7 | `LAI_ENVIRONMENT=prod` as the processing namespace | Release B | Allowed by `render-env.sh`; forbidden in dev |
| P8 | When to switch `LAI_ASSET_ASYNC_VALIDATION=on` in production | Flag on | After section 11 B-8 |
| P9 | Who may redrive production DLQs, and through which role or group | Release B | |
| P10 | Failed-job retention cap and log retention for the new groups | Release B | |
| P11 | Whether Multi-AZ RDS is wanted before production processing (the consumer tolerates outages, but a single-AZ failover still pauses applications) | Optional | No outage drill in prod without a window |
| P12 | Studio `LAI_STUDIO_RUN_MODE=jobs` in production (separate from this rollout) | Optional | |
| P13 | Every deployment and provisioning step above (ADR-019 G7), **including opening `LAI_DEPLOY_ENABLED`, naming the `django-prod` reviewers and keeping `LAI_PROD_AUTO_DEPLOY` closed**; the gate state on `main` on 2026-11-17 was all closed | All | Exact checks: LAI-LAMBDA-011 section 1.4 |
| **P14** (new) | Whether the Wave 4 kinds (`asset.analyze_animation`, `asset.process_audio` phase 1; migration `jobs/0004`, `audio/0005`) ship in Release A, and how production gets the Sound and NPC role groups (a `bootstrap-django.sh` task or a manual step) | Wave 4 in production | D13; the code itself is inert without a sender |
| **P15** (new) | Production processing budget: monthly ceiling, Budgets notification, cost allocation tag in the shared account | Release B | D15 |
