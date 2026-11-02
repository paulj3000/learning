"""Report, or with --apply delete, AI audit metadata older than a retention period (LAI-0707).

    python manage.py ai_retention --older-than-days 365            # dry run: counts only
    python manage.py ai_retention --older-than-days 365 --apply    # delete

Without `--older-than-days` it uses `LAI_AI_AUDIT_RETENTION_DAYS`; with neither it refuses,
because no retention period is approved yet (LAI-0308, gate G9). Running `--apply` against a
deployed environment needs explicit approval. See `apps/ai/retention.py` for the rules.
"""

import json

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.ai.retention import RetentionNotConfigured, apply_retention


class Command(BaseCommand):
    help = "Dry-run (default) or apply the AI audit retention period."

    def add_arguments(self, parser):
        parser.add_argument("--older-than-days", type=int, default=None)
        parser.add_argument("--apply", action="store_true", help="Delete (default: report only).")
        parser.add_argument(
            "--include-open", action="store_true", help="Also delete unreviewed safety events."
        )

    def handle(self, *args, older_than_days, apply, include_open, **options):
        days = (
            older_than_days if older_than_days is not None else settings.LAI_AI_AUDIT_RETENTION_DAYS
        )
        try:
            report = apply_retention(older_than_days=days, apply=apply, include_open=include_open)
        except RetentionNotConfigured:
            raise CommandError(
                "No retention period: pass --older-than-days or set LAI_AI_AUDIT_RETENTION_DAYS."
            ) from None
        except ValueError as error:
            raise CommandError(str(error)) from None
        self.stdout.write(json.dumps(report.as_dict()))
