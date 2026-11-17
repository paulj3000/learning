"""Expire overdue contract jobs and report stuck outbox rows (maintenance timer).

    python manage.py jobs_reconcile [--dry-run] [--stuck-minutes 15]

Open contract jobs (created, uploading, queued or processing) whose `expires_at` has passed
become FAILED with error code `job_expired` (through `check_transition`); their pending outbox
rows are cancelled, so nothing stale is sent after a long stop. Outbox rows that have waited
unsent for more than `--stuck-minutes` are counted and logged (a paused or broken dispatcher).
Legacy kinds are untouched (`jobs_sweep` owns them). Prints counts only.
"""

import json

from django.core.management.base import BaseCommand

from apps.jobs import processing


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
        report = processing.reconcile(dry_run=dry_run, stuck_minutes=stuck_minutes)
        self.stdout.write(json.dumps({"dryRun": dry_run, **report}, sort_keys=True))
