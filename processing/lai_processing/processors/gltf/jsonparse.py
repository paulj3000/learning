"""Strict parsing of the GLB JSON chunk.

Stricter than `json.loads` defaults (and than Django's `_parse_json`): the bytes must be strict
UTF-8, object keys must be unique, `NaN`, `Infinity`, numbers that overflow to infinity and
integers too large for a float (which no glTF value can be, and which `math.isfinite` cannot
take) are refused, and nesting is bounded by `max_json_depth`. Every refusal is the Asset Library's
`invalid_json` code. The size is already bounded by the container check.
"""

from __future__ import annotations

import json
import math
import sys
from collections.abc import Callable
from typing import Any, Final

from .report import Report, Stop

__all__ = ["parse_document"]

_CHECK_EVERY: Final = 4096
_MAX_FLOAT_INT: Final = int(sys.float_info.max)
# Digits (with a sign) of the largest float integer; a longer literal is refused unparsed.
_MAX_INT_TEXT: Final = len(str(_MAX_FLOAT_INT)) + 1


class _Refused(ValueError):
    """Internal: a construct the strict parser refuses."""


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out = dict(pairs)
    if len(out) != len(pairs):
        raise _Refused("duplicate key")
    return out


def _constant(_name: str) -> Any:
    raise _Refused("non-finite constant")


def _float(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):
        raise _Refused("non-finite number")
    return value


def _int(text: str) -> int:
    if len(text) > _MAX_INT_TEXT:
        raise _Refused("integer too large")
    value = int(text)
    if abs(value) > _MAX_FLOAT_INT:
        raise _Refused("integer too large")
    return value


def _depth_exceeds(document: object, max_depth: int, check: Callable[[], None]) -> bool:
    """Whether any container is nested deeper than `max_depth` (iterative, no recursion)."""
    stack: list[tuple[object, int]] = [(document, 1)]
    seen = 0
    while stack:
        value, depth = stack.pop()
        seen += 1
        if seen % _CHECK_EVERY == 0:
            check()
        if isinstance(value, dict):
            children: Any = value.values()
        elif isinstance(value, list):
            children = value
        else:
            continue
        if depth > max_depth:
            return True
        stack.extend((child, depth + 1) for child in children)
    return False


def parse_document(
    raw: bytes, report: Report, max_depth: int, check: Callable[[], None]
) -> dict[str, Any]:
    """The JSON object in `raw`, or `Stop` after recording `invalid_json`."""
    try:
        text = raw.decode("utf-8")
        document = json.loads(
            text,
            object_pairs_hook=_pairs,
            parse_constant=_constant,
            parse_float=_float,
            parse_int=_int,
        )
    except (UnicodeDecodeError, ValueError, RecursionError):
        report.error("invalid_json", "The model's JSON is not valid.")
        raise Stop from None
    check()
    if not isinstance(document, dict):
        report.error("invalid_json", "The model's JSON must be an object.")
        raise Stop
    if _depth_exceeds(document, max_depth, check):
        report.error("invalid_json", "The model's JSON is nested too deeply.", "json")
        raise Stop
    return document
