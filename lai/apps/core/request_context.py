"""Per-request correlation id, held in a context variable so log records can carry it without
passing the request around. It holds no user content."""

import re
import uuid
from contextvars import ContextVar, Token

REQUEST_ID_HEADER = "X-Request-ID"

_request_id: ContextVar[str] = ContextVar("request_id", default="")

# Inbound ids are accepted only in this conservative shape (use `fullmatch`; `$` would also
# accept a trailing newline), so a client cannot inject log-forging characters or huge values.
VALID_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{8,64}")


def new_request_id() -> str:
    return uuid.uuid4().hex


def choose_request_id(supplied: str | None) -> str:
    """Keep a well-formed caller-supplied id, otherwise generate one."""
    if supplied and VALID_REQUEST_ID.fullmatch(supplied):
        return supplied
    return new_request_id()


def get_request_id() -> str:
    return _request_id.get()


def set_request_id(value: str) -> Token[str]:
    return _request_id.set(value)


def reset_request_id(token: Token[str]) -> None:
    _request_id.reset(token)
