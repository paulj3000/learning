"""Run claimable AI Question Studio batches once, in this process (LAI-AQS-007, LAI-AQS-027):
`manage.py studio_run_batch [--id UUID]`.

A one-off alternative to the `studio_worker` service (`LAI_STUDIO_RUN_MODE=manual`). It claims
each queued batch, or a running one whose worker's lease has expired, through the same queue as
the worker, so it never runs a batch a live worker holds and never stores a chunk twice. Retries
happen at once instead of after a backoff. Prints counts only.
"""

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils.timezone import now

from apps.question_studio.generation import run_batch
from apps.question_studio.models import BatchStatus, GenerationBatch


class Command(BaseCommand):
    help = "Run queued (and stalled) question generation batches once."

    def add_arguments(self, parser):
        parser.add_argument("--id", help="Run only this batch.")

    def handle(self, *args, **options):
        claimable = GenerationBatch.objects.filter(
            Q(status=BatchStatus.QUEUED) | Q(status=BatchStatus.RUNNING, lease_expires_at__lt=now())
        )
        if options["id"]:
            claimable = claimable.filter(pk=options["id"])
        for batch_id in list(claimable.order_by("created_at").values_list("pk", flat=True)):
            done = run_batch(batch_id)
            self.stdout.write(
                f"{done.pk} {done.status} produced={done.produced_count}/{done.requested_count}"
            )
