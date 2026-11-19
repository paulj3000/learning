"""Test settings (pytest only). Deterministic and local by construction.

Tests can never reach a development, staging, or production database: DATABASE_URL is ignored,
the host is always loopback, and pytest-django creates and drops a separate `test_<name>`
database, so the developer's own database is never written to.
"""

import os
from pathlib import Path

from .base import *  # noqa: F403
from .base import LOOPBACK_HOSTS, compose_database

# Concurrent agents (LAI-ENG-002, docs/infrastructure/multi-agent-local-environment.md): a
# worktree whose .env carries LAI_AGENT_SLOT (written by scripts/dev/agent_slot.py) gets its own
# PostgreSQL port and database name, so its pytest database (`test_<POSTGRES_DB>`) is never the
# one another worktree's run is dropping and recreating. Only these two values are read, only
# from an .env that opted in with a slot, and a value already in the shell wins. `make` already
# exports them from .env; this covers `pytest <path>` run directly, as the testing policy asks.
SLOT_DATABASE_KEYS = ("POSTGRES_PORT", "POSTGRES_DB")


def slot_database_env(env_path: Path) -> dict[str, str]:
    """POSTGRES_PORT and POSTGRES_DB from a slotted .env; empty when the .env has no slot."""
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}
    values = {}
    for line in lines:
        key, sep, value = line.partition("=")
        if sep:
            values[key.strip()] = value.strip()
    if not values.get("LAI_AGENT_SLOT", "").isdigit():
        return {}
    return {key: values[key] for key in SLOT_DATABASE_KEYS if values.get(key)}


for _key, _value in slot_database_env(Path(__file__).resolve().parents[3] / ".env").items():
    os.environ.setdefault(_key, _value)

DEBUG = False
LOG_RAW_EXCEPTIONS = False
SECRET_KEY = "test-only-not-a-secret"  # noqa: S105
ALLOWED_HOSTS = ["testserver", "localhost"]
# Admin login tests hash synthetic passwords; the slow production hasher adds nothing here.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
# The asset library never touches disk or AWS in tests (LAI-2200).
LAI_ASSET_STORAGE = "memory"
LAI_ASSET_DELIVERY = "django"
# Child photos likewise (LAI-0904): an in-process store per configuration.
LAI_CHILD_PHOTO_STORAGE = "memory"
# The AI pipeline never calls Bedrock in tests: the deterministic fake, scripted per test.
LAI_AI_PROVIDER = "fake"
LAI_SPEECH_PROVIDER = "fake"
LAI_SPEECH_STORAGE = "memory"

if os.environ.get("POSTGRES_HOST", "127.0.0.1") not in LOOPBACK_HOSTS:
    raise RuntimeError("Test settings only connect to a loopback PostgreSQL.")

DATABASES = {"default": compose_database()}
LAI_STUDIO_RUN_MODE = "manual"
# Background jobs run in-process through the worker's own task code (apps.jobs.core).
LAI_JOBS_BACKEND = "inline"
