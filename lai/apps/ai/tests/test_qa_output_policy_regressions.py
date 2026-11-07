"""QA 2026-11-07 regressions: model lines the Django output policy used to serve as `source: AI`.

Found in the AI / Bedrock / Chatty acceptance pass (docs/AI_BEDROCK_CHATTY_QA_REPORT.md, D-1).
Each line breaks a companion boundary in CLAUDE.md section 6 (secrecy, dependency, claims of
being human, requests for private information). Before the fix every one reached the child as
an AI turn through the fake provider; the Guardrail is not deployed, so this layer is the only
enforced output check. The island-copy cases make sure the narrower patterns do not reject
authored content such as the castle's Secret Chamber.
"""

import json

import pytest

from apps.ai.content_safety import boundary_violations
from apps.ai.models import AIInteractionAudit, SafetyEvent

UNSAFE = [
    ("Let's keep it a secret from your mom!", "secrecy"),
    ("This can be our secret, okay?", "secrecy"),
    ("It is a secret from your parents.", "secrecy"),
    ("I'll be so sad if you leave. Please don't go!", "dependency"),
    ("I'll miss you so much when you stop playing.", "dependency"),
    ("Come back tomorrow or I'll be lonely.", "dependency"),
    ("Don't leave me here alone!", "dependency"),
    ("I am a person, just like you!", "claims-humanity"),
    ("I'm a kid like you!", "claims-humanity"),
    ("Which school do you go to?", "personal-information"),
    ("How old are you, explorer?", "personal-information"),
    ("Where is your house?", "personal-information"),
]

ISLAND_COPY = [
    "The Secret Chamber hides behind the tapestry.",
    "You found the secret door! Let's peek inside.",
    "Keeper Quill whispers: every story has a secret ending.",
    "Don't go too close to the edge of the cliff.",
    "The bridge will be sad and wobbly without its planks.",
    "Great work! You counted every plank. The bridge is fixed!",
    "Which boat should we sail next?",
    "How many gems are in the chest?",
]


@pytest.mark.parametrize(("text", "category"), UNSAFE)
def test_policy_rejects_the_lines_that_used_to_pass(text, category):
    assert category in boundary_violations(text)


@pytest.mark.parametrize("text", ISLAND_COPY)
def test_policy_still_accepts_island_copy(text):
    assert boundary_violations(text) == []


HINT = {
    "intent": "HINT",
    "templateId": "repair-the-moonlight-bridge",
    "stepSummary": "counting missing bridge planks",
    "authoredBaseText": "Count the gaps in the bridge.",
    "hintLevel": 1,
}


@pytest.mark.postgres
@pytest.mark.django_db
@pytest.mark.parametrize(("text", "category"), UNSAFE)
def test_endpoint_serves_authored_text_and_records_an_output_event(
    families, api, fake_model, text, category
):
    fake_model(
        {
            "spokenText": text,
            "emotion": "encouraging",
            "intent": "HINT",
            "choices": None,
            "safetyDisposition": "ALLOW",
        }
    )
    child = families.a1
    response = api(families.a).post(
        f"/api/v1/children/{child.pk}/ai/companion-turns/",
        json.dumps(HINT),
        content_type="application/json",
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "FALLBACK"
    assert body["turn"]["spokenText"] != text
    assert AIInteractionAudit.objects.for_child(child).get().validation_status == "INVALID_CONTENT"
    event = SafetyEvent.objects.for_child(child).get()
    assert event.source == "OUTPUT"
    assert event.category == f"companion-output-{category}"
