# Production processing infrastructure (ADR-071): audit and definitions

Status: **code only**. Nothing is deployed, provisioned or verified live. Owner approval
PRODUCTION (2026-11-18) covers writing and testing this code. The release sequence is in
`PROCESSING_RELEASE.md`; the plan and gap table in `LAI-LAMBDA-012-production-rollout.md`.

## 1. Production audit (from the repository, 2026-11-18, base `c9d722be`)

| Area | What production uses | Source |
|---|---|---|
| Stacks | `LaiAssetStorage-prod`, `LaiChildPhotos-prod`, `LaiDjangoRelease` (account-wide ECR `lai/django`, GitHub OIDC provider, image publisher role), `LaiDjangoEc2-prod`, `LaiAiGuardrail-prod`, `LaiFrontend-prod` (us-east-1). `LaiDevArtifacts-dev` and `LaiDevPlatform-dev` are dev only | `infra/bin/app.ts` |
| Backend hosting | **Docker Compose on one x86_64 EC2** (`t3.medium` default) behind an ALB with ACM and a WAF login rate rule; image from ECR by digest; containers `read_only`, `cap_drop: ALL`, tmpfs `/tmp`, awslogs. Not the native ARM64 dev host (no systemd units for the app, no venv) | `infra/lib/djangoEc2Stack.ts`, `deploy/ec2/docker-compose.yml` |
| VPC | `10.41.0.0/16`, public and isolated subnets, no NAT, no endpoints; the instance has a public address, inbound from the ALB only | `djangoEc2Stack.ts` |
| Database | RDS PostgreSQL 16 `lai-django-prod`, private, TLS forced, deletion protection, 14-day backups, Single-AZ unless `LAI_DB_MULTI_AZ=true`, pre-migration snapshots | `djangoEc2Stack.ts`, `scripts/aws/deploy-django.sh` |
| IAM | Instance role `lai-django-ec2-prod` (SSM core, ECR pull, `/lai/prod/django/*`, logs, metrics, `lai-django-asset-storage-prod` and `lai-django-child-photos-prod` by name, `lai-django-ai-prod` attached by the Guardrail stack). GitHub deploy role `lai-github-deploy-prod` (environment `django-prod`): SSM release documents only | `djangoEc2Stack.ts`, `aiGuardrailStack.ts` |
| Asset bucket | `lai-assets-prod-<account>-<region>`, private, versioned, SSE-S3, TLS only, noncurrent versions 30 days, abort incomplete uploads 1 day (bucket-wide), no current-object expiration, no CDN | `assetStorageStack.ts` |
| CloudFront | `LaiFrontend-prod`: default origin the private site bucket (OAC), `/api/*` to the API host. **No origin or behaviour serves the asset bucket**, so `processing/` can never be public (asserted in `processingInfrastructure.test.ts`) | `frontendStack.ts` |
| Cognito | The existing user pool and app clients, passed as stack parameters; no Cognito resource in CDK | `djangoEc2Stack.ts` parameters |
| GitHub environments | `django-prod` (required reviewers, deploy role `LAI_DEPLOY_ROLE_ARN`), `site-prod`; repository gates `LAI_DEPLOY_ENABLED`, `LAI_PROD_AUTO_DEPLOY`, `LAI_SITE_DEPLOY_ENABLED` | `deploy-django-ec2.yml`, `deploy-site.yml`, LAI-LAMBDA-011 section 1.4 |
| Release workflows | `deploy-django-ec2.yml` (prod by manual dispatch; rollback not gated by `LAI_DEPLOY_ENABLED`), `deploy-site.yml`; dev-only: `deploy-dev-native.yml`, `deploy-dev-lambda.yml`, `manage-dev-infrastructure.yml` | `.github/workflows/` |
| Secrets and parameters | `/lai/prod/django/*` rendered by `scripts/aws/render-env.sh` (allowed `DJANGO_*`, `COGNITO_*`, `LAI_*`); stack-managed values are `StringParameter`s "change through the stack"; secrets are SecureStrings the operator writes; database secret `lai/prod/django/database` | `render-env.sh`, `djangoEc2Stack.ts` |
| Alarms | Topic `lai-django-alarms-prod` (Budgets may publish); not-ready, 5xx, memory, disk, system status, database storage; Bedrock budget in `LaiAiGuardrail-prod` | `djangoEc2Stack.ts`, `aiGuardrailStack.ts` |
| Processing | **None** before this work: no queue, worker, consumer, sweep, artifacts bucket or processing alarm | LAI-LAMBDA-012 D1 to D18 |

Dev-only assumptions that must not be copied: the native ARM64 host with systemd units
(`lai-jobs-consumer.service`, `lai-maintenance.timer`); `LaiDevArtifacts-dev` with 7-day results;
the nightly stop (results wait overnight); `MaximumConcurrency` 2 without reserved concurrency;
`deploy-dev-lambda.yml` and `lib-dev.sh` (which refuses prod names); the forbidden
`LAI_ENVIRONMENT` in the dev renderer (namespace `local`); the dev budget parameter; the speech
bucket and Polly grant of the dev media worker.

No production resource is duplicated: the processing construct lives in `LaiDjangoEc2-prod` (one
stack per environment), reuses its instance role, alarm topic and log groups, and the asset bucket
of `LaiAssetStorage-prod`. The only new bucket is the prod counterpart of the dev artifacts bucket
(worker zips, layers, manifests, large job results), which production did not have (D2).

## 2. What `prodProcessing=true` adds to `LaiDjangoEc2-prod`

Synth: `LAI_ENV=prod LAI_PROD_PROCESSING=true [LAI_OPTIMIZE_WORKER=true]
[LAI_PROCESSING_BUDGET_USD=<n>] [LAI_PROCESSING_SIZING='{"image":{"memoryMb":1024}}'] npm run
infra:synth:prod`. Without the flag the templates are unchanged (compared byte for byte).

| Resource | Names | Notes |
|---|---|---|
| Artifacts bucket | `lai-prod-artifacts-<account>-<region>` | Private, SSE-S3, TLS 1.2+, retained; `jobs/results/` 30 days, `tmp/` 1 day, `lambda/` and `releases/processing/` never expire (rollback) |
| Queues + DLQs | `lai-prod-job-results`, `lai-prod-jobs-{ai,media,audio,image}` (+ `optimize` with the flag), each `-dlq` | SSE, TLS-only; work: visibility 6 x timeout, 4 days, DLQ after 3 receives; results: 300 s, 14 days, DLQ after 5; DLQs 14 days |
| Workers | `lai-prod-jobs-*`, roles `lai-prod-jobs-*-worker`, log groups `/aws/lambda/lai-prod-jobs-*` | arm64 Python 3.12 zips from the artifacts bucket, no VPC; batch 1, `ReportBatchItemFailures`; created only with `EnableJobsWorkers`, `EnableAudioWorker`, `EnableImageWorker`, `EnableOptimizeWorker` (all default `false`) and their code keys (rules refuse an empty key) |
| FFmpeg layer | `lai-prod-ffmpeg` | From `AudioLayerKey`; retained on replacement and deletion |
| Settings | `LAI_JOBS_{AI,MEDIA,AUDIO,IMAGE,OPTIMIZE}_QUEUE_URL`, `LAI_JOBS_RESULTS_QUEUE_URL`, `LAI_JOBS_RESULTS_BUCKET` | Each only when its worker is enabled. `LAI_JOBS_BACKEND`, `LAI_ENVIRONMENT` and every feature control stay operator-set |
| Django permissions | Instance role: `SubmitJobs`, `ConsumeJobResults`, `ReadJobResults`, `ListJobResults`; `lai-django-processing-artifacts-prod` attached | Never sends to the results queue, never redrives |
| Redrive role | `lai-prod-jobs-dlq-redrive` | Account principals with MFA; message move from DLQs back to their source queues only |
| Release role | `lai-github-workers-prod` | OIDC, `django-prod` only; create-only uploads to `lambda/*` and `releases/processing/*`; `UpdateFunctionCode`/`GetFunction*` on the prod workers only |
| Monitoring | `lai-prod-*` alarms (section 4) | To `lai-django-alarms-prod` unless `notify: false` |
| Budget | `lai-prod-processing-monthly` | Only with `processingBudgetUsd` (no default; P15) |

### Sizing and concurrency (no Lambda measurement exists; labels as in `processingWorkers.ts`)

| Workload | Memory | Timeout | `/tmp` | Concurrency default | Basis |
|---|---|---|---|---|---|
| ai | 512 MB | 300 s | 512 MB | 5 | ADR-064 dev values, ADR-062 "5" |
| media | 512 MB | 120 s | 512 MB | 5 | ADR-064 dev values |
| audio | 1024 MB | 300 s | 512 MB | 2 | Workstream C start; 900 s of voice took 102 s wall, ffmpeg peak RSS 87 MB (x86 workstation); arm64 not measured |
| image | 1024 MB | 120 s | 512 MB | 2 | Workstream D proposal; peak RSS up to 366 MiB at 16 MP (x86 workstation) |
| optimize | 3008 MB | 900 s | 4096 MB | 2 | Placeholder; runtime undecided (ADR-070), flag off |

`<Workload>WorkerConcurrency` sets the SQS mapping `MaximumConcurrency` (minimum 2) and, while
`ReserveWorkerConcurrency=true`, an equal reserved concurrency, so Lambda never throttles below the
mapping (a throttled delivery spends one of three receives). Total reserved by default: 14 (16 with the optimize worker) of the
shared account's pool (AWS keeps at least 100 unreserved): check `get-account-settings` first.

## 3. Results consumer, outbox relay and reconciliation in production

Production runs Compose, so the dev units become Compose services of the same image, profile
`jobs` (`deploy/ec2/docker-compose.yml`), with no duplicate job logic:

| Dev (native) | Production (Compose) | Behaviour |
|---|---|---|
| `lai-jobs-consumer.service`: `manage.py jobs_consume_results`, `Restart=on-failure`, `TimeoutStopSec=40` | `jobs-consumer`: same command, `restart: on-failure`, `stop_grace_period: 40s`, same read-only hardening, log stream `jobs-consumer-<sha>` in `/lai/prod/django` | One consumer; it also runs the outbox relay once a minute. Checks PostgreSQL before every receive (database readiness: no receive spent while RDS is down); SIGTERM finishes the current message (graceful shutdown); a crash restarts it and unapplied messages stay in the queue (crash recovery); exits 0 when the backend is not `sqs` |
| `lai-maintenance.timer` (daily `jobs_sweep`) | `jobs-sweep`: `jobs_sweep` at start and every 24 h (`init: true`, so SIGTERM stops the loop) | Idempotent and transactional; a failure logs `jobs-sweep failed`, an alarm metric |

`scripts/aws/lib.sh` adds `--profile jobs` only when the rendered `django.env` has
`LAI_JOBS_BACKEND=sqs`, and removes both services after a release with the backend switched off.
With the backend `disabled` (today) nothing changes. Both wait for `django` to be healthy
(migrations applied, database reachable). The ADR-064 guard
(`tests/repo/test_canonical_processing_guard.py`) still passes: no new systemd unit, no second
consumer command.

## 4. Monitoring (thresholds configurable)

| Signal | Alarm | Threshold |
|---|---|---|
| DLQ messages, every queue | `lai-prod-<q>-dead-letters` | >= 1 |
| Oldest message, every work queue and results | `lai-prod-<q>-queue-age` | `QueueAgeAlarmSeconds` (900) for 15 min |
| Depth | `lai-prod-<q>-queue-depth` | `QueueDepthAlarmMessages` (100) for 15 min |
| Lambda errors, throttles | `lai-prod-<w>-worker-errors`, `-throttles` | >= 1 (errors over 10 min) |
| Duration | `lai-prod-<w>-worker-duration` | > 80% of the timeout |
| Max memory | `lai-prod-<w>-worker-memory` | > 85% of memory, from a metric filter on the platform `REPORT` line (no Lambda Insights; verify the pattern on the first live log) |
| Artifact failures (artifact-writing workers) | `lai-prod-<w>-artifact-failures` | `artifact_conflict`, `storage_failure`, `permission_denied` in worker logs |
| Stuck outbox | `lai-prod-outbox-stuck` | 3 `jobs.send failed` in 15 min |
| Consumer backoff | `lai-prod-consumer-backoff` | 10 database or receive errors in 15 min |
| Reconciliation | `lai-prod-reconciliation-failures` | any `jobs.sweep backlog_unknown` or `jobs-sweep failed` |
| Deployment health | `lai-prod-deploy-rollbacks` plus the existing `lai-django-prod-not-ready` | any automatic rollback |

Metrics from log filters go to `LearningAdventureIsland/Processing`. Custom metrics and alarms have
a small monthly cost (verify pricing); Lambda Insights is not used (O4).

## 5. Cost allocation and budget

Tags on every processing resource: `Project=learning-adventure-island`, `Environment=prod`,
`Component=processing`, `CostScope=lai-prod-processing`. The budget, when the owner sets
`processingBudgetUsd`, filters on `user:CostScope$lai-prod-processing` and notifies the alarm topic
at 80% actual and 100% forecast. The tag must be activated as a cost allocation tag in Billing
(owner, O3) or the budget sees no cost.

## 6. Dev changes (LaiDevPlatform-dev)

Native queues `lai-dev-jobs-{audio,image,optimize}` (+ DLQs and DLQ alarms) always; workers
`lai-dev-jobs-audio` (with `lai-dev-ffmpeg` from `AudioLayerKey`, `LAI_FFMPEG_PATH=/opt/bin/ffmpeg`) and `lai-dev-jobs-image` behind
`EnableAudioWorker` / `EnableImageWorker` (default `false`, also need `EnableLambdaProcessing`);
`lai-dev-jobs-optimize` only with the `optimizeWorker` flag. `ReserveNativeWorkerConcurrency`
(default `false`). The media worker's `ReadAssets` is narrowed from the whole bucket to `assets/*`
(plus `processing/artifacts/dev/*` read and create-only write, Workstream B pattern). The instance
role gets `lai-django-processing-artifacts-dev` (created by `LaiAssetStorage-dev`) and may submit to
the native queues. Native layer and zips are build outputs uploaded to `lambda/` and
`lambda/layers/` in the dev artifacts bucket (bootstrapless stacks take S3 keys, not file assets).
