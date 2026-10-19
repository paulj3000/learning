"""A small, bounded cache of the Cognito user pool's signing keys (ADR-024, gate A5).

Why not `jwt.PyJWKClient`: on every unknown `kid` it refetches the whole key set with no
cooldown, so a client could make the server call AWS on every request by sending random key ids.
This wrapper enforces, across successes and failures alike:

* keys are cached for `ttl` seconds (3,600);
* at most one network attempt per `cooldown` seconds (60), whatever triggered it (expiry, an
  unknown `kid`, or a previous failure);
* a hard `timeout` (5 s) and response size limit;
* an unknown `kid` is rejected, never trusted, and never fetched per request;
* if the cache has expired and cannot be refreshed, lookups fail closed.
"""

import json
import logging
import threading
import time
import urllib.request
from collections.abc import Callable
from typing import Any

import jwt

logger = logging.getLogger("lai.auth")

MAX_RESPONSE_BYTES = 64 * 1024
MAX_KEYS = 20


class UnknownSigningKey(Exception):
    """The token names a `kid` that is not in the (possibly just refreshed) key set."""


class JwksUnavailable(Exception):
    """The key set cannot be obtained and no valid cached copy exists. Callers fail closed."""


def fetch_jwks_over_https(url: str, timeout: float) -> bytes:
    if not url.startswith("https://"):
        raise JwksUnavailable("JWKS URL must be https")
    request = urllib.request.Request(url, headers={"Accept": "application/json"})  # noqa: S310
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise JwksUnavailable("JWKS response too large")
    return body


class JwksCache:
    def __init__(
        self,
        url: str,
        *,
        ttl: float = 3600,
        cooldown: float = 60,
        timeout: float = 5,
        fetcher: Callable[[str, float], bytes] = fetch_jwks_over_https,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.url = url
        self.ttl = ttl
        self.cooldown = cooldown
        self.timeout = timeout
        self._fetcher = fetcher
        self._clock = clock
        self._lock = threading.Lock()
        self._keys: dict[str, Any] = {}
        self._loaded_at: float | None = None
        self._last_attempt: float | None = None

    def get_key(self, kid: str) -> Any:
        with self._lock:
            now = self._clock()
            fresh = self._loaded_at is not None and now - self._loaded_at < self.ttl
            if fresh and kid in self._keys:
                return self._keys[kid]
            if self._may_attempt(now):
                self._refresh(now)
            elif not fresh:
                raise JwksUnavailable("key set expired and refresh is cooling down")
            if self._loaded_at is None or self._clock() - self._loaded_at >= self.ttl:
                raise JwksUnavailable("key set unavailable")
            if kid in self._keys:
                return self._keys[kid]
            raise UnknownSigningKey

    def _may_attempt(self, now: float) -> bool:
        return self._last_attempt is None or now - self._last_attempt >= self.cooldown

    def _refresh(self, now: float) -> None:
        self._last_attempt = now  # counted before the call: failures and timeouts cool down too
        try:
            keys = _parse_key_set(self._fetcher(self.url, self.timeout))
        except JwksUnavailable:
            logger.warning("jwks refresh failed: rejected response")
        except Exception as exc:  # network errors, bad JSON; never log the body
            logger.warning("jwks refresh failed: %s", type(exc).__name__)
        else:
            self._keys, self._loaded_at = keys, self._clock()


def _parse_key_set(body: bytes) -> dict[str, Any]:
    data = json.loads(body)
    raw_keys = data.get("keys") if isinstance(data, dict) else None
    if not isinstance(raw_keys, list) or not raw_keys or len(raw_keys) > MAX_KEYS:
        raise JwksUnavailable("unexpected key set shape")
    keys: dict[str, Any] = {}
    for entry in raw_keys:
        if not isinstance(entry, dict):
            continue
        kid = entry.get("kid")
        if not isinstance(kid, str) or entry.get("kty") != "RSA":
            continue
        if entry.get("use", "sig") != "sig" or entry.get("alg", "RS256") != "RS256":
            continue
        try:
            keys[kid] = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(entry))
        except (jwt.InvalidKeyError, ValueError):
            continue
    if not keys:
        raise JwksUnavailable("no usable signing keys")
    return keys
