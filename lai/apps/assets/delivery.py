"""Delivery URLs for published versions (LAI-2200 AM-6; `docs/ASSET_LIBRARY.md` section 8).

`GLTFLoader` fetches a URL without an `Authorization` header, so every URL authorizes itself.
URLs are issued only by the resolver, and only for published versions.

- `django` (`LAI_ASSET_DELIVERY=django`):
  `/api/v1/asset-files/<token>/<model|image|audio>.<format>`. The token
  is a signed `{version id, expiry}`; `AssetFileView` re-checks on every fetch that the version is
  still published and its asset active, so retiring stops new fetches at once.
- `s3`: a presigned GET for the private object. Valid until it expires; retiring stops new URLs
  but cannot revoke one already issued.

Both use windows of half the TTL: inside a window the same version gets the same URL (and at
least half the TTL of life), so browser HTTP caches hit across scenes and requests.

Stable identity (ASSET_LIBRARY.md s. 8.1): a URL is a pure function of the version's canonical
identity (`version_id`, which never changes and never names two files) and the window. The django
token is signed with a plain `Signer`, not `signing.dumps`, whose `TimestampSigner` stamped the
signing second, so two requests a second apart got two URLs for the same bytes. Replacing an
asset publishes a new version, so its URL (and the resolver's `cache.key`) changes at once.
Tokens signed the old way (`SALT`) stay valid until their own expiry, so a deploy never breaks a
URL a client already holds.
"""

import time
from dataclasses import dataclass
from datetime import UTC, datetime

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.urls import reverse

from .storage import get_storage

#: Legacy timestamped tokens (`signing.dumps`), still read until they expire.
SALT = "lai.assets.delivery.v1"
#: Stable tokens: the same version and window always sign to the same token.
STABLE_SALT = "lai.assets.delivery.v2"


def _signer() -> signing.Signer:
    return signing.Signer(salt=STABLE_SALT)


@dataclass(frozen=True)
class Delivery:
    url: str
    expires_at: int  # unix seconds

    @property
    def expires_iso(self) -> str:
        return datetime.fromtimestamp(self.expires_at, UTC).isoformat().replace("+00:00", "Z")


def ttl() -> int:
    return int(settings.LAI_ASSET_URL_TTL_SECONDS)


def window(now: float | None = None) -> tuple[int, int]:
    """(window start, expiry) for `now`; the expiry is always at least TTL/2 away."""
    now = int(time.time() if now is None else now)
    half = max(ttl() // 2, 1)
    start = now - now % half
    return start, start + ttl()


def deliver(version, *, now: float | None = None) -> Delivery:
    mode = settings.LAI_ASSET_DELIVERY
    start, expires = window(now)
    if mode == "s3":
        cache_key = f"lai-asset-url:{version.version_id}:{start}"
        url = cache.get(cache_key)
        if url is None:
            remaining = expires - int(time.time() if now is None else now)
            url = get_storage().presigned_url(
                version.storage_key, expires_in=remaining, content_type=version.content_type
            )
            cache.set(cache_key, url, timeout=max(expires - start - ttl() // 2, 1))
        return Delivery(url, expires)
    token = _signer().sign_object({"v": str(version.version_id), "e": expires}, compress=False)
    return Delivery(reverse("asset-file", args=[token, version.file_name]), expires)


class InvalidToken(Exception):
    pass


def read_token(token: str, *, now: float | None = None) -> tuple[str, int]:
    """(version id, expiry) from a django-delivery token, or InvalidToken."""
    try:
        payload = _signer().unsign_object(token)
    except signing.BadSignature:
        try:  # a legacy token issued before stable URLs; its own expiry still applies below
            payload = signing.loads(token, salt=SALT)
        except signing.BadSignature:
            raise InvalidToken from None
    except (ValueError, UnicodeDecodeError):
        raise InvalidToken from None
    if not isinstance(payload, dict) or not isinstance(payload.get("e"), int):
        raise InvalidToken
    if payload["e"] <= int(time.time() if now is None else now):
        raise InvalidToken
    return str(payload.get("v", "")), payload["e"]
