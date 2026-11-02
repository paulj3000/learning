"""The few JavaScript string semantics the ported validators depend on.

The TypeScript validators are the reference (golden vectors, `tests/golden/ai-safety.json`), so
a Python port must count, trim, round and match exactly as JavaScript does:

* `String.prototype.length` counts UTF-16 code units: an emoji is 2, not 1.
* `String.prototype.trim` strips the ECMAScript whitespace set, which includes U+FEFF.
* `Math.round` rounds halves up (toward +infinity), unlike Python's banker's `round`.
* A non-unicode JavaScript `RegExp` with `/i` folds ASCII only and `\\b` is an ASCII word
  boundary, which is Python's `re.ASCII | re.IGNORECASE`.
"""

import math
import re

JS_REGEX_FLAGS = re.ASCII | re.IGNORECASE

# ECMAScript WhiteSpace and LineTerminator code points (ES2023 sections 12.2 and 12.3).
_JS_WHITESPACE = "".join(
    chr(code)
    for code in (
        *range(0x09, 0x0E),
        0x20,
        0xA0,
        0x1680,
        *range(0x2000, 0x200B),
        0x2028,
        0x2029,
        0x202F,
        0x205F,
        0x3000,
        0xFEFF,
    )
)


def js_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def js_trim(text: str) -> str:
    return text.strip(_JS_WHITESPACE)


def js_round(value: float) -> int:
    return math.floor(value + 0.5)


def js_regex(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, JS_REGEX_FLAGS)
