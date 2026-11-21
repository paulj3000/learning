"""The Castle Director over the Django catalog (ADR-065).

The same route as `test_castle_director.py`, which runs on the empty catalog (the seed). Here the
events are `CastleEvent` rows: only published, active, server-recomputed events are ever offered,
the validator rejects a non-member, and every failure is the authored default.
"""

import json
import uuid

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command

from apps.ai.models import AIInteractionAudit, AIServiceControl
from apps.ai.providers.base import ProviderError
from apps.ai.services import usage
from apps.catalog import authoring
from apps.regions import castle_events
from apps.regions.models import CastleEvent
from apps.users.models import ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

ROOM = "story-hall"
SEED = {e["id"]: e for e in castle_events.SEED_CATALOG}


def url(child):
    return f"/api/v1/children/{child.pk}/castle/director/"


def post(client, child, room=ROOM):
    payload = {"roomId": room, "visitId": str(uuid.uuid4())}
    return client.post(url(child), json.dumps(payload), content_type="application/json")


def choice(event_id):
    return {"eventId": event_id, "safetyDisposition": "ALLOW"}


@pytest.fixture
def publisher(db):
    call_command("ensure_content_roles", stdout=None)
    user = ParentAccount.objects.create(
        cognito_sub="django-admin-only:pub", admin_username="pub", is_staff=True
    )
    user.groups.add(Group.objects.get(name="Content publishers"))
    return user


@pytest.fixture
def imported(db):
    castle_events.import_seed()


def candidate_ids(fake):
    (request,) = fake.requests
    sent = " ".join(part.text for part in request.content)
    context = json.loads(sent.split("(JSON):\n")[1].split("\n\n")[0])
    return [c["id"] for c in context["candidates"]]


def publish_new(publisher, event_id, line, **changes):
    body = {
        "id": event_id,
        "room": ROOM,
        "bands": ["SPROUT", "PATHFINDER", "EXPLORER"],
        "requires": [],
        "repeat": {"maxShows": None, "minVisitGap": 0},
        "weight": 5,
        "npcId": None,
        "lines": {"SPROUT": [line], "PATHFINDER": [line], "EXPLORER": [line]},
        "visual": {"kind": "lantern-glow"},
        "fallback": False,
        **changes,
    }
    event = CastleEvent.objects.create(event_id=event_id, room=ROOM, source=body)
    authoring.publish(authoring.create_draft(event, body, user=publisher), user=publisher)
    return event


def test_the_imported_catalog_behaves_like_the_seed(families, api, fake_model, imported):
    fake = fake_model(choice("quill-hums-in-hall"))
    response = post(api(families.a), families.a1)
    assert response.json() == {
        "eventId": "quill-hums-in-hall",
        "source": "AI",
        "lines": SEED["quill-hums-in-hall"]["lines"]["PATHFINDER"],
        "npcId": "keeper-quill",
        "visual": {"kind": "quill-scratch"},
    }
    assert candidate_ids(fake) == [
        "lanterns-glow-brighter",
        "quill-hums-in-hall",
        "quiet-story-hall",
    ]


def test_an_empty_catalog_falls_back_to_the_seed_default(families, api, fake_model):
    fake_model(choice("quill-hums-in-hall"))
    assert not CastleEvent.objects.exists()
    assert post(api(families.a), families.a1).json()["eventId"] == "quill-hums-in-hall"


def test_a_newly_published_event_is_offered_and_its_authored_line_is_shown(
    families, api, fake_model, imported, publisher
):
    publish_new(publisher, "evening-glow", "The window glows warmly.")
    fake = fake_model(choice("evening-glow"))
    response = post(api(families.a), families.a1).json()
    assert candidate_ids(fake)[0] == "evening-glow"  # weight 5 sorts first
    assert (response["eventId"], response["source"]) == ("evening-glow", "AI")
    assert response["lines"] == ["The window glows warmly."]


def test_a_draft_only_event_is_not_offered_and_a_model_pick_of_it_is_rejected(
    families, api, fake_model, imported, publisher
):
    body = {**castle_events.body_of(SEED["quiet-story-hall"]), "id": "sneaky"}
    event = CastleEvent.objects.create(event_id="sneaky", room=ROOM, source=body)
    authoring.create_draft(event, body, user=publisher)
    fake = fake_model(choice("sneaky"))
    payload = post(api(families.a), families.a1).json()
    assert "sneaky" not in candidate_ids(fake)
    assert payload["source"] == "FALLBACK" and payload["eventId"] == "lanterns-glow-brighter"
    assert (
        AIInteractionAudit.objects.for_child(families.a1).get().validation_status
        == "INVALID_CONTENT"
    )


def test_a_retired_event_is_not_offered_and_a_model_pick_of_it_falls_back(
    families, api, fake_model, imported, publisher
):
    authoring.set_active(
        CastleEvent.objects.get(event_id="quill-hums-in-hall"), False, user=publisher
    )
    fake = fake_model(choice("quill-hums-in-hall"))
    payload = post(api(families.a), families.a1).json()
    assert "quill-hums-in-hall" not in candidate_ids(fake)
    assert (payload["source"], payload["eventId"]) == ("FALLBACK", "lanterns-glow-brighter")


def test_a_retired_default_is_not_the_default(families, api, fake_model, imported, publisher):
    for event_id in ("lanterns-glow-brighter", "quill-hums-in-hall"):
        authoring.set_active(CastleEvent.objects.get(event_id=event_id), False, user=publisher)
    fake_model(choice("lanterns-glow-brighter"))
    payload = post(api(families.a), families.a1).json()
    assert (payload["source"], payload["eventId"]) == ("FALLBACK", "quiet-story-hall")


def test_an_event_for_another_age_band_is_not_offered(
    families, api, fake_model, imported, publisher
):
    publish_new(
        publisher,
        "sprouts-only-glow",
        "Glow.",
        bands=["SPROUT"],
        lines={"SPROUT": ["Glow."]},
    )
    fake = fake_model(choice("sprouts-only-glow"))  # the family's children are Pathfinders
    payload = post(api(families.a), families.a1).json()
    assert "sprouts-only-glow" not in candidate_ids(fake)
    assert payload["source"] == "FALLBACK"


def test_when_every_event_is_retired_the_route_is_a_404_not_the_seed(
    families, api, fake_model, imported, publisher
):
    for event in CastleEvent.objects.all():
        authoring.set_active(event, False, user=publisher)
    fake = fake_model()
    assert post(api(families.a), families.a1).status_code == 404
    assert fake.requests == []


def test_provider_failure_returns_the_authored_default_from_the_catalog(
    families, api, fake_model, imported
):
    fake_model(ProviderError())
    payload = post(api(families.a), families.a1).json()
    assert (payload["source"], payload["eventId"]) == ("FALLBACK", "lanterns-glow-brighter")
    assert payload["lines"] == SEED["lanterns-glow-brighter"]["lines"]["PATHFINDER"]


def test_the_kill_switch_makes_no_model_call_and_shows_the_catalog_default(
    families, api, fake_model, imported, publisher
):
    publish_new(publisher, "evening-glow", "The window glows warmly.")
    AIServiceControl.objects.create(pk=1, model_calls_enabled=False)
    usage.clear_control_cache()
    fake = fake_model(choice("quill-hums-in-hall"))
    payload = post(api(families.a), families.a1).json()
    assert fake.requests == []
    assert (payload["source"], payload["eventId"]) == ("FALLBACK", "evening-glow")
