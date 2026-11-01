"""Reconcile the child photo bucket with the photo table (LAI-0904, ADR-042).

    python manage.py child_photo_storage_audit            # report only, changes nothing
    python manage.py child_photo_storage_audit --delete   # retry deferred deletes, remove orphans

`--delete` retries every replaced or removed photo whose object delete failed (`DELETING` rows)
and deletes orphan objects (no row) older than `--min-age-minutes` (default 60), which come from
an upload whose database write failed and whose rollback delete failed too. A `CURRENT` row's
object is never touched. "missing objects" counts current rows whose object is gone; that needs
a person to look at.

Output is counts only: never a key, child id or name (CLAUDE.md section 13). Run it on a schedule
once the platform has one (docs/platform/CHILD_PHOTO_STORAGE.md section 5).
"""

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError

from apps.users.photo_storage import PhotoStorageError
from apps.users.photos import audit_photo_storage


class Command(BaseCommand):
    help = "Report (and with --delete, repair) child photo objects without a matching row."

    def add_arguments(self, parser):
        parser.add_argument("--delete", action="store_true", help="Retry deletes, drop orphans.")
        parser.add_argument("--min-age-minutes", type=int, default=60)

    def handle(self, *args, delete, min_age_minutes, **options):
        if min_age_minutes < 10:
            raise CommandError("--min-age-minutes must be at least 10.")
        try:
            report = audit_photo_storage(
                delete=delete, min_orphan_age=timedelta(minutes=min_age_minutes)
            )
        except PhotoStorageError as error:
            raise CommandError(f"Photo storage is not reachable: {error}") from None
        lines = {
            "objects": report.objects,
            "current rows": report.current_rows,
            "deleting rows": report.deleting_rows,
            "missing objects": report.missing_objects,
            "orphan objects": len(report.orphan_objects),
            "orphans too recent to judge": report.young_orphans,
        }
        if delete:
            lines["deleting rows purged"] = report.purged_rows
            lines["orphan objects deleted"] = report.deleted_orphans
        for name, value in lines.items():
            self.stdout.write(f"{name}: {value}")
