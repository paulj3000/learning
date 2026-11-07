"""Owner-run live batch tooling (LAI-AQS-025 readiness): dry run, opt-in and inspection.

No test here calls a model except the fake. Nothing publishes or approves anything.
"""

import json
from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from apps.question_studio import generation
from apps.question_studio.models import Question, ReviewStatus

from .conftest import params

pytestmark = pytest.mark.django_db


def command(name, *args):
    out = StringIO()
    call_command(name, *args, stdout=out)
    return out.getvalue()


def test_a_dry_run_reports_the_plan_and_calls_no_model(author, settings, monkeypatch):
    from apps.question_studio.management.commands import studio_run_batch

    def boom(*args, **kwargs):
        raise AssertionError("a model was called")

    monkeypatch.setattr(studio_run_batch, "run_batch", boom)
    monkeypatch.setattr(generation, "studio_client", boom)
    settings.LAI_AI_PROVIDER = "bedrock"
    batch = generation.create_batch(author, params(count=5))
    report = json.loads(command("studio_run_batch", "--dry-run"))
    assert report["awsCallsMade"] == 0 and report["modelApproved"] is True
    (planned,) = report["batches"]
    assert planned["id"] == str(batch.pk) and planned["requested"] == 5 and planned["chunks"] == 1
    # one chunk x Studio attempts x SDK attempts
    assert planned["worstCaseModelCalls"] == (
        settings.LAI_STUDIO_MAX_ATTEMPTS * settings.LAI_AI_MAX_ATTEMPTS
    )


def test_a_bedrock_batch_needs_explicit_confirmation(author, settings):
    settings.LAI_AI_PROVIDER = "bedrock"
    generation.create_batch(author, params(count=5))
    with pytest.raises(CommandError, match="--confirm-paid-calls"):
        command("studio_run_batch")


def test_the_fake_provider_needs_no_confirmation(author, fake):
    batch = generation.create_batch(author, params(count=5))
    assert f"{batch.pk} COMPLETED produced=5/5" in command("studio_run_batch")


def test_a_five_question_batch_is_one_chunk_and_one_request(author, fake):
    batch = generation.create_batch(author, params(count=5))
    done = generation.run_batch(batch.pk)
    assert (done.chunks_total, done.chunks_done, len(fake.requests)) == (1, 1, 1)


def test_the_report_lists_validation_outcomes_tokens_and_cost_per_question(author, fake, settings):
    settings.LAI_AI_PRICE_INPUT_PER_MTOK_USD = 1.0
    settings.LAI_AI_PRICE_OUTPUT_PER_MTOK_USD = 5.0
    batch = generation.create_batch(author, params(count=5))
    generation.run_batch(batch.pk)
    report = json.loads(command("studio_batch_report", "--id", str(batch.pk)))
    assert report["produced"] == 5 and report["published"] == 0
    assert len(report["questions"]) == 5
    assert report["validation"]["passed"] + report["validation"]["failed"] <= 5
    assert report["inputTokens"] > 0 and report["estimatedCostUsd"] > 0
    assert report["estimatedCostPerQuestionUsd"] == pytest.approx(
        report["estimatedCostUsd"] / 5, rel=0.05
    )
    assert all("stem" not in row for row in report["questions"])  # text only on request
    assert all(r["reviewStatus"] != ReviewStatus.PUBLISHED for r in report["questions"])


def test_the_report_shows_text_only_when_asked_and_cost_unknown_without_prices(author, fake):
    batch = generation.create_batch(author, params(count=2))
    generation.run_batch(batch.pk)
    report = json.loads(command("studio_batch_report", "--id", str(batch.pk), "--show-text"))
    assert report["estimatedCostUsd"] is None and "unknown" in report["costNote"]
    assert all(row["stem"] for row in report["questions"])


def test_the_report_is_read_only_and_refuses_an_unknown_batch(author, fake):
    batch = generation.create_batch(author, params(count=2))
    generation.run_batch(batch.pk)
    before = list(Question.objects.values_list("pk", "review_status", "updated_at"))
    command("studio_batch_report", "--id", str(batch.pk))
    assert before == list(Question.objects.values_list("pk", "review_status", "updated_at"))
    for bad in ("not-a-uuid", "00000000-0000-0000-0000-000000000000"):
        with pytest.raises(CommandError, match="No such batch"):
            command("studio_batch_report", "--id", bad)
