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
# the user model is `users.ParentAccount` (a plain AbstractBaseUser with no permission tables or
# superuser flag), so auth's Group/Permission tables would be unused, and leaving the app out
# means there is no `createsuperuser` path around Cognito. The admin (LAI-0404) adds auth,
# contenttypes, sessions and messages deliberately.
INSTALLED_APPS = [
    "django.contrib.postgres",  # ArrayField for ChildProfile.interests
    "rest_framework",
    "apps.core",
    "apps.users",
    "apps.catalog",
    "apps.game_sessions",
    "apps.education",
    "apps.progression",
    "apps.inventory",
    "apps.quests",
]

# The parent account is the user model (LAI-0301, ADR-022). Set before any migration is applied.
AUTH_USER_MODEL = "users.ParentAccount"

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

# Deny by default (CLAUDE.md section 10): every view needs a verified Cognito access token that
# maps to an active ParentAccount unless it opts out explicitly (the health view uses AllowAny;
# onboarding uses IsVerifiedPrincipal). JSON in, JSON out.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.users.authentication.CognitoJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["apps.users.permissions.IsProvisionedParent"],
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

# Console logging only, through apps/core/privacy.py (ADR-025). Never log request bodies, headers,
# cookies, tokens, query strings, raw paths, exception messages, child names, or free text.
# * `lai.request` writes the single access line per request (route pattern, never the raw path).
# * Exceptions print as type plus file:line:function only; raw tracebacks are a local opt-in.
# * The "django" logger gets NO handlers of its own (Django's default would attach one that emails
#   full request reports to ADMINS and one that bypasses our formatter); records reach the root.
# * django.request is limited to ERROR (unexpected 500s) so 4xx are not logged twice.
# * django.db.backends is pinned above DEBUG: at DEBUG it logs every SQL statement with its
#   parameters (nicknames, subs). django.server (runserver) is discarded: it logs full request
#   lines, query strings included.
# * The root level can be raised but never lowered below INFO.
LOG_RAW_EXCEPTIONS = False  # local.py may opt in; test and production force False
ADMINS: list = []  # error-report email is not used; keep it impossible by accident
MANAGERS: list = []
DEFAULT_EXCEPTION_REPORTER_FILTER = "apps.core.reporting.PrivacyExceptionReporterFilter"

_LEVELS = {"INFO", "WARNING", "ERROR", "CRITICAL"}
_requested_level = os.environ.get("DJANGO_LOG_LEVEL", "INFO").strip().upper()
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_id": {"()": "apps.core.privacy.RequestIdLogFilter"},
        "privacy": {"()": "apps.core.privacy.PrivacyFilter"},
    },
    "formatters": {
        "plain": {
            "()": "apps.core.privacy.PrivacyFormatter",
            "format": "%(asctime)s %(levelname)s %(name)s [req=%(request_id)s] %(message)s",
        }
    },
    "handlers": {
        "discard": {"class": "logging.NullHandler"},
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "plain",
            "filters": ["request_id", "privacy"],
        },
    },
    "loggers": {
        "django": {"handlers": [], "level": "INFO", "propagate": True},
        "django.request": {"level": "ERROR"},
        "django.db.backends": {"level": "WARNING"},
        "django.server": {"handlers": ["discard"], "propagate": False},
    },
    "root": {
        "handlers": ["console"],
        "level": _requested_level if _requested_level in _LEVELS else "INFO",
    },
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


# Cognito (ADR-024). No defaults: if any is empty, every bearer token is rejected (fail closed).
# Production settings require all three. The client ids are an allow-list; the Amplify web app
# client is the only one in use and no new app client is created.
COGNITO_REGION = os.environ.get("COGNITO_REGION", "").strip()
COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "").strip()
COGNITO_ALLOWED_CLIENT_IDS = env_list("COGNITO_ALLOWED_CLIENT_IDS")
