# Processing infrastructure (LAI-LAMBDA-005)

Trello: [LAI-LAMBDA-005](https://trello.com/c/cgbkYzMc). Decisions: ADR-061 (processing design),
ADR-062 (one job backbone), ADR-055 (native dev), ADR-037 (prod containers). Interfaces:
`docs/processing/WAVE2_INTERFACES.md` sections 3, 4, 5, 7 and 8 (frozen; this page implements
them and changes none of them).

**Nothing on this page is deployed.** The repository synthesizes the stacks and tests them; every
deployment, GitHub variable and GitHub environment below is an owner step (ADR-019 G7).

## 1. Architecture

```text
Django (outbox relay, lai-jobs-dispatch) --SendMessage--> lai-<env>-processing-work (SQS, + DLQ)
   ^                                                           |  event source mapping
   |                                                           v  batch 1, ReportBatchItemFailures
   |                                   lai-<env>-processing-worker (Lambda, arm64, image by digest,
   |                                   no VPC) reads assets/* and processing/quarantine/<env>/*,
   |                                   writes processing/artifacts/<env>/* (lai-processing-<env>-...)
   |                                                           |
   +--Receive/Delete-- lai-<env>-processing-completions (SQS, + DLQ) <--SendMessage--+
Django (completion consumer, lai-jobs-completions) acknowledges only after commit
```

| Stack | Environments | Phase | What |
|---|---|---|---|
| `LaiProcessingImages-<env>` (`infra/lib/processingImagesStack.ts`) | dev, prod | 1 | ECR `lai/processing-<env>`, the GitHub OIDC publisher role |
| `LaiProcessing-<env>` (`infra/lib/processingStack.ts`) | dev, prod | 1 then 2 | Bucket, four queues, worker role, Django policy, settings, alarms; the function and its event source mapping only in phase 2 |

The platform stacks attach the Django policy by name: `LaiDevPlatform-dev` to `lai-django-ec2-dev`,
`LaiDjangoEc2-prod` to `lai-django-ec2-prod`. Neither platform stack gains a Lambda, queue or
ECR resource. Dev keeps no load balancer or WAF (ADR-055); prod networking, ALB and WAF are
unchanged. No CodePipeline or CodeBuild: GitHub Actions only.

## 2. Resources

| Resource | Name | Settings | On stack delete |
|---|---|---|---|
| ECR repository | `lai/processing-<env>` | IMMUTABLE tags, scan on push, AES-256, untagged images expire after 7 days, newest 30 images kept; repository policy lets only `lambda.amazonaws.com` pull, for `function:lai-<env>-processing-worker` | Retained |
| Publisher role | `lai-github-processing-publisher-<env>` | Trusts `repo:<owner/repo>:environment:processing-<env>` on the existing OIDC provider (never creates one), 1 h sessions | Deleted |
| Processing bucket | `lai-processing-<env>-<account>-<region>` | Block all public access, bucket-owner-enforced, SSE-S3, TLS 1.2+ only, versioned | **Retained (both environments)** |
| Work queue / DLQ | `lai-<env>-processing-work`, `-work-dlq` | Standard, SSE-SQS, TLS only, 14 days, visibility 3600 s, `maxReceiveCount` 5 | dev deleted, prod retained |
| Completion queue / DLQ | `lai-<env>-processing-completions`, `-completions-dlq` | Standard, SSE-SQS, TLS only, 14 days, visibility 300 s, `maxReceiveCount` 5 | dev deleted, prod retained |
| Worker role | `lai-<env>-processing-worker` | Section 3 | Deleted |
| Worker function (phase 2) | `lai-<env>-processing-worker` | Image `<account>.dkr.ecr.<region>.amazonaws.com/lai/processing-<env>@sha256:...`, command `lai_processing_runtime.lambda_handler.handler`, arm64, 600 s, 2048 MB, 2048 MB ephemeral, reserved concurrency dev 2 / prod 5, no VPC | Deleted |
| Event source mapping (phase 2) | | Batch 1, `ReportBatchItemFailures`, `maximumConcurrency` = reserved concurrency | Deleted |
| Log group | `/aws/lambda/lai-<env>-processing-worker` | dev 14 days, prod 90 days | dev deleted, prod retained |
| Django policy | `lai-django-processing-<env>` | Section 3 | Deleted (detach first: section 7) |
| SSM parameters | `/lai/<env>/django/LAI_PROCESSING_{BACKEND,NAMESPACE,WORK_QUEUE_URL,COMPLETION_QUEUE_URL,BUCKET}` | String; `BACKEND` is `sqs` only in phase 2, else `disabled`; `NAMESPACE` is the environment | Deleted |
| Alarms | `lai-<env>-processing-*` | Section 5, to the existing `lai-django-alarms-<env>` (by name) | Deleted |

Bucket lifecycle, by prefix:

| Rule | Prefix | Current versions | Noncurrent versions |
|---|---|---|---|
| `expire-quarantine` | `processing/quarantine/` | expire after 30 days | 1 day |
| `artifact-versions` | `processing/artifacts/` | dev: expire after 90 days; prod: never | 30 days |
| `expire-tmp` | `processing/tmp/` | expire after 1 day | 1 day |
| `abort-incomplete-uploads` | whole bucket | abort multipart uploads after 1 day | |

There is no S3 event notification on the bucket: work is dispatched only from Django's outbox
(`docs/processing/SECURITY.md`, "Output-trigger loops").

## 3. IAM matrix

| Principal | Action | Resource |
|---|---|---|
| Worker role | `sqs:ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`, `GetQueueAttributes` | work queue |
| Worker role | `sqs:SendMessage` | completion queue |
| Worker role | `s3:GetObject`, `GetObjectVersion` | `lai-assets-<env>-.../assets/*`, `lai-processing-<env>-.../processing/quarantine/<env>/*` |
| Worker role | `s3:PutObject` | `.../processing/artifacts/<env>/*` |
| Worker role | `ecr:BatchGetImage`, `GetDownloadUrlForLayer` | `lai/processing-<env>` |
| Worker role | `logs:CreateLogStream`, `PutLogEvents` | its log group (pre-created, so no `logs:CreateLogGroup` and no `*`) |
| Django (`lai-django-processing-<env>`) | `sqs:SendMessage`, `GetQueueAttributes` | work queue |
| Django | `sqs:ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`, `GetQueueAttributes` | completion queue |
| Django | `sqs:GetQueueAttributes` | both DLQs (status) |
| Django | `s3:PutObject`, `GetObject` | `.../processing/quarantine/<env>/*` |
| Django | `s3:GetObject`, `GetObjectVersion` | `.../processing/artifacts/<env>/*` |
| Publisher role | `ecr:GetAuthorizationToken` | `*` (the action has no resource-level permissions) |
| Publisher role | push and describe actions | `lai/processing-<env>` only |
| Lambda service | `ecr:BatchGetImage`, `GetDownloadUrlForLayer` (repository policy) | this repository, `aws:sourceArn` = the worker function |

Queue policies add explicit denies: `sqs:SendMessage` to the work queue is denied to every
principal except `lai-django-ec2-<env>`, and to the completion queue to every principal except
the worker role (plus TLS-only denies on all four queues). The worker role is the only normal
sender of completions.

**DLQ redrive (owner decision B7, 2026-11-17).** Only specifically authorized operations
administrators may redrive a DLQ: never ordinary staff or users, and never the Django role or the
worker role (the stack refuses both). Two separate stack props, both empty by default, name them:

| Prop (context / environment) | Granted by queue policy | Notes |
|---|---|---|
| `workRedriveRoleArns` (`processingWorkRedriveRoleArns` / `LAI_PROCESSING_WORK_REDRIVE_ROLE_ARNS`) | work DLQ: `sqs:StartMessageMoveTask`, `ListMessageMoveTasks`, `CancelMessageMoveTask`, `ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes`; work queue: `sqs:SendMessage` (exempt from `OnlyDjangoSendsWork`) | The normal redrive, after a worker fix |
| `completionRedriveRoleArns` (`processingCompletionRedriveRoleArns` / `LAI_PROCESSING_COMPLETION_REDRIVE_ROLE_ARNS`) | the same on the completion DLQ and completion queue (exempt from `OnlyTheWorkerSendsCompletions`) | **Rare** (a consumer fix after completions dead-lettered). A role listed here can put any message on the completion queue, so list one only for the redrive, then deploy again with `none` |

A work redrive role is never exempt on the completion queue, so it cannot forge completions.
The props take comma-separated `arn:aws:iam::<12 digits>:role/...` ARNs in the stack's account;
wildcards, users, other accounts, `lai-django-ec2-<env>` and `lai-<env>-processing-worker` are
refused at synth. The roles live outside CDK (the owner creates them, each with its own trust,
for example an IAM Identity Center permission set role) and must exist before the deploy that names
them: SQS rejects a policy whose principal does not exist. Operator path: assume the redrive
role, inspect the DLQ, then `aws sqs start-message-move-task --source-arn <DLQ ARN>` (no
destination: back to the source queue), and watch `list-message-move-tasks`. If the account's
guardrails (an SCP or a permissions boundary) do not honour same-account queue-policy grants for
the message-move actions, attach the same statements as an identity policy to that role. The
roles are `WorkRedriveRoleArns` and `CompletionRedriveRoleArns` outputs and are kept by later
deploys (section 6). LAI-LAMBDA-006 owns the replay runbook.

The worker has no RDS, Secrets Manager, SSM, KMS, Bedrock, Cognito, IAM or STS permission, no
`s3:Delete*`, `s3:List*` or ACL right, and no `*` resource. Tests pin every statement
(`infra/lib/processingStack.test.ts`).

Confirmed at integration: without `s3:ListBucket`, a `HeadObject` of a missing key returns 403,
which the S3 adapter reports as `permission_denied` (MANUAL, like `input_missing`). The worker
may read back its own `processing/artifacts/<env>/*` objects (grant `VerifyOwnArtifacts`): the
create-only put resolves a 412 by comparing the existing object's checksum, so a redelivered
attempt's identical rewrite is an idempotent success rather than `permission_denied`.

## 4. Queue and timeout arithmetic

| Quantity | Value | Rule |
|---|---|---|
| Worker timeout | 600 s | at most 840 s (`PLATFORM_CEILINGS.max_execution_seconds`); validated at synth |
| Cleanup margin | 30 s | `LAI_PROCESSING_CLEANUP_MARGIN_SECONDS`; a job's deadline is at most 570 s |
| Work visibility | 3600 s | at least 6 x timeout x batch size (6 x 600 x 1 = 3600); validated at synth |
| Completion visibility | 300 s | longer than the consumer's worst-case transaction |
| Retention | 14 days | covers the nightly stop, a weekend, an outage |
| Receives before the DLQ | 5 | both queues |
| Worker ephemeral storage | 2048 MB | input plus `max_temp_bytes` must fit; `DEFAULT_LIMITS` (50 MiB + 400 MiB) does. A profile that needs more raises `ephemeralStorageMb` (up to 10240) |
| Reserved concurrency | dev 2, prod 5 | `processingReservedConcurrency` context (`LAI_PROCESSING_RESERVED_CONCURRENCY`); also the mapping's `maximumConcurrency` (minimum 2); kept across deploys through the `ReservedConcurrency` output (section 6) |

A work message is delivered at most five times; a stuck attempt is visible again after an hour,
long after the 600 s function has ended.

Reserved concurrency is carved out of the account's regional Lambda concurrency, and Lambda
always keeps 100 unreserved: a reservation that would leave fewer fails the deploy. New accounts
can have a quota as low as 10. **Before phase 2, check the quota** (Service Quotas, "Concurrent
executions", and `aws lambda get-account-settings`, `UnreservedConcurrentExecutions`) and raise it
if needed; this is an owner step.

## 5. Alarms

All go to `lai-django-alarms-<env>` with missing data not breaching. Thresholds are props, and
the `processingAlarms` context (environment `LAI_PROCESSING_ALARMS`) takes JSON overrides, for
example `-c processingAlarms='{"workOldestMessageSeconds":900}'`. An unknown key is refused. The
overrides are the `AlarmOverrides` output and are kept across deploys (section 6).

| Alarm | Metric | Default | Phase |
|---|---|---|---|
| `work-oldest-message` | work `ApproximateAgeOfOldestMessage` (max, 5 min) | at least 3600 s | 1 and 2 |
| `work-queue-depth` | work visible messages, 3 x 5 min | dev 50, prod 200 | 1 and 2 |
| `completion-backlog` | completion `ApproximateAgeOfOldestMessage` | dev 43200 s (12 h, above the nightly stop), prod 3600 s | 1 and 2 |
| `work-dead-letters`, `completion-dead-letters` | DLQ visible messages | at least 1 | 1 and 2 |
| `worker-errors` | Lambda `Errors`, sum over 15 min | at least 1 | 2 |
| `worker-throttles` | Lambda `Throttles`, sum over 15 min | at least 1 | 2 |
| `worker-duration-high` | Lambda `Duration` p95, 2 x 5 min | 80% of the timeout (480,000 ms) | 2 |
| `worker-concurrency-high` | `ConcurrentExecutions` max, 3 x 5 min | ceil(90% of reserved): dev 2, prod 5 | 2 |

In phase 1 the work queue alarms cannot fire from real traffic (Django's backend is `disabled`).
In phase 2, `work-oldest-message` is the signal that the worker is not consuming.

## 6. Two-phase provisioning (bootstrapless)

The app has no CDK assets (`BootstraplessSynthesizer`, no `cdk bootstrap`), so the function's
code cannot be uploaded by CDK. The worker image is built and pushed by GitHub Actions and the
function references it by digest. The digest is CDK context `processingWorkerImageDigest`
(environment `LAI_PROCESSING_WORKER_IMAGE_DIGEST`), not a CloudFormation parameter, so that phase 1
synthesizes no function at all instead of a function with a placeholder image.

1. Deploy `LaiProcessing-<env>` without a digest: bucket, queues, roles, policy, settings
   (`LAI_PROCESSING_BACKEND=disabled`), queue alarms.
2. Deploy `LaiProcessingImages-<env>`; set the GitHub variables (section 8).
3. Run `deploy-processing.yml` with `build-push`: it prints `sha256:...`.
4. Run `deploy-processing.yml` with `deploy` and that digest (first without, then with
   `execute_change_set`): the function, mapping and worker alarms appear and the backend setting
   becomes `sqs`.
5. Release Django (native dev: the next release or `deploy-pending`; prod: the next image) so it
   renders the new settings; `lai-jobs-dispatch` and `lai-jobs-completions` then stop skipping
   themselves.

A deploy without the digest removes the worker. Every deploy-time setting of this stack is CDK
context, not a CloudFormation parameter, so a deploy that leaves one out would silently reset it.
The stack therefore outputs each one, and `scripts/aws/provision.sh` (and so `deploy-processing.yml`,
which calls it) and `scripts/aws/deploy-debug.sh` reuse the deployed value when the variable is
unset:

| Variable | Output | `''` or `none` |
|---|---|---|
| `LAI_PROCESSING_WORKER_IMAGE_DIGEST` | `WorkerImageDigest` | removes the worker on purpose |
| `LAI_PROCESSING_RESERVED_CONCURRENCY` | `ReservedConcurrency` | the default (dev 2, prod 5) |
| `LAI_PROCESSING_ALARMS` | `AlarmOverrides` (JSON, `{}` for none) | no overrides |
| `LAI_PROCESSING_WORK_REDRIVE_ROLE_ARNS` | `WorkRedriveRoleArns` | no role |
| `LAI_PROCESSING_COMPLETION_REDRIVE_ROLE_ARNS` | `CompletionRedriveRoleArns` | no role |

A stack deployed before these outputs existed has only the digest to keep; its first deploy from
this branch uses the defaults for the rest (which is what it was deployed with unless overridden).
`ReservedConcurrency` records the effective value, so once deployed it stays pinned even if the
code default later changes; set the variable to change it.

## 7. Deployment order

**Attaching a managed policy by name before it exists fails the platform stack's update**, so
`LaiProcessing-<env>` (phase 1) must exist before the next update of `LaiDevPlatform-dev` or
`LaiDjangoEc2-prod` from this branch. The images stack trusts the account's GitHub OIDC provider,
which `LaiDevPlatform-dev` (dev, `CreateGithubOidcProvider`) or `LaiDjangoRelease` (prod) creates.

| Order | Dev (`scripts/aws/deploy-debug.sh`) | Prod (`scripts/aws/provision.sh prod`) |
|---|---|---|
| 1 | `LaiDevArtifacts-dev` | `LaiAssetStorage-prod` |
| 2 | `LaiAssetStorage-dev` | `LaiChildPhotos-prod` |
| 3 | `LaiChildPhotos-dev` | `LaiDjangoRelease` (OIDC provider) |
| 4 | **`LaiProcessing-dev`** (phase 1 until a digest exists) | **`LaiProcessingImages-prod`** |
| 5 | `LaiDevPlatform-dev` (attaches `lai-django-processing-dev`) | **`LaiProcessing-prod`** (phase 1) |
| 6 | **`LaiProcessingImages-dev`** | `LaiDjangoEc2-prod` (attaches `lai-django-processing-prod`) |
| 7 | `LaiAiGuardrail-dev` | `LaiFrontend-prod` (us-east-1) |
| 8 | `LaiFrontend-dev` (us-east-1) | |

Then: build-push the image, deploy `LaiProcessing-<env>` with the digest (phase 2), release
Django. To delete: detach the policy (deploy the platform stack without it) before deleting
`LaiProcessing-<env>`; the bucket, the ECR repository and prod's queues and log group are retained.

## 8. GitHub Actions

| Workflow | Triggers | Deploys? | AWS |
|---|---|---|---|
| `ci.yml` job `processing-image` | existing `push` to `main`, `pull_request` | No | None. Builds `processing/Dockerfile.lambda` for linux/arm64 with buildx and QEMU, loads it locally, imports `lai_processing_runtime.lambda_handler` inside it, scans it with `aquasecurity/trivy-action` v0.36.0 (pinned by commit SHA) |
| `deploy-processing.yml` | `workflow_dispatch` only | Only when dispatched by a person, approved in `processing-<env>`, from `main`, with `LAI_PROCESSING_DEPLOY_ENABLED == 'true'` | OIDC: `LAI_PROCESSING_PUBLISHER_ROLE_ARN` (build-push), `LAI_PROCESSING_DEPLOY_ROLE_ARN` (deploy, rollback) |
| `deploy-dev-native.yml` | existing `push` to `main` on backend paths, now including `processing/**` | Native dev only. Every job requires the repository variable `LAI_DEV_NATIVE_ENABLED == 'true'` and `refs/heads/main`, directly or through the job it `needs`: a merge to `main` that touches `processing/**` releases native dev **only when that variable is exactly `true`**; otherwise the run starts and every job is skipped | unchanged roles |

`deploy-processing.yml` inputs: `environment` (`dev`, `prod`), `action` (`build-push`, `deploy`,
`rollback`), `image_digest` (deploy and rollback), `execute_change_set` (default false: the change
set is created and left for review in the CloudFormation console). `build-push` builds a single
linux/arm64 manifest (no provenance or SBOM attestations, which Lambda cannot take), pushes it
tagged with the full commit SHA (immutable; an existing tag is reused, never moved) and prints
the digest. `deploy` checks that the digest is in `lai/processing-<env>`, then runs
`scripts/aws/provision.sh <env> --only LaiProcessing-<env> [--execute]`, which synthesizes with the
digest and creates the change set. `rollback` is `deploy` with an earlier digest; the repository
keeps the newest 30 images, so the target must be among them.

**ECR retention and the running digest.** The "newest 30 images" rule counts pushes, not
deployments: after 30 newer `build-push` runs, the digest the function runs can be expired. Lambda
keeps serving a cached copy for a while, but a function whose image is gone fails when Lambda next
re-optimizes it (for example after it goes idle) and cannot be redeployed or rolled back to that
digest. Mitigation, until a tag-based retention rule exists: deploy (or roll back) to one of the
newest 30 images before pushing the 30th newer one, which in practice means deploying what you
build; the deploy job already refuses a digest that is no longer in the repository. A later
improvement is to tag deployed images `deployed-<sha>` and exclude that prefix from the count
rule (needs `ecr:PutImage` for the deploy role).

**Branch enforcement.** The workflow checks `github.ref == 'refs/heads/main'`, but what enforces
`main` for the OIDC roles is the `processing-<env>` environment's deployment branch rule
(`main` only, owner step B5): the roles trust `repo:<owner/repo>:environment:processing-<env>`, and
only a job admitted to that environment receives a token with that subject.

CI image checks: the scan fails only on CRITICAL vulnerabilities that have a fix
(`ignore-unfixed`), so the job reports actionable findings without blocking on unfixable base
image CVEs; HIGH findings are visible in ECR scan-on-push results after a push.

Merging a pull request deploys nothing new: `ci.yml` has no AWS access and no push step, and
`deploy-processing.yml` has no automatic trigger. The only automatic deployment touched is the
pre-existing native dev release, now also started by a `processing/**` change.

## 9. Power schedule interplay (dev)

- The `lai-dev-power` state machine is unchanged; it already runs the power document, and
  `power-native.sh` is extended. `quiesce` stops `lai-jobs-dispatch` first (no new work
  leaves), then `lai-jobs-completions`, then `lai-jobs-consumer`, then gunicorn. `verify` starts
  the consumer, then `lai-jobs-completions` (drains what arrived overnight), then
  `lai-jobs-dispatch`, after the health check.
- The Lambda worker keeps consuming overnight: it needs only S3 and SQS. Completions wait in the
  completion queue (14 days); the dev `completion-backlog` alarm threshold (12 h) is above the
  nightly stop so it does not page every night.
- Both new units carry `ExecCondition=/usr/bin/test "${LAI_PROCESSING_BACKEND}" = sqs`: while the
  backend is `disabled` (phase 1, or before LAI-LAMBDA-004 ships the commands) systemd skips them
  instead of restarting a failing command every 30 s.

## 10. Native release and prod image

- `scripts/aws/native/package-release.sh` builds `lai_processing-<version>-py3-none-any.whl` from a
  copy of `processing/` with `pip wheel --no-deps` (`SOURCE_DATE_EPOCH` = commit time) into the
  release wheelhouse; `deploy-native.sh` installs it with `--no-index --no-deps` after the
  requirements. The package job in `deploy-dev-native.yml` fails a release without the wheel.
  The pyproject's `lai_processing*` include also packages `lai_processing_runtime` (003).
- `lai/Dockerfile` copies `processing/` and installs it with `--no-deps`; effective at the next
  authorized prod image build (ADR-037). `deploy-django-ec2.yml` path filters are unchanged, so a
  `processing/`-only change does not by itself build a prod image.
- The deploy and setup scripts install and enable `lai-jobs-dispatch.service` and
  `lai-jobs-completions.service` with the other units (`LAI_UNITS` in `lib-native.sh`); their logs
  go to `/var/log/lai/jobs-{dispatch,completions}.log` and the `/lai/dev/jobs` log group.
- Prod (ADR-037): `deploy/ec2/docker-compose.yml` runs the same two commands as services
  `jobs-dispatch` and `jobs-completions` (Django's image, `django.env`, certificates and network; no
  port; `restart: unless-stopped`; the image's gunicorn health check disabled; 60 s stop grace for
  the consumer's long poll). They are in the release's compose project, so every release and
  rollback (`up -d --wait --remove-orphans`) starts and replaces them with Django and the next
  image's settings. A shell gate runs the command only while `LAI_PROCESSING_BACKEND` is `sqs`;
  otherwise the service idles until stopped (the commands exit 0 at once for `disabled`, which
  would fail `up --wait` or hot-loop). Logs go to the app log group, streams
  `jobs-{dispatch,completions}-<sha>`. Tests: `tests/deploy/test_prod_compose_processing.py`.

## 11. Cost assumptions (estimates, not quotes)

us-west-1, list prices as understood in November 2026 (check the AWS Pricing Calculator):
Lambda arm64 about $0.0000134 per GB-second and $0.20 per million requests, ephemeral storage
above 512 MB about $0.0000000309 per GB-second; SQS $0.40 per million requests (first million
free per account); S3 Standard about $0.026 per GB-month; ECR $0.10 per GB-month; CloudWatch
$0.10 per standard alarm and about $0.50 per GB of logs ingested. Free tiers are shared with the
account's other projects and are ignored.

| Item | Dev assumption | Dev / month | Prod assumption | Prod / month |
|---|---|---:|---|---:|
| Lambda compute | 2,000 jobs x 60 s x 2 GB = 240,000 GB-s | $3.20 | 20,000 jobs x 60 s x 2 GB = 2.4 M GB-s | $32 |
| Lambda ephemeral and requests | 1.5 GB extra x 120,000 s | under $0.05 | | under $0.50 |
| SQS | event-source long polling (about 650,000 empty receives) plus Django's 20 s polls | about $0.30 | about 1.5 M requests | about $0.60 |
| S3 | 5 GB, artifacts expire at 90 days | $0.15 | 50 GB, current artifacts kept | $1.30 |
| ECR | up to 30 images x about 300 MB | up to $0.90 | same | up to $0.90 |
| CloudWatch alarms | 9 | $0.90 | 9 | $0.90 |
| CloudWatch logs | 0.2 GB, 14 days | $0.10 | 2 GB, 90 days | $1.10 |
| **Total** | | **about $5** | | **about $37** |

Lambda scales with GB-seconds: halve the memory or the job duration and that line halves. Idle,
the cost is the SQS polling, ECR storage, alarms and logs (about $2 a month per environment).
Reserved concurrency caps the worst case (dev: 2 x 2 GB x 2.6 M s a month, about $140, only if
the queue never empties). No NAT gateway, VPC endpoint, load balancer or KMS key is added.

## 12. Deployment blockers and owner steps

| # | Blocker | Owner step |
|---|---|---|
| B1 | Deployment approval (ADR-019 G7, WAVE2_HANDOFF A9) | Approve each change set (sections 6 and 7) |
| B2 | Resolved at integration: `processing/Dockerfile.lambda` and `lai_processing_runtime` (LAI-LAMBDA-003) are on the Wave 2 branch; the image has not yet been built by CI or anyone | Let CI build it on the Wave 2 PR before any `build-push` |
| B3 | Resolved at integration: `manage.py jobs_dispatch` and `jobs_consume_completions` (LAI-LAMBDA-004) are on the Wave 2 branch | Keep the backend `disabled` (phase 1) until a release with 004 is deployed; the units skip themselves |
| B4 | Decided (owner, 2026-11-17): GitHub Actions with AWS OIDC deployment roles. Not yet provisioned: no IaC role can deploy `LaiProcessing-<env>` from GitHub (`lai-dev-infra-manage` only operates power, `lai-github-deploy-prod` only sends SSM documents, and both trust other GitHub environments) | Create a deploy role per environment trusting `repo:<owner/repo>:environment:processing-<env>` (CloudFormation on `LaiProcessing-<env>` only, with a CloudFormation service role scoped to the stack's resources; `cloudformation:DescribeStacks` for the kept settings; `ecr:DescribeImages` on `lai/processing-<env>`; and `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer` on that repository, which CloudFormation needs, through the caller or the service role, to create or update an image function) and set `LAI_PROCESSING_DEPLOY_ROLE_ARN`. Until then, `scripts/aws/provision.sh <env> --only LaiProcessing-<env>` from an admin workstation. Such a role can change the Django policy's content, so it is as privileged as the reviewers of `processing-<env>` |
| B5 | Approved (owner, 2026-11-17); deployment stays disabled | Create environments `processing-dev` and `processing-prod` with required reviewers and a **`main`-only deployment branch rule** (this rule, not the workflow's `github.ref` check, is what limits the OIDC roles to `main`); set `LAI_PROCESSING_PUBLISHER_ROLE_ARN` (images stack output) and, after B4, `LAI_PROCESSING_DEPLOY_ROLE_ARN` on each. Leave repository variable `LAI_PROCESSING_DEPLOY_ENABLED` unset (or anything but `true`) until deployment is approved |
| B6 | Decided (owner, 2026-11-17): provision the phase-one processing stacks before dependent platform updates | Deploy `LaiProcessing-<env>` (phase 1) before the next platform update from this branch (section 7) |
| B7 | Decided (owner, 2026-11-17): DLQ redrive only by specifically authorized operations administrators, never ordinary staff or users, never the Django role | Create the operator role(s) outside CDK, then deploy `LaiProcessing-<env>` with `LAI_PROCESSING_WORK_REDRIVE_ROLE_ARNS` (and, only for a rare completion redrive, `LAI_PROCESSING_COMPLETION_REDRIVE_ROLE_ARNS`); section 3. The Django role has no redrive permission and the stack refuses to name it (LAI-LAMBDA-006 owns the runbook) |
| B8 | Alarm topic: dev's topic is created by `LaiDevPlatform-dev`, prod's by `LaiDjangoEc2-prod` | Nothing in order; alarms created first point at the topic by ARN and notify once it exists |
| B9 | `docs/IMPLEMENTATION_STATUS.md` | The principal records this task when merging Wave 2 |
