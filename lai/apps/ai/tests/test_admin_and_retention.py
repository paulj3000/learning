"""Staff inspection and retention of AI metadata (LAI-0707)."""

import json
import logging
from datetime import timedelta
from io import StringIO

import pytest
from django.contrib.auth.models import Permission
from django.core.management import CommandError, call_command
from django.test import Client
from django.utils.timezone import now

from apps.ai.models import AIInteractionAudit, SafetyEvent
from apps.ai.providers.fake import GUARDRAIL_BLOCK
from apps.ai.retention import RetentionNotConfigured, apply_retention
from apps.core.tests.test_django_admin import make_admin

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

TURN = {"intent": "HINT", "templateId": "bridge", "stepSummary": "counting planks"}


def blocked_turns(api, families, fake_model, count=2):
    fake_model(*[GUARDRAIL_BLOCK] * count)
    for _ in range(count):
        api(families.a).post(
            f"/api/v1/children/{families.a1.pk}/ai/companion-turns/",
            json.dumps(TURN),
            content_type="application/json",
        )


def staff_client(username, *codenames):
    account, password = make_admin(username)
    for codename in codenames:
        account.user_permissions.add(Permission.objects.get(codename=codename))
    client = Client()
    assert client.login(username=username, password=password)
    return client


# --- admin ---------------------------------------------------------------------------------------


def test_staff_without_the_ai_permission_cannot_see_ai_records(families, api, fake_model):
    blocked_turns(api, families, fake_model)
    client = staff_client("plain-staff")
    assert client.get("/admin/ai/aiinteractionaudit/").status_code == 403
    assert client.get("/admin/ai/safetyevent/").status_code == 403


def test_permitted_staff_read_metadata_only_and_every_read_is_audited(
    families, api, fake_model, caplog
):
    blocked_turns(api, families, fake_model)
    client = staff_client("ai-reviewer", "view_aiinteractionaudit", "view_safetyevent")
    with caplog.at_level(logging.INFO, logger="lai.admin_audit"):
        listing = client.get("/admin/ai/aiinteractionaudit/")
        row = AIInteractionAudit.objects.first()
        detail = client.get(f"/admin/ai/aiinteractionaudit/{row.pk}/change/")
    assert listing.status_code == detail.status_code == 200
    page = listing.content.decode() + detail.content.decode()
    assert "Zinnia-A1" not in page and "Secret-Interest" not in page
    assert "BLOCKED_GUARDRAIL" in page
    lines = [r.getMessage() for r in caplog.records if r.name == "lai.admin_audit"]
    assert any("action=list" in line for line in lines)
    assert any("action=view" in line and str(row.pk) in line for line in lines)


def test_audit_rows_cannot_be_changed_added_or_deleted(families, api, fake_model):
    blocked_turns(api, families, fake_model)
    client = staff_client(
        "ai-reviewer2",
        "view_aiinteractionaudit",
        "change_aiinteractionaudit",
        "delete_aiinteractionaudit",
        "add_aiinteractionaudit",
    )
    row = AIInteractionAudit.objects.first()
    assert client.get("/admin/ai/aiinteractionaudit/add/").status_code == 403
    assert client.post(f"/admin/ai/aiinteractionaudit/{row.pk}/delete/").status_code == 403
    client.post(f"/admin/ai/aiinteractionaudit/{row.pk}/change/", {"validation_status": "VALID"})
    row.refresh_from_db()
    assert row.validation_status == "BLOCKED_GUARDRAIL"


def test_a_reviewer_may_change_only_the_review_status(families, api, fake_model):
    blocked_turns(api, families, fake_model, count=1)
    client = staff_client("ai-reviewer3", "view_safetyevent", "change_safetyevent")
    event = SafetyEvent.objects.get()
    response = client.post(
        f"/admin/ai/safetyevent/{event.pk}/change/",
        {"review_status": "REVIEWED", "severity": "LOW", "category": "forged"},
    )
    assert response.status_code == 302
    event.refresh_from_db()
    assert (event.review_status, event.severity, event.category) == (
        "REVIEWED",
        "MEDIUM",
        "companion-guardrail",
    )


# --- retention -----------------------------------------------------------------------------------


def age(model, days):
    model.objects.update(created_at=now() - timedelta(days=days))


def test_retention_refuses_without_an_approved_period():
    with pytest.raises(RetentionNotConfigured):
        apply_retention(older_than_days=None, apply=True)
    with pytest.raises(CommandError, match="No retention period"):
        call_command("ai_retention", "--apply")


def test_retention_dry_run_counts_and_deletes_nothing(families, api, fake_model):
    blocked_turns(api, families, fake_model)
    SafetyEvent.objects.update(review_status="REVIEWED")
    age(AIInteractionAudit, 400)
    age(SafetyEvent, 400)
    out = StringIO()
    call_command("ai_retention", "--older-than-days", "365", stdout=out)
    assert json.loads(out.getvalue()) == {
        "olderThanDays": 365,
        "applied": False,
        "audits": 2,
        "safetyEvents": 2,
        "keptOpenSafetyEvents": 0,
    }
    assert AIInteractionAudit.objects.count() == 2


def test_retention_keeps_open_events_and_their_audits_and_is_idempotent(families, api, fake_model):
    from apps.education.models import SkillProgress

    blocked_turns(api, families, fake_model)
    SkillProgress.objects.create(child=families.a1, learning_objective_code="counting-sets")
    first, second = SafetyEvent.objects.order_by("created_at")
    first.review_status = "REVIEWED"
    first.save()
    age(AIInteractionAudit, 400)
    age(SafetyEvent, 400)

    report = apply_retention(older_than_days=365, apply=True)
    assert (report.audits, report.safety_events, report.kept_open_safety_events) == (1, 1, 1)
    assert list(SafetyEvent.objects.values_list("pk", flat=True)) == [second.pk]
    assert AIInteractionAudit.objects.get().pk == second.audit_id
    assert SkillProgress.objects.count() == 1  # gameplay is never touched

    again = apply_retention(older_than_days=365, apply=True)
    assert (again.audits, again.safety_events) == (0, 0)


def test_recent_rows_survive_and_the_period_is_bounded(families, api, fake_model):
    blocked_turns(api, families, fake_model)
    assert apply_retention(older_than_days=30, apply=True, include_open=True).audits == 0
    with pytest.raises(ValueError):
        apply_retention(older_than_days=0, apply=False)
