"""Send contract-job work messages from the outbox (`lai-jobs-dispatch.service`).

    python manage.py jobs_dispatch                    # run until SIGTERM
    python manage.py jobs_dispatch --once             # one relay pass, then exit
    python manage.py jobs_dispatch --interval 2 --limit 50

Relays due `JobOutbox` rows to the processing work queue with `processing.relay_outbox`
(`select_for_update(skip_locked=True)`, so two dispatchers never send the same row at once).
`LAI_PROCESSING_DISPATCH=paused` sends nothing. With the `inline` backend a pass also runs the
jobs in-process. Exits 0 straight away when `LAI_PROCESSING_BACKEND` is `disabled`. Prints
counts only.
"""

import json
import logging
import signal
import time

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import DatabaseError, close_old_connections, connection

from apps.jobs import processing
from apps.jobs import processing_transport as transport

logger = logging.getLogger("lai.jobs")


def log_level(error: BaseException) -> int:
    """ERROR for a non-transient transport fault (`QueueError(transient=False)`: configuration
    or permissions, needs an operator), WARNING for everything that a retry may cure."""
    return logging.ERROR if getattr(error, "transient", None) is False else logging.WARNING


_BACKOFF_MAX = 60


class Command(BaseCommand):
    help = "Send contract-job work messages from the outbox to the processing work queue."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="One pass, then exit.")
        parser.add_argument(
            "--interval", type=float, default=2.0, metavar="S", help="Seconds between passes."
        )
        parser.add_argument(
            "--limit", type=int, default=50, metavar="N", help="Rows per pass (1 to 500)."
        )

    def handle(self, *args, once=False, interval=2.0, limit=50, **options):
        mode = settings.LAI_PROCESSING_BACKEND
        if mode == "disabled":
            self.stdout.write("Processing backend is disabled; nothing to dispatch.")
            return
        limit = max(1, min(500, limit))
        interval = max(0.1, min(300.0, interval))
        self._stopping = False
        previous = signal.signal(signal.SIGTERM, self._stop) if not once else None
        failures = 0
        try:
            while not self._stopping:
                counts = None
                try:
                    counts = self.dispatch(mode, limit)
                    failures = 0
                except DatabaseError as error:
                    failures += 1
                    logger.warning(
                        "processing.dispatcher database_error type=%s", type(error).__name__
                    )
                    if not connection.in_atomic_block:
                        connection.close()  # reconnect on the next query
                except Exception as error:  # noqa: BLE001 - keep running; logged by type
                    failures += 1
                    logger.log(
                        log_level(error),
                        "processing.dispatcher error type=%s",
                        type(error).__name__,
                    )
                if once:
                    if counts is not None:
                        self.stdout.write(json.dumps(counts, sort_keys=True))
                    break
                self._sleep(min(2**failures, _BACKOFF_MAX) if failures else interval)
        finally:
            if previous is not None:
                signal.signal(signal.SIGTERM, previous)
            if not connection.in_atomic_block:
                close_old_connections()

    def dispatch(self, mode: str, limit: int) -> dict:
        if not connection.in_atomic_block:
            close_old_connections()
        if mode == "inline":
            return processing.run_inline()
        return {"sent": processing.relay_outbox(transport.work_queue(), limit=limit)}

    def _stop(self, signum, frame):
        logger.info("processing.dispatcher stopping")
        self._stopping = True

    def _sleep(self, seconds: float) -> None:
        end = time.monotonic() + seconds
        while not self._stopping and time.monotonic() < end:
            time.sleep(min(0.5, max(0.0, end - time.monotonic())))
