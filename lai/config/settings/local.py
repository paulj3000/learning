"""Local development settings. Never used by deployments (those set production)."""

import os

from .base import *  # noqa: F403
from .base import (
    AUTHENTICATION_BACKENDS,
    LOCAL_PARENT_BACKEND,
    compose_database,
    database_from_url,
    env_bool,
    env_list,
    resolve_auth_provider,
)

DEBUG = env_bool("DJANGO_DEBUG", True)
# Raw tracebacks show exception messages, which can quote private data. Opt in only with synthetic
# data. Local settings only: production and test force this off.
LOG_RAW_EXCEPTIONS = env_bool("LAI_LOG_RAW_EXCEPTIONS", False)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "local-development-only-not-a-secret")  # noqa: S105
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")
# runserver is plain HTTP; an emulator WebView would never send a Secure cookie back (ADR-036).
LAI_GAME_COOKIE_SECURE = env_bool("LAI_GAME_COOKIE_SECURE", False)

# DATABASE_URL wins; otherwise the docker-compose PostgreSQL on loopback (`make up`).
DATABASES = {
    "default": (
        database_from_url(os.environ["DATABASE_URL"])
        if os.environ.get("DATABASE_URL")
        else compose_database()
    )
}

# API authentication (ADR-038): Django sign-in by default while DEBUG is on, so local development
# needs no AWS. Set AUTH_PROVIDER=cognito (and the COGNITO_* values) to test against a real pool.
AUTH_PROVIDER = resolve_auth_provider(debug=DEBUG)
if AUTH_PROVIDER == "django":
    AUTHENTICATION_BACKENDS = [*AUTHENTICATION_BACKENDS, LOCAL_PARENT_BACKEND]
    # The session and CSRF cookies must reach `/api/` as well as the admin. Vite proxies `/api` to
    # runserver (react/src/api/devProxy.ts), so the browser sees one origin and no CORS is needed.
    SESSION_COOKIE_PATH = "/"
    CSRF_COOKIE_PATH = "/"
    # Only for a setup that calls Django from another origin; the Vite proxy needs none.
    CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")
