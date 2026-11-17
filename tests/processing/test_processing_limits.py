"""Resource limits: validation, serialisation and clamping to platform ceilings."""

from __future__ import annotations

from dataclasses import fields, replace
from typing import Any

import pytest

from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.core.limits import (
    DEFAULT_LIMITS,
    MAX_COMPLEXITY_ENTRIES,
    MAX_LIMIT_VALUE,
    PLATFORM_CEILINGS,
    ResourceLimits,
    effective_limits,
)

SCALAR_FIELDS = [f.name for f in fields(ResourceLimits) if f.name != "complexity"]


def _limits(**overrides: Any) -> ResourceLimits:
    base: dict[str, Any] = {name: 10 for name in SCALAR_FIELDS}
    base.update(overrides)
    return ResourceLimits(**base)


def test_defaults_sit_within_ceilings() -> None:
    assert effective_limits(DEFAULT_LIMITS) == DEFAULT_LIMITS
    for name in SCALAR_FIELDS:
        assert getattr(DEFAULT_LIMITS, name) <= getattr(PLATFORM_CEILINGS, name)


def test_ceilings_respect_lambda_and_sqs() -> None:
    assert PLATFORM_CEILINGS.max_execution_seconds < 900
    assert PLATFORM_CEILINGS.max_message_bytes < 256 * 1024
    assert PLATFORM_CEILINGS.max_temp_bytes <= 10 * 1024 * 1024 * 1024


@pytest.mark.parametrize("name", SCALAR_FIELDS)
@pytest.mark.parametrize("bad", [0, -1, True, False, 1.5, "10", None, MAX_LIMIT_VALUE + 1])
def test_scalar_limits_must_be_positive_ints(name: str, bad: object) -> None:
    with pytest.raises(ProcessingError) as err:
        _limits(**{name: bad})
    assert err.value.code is ErrorCode.INVALID_INPUT
    assert err.value.details["field"] == f"limits.{name}"


def test_limit_value_bound_is_inclusive() -> None:
    assert _limits(max_input_bytes=MAX_LIMIT_VALUE).max_input_bytes == MAX_LIMIT_VALUE


@pytest.mark.parametrize(
    "complexity",
    [
        {"Max": 1},
        {"1max": 1},
        {"max-vertices": 1},
        {"m" * 65: 1},
        {"max_vertices": 0},
        {"max_vertices": True},
        {"max_vertices": 2.0},
        {"max_vertices": MAX_LIMIT_VALUE + 1},
        {f"k{i}": 1 for i in range(MAX_COMPLEXITY_ENTRIES + 1)},
        [("max_vertices", 1)],
    ],
)
def test_complexity_validation(complexity: Any) -> None:
    with pytest.raises(ProcessingError) as err:
        _limits(complexity=complexity)
    assert err.value.code is ErrorCode.INVALID_INPUT


def test_complexity_is_frozen_and_sorted() -> None:
    limits = _limits(complexity={"max_b": 2, "max_a": 1})
    assert list(limits.complexity) == ["max_a", "max_b"]
    with pytest.raises(TypeError):
        limits.complexity["max_c"] = 3  # type: ignore[index]
    assert limits.complexity_limit("max_a") == 1
    assert limits.complexity_limit("missing") is None


def test_round_trip() -> None:
    limits = _limits(complexity={"max_vertices": 5})
    data = limits.to_dict()
    assert data["complexity"] == {"max_vertices": 5}
    assert ResourceLimits.from_dict(data) == limits


@pytest.mark.parametrize("name", [*SCALAR_FIELDS, "complexity"])
def test_from_dict_refuses_missing_fields(name: str) -> None:
    data = DEFAULT_LIMITS.to_dict()
    del data[name]
    with pytest.raises(ProcessingError) as err:
        ResourceLimits.from_dict(data)
    assert err.value.details["field"] == f"limits.{name}"


def test_from_dict_refuses_unknown_fields_and_non_mappings() -> None:
    with pytest.raises(ProcessingError):
        ResourceLimits.from_dict({**DEFAULT_LIMITS.to_dict(), "max_gpu": 1})
    with pytest.raises(ProcessingError):
        ResourceLimits.from_dict([])  # type: ignore[arg-type]
    with pytest.raises(ProcessingError):
        ResourceLimits.from_dict({**DEFAULT_LIMITS.to_dict(), "complexity": []})


def test_effective_limits_clamps_every_field() -> None:
    huge = ResourceLimits(**{name: MAX_LIMIT_VALUE for name in SCALAR_FIELDS})
    assert effective_limits(huge) == replace(PLATFORM_CEILINGS)


def test_effective_limits_keeps_lower_requests() -> None:
    small = _limits()
    assert effective_limits(small) == small


def test_effective_limits_complexity_clamped_only_where_ceiling_names_it() -> None:
    requested = _limits(complexity={"max_vertices": 1_000_000, "max_clips": 50})
    ceilings = replace(PLATFORM_CEILINGS, complexity={"max_vertices": 200_000})
    result = effective_limits(requested, ceilings)
    assert dict(result.complexity) == {"max_clips": 50, "max_vertices": 200_000}
