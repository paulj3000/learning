"""Strict parsing of the GLB JSON chunk.

Stricter than `json.loads` defaults (and than Django's `_parse_json`): the bytes must be strict
UTF-8, object keys must be unique, `NaN`, `Infinity`, numbers that overflow to infinity and
integers too large for a float (which no glTF value can be, and which `math.isfinite` cannot
take) are refused. The size is already bounded by the container check.

Before `json.loads` runs, `scan_structure` makes one linear, string-aware pass over the raw bytes
and refuses nesting deeper than `max_json_depth` (`invalid_json`) or more than
`max_json_elements` structural elements (`too_complex`), so a pathological chunk never reaches
the parser: parsing millions of tiny values costs far more memory than the chunk itself
(16 MiB of `[{},{},...]` peaked at 870 MB, `docs/processing/GLB_VALIDATION.md` section 3).
Every other refusal is the Asset Library's `invalid_json` code.
"""

from __future__ import annotations

import json
import math
import re
import sys
from collections.abc import Callable
from typing import Any, Final

from .report import Report, Stop

__all__ = ["parse_document", "scan_structure"]

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


# One token: a whole JSON string (escapes included, so a quote, bracket or separator inside it
# never counts), a lone quote (a string with no closing quote), an opening or closing bracket, or
# a separator. Everything else (numbers, literals, whitespace) is skipped inside the regular
# expression engine. The quantifiers are possessive: an ordinary repeat keeps a backtracking
# entry per escape (5 million escapes cost 686 MB), a possessive one keeps none.
_TOKEN: Final = re.compile(rb'"[^"\\]*+(?:\\.[^"\\]*+)*+"|["\[\]{}:,]', re.DOTALL)
_QUOTE: Final = ord('"')
_OPEN: Final = frozenset(b"[{")
_CLOSE: Final = frozenset(b"]}")
UNTERMINATED: Final = "unterminated"
DEPTH_EXCEEDED: Final = "depth"
ELEMENTS_EXCEEDED: Final = "elements"


def scan_structure(
    raw: bytes, max_depth: int, max_elements: int, check: Callable[[], None] = lambda: None
) -> str | None:
    """Which structural bound `raw` breaks, or `None`: `"depth"`, `"elements"`, or
    `"unterminated"` (a string with no closing quote, so the JSON is invalid).

    One linear pass, without parsing: strings are skipped whole (escaped quotes included), so
    brackets and separators inside them never count. Depth counts open containers (the top
    object is depth 1). Elements count every `{`, `[`, `,` and `:`, which bounds the number of
    values and keys `json.loads` would allocate. In valid JSON every string follows one of
    those and every closer matches an opener, so more than `3 * max_elements + 1` tokens in
    all also means too many elements (this bounds the loop for junk such as 16 MiB of `]`).
    The pass stops at the first bound broken. Other malformed JSON is not judged here: whatever
    passes the scan still goes through the strict parser, which refuses it.
    """
    depth = 0
    elements = 0
    max_tokens = 3 * max_elements + 1
    for tokens, match in enumerate(_TOKEN.finditer(raw), 1):
        if not tokens % _CHECK_EVERY:
            check()
        if tokens > max_tokens:
            return ELEMENTS_EXCEEDED
        start = match.start()
        first = raw[start]
        if first == _QUOTE:
            if match.end() - start == 1:
                return UNTERMINATED
            continue
        if first in _CLOSE:
            depth -= 1
            continue
        elements += 1
        if elements > max_elements:
            return ELEMENTS_EXCEEDED
        if first in _OPEN:
            depth += 1
            if depth > max_depth:
                return DEPTH_EXCEEDED
    return None


def parse_document(
    raw: bytes, report: Report, max_depth: int, max_elements: int, check: Callable[[], None]
) -> dict[str, Any]:
    """The JSON object in `raw`, or `Stop` after recording `invalid_json` (or `too_complex`
    for more than `max_elements` structural elements)."""
    exceeded = scan_structure(raw, max_depth, max_elements, check)
    if exceeded == UNTERMINATED:
        report.error("invalid_json", "The model's JSON is not valid.")
        raise Stop
    if exceeded == DEPTH_EXCEEDED:
        report.error("invalid_json", "The model's JSON is nested too deeply.", "json")
        raise Stop
    if exceeded == ELEMENTS_EXCEEDED:
        report.error(
            "too_complex", f"The model's JSON has more than {max_elements:,} elements.", "json"
        )
        raise Stop
    check()
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
    return document
