"""List (and optionally remove) stored asset files no version references (LAI-2200).

    python manage.py asset_storage_audit            # report only
    python manage.py asset_storage_audit --delete   # also delete orphans older than a day

Orphans come from uploads whose database write failed after the file was stored, or deletes
whose file removal failed. Files a version row references are never touched. "missing" lists
rows whose file is gone, which needs a person to look at.
"""

from django.core.management.base import BaseCommand

from apps.assets.services import audit_storage


class Command(BaseCommand):
    help = "Report stored asset files with no version row, and rows with no stored file."

    def add_arguments(self, parser):
        parser.add_argument("--delete", action="store_true", help="Also delete old orphans.")

    def handle(self, *args, delete, **options):
        report = audit_storage(delete=delete)
        for name in ("orphans", "deleted", "kept_too_recent", "missing"):
            self.stdout.write(f"{name}: {len(report[name])}")
            for key in report[name]:
                self.stdout.write(f"  {key}")
