"""Report AI Question Studio worker health (LAI-AQS-027): `manage.py studio_worker_health`.

Prints live workers and queue counts (no prompts, notes or personal data). Exits 1 when work is
queued, waiting or stalled and no worker has checked in within `--max-age` seconds, else 0.
"""

import sys

from django.core.management.base import BaseCommand

from apps.question_studio.worker import WORKER_ALIVE_SECONDS, health_report


class Command(BaseCommand):
    help = "Report AI Question Studio worker and queue health."

    def add_arguments(self, parser):
        parser.add_argument(
            "--max-age",
            type=float,
            default=float(WORKER_ALIVE_SECONDS),
            help="Seconds since a worker's last check-in.",
        )

    def handle(self, *args, **options):
        healthy, lines = health_report(options["max_age"])
        for line in lines:
            self.stdout.write(line)
        self.stdout.write("healthy" if healthy else "UNHEALTHY")
        if not healthy:
            sys.exit(1)
