"""Report whether Django is ready for the processing workloads (ADR-071). Changes nothing.

    python manage.py processing_release_check --json    # the report scripts/release consumes
    python manage.py processing_release_check           # the same facts, then the reasons

Exit status: 0 when every feature control is off, or every control that is on is ready; 1 with
safe reasons (on stderr, and in `failures` of the JSON) when a control that is on would emit a
message the system cannot yet handle, or migrations are pending while one is on. `--exit-zero`
always exits 0, for tooling that decides from the JSON itself. Prints no URL, id or secret.
"""

import json
import sys

from django.core.management.base import BaseCommand

from apps.jobs import release_check


class Command(BaseCommand):
    help = "Print the processing release report and fail when an enabled workload is not ready."

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", dest="as_json")
        parser.add_argument("--exit-zero", action="store_true", dest="exit_zero")

    def handle(self, *args, as_json, exit_zero, **options):
        report = release_check.build_report()
        reasons = release_check.failures(report)
        report["failures"] = reasons
        self.stdout.write(json.dumps(report, indent=2, sort_keys=True))
        for reason in reasons:
            self.stderr.write(f"refused: {reason}")
        if reasons and not exit_zero:
            sys.exit(1)
