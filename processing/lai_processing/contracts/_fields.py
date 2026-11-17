"""Strict readers for decoded JSON objects (internal to the contracts package).

Every reader names the field path it failed on, in `details["field"]`, and never echoes the
offending value: an error about a hostile message must not carry that message's content.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Any, Final

from ..core.canonical import parse_timestamp
from ..core.errors import ErrorCode, ProcessingError

MAX_JSON_DEPTH: Final = 16
MAX_OPTION_ENTRIES: Final = 32
MAX_OPTION_STRING: Final = 256
MAX_OPTION_LIST: Final = 32
MAX_INT: Final = 2**53

JSONScalar = str | int | float | bool | None
OptionValue = JSONScalar | tuple[JSONScalar, ...]

_OPTION_KEY = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def invalid(field: str, code: ErrorCode = ErrorCode.INVALID_INPUT) -> ProcessingError:
    return ProcessingError(code, {"field": field})


def obj(value: object, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or not all(isinstance(k, str) for k in value):
        raise invalid(field)
    return value


def exact_keys(
    data: Mapping[str, Any], required: frozenset[str], optional: frozenset[str], field: str
) -> None:
    """Refuse unknown keys and missing required keys. Optional keys may be absent or null."""
    unknown = set(data) - required - optional
    if unknown:
        raise invalid(f"{field}.{sorted(unknown)[0]}" if field else sorted(unknown)[0])
    missing = required - set(data)
    if missing:
        raise invalid(f"{field}.{sorted(missing)[0]}" if field else sorted(missing)[0])


def string(
    value: object, field: str, pattern: re.Pattern[str] | None = None, *, max_length: int = 64
) -> str:
    if not isinstance(value, str) or not value or len(value) > max_length:
        raise invalid(field)
    if pattern is not None and not pattern.fullmatch(value):
        raise invalid(field)
    return value


def text(value: object, field: str, *, max_length: int) -> str:
    """Short human-readable text authored by code (finding messages). No control characters."""
    if not isinstance(value, str) or len(value) > max_length:
        raise invalid(field)
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise invalid(field)
    return value


def integer(value: object, field: str, *, minimum: int = 0, maximum: int = MAX_INT) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise invalid(field)
    return value


def boolean(value: object, field: str) -> bool:
    if type(value) is not bool:
        raise invalid(field)
    return value


def timestamp(value: object, field: str) -> datetime:
    """Parse a strict UTC timestamp into an aware datetime."""
    if not isinstance(value, str):
        raise invalid(field)
    try:
        return parse_timestamp(value)
    except ValueError:
        raise invalid(field) from None


def aware(value: object, field: str) -> datetime:
    """A timezone-aware datetime, normalised to UTC (for contracts built in code)."""
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise invalid(field)
    return value.astimezone(UTC)


def json_value(value: object, field: str, depth: int = 0) -> Any:
    """Plain JSON data (no NaN/infinity), bounded nesting depth, string keys only."""
    if depth > MAX_JSON_DEPTH:
        raise invalid(field)
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        if abs(value) > MAX_INT:
            raise invalid(field)
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise invalid(field)
        return value
    if isinstance(value, (list, tuple)):
        return [json_value(item, field, depth + 1) for item in value]
    if isinstance(value, Mapping):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > 128:
                raise invalid(field)
            out[key] = json_value(item, field, depth + 1)
        return out
    raise invalid(field)


def _option_scalar(value: object, field: str) -> JSONScalar:
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        if abs(value) > MAX_INT:
            raise invalid(field)
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise invalid(field)
        return value
    if isinstance(value, str):
        return text(value, field, max_length=MAX_OPTION_STRING)
    raise invalid(field)


def options(value: object, field: str = "options") -> Mapping[str, OptionValue]:
    """Processing options: a flat object of snake_case keys to scalars or short scalar lists."""
    data = obj(value, field)
    if len(data) > MAX_OPTION_ENTRIES:
        raise invalid(field)
    out: dict[str, OptionValue] = {}
    for key in sorted(data):
        if not _OPTION_KEY.fullmatch(key):
            raise invalid(field)
        item = data[key]
        if isinstance(item, (list, tuple)):
            if len(item) > MAX_OPTION_LIST:
                raise invalid(f"{field}.{key}")
            out[key] = tuple(_option_scalar(v, f"{field}.{key}") for v in item)
        else:
            out[key] = _option_scalar(item, f"{field}.{key}")
    return MappingProxyType(out)


def options_to_json(values: Mapping[str, OptionValue]) -> dict[str, Any]:
    return {k: list(v) if isinstance(v, tuple) else v for k, v in values.items()}


def frozen_json_object(value: object, field: str) -> Mapping[str, Any]:
    data = json_value(obj(value, field), field)
    return MappingProxyType(data)
