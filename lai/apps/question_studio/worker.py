"""The Question Studio background worker (LAI-AQS-027, ADR-052): `manage.py studio_worker`.

A long-running process, separate from gunicorn, that claims queued batches and runs them chunk by
chunk through `jobs`. One process runs `concurrency` claim loops (threads, each with its own
database connection); the cluster-wide cap is `LAI_STUDIO_MAX_RUNNING_BATCHES`, enforced at claim
time. On SIGTERM or SIGINT it stops claiming, lets the chunk in flight commit, hands its batches
back (still RUNNING, no owner, immediately claimable) and exits.

Health: the worker records itself as a `StudioWorker` row (Admin, `studio_worker_health`) and
touches `LAI_STUDIO_WORKER_HEALTH_FILE`, which the container health check reads without Django.
"""

from __future__ import annotations

import logging
import os
import signal
import socket
import threading
import uuid
from collections.abc import Callable
from pathlib import Path

from django.conf import settings
from django.db import close_old_connections, connection
from django.db.models import F
from django.utils.timezone import now

from apps.ai.providers.base import ModelClient

from . import jobs
from .models import StudioWorker, WorkerState

logger = logging.getLogger("lai.studio.queue")

# A worker that has not checked in for this long is not counted as alive (Admin and
# `studio_worker_health --max-age` default).
WORKER_ALIVE_SECONDS = 120


def _refresh_connection() -> None:
    """Drop a broken or expired connection between claims (the database restarted, a failover).
    Never inside a transaction: there it would discard the caller's work (and tests' data)."""
    if not connection.in_atomic_block:
        close_old_connections()


def default_worker_id() -> str:
    return f"{socket.gethostname()[:60]}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


class Worker:
    def __init__(
        self,
        *,
        worker_id: str | None = None,
        concurrency: int | None = None,
        poll_seconds: float | None = None,
        max_batches: int | None = None,
        once: bool = False,
        client_factory: Callable[[], ModelClient | None] | None = None,
        health_file: str | None = None,
    ):
        self.worker_id = (worker_id or default_worker_id())[:100]
        self.concurrency = max(1, min(8, concurrency or settings.LAI_STUDIO_WORKER_CONCURRENCY))
        self.poll_seconds = (
            settings.LAI_STUDIO_WORKER_POLL_SECONDS if poll_seconds is None else poll_seconds
        )
        self.max_batches = max_batches
        self.once = once
        self.client_factory = client_factory
        self.health_file = (
            settings.LAI_STUDIO_WORKER_HEALTH_FILE if health_file is None else health_file
        )
        self.stop_event = threading.Event()
        self._lock = threading.Lock()
        self.batches_done = 0
        self.errors = 0

    # --- lifecycle ----------------------------------------------------------------------------

    def request_stop(self, *_args) -> None:
        if not self.stop_event.is_set():
            logger.info("studio.worker event=stopping worker=%s", self.worker_id)
        self.stop_event.set()

    def install_signal_handlers(self) -> None:
        if threading.current_thread() is threading.main_thread():
            signal.signal(signal.SIGTERM, self.request_stop)
            signal.signal(signal.SIGINT, self.request_stop)

    def run(self) -> int:
        """Run until stopped (or, with `once`, until no batch is claimable). Returns the number
        of batches this process worked on."""
        self._register()
        logger.info(
            "studio.worker event=started worker=%s concurrency=%s poll=%s once=%s",
            self.worker_id,
            self.concurrency,
            self.poll_seconds,
            self.once,
        )
        try:
            if self.concurrency == 1:
                self._loop(0)
            else:
                threads = [
                    threading.Thread(target=self._thread_loop, args=(slot,), name=f"studio-{slot}")
                    for slot in range(self.concurrency)
                ]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    while thread.is_alive():
                        thread.join(timeout=0.5)  # keeps the main thread able to take signals
        finally:
            self._deregister()
            if not connection.in_atomic_block:
                connection.close()
            logger.info(
                "studio.worker event=stopped worker=%s batches=%s errors=%s",
                self.worker_id,
                self.batches_done,
                self.errors,
            )
        return self.batches_done

    def _thread_loop(self, slot: int) -> None:
        try:
            self._loop(slot)
        finally:
            close_old_connections()
            connection.close()

    def _loop(self, slot: int) -> None:
        owner = self.worker_id if self.concurrency == 1 else f"{self.worker_id}#{slot}"
        while not self.stop_event.is_set():
            self._touch()
            if self.max_batches is not None and self._count() >= self.max_batches:
                self.stop_event.set()
                break
            try:
                _refresh_connection()
                claim = jobs.claim_next(owner)
                if claim is None:
                    if self.once:
                        break
                    self.stop_event.wait(self.poll_seconds)
                    continue
                self._working_on(claim.batch_id)
                client = self.client_factory() if self.client_factory else None
                jobs.process(
                    claim,
                    client,
                    honor_backoff=True,
                    should_stop=self.stop_event.is_set,
                    on_chunk=self._chunk_done,
                )
                with self._lock:
                    self.batches_done += 1
                StudioWorker.objects.filter(worker_id=self.worker_id).update(
                    batches_processed=F("batches_processed") + 1, current_batch=None
                )
            except Exception as error:  # the database went away, a bug: log the type, back off
                with self._lock:
                    self.errors += 1
                logger.error(
                    "studio.worker event=loop_error worker=%s type=%s",
                    owner,
                    type(error).__name__,
                )
                _refresh_connection()
                self.stop_event.wait(max(self.poll_seconds, 1.0))

    def _count(self) -> int:
        with self._lock:
            return self.batches_done

    # --- health -------------------------------------------------------------------------------

    def _register(self) -> None:
        StudioWorker.objects.update_or_create(
            worker_id=self.worker_id,
            defaults={
                "hostname": socket.gethostname()[:120],
                "pid": os.getpid(),
                "state": WorkerState.RUNNING,
                "concurrency": self.concurrency,
                "started_at": now(),
                "last_seen_at": now(),
                "stopped_at": None,
            },
        )
        self._touch()

    def _deregister(self) -> None:
        try:
            _refresh_connection()
            StudioWorker.objects.filter(worker_id=self.worker_id).update(
                state=WorkerState.STOPPED, stopped_at=now(), current_batch=None
            )
        except Exception as error:
            logger.error("studio.worker event=deregister_error type=%s", type(error).__name__)
        if self.health_file:
            Path(self.health_file).unlink(missing_ok=True)

    def _touch(self) -> None:
        if self.health_file:
            try:
                Path(self.health_file).touch()
            except OSError:
                pass
        try:
            StudioWorker.objects.filter(worker_id=self.worker_id).update(last_seen_at=now())
        except Exception as error:
            logger.error("studio.worker event=checkin_error type=%s", type(error).__name__)

    def _working_on(self, batch_id) -> None:
        StudioWorker.objects.filter(worker_id=self.worker_id).update(
            current_batch_id=batch_id, last_seen_at=now()
        )

    def _chunk_done(self) -> None:
        self._touch()
        StudioWorker.objects.filter(worker_id=self.worker_id).update(
            chunks_processed=F("chunks_processed") + 1
        )


def health_report(max_age_seconds: float) -> tuple[bool, list[str]]:
    """(healthy, lines) for `studio_worker_health`. Unhealthy when work is waiting or stalled and
    no worker has checked in within `max_age_seconds`, or when a batch is stalled."""
    from datetime import timedelta

    from .models import BatchStatus, GenerationBatch

    at = now()
    fresh = at - timedelta(seconds=max_age_seconds)
    workers = list(StudioWorker.objects.filter(state=WorkerState.RUNNING, last_seen_at__gte=fresh))
    running = GenerationBatch.objects.filter(status=BatchStatus.RUNNING)
    queued = GenerationBatch.objects.filter(status=BatchStatus.QUEUED)
    stalled = running.exclude(lease_owner="").filter(lease_expires_at__lt=at).count()
    waiting = running.filter(lease_owner="", lease_expires_at__gt=at).count()
    unowned = running.filter(lease_owner="").exclude(lease_expires_at__gt=at).count()
    live = jobs.live_running_count(at)
    oldest = queued.order_by("created_at").values_list("created_at", flat=True).first()
    lines = [f"workers_alive={len(workers)}"]
    lines += [
        f"worker id={w.worker_id} concurrency={w.concurrency} batches={w.batches_processed} "
        f"chunks={w.chunks_processed} last_seen_s={int((at - w.last_seen_at).total_seconds())}"
        for w in workers
    ]
    lines.append(
        f"queued={queued.count()} running={live} waiting_retry={waiting} "
        f"waiting_worker={unowned} stalled={stalled}"
    )
    lines.append(f"oldest_queued_s={int((at - oldest).total_seconds()) if oldest else 0}")
    pending_work = queued.exists() or stalled or unowned or waiting
    return bool(workers) or not pending_work, lines
