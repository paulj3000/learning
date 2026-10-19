import logging
import time

from .privacy import SAFE_METHODS
from .request_context import (
    REQUEST_ID_HEADER,
    choose_request_id,
    reset_request_id,
    set_request_id,
)

access_logger = logging.getLogger("lai.request")  # one line per request; see privacy.py


class RequestContextMiddleware:
    """Correlation id plus one access-log line per request. Must be the first middleware.

    The id comes from `X-Request-ID` when it is well formed, otherwise it is generated, and is
    always echoed on the response. The log line holds only the method, the matched route
    pattern (never the raw path or query string, which can carry identifiers; unmatched
    requests log "-"), the status, and the duration. No headers, cookies, tokens, or bodies.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = choose_request_id(request.META.get("HTTP_X_REQUEST_ID"))
        request.request_id = request_id
        token = set_request_id(request_id)
        started = time.monotonic()
        status = 500
        try:
            response = self.get_response(request)
            status = response.status_code
            response[REQUEST_ID_HEADER] = request_id
            return response
        finally:
            match = getattr(request, "resolver_match", None)
            route = (match.route if match else "") or "-"
            access_logger.info(
                "%s %s %s %dms",
                request.method if request.method in SAFE_METHODS else "OTHER",
                route,
                status,
                (time.monotonic() - started) * 1000,
            )
            reset_request_id(token)
