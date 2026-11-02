"""Parent transparency and control over AI records (LAI-0706, LAI-0707).

GET .../ai/safety-events/ and DELETE .../ai/history/ replace the Amplify dashboard's direct
model reads and `clearAIHistory`. Child-scoped checklist (LAI-0403) included.
"""

import json
import uuid

import pytest

from apps.ai.models import AIInteractionAudit, SafetyEvent
from apps.ai.providers.fake import GUARDRAIL_BLOCK

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

TURN = {
    "intent": "HINT",
    "templateId": "bridge",
    "stepSummary": "counting planks",
}


def make_events(api, families, fake_model):
    fake_model(GUARDRAIL_BLOCK, GUARDRAIL_BLOCK, GUARDRAIL_BLOCK)
    for parent, child in (
        (families.a, families.a1),
        (families.a, families.a2),
        (families.b, families.b1),
    ):
        api(parent).post(
            f"/api/v1/children/{child.pk}/ai/companion-turns/",
            json.dumps(TURN),
            content_type="application/json",
        )


def test_a_parent_lists_only_this_childs_safety_events(families, api, fake_model):
    make_events(api, families, fake_model)
    response = api(families.a).get(f"/api/v1/children/{families.a1.pk}/ai/safety-events/")
    assert response.status_code == 200
    (event,) = response.json()["results"]
    assert event["category"] == "companion-guardrail"
    assert event["actionTaken"] == "Replaced with authored fallback content."
    assert set(event) == {
        "id",
        "category",
        "severity",
        "source",
        "actionTaken",
        "reviewStatus",
        "createdAt",
    }


def test_another_family_cannot_read_or_clear(families, api, fake_model):
    make_events(api, families, fake_model)
    for method in ("get", "delete"):
        path = "safety-events" if method == "get" else "history"
        foreign = getattr(api(families.a), method)(f"/api/v1/children/{families.b1.pk}/ai/{path}/")
        unknown = getattr(api(families.a), method)(f"/api/v1/children/{uuid.uuid4()}/ai/{path}/")
        assert foreign.status_code == unknown.status_code == 404
    assert SafetyEvent.objects.for_child(families.b1).count() == 1
    assert api().get(f"/api/v1/children/{families.a1.pk}/ai/safety-events/").status_code == 401


def test_clearing_history_removes_only_this_childs_ai_rows(families, api, fake_model):
    from apps.education.models import SkillProgress

    make_events(api, families, fake_model)
    SkillProgress.objects.create(child=families.a1, learning_objective_code="counting-sets")
    response = api(families.a).delete(f"/api/v1/children/{families.a1.pk}/ai/history/")
    assert response.status_code == 200
    assert response.json() == {"deleted": {"safetyEvents": 1, "audits": 1}}
    assert not AIInteractionAudit.objects.for_child(families.a1).exists()
    assert not SafetyEvent.objects.for_child(families.a1).exists()
    # Siblings, other families and gameplay records are untouched.
    assert AIInteractionAudit.objects.for_child(families.a2).count() == 1
    assert AIInteractionAudit.objects.for_child(families.b1).count() == 1
    assert SkillProgress.objects.for_child(families.a1).count() == 1


def test_clearing_twice_is_harmless(families, api):
    path = f"/api/v1/children/{families.a1.pk}/ai/history/"
    assert api(families.a).delete(path).json() == {"deleted": {"safetyEvents": 0, "audits": 0}}
