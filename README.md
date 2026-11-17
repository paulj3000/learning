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

## Serverless background processing (LAI-LAMBDA, Wave 1 built; AWS not deployed)

Heavy asset work (validating GLB models, processing audio, analysing NPC animation, optimising
assets) is moving to background jobs (ADR-061, proposed). Django stays authoritative for every
job's state and for publication; AWS Lambda only computes. Full design: `docs/processing/`
(`ARCHITECTURE.md`, `CONTRACTS.md`, `LIFECYCLE.md`, `SECURITY.md`, `OPERATIONS.md`,
`WAVE2_HANDOFF.md`).

### Architecture

```text
Staff upload (Django Admin)
  -> Django: ProcessingJob row in PostgreSQL (RDS) + original stored privately in S3
  -> transactional outbox -> SQS work queue
  -> Lambda worker: verify input checksum, run the processor, write artifacts to S3
  -> SQS completion queue (result inline, or a reference to a stored result)
  -> Django completion consumer: verify job, attempt, idempotency key and checksum,
     commit the result, then acknowledge the message
  -> staff review in Django Admin -> staff explicitly approve and publish
```

- Lambda never connects to RDS and never publishes an asset. It needs only S3 and SQS, so work
  and completions queue up safely while the development EC2 instance and database are stopped
  overnight (00:00 to 08:00 Pacific), and Django drains the backlog when it starts.
- Delivery is at least once. Duplicates and late results are expected and handled by
  idempotency keys, attempt ids and guarded state transitions; nothing claims exactly-once.

### AWS development environment (target; owner approved; not yet deployed)

Region `us-west-1`: a small EC2 instance with Nginx and Django/DRF; Amazon RDS PostgreSQL 16,
Single-AZ, reachable only privately (no PostgreSQL on the EC2 instance, no Docker on it); S3 and
CloudFront for the React build; S3 for models, audio, textures and generated artifacts; Lambda
and SQS work/completion queues for processing; Cognito, Bedrock, Polly and CloudWatch. Lambda
code may be packaged as a container image when a native dependency needs it; EC2 never runs
Docker. Infrastructure is defined once, in the CDK app in `infra/`, synthesized to
CloudFormation. Open owner decisions (release pipeline, the dev load balancer and WAF, Lambda
code packaging) are listed in ADR-061 and `docs/processing/WAVE2_HANDOFF.md`.

### Local versus AWS execution

| | Local workstation and tests | AWS |
|---|---|---|
| Database | local PostgreSQL 16 (`make up`) or none for the processing tests | RDS PostgreSQL, Single-AZ |
| Storage | in-memory fakes (Wave 1); filesystem adapter (Wave 2) | S3 |
| Queues | in-memory fake queue (Wave 1); local worker (Wave 2) | SQS work and completion queues with DLQs |
| Worker | `python -m lai_processing run` | Lambda (Wave 2) |

### The processing package

`processing/lai_processing/` is a standard-library-only Python 3.12 package: no Django, boto3,
Lambda, HTTP or database imports (a test enforces it). It is installable with
`pip install ./processing` and already importable in this repository's tooling (pytest's
`pythonpath` includes `processing`). Layout:

- `contracts/`: versioned job request, result, artifact, completion-event and profile contracts;
  strict JSON codec; example fixtures (`contracts/fixtures/`) and JSON Schemas
  (`contracts/schemas/`).
- `core/`: error and retry taxonomy, resource limits, idempotency keys, job lifecycle, retry
  policy, processor interface and registry, execution engine, private temporary workspace.
- `ports/`: storage, queue, telemetry and clock interfaces.
- `processors/reference.py`: the reference processor (checksum and deterministic metadata).
- `testing/`: in-memory storage, queue, telemetry and clock for tests.
- `cli/`: the command-line interface.

### CLI

Runs without AWS credentials, Django, PostgreSQL or internet access. From the repository root,
with the project's Python environment:

```bash
export PYTHONPATH=processing   # or: pip install ./processing
FIX=processing/lai_processing/contracts/fixtures

python -m lai_processing --help
python -m lai_processing --version
python -m lai_processing processors list            # add --json for machine-readable output
python -m lai_processing job-types list             # declared job types and their owner tasks
python -m lai_processing validate-job $FIX/request.reference.json
python -m lai_processing encode-job $FIX/request.reference.json   # the canonical queue message
python -m lai_processing run $FIX/request.reference.json \
    --input-file $FIX/request.reference.input.txt --output-dir /tmp/lai-job
```

`run` writes `result.json`, `completion-event.json` and `artifacts/`. Exit codes: 0 success,
1 the job ran and did not succeed, 2 usage error, 3 invalid request, 4 local file error.

To inspect the contracts: read `docs/processing/CONTRACTS.md`, the JSON Schemas in
`processing/lai_processing/contracts/schemas/`, and the valid and invalid example messages in
`processing/lai_processing/contracts/fixtures/` (`invalid/manifest.json` names the error each
invalid message must produce).

### Unit tests

```bash
.venv/bin/python -m pytest -q tests/processing/      # the processing package only
```

They need no database, AWS or network. The processing tests are also part of `make py-test`.

### Development waves

| Wave | Tasks | Scope | Status |
|---|---|---|---|
| 1 | LAI-LAMBDA-001 | Shared package, contracts, registry, ports, idempotency, lifecycle, CLI | Built on `feature/serverless-processing`, owner review pending |
| 2 | LAI-LAMBDA-002, 003, 004, 005 | GLB validator; local worker and S3/SQS adapters with Lambda handler; Django `ProcessingJob` app and Admin; AWS infrastructure | Specified (`docs/processing/WAVE2_HANDOFF.md`), not started |
| 3 | LAI-LAMBDA-006, 007 | End-to-end processing; Asset Library integration | Not started |
| 4 | LAI-LAMBDA-008, 009, 010 | Audio, NPC animation, asset optimisation | Not started |
| 5 | LAI-LAMBDA-011, 012 | AWS acceptance; production rollout | Not started |

Wave 1 implemented the runtime-independent package, contracts and CLI only. Nothing is deployed;
no Django model, migration, queue, Lambda function or IAM policy exists yet; asset upload and
publication in Django Admin are unchanged.
