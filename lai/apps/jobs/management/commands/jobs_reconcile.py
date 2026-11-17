"""Expire overdue contract jobs and report stuck outbox rows (`lai-jobs-reconcile.timer`).

    python manage.py jobs_reconcile [--dry-run] [--stuck-minutes 15]

Open contract jobs (created, uploading, queued or processing) whose `expires_at` has passed
become FAILED with error code `job_expired` (through `check_transition`); their pending outbox
rows are cancelled, so nothing stale is sent after a long stop. Outbox rows that have waited
unsent for more than `--stuck-minutes` are counted and logged (a paused or broken dispatcher).
Legacy kinds are untouched (`jobs_sweep` owns them). Prints counts only.

Reconciliation never creates an attempt, an outbox row or a queue message: it only expires and
counts, so a timer that runs it repeatedly cannot loop retries (docs/processing/OPERATIONS.md).

On PostgreSQL a run that changes rows holds a session advisory lock (`RECONCILE_LOCK_KEY`), so two
runs never overlap: the second prints `{"dryRun": false, "skipped": "already_running"}` and exits
0. `--dry-run` only reads and takes no lock. An unexpected error logs
`processing.reconcile_failed type=<exception class>` (never a message or row content) and exits
non-zero.
"""

import json
import logging
from contextlib import contextmanager

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection

from apps.jobs import processing

logger = logging.getLogger("lai.jobs")

#: Fixed key of the session advisory lock that serialises reconciliation ("LAIREC").
RECONCILE_LOCK_KEY = 0x4C4149524543


@contextmanager
def reconcile_lock():
    """Yield True when this session holds the reconcile lock, False when another one does.

    A session lock (not a transaction lock): `processing.reconcile` commits one transaction per
    expired job, and the lock must cover all of them. Other databases (SQLite in a few local
    runs) have no advisory locks and are never shared by two processes there, so they yield True.
    """
    if connection.vendor != "postgresql":
        yield True
        return
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", [RECONCILE_LOCK_KEY])
        acquired = bool(cursor.fetchone()[0])
    try:
        yield acquired
    finally:
        if acquired:
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_unlock(%s)", [RECONCILE_LOCK_KEY])
            except DatabaseError:
                # The session is gone (the error being raised is usually why); PostgreSQL drops
                # a session's advisory locks with it, so there is nothing left to release.
                connection.close()


class Command(BaseCommand):
    help = "Expire overdue contract processing jobs and report stuck outbox rows."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Count only; change nothing.")
        parser.add_argument(
            "--stuck-minutes",
            type=int,
            default=15,
            metavar="M",
            help="Report outbox rows unsent for longer than this (1 to 1440).",
        )

    def handle(self, *args, dry_run=False, stuck_minutes=15, **options):
        stuck_minutes = max(1, min(1440, stuck_minutes))
        try:
            if dry_run:
                report = processing.reconcile(dry_run=True, stuck_minutes=stuck_minutes)
            else:
                with reconcile_lock() as acquired:
                    if not acquired:
                        logger.info("processing.reconcile skipped reason=already_running")
                        self.stdout.write(
                            json.dumps(
                                {"dryRun": False, "skipped": "already_running"}, sort_keys=True
                            )
                        )
                        return
                    report = processing.reconcile(dry_run=False, stuck_minutes=stuck_minutes)
        except Exception as error:  # noqa: BLE001 - logged by class only, then a non-zero exit
            logger.error("processing.reconcile_failed type=%s", type(error).__name__)
            raise CommandError("reconcile failed", returncode=1) from error
        self.stdout.write(json.dumps({"dryRun": dry_run, **report}, sort_keys=True))
