# Native AWS development environment (`dev`)

Reference for the low-cost development and debugging environment (ADR-055). The commands to
deploy and operate it are in the root `README.md`, section "AWS Development Infrastructure -
Deployment and Operations"; this document explains what those commands build and why.

Status: implemented in the repository and validated locally (CDK synthesis, cfn-lint, unit and
script tests). **Nothing has been deployed.** Provisioning, every deploy and the live acceptance
checklist are owner-approved steps, and the environment must not be called operational until a
live deployment and acceptance run have succeeded.

## 1. What runs where

```text
                       Browser (parent or child)
                                 |
                  https://lai.pauldimitriu.com  (ACM, us-east-1)
                                 |
                        CloudFront  LaiFrontend-dev
               /  default: private S3 web bucket (OAC), SPA rewrite
              /   /api/*:  no cache, all viewer headers, cookies, query strings
             /                   |
  S3 lai-web-dev-...             |  HTTPS to api.pauldimitriu.com (Let's Encrypt on nginx)
                                 v
  us-west-1  ------------------------------------------------------------------------------
  VPC 10.42.0.0/16 (no NAT gateway, no VPC endpoints)
   public subnet                                     isolated subnets (2 AZs)
   EC2 t4g.small, Amazon Linux 2023 ARM64            RDS PostgreSQL 16 db.t4g.micro
   Elastic IP, SSM only (no SSH)                     Single-AZ, encrypted, TLS only,
   nginx :443 :80 -> gunicorn 127.0.0.1:8000  -----> not publicly accessible
   lai-jobs-consumer (results queue -> RDS)
        |  ^
        |  |  SQS lai-dev-job-results (14 day retention, survives the nightly stop)
        v  |
   SQS lai-dev-jobs-ai / lai-dev-jobs-media (+ DLQs)
        |
   Lambda lai-dev-jobs-ai / lai-dev-jobs-media (arm64, python3.12, outside the VPC)
        -> Bedrock (Guardrail from SSM), Polly, S3 (speech, assets, job results)

   Step Functions lai-dev-power  <- EventBridge Scheduler (00:00 stop, 07:35 start, Pacific)
                                 <- manage-dev.sh / "Manage DEV Infrastructure" workflow
                                 <- RDS-EVENT-0154 (RDS restarted itself after 7 days)
```

The Django Admin host (`ladm.pauldimitriu.com`) resolves straight to the Elastic IP. It is never
routed through the public site's CloudFront distribution, and nginx refuses `/api/` on it.

## 2. Development versus production

| Area | `dev` (ADR-055) | `prod` (ADR-037, unchanged) |
| --- | --- | --- |
| Stacks | `LaiDevArtifacts-dev`, `LaiDevPlatform-dev` | `LaiDjangoRelease`, `LaiDjangoEc2-prod` |
| Django runtime | native venv, systemd, ARM64 `t4g.small` | Docker Compose, image from ECR, x86 `t3.medium` |
| TLS for the API | nginx with Let's Encrypt | ALB with ACM |
| Admin login throttling | nginx `limit_req` (10 per minute per IP) | WAF rate rule |
| Release unit | tarball + aarch64 wheelhouse in S3, by commit | container image, by digest |
| Async work | Lambda + SQS (`apps.jobs`) | in-process (Studio `thread` mode) |
| Availability | stopped 00:00 to about 08:00 Pacific | always on |
| Shared | asset, child photo, Guardrail and frontend stack code; Cognito pool | same |

Why dev needs no Docker, ALB or WAF: one instance needs no load balancing; nginx terminates TLS
with a free certificate; the admin login rate limit moves from WAF into nginx; and the release
artifact is a plain tarball with prebuilt ARM64 wheels, so no image registry is involved. Dev
therefore does not exercise the production container path; production releases are still
verified by their own pipeline.

## 3. Stacks, regions and order

| Order | Stack | Region | Purpose |
| --- | --- | --- | --- |
| 1 | `LaiDevArtifacts-dev` | us-west-1 | release tarballs, Lambda zips, large job results, CloudFormation template uploads (`tmp/cfn/`) |
| 2 | `LaiAssetStorage-dev` | us-west-1 | asset library bucket and Django policy |
| 3 | `LaiChildPhotos-dev` | us-west-1 | private child photo bucket and policy |
| 4 | `LaiDevPlatform-dev` | us-west-1 | VPC, EC2, Elastic IP, RDS, speech bucket, SQS, Lambda, power state machine, schedules, SSM, IAM, alarms, budget |
| 5 | `LaiAiGuardrail-dev` | us-west-1 | child-safety Guardrail; attaches its policy to the instance role `lai-django-ec2-dev`, so it follows the platform |
| 6 | `LaiFrontend-dev` | us-east-1 | web bucket, CloudFront, ACM certificate for the site |

All templates are synthesized by `npm run infra:synth` into `infra/cdk.out/` with CDK's
bootstrapless synthesizer: no `cdk bootstrap` stack is needed. `LaiDevPlatform-dev` is about
200 KB, above CloudFormation's 51,200-byte inline limit, so it is deployed from an S3 URL in the
artifacts bucket (the console upload also accepts the file directly, because the console stages
it in S3 for you). The only uploaded artifact the templates reference is the Lambda zip
(`WorkerCodeKey`), built by `scripts/aws/package-lambda.sh`.

Capabilities: every stack needs `CAPABILITY_NAMED_IAM`.

## 4. Parameters (CloudFormation) versus settings (CDK context)

CloudFormation parameters of `LaiDevPlatform-dev` (change them with a stack update; defaults in
brackets): `Environment` [dev], `AmiId` (required; pinned ARM64 AL2023 image), `InstanceType`
[t4g.small; Graviton families only], `EC2VolumeSize` [15], `SwapSizeMb` [1024],
`DatabaseInstanceClass` [db.t4g.micro], `DatabaseStorageSize` [20], `DatabaseMaxStorageSize` [50],
`DatabaseMultiAZ` [false], `DatabaseBackupRetention` [3], `DatabaseDeletionProtection` [true],
`EnableLambdaProcessing` [true], `WorkerCodeKey` (required when Lambda is on), `LambdaMemorySize`
[512], `LambdaConcurrencyLimit` [2], `EnableScheduledShutdown` [true], `ShutdownTime` [00:00],
`StartupTime` [07:35, when startup begins], `StartupWarmupMinutes` [25], `ScheduleTimezone`
[America/Los_Angeles], `SiteDomainName` [lai.pauldimitriu.com], `ApiDomainName`
[api.pauldimitriu.com], `AdminDomainName` [ladm.pauldimitriu.com], `CognitoUserPoolId` and
`CognitoClientId` (required), `HostedZoneId` and `HostedZoneName` ['' = DNS elsewhere],
`CertificateEmail` [''], `CloudFrontOriginPrefixListId` (required), `AdminAllowedCidr` ['' = no
direct public admin or API access], `OpenHttpPort` [false; must be true without a hosted zone],
`CreateGithubOidcProvider` [true], `GitHubRepository` [paulj3000/learning], `AlarmEmail` [''],
`MonthlyBudgetUsd` [40], `LogRetentionDays` [14]. Template rules reject a missing hosted zone
without `OpenHttpPort=true`, a zone id without its name, and Lambda processing without a code key.

`LaiFrontend-dev` parameters: `SiteDomainName`, `ApiDomainName`.

CDK synthesis settings (environment variable or `-c` context, fixed in the template): `LAI_ENV`
(dev), `LAI_HOSTED_ZONE_ID` and `LAI_HOSTED_ZONE_NAME` (the site certificate's validation and
alias records), `LAI_GITHUB_REPOSITORY`, `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION`. Values that
are runtime switches rather than infrastructure (Gunicorn workers, schedule pause, shutdown hold,
pending deployments) are SSM parameters, so changing them needs no stack update (section 7).

`deploy-debug.sh` computes `StartupTime` from `LAI_AVAILABLE_BY` (08:00) minus
`LAI_STARTUP_WARMUP_MINUTES` (25), resolves the AMI and the CloudFront origin-facing prefix list,
and detects an existing GitHub OIDC provider.

## 5. Outputs

`LaiDevPlatform-dev`: Environment, AWSRegion, InstanceId, InstanceType, ElasticIPAddress,
DatabaseIdentifier, DatabaseEndpoint, DatabasePort, DatabaseSecretArn (an ARN, not the secret),
AssetBucketName, SpeechBucketName, ArtifactBucketName, LambdaProcessingQueueUrl (AI queue),
LambdaMediaQueueUrl, LambdaResultsQueueUrl, AiWorkerFunctionName, MediaWorkerFunctionName,
ShutdownScheduleName, StartupScheduleName, PowerStateMachineArn, InfrastructureManagementRoleArn,
BackendDeploymentRoleArn, SiteUrl, ApiBaseUrl, AdminBaseUrl, DeployDocumentName, ParameterPrefix.
`LaiFrontend-dev`: WebBucketName, DistributionId, DistributionDomainName, CloudFrontUrl, SiteUrl,
SiteCertificateArn, SiteDeployRoleArn and FrontendDeploymentRoleArn (the same role).
`scripts/aws/show-endpoints.sh` prints them together with live state.

## 6. The instance

- **Setup** (`scripts/aws/native/setup-native.sh`, about 10.5 KB, run from user data and by the
  SSM document `lai-dev-native-setup`): packages from the Amazon Linux 2023 repositories (nginx,
  python3.12, python3.12-devel, gcc, the postgresql16 client, jq, git, logrotate, the CloudWatch
  agent), the `lai` service account, `/opt/lai/{releases,current,runtime,state}`, `/etc/lai`,
  `/var/log/lai`, a 1 GB swap file, the RDS CA bundle, certbot 4.0.0 in its own venv, systemd
  timers, and the CloudWatch agent (logs to `/lai/dev/{django,nginx,deploy,jobs}`; memory and
  disk metrics). No Docker and no PostgreSQL server. It is idempotent. User data runs only on the
  first boot; rerun setup through the SSM document.
- **Services**: `nginx`, `lai-gunicorn` (gunicorn on 127.0.0.1:8000; workers from
  `WEB_CONCURRENCY`, default 3 for 2 GB; `max_requests` with jitter), `lai-jobs-consumer`,
  `lai-certbot-renew.timer` (twice daily and after boot), `lai-maintenance.timer` (daily,
  persistent, so a missed run happens after the morning start). All are enabled and come back
  after a stop and start.
- **TLS**: one Let's Encrypt certificate `lai-dev` for the API and admin hosts. With a Route 53
  zone it is issued by DNS-01 (the instance may change only `_acme-challenge.*` records);
  otherwise by HTTP-01 on port 80, which needs the A records to point at the Elastic IP first.
  Until it is issued nginx serves a self-signed placeholder and CloudFront's `/api/*` answers 502.
- **nginx**: no access log (request paths carry child ids, ADR-025); the API host serves `/api/`
  only; the admin host serves the admin and redirects `/` to `/admin/`; unknown hosts get no
  answer; admin login POSTs are limited per IP; bodies are capped at 55 MB.
- **Django**: `config.settings.production`, `DEBUG=False`, settings from SSM `/lai/dev/django/*`
  rendered into `/opt/lai/runtime/django.env` (root:lai 0640) with `DATABASE_URL` built from the
  RDS secret and `sslmode=verify-full`. The renderer refuses `DEBUG`, `DJANGO_SETTINGS_MODULE`,
  `AWS_*` and a hand-written `DATABASE_URL`.
- **Debugging without exposing errors**: tracebacks never reach a response. Use the logs
  (`manage-dev.sh logs django`), `manage-dev.sh connect` and, on the instance,
  `sudo -u lai /opt/lai/current/venv/bin/python /opt/lai/current/lai/manage.py shell` with the
  environment from `django.env`.

## 7. Runtime switches (SSM)

| Parameter | Meaning |
| --- | --- |
| `/lai/dev/django/*` | Django settings; `DJANGO_SECRET_KEY` is a SecureString the installer creates once |
| `/lai/dev/django/WEB_CONCURRENCY` | gunicorn workers (default 3); takes effect at the next deploy or restart |
| `/lai/dev/power/schedule-paused` | `true` skips scheduled stops and starts |
| `/lai/dev/power/hold-until` | `none` or a UTC time before which scheduled stops are skipped |
| `/lai/dev/power/state` | written by the state machine: running, stopping, stopped, starting, degraded |
| `/lai/dev/power/last-result` | JSON outcome of the last power run |
| `/lai/dev/deploy/last-release` | the release the instance last recorded |
| `/lai/dev/deploy/pending` | `none` or the release waiting for the next start |
| `/lai/dev/deploy/apply-pending-on-start` | `true` applies a pending release during the morning verify |

## 8. Releases

1. CI (`deploy-dev-native.yml`) or the installer runs the Django checks, then
   `scripts/aws/native/package-release.sh`: a deterministic tarball (`git ls-files`, sorted, fixed
   times and owners) with `lai/`, `content/`, `react/public/models/`, `requirements.txt`, an
   aarch64 cp312 wheelhouse from `pip download --only-binary=:all:`, `deploy/native/` and
   `scripts/aws/native/`, plus a manifest with its SHA-256.
2. `scripts/aws/dev-release.sh upload` puts both under `releases/django/<sha>` with a conditional
   write, so a published release can never be replaced.
3. `dev-release.sh deploy` sends `lai-dev-native-deploy` (pattern-checked parameters only). On the
   instance `ssm-native-entry.sh` refuses while the power state is stopping or stopped (75),
   downloads and verifies the checksum, unpacks into `/opt/lai/releases/<sha>/` and runs that
   release's `deploy-native.sh`: lock, ordering check, settings, offline venv from the
   wheelhouse, database connectivity, `check --deploy`, migration plan with the destructive
   operation guard, migrate, collectstatic, atomic switch of `/opt/lai/current`, restart, health
   check, record (`/opt/lai/state/releases.jsonl`, `/lai/dev/deploy/last-release`), prune (three
   newest healthy releases plus current and previous).
4. An unhealthy release is switched back to the previous one automatically. Migrations are never
   reversed; the record says `manual_db_review_required` when the failed release applied any.

Exit codes: 0 ok, 2 usage, 10 invalid or out of order, 20 artifact download or checksum, 30
configuration, 40 preflight, 45 destructive migrations refused, 50 migration failed, 60 unhealthy
and rolled back, 61 unhealthy with nothing to roll back to, 62 rollback failed, 63 nothing to roll
back, 70 another release holds the lock, 75 refused because dev is stopping or stopped.

**A commit reaches `main` while dev is stopped.** The release is built and uploaded as usual. With
`LAI_DEV_STOPPED_DEPLOY=defer` (default) the deploy step records it in `/lai/dev/deploy/pending`
(only if newer than what is already pending) and succeeds with a "pending" summary; nothing is
started, so no unexpected EC2 or RDS charge. At the next start the verify step applies it before
reporting ready. To deploy immediately, run `./scripts/aws/manage-dev.sh start-and-deploy` or the
workflow operation of the same name. The site (S3) is published regardless: S3 and CloudFront are
always on, and the backend catches up at the next start.

## 9. Background processing

Django keeps every database write. A job is a `ProcessingJob` row; Django sends a work message to
SQS; the Lambda worker does the external call and writes the result to S3 (`jobs/results/`) before
sending a result message; `lai-jobs-consumer` applies results in a transaction and ignores
duplicates and results for finished jobs. Lambda is outside the VPC and never connects to RDS, so
no NAT gateway or endpoint is needed, and results simply wait in the queue (14 days) while the
instance is stopped. Retries: three receives, then the queue's DLQ (alarmed). A job that never
reports is marked failed (`timeout`) by `jobs_sweep` in the daily maintenance timer. The model id
must be on the approved list, and the Guardrail id and version are read by the worker from SSM,
never from the message; model output is validated by Django exactly as before.

Workload status:

| Workload | Where it runs now | Notes |
| --- | --- | --- |
| AI Question Studio batch generation (Bedrock) | **Lambda** (`studio.generate_chunk`, `LAI_STUDIO_RUN_MODE=jobs`) | One chunk in flight per batch; Django does the same accounting, validation, kill switch and token quota as before, then queues the next chunk. Questions stay drafts |
| NPC speech pre-generation after a publish (Polly, authored lines only) | **Lambda** (`speech.synthesize`) when `LAI_JOBS_BACKEND=sqs` | Same cache key, caps and records as the synchronous path; child-scoped speech never leaves Django. Polly runs in Django's `LAI_SPEECH_AWS_REGION` |
| Asset inspection: GLB/glTF structure, PNG/JPEG/WebP size, WAV/Ogg/MP3 basics | **Lambda** (`asset.inspect`), Django Admin action "Inspect in background" | Results are stored on the job; published asset metadata is never rewritten |
| Chatty companion and tutor turns, interactive `speak()` | Django, synchronous | Latency-sensitive gameplay; deliberately not queued |
| Upload validation (size, format sniffing) | Django, synchronous | Fast, needed before the upload is accepted |
| Speech cache cleanup, AI audit retention, job sweep | EC2 `lai-maintenance.timer` | Need the database; Lambda has no database access by design |
| Temporary objects and old artifacts | S3 lifecycle rules | No compute needed |
| GLB optimization (meshopt/Draco, KTX2 textures), thumbnails, image resizing and conversion, audio transcoding and loudness | **Not migrated** (tracked) | Need native tools (gltf-transform with Node, Pillow or libvips, FFmpeg) built for arm64 and benchmarked against Lambda's 15-minute, 10 GB memory and 10 GB `/tmp` limits; FBX or Blender work does not fit Lambda and would need Fargate (an owner decision). Trello LAI-LAMBDA-008 and LAI-LAMBDA-010 |

Settings: `LAI_JOBS_BACKEND` (`inline` locally and in tests, `sqs` in dev, `disabled` by default in
production), `LAI_JOBS_AI_QUEUE_URL`, `LAI_JOBS_MEDIA_QUEUE_URL`, `LAI_JOBS_RESULTS_QUEUE_URL`,
`LAI_JOBS_RESULTS_BUCKET`, `LAI_JOBS_STALE_MINUTES` (60), `LAI_JOBS_RETENTION_DAYS` (30). Staff see
every job (pending, running, completed, failed) under Django Admin, Jobs, Processing jobs, and a
Studio batch shows its jobs. The `npc_pregenerate_speech` report gains a `queued` count.

The AI and Polly settings the workers need (`LAI_AI_PROVIDER`, `LAI_AI_BEDROCK_REGION`,
`LAI_AI_MODEL_ID`, `LAI_AI_GUARDRAIL_ID`, `LAI_AI_GUARDRAIL_VERSION`, `LAI_STUDIO_MODEL_ID`,
`LAI_STUDIO_APPROVED_MODEL_IDS`, `LAI_SPEECH_PROVIDER`, `LAI_SPEECH_AWS_REGION`) are not written by
any stack, because turning them on starts paid Bedrock and Polly use. `install-debug.sh
--enable-ai --enable-speech` creates them from `LaiAiGuardrail-dev`'s outputs when missing and
never overwrites an existing value. Without them the AI routes use their authored fallbacks and a
Studio chunk fails with `configuration`.

Known ordering caveat: `jobs_sweep` runs at 20:00 UTC while dev is up, after the consumer has
drained the night's results. If it ever ran before the consumer caught up, a job whose result was
still queued would be marked `timeout` and its late result ignored as a duplicate.

### Development seed publishing

`publish_treasure_rush` normally refuses to run anywhere but a developer's machine (DEBUG on and
a loopback database). For the first dev install, `install-debug.sh --dev-bootstrap-publish` runs
the bootstrap task `publish-seed-content`, which sets `LAI_DEV_BOOTSTRAP_PUBLISH=true` and
`LAI_ENVIRONMENT=dev` in the environment of that one command only. Production settings refuse the
flag unless `LAI_ENVIRONMENT=dev`, and the settings renderer refuses both names from SSM, so a
running server never has them. Every content validation (`full_clean`, a playable region, active
catalog rows) still applies; only the local-machine guard is waived.

## 10. Power management

`lai-dev-power` (Step Functions Standard, SDK integrations only, bounded polling loops):

- **stop**: skipped for scheduled and RDS-event runs when the schedule is paused or a hold is in
  effect (`--force` ignores a hold); power state `stopping` (deploys refuse from here); best
  effort `quiesce` on the instance (stop the consumer, then gunicorn, after any running release);
  stop EC2 and wait; stop RDS (waiting out a transient state first) and wait; state `stopped`.
- **start**: skipped for a scheduled run while paused; state `starting`; start RDS and wait for
  `available`; start EC2 and wait for `running` and SSM `Online`; `verify` on the instance (nginx,
  gunicorn, database, readiness, start the consumer, apply a pending release); state `running`,
  or `degraded` with a failed execution.
- **Schedules**: `lai-dev-nightly-stop` at `ShutdownTime` and `lai-dev-morning-start` at
  `StartupTime`, both in `America/Los_Angeles`; EventBridge Scheduler applies daylight saving time
  itself. `EnableScheduledShutdown=false` disables both; `pause-schedule` and `hold` are runtime
  overrides that need no stack update.
- **RDS seven-day restart**: AWS restarts a stopped DB instance after seven days. The rule on
  `RDS-EVENT-0154` runs a stop, which is skipped if dev is meant to be running.
- **Locking**: the CLI and the workflow refuse to start a power run while another is running.
  Scheduled runs are not serialized against a manual one; both flows are idempotent.

What stays on while stopped: S3, CloudFront, Cognito, SQS (results wait), Lambda, Secrets
Manager, SSM, the Elastic IP (still billed), EBS and RDS storage, backups and snapshots.

## 11. Security

- RDS: isolated subnets, no public endpoint, security group admits only the instance, TLS forced,
  encrypted storage, deletion protection on by default, final snapshot on stack deletion.
- EC2: IMDSv2 only (hop limit 1), encrypted gp3 root, no key pair, no inbound SSH, SSM for shell
  access. Port 443 admits the CloudFront origin-facing prefix list (its own security group, about
  55 rule entries) and optionally `AdminAllowedCidr`; port 80 only when `OpenHttpPort=true`.
- Buckets: all private, public access blocked, TLS required; child photos are never behind a CDN.
- IAM: the GitHub roles trust one GitHub Environment each (`dev-backend`, `dev-infrastructure`,
  `site-dev`) through OIDC; no access keys anywhere. Neither GitHub role can start or stop
  anything directly; only the state machine's role can, and only for the dev instance and the
  `lai-dev` database. No role here can touch production resources.
- Secrets: the database secret in Secrets Manager, `DJANGO_SECRET_KEY` as a SecureString, the
  transient admin password parameter deleted by the installer. Nothing secret is in a template,
  output, frontend build or log line.
- Data: dev uses synthetic or dedicated test accounts only. Never import real production child
  information into it.

## 12. Costs (us-west-1, November 2026 estimates, not quotes)

| Item | Always on | Nightly schedule (about 16.5 h a day) | While stopped |
| --- | ---: | ---: | --- |
| EC2 t4g.small (about $0.020/h) | $14.60 | $10.00 | $0 |
| RDS db.t4g.micro PostgreSQL (about $0.021/h) | $15.00 | $10.30 | $0 |
| EBS gp3 15 GB | $1.45 | $1.45 | billed |
| RDS gp3 20 GB (backups up to the DB size are free) | $2.75 | $2.75 | billed |
| Elastic IP / public IPv4 ($0.005/h) | $3.65 | $3.65 | billed |
| Secrets Manager (1 secret) | $0.40 | $0.40 | billed |
| S3, CloudFront, CloudWatch logs and metrics, Step Functions, Scheduler | $1 to $3 | $1 to $3 | mostly billed |
| Lambda, SQS | under $1 at dev volume | under $1 | per use |
| **Total** | **about $40** | **about $30** | |

Not included: Bedrock tokens and Polly characters (bounded by the existing daily limits and the
Bedrock budget in `LaiAiGuardrail-dev`), data transfer beyond the free tier, snapshots you keep,
and Route 53 hosted zone fees ($0.50 a month per zone). Burstable instances: `t4g.small` earns 24
CPU credits an hour and runs unlimited mode by default, so sustained load above the 20% baseline
is billed at about $0.04 per vCPU-hour; `db.t4g.micro` behaves the same. Watch `CPUCreditBalance`.
Verify with the [AWS Pricing Calculator](https://calculator.aws/#/). Cost reductions: lengthen the
nightly window, stop over weekends with `hold`/`pause-schedule` plus `stop`, shrink logs, or drop
the Elastic IP (not recommended: DNS would break at every start).

## 13. Recovery and deletion

- **Application rollback**: `dev-release.sh rollback [--to SHA]` or the backend workflow's
  rollback action. Never reverses migrations.
- **Failed infrastructure update**: CloudFormation rolls the stack back. Inspect
  `aws cloudformation describe-stack-events --stack-name LaiDevPlatform-dev`; a stack stuck in
  `UPDATE_ROLLBACK_FAILED` needs `continue-update-rollback`. Start dev before updating the
  platform stack: RDS cannot be modified while stopped.
- **Replace the instance**: change `AmiId` (`deploy-debug.sh --refresh-ami`) or terminate it and
  update the stack; the database, buckets and Elastic IP are untouched; rerun
  `install-debug.sh` to deploy the application on the new instance.
- **Database backup and restore**: automated backups (retention parameter) and manual snapshots
  (`aws rds create-db-snapshot --db-instance-identifier lai-dev ...`). Restore creates a new
  instance from a snapshot; point the stack at it only through a reviewed change.
- **Deleting the environment** (owner only, irreversible for anything not retained): set
  `DatabaseDeletionProtection=false` with a stack update, then delete `LaiFrontend-dev`
  (us-east-1), `LaiAiGuardrail-dev`, `LaiDevPlatform-dev`, then the storage and artifact stacks if
  wanted. RDS leaves a final snapshot; the buckets and log groups are retained and must be emptied
  and deleted by hand. Never run deletion commands with a stack name that is not `*-dev`; the
  scripts refuse any stack whose `Environment` tag is not `dev`.
