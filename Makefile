# Developer commands. Python commands use .venv when present, otherwise whatever is on PATH
# (so CI needs no developer-specific paths). Node commands delegate to the root npm scripts.
PY ?= $(shell test -x $(CURDIR)/.venv/bin/python && echo $(CURDIR)/.venv/bin/python || echo python3)

# Development ports (owner, 2026-11-05): PostgreSQL 5442 (compose and Django default; override
# with POSTGRES_PORT), Django runserver 8010 (DJANGO_DEV_PORT), Vite 5183 (VITE_DEV_PORT).
DJANGO_DEV_PORT ?= 8010

# Local settings come from the untracked .env at the repository root (template: .env.sample),
# as in FinTwin. Compose reads .env itself but Django does not (no dotenv package), so the values
# are passed from here. A value already in the shell wins. Write `NAME=value`, unquoted; the last
# line for a name wins. Deployed environments never read .env (SSM, docs/platform).
ENV_FILE ?= .env
dotenv = $(subst #,\#,$(subst $$,$$$$,$(shell sed -n 's/^$(1)=//p' $(ENV_FILE) 2>/dev/null | tail -n 1 | tr -d '\r')))

# The compose database settings reach every target (e.g. POSTGRES_PORT to move off the 5442 default).
$(foreach v,POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD POSTGRES_PORT,\
  $(if $(call dotenv,$(v)),$(eval export $(v) ?= $(call dotenv,$(v)))))

# Application settings reach only the targets that run Django with local settings, never the
# tests (test settings and fixtures set their own Cognito, storage and admin values).
DJANGO_ENV_TARGETS := django-check migrate-check migrate runserver
DJANGO_ENV_VARS := DATABASE_URL DJANGO_SECRET_KEY DJANGO_DEBUG DJANGO_ALLOWED_HOSTS \
  DJANGO_LOG_LEVEL DJANGO_ADMIN_URL_PATH DJANGO_STATIC_URL LAI_LOG_RAW_EXCEPTIONS \
  COGNITO_REGION COGNITO_USER_POOL_ID COGNITO_ALLOWED_CLIENT_IDS \
  LAI_ASSET_STORAGE LAI_ASSET_BUCKET LAI_ASSET_REGION LAI_ASSET_DELIVERY \
  LAI_ASSET_URL_TTL_SECONDS LAI_ASSET_MAX_UPLOAD_BYTES \
  LAI_GAME_ENTRY_URL LAI_GAME_ALLOWED_ORIGINS LAI_GAME_TICKET_TTL_SECONDS \
  LAI_GAME_SESSION_TTL_SECONDS LAI_GAME_COOKIE_SECURE LAI_GAME_LAUNCH_RATE \
  LAI_AI_PROVIDER LAI_AI_BEDROCK_REGION LAI_AI_MODEL_ID LAI_AI_GUARDRAIL_ID \
  LAI_AI_GUARDRAIL_VERSION LAI_AI_STRUCTURED_OUTPUT LAI_AI_TIMEOUT_SECONDS
$(foreach v,$(DJANGO_ENV_VARS),\
  $(if $(call dotenv,$(v)),$(eval $(DJANGO_ENV_TARGETS): export $(v) ?= $(call dotenv,$(v)))))

.PHONY: help py-install py-lint py-format py-format-check py-test py-test-db py-check js-check check up down
.PHONY: django-check migrate-check migrate runserver

help:
	@echo "py-install | py-lint | py-format-check | py-format | py-test | py-check"
	@echo "js-check (typecheck, lint, format:check, test, build) | check (py-check + js-check)"
	@echo "up | down (local PostgreSQL 16 via docker compose; default port 5442; set POSTGRES_PORT to change it)"
	@echo "django-check | migrate-check | migrate | runserver | py-test-db (fails if PostgreSQL is down)"

py-install:
	test -d .venv || python3 -m venv .venv
	.venv/bin/pip install -r requirements-dev.txt

py-lint:
	$(PY) -m ruff check .

py-format-check:
	$(PY) -m ruff format --check .

py-format:
	$(PY) -m ruff check --fix .
	$(PY) -m ruff format .

py-test:
	$(PY) -m pytest -q

# Same as py-test, but the PostgreSQL tests fail instead of skipping when `make up` was not run.
py-test-db:
	LAI_REQUIRE_POSTGRES=1 $(PY) -m pytest -q

# Django management commands (local settings; need no database except migrate and runserver).
django-check:
	cd lai && $(PY) manage.py check

migrate-check:
	cd lai && $(PY) manage.py makemigrations --check --dry-run

migrate:
	cd lai && $(PY) manage.py migrate

# Local development only: boto3 resolves AWS credentials through the named profile
# `learning-dev`, which must already exist in your AWS config (it is never created here).
# Override with `make runserver AWS_PROFILE=other`; a profile already exported in the shell wins.
# Exported, so the autoreloader's child process inherits it. Deployed servers never use make.
runserver: export AWS_PROFILE ?= learning-dev
runserver:
	cd lai && $(PY) manage.py runserver 127.0.0.1:$(DJANGO_DEV_PORT)

# No Python type checker yet. Decision deferred to LAI-0204, when Django exists and a checker
# with Django stubs can be chosen (see docs/IMPLEMENTATION_STATUS.md, LAI-0202).
py-check: py-lint py-format-check django-check migrate-check py-test

js-check:
	npm run adr:check
	npm run admin-preview:check
	npm run typecheck
	npm run lint
	npm run format:check
	npm test
	npm run build

check: py-check js-check

up:
	docker compose up -d --wait db

down:
	docker compose down
