"""Local development settings. Never used by deployments (those set production)."""

import os

from .base import *  # noqa: F403
from .base import compose_database, database_from_url, env_bool, env_list

DEBUG = env_bool("DJANGO_DEBUG", True)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "local-development-only-not-a-secret")  # noqa: S105
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")

# DATABASE_URL wins; otherwise the docker-compose PostgreSQL on loopback (`make up`).
DATABASES = {
    "default": (
        database_from_url(os.environ["DATABASE_URL"])
        if os.environ.get("DATABASE_URL")
        else compose_database()
    )
}
