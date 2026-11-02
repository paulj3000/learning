"""Production settings. Everything sensitive comes from the environment; nothing is in source.

Importing this module fails with a clear error when a required value is missing, so a
misconfigured deployment cannot start. The EC2 release pipeline that supplies these values is in
docs/platform/DJANGO_EC2_DEPLOYMENT.md (ADR-037); nothing is provisioned until the owner approves.
"""

import os

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
from .base import MANIFEST_STATIC_STORAGES, MIDDLEWARE, database_from_url, env_bool, env_list


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ImproperlyConfigured(f"{name} must be set for production settings.")
    return value


DEBUG = False
LOG_RAW_EXCEPTIONS = False  # never from the environment in production
SECRET_KEY = _required("DJANGO_SECRET_KEY")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS")
if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must list explicit host names (no '*').")

DATABASES = {"default": database_from_url(_required("DATABASE_URL"))}

# Trust the proxy's forwarded protocol only when told a trusted proxy (for example a load
# balancer) is in front. Off by default because no deployment topology is decided yet.
if env_bool("DJANGO_TRUST_PROXY_SSL_HEADER", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True)
# Load balancer and container health checks call over plain HTTP inside the network.
SECURE_REDIRECT_EXEMPT = [r"^api/v1/health/$", r"^api/v1/health/ready/$"]
SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_SECURE_HSTS_SECONDS", "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
LAI_GAME_COOKIE_SECURE = True  # the game session cookie (ADR-036) is never sent over plain HTTP

# Django Admin (LAI-0404, ADR-034). Every origin that serves the admin login form must be listed,
# as https:// origins, so CSRF accepts its POSTs.
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")
if any(not origin.startswith("https://") or "*" in origin for origin in CSRF_TRUSTED_ORIGINS):
    raise ImproperlyConfigured("DJANGO_CSRF_TRUSTED_ORIGINS must list explicit https:// origins.")

# Admin static files: collected with hashed names when the image is built, so the manifest in the
# image matches the files uploaded to S3 (scripts/release-admin-static.sh). STATIC_URL stays
# `/static/` when CloudFront routes that path to the bucket on the admin's own host; set
# DJANGO_STATIC_URL only if the files live on another origin. WhiteNoise serves the same files
# from the image when no CloudFront behaviour is in front (local container runs, fallback).
STATIC_URL = os.environ.get("DJANGO_STATIC_URL", "").strip() or STATIC_URL  # noqa: F405
_static_is_url = ":" in STATIC_URL or STATIC_URL.startswith("//")
if _static_is_url and not STATIC_URL.startswith("https://"):
    raise ImproperlyConfigured("DJANGO_STATIC_URL must be https:// or a path.")
if not STATIC_URL.endswith("/"):
    raise ImproperlyConfigured("DJANGO_STATIC_URL must end with '/'.")
MIDDLEWARE = [*MIDDLEWARE]
MIDDLEWARE.insert(
    MIDDLEWARE.index("django.middleware.security.SecurityMiddleware") + 1,
    "whitenoise.middleware.WhiteNoiseMiddleware",
)
STORAGES = MANIFEST_STATIC_STORAGES

# Asset manager (LAI-2200): storage must be chosen explicitly; never local disk in production.
LAI_ASSET_STORAGE = _required("LAI_ASSET_STORAGE")
if LAI_ASSET_STORAGE != "s3":
    raise ImproperlyConfigured("LAI_ASSET_STORAGE must be s3 in production.")
LAI_ASSET_BUCKET = _required("LAI_ASSET_BUCKET")
LAI_ASSET_REGION = _required("LAI_ASSET_REGION")

# Child photos (LAI-0904, ADR-042): S3 or explicitly off, never local disk. Unset means off, so
# a release that reaches an environment before the LaiChildPhotos stack still starts; the photo
# endpoints then answer 503. The photo bucket is never the asset bucket.
LAI_CHILD_PHOTO_STORAGE = os.environ.get("LAI_CHILD_PHOTO_STORAGE", "disabled").strip()
if LAI_CHILD_PHOTO_STORAGE not in {"s3", "disabled"}:
    raise ImproperlyConfigured("LAI_CHILD_PHOTO_STORAGE must be s3 or disabled in production.")
if LAI_CHILD_PHOTO_STORAGE == "s3":
    LAI_CHILD_PHOTOS_BUCKET = _required("LAI_CHILD_PHOTOS_BUCKET")
    LAI_CHILD_PHOTOS_REGION = _required("LAI_CHILD_PHOTOS_REGION")
    if LAI_CHILD_PHOTOS_BUCKET == LAI_ASSET_BUCKET:
        raise ImproperlyConfigured("LAI_CHILD_PHOTOS_BUCKET must not be the asset bucket.")

# Cognito (ADR-024): all three are mandatory. Without them every request would be rejected, so
# refuse to start rather than run an API nobody can use. Values come only from the environment.
COGNITO_REGION = _required("COGNITO_REGION")
COGNITO_USER_POOL_ID = _required("COGNITO_USER_POOL_ID")
COGNITO_ALLOWED_CLIENT_IDS = env_list("COGNITO_ALLOWED_CLIENT_IDS")
if not COGNITO_ALLOWED_CLIENT_IDS:
    raise ImproperlyConfigured("COGNITO_ALLOWED_CLIENT_IDS must list the allowed app client ids.")
if not COGNITO_USER_POOL_ID.startswith(COGNITO_REGION + "_"):
    raise ImproperlyConfigured("COGNITO_USER_POOL_ID must belong to COGNITO_REGION.")

# AI (Phase 7, LAI-0704; docs/AI_SERVICE.md): fail closed. Unset means `disabled` (authored
# fallback content only), so a release that reaches an environment before the Guardrail stack
# still starts. The fake model is a development tool and never runs here. Bedrock without a
# region, model or Guardrail refuses to start rather than call the model unguarded.
LAI_AI_PROVIDER = os.environ.get("LAI_AI_PROVIDER", "disabled").strip()
if LAI_AI_PROVIDER not in {"bedrock", "disabled"}:
    raise ImproperlyConfigured("LAI_AI_PROVIDER must be bedrock or disabled in production.")
if LAI_AI_PROVIDER == "bedrock":
    LAI_AI_BEDROCK_REGION = _required("LAI_AI_BEDROCK_REGION")
    LAI_AI_MODEL_ID = _required("LAI_AI_MODEL_ID")
    LAI_AI_GUARDRAIL_ID = _required("LAI_AI_GUARDRAIL_ID")
    LAI_AI_GUARDRAIL_VERSION = _required("LAI_AI_GUARDRAIL_VERSION")
    if LAI_AI_GUARDRAIL_VERSION.upper() == "DRAFT":
        raise ImproperlyConfigured("LAI_AI_GUARDRAIL_VERSION must be a published version.")
