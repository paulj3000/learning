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
