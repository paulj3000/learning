"""Delivery URLs for published versions (LAI-2200 AM-6; `docs/ASSET_LIBRARY.md` section 8).

`GLTFLoader` fetches a URL without an `Authorization` header, so every URL authorizes itself.
URLs are issued only by the resolver, and only for published versions.

- `django` (`LAI_ASSET_DELIVERY=django`):
  `/api/v1/asset-files/<token>/<model|image|audio>.<format>`. The token
  is a signed `{version id, expiry}`; `AssetFileView` re-checks on every fetch that the version is
  still published and its asset active, so retiring stops new fetches at once.
- `s3`: a presigned GET for the private object. Valid until it expires; retiring stops new URLs
  but cannot revoke one already issued.
- `cloudfront` (AM-11): a CloudFront URL signed with a canned policy (expiry only) by the key
  pair the distribution's trusted key group holds. The distribution reads the private bucket
  through origin access control. Like `s3`, retiring stops new URLs, not issued ones.

Both use windows of half the TTL: inside a window the same version gets the same URL (and at
least half the TTL of life), so browser HTTP caches hit across scenes and requests.
"""

import base64
import binascii
import functools
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import quote

from botocore.signers import CloudFrontSigner
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.urls import reverse

from .storage import get_storage

SALT = "lai.assets.delivery.v1"


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
    if mode == "cloudfront":
        return Delivery(cloudfront_url(version.storage_key, expires), expires)
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
    token = signing.dumps({"v": str(version.version_id), "e": expires}, salt=SALT)
    return Delivery(reverse("asset-file", args=[token, version.file_name]), expires)


@functools.lru_cache(maxsize=4)
def _cloudfront_signer(key_pair_id: str, private_key_b64: str) -> CloudFrontSigner:
    """A signer for the configured key pair; the key is parsed once per process."""
    try:
        pem = base64.b64decode(private_key_b64, validate=True)
        key = serialization.load_pem_private_key(pem, password=None)
    except (binascii.Error, ValueError, TypeError):
        # Never echo the value: it is the private key.
        raise ImproperlyConfigured(
            "LAI_ASSET_CLOUDFRONT_PRIVATE_KEY_B64 is not a base64-encoded PEM private key."
        ) from None
    if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
        raise ImproperlyConfigured(
            "LAI_ASSET_CLOUDFRONT_PRIVATE_KEY_B64 must be an RSA key of at least 2048 bits."
        )

    def rsa_signer(message: bytes) -> bytes:
        # CloudFront canned-policy signatures are RSA-SHA1 (PKCS#1 v1.5).
        return key.sign(message, padding.PKCS1v15(), hashes.SHA1())  # noqa: S303

    return CloudFrontSigner(key_pair_id, rsa_signer)


def cloudfront_url(storage_key: str, expires: int) -> str:
    """`https://<distribution>/<key>?Expires=..&Signature=..&Key-Pair-Id=..` for one object.

    Deterministic for a given key and expiry, so one window yields one URL and browser caches
    hit, as in the other modes.
    """
    signer = _cloudfront_signer(
        settings.LAI_ASSET_CLOUDFRONT_KEY_PAIR_ID, settings.LAI_ASSET_CLOUDFRONT_PRIVATE_KEY_B64
    )
    url = f"https://{settings.LAI_ASSET_CLOUDFRONT_DOMAIN}/{quote(storage_key, safe='/')}"
    return signer.generate_presigned_url(url, date_less_than=datetime.fromtimestamp(expires, UTC))


class InvalidToken(Exception):
    pass


def read_token(token: str, *, now: float | None = None) -> tuple[str, int]:
    """(version id, expiry) from a django-delivery token, or InvalidToken."""
    try:
        payload = signing.loads(token, salt=SALT)
    except signing.BadSignature:
        raise InvalidToken from None
    if not isinstance(payload, dict) or not isinstance(payload.get("e"), int):
        raise InvalidToken
    if payload["e"] <= int(time.time() if now is None else now):
        raise InvalidToken
    return str(payload.get("v", "")), payload["e"]
