# Learning Adventure Island

AI-powered learning adventures for children ages 3–8: a React, TypeScript and Three.js app on a
Django REST backend with PostgreSQL, parent sign-in through Amazon Cognito, and constrained AI
generation through Amazon Bedrock on the server.

The Amplify Gen 2 backend and Amplify Hosting are retired (ADR-019, AMP-01 to AMP-08; the owner
deleted the Amplify app on 2026-11-14). Nothing in this repository needs Amplify, an Amplify
sandbox or `amplify_outputs.json`. The parent Cognito user pool and its web app client, created
by the old Amplify backend, are kept and used directly. History and the remaining deployment and
legacy-data tasks: `docs/platform/AMPLIFY_FINAL_REMOVAL.md`.

## Start here

1. Read `CLAUDE.md` and the documents it lists under `docs/`.
2. Check `docs/IMPLEMENTATION_STATUS.md` for what is built and what is open.
3. Follow the local development steps below.

## Product premise

Children do not select worksheets. They enter adventures. Learning allows them to repair, create, discover, and permanently change the island.

## Local development

Requires Node.js 22+, Python 3.12+ and Docker (for PostgreSQL 16). Local development runs
React (Vite, port 5183) against Django REST (port 8000 in the steps below, 8010 if you leave
`DJANGO_DEV_PORT` unset) and PostgreSQL, with parent sign-in through the existing Cognito user
pool. No AWS credentials are needed to play: the AI and speech providers default to Django's
deterministic fakes.

From a fresh checkout, at the repository root:

1. Install the JavaScript workspace: `npm install`.
2. Create the Python environment with the pinned tooling: `make py-install`.
3. Create your local settings from the template: `cp .env.sample .env`. It is gitignored; never
   commit it.
4. In `.env`, set `COGNITO_REGION`, `COGNITO_USER_POOL_ID` and `COGNITO_ALLOWED_CLIENT_IDS` (the
   web app client first) for the existing pool, and add `DJANGO_DEV_PORT=8000`. These are public
   identifiers, not secrets. `make runserver`, `make web` and the Vite proxy all read them, and
   `vite dev` reuses the same pool and client for browser sign-in (override with
   `VITE_COGNITO_*` in `react/.env.local`, template `react/.env.example`).
5. Start PostgreSQL 16: `make up` (127.0.0.1:5442; `POSTGRES_PORT` overrides).
6. Apply the migrations: `make migrate`.
7. Load the content and Treasure Rush:
   `cd lai && ../.venv/bin/python manage.py load_content && ../.venv/bin/python manage.py seed_treasure_rush && ../.venv/bin/python manage.py publish_treasure_rush && cd ..`
8. Optional, for Django Admin: `make createsuper`.
9. In one terminal, start Django: `make runserver` (http://127.0.0.1:8000/api/v1/health/ answers
   `ok`).
10. In a second terminal, start React: `make web`, then open http://localhost:5183/ and sign in
    with a parent account from the pool (or sign up and confirm with the emailed code).

When Vite starts it prints `[lai] dev` lines: where `/api` is proxied, whether Django answered
there, and whether Cognito is configured (never the ids or any token). If a line says NOT, it
says what to change. Django is the only backend; there is no backend selector.

Django Admin (staff only) is at `http://127.0.0.1:8000/admin/`, with its own staff sign-in.
Parents and children use the React app only. Do not commit `.env` files; an old checkout's
`amplify_outputs.json` is ignored and unused.

### Python tooling (the Django backend in `lai/`)

Python 3.12. The Django project is `lai/` (Django 6.1, DRF 3.18, psycopg 3; ADR-021) with
settings split into `base`, `local`, `test`, and `production` under `lai/config/settings/`.
Local and test settings use the compose database on loopback; production settings refuse to
load unless `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, and `DATABASE_URL` are set. If the
compose database runs on a non-default port, export `POSTGRES_PORT` for every command. One tool chain: a `.venv` created with the standard library `venv`, `pip`, pinned
`requirements-dev.txt` (ruff and pytest, direct and transitive), and ruff plus pytest configured
in `pyproject.toml`. No Django code exists yet. Run from the repository root:

```bash
make py-install        # create .venv and install the pinned tooling
make py-lint           # ruff check
make py-format-check   # ruff format --check (make py-format to fix)
make py-test           # pytest (tests/)
make py-check          # all three
make check             # Python checks, then typecheck, lint, format, tests, build
make up                # local PostgreSQL 16 via docker compose on 127.0.0.1:5442 (POSTGRES_PORT overrides)
make django-check      # manage.py check (no database needed)
make migrate-check     # makemigrations --check
make migrate           # apply framework migrations (needs make up)
make createsuper       # local Django Admin superuser; prompts for username and password (needs make migrate)
make runserver         # Django dev server on 8010 (DJANGO_DEV_PORT); GET http://127.0.0.1:8010/api/v1/health/
make web               # Vite dev server on 5183, proxying /api to runserver on DJANGO_DEV_PORT
make py-test-db        # like py-test, but PostgreSQL tests fail instead of skipping
```

Secrets and per-developer settings go in `.env` files, which are gitignored. Committed examples:
`react/.env.example` and `lai/.env.example`.

Django's local settings go in the untracked **`.env` at the repository root**, the same layout
FinTwin uses. Start from the committed template: `cp .env.sample .env`, then fill in the
`COGNITO_*` values. Docker Compose reads that file itself. Django does not (there is no dotenv package),
so the `Makefile` reads it and passes the values on:

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` reach every target,
  tests included.
- `DATABASE_URL`, `DJANGO_*`, `COGNITO_*`, `LAI_ASSET_*` and `LAI_GAME_*` reach only
  `django-check`, `migrate-check`, `migrate` and `runserver`. The tests set their own values.
- A variable already exported in the shell wins over `.env`. Write `NAME=value` without quotes;
  if a name appears twice, the last line wins.
- The list of forwarded names is `DJANGO_ENV_VARS` in the `Makefile`. Add a name there when a
  setting starts reading a new variable.
- `make runserver` sets `AWS_PROFILE=learning-dev` for the server process (and its reloader), so
  boto3 resolves credentials through that named profile. The profile must already exist in your
  local AWS config; nothing creates it. Override with `make runserver AWS_PROFILE=other`; a profile
  already exported in the shell wins. No other target sets it, and deployed servers never use it.
- Running `manage.py` directly, without `make`, does not read `.env`: export the variables in
  your shell first.
- Deployed environments never read `.env`. They take settings from SSM Parameter Store
  (`docs/platform/DJANGO_EC2_DEPLOYMENT.md`, section 4.3).

Sign-in is Amazon Cognito in every environment, local development included (ADR-040): the React
app signs in to the existing user pool (configured by `VITE_COGNITO_*`, or the root `.env`'s
`COGNITO_*` in `vite dev`), and Django verifies the same pool's tokens. Django Admin keeps its own
staff sign-in. Step by step, including Treasure
Rush: `docs/TREASURE_RUSH_LOCAL_DEV.md`.

### Available scripts

The frontend lives in `react/` (an npm workspace). Run every command below from the
repository root; the root scripts delegate to it. `lai/`, `infra/`, `scripts/`, `docs/`, and `tasks/`
stay at the root. Older docs that say `src/features/...` now mean `react/src/features/...`.

```bash
npm run dev          # start the Vite dev server
npm run build         # typecheck and build for production
npm run preview       # preview the production build locally
npm run typecheck     # typecheck app, node config, e2e, infra and scripts
npm run lint           # run oxlint
npm run format         # format with Prettier
npm run format:check   # check formatting without writing
npm run test            # run Vitest unit/component tests
npm run test:e2e        # run Playwright end-to-end tests
npm run content:export  # write content/ (versioned JSON export of the game content)
npm run content:check   # fail if content/ is out of date
```

## Game engine direction (accepted)

All playable worlds will run on one Three.js engine; Phaser will be retired after each world is
converted and verified (ADR-020, `docs/THREEJS_ENGINE_CONVERSION.md`). Phaser is still in the
code today and nothing has been removed yet.

## Backend (Django, in effect)

Django + DRF on PostgreSQL is the only application backend (ADR-019, ADR-033). The React build
calls it on same-origin `/api/` (`VITE_DJANGO_API_BASE` may name another `https://` origin);
deployed, CloudFront routes `/api/` to Django and serves the React build from S3
(`docs/platform/AMPLIFY_FINAL_REMOVAL.md`, section "Hosting"). Deploying that stack is an owner
step and has not happened yet.

## AWS Development Infrastructure - Deployment and Operations

This section is the complete runbook for the low-cost AWS development and debugging environment
(`dev`, ADR-055). Background and design details: `docs/infrastructure/dev-native-environment.md`.
Production keeps its own design (ADR-037, `docs/platform/DJANGO_EC2_DEPLOYMENT.md`) and is not
changed by anything here.

> **Status:** implemented and tested locally (CDK synthesis, cfn-lint, unit and script tests).
> **Nothing has been deployed yet.** Every command below that changes AWS or GitHub is an
> owner-approved step, and the environment is not operational until the acceptance checklist at
> the end of this section has passed against a live deployment.

### Architecture

```text
 Browser -> https://lai.pauldimitriu.com -> CloudFront (us-east-1, ACM)
              |  default: private S3 web bucket (Origin Access Control), SPA routing
              |  /api/*:  no caching; Authorization, cookies, query strings forwarded
              v
 us-west-1   https://api.pauldimitriu.com (Elastic IP, Let's Encrypt on nginx)
   EC2 t4g.small ARM64, Amazon Linux 2023 (public subnet, SSM only, no SSH)
     nginx :443 -> gunicorn 127.0.0.1:8000 (systemd) -> Django (venv, DEBUG=False)
     lai-jobs-consumer (results queue -> database)
   RDS PostgreSQL 16 db.t4g.micro (private subnets, Single-AZ, TLS, encrypted)
   SQS lai-dev-jobs-ai / lai-dev-jobs-media -> Lambda (arm64, outside the VPC)
        -> Bedrock with the Guardrail, Polly, S3 -> SQS lai-dev-job-results -> Django
   Step Functions lai-dev-power <- EventBridge Scheduler (stop 00:00, start 07:35 Pacific)
 Admin: https://ladm.pauldimitriu.com/admin/ -> Elastic IP directly (owner CIDR only)
```

- **EC2** runs the Django REST API, Django Admin, Cognito token verification, authorization and
  every database write. nginx terminates TLS; gunicorn runs under systemd and starts again after
  every reboot or morning start.
- **RDS** holds all application data, reachable only from the instance, with forced TLS.
- **Lambda and SQS** do slow external calls (AI Question Studio generation through Bedrock,
  Polly speech pre-generation, asset inspection). Lambda never touches the database; Django
  applies results from the results queue, which keeps them for 14 days while dev is stopped.
- **S3** holds the React build, the asset library, child photos (private, never behind a CDN),
  generated speech, release artifacts and temporary job results, each with lifecycle rules.
- **CloudFront** serves the React app and routes `/api/*` to Django on the same origin, so the
  app needs no CORS and no API URL in its build.

**Development versus production:** production uses Docker images from ECR behind an ALB with a
WAF on x86 EC2 (ADR-037). Dev needs none of that: one instance needs no load balancer, nginx gets
a free Let's Encrypt certificate, nginx `limit_req` replaces the WAF's admin login rate rule, and
releases are tarballs with prebuilt ARM64 wheels, so there is no image registry. There is also no
NAT gateway (the instance has a public address; Lambda runs outside the VPC), no Multi-AZ, no ECS,
CodeBuild, CodePipeline, RDS Proxy or VPC endpoints.

### Prerequisites

- A Linux workstation with `bash`, `git`, `jq`, `curl`, `zip`, `tar` (GNU), `openssl`.
- AWS CLI v2 and the Session Manager plugin (for `connect` and `db-tunnel`).
- GitHub CLI (`gh auth login` as a repository administrator, for environments and variables).
- Node.js 22+ and npm; Python 3.12 (for packaging the release and the tests).
- An AWS profile for the dev account with administrator-equivalent rights for CloudFormation,
  IAM, EC2, RDS, S3, SQS, Lambda, Step Functions, Scheduler, SSM, Route 53, ACM, CloudFront and
  Budgets. Configure it once: `aws configure sso --profile learning-dev` (or access keys on your
  workstation only; GitHub never gets keys).
- **Cognito:** the existing parent user pool id (for example `us-west-1_AbCdEf123`) and its web
  app client id. Both are public identifiers. Find them with
  `aws cognito-idp list-user-pools --max-results 20` and
  `aws cognito-idp list-user-pool-clients --user-pool-id <pool id>`.
- **DNS:** ideally a Route 53 public hosted zone for `pauldimitriu.com` in the same account
  (`aws route53 list-hosted-zones`). Then certificates validate and records are created
  automatically. Without one, `deploy-debug.sh` prints the records to create at your DNS
  provider, and port 80 is opened for Let's Encrypt HTTP validation.
- Optional: your public IP as a `/32` (`curl -s https://checkip.amazonaws.com`) to reach the
  Django Admin host and the API host directly.
- Use synthetic test accounts and data only. Never import real production child data into dev.

### Configuration

All settings are environment variables or lines in an untracked `.lai-dev.env` at the
repository root (parsed, never executed). Start from the template:

```bash
cp scripts/aws/dev.env.example .lai-dev.env
```

Set at least `LAI_DEV_ACCOUNT_ID` (the 12-digit dev account, required for `--execute`),
`LAI_COGNITO_USER_POOL_ID`, `LAI_COGNITO_CLIENT_IDS`, and either `LAI_HOSTED_ZONE_ID` plus
`LAI_HOSTED_ZONE_NAME` (`pauldimitriu.com`) or nothing for manual DNS. The host names default to
`lai.pauldimitriu.com`, `api.pauldimitriu.com` and `ladm.pauldimitriu.com`; set
`LAI_SITE_DOMAIN`, `LAI_API_DOMAIN` and `LAI_ADMIN_DOMAIN` (for example `dev-lai.pauldimitriu.com`)
to keep the canonical names free for production later. Every other setting (sizes, schedule,
Lambda, alarm email, `LAI_ADMIN_ALLOWED_CIDR`) is documented in the template, with safe defaults.
No secret ever goes in this file: the Django secret key is generated into SSM by the installer.

### Complete first-time deployment

```bash
git clone https://github.com/paulj3000/learning.git
cd learning

git switch main
git pull --ff-only

npm ci

cp scripts/aws/dev.env.example .lai-dev.env    # then edit it (section above)

export AWS_PROFILE=learning-dev
export AWS_REGION=us-west-1

aws sts get-caller-identity                     # must show the dev account

./scripts/aws/deploy-debug.sh --plan            # synthesize, validate, create change sets; changes nothing
./scripts/aws/deploy-debug.sh --execute         # apply the change sets in dependency order

./scripts/aws/install-debug.sh --create-admin <your-admin-username> --dev-bootstrap-publish

# optional, starts paid Bedrock and Polly use:
# ./scripts/aws/install-debug.sh --enable-ai --enable-speech   # redeploys, so the new settings load

./scripts/aws/show-endpoints.sh
```

What each step does and asks:

1. `deploy-debug.sh --plan` checks your credentials, the account (`LAI_DEV_ACCOUNT_ID`), that
   no conflicting stack such as the old `LaiDjangoEc2-dev` exists, the Cognito pool and client,
   and the hosted zone. It resolves the ARM64 Amazon Linux 2023 AMI (pinned so updates never
   replace the instance by surprise), the CloudFront origin-facing prefix list and whether
   GitHub's OIDC provider already exists. It synthesizes the templates, packages the Lambda
   workers, validates every template, prints every parameter and creates reviewable change sets
   (`lai-dev-<timestamp>`). On a brand-new account the platform change set needs the artifacts
   bucket first, so the plan reports it as deferred; either run `--execute`, which applies
   everything in order, or review stack by stack:
   `./scripts/aws/deploy-debug.sh --execute --only LaiDevArtifacts-dev`, then `--plan` again.
2. `deploy-debug.sh --execute` applies the stacks in this order: `LaiDevArtifacts-dev`,
   `LaiAssetStorage-dev`, `LaiChildPhotos-dev`, `LaiDevPlatform-dev` (us-west-1),
   `LaiAiGuardrail-dev`, then `LaiFrontend-dev` in **us-east-1**. Without Route 53 it stops at
   the site certificate and prints the ACM validation CNAME to add; rerun `--execute` when ACM
   shows it issued. It refuses to update the platform stack while dev is stopped and refuses a
   change set that would replace the database. It ends by printing the outputs and the install
   command. Takes 20 to 40 minutes (RDS and CloudFront are the slow parts).
3. `install-debug.sh` is safe to rerun. It creates `DJANGO_SECRET_KEY` in SSM only when missing,
   configures the GitHub environments and variables (`--skip-github` to skip), waits for the
   instance setup, packages, uploads and deploys the current `main` commit, applies migrations
   and collects static files, creates the Django roles, loads the game content, seeds the
   adventures and imports the bundled assets (without duplicating anything already there),
   deploys the Lambda workers, builds and publishes the React site, and runs the acceptance
   checks. `--create-admin USER` asks twice for a password (hidden input), uses it through a
   transient SecureString and always deletes that parameter afterwards. `--dev-bootstrap-publish`
   additionally publishes the approved Treasure Rush seed content (a development bootstrap that
   keeps every content validation). `--enable-ai` writes the Bedrock settings (model, Guardrail,
   Studio model) from `LaiAiGuardrail-dev`, and `--enable-speech` turns on Amazon Polly; both start
   paid usage, so they are off unless you pass them, and neither overwrites an existing value.
   Settings in `/lai/dev/django/` are read at each deploy, so a change takes effect when the
   installer (or the next release) redeploys.
   `--dry-run` prints the plan without changing anything.
4. `show-endpoints.sh` prints the state and every URL:

```text
Learning Adventure Island - DEV

Environment: dev
Region: us-west-1

EC2: RUNNING
RDS: AVAILABLE
Django: READY
Nightly shutdown: ENABLED

CloudFront: https://dxxxxxxxx.cloudfront.net
Game:       https://lai.pauldimitriu.com
API:        https://api.pauldimitriu.com
Admin:      https://ladm.pauldimitriu.com/admin/

Shutdown:   00:00 America/Los_Angeles
Startup:    08:00 America/Los_Angeles
```

Other commands: `./scripts/aws/deploy-debug.sh --status` (stack states) and `--outputs`
(all outputs of both regions). Infrastructure provisioning and application deployment stay
separate: `deploy-debug.sh` never deploys the application, and `install-debug.sh` never changes
a stack.

**DNS without Route 53:** create `A` records for the API and admin hosts pointing at
`ElasticIPAddress`, and a `CNAME` from the site host to `DistributionDomainName`. The instance
retries its Let's Encrypt certificate twice a day and ten minutes after each boot; until then
the API through CloudFront answers 502.

### CloudFormation console deployment (alternative)

1. Synthesize: `LAI_ENV=dev CDK_DEFAULT_ACCOUNT=<account> CDK_DEFAULT_REGION=us-west-1
LAI_HOSTED_ZONE_ID=<zone or empty> LAI_HOSTED_ZONE_NAME=<zone name or empty> npm run infra:synth`.
   No `cdk bootstrap` is needed. Templates land in `infra/cdk.out/<stack>.template.json`.
2. Package the Lambda workers: `./scripts/aws/package-lambda.sh` prints
   `build/lambda/jobs-worker-<hash>.zip`.
3. In **us-west-1**, CloudFormation, Create stack, Upload a template file, for each stack in
   order, acknowledging **IAM resources with custom names** (`CAPABILITY_NAMED_IAM`):
   1. `LaiDevArtifacts-dev` (no required parameters). Then upload the zip:
      `aws s3 cp build/lambda/jobs-worker-<hash>.zip s3://<ArtifactBucketName>/lambda/`.
   2. `LaiAssetStorage-dev`, then `LaiChildPhotos-dev` (no parameters).
   3. `LaiDevPlatform-dev`. Required values: `AmiId` from
      `aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text`;
      `CloudFrontOriginPrefixListId` from
      `aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --query 'PrefixLists[0].PrefixListId' --output text`;
      `CognitoUserPoolId`, `CognitoClientId`; `WorkerCodeKey` = `lambda/jobs-worker-<hash>.zip`;
      `HostedZoneId`/`HostedZoneName`, or both empty with `OpenHttpPort=true`;
      `CreateGithubOidcProvider=false` if `aws iam list-open-id-connect-providers` already shows
      `token.actions.githubusercontent.com`. The template is about 200 KB; the console stages it in
      S3 for you. The defaults give the target sizes and schedule; `StartupTime` is when startup
      begins (07:35 for 08:00 availability).
   4. `LaiAiGuardrail-dev` (after the platform: it attaches its policy to the instance role).
4. In **us-east-1**, create `LaiFrontend-dev` with `SiteDomainName` and `ApiDomainName`. Its
   certificate validates through Route 53 automatically when the zone was set at synthesis;
   otherwise open Certificate Manager in us-east-1 and add the CNAME it shows while the stack waits.
5. Watch progress under the stack's **Events** tab (or
   `aws cloudformation describe-stack-events --stack-name LaiDevPlatform-dev`). The CloudFront URL
   is the `CloudFrontUrl` output of `LaiFrontend-dev`.
6. Install the application: `./scripts/aws/install-debug.sh`.

### GitHub Actions

| Workflow                                                        | Trigger                                                                       | What it does                                                                                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Deploy DEV backend (native)** (`deploy-dev-native.yml`)       | push to `main` touching the backend; manual: deploy, rollback, deploy-pending | Django tests and checks, ARM64 release package, upload, SSM deploy, readiness; defers while dev is stopped                                            |
| **Deploy DEV Lambda workers** (`deploy-dev-lambda.yml`)         | push touching `lambda/` or the vendored AI provider; manual                   | worker tests, package, upload, update both functions                                                                                                  |
| **Deploy site (CloudFront)** (`deploy-site.yml`)                | push touching `react/`; manual deploy or rollback                             | builds React with the Cognito ids, publishes to S3 with the existing cache rules, invalidates, waits for the backend release of the same commit first |
| **Manage DEV Infrastructure** (`manage-dev-infrastructure.yml`) | manual only                                                                   | start, stop, restart, status, pause/resume schedule, hold, release-hold, urls, deploy-pending, start-and-deploy                                       |
| Deploy Django (EC2) (`deploy-django-ec2.yml`)                   | production                                                                    | unchanged for prod; its Docker dev job is skipped while native dev is enabled                                                                         |

Authentication is GitHub OIDC only, with one AWS role per GitHub Environment: `dev-backend`
(`LAI_DEV_BACKEND_ROLE_ARN`, `LAI_DEV_ARTIFACT_BUCKET`, `LAI_API_BASE_URL`), `dev-infrastructure`
(`LAI_DEV_INFRA_ROLE_ARN`) and `site-dev` (`LAI_SITE_DEPLOY_ROLE_ARN`, `LAI_COGNITO_USER_POOL_ID`,
`LAI_COGNITO_CLIENT_ID`, `LAI_SITE_BUCKET`, `LAI_SITE_DISTRIBUTION_ID`, `LAI_SITE_URL`).
Repository variables: `LAI_AWS_REGION=us-west-1`, `LAI_DEV_NATIVE_ENABLED=true` (switches dev to
the native pipeline), `LAI_DEV_STOPPED_DEPLOY=defer` (or `start`). `install-debug.sh` sets all of
them; check with `gh variable list` and `gh variable list --env dev-backend`.

To enable deployment: after `install-debug.sh` succeeds, set the site switch yourself:
`gh variable set LAI_SITE_DEPLOY_ENABLED --body true`. Backend and Lambda deployment start as
soon as `LAI_DEV_NATIVE_ENABLED` is `true`. With native dev enabled, production is released only
by a manual dispatch of "Deploy Django (EC2)" (the automatic prod path needed the Docker dev job).

To start or stop dev from GitHub: repository, **Actions**, **Manage DEV Infrastructure**,
**Run workflow**, choose the operation (and `hold_hours` for a hold), **Run workflow**. The job
summary shows EC2, RDS, the schedule, readiness and the CloudFront, game, API and admin URLs; it
works while dev is stopped. Inspect deployment results in each run's summary (commit SHA, result
`deployed`, `pending` or `failed`) and with `./scripts/aws/dev-release.sh status`.

### Daily operations

```bash
./scripts/aws/manage-dev.sh start            # RDS, then EC2, then verify (about 10 minutes)
./scripts/aws/manage-dev.sh stop             # quiesce, stop EC2, stop RDS
./scripts/aws/manage-dev.sh restart
./scripts/aws/manage-dev.sh status           # EC2, RDS, power state, schedule, readiness, releases
./scripts/aws/manage-dev.sh pause-schedule   # no automatic stop or start until resumed
./scripts/aws/manage-dev.sh resume-schedule
./scripts/aws/manage-dev.sh hold --hours 6   # skip tonight's stop (or --until 2026-11-20T08:00:00Z)
./scripts/aws/manage-dev.sh release-hold
./scripts/aws/manage-dev.sh connect          # shell on the instance through Systems Manager
./scripts/aws/manage-dev.sh logs django      # also nginx, deploy, jobs, lambda-ai, lambda-media, power
./scripts/aws/manage-dev.sh urls
./scripts/aws/manage-dev.sh deploy-pending   # apply a release that arrived while dev was stopped
./scripts/aws/manage-dev.sh start-and-deploy
./scripts/aws/manage-dev.sh cert-check
./scripts/aws/manage-dev.sh db-tunnel        # PostgreSQL on localhost:15432 through SSM
./scripts/aws/dev-release.sh status          # release history on the instance
./scripts/aws/dev-release.sh rollback        # previous healthy release (--to <sha> for another)
```

Every command takes `--profile`, `--region` and `--json`; `stop --force` ignores a hold. The
scripts discover every resource from the stack outputs (no hard-coded ids), refuse any
environment other than dev, any stack not tagged `Environment=dev` and, when
`LAI_DEV_ACCOUNT_ID` is set, any other account. They never terminate EC2 or delete RDS. Exit
codes: 0 ok, 1 failed, 2 usage, 3 AWS transport, 4 refused by the dev guard, 5 conflict (another
power run, an active hold), 6 timed out, 7 dev is stopped, 8 not provisioned.

### Nightly schedule

- **Shutdown** starts at **00:00 America/Los_Angeles** every day: deploys are refused from then
  on, the jobs consumer and gunicorn stop, EC2 stops, then RDS stops.
- **Startup** starts at **07:35** so the app is ready by **08:00**: RDS starts and becomes
  available, EC2 starts, Systems Manager comes online, nginx, gunicorn, the database and the
  readiness endpoint are verified, deferred job results are processed and a pending release is
  applied. Change the times with `LAI_SHUTDOWN_TIME`, `LAI_AVAILABLE_BY` and
  `LAI_STARTUP_WARMUP_MINUTES`, then `deploy-debug.sh --execute`.
- **Daylight saving time** is handled by EventBridge Scheduler's time zone; the times stay
  Pacific local time all year.
- **Overrides:** `hold` skips scheduled stops until a time (for a long debugging session);
  `pause-schedule` turns both schedules off at runtime; `LAI_ENABLE_SCHEDULE=false` turns them
  off in the stack. A manual `start` works at any time, and the next midnight stop still applies
  unless held or paused.
- **RDS seven-day limit:** AWS restarts a stopped database after seven days; a rule catches that
  event and stops it again unless dev is meant to be running.
- **While stopped:** the site, S3, CloudFront, Cognito, SQS (job results wait up to 14 days),
  Lambda and all configuration stay available; the API answers 502/504 (cached for 10 seconds
  only). You still pay for the Elastic IP, the EBS and RDS storage, backups, Secrets Manager and
  S3.

### Debugging

- **Shell:** `./scripts/aws/manage-dev.sh connect` (Systems Manager; no SSH, no open port).
- **nginx:** `manage-dev.sh logs nginx`, or on the instance `sudo tail -f /var/log/nginx/error.log`
  (there is deliberately no access log: request paths carry child ids).
- **Gunicorn and Django:** `manage-dev.sh logs django`; on the instance
  `sudo systemctl status lai-gunicorn` and `sudo tail -f /var/log/lai/django.log`.
- **Deploys:** `manage-dev.sh logs deploy`; `/var/log/lai/deploy.log` and
  `/opt/lai/state/releases.jsonl` on the instance.
- **Lambda:** `manage-dev.sh logs lambda-ai` or `lambda-media`; failed messages end in the
  `lai-dev-jobs-*-dlq` queues, which raise an alarm.
- **Background jobs:** Django Admin, Jobs, Processing jobs (pending, running, completed, failed);
  `sudo systemctl status lai-jobs-consumer` and `manage-dev.sh logs jobs`. Stale jobs are marked
  failed by the daily maintenance run.
- **PostgreSQL:** `manage-dev.sh db-tunnel`, then run the `psql` command it prints in a second
  terminal (TLS, password read from Secrets Manager at that moment, never printed).
- **Memory and disk:** on the instance `free -m`, `df -h /`, `systemd-cgtop`; CloudWatch alarms
  fire above 90% memory and 85% disk.
- **Failed migrations:** the deploy stops before switching releases and the previous release
  keeps running. Read `manage-dev.sh logs deploy`; the record says which migrations may have
  applied (`manual_db_review_required`). Fix forward with a new commit; migrations are never
  reversed automatically.
- **CloudFront errors:** a 502 on `/api/*` means the origin is down (dev stopped, gunicorn down)
  or its certificate is not valid yet (`manage-dev.sh cert-check`); a 403 on a page means the
  site was not published.
- **Cognito:** a 401 from Django means the token's pool or client is not the one in
  `/lai/dev/django/COGNITO_*`; check the React build's `LAI_COGNITO_*` variables in `site-dev`.

### Costs

| Service                                                     |             Always on | With the nightly schedule |
| ----------------------------------------------------------- | --------------------: | ------------------------: |
| EC2 t4g.small                                               |          about $14.60 |              about $10.00 |
| RDS db.t4g.micro                                            |          about $15.00 |              about $10.30 |
| EBS 15 GB + RDS 20 GB gp3                                   |           about $4.20 |               about $4.20 |
| Elastic IP (public IPv4)                                    |                 $3.65 |                     $3.65 |
| S3, CloudFront, CloudWatch, Secrets Manager, Step Functions |              $1 to $3 |                  $1 to $3 |
| Lambda and SQS                                              |               minimal |                   minimal |
| **Total**                                                   | **about $40 a month** |     **about $30 a month** |

Assumptions: us-west-1 on-demand prices as of November 2026 (about $0.020 an hour for each
instance), 730 hours a month, about 16.5 running hours a day with the schedule, light dev
traffic. Not included: Bedrock and Polly usage (capped by the existing daily limits and the
Bedrock budget), CPU credit surcharges if the burstable instances run hot for long, kept
snapshots, data transfer beyond the free tier, and a Route 53 zone ($0.50 a month). These are
estimates, not prices; check the [AWS Pricing Calculator](https://calculator.aws/#/). To spend
less: stop dev over weekends (`pause-schedule` then `stop`), shorten log retention, or use a
smaller instance. Set `LAI_ALARM_EMAIL` to get the monthly budget alert (default $40).

### Recovery and cleanup

- **Application rollback:** `./scripts/aws/dev-release.sh rollback [--to <sha>]`, or "Deploy DEV
  backend (native)" with `action: rollback`. Database migrations are never reversed.
- **Failed infrastructure deployment:** CloudFormation rolls back by itself; read the stack's
  events, fix the cause, run `deploy-debug.sh --plan` and `--execute` again. Start dev before
  updating `LaiDevPlatform-dev` (a stopped database cannot be modified).
- **Replace the EC2 instance:** `./scripts/aws/deploy-debug.sh --plan --refresh-ami`, review,
  `--execute`, then `./scripts/aws/install-debug.sh`. The database, buckets and Elastic IP are
  unaffected.
- **RDS backup and restore:** automated daily backups (3 days by default), plus manual snapshots
  with `aws rds create-db-snapshot --db-instance-identifier lai-dev --db-snapshot-identifier lai-dev-manual-<date>`.
  A restore creates a new database instance; switching the stack to it is a reviewed change.
- **Preserving the database:** deletion protection is on by default, and deleting the stack
  takes a final snapshot.
- **Deleting the environment (owner only):** set `LAI_DB_DELETION_PROTECTION=false`, run
  `deploy-debug.sh --execute`, then delete `LaiFrontend-dev` (us-east-1), `LaiAiGuardrail-dev`,
  `LaiDevPlatform-dev`, and only if wanted `LaiChildPhotos-dev`, `LaiAssetStorage-dev` and
  `LaiDevArtifacts-dev`. Buckets, log groups and the final RDS snapshot are retained and must be
  emptied and deleted by hand.
- **Avoiding production deletion:** every name here ends in `-dev`. Never type a stack name that
  does not; the scripts refuse any stack that is not tagged `Environment=dev`.

### Acceptance checklist (owner, against the live deployment)

- [ ] `deploy-debug.sh --plan` lists only `*-dev` stacks and contains no ALB, WAF, NAT gateway,
      ECR repository or Multi-AZ database.
- [ ] `deploy-debug.sh --execute` completes; `--status` shows every stack complete.
- [ ] EC2 is `t4g.small`, arm64, Amazon Linux 2023, with the Elastic IP; no SSH port open.
- [ ] RDS `lai-dev` is PostgreSQL 16, `db.t4g.micro`, Single-AZ, encrypted, not publicly accessible.
- [ ] `install-debug.sh` finishes with every acceptance check passing; a second run changes nothing.
- [ ] `https://lai.pauldimitriu.com` loads; a deep link such as `/parent` loads the app.
- [ ] `https://lai.pauldimitriu.com/api/v1/health/ready/` returns `ok`.
- [ ] A test parent signs in with Cognito, creates a child profile and plays an adventure.
- [ ] `https://ladm.pauldimitriu.com/admin/` works from `LAI_ADMIN_ALLOWED_CIDR` and is not
      reachable from elsewhere; `https://api.pauldimitriu.com/admin/` returns 404.
- [ ] Anonymous requests to the web, asset and child photo buckets return 403.
- [ ] A push to `main` deploys the backend and the site; a rollback works.
- [ ] A Question Studio batch completes through Lambda and its jobs show as completed in Admin.
- [ ] The midnight stop and the morning start run, and the app is ready by 08:00 Pacific.
- [ ] A push while stopped is reported as pending and applied at the next start.
- [ ] "Manage DEV Infrastructure" start, stop, status and hold work from GitHub.
- [ ] `manage-dev.sh cert-check` shows a Let's Encrypt certificate (not the placeholder).
- [ ] The first monthly bill is near the estimate.

### Remaining limitations and approvals

Live AWS deployment and the checklist above are owner gates and have not been run. Known
limitations: GLB optimization, thumbnail and image conversion, and audio transcoding are not on
Lambda yet (they need native tools; tracked in `docs/infrastructure/dev-native-environment.md`);
deploys restart gunicorn, so dev has a few seconds of 502s per release.
