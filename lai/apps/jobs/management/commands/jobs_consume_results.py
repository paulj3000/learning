"""Apply background job results from the results queue (`lai-jobs-consumer.service`).

    python manage.py jobs_consume_results                 # run until SIGTERM
    python manage.py jobs_consume_results --once          # one receive, then exit

The one consumer of the canonical backbone (ADR-055, ADR-064). Each cycle:

1. checks PostgreSQL with `SELECT 1` **before** receiving. Every receive counts toward the results
   queue's maxReceiveCount, so while RDS is stopped, starting, failing over or unreachable the
   consumer backs off and receives nothing: valid results wait untouched in the queue (14-day
   retention) instead of being pushed into the DLQ;
2. runs the outbox relay (`services.relay`) at most once a minute;
3. long-polls `LAI_JOBS_RESULTS_QUEUE_URL`, applies each message with `services.apply_result`
   and deletes it only after the application committed (or was recognised as a duplicate).

A database error in the middle of a batch hands the rest of the batch straight back
(visibility 0) and the loop backs off. A message that cannot be applied (a malformed envelope, an
unknown job, a handler error, an unreadable S3 result) is left on the queue: SQS redelivers it
after the visibility timeout, and after five receives it moves to the results DLQ. Exits 0
straight away when `LAI_JOBS_BACKEND` is not `sqs`. Logs job ids and outcomes only, never
contents.
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
def _artifact_storage_unavailable():
    from apps.assets.artifact_storage import ArtifactStorageUnavailable

    return ArtifactStorageUnavailable


_DELETE = {services.APPLIED, services.RUNNING, services.DUPLICATE}
#: Seconds to back off after a receive or database failure (capped exponential).
_BACKOFF_MAX = 60
#: Seconds between outbox relay passes.
RELAY_INTERVAL = 60


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
        self._relayed_at = None
        previous = signal.signal(signal.SIGTERM, self._stop) if not once else None
        failures = 0
        try:
            while not self._stopping:
                try:
                    counts = self.consume(max_messages, wait_seconds)
                    if self._database_failed:
                        failures += 1  # a database error mid-batch: back off before receiving
                        logger.warning("jobs.consumer database_error_in_batch")
                    else:
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

    @staticmethod
    def _check_database() -> None:
        """Raise DatabaseError when PostgreSQL is unreachable, before anything is received."""
        _refresh_connections()
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")

    def _maybe_relay(self) -> int:
        stamp = time.monotonic()
        if self._relayed_at is not None and stamp - self._relayed_at < RELAY_INTERVAL:
            return 0
        self._relayed_at = stamp
        counts = services.relay()
        return counts["sent"]

    _database_failed = False
    _relayed_at = None

    def consume(self, max_messages: int, wait_seconds: int) -> dict[str, int]:
        self._database_failed = False
        self._check_database()  # never spend a receive while the database is down
        relayed = self._maybe_relay()
        sqs = services._client("sqs")  # noqa: SLF001
        url = settings.LAI_JOBS_RESULTS_QUEUE_URL
        response = sqs.receive_message(
            QueueUrl=url,
            MaxNumberOfMessages=max_messages,
            WaitTimeSeconds=wait_seconds,
            AttributeNames=["ApproximateReceiveCount"],
        )
        counts = {"received": 0, "deleted": 0, "left": 0, "released": 0, "relayed": relayed}
        for message in response.get("Messages", []):
            counts["received"] += 1
            if self._database_failed:
                self._release_now(sqs, url, message)
                counts["released"] += 1
                continue
            _refresh_connections()
            outcome = self._apply(message)
            if outcome in _DELETE:
                sqs.delete_message(QueueUrl=url, ReceiptHandle=message["ReceiptHandle"])
                counts["deleted"] += 1
            elif outcome == "database_error":
                self._database_failed = True
                if not connection.in_atomic_block:
                    connection.close()  # reconnect on the next query
                self._release_now(sqs, url, message)
                counts["released"] += 1
            else:
                counts["left"] += 1
        return counts

    @staticmethod
    def _release_now(sqs, url: str, message: dict) -> None:
        """Hand a message back at once (it already used a receive; do not wait out the timeout)."""
        try:
            sqs.change_message_visibility(
                QueueUrl=url, ReceiptHandle=message["ReceiptHandle"], VisibilityTimeout=0
            )
        except Exception as error:  # noqa: BLE001 - it reappears after its visibility timeout
            logger.warning("jobs.consumer release_error type=%s", type(error).__name__)

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
        except _artifact_storage_unavailable():
            # A storage fault or a 403 while verifying a derived artifact: the whole application
            # rolled back, so the message is left to reappear (SQS retries it). Not a handler bug.
            outcome = "artifact_storage_unavailable"
        except DatabaseError as error:
            logger.warning(
                "jobs.consumer database_error id=%s type=%s", job_id, type(error).__name__
            )
            return "database_error"  # released; the loop backs off and probes before receiving
        except Exception as error:  # noqa: BLE001 - a handler bug: leave it for the DLQ
            logger.error("jobs.consumer handler_error id=%s type=%s", job_id, type(error).__name__)
            outcome = "handler_error"
        if outcome not in _DELETE:
            logger.warning("jobs.consumer left id=%s outcome=%s", job_id, outcome)
        return outcome
