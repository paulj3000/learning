"""Inspect one generation batch: `manage.py studio_batch_report --id UUID [--show-text]`.

Read-only, no model call, no AWS call. Prints the batch's provenance, token use, the estimated
cost (only when prices are configured; it is an estimate, never a bill) and, per question, the
review status and the deterministic validation findings. Question text is omitted unless
`--show-text` is given. Nothing here approves or publishes anything.

The cost counts tokens of the calls that returned a reply. A call that timed out or was blocked
may still be billed by AWS but reports no usage, so the real bill can be higher.
"""

import json

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from apps.question_studio.models import GenerationBatch, ReviewStatus


class Command(BaseCommand):
    help = "Report a generation batch: rows, validation outcomes, tokens and estimated cost."

    def add_arguments(self, parser):
        parser.add_argument("--id", required=True, help="The batch id.")
        parser.add_argument("--show-text", action="store_true", help="Include question text.")

    def handle(self, *args, id, show_text, **options):  # noqa: A002
        try:
            batch = GenerationBatch.objects.get(pk=id)
        except (GenerationBatch.DoesNotExist, ValidationError, ValueError, TypeError):
            raise CommandError("No such batch.") from None
        rows = []
        for question in batch.questions.order_by("generated_at", "pk"):
            latest = max((f.run for f in question.findings.all()), default=None)
            findings = [
                {"check": f.code, "severity": f.severity}
                for f in question.findings.all()
                if f.run == latest
            ]
            row = {
                "id": str(question.pk),
                "reviewStatus": question.review_status,
                "validationStatus": question.validation_status,
                "difficulty": question.difficulty,
                "findings": findings,
            }
            if show_text:
                row |= {"stem": question.stem, "correctAnswer": question.correct_answer}
            rows.append(row)
        produced = batch.produced_count
        cost = batch.cost_microusd
        report = {
            "id": str(batch.pk),
            "status": batch.status,
            "failureCategory": batch.failure_category or None,
            "model": batch.model_id,
            "requested": batch.requested_count,
            "produced": produced,
            "chunks": f"{batch.chunks_done}/{batch.chunks_total}",
            "modelAttempts": batch.attempts,
            "inputTokens": batch.input_tokens,
            "outputTokens": batch.output_tokens,
            "estimatedCostUsd": round(cost / 1_000_000, 6) if cost is not None else None,
            "estimatedCostPerQuestionUsd": (
                round(cost / produced / 1_000_000, 6) if cost is not None and produced else None
            ),
            "costNote": "Estimate from configured prices; excludes unreported failed calls."
            if cost is not None
            else "No prices configured (LAI_AI_PRICE_*): cost unknown.",
            "validation": {
                "passed": sum(1 for r in rows if r["validationStatus"] == "PASS"),
                "failed": sum(1 for r in rows if r["validationStatus"] == "FAIL"),
                "other": sum(1 for r in rows if r["validationStatus"] not in ("PASS", "FAIL")),
            },
            "published": sum(1 for r in rows if r["reviewStatus"] == ReviewStatus.PUBLISHED),
            "questions": rows,
        }
        self.stdout.write(json.dumps(report, indent=2))
