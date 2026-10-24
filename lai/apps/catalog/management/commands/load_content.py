"""`manage.py load_content`: import the versioned content export into the catalog (LAI-0304)."""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.catalog.importer import DEFAULT_EXPORT_DIR, ContentImportError, import_content


class Command(BaseCommand):
    help = (
        "Import content/exported into the catalog. Idempotent: an export that is already the "
        "latest release is skipped. Validates everything before writing; any error leaves the "
        "database unchanged. Never deletes; never touches active or sort_order on existing rows."
    )

    def add_arguments(self, parser):
        parser.add_argument("--path", type=Path, default=DEFAULT_EXPORT_DIR,
                            help="Export directory (default: content/exported).")
        parser.add_argument("--dry-run", action="store_true",
                            help="Validate and report, then roll back.")
        parser.add_argument("--force", action="store_true",
                            help="Re-apply even if this export is already the latest release.")

    def handle(self, *args, path: Path, dry_run: bool, force: bool, **options):
        try:
            report = import_content(path, dry_run=dry_run, force=force)
        except ContentImportError as error:
            for problem in error.problems:
                self.stderr.write(f"invalid: {problem}")
            raise CommandError(f"{len(error.problems)} invalid record(s); nothing was written.") from None

        self.stdout.write(
            f"{report.status}: release {report.content_digest[:12]} (schema {report.schema_version})"
        )
        for name, counts in report.counts.items():
            summary = ", ".join(f"{key} {value}" for key, value in counts.items())
            self.stdout.write(f"  {name}: {summary}")
        for line in report.skipped:
            self.stdout.write(f"  skipped: {line}")
