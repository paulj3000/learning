"""Bounded retry policy with exponential backoff and full jitter.

Only RETRYABLE failures are retried, and only while attempts remain. PERMANENT, CANCELLED and
MANUAL failures are never retried automatically (`core.errors`). The delay before attempt
`n + 1` is drawn uniformly from `[0, ceiling(n)]`, where
`ceiling(n) = min(max_delay_seconds, base_delay_seconds * multiplier ** (n - 1))`
("full jitter"), so many failed jobs do not retry in lockstep. The random source is injected,
so a test (or a replay) with a seeded `random.Random` gets the same delays.

`max_delay_seconds` may not exceed 900 s, the largest delay an SQS message can carry, so a
retry is always expressible as a delayed send or a visibility change.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Final

from .errors import RetryClass

__all__ = [
    "DEFAULT_RETRY_POLICY",
    "MAX_ATTEMPTS_CEILING",
    "SQS_MAX_DELAY_SECONDS",
    "RetryPolicy",
]

SQS_MAX_DELAY_SECONDS: Final = 900
MAX_ATTEMPTS_CEILING: Final = 10
MAX_MULTIPLIER: Final = 10.0


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    """- max_attempts: total attempts including the first (1..10).
    - base_delay_seconds: ceiling of the first retry delay (0..max_delay_seconds).
    - max_delay_seconds: cap on any delay (0..900).
    - multiplier: growth of the ceiling per attempt (1..10).
    """

    max_attempts: int = 3
    base_delay_seconds: int = 30
    max_delay_seconds: int = 900
    multiplier: float = 2.0

    def __post_init__(self) -> None:
        if type(self.max_attempts) is not int or not 1 <= self.max_attempts <= MAX_ATTEMPTS_CEILING:
            raise ValueError(f"max_attempts must be an integer from 1 to {MAX_ATTEMPTS_CEILING}")
        if (
            type(self.max_delay_seconds) is not int
            or not 0 <= self.max_delay_seconds <= SQS_MAX_DELAY_SECONDS
        ):
            raise ValueError(
                f"max_delay_seconds must be an integer from 0 to {SQS_MAX_DELAY_SECONDS}"
            )
        if (
            type(self.base_delay_seconds) is not int
            or not 0 <= self.base_delay_seconds <= self.max_delay_seconds
        ):
            raise ValueError("base_delay_seconds must be an integer from 0 to max_delay_seconds")
        if (
            type(self.multiplier) not in (int, float)
            or not math.isfinite(self.multiplier)
            or not 1.0 <= self.multiplier <= MAX_MULTIPLIER
        ):
            raise ValueError(f"multiplier must be a finite number from 1 to {MAX_MULTIPLIER}")

    @staticmethod
    def _attempt(attempt_number: int) -> int:
        if type(attempt_number) is not int or attempt_number < 1:
            raise ValueError("attempt_number must be a positive integer")
        return attempt_number

    def should_retry(self, retry_class: RetryClass | str, attempt_number: int) -> bool:
        """True only for a RETRYABLE failure of attempt `attempt_number` with attempts left."""
        attempt = self._attempt(attempt_number)
        try:
            rc = RetryClass(retry_class)
        except ValueError:
            return False
        return rc is RetryClass.RETRYABLE and attempt < self.max_attempts

    def backoff_ceiling(self, attempt_number: int) -> int:
        """The largest delay (whole seconds) after attempt `attempt_number` fails."""
        attempt = self._attempt(attempt_number)
        ceiling = float(self.base_delay_seconds)
        for _ in range(attempt - 1):
            if ceiling >= self.max_delay_seconds:
                break
            ceiling *= self.multiplier
        return int(min(float(self.max_delay_seconds), ceiling))

    def delay_seconds(self, attempt_number: int, rng: random.Random) -> int:
        """A full-jitter delay in `[0, backoff_ceiling(attempt_number)]`, deterministic for a
        given `rng` state."""
        ceiling = self.backoff_ceiling(attempt_number)
        return min(ceiling, max(0, round(rng.uniform(0, ceiling))))


DEFAULT_RETRY_POLICY: Final = RetryPolicy()
