"""POST /api/v1/children/{child_id}/castle/flavour/ (Final D): Quill's flavour line. Fake model only."""

import json
import logging

import pytest

from apps.ai.models import AIInteractionAudit, AIServiceControl
from apps.ai.providers import override_model_client
from apps.ai.providers.base import ProviderTimeout
from apps.ai.providers.fake import FakeModelClient
from apps.ai.services import usage
from apps.npcs.castle_flavour import authored_line
from apps.npcs.tests.test_castle_flavour import GOOD, publish_quill
from apps.regions import castle_events
from apps.regions.models import CastleEventShown

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

EVENT = next(e for e in castle_events.SEED_CATALOG if e["id"] == "quill-hums-in-hall")
OTHER = next(e for e in castle_events.SEED_CATALOG if e["npcId"] != "keeper-quill")


@pytest.fixture
def fake():
    installed = []
    usage.clear_control_cache()

    def install(*responses):
        client = FakeModelClient(responses)
        context = override_model_client(client)
        context.__enter__()
        installed.append(context)
        return client

    yield install
    for context in reversed(installed):
        context.__exit__(None, None, None)
    usage.clear_control_cache()


def url(child):
    return f"/api/v1/children/{child.pk}/castle/flavour/"


def post(client, child, payload=None):
    body = {"eventId": EVENT["id"]} if payload is None else payload
    return client.post(url(child), json.dumps(body), content_type="application/json")


def shown(child, event=EVENT):
    CastleEventShown.objects.create(child=child, event_id=event["id"], shown_count=1)


def authored(band="PATHFINDER"):
    return authored_line(EVENT, band)


def reply(text=GOOD):
    return {"spokenText": text, "safetyDisposition": "ALLOW"}


def test_ai_enabled_shows_the_model_line(families, api, fake):
    publish_quill()
    shown(families.a1)
    fake(reply())
    response = post(api(families.a), families.a1)
    assert response.status_code == 200
    assert response.json() == {"eventId": EVENT["id"], "line": GOOD, "source": "AI"}


def test_ai_disabled_for_the_child_is_authored_and_makes_no_call(families, api, fake):
    publish_quill()
    shown(families.a1)
    model = fake(reply())
    families.a1.ai_enabled = False
    families.a1.save()
    body = post(api(families.a), families.a1).json()
    assert (body["line"], body["source"]) == (authored(), "FALLBACK")
    assert model.requests == [] and not AIInteractionAudit.objects.exists()


def test_the_kill_switch_is_authored_and_makes_no_call(families, api, fake):
    publish_quill()
    shown(families.a1)
    AIServiceControl.objects.create(pk=1, model_calls_enabled=False)
    usage.clear_control_cache()
    model = fake(reply())
    body = post(api(families.a), families.a1).json()
    assert (body["line"], body["source"]) == (authored(), "FALLBACK")
    assert model.requests == []


def test_a_provider_failure_is_authored(families, api, fake):
    publish_quill()
    shown(families.a1)
    fake(ProviderTimeout())
    body = post(api(families.a), families.a1).json()
    assert (body["line"], body["source"]) == (authored(), "FALLBACK")


def test_an_unsafe_or_overlong_reply_is_authored(families, api, fake):
    publish_quill()
    shown(families.a1)
    fake(reply("Read more at https://example.com now."), reply("z" * 400))
    for _ in range(2):
        body = post(api(families.a), families.a1).json()
        assert (body["line"], body["source"]) == (authored(), "FALLBACK")


def test_the_age_band_is_passed_and_its_length_limit_applied(families, api, fake):
    publish_quill()
    families.a1.age_band = "SPROUT"
    families.a1.save()
    shown(families.a1)
    model = fake(reply("y" * 130))
    body = post(api(families.a), families.a1).json()
    assert (body["line"], body["source"]) == (authored("SPROUT"), "FALLBACK")
    assert "SPROUT" in model.requests[0].content[0].text


def test_an_event_never_shown_unknown_or_not_quills_is_one_404(families, api, fake):
    publish_quill()
    model = fake(reply())
    client = api(families.a)
    assert post(client, families.a1).status_code == 404  # not shown yet
    shown(families.a1)
    shown(families.a1, OTHER)
    assert post(client, families.a1, {"eventId": "no-such-event"}).status_code == 404
    assert post(client, families.a1, {"eventId": OTHER["id"]}).status_code == 404
    assert model.requests == []


def test_another_parents_child_is_a_404_and_no_token_is_unauthorised(families, api, fake):
    publish_quill()
    shown(families.a1)
    model = fake(reply())
    assert post(api(families.b), families.a1).status_code == 404
    assert post(api(), families.a1).status_code in (401, 403)
    assert model.requests == []


@pytest.mark.parametrize("payload", [{}, {"eventId": ""}, {"eventId": EVENT["id"], "x": 1}])
def test_the_body_is_closed(families, api, payload):
    assert post(api(families.a), families.a1, payload).status_code == 400


def test_nothing_is_logged_with_child_data(families, api, fake, caplog):
    publish_quill()
    shown(families.a1)
    fake(reply())
    with caplog.at_level(logging.DEBUG):
        post(api(families.a), families.a1)
    text = " ".join(r.getMessage() for r in caplog.records)
    assert GOOD not in text and str(families.a1.pk) not in text
