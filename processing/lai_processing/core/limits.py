"""Resource limits carried by every job and enforced by the execution engine.

A request names the limits it wants. The worker clamps them to its platform ceilings
(`effective_limits`), so a forged or careless request can never raise a worker above what its
runtime allows. Limits are positive integers; complexity limits are processor-specific named
counters (for example `max_vertices` for a model validator) with the same rule.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field, fields
from types import MappingProxyType
from typing import Any, Final

from .errors import ErrorCode, ProcessingError

__all__ = [
    "DEFAULT_LIMITS",
    "PLATFORM_CEILINGS",
    "ResourceLimits",
    "effective_limits",
]

MIB: Final = 1024 * 1024
_COMPLEXITY_KEY = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
MAX_COMPLEXITY_ENTRIES: Final = 32
# An absolute bound on any single limit value, so arithmetic on limits stays sane.
MAX_LIMIT_VALUE: Final = 2**53


def _frozen(mapping: Mapping[str, int]) -> Mapping[str, int]:
    return MappingProxyType(dict(sorted(mapping.items())))


@dataclass(frozen=True, slots=True)
class ResourceLimits:
    """Per-job limits. Every value is a positive integer.

    - max_input_bytes: largest input object the job may read.
    - max_output_bytes: total bytes of all artifacts the job may write.
    - max_execution_seconds: wall-clock budget; the engine enforces it cooperatively.
    - max_temp_bytes: bytes the job may write to its private temporary workspace.
    - max_artifact_count: number of artifacts in one result.
    - max_metadata_bytes: canonical JSON size of the result's metadata object.
    - max_message_bytes: encoded size of any request, result, or completion message.
    - complexity: processor-specific counters, e.g. {"max_vertices": 200000}.
    """

    max_input_bytes: int
    max_output_bytes: int
    max_execution_seconds: int
    max_temp_bytes: int
    max_artifact_count: int
    max_metadata_bytes: int
    max_message_bytes: int
    complexity: Mapping[str, int] = field(default_factory=lambda: MappingProxyType({}))

    def __post_init__(self) -> None:
        for f in fields(self):
            if f.name == "complexity":
                continue
            value = getattr(self, f.name)
            if type(value) is not int or not 0 < value <= MAX_LIMIT_VALUE:
                raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": f"limits.{f.name}"})
        if not isinstance(self.complexity, Mapping):
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "limits.complexity"})
        if len(self.complexity) > MAX_COMPLEXITY_ENTRIES:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "limits.complexity"})
        for key, value in self.complexity.items():
            if not isinstance(key, str) or not _COMPLEXITY_KEY.fullmatch(key):
                raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "limits.complexity"})
            if type(value) is not int or not 0 < value <= MAX_LIMIT_VALUE:
                raise ProcessingError(
                    ErrorCode.INVALID_INPUT, {"field": f"limits.complexity.{key}"}
                )
        object.__setattr__(self, "complexity", _frozen(self.complexity))

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            f.name: getattr(self, f.name) for f in fields(self) if f.name != "complexity"
        }
        data["complexity"] = dict(self.complexity)
        return data

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ResourceLimits:
        if not isinstance(data, Mapping):
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "limits"})
        expected = {f.name for f in fields(cls)}
        unknown = set(data) - expected
        missing = expected - set(data)
        if unknown or missing:
            name = sorted(unknown or missing)[0]
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": f"limits.{name}"})
        complexity = data["complexity"]
        if not isinstance(complexity, Mapping):
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "limits.complexity"})
        return cls(**{**data, "complexity": dict(complexity)})

    def complexity_limit(self, name: str) -> int | None:
        return self.complexity.get(name)


# Defaults for a request that does not need more. Input: 50 MiB = 52,428,800 bytes, the ceiling of
# Django's LAI_ASSET_MAX_GLB_BYTES (a GLB request carries min(this, that setting)).
DEFAULT_LIMITS: Final = ResourceLimits(
    max_input_bytes=50 * MIB,
    max_output_bytes=200 * MIB,
    max_execution_seconds=300,
    max_temp_bytes=400 * MIB,
    max_artifact_count=16,
    max_metadata_bytes=64 * 1024,
    max_message_bytes=64 * 1024,
)

# The most any worker allows, whatever a request asks for. Execution stays below Lambda's
# 900 s maximum with a margin for cleanup and the completion publish; messages stay below the
# 256 KiB SQS classic limit; temporary storage is the Lambda ephemeral maximum (10 GiB).
PLATFORM_CEILINGS: Final = ResourceLimits(
    max_input_bytes=512 * MIB,
    max_output_bytes=1024 * MIB,
    max_execution_seconds=840,
    max_temp_bytes=10 * 1024 * MIB,
    max_artifact_count=64,
    max_metadata_bytes=256 * 1024,
    max_message_bytes=240 * 1024,
)


def effective_limits(
    requested: ResourceLimits, ceilings: ResourceLimits = PLATFORM_CEILINGS
) -> ResourceLimits:
    """Clamp each requested limit to the worker's ceiling. Complexity limits are clamped only
    where the ceiling names them; otherwise the requested value stands."""
    values = {
        f.name: min(getattr(requested, f.name), getattr(ceilings, f.name))
        for f in fields(ResourceLimits)
        if f.name != "complexity"
    }
    complexity = {
        key: min(value, ceilings.complexity.get(key, value))
        for key, value in requested.complexity.items()
    }
    return ResourceLimits(**values, complexity=complexity)
