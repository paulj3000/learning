"""Test settings (pytest only). Deterministic and local by construction.

Tests can never reach a development, staging, or production database: DATABASE_URL is ignored,
the host is always loopback, and pytest-django creates and drops a separate `test_<name>`
database, so the developer's own database is never written to.
"""

import os

from .base import *  # noqa: F403
from .base import LOOPBACK_HOSTS, compose_database

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
