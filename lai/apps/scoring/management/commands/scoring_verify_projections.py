"""Check (and optionally rebuild) every projection against the ledger (GE-103)."""

from django.core.management.base import BaseCommand

from apps.scoring import ledger
from apps.users.services import iter_child_profiles_for_system


class Command(BaseCommand):
    help = "Verify progression projections equal ledger totals; --rebuild repairs mismatches."

    def add_arguments(self, parser):
        parser.add_argument("--rebuild", action="store_true")

    def handle(self, *args, rebuild, **options):
        mismatched = 0
        for child in iter_child_profiles_for_system():
            if not ledger.projection_matches_ledger(child):
                mismatched += 1
                if rebuild:
                    ledger.rebuild_projection(child)
        action = "rebuilt" if rebuild else "found"
        self.stdout.write(f"{mismatched} mismatched projection(s) {action}.")
