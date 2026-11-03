"""`manage.py check_content`: the gate before exporting or merging content (LAI-0814).

    python manage.py check_content [--strict]

Re-validates every published body (schema, references, copy rules, safety screening), checks
each row still matches its published version, and that references point at exported records.
Reads and reports; never writes. Exit status 1 on any error; `--strict` also fails on warnings.
"""

from django.core.management.base import BaseCommand, CommandError

from apps.catalog import export


class Command(BaseCommand):
    help = "Check published content: validation, references, row/version consistency."

    def add_arguments(self, parser):
        parser.add_argument("--strict", action="store_true", help="Fail on warnings too.")

    def handle(self, *args, strict: bool, **options):
        report = export.check_content()
        for line in report.errors:
            self.stdout.write(f"error: {line}")
        for line in report.warnings:
            self.stdout.write(f"warning: {line}")
        for name in export.pending_drafts():
            self.stdout.write(f"note: open draft for {name}")
        self.stdout.write(
            f"Checked {report.checked} record(s): {len(report.errors)} error(s), "
            f"{len(report.warnings)} warning(s)."
        )
        if report.errors or (strict and report.warnings):
            raise CommandError("content check failed")
