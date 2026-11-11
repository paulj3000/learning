"""Report child progress that names a catalog record that does not exist (LAI-0309).

    python manage.py check_references [--strict]

Counts only; no child data is printed. Exit status is 0 unless `--strict` is given and there
is at least one orphan, so it can gate a release without ever changing a progress row.
"""

from django.core.management.base import BaseCommand, CommandError

from apps.catalog import references


class Command(BaseCommand):
    help = "Report progress ids that name no catalog record (counts only; changes nothing)."

    def add_arguments(self, parser):
        parser.add_argument("--strict", action="store_true", help="Exit non-zero on any orphan.")

    def handle(self, *args, **options):
        orphans = references.find_orphans()
        if not orphans:
            self.stdout.write("All progress references name catalog records.")
            return
        for orphan in orphans:
            self.stdout.write(
                f"{orphan.model}.{orphan.field}: {orphan.value!r} names no record "
                f"({orphan.rows} row(s))"
            )
        if options["strict"]:
            raise CommandError(f"{len(orphans)} orphaned reference value(s).")
