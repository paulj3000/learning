"""Run queued AI Question Studio batches (LAI-AQS-007): `manage.py studio_run_batch [--id UUID]`.

For deployments where the admin does not run batches on a background thread
(`LAI_STUDIO_RUN_MODE=manual`). Prints counts only.
"""

from django.core.management.base import BaseCommand

from apps.question_studio.generation import run_batch
from apps.question_studio.models import BatchStatus, GenerationBatch


class Command(BaseCommand):
    help = "Run queued question generation batches."

    def add_arguments(self, parser):
        parser.add_argument("--id", help="Run only this batch.")

    def handle(self, *args, **options):
        queued = GenerationBatch.objects.filter(status=BatchStatus.QUEUED)
        if options["id"]:
            queued = queued.filter(pk=options["id"])
        for batch in queued.order_by("created_at"):
            done = run_batch(batch.pk)
            self.stdout.write(
                f"{done.pk} {done.status} produced={done.produced_count}/{done.requested_count}"
            )
