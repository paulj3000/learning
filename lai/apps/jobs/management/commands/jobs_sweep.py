"""Fail stale background jobs and prune old finished ones (daily maintenance timer).

    python manage.py jobs_sweep [--dry-run]

Pending or running jobs older than `LAI_JOBS_STALE_MINUTES` become FAILED with error code
`timeout`, and their kind's handler runs (a Studio batch waiting on that chunk is finished).
With the SQS backend, timeouts wait (`deferred`) while the results queue still holds messages,
so completions queued during the overnight stop or a database outage are applied first.
Completed jobs older than `LAI_JOBS_RETENTION_DAYS` are deleted (`asset.validate_model` jobs after
`LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS`, 90). Failed jobs are deleted after the same period
unless they are referenced (a protected foreign key), still count toward a bounded retry (a
contract-kind job whose subject exists), or results are queued; pending and running jobs are
never deleted. Prints counts only.
"""

import json

from django.core.management.base import BaseCommand

from apps.jobs import services


class Command(BaseCommand):
    help = "Fail stale background jobs and delete old finished ones."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Count only; change nothing.")

    def handle(self, *args, dry_run=False, **options):
        report = services.sweep(dry_run=dry_run)
        self.stdout.write(json.dumps({"dryRun": dry_run, **report}, sort_keys=True))
