"""`LocalWorker`: the asynchronous local worker (never inside a Django HTTP request).

It polls the local work queue (`<root>/queues/work`), runs each request through the same
worker core as Lambda (`process_work_message`), and sends completions to
`<root>/queues/completions`, which Django's `local` backend consumes. Storage is the
filesystem adapter: `<root>/<key>` for quarantine and artifacts, `<assets root>/<key>` for
assets; only the artifacts store is writable.

- It keeps no durable job state: Django owns jobs, attempts and the completion ledger. The
  queue files are the only state, and they are the transport's, as SQS's are.
- A delivery is acknowledged only after its completion was sent. Any other outcome releases it
  with a `RetryPolicy` full-jitter delay keyed on the receive count (a transport-level retry
  of the same attempt, not a new attempt); after `max_receive_count` receives the queue
  dead-letters it. An interrupted delivery is released with no delay.
- Each job's budget is `job_timeout_seconds - cleanup margin`; the lease (visibility) is
  longer than the job timeout, so a healthy job is never redelivered while it runs.
- Concurrency is a thread pool of `concurrency` workers.
- Stopping: the first `request_stop()` (SIGTERM or SIGINT in the CLI) stops receiving and lets
  in-flight jobs finish; the second cancels their `CancellationToken`s, so they end quickly as
  interrupted and are released for redelivery (never reported to Django as cancelled).
"""

from __future__ import annotations

import random
import threading
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from types import FrameType
from typing import Final

from lai_processing.contracts.identifiers import StoreName
from lai_processing.core.execution import ExecutionEngine
from lai_processing.core.processor import CancellationToken
from lai_processing.core.registry import ProcessorRegistry, default_registry
from lai_processing.core.retry import RetryPolicy
from lai_processing.ports.clock import Clock, SystemClock
from lai_processing.ports.queue import Delivery, MessageQueue
from lai_processing.ports.storage import ObjectStorage
from lai_processing.ports.telemetry import NullTelemetry, Telemetry

from .config import LocalRuntimeConfig
from .filesystem import FilesystemObjectStorage
from .local_queue import LocalDirectoryQueue
from .worker import OutcomeReason, RecordOutcome, process_work_message

__all__ = ["DEFAULT_JOB_TIMEOUT_SECONDS", "LOCAL_RETRY_POLICY", "LocalWorker", "WorkerSummary"]

DEFAULT_JOB_TIMEOUT_SECONDS: Final = 600  # the Lambda worker timeout (section 7)
LOCAL_RETRY_POLICY: Final = RetryPolicy(max_attempts=5, base_delay_seconds=2, max_delay_seconds=60)
MAX_RECEIVE_BATCH: Final = 10


@dataclass
class WorkerSummary:
    received: int = 0
    succeeded: int = 0
    failed: int = 0


class LocalWorker:
    def __init__(
        self,
        config: LocalRuntimeConfig,
        *,
        registry: ProcessorRegistry | None = None,
        clock: Clock | None = None,
        telemetry: Telemetry | None = None,
        concurrency: int = 1,
        poll_interval: float = 1.0,
        job_timeout_seconds: int = DEFAULT_JOB_TIMEOUT_SECONDS,
        retry_policy: RetryPolicy = LOCAL_RETRY_POLICY,
        rng: random.Random | None = None,
        work_queue: MessageQueue | None = None,
        completions_queue: MessageQueue | None = None,
        storage: ObjectStorage | None = None,
    ) -> None:
        if type(concurrency) is not int or not 1 <= concurrency <= 64:
            raise ValueError("concurrency must be from 1 to 64")
        if poll_interval <= 0:
            raise ValueError("poll_interval must be positive")
        if type(job_timeout_seconds) is not int or job_timeout_seconds <= (
            config.cleanup_margin_seconds
        ):
            raise ValueError("job_timeout_seconds must exceed the cleanup margin")
        self.config = config
        self.telemetry = telemetry if telemetry is not None else NullTelemetry()
        # Explicit None checks: an empty in-memory queue is falsy (it defines __len__).
        self.work: MessageQueue = (
            work_queue if work_queue is not None else LocalDirectoryQueue(config.work_queue_dir)
        )
        self.completions: MessageQueue = (
            completions_queue
            if completions_queue is not None
            else LocalDirectoryQueue(config.completion_queue_dir)
        )
        self.storage: ObjectStorage = (
            storage
            if storage is not None
            else FilesystemObjectStorage(
                config.storage_roots(), writable=frozenset({StoreName.ARTIFACTS})
            )
        )
        config.workspace_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.engine = ExecutionEngine(
            registry=registry if registry is not None else default_registry(),
            storage=self.storage,
            telemetry=self.telemetry,
            clock=clock or SystemClock(),
            namespace=config.namespace,
            workspace_root=config.workspace_dir,
        )
        self.concurrency = concurrency
        self.poll_interval = poll_interval
        self.job_timeout_seconds = job_timeout_seconds
        self.visibility_seconds = job_timeout_seconds + 2 * config.cleanup_margin_seconds
        self.retry_policy = retry_policy
        self._rng = rng or random.Random()  # noqa: S311 - jitter, not security
        self._stop = threading.Event()
        self._stop_requests = 0
        self._tokens: set[CancellationToken] = set()
        self._lock = threading.Lock()

    # Stopping ------------------------------------------------------------------------------

    @property
    def stopping(self) -> bool:
        return self._stop.is_set()

    def request_stop(self) -> None:
        """First call: finish in-flight work and stop. Second call: cancel in-flight work."""
        with self._lock:
            self._stop_requests += 1
            forced = self._stop_requests > 1
            tokens = list(self._tokens) if forced else []
        self._stop.set()
        for token in tokens:
            token.cancel()
        self._emit("worker.stopping", phase="cancel" if forced else "drain")

    def handle_signal(self, signum: int, frame: FrameType | None) -> None:
        self.request_stop()

    # Processing ----------------------------------------------------------------------------

    def process_delivery(self, delivery: Delivery) -> RecordOutcome:
        token = CancellationToken()
        with self._lock:
            if self._stop_requests > 1:
                token.cancel()
            self._tokens.add(token)
        try:
            outcome = process_work_message(
                delivery.body,
                engine=self.engine,
                completions_queue=self.completions,
                deadline_seconds=self.job_timeout_seconds,
                margin=self.config.cleanup_margin_seconds,
                cancellation=token,
                telemetry=self.telemetry,
                receive_count=delivery.receive_count,
            )
        except Exception as exc:  # noqa: BLE001 - a bug fails only this delivery
            self._emit("work.failed", phase="worker", exception_type=type(exc).__name__)
            outcome = RecordOutcome(False, OutcomeReason.COMPLETION_FAILED)
        finally:
            with self._lock:
                self._tokens.discard(token)
        try:
            if outcome.success:
                self.work.ack(delivery)
            else:
                delay = 0
                if outcome.reason is not OutcomeReason.INTERRUPTED:
                    delay = self.retry_policy.delay_seconds(
                        max(1, delivery.receive_count), self._rng
                    )
                self.work.release(delivery, delay_seconds=delay)
        except Exception as exc:  # noqa: BLE001 - the lease expiry redelivers it anyway
            self._emit("work.failed", phase="transport", exception_type=type(exc).__name__)
        return outcome

    def _receive(self, count: int) -> list[Delivery]:
        try:
            return self.work.receive(
                max_messages=min(count, MAX_RECEIVE_BATCH),
                visibility_seconds=self.visibility_seconds,
            )
        except Exception as exc:  # noqa: BLE001 - keep polling
            self._emit("work.failed", phase="receive", exception_type=type(exc).__name__)
            return []

    def run_once(self) -> WorkerSummary:
        """Receive up to `concurrency` messages once, process them, and return."""
        summary = WorkerSummary()
        deliveries = self._receive(self.concurrency)
        summary.received = len(deliveries)
        if not deliveries:
            return summary
        with ThreadPoolExecutor(max_workers=self.concurrency) as pool:
            for outcome in pool.map(self.process_delivery, deliveries):
                self._count(summary, outcome)
        return summary

    def run(self, *, max_messages: int | None = None) -> WorkerSummary:
        """Poll until stopped (or until `max_messages` deliveries were processed)."""
        if max_messages is not None and (type(max_messages) is not int or max_messages < 1):
            raise ValueError("max_messages must be a positive integer")
        summary = WorkerSummary()
        self._emit("worker.started", phase="loop", namespace=self.config.namespace)
        inflight: set[Future[RecordOutcome]] = set()
        with ThreadPoolExecutor(max_workers=self.concurrency) as pool:
            while not self._stop.is_set():
                quota = self.concurrency - len(inflight)
                if max_messages is not None:
                    quota = min(quota, max_messages - summary.received)
                    if quota <= 0 and not inflight:
                        break
                received = self._receive(quota) if quota > 0 else []
                summary.received += len(received)
                for delivery in received:
                    inflight.add(pool.submit(self.process_delivery, delivery))
                if inflight:
                    done, inflight = wait(
                        inflight, timeout=self.poll_interval, return_when=FIRST_COMPLETED
                    )
                    for future in done:
                        self._count(summary, future.result())
                elif not received:
                    self._stop.wait(self.poll_interval)
            for future in inflight:
                self._count(summary, future.result())
        self._emit("worker.stopped", phase="loop")
        return summary

    @staticmethod
    def _count(summary: WorkerSummary, outcome: RecordOutcome) -> None:
        if outcome.success:
            summary.succeeded += 1
        else:
            summary.failed += 1

    def _emit(self, name: str, **fields: str | int | None) -> None:
        try:
            self.telemetry.event(name, **fields)
        except Exception:  # noqa: BLE001, S110
            pass
