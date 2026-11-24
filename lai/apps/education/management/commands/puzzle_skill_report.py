"""List Area puzzle skills that are not catalog objectives (FPV-D10). Read only, content only.

A puzzle practising such a skill records no skill evidence until staff add the objective or map
the puzzle to an existing one. Exits non-zero with `--strict` when any is found (for CI).
"""

from django.core.management.base import BaseCommand, CommandError

from apps.education.services import puzzle_skill_report


class Command(BaseCommand):
    help = "List Area puzzle skills that are not learning objectives (evidence is skipped)."

    def add_arguments(self, parser):
        parser.add_argument("--strict", action="store_true", help="Fail when any is found.")

    def handle(self, *args, strict, **options):
        rows = puzzle_skill_report()
        for row in rows:
            where = f"{row['region']}/{row['puzzle']} {row['band']}"
            if row["variant"]:
                where += f" variant {row['variant']}"
            self.stdout.write(f"{where}: {row['code']!r} is not a learning objective")
        self.stdout.write(f"{len(rows)} unmapped puzzle skill(s).")
        if strict and rows:
            raise CommandError("Some Area puzzle skills are not learning objectives.")
