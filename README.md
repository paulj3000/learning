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

Requires Node.js 22+, Python 3.12+ and Docker (for PostgreSQL 16). Local development runs
React against Django REST and PostgreSQL, with parent sign-in through the existing Amazon
Cognito user pool. **No Amplify sandbox and no `amplify_outputs.json` are needed.**

One-time setup, from the repository root:

```bash
npm install
make py-install
cp .env.sample .env
```

In `.env`, fill in `COGNITO_REGION`, `COGNITO_USER_POOL_ID` and `COGNITO_ALLOWED_CLIENT_IDS` (web
client first) for the existing pool. To run Django on port 8000 instead of the default 8010, add
`DJANGO_DEV_PORT=8000`; `make runserver` and the Vite proxy both read it. `npm run dev` reuses the
same pool and web client for browser sign-in (override with `VITE_COGNITO_*` in
`react/.env.local`, template `react/.env.example`).

Database and content (first run, and after pulling migrations or content):

```bash
make up
make migrate
cd lai && ../.venv/bin/python manage.py load_content && ../.venv/bin/python manage.py seed_treasure_rush && ../.venv/bin/python manage.py publish_treasure_rush && cd ..
```

Then, in two terminals:

```bash
make runserver
```

```bash
make web
```

Open http://localhost:5183/. When Vite starts it prints `[lai] dev` lines: the backend (Django by
default), where `/api` is proxied and whether Django answered there, and whether Cognito is
configured (never the ids or any token). If a line says NOT, it says what to change.

Django Admin (staff only) is at `http://127.0.0.1:<DJANGO_DEV_PORT>/admin/` (8010 by default), after
`make createsuper`. Parents and children use the React app only.

Django is the only application backend (AMP-03, AMP-07): the retired `VITE_BACKEND=amplify` stops
the dev server with a message. The `amplify/` folder still defines the deployed Amplify backend
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
