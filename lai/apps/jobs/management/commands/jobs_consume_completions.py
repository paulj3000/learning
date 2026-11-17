"""Apply contract-job completion events (`lai-jobs-completions.service`).

    python manage.py jobs_consume_completions                  # run until SIGTERM
    python manage.py jobs_consume_completions --once           # one receive, then exit
    python manage.py jobs_consume_completions --max-messages 10 --wait-seconds 20 --visibility 300

Receives from the processing completion queue and hands each message to
`processing.apply_completion`, which commits before it returns (WAVE2_INTERFACES section 5):

- an applied, retried, duplicate, stale or rejected event is acknowledged, only after commit;
- an undecodable or contract-invalid message is left alone (not acknowledged, not released), so
  it reappears after the visibility timeout and reaches the completion DLQ after 5 receives;
- a transient failure (database, result storage) releases the message with a bounded backoff;
  a database error also closes the connection so the next message reconnects.

Exits 0 straight away when `LAI_PROCESSING_BACKEND` is `disabled` or `inline` (inline runs
consume their completions in-process). Logs ids and outcomes only, never contents.
"""

import inspect
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
#: Bounds of the release delay for a transiently failed message (seconds).
RELEASE_BASE = 5
RELEASE_MAX = 300


def release_delay(receive_count: int) -> int:
    return min(RELEASE_MAX, RELEASE_BASE * 2 ** max(0, receive_count - 1))


def _refresh_connections() -> None:
    if not connection.in_atomic_block:
        close_old_connections()


class Command(BaseCommand):
    help = "Apply contract-job completion events from the processing completion queue."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="One receive, then exit.")
        parser.add_argument(
            "--max-messages",
            type=int,
            default=10,
            choices=range(1, 11),
            metavar="N",
            help="Messages per receive (1 to 10).",
        )
        parser.add_argument(
            "--wait-seconds",
            type=int,
            default=20,
            choices=range(0, 21),
            metavar="S",
            help="Long-poll wait (0 to 20).",
        )
        parser.add_argument(
            "--visibility",
            type=int,
            default=300,
            metavar="S",
            help="Visibility timeout per receive (30 to 3600).",
        )

    def handle(
        self, *args, once=False, max_messages=10, wait_seconds=20, visibility=300, **options
    ):
        mode = settings.LAI_PROCESSING_BACKEND
        if mode in ("disabled", "inline"):
            self.stdout.write(f"Processing backend is {mode}; nothing to consume.")
            return
        visibility = max(30, min(3600, visibility))
        self._stopping = False
        previous = signal.signal(signal.SIGTERM, self._stop) if not once else None
        failures = 0
        try:
            while not self._stopping:
                counts = None
                try:
                    counts = self.consume(max_messages, wait_seconds, visibility)
                    if self._database_failed:
                        failures += 1  # back off before the next receive (see _check_database)
                        logger.warning("processing.consumer database_error_in_batch")
                    else:
                        failures = 0
                except DatabaseError as error:
                    failures += 1
                    logger.warning(
                        "processing.consumer database_error type=%s", type(error).__name__
                    )
                    if not connection.in_atomic_block:
                        connection.close()
                except Exception as error:  # noqa: BLE001 - e.g. the queue is unreachable
                    failures += 1
                    logger.log(
                        log_level(error),
                        "processing.consumer receive_error type=%s",
                        type(error).__name__,
                    )
                if once:
                    if counts is not None:
                        self.stdout.write(json.dumps(counts, sort_keys=True))
                    break
                if failures:
                    self._sleep(min(2**failures, _BACKOFF_MAX))
        finally:
            if previous is not None:
                signal.signal(signal.SIGTERM, previous)
            _refresh_connections()

    def _stop(self, signum, frame):
        logger.info("processing.consumer stopping")
        self._stopping = True

    def _sleep(self, seconds: float) -> None:
        end = time.monotonic() + seconds
        while not self._stopping and time.monotonic() < end:
            time.sleep(min(0.5, max(0.0, end - time.monotonic())))

    @staticmethod
    def _receive(queue, max_messages: int, wait_seconds: int, visibility: int):
        """The port's `receive`; the long-poll wait is passed only to adapters that take it."""
        kwargs = {"max_messages": max_messages, "visibility_seconds": visibility}
        try:
            accepts_wait = "wait_seconds" in inspect.signature(queue.receive).parameters
        except (TypeError, ValueError):
            accepts_wait = False
        if accepts_wait:
            kwargs["wait_seconds"] = wait_seconds
        return queue.receive(**kwargs), accepts_wait

    @staticmethod
    def _check_database() -> None:
        """Raise DatabaseError when PostgreSQL is unreachable, before anything is received.

        Every receive counts toward the completion queue's maxReceiveCount (5). Receiving while
        the database is down (RDS stopped, failing over, or still starting after the overnight
        stop) would push valid completions into the DLQ, so the consumer backs off instead and
        the messages wait, untouched, in the queue."""
        _refresh_connections()
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")

    def consume(self, max_messages: int, wait_seconds: int, visibility: int) -> dict[str, int]:
        self._check_database()
        queue = transport.completion_queue()
        storage = transport.object_storage()
        deliveries, waited = self._receive(queue, max_messages, wait_seconds, visibility)
        counts = {"received": 0, "acked": 0, "released": 0, "left": 0}
        self._database_failed = False
        for delivery in deliveries:
            counts["received"] += 1
            if self._database_failed:
                # The database failed earlier in this batch: hand the rest back at once rather
                # than spending their receives on doomed attempts.
                self._release_now(queue, delivery)
                counts["released"] += 1
                continue
            _refresh_connections()
            counts[self._handle(queue, storage, delivery)] += 1
        if not deliveries and not waited and wait_seconds:
            self._sleep(min(wait_seconds, 5))  # an adapter without long polling: do not spin
        return counts

    @staticmethod
    def _release_now(queue, delivery) -> None:
        try:
            queue.release(delivery, delay_seconds=0)
        except Exception as error:  # noqa: BLE001 - it reappears after its visibility timeout
            logger.log(
                log_level(error), "processing.consumer release_error type=%s", type(error).__name__
            )

    _database_failed = False

    def _handle(self, queue, storage, delivery) -> str:
        try:
            outcome = processing.apply_completion(delivery.body, storage=storage)
        except processing.CompletionDeferred as error:
            if processing.is_database_outage(error):  # never for an IntegrityError
                self._database_failed = True
                if not connection.in_atomic_block:
                    connection.close()
            return self._release(queue, delivery, error.code)
        except Exception as error:  # noqa: BLE001 - a bug: release with backoff, then DLQ
            logger.error("processing.consumer apply_error type=%s", type(error).__name__)
            return self._release(queue, delivery, "apply_error")
        if not outcome.ack:
            # Invalid: neither acknowledged nor released; it reaches the DLQ after 5 receives.
            return "left"
        try:
            queue.ack(delivery)  # the decision is committed: apply_completion has returned
        except Exception as error:  # noqa: BLE001 - redelivery is recognised as a duplicate
            logger.log(
                log_level(error), "processing.consumer ack_failed type=%s", type(error).__name__
            )
            return "left"
        return "acked"

    @staticmethod
    def _release(queue, delivery, code: str) -> str:
        delay = release_delay(delivery.receive_count)
        logger.warning(
            "processing.consumer released message=%s code=%s delay=%s",
            str(delivery.message_id)[:80],
            code,
            delay,
        )
        try:
            queue.release(delivery, delay_seconds=delay)
        except Exception as error:  # noqa: BLE001 - visibility timeout redelivers it anyway
            logger.log(
                log_level(error), "processing.consumer release_failed type=%s", type(error).__name__
            )
        return "released"
