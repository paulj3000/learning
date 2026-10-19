"""Privacy-safe logging and error reporting (LAI-0208, ADR-025).

Principle: a log line says *what kind* of failure happened and *where*, never *what data* was
involved. An exception message can contain anything a developer interpolated, and database errors
quote the offending values, so a traceback's message is treated as private.

What this module controls (the repository's own logging only; deployed servers, proxies, and
monitoring are separate gates):

* `PrivacyFormatter` writes exceptions as type plus file/line/function, never the message, never
  source lines, never local variables, across the whole `__cause__`/`__context__` chain.
* `PrivacyFilter` removes the request object from every record, rewrites Django's request-failure
  line to use the matched route pattern instead of the raw path, and withholds the free-text
  details of `django.security.*` messages (they echo attacker-supplied header values).
* `reporting.PrivacyExceptionReporterFilter` hides every local variable on Django's debug
  pages and error reports, on top of Django's own cleansing of settings, POST data, and
  credential headers.

Raw tracebacks exist only as an explicit local opt-in (`LAI_LOG_RAW_EXCEPTIONS=1` with local
settings). Production and test settings force them off.
"""

import logging
import traceback

from django.conf import settings

from .request_context import get_request_id

MAX_CHAIN = 6
SAFE_METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})


def raw_exceptions_enabled() -> bool:
    return bool(getattr(settings, "LOG_RAW_EXCEPTIONS", False))


def _qualified_name(exc: BaseException) -> str:
    kind = type(exc)
    return f"{kind.__module__}.{kind.__qualname__}"


def describe_exception_chain(exc: BaseException | None) -> str:
    """Exception types and code locations only (no messages, no source, no variables)."""
    chain: list[BaseException] = []
    seen: set[int] = set()
    current = exc
    while current is not None and id(current) not in seen and len(chain) < MAX_CHAIN:
        seen.add(id(current))
        chain.append(current)
        current = current.__cause__ or (
            None if current.__suppress_context__ else current.__context__
        )
    lines = ["Exception details withheld for privacy. Chain, root cause first:"]
    for item in reversed(chain):
        lines.append(f"  {_qualified_name(item)}")
        for frame in traceback.extract_tb(item.__traceback__):
            location = "/".join(frame.filename.replace("\\", "/").split("/")[-3:])
            lines.append(f"    {location}:{frame.lineno} in {frame.name}")
    return "\n".join(lines)


class PrivacyFormatter(logging.Formatter):
    def formatException(self, ei):  # noqa: N802 - logging API name
        if raw_exceptions_enabled():
            return super().formatException(ei)
        return describe_exception_chain(ei[1])


class PrivacyFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        request = getattr(record, "request", None)
        if request is not None:
            if record.name == "django.request":
                match = getattr(request, "resolver_match", None)
                route = (match.route if match else "") or "-"
                reason = record.args[0] if isinstance(record.args, tuple) and record.args else ""
                record.msg, record.args = "%s: %s", (str(reason)[:40], route)
            record.request = None  # no handler or formatter ever sees the request object
        if record.name.startswith("django.security"):
            record.msg, record.args = "%s (details withheld)", (record.name,)
        record.exc_text = None  # always re-render through the formatter
        return True


class RequestIdLogFilter(logging.Filter):
    """Adds `request_id` to every log record (`-` outside a request)."""

    def filter(self, record):
        record.request_id = get_request_id() or "-"
        return True
