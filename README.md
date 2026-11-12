# Learning Adventure Island

AI-powered learning adventures for children ages 3–8, built with React, TypeScript, and a Django backend on AWS (Amazon Cognito for parent sign-in).

This repository currently contains the product and engineering specification Claude should use to build the project from an empty source tree.

## Start here

1. Open the repository as a Claude Code project.
2. Ask Claude to read `CLAUDE.md` and all files under `docs/`.
3. Begin with Roadmap Phase 0 in `docs/ROADMAP.md`.
4. Require Claude to update `docs/IMPLEMENTATION_STATUS.md` after each task.

Suggested first instruction:

```text
Read CLAUDE.md and the docs directory. Implement Roadmap Phase 0 only. Scaffold the React/Vite/TypeScript frontend and Amplify Gen 2 backend, establish tests and CI, then update IMPLEMENTATION_STATUS.md. Do not implement product features yet.
```

## Product premise

Children do not select worksheets. They enter adventures. Learning allows them to repair, create, discover, and permanently change the island.

## Local development

Requires Node.js 22 or later.

```bash
npm install
npm run dev
```

This runs the frontend only. For sign-in and data it needs the Cognito settings and a Django API
(below).

### Sign-in settings for the React app

The app signs parents in to an Amazon Cognito user pool directly (`react/src/lib/cognito`,
AMP-02). Set the pool and its public web client at build or dev time:

```bash
VITE_COGNITO_USER_POOL_ID=us-west-1_xxxxxxxxx VITE_COGNITO_CLIENT_ID=xxxxxxxx \
  VITE_BACKEND=django npm run dev
```

Neither value is a secret. Without them the app runs but shows sign-in as not set up. There is no
`amplify_outputs.json` any more. The `amplify/` folder still defines the deployed Amplify backend
(the Cognito pool, legacy tables and storage) until it is decommissioned
(`docs/platform/AMPLIFY_DECOMMISSION.md`); the app does not use it. Do not commit `.env` files.

### Python tooling (for the future Django backend in `lai/`)

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
app signs in to the pool directly (`VITE_COGNITO_*` above), and a local Django needs the
`COGNITO_*` values of the same test pool. Django Admin keeps its own staff sign-in. Step by step, including Treasure
Rush: `docs/TREASURE_RUSH_LOCAL_DEV.md`.

### Available scripts

The frontend lives in `react/` (an npm workspace). Run every command below from the
repository root; the root scripts delegate to it. `amplify/`, `scripts/`, `docs/`, and `tasks/`
stay at the root. Older docs that say `src/features/...` now mean `react/src/features/...`.

```bash
npm run dev          # start the Vite dev server
npm run build         # typecheck and build for production
npm run preview       # preview the production build locally
npm run typecheck     # typecheck app, scripts, server, infra and the legacy amplify backend
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

## Backend migration (proposed)

The move from Amplify Gen 2 to Django (ADR-019) is in its exit phase: the app no longer calls
Amplify Auth, Data, Storage or Functions (AMP-02 to AMP-07, `docs/platform/AMPLIFY_EXIT_STATUS.md`).
The live AWS cutover and decommission follow `docs/platform/AMPLIFY_DECOMMISSION.md`, step by step
with owner approval.
