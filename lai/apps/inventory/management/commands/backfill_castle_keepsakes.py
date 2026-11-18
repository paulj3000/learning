"""Grant the castle keepsakes to children who completed the content before the rules existed.

    manage.py backfill_castle_keepsakes            # dry run: counts only, writes nothing
    manage.py backfill_castle_keepsakes --apply    # grant, one transaction per child

Evidence and guarantees: `apps/inventory/backfill.py`. Output is counts only (no names or ids).
The owner decides when this runs on real data.
"""

from django.core.management.base import BaseCommand

from apps.inventory.backfill import backfill_castle_keepsakes


class Command(BaseCommand):
    help = "Backfill castle keepsakes from server-authoritative historical completions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true", help="Write the grants. Without it nothing changes."
        )
        parser.add_argument("--dry-run", action="store_true", help="Explicit dry run (default).")

    def handle(self, *args, **options):
        apply = bool(options["apply"]) and not options["dry_run"]
        report = backfill_castle_keepsakes(apply=apply)
        self.stdout.write(
            f"{'APPLY' if apply else 'DRY RUN'}: children scanned {report.children_scanned}"
        )
        for rule_id, counts in sorted(report.rules.items()):
            self.stdout.write(
                f"{rule_id}: eligible {counts.eligible}, granted {counts.granted}, "
                f"already had {counts.already_had}"
            )
