"""Apply background job results from the results queue (`lai-jobs-consumer.service`).

    python manage.py jobs_consume_results                 # run until SIGTERM
    python manage.py jobs_consume_results --once          # one receive, then exit

Long-polls `LAI_JOBS_RESULTS_QUEUE_URL`, applies each message with `services.apply_result` and
deletes it once applied (or recognised as a duplicate). A message that cannot be applied (a
malformed envelope, an unknown job, a handler error, an unreadable S3 result) is left on the
queue: SQS redelivers it, and after three receives it moves to the results DLQ. Exits 0 straight
away when `LAI_JOBS_BACKEND` is not `sqs`. Logs job ids and outcomes only, never contents.
"""

import json
import logging
import signal
import time

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import DatabaseError, close_old_connections, connection

from apps.jobs import services

logger = logging.getLogger("lai.jobs")

#: Outcomes after which the message is done with and deleted.
_DELETE = {services.APPLIED, services.RUNNING, services.DUPLICATE}
#: Seconds to back off after a receive or database failure (capped exponential).
_BACKOFF_MAX = 60


def _refresh_connections() -> None:
    """Drop a dead or expired database connection so the next query reconnects. (Never inside a
    transaction, which only happens when a test calls the command.)"""
    if not connection.in_atomic_block:
        close_old_connections()


class Command(BaseCommand):
    help = "Apply background job results from the SQS results queue."

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

    def handle(self, *args, once=False, max_messages=10, wait_seconds=20, **options):
        if settings.LAI_JOBS_BACKEND != "sqs":
            logger.info("jobs.consumer idle: backend=%s", settings.LAI_JOBS_BACKEND)
            self.stdout.write(f"Jobs backend is {settings.LAI_JOBS_BACKEND}; nothing to consume.")
            return
        self._stopping = False
        previous = signal.signal(signal.SIGTERM, self._stop) if not once else None
        failures = 0
        try:
            while not self._stopping:
                try:
                    counts = self.consume(max_messages, wait_seconds)
                    failures = 0
                except DatabaseError as error:
                    failures += 1
                    logger.warning("jobs.consumer database_error type=%s", type(error).__name__)
                    if not connection.in_atomic_block:
                        connection.close()  # reconnect on the next query
                    counts = None
                except Exception as error:  # noqa: BLE001 - e.g. SQS unreachable; keep running
                    failures += 1
                    logger.warning("jobs.consumer receive_error type=%s", type(error).__name__)
                    counts = None
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
        logger.info("jobs.consumer stopping")
        self._stopping = True

    def _sleep(self, seconds: float) -> None:
        end = time.monotonic() + seconds
        while not self._stopping and time.monotonic() < end:
            time.sleep(min(1.0, end - time.monotonic()))

    def consume(self, max_messages: int, wait_seconds: int) -> dict[str, int]:
        sqs = services._client("sqs")  # noqa: SLF001
        url = settings.LAI_JOBS_RESULTS_QUEUE_URL
        response = sqs.receive_message(
            QueueUrl=url,
            MaxNumberOfMessages=max_messages,
            WaitTimeSeconds=wait_seconds,
            AttributeNames=["ApproximateReceiveCount"],
        )
        counts = {"received": 0, "deleted": 0, "left": 0}
        for message in response.get("Messages", []):
            counts["received"] += 1
            _refresh_connections()
            outcome = self._apply(message)
            if outcome in _DELETE:
                sqs.delete_message(QueueUrl=url, ReceiptHandle=message["ReceiptHandle"])
                counts["deleted"] += 1
            else:
                counts["left"] += 1
        return counts

    def _apply(self, message: dict) -> str:
        job_id = "-"
        try:
            body = json.loads(message.get("Body", ""))
            if isinstance(body, dict) and isinstance(body.get("job_id"), str):
                job_id = body["job_id"][:40]
        except ValueError:
            body = None
        if body is None:
            logger.warning("jobs.consumer poison message=%s", message.get("MessageId", "-")[:80])
            return services.INVALID
        try:
            outcome = services.apply_result(body)
        except services.ResultUnavailable:
            outcome = "result_unavailable"
        except DatabaseError:
            raise  # the loop reconnects; the message is redelivered
        except Exception as error:  # noqa: BLE001 - a handler bug: leave it for the DLQ
            logger.error("jobs.consumer handler_error id=%s type=%s", job_id, type(error).__name__)
            outcome = "handler_error"
        if outcome not in _DELETE:
            logger.warning("jobs.consumer left id=%s outcome=%s", job_id, outcome)
        return outcome
