# Django on EC2: automated release from GitHub (ADR-037)

**State (2026-10-30): built and tested in the repository, not provisioned.** No AWS resource
exists for it yet. Creating the stacks, the first release and every production release are
owner-approved steps (ADR-019 G1, G7). The React app stays on Amplify Hosting
(`docs/platform/AMPLIFY_HOSTING.md`); the asset manager keeps its S3 storage
(`docs/ASSET_MANAGER.md` sections 12 and 19).

## 1. What happens on a merge to `main`

```text
push to main (backend paths)
  -> GitHub Actions "Deploy Django (EC2)"  .github/workflows/deploy-django-ec2.yml
     test:   manage.py check, makemigrations --check, check --deploy (production settings),
             pytest with PostgreSQL (includes the release script tests)
     build:  OIDC -> lai-github-image-publisher; docker build lai/Dockerfile;
             push lai/django:<full sha> to ECR (reused if the tag exists); read its digest;
             release-manifest.json artifact (sha, image@digest, commit time, run URL)
     deploy-dev (GitHub Environment django-dev):
             OIDC -> lai-github-deploy-dev; scripts/aws/ssm-run.sh dev deploy ...
               -> SSM document lai-django-deploy-dev on the dev instance
                  -> pull image@digest, copy /app/deploy out of it, run deploy-django.sh:
                     lock, ordering, labels, runtime config, check --deploy, migration plan,
                     (snapshot), migrate, compose up, health check, record | roll back
             then GET https://api.<domain>/api/v1/health/ready/ through the ALB
     deploy-prod (GitHub Environment django-prod, reviewers approve):
             manual dispatch, or on push when LAI_PROD_AUTO_DEPLOY == 'true' and dev succeeded
```

The job is green only when the instance reports a healthy release (live, ready, and the expected
image running) and, when `LAI_API_BASE_URL` is set, the public readiness check passes too.
Until the repository variable `LAI_DEPLOY_ENABLED` is `true`, only the test job runs.

Paths that trigger a release: `lai/**`, `content/**`, `react/public/models/**`,
`requirements*.txt`, `pyproject.toml`, `scripts/aws/**`, `deploy/ec2/**`, `tests/deploy/**`,
`.dockerignore`, and the workflow itself. Front-end-only changes do not release Django.

**Interruption.** One instance: Compose replaces the containers in place, so requests fail for
roughly 5 to 20 seconds during a release. This is not zero-downtime.

## 2. What is in the repository

| Path | What |
|---|---|
| `infra/lib/djangoReleaseStack.ts` | `LaiDjangoRelease` (account-wide): ECR `lai/django`, GitHub OIDC provider, image publisher role |
| `infra/lib/djangoEc2Stack.ts` | `LaiDjangoEc2-<env>`: VPC, ALB + ACM + WAF, EC2, RDS (or dev data volume), SSM settings and documents, deploy role, log groups, alarms |
| `infra/lib/assetStorageStack.ts` | `LaiAssetStorage-<env>` (existing): the asset bucket and `lai-django-asset-storage-<env>` policy, which the instance role attaches |
| `lai/Dockerfile`, `lai/docker-entrypoint.sh` | The image: Django, gunicorn, static files, release labels, and the deploy bundle at `/app/deploy` |
| `deploy/ec2/docker-compose.yml`, `deploy/ec2/nginx/default.conf.template` | Production compose (django, proxy, dev-only db) and the nginx proxy |
| `scripts/aws/setup-ec2.sh` | Idempotent instance setup (user data, and the setup document) |
| `scripts/aws/ssm-release-entry.sh` | Body of the deploy document |
| `scripts/aws/deploy-django.sh`, `rollback-django.sh`, `health-check.sh`, `status.sh`, `view-logs.sh`, `bootstrap-django.sh`, `render-env.sh`, `prune-releases.sh`, `lib.sh` | On-instance release tools |
| `scripts/aws/ssm-run.sh` | Workstation and CI: run a document, wait, classify the result |
| `scripts/aws/provision.sh` | Workstation: synthesize and create change sets; `--execute` applies |
| `.github/workflows/deploy-django-ec2.yml`, `.github/actions/django-release/` | The pipeline |
| `tests/deploy/`, `infra/lib/djangoDeployment.test.ts`, `lai/apps/core/tests/test_readiness.py` | Tests |

## 3. Architecture

```text
api.<domain> --HTTPS--> ALB (ACM certificate, TLS policy RECOMMENDED_TLS, HTTP -> HTTPS,
                             WAF: 100 POSTs to /admin/login per 5 min per IP)
                         | target group: instance :8080, health check /api/v1/health/ready/
                         v
   EC2 (Amazon Linux 2023, t3.medium, IMDSv2, encrypted gp3 30 GB, public IP, no SSH)
     security group: in 8080 from the ALB only; out 443 anywhere, 5432 to the database
     docker compose project "lai":
       proxy   nginx 1.28: buffering, 55 MB body cap, no access log, Host fix for probes
       django  gunicorn (2 workers), read-only root, no capabilities, logs -> CloudWatch
       db      dev container mode only: PostgreSQL 16 on a retained EBS volume
                         |
                         v 5432, TLS verify-full
   RDS PostgreSQL 16 (isolated subnets, encrypted, rds.force_ssl=1, deletion protection,
                      backups 7 / 14 days, snapshot on delete, master secret in Secrets Manager)
```

No NAT gateway: the instance has a public address so it can reach ECR, SSM, CloudWatch, Secrets
Manager, S3 and Cognito's JWKS endpoint, but nothing reaches it except the ALB.

URL routing is Django's own (`lai/config/urls.py`): `/api/v1/*` (including asset delivery under
`/api/v1/`), the admin at `DJANGO_ADMIN_URL_PATH` (default `/admin/`), admin static files at
`/static/` (WhiteNoise, from the image), and the probes `/api/v1/health/` (liveness, no
database) and `/api/v1/health/ready/` (database plus pending migrations; 503 when not ready).
Django keeps its host, CSRF, session-cookie and authentication checks: nginx passes the real
`Host`, and only the two probe paths get the API host name (load balancer checks arrive with the
instance IP). Admin CSRF works because `DJANGO_CSRF_TRUSTED_ORIGINS=https://api.<domain>` and the
ALB's `X-Forwarded-Proto` is trusted (`DJANGO_TRUST_PROXY_SSL_HEADER=true`, gunicorn trusts
forwarded headers only from the compose network `172.30.10.0/24`).

**Static files vs models.** Admin static files are baked into the image (collected at build time).
Uploaded 3D models never live in a container: they are in the asset bucket (`LAI_ASSET_STORAGE=s3`)
and survive every release and rollback.

**Browser access.** Django has no CORS on purpose. The React app reaches it same-origin through
the Amplify Hosting 200 proxy rewrite (`docs/platform/AMPLIFY_HOSTING.md` section 7) until
LAI-1005's CloudFront. The admin is used directly at `https://api.<domain>/admin/`.

## 4. Configuration reference

### 4.1 GitHub (Settings, Secrets and variables, Actions: **Variables**, no secrets)

| Variable | Level | Value |
|---|---|---|
| `LAI_DEPLOY_ENABLED` | repository | `true` to turn the pipeline on (unset: tests only) |
| `LAI_IMAGE_PUBLISHER_ROLE_ARN` | repository | `LaiDjangoRelease` output `ImagePublisherRoleArn` |
| `LAI_AWS_REGION` | repository | optional, default `us-west-1` |
| `LAI_PROD_AUTO_DEPLOY` | repository | optional; `true` makes pushes go on to prod (still behind approval) |
| `LAI_DEPLOY_ROLE_ARN` | environment `django-dev` / `django-prod` | `LaiDjangoEc2-<env>` output `DeployRoleArn` |
| `LAI_API_BASE_URL` | environment | `https://api.<domain>` (output `ApiBaseUrl`); optional, enables the public readiness check |

GitHub Environments: `django-dev` (deployment branches: `main`) and `django-prod` (required
reviewers: the owner; deployment branches: `main`; optionally "prevent self-review" off for a
solo owner). No AWS keys are stored anywhere: both roles are assumed with OIDC.

### 4.2 Stack inputs

CDK context or environment for `npm run infra:synth` (`infra/bin/app.ts`): `LAI_ENV`,
`LAI_GITHUB_REPOSITORY` (default `paulj3000/learning`), `LAI_DATABASE_MODE` (`rds`, or `container`
for dev), `LAI_DB_MULTI_AZ`, `LAI_CREATE_OIDC_PROVIDER` (`false` if the account has one),
`LAI_HOSTED_ZONE_ID` + `LAI_HOSTED_ZONE_NAME` (Route 53 validates the certificate and adds the
alias record).

CloudFormation parameters of `LaiDjangoEc2-<env>` (set by `provision.sh`): `ApiDomainName`,
`AmiId` (Amazon Linux 2023 x86_64, pinned so updates never replace the instance by surprise),
`InstanceType` (default `t3.medium`), `CognitoUserPoolId`, `CognitoAllowedClientIds`,
`AlarmEmail` (optional).

### 4.3 Runtime settings (SSM Parameter Store, `/lai/<env>/...`)

| Parameter | Type | Written by |
|---|---|---|
| `django/DJANGO_ALLOWED_HOSTS`, `django/DJANGO_CSRF_TRUSTED_ORIGINS` | String | stack (from `ApiDomainName`) |
| `django/COGNITO_REGION`, `django/COGNITO_USER_POOL_ID`, `django/COGNITO_ALLOWED_CLIENT_IDS` | String | stack |
| `django/LAI_ASSET_STORAGE` (`s3`), `django/LAI_ASSET_BUCKET`, `django/LAI_ASSET_REGION` | String | stack (the `LaiAssetStorage-<env>` bucket name) |
| `django/DJANGO_SECRET_KEY` | **SecureString** | operator (step 5.5) |
| `django/<other>` | String | optional: any `DJANGO_*`, `COGNITO_*`, `LAI_*`, `WEB_CONCURRENCY`, `GUNICORN_TIMEOUT` (for example `DJANGO_ADMIN_URL_PATH`, `DJANGO_LOG_LEVEL`) |
| `db/POSTGRES_PASSWORD` | SecureString | operator, dev container mode only |
| `bootstrap/DJANGO_ADMIN_PASSWORD` | SecureString | operator, only while creating the first admin, then deleted |
| `deploy/last-release` | String | the instance (release record, versioned) |

`DATABASE_URL` is never a parameter: the release builds it from the RDS secret
`lai/<env>/django/database` as `postgresql://...@<endpoint>:5432/lai?sslmode=verify-full&sslrootcert=/etc/lai/certs/rds-global-bundle.pem`.
The release refuses `DJANGO_SETTINGS_MODULE`, `AUTH_PROVIDER`, `DEBUG`, `LOG_RAW_EXCEPTIONS`, any
`AWS_*` and any unknown name, and fails before touching the running release if a required setting
is missing.

`AUTH_PROVIDER=cognito` (ADR-038) is not a parameter: the image (`lai/Dockerfile`) and the compose
file (`deploy/ec2/docker-compose.yml`) fix it, and production settings refuse to start with any
other value or none. The local Django sign-in (`/api/v1/auth/login/`) therefore does not exist in
any AWS environment, and a Django session never authenticates the API there. Django Admin keeps
its own staff sign-in (ADR-034). Nothing to configure for an existing stack.

## 5. One-time setup (owner, in order)

All commands run from the repository root with AWS CLI v2 credentials for the target account
(an administrator for provisioning; nothing here is needed for normal releases). Region
`us-west-1`.

### 5.1 Decide and check (no AWS change)

1. Account and region (G1), API host name (for example `api.<your domain>`), the cost (section
   12), dev database mode (`rds` recommended; `container` is cheaper).
2. Cognito: the existing Amplify user pool id and web client id, from `amplify_outputs.json`
   (`auth.user_pool_id`, `auth.user_pool_client_id`).
3. Does the account already have a GitHub OIDC provider?
   `aws iam list-open-id-connect-providers`. If it lists
   `token.actions.githubusercontent.com`, set `LAI_CREATE_OIDC_PROVIDER=false` below.
4. Review the templates: `LAI_ENV=dev npm run infra:synth`, then read
   `infra/cdk.out/LaiDjangoRelease.template.json` and `infra/cdk.out/LaiDjangoEc2-dev.template.json`.

### 5.2 Create change sets, review, apply (APPROVAL)

```bash
export AWS_REGION=us-west-1
export LAI_API_DOMAIN=api.example.com
export LAI_COGNITO_USER_POOL_ID=us-west-1_XXXXXXXXX
export LAI_COGNITO_CLIENT_IDS=xxxxxxxxxxxxxxxxxxxxxxxxxx
export LAI_ALARM_EMAIL=you@example.com          # optional
# export LAI_CREATE_OIDC_PROVIDER=false          # if 5.1 step 3 found one
scripts/aws/provision.sh dev                      # change sets only; review them in the console
scripts/aws/provision.sh dev --execute            # apply
```

It deploys, in order, `LaiAssetStorage-dev`, `LaiDjangoRelease` and `LaiDjangoEc2-dev`.
`--only <stack>` limits it to one. For prod, the same with `prod` (and the prod domain).

### 5.3 Certificate validation (console, while 5.2 waits)

Without a Route 53 zone the EC2 stack waits on the ACM certificate. Open **Certificate Manager**
(us-west-1), the pending certificate for the API host, and add the CNAME it shows at your DNS
provider. The stack continues once ACM says "Issued" (usually minutes; CloudFormation gives up
after several hours, then rerun `--execute`). With `LAI_HOSTED_ZONE_ID`/`NAME` this is automatic.

### 5.4 DNS for the API host (your DNS provider)

Point `api.<domain>` at the `LoadBalancerDnsName` output (a CNAME, or an alias record in Route 53;
created automatically with a hosted zone).

```bash
aws cloudformation describe-stacks --stack-name LaiDjangoEc2-dev --query 'Stacks[0].Outputs' --output table
```

### 5.5 Secrets

```bash
aws ssm put-parameter --name /lai/dev/django/DJANGO_SECRET_KEY --type SecureString \
  --value "$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')"
# dev container database mode only:
aws ssm put-parameter --name /lai/dev/db/POSTGRES_PASSWORD --type SecureString \
  --value "$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
```

The RDS password is generated by the stack in Secrets Manager; nobody types it.

### 5.6 Confirm the instance is ready

```bash
scripts/aws/ssm-run.sh dev setup     # reruns the idempotent setup and shows its output
aws ssm describe-instance-information --query 'InstanceInformationList[].[InstanceId,PingStatus]'
```

If `AlarmEmail` was set, confirm the SNS subscription e-mail.

### 5.7 GitHub configuration

```bash
aws cloudformation describe-stacks --stack-name LaiDjangoRelease \
  --query "Stacks[0].Outputs[?OutputKey=='ImagePublisherRoleArn'].OutputValue" --output text
aws cloudformation describe-stacks --stack-name LaiDjangoEc2-dev \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'||OutputKey=='ApiBaseUrl']" --output table
```

With the GitHub CLI (or the web settings):

```bash
gh api -X PUT repos/paulj3000/learning/environments/django-dev
gh api -X PUT repos/paulj3000/learning/environments/django-prod   # then add reviewers in the web UI
gh variable set LAI_IMAGE_PUBLISHER_ROLE_ARN --body 'arn:aws:iam::<account>:role/lai-github-image-publisher'
gh variable set LAI_DEPLOY_ROLE_ARN --env django-dev --body 'arn:aws:iam::<account>:role/lai-github-deploy-dev'
gh variable set LAI_API_BASE_URL --env django-dev --body 'https://api.example.com'
gh variable set LAI_DEPLOY_ENABLED --body true
```

In the web UI, for each environment: **Deployment branches and tags: Selected branches, `main`**;
for `django-prod`: **Required reviewers**.

### 5.8 First release (creates the database schema)

```bash
gh workflow run deploy-django-ec2.yml --ref main -f environment=dev -f action=deploy
gh run watch
```

The first release applies the whole migration history (the destructive-migration guard does not
apply to an empty database). It is green when Django is live and ready.

### 5.9 First-time Django tasks (operators; through the bootstrap document)

```bash
# Admin account: the password goes through SSM, never the command line, then is deleted.
aws ssm put-parameter --name /lai/dev/bootstrap/DJANGO_ADMIN_PASSWORD --type SecureString \
  --value '<a long password>'
scripts/aws/ssm-run.sh dev bootstrap create-admin <username>
aws ssm delete-parameter --name /lai/dev/bootstrap/DJANGO_ADMIN_PASSWORD

scripts/aws/ssm-run.sh dev bootstrap ensure-asset-roles
scripts/aws/ssm-run.sh dev bootstrap load-content
scripts/aws/ssm-run.sh dev bootstrap seed-treasure-rush       # Treasure Cove as DRAFT
scripts/aws/ssm-run.sh dev bootstrap import-assets --dry-run  # npc-pip, treasure-chest, ground-tile
scripts/aws/ssm-run.sh dev bootstrap import-assets            # uploads the bundled models to S3
scripts/aws/ssm-run.sh dev bootstrap check                    # check --deploy, migration list
```

Bootstrap tasks are never run by a deploy. `migrate` is also available as a task for recovery.

### 5.10 Publish the Treasure Rush models (Django Admin)

Sign in at `https://api.<domain>/admin/` with the account from 5.9, then follow
`docs/ASSET_MANAGER.md` section 19.2: **Asset manager, Asset versions**, select the imported
`npc-pip`, `treasure-chest` and `ground-tile` versions, action **Publish selected versions**. The
first published version of each becomes its default. Publishing the region itself is still the
open TR-3 blocker (`docs/ASSET_MANAGER.md` 19.3 step 5).

### 5.11 React (separate owner decision)

To use the deployed Django from the web app: the Amplify proxy rewrite for `/api/<*>` and
`VITE_BACKEND=django` on a branch (`docs/platform/AMPLIFY_HOSTING.md` sections 5 and 7). This
pipeline does not change Amplify.

### 5.12 Production

Repeat 5.2 to 5.7 with `prod` (RDS only; deletion protection on the ALB and RDS; 14-day backups;
a snapshot before every release with migrations). Then release a commit that is already healthy
on dev:

```bash
gh workflow run deploy-django-ec2.yml --ref main -f environment=prod -f action=deploy
```

A reviewer approves the `django-prod` deployment in the run. To make pushes continue to prod
automatically later (still behind the approval): `gh variable set LAI_PROD_AUTO_DEPLOY --body true`;
to drop the approval as well, remove the environment's required reviewers.

## 6. Releasing

- **Automatic:** merge to `main`. Overlapping runs queue per environment (`concurrency`), and a
  run whose commit is no longer the tip of `main` skips the deploy when a newer backend commit
  exists (that run deploys). The instance also refuses a commit older than the one running
  (exit 15) unless dispatched with `allow_older`.
- **Manual:** `gh workflow run deploy-django-ec2.yml --ref main -f environment=dev -f action=deploy`.
  Dispatch builds (or reuses) the image of the current `main`.
- **Re-running** a run is safe: the tag is immutable, the image is reused, and redeploying the
  running digest re-renders configuration and checks health.
- **Configuration change only** (an SSM parameter): redeploy the running commit (re-run its
  deploy job, or dispatch).
- **Destructive migrations** (remove/rename a field or model, raw SQL) are refused (exit 45).
  Ship the code that stops using the column first, then the migration, dispatched with
  `allow_destructive_migrations=true` after reading the plan in the failed run's output.

## 7. Status and logs

```bash
scripts/aws/ssm-run.sh dev status                 # release record, history, containers, health, disk, memory
scripts/aws/view-logs.sh dev app --since 30m      # Django (/lai/dev/django)
scripts/aws/view-logs.sh dev deploy --since 1d    # deploy.log from the instance (/lai/dev/deploy)
scripts/aws/view-logs.sh dev ssm --since 1d       # full SSM command output (/lai/dev/ssm)
scripts/aws/view-logs.sh dev proxy                # nginx errors (critical only)
aws ssm get-parameter-history --name /lai/dev/deploy/last-release --query 'Parameters[].Value'
```

On the instance (Session Manager: `aws ssm start-session --target <instance id>`):
`sudo /opt/lai/current/scripts/aws/status.sh`, `sudo /opt/lai/current/scripts/aws/view-logs.sh --local deploy`.
GitHub keeps the run history per environment (Deployments), each run's step summary and the
`release-manifest-<sha>` artifact (90 days).

**Release record** (`/opt/lai/state/releases.jsonl`, one JSON object per event, mirrored to
`/lai/<env>/deploy/last-release`): `event` (deploy, rollback), `status` (healthy, failed,
rollback_failed), `git_sha`, `image`, `image_digest`, `commit_epoch`, `run_url`, `started_at`,
`finished_at`, `health`, `failed_stage`, `exit_code`, `previous_git_sha`,
`previous_image_digest`, `migrations_applied`, `migrations_not_reversed`,
`manual_db_review_required`, `trigger` (automatic, manual).

## 8. Rollback

- **Automatic:** a release that fails its health check is rolled back to the previous healthy
  release by the same SSM command (exit 60; the job is still red, so you notice).
- **Manual:**
  ```bash
  gh workflow run deploy-django-ec2.yml --ref main -f environment=dev -f action=rollback
  gh workflow run deploy-django-ec2.yml --ref main -f environment=prod -f action=rollback -f rollback_to=<full sha>
  # or from a workstation:
  scripts/aws/ssm-run.sh dev rollback [--to <full sha>]
  ```
  The target must have been healthy on this instance and still have its bundle (the newest five
  are kept). It reuses that release's own compose file and image.
- **Migrations are never reversed.** If releases after the target applied migrations, the output
  says `MANUAL DATABASE REVIEW REQUIRED` and lists them, and the record sets
  `manual_db_review_required`. Additive migrations (new tables, nullable columns) are normally
  harmless to older code. Otherwise choose: roll forward with a fix, or restore the database (9.2)
  to the pre-migration snapshot and accept the data written since.
- A failed **migration** (exit 50) never started the new release; the old one keeps running.
  Each migration is atomic on PostgreSQL, but earlier ones in the same release may be applied:
  check with `scripts/aws/ssm-run.sh dev bootstrap check`.

## 9. Database

### 9.1 Persistence and backups

- RDS is outside the instance and Compose; no release, rollback or instance replacement touches
  it. Deletion protection is on; deleting the stack leaves a final snapshot.
- Automated backups: 7 days (dev), 14 days (prod), window 10:00-10:30 UTC, point-in-time restore.
- Prod: a manual snapshot `lai-prod-pre-<sha12>-<time>` before every release with pending
  migrations (kept until you delete it).
- Dev container mode: PostgreSQL data on a separate encrypted EBS volume (snapshot on stack
  delete). Releases never run `compose down -v`, and the data is a bind mount, not a volume.
  Replacing the instance in this mode needs the volume detached first: use RDS for anything you
  cannot lose.

### 9.2 Restore

```bash
aws rds describe-db-snapshots --db-instance-identifier lai-django-prod --query 'DBSnapshots[].DBSnapshotIdentifier'
aws rds restore-db-instance-from-db-snapshot --db-instance-identifier lai-django-prod-restore \
  --db-snapshot-identifier <snapshot> --db-subnet-group-name <stack's subnet group> \
  --vpc-security-group-ids <DatabaseSecurityGroup id> --no-publicly-accessible
# or point in time:
aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier lai-django-prod \
  --target-db-instance-identifier lai-django-prod-restore --restore-time 2026-11-01T10:00:00Z ...
```

Then point the secret's `host` at the restored instance (Secrets Manager, `lai/prod/django/database`)
and redeploy the running commit, or swap identifiers in a maintenance window. Restoring is a
manual, owner-approved operation; the pipeline never restores.

## 10. Safety summary

| Risk | Protection |
|---|---|
| Concurrent releases | GitHub `concurrency` per environment; `flock` on the instance (exit 70) |
| Out-of-order releases | Superseded-run skip; commit-time ordering check on the instance (exit 15) |
| Partial release | Configuration, preflight and migrations run before the running release is touched; unhealthy start rolls back |
| Missing secrets | `render-env.sh` refuses missing or unsafe settings (exit 30) before anything starts |
| Failed pulls | exit 20; nothing changed |
| Invalid Docker config | `docker compose config` and `check --deploy` preflight (exit 40) |
| Failed migrations | exit 50; old release keeps running; flagged for review |
| Failed health checks | automatic rollback (exit 60), or 61/62 with the reason |
| Development image to prod | only `lai/django` digests; `release-channel=release` and revision labels must match |
| Data loss | RDS deletion protection, backups, pre-migration snapshots; no `down -v`; bind-mounted dev data; assets in S3 |
| Arbitrary commands | SSM documents with patterns; the deploy role cannot run `AWS-RunShellScript`, bootstrap or setup |
| Credential leaks | OIDC only; instance role; secrets never printed; 0600 env file; no secret in the image |

## 11. Monitoring

CloudWatch log groups (retained on stack delete): `/lai/<env>/django` (30 / 90 days),
`/lai/<env>/proxy` (30), `/lai/<env>/deploy` and `/lai/<env>/ssm` (365),
`/aws/rds/instance/lai-django-<env>/postgresql` (30). Metrics: the CloudWatch agent publishes
`mem_used_percent` and `disk_used_percent` to `LearningAdventureIsland/EC2`.

Alarms (to SNS `lai-django-alarms-<env>`; OK notifications too): `not-ready` (no healthy target for
3 minutes: database down or pending migrations), `target5xx` (10 or more 5xx in 5 minutes),
`memory-high` (90%), `disk-high` (85%), `system-status-failed` (also triggers EC2 auto-recovery),
`database-storage-low` (under 2 GB). `not-ready` is in alarm until the first release.

## 12. Cost (estimate, us-west-1 on-demand, one environment; check the AWS pricing calculator)

EC2 `t3.medium` about $36; EBS 30 GB about $3; ALB about $20 to $25; RDS `db.t4g.micro` single-AZ
with 20 GB about $15 to $20 (Multi-AZ about doubles it); WAF about $6 to $8; public IPv4 (instance
and ALB) about $11; CloudWatch, Secrets Manager, ECR a few dollars. **About $90 to $110 a month**.
`t3.small` saves about $18. The dev container database mode saves the RDS line.

## 13. Exit codes (instance) and what the workflow reports

| Code | Meaning | Workflow |
|---|---|---|
| 0 | healthy | success |
| 10, 11, 12 | invalid request, wrong repository, image labels or bundle rejected | application failure |
| 15 | older than the running release | application failure |
| 20 | pull failed | application failure |
| 30 | runtime configuration incomplete or unsafe | application failure |
| 40, 45, 48 | preflight failed, destructive migrations refused, snapshot failed | application failure |
| 50 | migration failed (old release running; review the database) | application failure |
| 60, 61, 62 | unhealthy: rolled back / nothing to roll back to / rollback failed | application failure |
| 63 | nothing to roll back to (rollback action) | application failure |
| 70 | lock held by another release | application failure |
| SSM status other than Success/Failed, or no exit code | | **SSM transport failure** (instance offline, undeliverable, timed out) |

## 14. Troubleshooting

| Symptom | Look at |
|---|---|
| `SSM TRANSPORT FAILURE: instance ... is not online` | The instance is stopped, or the SSM agent cannot reach SSM (security group egress 443, instance role) |
| Exit 30 `missing runtime settings: DJANGO_SECRET_KEY` | Step 5.5 |
| Exit 30 `the RDS CA bundle is missing` | `scripts/aws/ssm-run.sh <env> setup` |
| Exit 20 | ECR permissions or the digest; `aws ecr describe-images --repository-name lai/django` |
| Instance healthy, public check fails | DNS, the certificate, or the target group (EC2 console, Target groups, Health) |
| `not-ready` alarm | `scripts/aws/ssm-run.sh <env> status`; database reachability; a release that skipped migrations |
| Django 400 for every request | `DJANGO_ALLOWED_HOSTS` does not match the host used |
| Admin login 403 CSRF | `DJANGO_CSRF_TRUSTED_ORIGINS` must be `https://<exact host>` |
| 429 or 403 on the admin login | the WAF rate rule (100 POSTs in 5 minutes per IP) |

## 15. Verification on 2026-10-30 (repository only)

Done locally: 9 readiness probe tests and the database TLS option tests; 63 release script
tests against fake docker, aws and curl (deploy, ordering, labels, configuration, migrations,
snapshot, rollback, pruning, lock, bootstrap, ssm-run classification); 2 entry point tests;
32 CDK template tests and synthesis of all three stacks for dev and prod; the full pytest suite
with PostgreSQL; ShellCheck; actionlint;
`docker compose config` for both profiles; `nginx -t`; a real image build; and an end-to-end
run of the production compose stack (nginx, gunicorn, PostgreSQL) with the log driver swapped
for the local one, which found and fixed two bugs (the entry point ignored one-off commands; the
health checks were rejected by `ALLOWED_HOSTS`).

Not verified, because nothing is provisioned: CloudFormation deployment, OIDC role assumption,
ECR push from GitHub, SSM delivery, the awslogs driver and CloudWatch agent on a real instance,
RDS TLS, the ALB and WAF, and the GitHub workflow running on GitHub.

## 16. Known limits and follow-ups

- Django connects to RDS as the master user; a least-privilege application role is a follow-up.
- Rollback is limited to releases whose bundle is still on the instance (five); older ones need a
  deploy with `allow_older`.
- One instance and one AZ for the application; RDS Multi-AZ is a flag. ECS Fargate (LAI-1007)
  remains the production candidate.
- OS patching: enable SSM Patch Manager (or `dnf upgrade` through the setup document) on a
  schedule; nothing patches automatically today.
- The ECR scan result is reported in the build summary but does not block a release.
