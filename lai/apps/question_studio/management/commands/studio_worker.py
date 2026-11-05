"""Run the AI Question Studio background worker (LAI-AQS-027, ADR-052).

    manage.py studio_worker [--once] [--concurrency N] [--poll-seconds S] [--max-batches N]
                            [--worker-id ID]

Runs until SIGTERM or SIGINT, then lets the chunk in flight commit, hands its batches back and
exits 0. `--once` drains what is claimable now and exits. Logs ids, counts and categories only.
Operations: docs/platform/STUDIO_WORKER_RUNBOOK.md.
"""

from django.core.management.base import BaseCommand

from apps.question_studio.worker import Worker


class Command(BaseCommand):
    help = "Run the AI Question Studio background worker."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Exit when nothing is claimable.")
        parser.add_argument("--concurrency", type=int, help="Batches at once in this process.")
        parser.add_argument("--poll-seconds", type=float, help="Idle wait between claims.")
        parser.add_argument("--max-batches", type=int, help="Exit after this many batches.")
        parser.add_argument("--worker-id", help="Name in Admin and logs (default host:pid:rand).")

    def handle(self, *args, **options):
        worker = Worker(
            worker_id=options["worker_id"],
            concurrency=options["concurrency"],
            poll_seconds=options["poll_seconds"],
            max_batches=options["max_batches"],
            once=options["once"],
        )
        worker.install_signal_handlers()
        done = worker.run()
        self.stdout.write(f"worker={worker.worker_id} batches={done} errors={worker.errors}")
