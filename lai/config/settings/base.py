"""Settings common to every environment. No secrets and no environment-specific behaviour."""

import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # lai/

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Deliberately minimal. django.contrib.auth, contenttypes, sessions and admin are NOT installed:
# installing auth now would create the default user table before the users task (LAI-0301)
# decides the user model, and a swappable user model is painful to change after migrations.
# Cognito JWT authentication (LAI-0402) and the admin (LAI-0404) add them deliberately.
INSTALLED_APPS = [
    "rest_framework",
    "apps.core",
]

# No sessions, no cookies, no CSRF middleware: the API is stateless and will authenticate with
# Cognito bearer tokens. Revisit in LAI-0402 if that changes.
MIDDLEWARE = [
    "apps.core.middleware.RequestContextMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

TEMPLATES: list[dict] = []

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Deny by default (CLAUDE.md section 10): with no authentication class installed yet, every view
# that does not opt out with AllowAny rejects the request. JSON in, JSON out.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
}

SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "same-origin"

# No CORS: the browser reaches the API same-origin (CloudFront path routing, see
# docs/DJANGO_TARGET_ARCHITECTURE.md). No CORS package is installed on purpose.

# Console logging only. Never log request bodies, headers, cookies, tokens, query strings,
# child names, or free text. `lai.request` writes the single access line per request.
# django.request is limited to ERROR (unexpected 500s with a traceback) so 4xx responses are
# not logged a second time with their raw path. django.server (runserver) is discarded because
# it logs full request lines, query strings included.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"request_id": {"()": "apps.core.middleware.RequestIdLogFilter"}},
    "formatters": {
        "plain": {"format": "%(asctime)s %(levelname)s %(name)s [req=%(request_id)s] %(message)s"}
    },
    "handlers": {
        "discard": {"class": "logging.NullHandler"},
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "plain",
            "filters": ["request_id"],
        },
    },
    "loggers": {
        "django.request": {"level": "ERROR"},
        "django.server": {"handlers": ["discard"], "propagate": False},
    },
    "root": {"handlers": ["console"], "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO")},
}

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


def database_from_url(url: str) -> dict:
    """Build a Django PostgreSQL config from a DATABASE_URL (stdlib only, no extra dependency)."""
    parts = urlsplit(url)
    if parts.scheme not in {"postgres", "postgresql"} or not parts.path.strip("/"):
        raise ImproperlyConfigured("DATABASE_URL must be postgresql://user:password@host:port/name")
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": unquote(parts.path.lstrip("/")),
        "USER": unquote(parts.username or ""),
        "PASSWORD": unquote(parts.password or ""),
        "HOST": parts.hostname or "",
        "PORT": str(parts.port or 5432),
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
    }


def compose_database() -> dict:
    """The docker-compose PostgreSQL on loopback, from compose's own POSTGRES_* variables."""
    user = os.environ.get("POSTGRES_USER", "lai")
    password = os.environ.get("POSTGRES_PASSWORD", "local-dev-only-password")
    name = os.environ.get("POSTGRES_DB", "lai")
    port = os.environ.get("POSTGRES_PORT", "5432")
    return database_from_url(f"postgresql://{user}:{password}@127.0.0.1:{port}/{name}")
