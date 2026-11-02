"""Settings common to every environment. No secrets and no environment-specific behaviour."""

import os
import re
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

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
    "apps.assets",
    "apps.regions",
    "apps.game_sessions",
    "apps.education",
    "apps.progression",
    "apps.inventory",
    "apps.quests",
    "apps.ai",
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
    # Only the game launch routes declare a throttle (LAI-ANDROID-API-001); 429 `throttled`.
    "DEFAULT_THROTTLE_RATES": {"game_launch": os.environ.get("LAI_GAME_LAUNCH_RATE", "30/min")},
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

# --- Asset manager (LAI-2200, ADR-035; docs/ASSET_MANAGER.md section 13) --------------------
# Development defaults; production.py requires explicit values and test.py uses memory.
LAI_ASSET_STORAGE = os.environ.get("LAI_ASSET_STORAGE", "local").strip()
LAI_ASSET_BUCKET = os.environ.get("LAI_ASSET_BUCKET", "").strip()
LAI_ASSET_REGION = os.environ.get("LAI_ASSET_REGION", "").strip()
LAI_ASSET_LOCAL_ROOT = BASE_DIR / ".asset-storage"
LAI_ASSET_DELIVERY = os.environ.get("LAI_ASSET_DELIVERY", "django").strip()
LAI_ASSET_URL_TTL_SECONDS = int(os.environ.get("LAI_ASSET_URL_TTL_SECONDS", "3600"))
LAI_ASSET_MAX_UPLOAD_BYTES = int(os.environ.get("LAI_ASSET_MAX_UPLOAD_BYTES", "52428800"))  # 50 MB
if LAI_ASSET_STORAGE not in {"s3", "local", "memory"}:
    raise ImproperlyConfigured("LAI_ASSET_STORAGE must be s3, local or memory.")
if LAI_ASSET_DELIVERY not in {"django", "s3"}:
    raise ImproperlyConfigured("LAI_ASSET_DELIVERY must be django or s3.")
if not 60 <= LAI_ASSET_URL_TTL_SECONDS <= 43200:
    raise ImproperlyConfigured("LAI_ASSET_URL_TTL_SECONDS must be between 60 and 43200.")
if LAI_ASSET_DELIVERY == "s3" and LAI_ASSET_STORAGE != "s3":
    raise ImproperlyConfigured("LAI_ASSET_DELIVERY=s3 needs LAI_ASSET_STORAGE=s3.")

# --- Child profile photos (LAI-0904, ADR-042; docs/platform/CHILD_PHOTO_STORAGE.md) ---------
# A separate store from the asset manager: never the asset bucket, never published, never a CDN.
# `disabled` answers every photo request with 503 `photo_storage_unavailable`.
LAI_CHILD_PHOTO_STORAGE = os.environ.get("LAI_CHILD_PHOTO_STORAGE", "local").strip()
LAI_CHILD_PHOTOS_BUCKET = os.environ.get("LAI_CHILD_PHOTOS_BUCKET", "").strip()
LAI_CHILD_PHOTOS_REGION = os.environ.get("LAI_CHILD_PHOTOS_REGION", "").strip()
LAI_CHILD_PHOTO_LOCAL_ROOT = BASE_DIR / ".child-photo-storage"
LAI_CHILD_PHOTO_MAX_BYTES = int(os.environ.get("LAI_CHILD_PHOTO_MAX_BYTES", "1048576"))  # 1 MB
LAI_CHILD_PHOTO_MAX_DIMENSION = int(os.environ.get("LAI_CHILD_PHOTO_MAX_DIMENSION", "1024"))
LAI_CHILD_PHOTO_URL_TTL_SECONDS = int(os.environ.get("LAI_CHILD_PHOTO_URL_TTL_SECONDS", "300"))
if LAI_CHILD_PHOTO_STORAGE not in {"s3", "local", "memory", "disabled"}:
    raise ImproperlyConfigured("LAI_CHILD_PHOTO_STORAGE must be s3, local, memory or disabled.")
if not 1024 <= LAI_CHILD_PHOTO_MAX_BYTES <= 5 * 1024 * 1024:
    raise ImproperlyConfigured("LAI_CHILD_PHOTO_MAX_BYTES must be between 1 KB and 5 MB.")
if not 64 <= LAI_CHILD_PHOTO_MAX_DIMENSION <= 4096:
    raise ImproperlyConfigured("LAI_CHILD_PHOTO_MAX_DIMENSION must be between 64 and 4096.")
if not 30 <= LAI_CHILD_PHOTO_URL_TTL_SECONDS <= 900:
    raise ImproperlyConfigured("LAI_CHILD_PHOTO_URL_TTL_SECONDS must be between 30 and 900.")

# Uploads above this stay on disk while they are checked, never in memory.
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


# --- AI companion and tutor (Phase 7, LAI-0701 to 0704; docs/AI_SERVICE.md) ------------------
# `fake` answers locally with no network; `bedrock` calls Amazon Bedrock Converse with the
# Guardrail; `disabled` serves authored fallback content only. Credentials are never settings:
# boto3 uses its default chain (the EC2 instance role in AWS). production.py fails closed.
LAI_AI_PROVIDER = os.environ.get("LAI_AI_PROVIDER", "fake").strip()
LAI_AI_BEDROCK_REGION = os.environ.get("LAI_AI_BEDROCK_REGION", "").strip()
# The US geographic cross-Region inference profile (source us-west-1 routes to us-east-1,
# us-east-2, us-west-1 and us-west-2). Haiku 4.5 has no in-Region on-demand model id.
LAI_AI_MODEL_ID = os.environ.get(
    "LAI_AI_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0"
).strip()
LAI_AI_GUARDRAIL_ID = os.environ.get("LAI_AI_GUARDRAIL_ID", "").strip()
LAI_AI_GUARDRAIL_VERSION = os.environ.get("LAI_AI_GUARDRAIL_VERSION", "").strip()
LAI_AI_STRUCTURED_OUTPUT = env_bool("LAI_AI_STRUCTURED_OUTPUT", True)
# Same limits as the Amplify routes (temperature 0.4, 300 output tokens).
LAI_AI_MAX_OUTPUT_TOKENS = int(os.environ.get("LAI_AI_MAX_OUTPUT_TOKENS", "300"))
LAI_AI_TEMPERATURE = float(os.environ.get("LAI_AI_TEMPERATURE", "0.4"))
LAI_AI_TIMEOUT_SECONDS = float(os.environ.get("LAI_AI_TIMEOUT_SECONDS", "10"))
# Shared limits on model calls (LAI-0708, apps/ai/services/usage.py): PostgreSQL counters, so
# they hold across workers and instances. A denied turn gets authored content, never a model call.
LAI_AI_CHILD_TURNS_PER_MINUTE = int(os.environ.get("LAI_AI_CHILD_TURNS_PER_MINUTE", "12"))
LAI_AI_CHILD_TURNS_PER_DAY = int(os.environ.get("LAI_AI_CHILD_TURNS_PER_DAY", "300"))
LAI_AI_FAMILY_TURNS_PER_DAY = int(os.environ.get("LAI_AI_FAMILY_TURNS_PER_DAY", "750"))
LAI_AI_SESSION_TURNS_PER_DAY = int(os.environ.get("LAI_AI_SESSION_TURNS_PER_DAY", "150"))
LAI_AI_CHILD_CONCURRENT_TURNS = int(os.environ.get("LAI_AI_CHILD_CONCURRENT_TURNS", "2"))
# The application's own daily cost ceiling across every family (pilot scale).
LAI_AI_GLOBAL_TURNS_PER_DAY = int(os.environ.get("LAI_AI_GLOBAL_TURNS_PER_DAY", "20000"))
# Attempts per model call (botocore standard retry mode); 1 means no retry.
LAI_AI_MAX_ATTEMPTS = int(os.environ.get("LAI_AI_MAX_ATTEMPTS", "2"))
# Largest accepted request body for an AI turn, in bytes.
LAI_AI_MAX_REQUEST_BYTES = int(os.environ.get("LAI_AI_MAX_REQUEST_BYTES", "8192"))
# Cost estimates (apps/ai/services/costs.py): unset means no estimate, never a guessed price.
_price_in = os.environ.get("LAI_AI_PRICE_INPUT_PER_MTOK_USD", "").strip()
_price_out = os.environ.get("LAI_AI_PRICE_OUTPUT_PER_MTOK_USD", "").strip()
LAI_AI_PRICE_INPUT_PER_MTOK_USD = float(_price_in) if _price_in else None
LAI_AI_PRICE_OUTPUT_PER_MTOK_USD = float(_price_out) if _price_out else None
LAI_AI_PRICE_TABLE_VERSION = os.environ.get("LAI_AI_PRICE_TABLE_VERSION", "").strip()
# No approved retention period yet (LAI-0707, LAI-0308 gate G9): unset means `ai_retention`
# refuses to delete unless an operator passes --older-than-days explicitly.
_retention = os.environ.get("LAI_AI_AUDIT_RETENTION_DAYS", "").strip()
LAI_AI_AUDIT_RETENTION_DAYS = int(_retention) if _retention else None
if LAI_AI_PROVIDER not in {"fake", "bedrock", "disabled"}:
    raise ImproperlyConfigured("LAI_AI_PROVIDER must be fake, bedrock or disabled.")
if not 50 <= LAI_AI_MAX_OUTPUT_TOKENS <= 1000:
    raise ImproperlyConfigured("LAI_AI_MAX_OUTPUT_TOKENS must be between 50 and 1000.")
if not 0.0 <= LAI_AI_TEMPERATURE <= 1.0:
    raise ImproperlyConfigured("LAI_AI_TEMPERATURE must be between 0 and 1.")
if not 1 <= LAI_AI_TIMEOUT_SECONDS <= 60:
    raise ImproperlyConfigured("LAI_AI_TIMEOUT_SECONDS must be between 1 and 60.")
for _name, _low, _high in (
    ("LAI_AI_CHILD_TURNS_PER_MINUTE", 1, 120),
    ("LAI_AI_CHILD_TURNS_PER_DAY", 1, 5000),
    ("LAI_AI_FAMILY_TURNS_PER_DAY", 1, 20000),
    ("LAI_AI_SESSION_TURNS_PER_DAY", 1, 5000),
    ("LAI_AI_CHILD_CONCURRENT_TURNS", 1, 10),
    ("LAI_AI_GLOBAL_TURNS_PER_DAY", 1, 1000000),
    ("LAI_AI_MAX_ATTEMPTS", 1, 3),
    ("LAI_AI_MAX_REQUEST_BYTES", 1024, 65536),
):
    if not _low <= globals()[_name] <= _high:
        raise ImproperlyConfigured(f"{_name} must be between {_low} and {_high}.")
for _price in (LAI_AI_PRICE_INPUT_PER_MTOK_USD, LAI_AI_PRICE_OUTPUT_PER_MTOK_USD):
    if _price is not None and not 0 <= _price <= 1000:
        raise ImproperlyConfigured("LAI_AI_PRICE_*_PER_MTOK_USD must be between 0 and 1000.")


# DATABASE_URL query options passed to libpq: TLS to RDS (`?sslmode=verify-full&sslrootcert=...`,
# docs/platform/DJANGO_EC2_DEPLOYMENT.md). Anything else in the query string is refused.
DATABASE_URL_OPTIONS = {"sslmode", "sslrootcert", "connect_timeout"}
DATABASE_SSL_MODES = {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}


def database_from_url(url: str) -> dict:
    """Build a Django PostgreSQL config from a DATABASE_URL (stdlib only, no extra dependency)."""
    parts = urlsplit(url)
    if parts.scheme not in {"postgres", "postgresql"} or not parts.path.strip("/"):
        raise ImproperlyConfigured("DATABASE_URL must be postgresql://user:password@host:port/name")
    options = dict(parse_qsl(parts.query, keep_blank_values=True))
    unknown = set(options) - DATABASE_URL_OPTIONS
    if unknown:
        raise ImproperlyConfigured(f"DATABASE_URL has unsupported options: {sorted(unknown)}")
    if "sslmode" in options and options["sslmode"] not in DATABASE_SSL_MODES:
        raise ImproperlyConfigured("DATABASE_URL sslmode is not a libpq sslmode.")
    config = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": unquote(parts.path.lstrip("/")),
        "USER": unquote(parts.username or ""),
        "PASSWORD": unquote(parts.password or ""),
        "HOST": parts.hostname or "",
        "PORT": str(parts.port or 5432),
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
    }
    if options:
        config["OPTIONS"] = options
    return config


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


# --- Game-only WebView launches (LAI-ANDROID-API-001, ADR-036) ----------------------------------
# docs/android/ANDROID_GAME_LAUNCH.md. The game runtime is served from the same origin as the API
# (CloudFront path routing), so the cookie is host-only, scoped to `/api/v1/`, HttpOnly and
# SameSite=Strict. It authenticates only the game runtime routes
# (apps/game_sessions/runtime_auth.py).
LAI_GAME_ENTRY_URL = os.environ.get("LAI_GAME_ENTRY_URL", "/game/").strip()
LAI_GAME_ALLOWED_ORIGINS = env_list("LAI_GAME_ALLOWED_ORIGINS")
LAI_GAME_TICKET_TTL_SECONDS = int(os.environ.get("LAI_GAME_TICKET_TTL_SECONDS", "60"))
LAI_GAME_SESSION_TTL_SECONDS = int(os.environ.get("LAI_GAME_SESSION_TTL_SECONDS", "3600"))
LAI_GAME_COOKIE_NAME = "lai_game_session"
LAI_GAME_COOKIE_PATH = "/api/v1/"
LAI_GAME_COOKIE_SECURE = env_bool("LAI_GAME_COOKIE_SECURE", True)
if not 10 <= LAI_GAME_TICKET_TTL_SECONDS <= 300:
    raise ImproperlyConfigured("LAI_GAME_TICKET_TTL_SECONDS must be between 10 and 300.")
if not 300 <= LAI_GAME_SESSION_TTL_SECONDS <= 4 * 3600:
    raise ImproperlyConfigured("LAI_GAME_SESSION_TTL_SECONDS must be between 300 and 14400.")
if not (LAI_GAME_ENTRY_URL.startswith("/") or LAI_GAME_ENTRY_URL.startswith("https://")):
    raise ImproperlyConfigured("LAI_GAME_ENTRY_URL must be a path or an https URL.")
if any(not origin.startswith("https://") for origin in LAI_GAME_ALLOWED_ORIGINS):
    raise ImproperlyConfigured("LAI_GAME_ALLOWED_ORIGINS must list https origins only.")
