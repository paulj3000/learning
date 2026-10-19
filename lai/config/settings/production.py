"""Production settings. Everything sensitive comes from the environment; nothing is in source.

Importing this module fails with a clear error when a required value is missing, so a
misconfigured deployment cannot start. No deployment environment exists yet.
"""

import os

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
from .base import database_from_url, env_bool, env_list


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ImproperlyConfigured(f"{name} must be set for production settings.")
    return value


DEBUG = False
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
SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_SECURE_HSTS_SECONDS", "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# Cognito (ADR-024): all three are mandatory. Without them every request would be rejected, so
# refuse to start rather than run an API nobody can use. Values come only from the environment.
COGNITO_REGION = _required("COGNITO_REGION")
COGNITO_USER_POOL_ID = _required("COGNITO_USER_POOL_ID")
COGNITO_ALLOWED_CLIENT_IDS = env_list("COGNITO_ALLOWED_CLIENT_IDS")
if not COGNITO_ALLOWED_CLIENT_IDS:
    raise ImproperlyConfigured("COGNITO_ALLOWED_CLIENT_IDS must list the allowed app client ids.")
if not COGNITO_USER_POOL_ID.startswith(COGNITO_REGION + "_"):
    raise ImproperlyConfigured("COGNITO_USER_POOL_ID must belong to COGNITO_REGION.")
