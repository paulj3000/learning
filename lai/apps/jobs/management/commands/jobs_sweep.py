"""Fail stale background jobs and prune old completed ones (daily maintenance timer).

    python manage.py jobs_sweep [--dry-run]

Pending or running jobs older than `LAI_JOBS_STALE_MINUTES` become FAILED with error code
`timeout`, and their kind's handler runs (a Studio batch waiting on that chunk is finished).
Completed jobs older than `LAI_JOBS_RETENTION_DAYS` are deleted; failed jobs are kept for review.
Prints counts only.
"""

import json

from django.core.management.base import BaseCommand

from apps.jobs import services


class Command(BaseCommand):
    help = "Fail stale background jobs and delete old completed ones."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Count only; change nothing.")

    def handle(self, *args, dry_run=False, **options):
        report = services.sweep(dry_run=dry_run)
        self.stdout.write(json.dumps({"dryRun": dry_run, **report}, sort_keys=True))
