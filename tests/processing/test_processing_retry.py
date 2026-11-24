"""Bounded retry policy: classification, attempt bound, backoff ceiling and jitter."""

from __future__ import annotations

import random
from typing import Any

import pytest

from lai_processing.core.errors import RetryClass
from lai_processing.core.retry import (
    DEFAULT_RETRY_POLICY,
    SQS_MAX_DELAY_SECONDS,
    RetryPolicy,
)


def _rng(seed: int) -> random.Random:
    """Seeded jitter for repeatable tests. Retry jitter is not a security control."""
    return random.Random(seed)  # noqa: S311


def test_defaults() -> None:
    assert DEFAULT_RETRY_POLICY == RetryPolicy(3, 30, 900, 2.0)
    assert SQS_MAX_DELAY_SECONDS == 900


@pytest.mark.parametrize(
    "kwargs",
    [
        {"max_attempts": 0},
        {"max_attempts": 11},
        {"max_attempts": True},
        {"max_attempts": 2.0},
        {"max_delay_seconds": 901},
        {"max_delay_seconds": -1},
        {"max_delay_seconds": 10, "base_delay_seconds": 11},
        {"base_delay_seconds": -1},
        {"base_delay_seconds": 1.5},
        {"multiplier": 0.5},
        {"multiplier": 10.5},
        {"multiplier": float("inf")},
        {"multiplier": float("nan")},
        {"multiplier": True},
        {"multiplier": "2"},
    ],
)
def test_invalid_policies(kwargs: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        RetryPolicy(**kwargs)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"max_attempts": 1},
        {"max_attempts": 10},
        {"max_delay_seconds": 0, "base_delay_seconds": 0},
        {"multiplier": 1},
        {"multiplier": 10.0},
    ],
)
def test_boundary_policies(kwargs: dict[str, Any]) -> None:
    RetryPolicy(**kwargs)


@pytest.mark.parametrize("retry_class", list(RetryClass))
@pytest.mark.parametrize("attempt", [1, 2, 3, 4])
def test_should_retry_only_retryable_with_attempts_left(
    retry_class: RetryClass, attempt: int
) -> None:
    expected = retry_class is RetryClass.RETRYABLE and attempt < 3
    assert DEFAULT_RETRY_POLICY.should_retry(retry_class, attempt) is expected
    assert DEFAULT_RETRY_POLICY.should_retry(retry_class.value, attempt) is expected


def test_should_retry_unknown_class_is_false() -> None:
    assert DEFAULT_RETRY_POLICY.should_retry("sometimes", 1) is False  # type: ignore[arg-type]


def test_single_attempt_policy_never_retries() -> None:
    assert not RetryPolicy(max_attempts=1).should_retry(RetryClass.RETRYABLE, 1)


@pytest.mark.parametrize("bad", [0, -1, True, 1.0, "1"])
def test_attempt_number_must_be_positive_int(bad: object) -> None:
    policy = DEFAULT_RETRY_POLICY
    with pytest.raises(ValueError):
        policy.should_retry(RetryClass.RETRYABLE, bad)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        policy.backoff_ceiling(bad)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        policy.delay_seconds(bad, _rng(1))  # type: ignore[arg-type]


def test_backoff_ceiling_grows_and_caps() -> None:
    policy = DEFAULT_RETRY_POLICY
    assert [policy.backoff_ceiling(n) for n in range(1, 8)] == [30, 60, 120, 240, 480, 900, 900]


def test_backoff_ceiling_huge_attempts_do_not_overflow() -> None:
    policy = RetryPolicy(max_attempts=10, base_delay_seconds=1, multiplier=10.0)
    assert policy.backoff_ceiling(10_000) == 900


def test_zero_base_means_no_delay() -> None:
    policy = RetryPolicy(base_delay_seconds=0)
    assert all(policy.delay_seconds(n, _rng(n)) == 0 for n in range(1, 20))


@pytest.mark.parametrize("seed", range(20))
@pytest.mark.parametrize("attempt", [1, 2, 3, 6, 50])
def test_delay_within_bounds(seed: int, attempt: int) -> None:
    policy = DEFAULT_RETRY_POLICY
    delay = policy.delay_seconds(attempt, _rng(seed))
    assert isinstance(delay, int)
    assert 0 <= delay <= policy.backoff_ceiling(attempt) <= SQS_MAX_DELAY_SECONDS


def test_jitter_is_deterministic_for_a_seed() -> None:
    a = [DEFAULT_RETRY_POLICY.delay_seconds(n, _rng(42)) for n in range(1, 8)]
    b = [DEFAULT_RETRY_POLICY.delay_seconds(n, _rng(42)) for n in range(1, 8)]
    assert a == b
    rng1, rng2 = _rng(7), _rng(7)
    assert [DEFAULT_RETRY_POLICY.delay_seconds(3, rng1) for _ in range(10)] == [
        DEFAULT_RETRY_POLICY.delay_seconds(3, rng2) for _ in range(10)
    ]


def test_jitter_spreads_delays() -> None:
    rng = _rng(123)
    delays = {DEFAULT_RETRY_POLICY.delay_seconds(4, rng) for _ in range(200)}
    assert len(delays) > 50
    assert min(delays) < 60 and max(delays) > 180


def test_policy_is_frozen() -> None:
    with pytest.raises(AttributeError):
        DEFAULT_RETRY_POLICY.max_attempts = 5  # type: ignore[misc]
