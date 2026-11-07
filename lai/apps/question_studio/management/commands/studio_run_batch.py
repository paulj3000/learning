"""Run queued AI Question Studio batches (LAI-AQS-007): `manage.py studio_run_batch [--id UUID]`.

For deployments where the admin does not run batches on a background thread
(`LAI_STUDIO_RUN_MODE=manual`), and for the owner-run live test (docs/AI_BEDROCK_ACCEPTANCE.md).

* `--dry-run` is free: it makes no model call and no AWS call. It prints, per queued batch, what
  would run and the worst-case number of model calls.
* With Bedrock, running a batch makes paid calls, so `--confirm-paid-calls` is mandatory.

Prints counts only. Inspect results afterwards with `manage.py studio_batch_report`.
"""

import json

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.ai.services.usage import model_calls_enabled
from apps.question_studio.generation import (
    approved_model_ids,
    run_batch,
    studio_model_id,
    tokens_today,
)
from apps.question_studio.models import BatchStatus, GenerationBatch, StudioLimits


def worst_case_calls(batch: GenerationBatch) -> int:
    """An upper bound: chunks x Studio attempts x the SDK's own attempts per call."""
    return (
        batch.chunks_total * max(1, settings.LAI_STUDIO_MAX_ATTEMPTS) * settings.LAI_AI_MAX_ATTEMPTS
    )


class Command(BaseCommand):
    help = "Run queued question generation batches."

    def add_arguments(self, parser):
        parser.add_argument("--id", help="Run only this batch.")
        parser.add_argument(
            "--dry-run", action="store_true", help="Show what would run. No model call."
        )
        parser.add_argument(
            "--confirm-paid-calls",
            action="store_true",
            help="Required with Bedrock: acknowledges that running a batch is paid.",
        )

    def handle(self, *args, **options):
        queued = GenerationBatch.objects.filter(status=BatchStatus.QUEUED)
        if options["id"]:
            queued = queued.filter(pk=options["id"])
        batches = list(queued.order_by("created_at"))

        if options["dry_run"]:
            limits = StudioLimits.current()
            report = {
                "mode": "dry-run",
                "awsCallsMade": 0,
                "provider": settings.LAI_AI_PROVIDER,
                "model": studio_model_id(),
                "modelApproved": studio_model_id() in approved_model_ids(),
                "killSwitchOpen": model_calls_enabled(),
                "generationEnabled": limits.generation_enabled,
                "tokensToday": tokens_today(),
                "tokenLimitToday": limits.max_tokens_per_day,
                "batches": [
                    {
                        "id": str(b.pk),
                        "requested": b.requested_count,
                        "chunks": b.chunks_total,
                        "worstCaseModelCalls": worst_case_calls(b),
                    }
                    for b in batches
                ],
            }
            self.stdout.write(json.dumps(report, indent=2))
            return

        if batches and settings.LAI_AI_PROVIDER == "bedrock" and not options["confirm_paid_calls"]:
            raise CommandError(
                "Running a batch makes paid Bedrock calls. Use --dry-run first, then add "
                "--confirm-paid-calls once the owner has approved the spend."
            )
        for batch in batches:
            done = run_batch(batch.pk)
            self.stdout.write(
                f"{done.pk} {done.status} produced={done.produced_count}/{done.requested_count}"
            )
