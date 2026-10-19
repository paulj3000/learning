import json

import pytest

from apps.users.jwks import (
    MAX_KEYS,
    JwksCache,
    JwksUnavailable,
    UnknownSigningKey,
    fetch_jwks_over_https,
)

from .helpers import KeyPair, jwks_body

URL = "https://cognito-idp.us-test-1.amazonaws.com/us-test-1_TESTPOOL1/.well-known/jwks.json"


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class Source:
    """A fake network: counts calls and serves whatever `body` is set to (or raises)."""

    def __init__(self, *pairs):
        self.body = jwks_body(*pairs)
        self.error = None
        self.calls = []

    def __call__(self, url, timeout):
        self.calls.append((url, timeout))
        if self.error:
            raise self.error
        return self.body


@pytest.fixture
def key_a():
    return KeyPair("kid-a")


@pytest.fixture
def key_b():
    return KeyPair("kid-b")


def make(source, clock):
    return JwksCache(URL, fetcher=source, clock=clock)


def test_keys_are_cached_for_the_ttl(key_a):
    clock, source = Clock(), Source(key_a)
    cache = make(source, clock)
    cache.get_key("kid-a")
    clock.now += 3599
    cache.get_key("kid-a")
    assert len(source.calls) == 1
    clock.now += 2  # past 3,600 s
    cache.get_key("kid-a")
    assert len(source.calls) == 2


def test_network_timeout_is_five_seconds(key_a):
    source = Source(key_a)
    make(source, Clock()).get_key("kid-a")
    assert source.calls == [(URL, 5)]


def test_unknown_kid_is_rejected_without_a_refetch_inside_the_cooldown(key_a):
    clock, source = Clock(), Source(key_a)
    cache = make(source, clock)
    cache.get_key("kid-a")  # first fetch at t=0
    for _ in range(50):  # an attacker spraying random key ids
        clock.now += 1
        with pytest.raises(UnknownSigningKey):
            cache.get_key("random-kid")
    assert len(source.calls) == 1


def test_unknown_kid_refreshes_at_most_once_per_minute(key_a):
    clock, source = Clock(), Source(key_a)
    cache = make(source, clock)
    cache.get_key("kid-a")
    clock.now += 61
    for _ in range(20):
        with pytest.raises(UnknownSigningKey):
            cache.get_key("random-kid")
    assert len(source.calls) == 2
    clock.now += 61
    with pytest.raises(UnknownSigningKey):
        cache.get_key("random-kid")
    assert len(source.calls) == 3


def test_key_rotation_is_picked_up_but_only_after_the_cooldown(key_a, key_b):
    clock, source = Clock(), Source(key_a)
    cache = make(source, clock)
    cache.get_key("kid-a")
    source.body = jwks_body(key_a, key_b)
    clock.now += 10
    with pytest.raises(UnknownSigningKey):
        cache.get_key("kid-b")  # inside the cooldown: not trusted yet
    clock.now += 60
    assert cache.get_key("kid-b") is not None
    assert cache.get_key("kid-a") is not None


def test_failures_also_cool_down(key_a):
    clock, source = Clock(), Source(key_a)
    source.error = TimeoutError("boom")
    cache = make(source, clock)
    for _ in range(10):
        with pytest.raises(JwksUnavailable):
            cache.get_key("kid-a")
        clock.now += 5
    assert len(source.calls) == 1  # 50 seconds of retries produced one network attempt
    clock.now += 20
    source.error = None
    assert cache.get_key("kid-a") is not None
    assert len(source.calls) == 2


def test_expired_cache_that_cannot_refresh_fails_closed(key_a):
    clock, source = Clock(), Source(key_a)
    cache = make(source, clock)
    cache.get_key("kid-a")
    clock.now += 3601
    source.error = ConnectionError("down")
    with pytest.raises(JwksUnavailable):
        cache.get_key("kid-a")  # no stale keys are served


def test_a_failed_refresh_keeps_serving_a_still_valid_cache(key_a):
    clock, source = Clock(), Source(key_a)
    cache = make(source, clock)
    cache.get_key("kid-a")
    clock.now += 100
    source.error = ConnectionError("down")
    with pytest.raises(UnknownSigningKey):
        cache.get_key("other")  # refresh failed; unknown stays unknown
    assert cache.get_key("kid-a") is not None  # known key within the ttl still works


@pytest.mark.parametrize(
    "body",
    [
        b"not json",
        b"[]",
        b'{"keys": []}',
        b'{"keys": "x"}',
        b'{"keys": [{"kid": "a", "kty": "EC"}]}',
        b'{"keys": [{"kty": "RSA", "n": "AQAB", "e": "AQAB"}]}',  # no kid
        b'{"keys": [{"kid": "a", "kty": "RSA", "alg": "HS256", "n": "AQAB", "e": "AQAB"}]}',
        b'{"keys": [{"kid": "a", "kty": "RSA", "use": "enc", "n": "AQAB", "e": "AQAB"}]}',
    ],
)
def test_malformed_or_unusable_key_sets_are_rejected(body):
    source = Source()
    source.body = body
    with pytest.raises(JwksUnavailable):
        make(source, Clock()).get_key("a")


def test_too_many_keys_are_rejected(key_a):
    source = Source()
    source.body = json.dumps({"keys": [key_a.jwk()] * (MAX_KEYS + 1)}).encode()
    with pytest.raises(JwksUnavailable):
        make(source, Clock()).get_key("kid-a")


def test_only_https_urls_are_fetched():
    with pytest.raises(JwksUnavailable):
        fetch_jwks_over_https("http://example.test/jwks.json", 5)
    with pytest.raises(JwksUnavailable):
        fetch_jwks_over_https("file:///etc/passwd", 5)
