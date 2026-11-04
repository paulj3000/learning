"""`manage.py ai_live_check` (LAI-0705), rehearsed against the fake model. No AWS."""

import json
import uuid

import pytest
from django.core.management import CommandError, call_command

from apps.ai.providers.base import ProviderTimeout
from apps.ai.providers.fake import GUARDRAIL_BLOCK

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def run(child, *args):
    from io import StringIO

    out = StringIO()
    call_command(
        "ai_live_check",
        "--parent-sub",
        child.parent.cognito_sub,
        "--child",
        str(child.pk),
        *args,
        stdout=out,
    )
    return json.loads(out.getvalue())


def test_refuses_to_prove_anything_without_bedrock(families):
    with pytest.raises(CommandError, match="not bedrock"):
        call_command(
            "ai_live_check", "--parent-sub", families.a.cognito_sub, "--child", str(families.a1.pk)
        )


def test_a_rehearsal_passes_and_prints_no_child_data(families, fake_model, capsys):
    fake_model(
        {
            "spokenText": "Count each gap.",
            "emotion": "CALM",
            "intent": "HINT",
            "choices": None,
            "safetyDisposition": "ALLOW",
        },
        {
            "spokenText": "Point to each gap.",
            "strategy": "GIVE_HINT",
            "representation": None,
            "emotion": "CALM",
            "safetyDisposition": "ALLOW",
        },
        GUARDRAIL_BLOCK,
    )
    summary = run(families.a1, "--allow-fake", "--guardrail-probe")
    assert summary["passed"] is True
    assert [c["check"] for c in summary["checks"]] == ["companion", "tutor", "guardrail-probe"]
    assert summary["checks"][0]["inputTokens"] == 10
    text = json.dumps(summary)
    assert "Zinnia-A1" not in text and str(families.a1.pk) not in text


def test_a_fallback_fails_the_check(families, fake_model):
    fake_model(ProviderTimeout())
    with pytest.raises(CommandError, match="failed"):
        run(families.a1, "--allow-fake")


def check(parent_sub, child_id):
    call_command("ai_live_check", "--parent-sub", parent_sub, "--child", child_id, "--allow-fake")


def test_an_unknown_or_foreign_child_or_ai_off_is_refused(families):
    sub = families.a.cognito_sub
    for parent_sub, child_id in [
        (sub, str(uuid.uuid4())),
        (sub, "not-a-uuid"),
        (sub, str(families.b1.pk)),  # another family's child
        ("no-such-sub", str(families.a1.pk)),
    ]:
        with pytest.raises(CommandError, match="No such child"):
            check(parent_sub, child_id)
    families.a1.ai_enabled = False
    families.a1.save()
    with pytest.raises(CommandError, match="switched off"):
        check(sub, str(families.a1.pk))


# --- dry run, opt-in and the extra checks (LAI-0705 readiness) ----------------------------------


@pytest.fixture
def bedrock_configured(settings):
    settings.LAI_AI_PROVIDER = "bedrock"
    settings.LAI_AI_BEDROCK_REGION = "us-west-1"
    settings.LAI_AI_GUARDRAIL_ID = "gr-test"
    settings.LAI_AI_GUARDRAIL_VERSION = "1"
    return settings


@pytest.fixture
def no_aws(monkeypatch):
    """Any attempt to build a boto3 client, or to invoke the adapter, fails the test."""
    import boto3

    from apps.ai.providers.bedrock import BedrockModelClient

    def boom(*args, **kwargs):
        raise AssertionError("AWS was touched")

    monkeypatch.setattr(boto3, "client", boom)
    monkeypatch.setattr(BedrockModelClient, "_build_runtime", boom)
    monkeypatch.setattr(BedrockModelClient, "invoke", boom)


def dry_run():
    from io import StringIO

    out = StringIO()
    try:
        call_command("ai_live_check", "--dry-run", stdout=out)
    finally:
        report = json.loads(out.getvalue()) if out.getvalue() else None
    return report


def test_a_dry_run_reports_configuration_and_makes_no_aws_call(bedrock_configured, no_aws):
    report = dry_run()
    assert report["awsCallsMade"] == 0 and report["ready"] is True
    by_name = {item["item"]: item for item in report["items"]}
    assert by_name["guardrail id"]["detail"] == "gr-test"
    assert by_name["client builds"]["status"] == "PASS"
    assert by_name["credentials and model access"]["status"] == "UNKNOWN"
    assert by_name["prices"]["status"] == "WARN"  # unset prices: cost unknown, never guessed
    assert "--confirm-paid-calls" in report["paidRun"]


def test_a_dry_run_names_what_blocks_a_live_run(bedrock_configured, no_aws):
    bedrock_configured.LAI_AI_GUARDRAIL_ID = ""
    with pytest.raises(CommandError, match="Not ready"):
        dry_run()


def test_a_dry_run_fails_on_the_fake_provider_and_when_the_kill_switch_is_off(
    settings, bedrock_configured, no_aws
):
    from apps.ai.models import AIServiceControl

    AIServiceControl.objects.update_or_create(pk=1, defaults={"model_calls_enabled": False})
    with pytest.raises(CommandError, match="Not ready"):
        dry_run()
    settings.LAI_AI_PROVIDER = "fake"
    with pytest.raises(CommandError, match="Not ready"):
        dry_run()


@pytest.mark.parametrize(
    "flag", ["--warm-up", "--guardrail-probe", "--npc", "--timeout-probe", "--confirm-paid-calls"]
)
def test_a_dry_run_refuses_every_paid_option(bedrock_configured, no_aws, flag):
    with pytest.raises(CommandError, match="cannot be combined"):
        call_command("ai_live_check", "--dry-run", flag)


def test_a_paid_run_needs_explicit_confirmation(families, bedrock_configured, no_aws):
    with pytest.raises(CommandError, match="--confirm-paid-calls"):
        call_command(
            "ai_live_check",
            "--parent-sub",
            families.a.cognito_sub,
            "--child",
            str(families.a1.pk),
        )


def test_a_paid_run_without_ids_is_refused(bedrock_configured, no_aws):
    with pytest.raises(CommandError, match="required"):
        call_command("ai_live_check", "--confirm-paid-calls")


def test_the_summary_reports_usage_and_an_estimate_only_when_prices_exist(
    families, fake_model, settings
):
    reply = {
        "spokenText": "Count each gap.",
        "emotion": "CALM",
        "intent": "HINT",
        "choices": None,
        "safetyDisposition": "ALLOW",
    }
    tutor = {
        "spokenText": "Point to each gap.",
        "strategy": "GIVE_HINT",
        "representation": None,
        "emotion": "CALM",
        "safetyDisposition": "ALLOW",
    }
    fake_model(reply, tutor)
    summary = run(families.a1, "--allow-fake")
    assert summary["usage"]["auditedTurns"] == 2
    assert summary["usage"]["estimatedCostUsd"] is None
    assert "unknown" in summary["usage"]["estimateNote"]
    settings.LAI_AI_PRICE_INPUT_PER_MTOK_USD = 1.0
    settings.LAI_AI_PRICE_OUTPUT_PER_MTOK_USD = 5.0
    fake_model(reply, tutor)
    assert run(families.a1, "--allow-fake")["usage"]["estimatedCostUsd"] > 0


def test_the_npc_check_needs_the_published_catalog(families, fake_model):
    fake_model()
    summary = None
    with pytest.raises(CommandError, match="failed"):
        run(families.a1, "--allow-fake", "--npc")
    from apps.catalog.importer import import_content

    import_content()
    fake_model()
    summary = run(families.a1, "--allow-fake", "--npc")
    npc = next(c for c in summary["checks"] if c["check"] == "npc-narration")
    assert npc["passed"] is True


def test_the_timeout_probe_expects_a_timeout_fallback(families, fake_model, monkeypatch):
    from botocore.exceptions import ReadTimeoutError

    from apps.ai.management.commands.ai_live_check import Command
    from apps.ai.tests.test_providers import Runtime, bedrock

    fake_model()
    stub = bedrock(Runtime(error=ReadTimeoutError(endpoint_url="https://bedrock")))
    monkeypatch.setattr(Command, "_client", staticmethod(lambda timeout: stub))
    summary = run(families.a1, "--allow-fake", "--timeout-probe")
    probe = next(c for c in summary["checks"] if c["check"] == "timeout-probe")
    assert probe["passed"] is True
