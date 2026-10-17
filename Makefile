# Developer commands. Python commands use .venv when present, otherwise whatever is on PATH
# (so CI needs no developer-specific paths). Node commands delegate to the root npm scripts.
PY ?= $(shell test -x $(CURDIR)/.venv/bin/python && echo $(CURDIR)/.venv/bin/python || echo python3)

.PHONY: help py-install py-lint py-format py-format-check py-test py-test-db py-check js-check check up down
.PHONY: django-check migrate-check migrate runserver

help:
	@echo "py-install | py-lint | py-format-check | py-format | py-test | py-check"
	@echo "js-check (typecheck, lint, format:check, test, build) | check (py-check + js-check)"
	@echo "up | down (local PostgreSQL 16 via docker compose; set POSTGRES_PORT if 5432 is taken)"
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

runserver:
	cd lai && $(PY) manage.py runserver

# No Python type checker yet. Decision deferred to LAI-0204, when Django exists and a checker
# with Django stubs can be chosen (see docs/IMPLEMENTATION_STATUS.md, LAI-0202).
py-check: py-lint py-format-check django-check migrate-check py-test

js-check:
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
