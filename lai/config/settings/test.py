"""Test settings (pytest only). Deterministic and local by construction.

Tests can never reach a development, staging, or production database: DATABASE_URL is ignored,
the host is always loopback, and pytest-django creates and drops a separate `test_<name>`
database, so the developer's own database is never written to.
"""

import os

from .base import *  # noqa: F403
from .base import LOOPBACK_HOSTS, compose_database

DEBUG = False
SECRET_KEY = "test-only-not-a-secret"  # noqa: S105
ALLOWED_HOSTS = ["testserver", "localhost"]

if os.environ.get("POSTGRES_HOST", "127.0.0.1") not in LOOPBACK_HOSTS:
    raise RuntimeError("Test settings only connect to a loopback PostgreSQL.")

DATABASES = {"default": compose_database()}
