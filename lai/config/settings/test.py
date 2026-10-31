"""Test settings (pytest only). Deterministic and local by construction.

Tests can never reach a development, staging, or production database: DATABASE_URL is ignored,
the host is always loopback, and pytest-django creates and drops a separate `test_<name>`
database, so the developer's own database is never written to.
"""

import os

from .base import *  # noqa: F403
from .base import AUTHENTICATION_BACKENDS, LOCAL_PARENT_BACKEND, LOOPBACK_HOSTS, compose_database

DEBUG = False
LOG_RAW_EXCEPTIONS = False
SECRET_KEY = "test-only-not-a-secret"  # noqa: S105
ALLOWED_HOSTS = ["testserver", "localhost"]
# Admin login tests hash synthetic passwords; the slow production hasher adds nothing here.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
# Tests run the production provider; local-auth tests switch with `settings.AUTH_PROVIDER` and
# the backend (apps/users/tests/test_local_auth.py). The environment never changes this.
AUTH_PROVIDER = "cognito"
AUTHENTICATION_BACKENDS = [*AUTHENTICATION_BACKENDS, LOCAL_PARENT_BACKEND]
# The asset manager never touches disk or AWS in tests (LAI-2200).
LAI_ASSET_STORAGE = "memory"
LAI_ASSET_DELIVERY = "django"

if os.environ.get("POSTGRES_HOST", "127.0.0.1") not in LOOPBACK_HOSTS:
    raise RuntimeError("Test settings only connect to a loopback PostgreSQL.")

DATABASES = {"default": compose_database()}
