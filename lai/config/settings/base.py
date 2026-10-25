"""Settings common to every environment. No secrets and no environment-specific behaviour."""

import os
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # lai/
# The versioned content export and its schema (LAI-0302); the catalog imports from here.
CONTENT_DIR = BASE_DIR.parent / "content"

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# The Django Admin stack (LAI-0404, ADR-034): admin, auth, contenttypes, sessions, messages and
# staticfiles. Sessions and CSRF exist for the admin only. The API stays bearer-only: DRF never
# uses session authentication, and the admin cookies are scoped to the admin path. Auth's Group
# and Permission tables are created but unused: `ParentAccount` has no permission relations, and
# admin rights come from `is_staff` / `is_superuser` (see apps/users/backends.py).
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",  # ArrayField for ChildProfile.interests
    "rest_framework",
    "apps.core",
    "apps.users",
    "apps.catalog",
    "apps.regions",
    "apps.game_sessions",
    "apps.education",
    "apps.progression",
    "apps.inventory",
    "apps.quests",
]

# The parent account is the user model (LAI-0301, ADR-022). Set before any migration is applied.
AUTH_USER_MODEL = "users.ParentAccount"

# Session, CSRF, authentication and message middleware serve the Django Admin only. DRF views
# are CSRF-exempt and authenticate with Cognito bearer tokens alone, so a session cookie never
# authenticates an API request (tested in apps/core/tests/test_django_admin.py).
MIDDLEWARE = [
    "apps.core.middleware.RequestContextMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Templates exist for the admin only; the API renders JSON.
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

# --- Django Admin (LAI-0404, ADR-034) -----------------------------------------------------------
# Where the admin is mounted. Overridable because a same-origin deployment (CloudFront routing
# `/api/` to Django) cannot also route `/admin/`: that path is a React route.
ADMIN_URL_PATH = os.environ.get("DJANGO_ADMIN_URL_PATH", "admin/").strip()
if not re.fullmatch(r"(?:[a-z0-9][a-z0-9_-]*/)+", ADMIN_URL_PATH) or ADMIN_URL_PATH.startswith(
    "api/"
):
    raise ImproperlyConfigured("DJANGO_ADMIN_URL_PATH must look like 'admin/' (no leading '/').")

# Staff sign in with a Django password, never a Cognito token; parents have unusable passwords
# and cannot sign in here. ModelBackend is deliberately absent (it would match by Cognito sub).
AUTHENTICATION_BACKENDS = ["apps.users.backends.AdminPasswordBackend"]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Admin cookies: scoped to the admin path so browsers never send them to `/api/`, HttpOnly, and
# short-lived. Production also marks them Secure (production.py).
SESSION_COOKIE_NAME = "lai_admin_session"
SESSION_COOKIE_PATH = "/" + ADMIN_URL_PATH
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 8 * 60 * 60
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
CSRF_COOKIE_NAME = "lai_admin_csrftoken"
CSRF_COOKIE_PATH = SESSION_COOKIE_PATH
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"

# Admin static files, collected into STATIC_ROOT when the image is built (static_build.py) with
# hashed names. A deployment serves them from S3 behind CloudFront, or with WhiteNoise from
# STATIC_ROOT when nothing else does (production.py).
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MANIFEST_STATIC_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

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
