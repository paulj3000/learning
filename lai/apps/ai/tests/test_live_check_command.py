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
