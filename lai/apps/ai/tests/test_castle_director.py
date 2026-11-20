"""POST /api/v1/children/{child_id}/castle/director/ (SC-R09-01).

The model only picks an id from the set the server recomputed; the authored lines are what the
child sees. Fake model only: no AWS, no network. Children from `families` are Pathfinders.
"""

import json
import uuid

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.ai.content_safety import boundary_violations
from apps.ai.models import AIInteractionAudit, AIServiceControl, SafetyEvent
from apps.ai.providers.base import InvalidModelResponse, ProviderError, ProviderTimeout
from apps.ai.providers.fake import GUARDRAIL_BLOCK
from apps.ai.services import usage
from apps.progression.models import WorldChange
from apps.regions import castle_events
from apps.regions.models import CastleEventShown, CastleVisitState

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

ROOM = "story-hall"
# Weight order for a Pathfinder in the Story Hall with no progress: the lanterns (ANY, weight 2,
# id earlier) then Quill humming (weight 2), then the quiet fallback (weight 1).
DEFAULT = "lanterns-glow-brighter"
ALL_ELIGIBLE = ["lanterns-glow-brighter", "quill-hums-in-hall", "quiet-story-hall"]
EVENTS = {event["id"]: event for event in castle_events.SEED_CATALOG}


def url(child):
    return f"/api/v1/children/{child.pk}/castle/director/"


def body(room=ROOM, visit=None, **extra):
    return {"roomId": room, "visitId": str(visit or uuid.uuid4()), **extra}


def post(client, child, payload=None, raw=None):
    data = raw if raw is not None else json.dumps(payload if payload is not None else body())
    return client.post(url(child), data, content_type="application/json")


def choice(event_id, disposition="ALLOW"):
    return {"eventId": event_id, "safetyDisposition": disposition}


def lines(event_id, band="PATHFINDER"):
    return EVENTS[event_id]["lines"][band]


def audit(child):
    return AIInteractionAudit.objects.for_child(child).get()


# --- the happy path ---------------------------------------------------------------------------


def test_a_valid_id_in_the_set_is_shown_with_its_authored_lines(families, api, fake_model):
    fake_model(choice("quill-hums-in-hall"))
    response = post(api(families.a), families.a1)
    assert response.status_code == 200
    assert response.json() == {
        "eventId": "quill-hums-in-hall",
        "source": "AI",
        "lines": lines("quill-hums-in-hall"),
        "npcId": "keeper-quill",
        "visual": {"kind": "quill-scratch"},
    }
    row = audit(families.a1)
    assert (row.route_name, row.validation_status, row.fallback_used) == (
        "generateCastleDirector",
        "VALID",
        False,
    )
    assert (row.input_category, row.step_id, row.context_source) == (
        "CASTLE_DIRECTOR",
        ROOM,
        "DJANGO_CATALOG",
    )


def test_the_default_fake_model_works_end_to_end(families, api, fake_model):
    fake_model()
    payload = post(api(families.a), families.a1).json()
    assert payload["source"] == "AI" and payload["eventId"] == DEFAULT


def test_the_model_sees_only_ids_and_tags_and_no_child_data(families, api, fake_model):
    fake = fake_model()
    post(api(families.a), families.a1)
    (request,) = fake.requests
    sent = " ".join(part.text for part in request.content)
    context = json.loads(sent.split("(JSON):\n")[1].split("\n\n")[0])
    assert context == {
        "ageBand": "PATHFINDER",
        "candidates": [
            {"id": "lanterns-glow-brighter", "tag": "calm"},
            {"id": "quill-hums-in-hall", "tag": "warm"},
            {"id": "quiet-story-hall", "tag": "calm"},
        ],
        "roomId": ROOM,
    }
    for text in ("Zinnia", str(families.a1.pk), "Secret-Interest", "Keeper Quill hums"):
        assert text not in sent


def test_a_sprout_is_shown_only_the_short_sprout_line(families, api, fake_model):
    fake_model()
    families.a1.age_band = "SPROUT"
    families.a1.save()
    payload = post(api(families.a), families.a1).json()
    assert payload["lines"] == lines(payload["eventId"], "SPROUT")
    assert all(len(line) <= 120 for line in payload["lines"])


def test_the_response_has_no_reward_quest_or_world_change(families, api, fake_model):
    fake_model()
    payload = post(api(families.a), families.a1).json()
    assert set(payload) == {"eventId", "source", "lines", "npcId", "visual"}
    text = json.dumps(payload).lower()
    for word in ("reward", "quest", "worldchange", "progress", "unlock", "item"):
        assert word not in text
    assert not WorldChange.objects.for_child(families.a1).exists()


# --- the model cannot choose outside the eligible set -----------------------------------------


@pytest.mark.parametrize(
    "raw",
    [
        choice("not-an-event"),
        choice(""),
        choice("LANTERNS-GLOW-BRIGHTER"),
        choice("lanterns-glow-brighter "),
        # Eligible in another room, or not yet earned, is not eligible here.
        choice("library-pages-rustle"),
        choice("ember-warms-the-hearth"),
        choice("quill-admires-first-story"),
        {**choice("quill-hums-in-hall"), "text": "Hello"},
        {"eventId": "quill-hums-in-hall"},
        {"safetyDisposition": "ALLOW"},
        {"eventId": ["quill-hums-in-hall"], "safetyDisposition": "ALLOW"},
        {"eventId": "quill-hums-in-hall", "safetyDisposition": "allow"},
        "quill-hums-in-hall",
        ["quill-hums-in-hall"],
        None,
    ],
)
def test_an_invalid_or_ineligible_pick_falls_back_to_the_default(families, api, fake_model, raw):
    fake_model(raw)
    payload = post(api(families.a), families.a1).json()
    assert payload["source"] == "FALLBACK" and payload["eventId"] == DEFAULT
    assert payload["lines"] == lines(DEFAULT)
    assert audit(families.a1).validation_status in {"INVALID_CONTENT", "INVALID_SCHEMA"}


def test_an_invalid_content_pick_is_recorded_as_such(families, api, fake_model):
    fake_model(choice("library-pages-rustle"))
    post(api(families.a), families.a1)
    row = audit(families.a1)
    assert (row.validation_status, row.fallback_used) == ("INVALID_CONTENT", True)
    assert "library-pages-rustle" not in json.dumps(
        list(AIInteractionAudit.objects.values()), default=str
    )


def test_a_pick_becomes_eligible_when_the_child_has_earned_it(families, api, fake_model):
    from django.utils import timezone

    WorldChange.objects.create(
        child=families.a1,
        location_slug="storykeeper-castle",
        change_type="TALE",
        change_key="FIRST_STORY_TOLD",
        source_session_id="test",
        created_at=timezone.now(),
    )
    fake_model(choice("quill-admires-first-story"))
    payload = post(api(families.a), families.a1).json()
    assert (payload["source"], payload["eventId"]) == ("AI", "quill-admires-first-story")


# --- every failure path is the deterministic default ------------------------------------------


def assert_default(response, source="FALLBACK"):
    assert response.status_code == 200
    payload = response.json()
    assert (payload["source"], payload["eventId"]) == (source, DEFAULT)
    assert payload["lines"] == lines(DEFAULT)


@pytest.mark.parametrize(
    "failure",
    [ProviderTimeout(), ProviderError(), InvalidModelResponse(), RuntimeError("boom")],
    ids=["timeout", "provider", "malformed", "unexpected"],
)
def test_provider_failures_return_the_default(families, api, fake_model, failure):
    fake_model(failure)
    assert_default(post(api(families.a), families.a1))
    assert audit(families.a1).fallback_used is True


def test_a_malformed_reply_is_invalid_schema(families, api, fake_model):
    fake_model(InvalidModelResponse())
    post(api(families.a), families.a1)
    assert audit(families.a1).validation_status == "INVALID_SCHEMA"


def test_a_guardrail_intervention_returns_the_default_and_a_safety_event(
    families, api, fake_model
):
    fake_model(GUARDRAIL_BLOCK)
    assert_default(post(api(families.a), families.a1))
    assert audit(families.a1).validation_status == "BLOCKED_GUARDRAIL"
    assert SafetyEvent.objects.get().category == "castle-guardrail"


@pytest.mark.parametrize("disposition", ["REDIRECT", "STOP"])
def test_a_redirect_or_stop_returns_the_default_and_a_safety_event(
    families, api, fake_model, disposition
):
    fake_model(choice("quill-hums-in-hall", disposition))
    assert_default(post(api(families.a), families.a1))
    event = SafetyEvent.objects.get()
    assert event.category == "castle-director" and event.source == "OUTPUT"


def test_ai_switched_off_makes_no_model_call_and_no_audit(families, api, fake_model):
    fake = fake_model()
    families.a1.ai_enabled = False
    families.a1.save()
    assert_default(post(api(families.a), families.a1))
    assert fake.requests == [] and not AIInteractionAudit.objects.exists()


def test_the_disabled_provider_makes_no_call(families, api, fake_model, settings):
    fake = fake_model()
    settings.LAI_AI_PROVIDER = "disabled"
    assert_default(post(api(families.a), families.a1))
    assert fake.requests == [] and not AIInteractionAudit.objects.exists()


def test_the_kill_switch_returns_the_default(families, api, fake_model):
    AIServiceControl.objects.create(pk=1, model_calls_enabled=False)
    usage.clear_control_cache()
    fake = fake_model()
    assert_default(post(api(families.a), families.a1))
    assert fake.requests == []
    row = audit(families.a1)
    assert (row.validation_status, row.failure_category) == ("RATE_LIMITED", "KILL_SWITCH")


def test_the_rate_limit_returns_the_default(families, api, fake_model, settings):
    settings.LAI_AI_CHILD_TURNS_PER_MINUTE = 1
    fake = fake_model(choice("quill-hums-in-hall"), choice("quill-hums-in-hall"))
    client = api(families.a)
    first = post(client, families.a1).json()
    second = post(client, families.a1).json()
    assert first["source"] == "AI"
    assert second["source"] == "FALLBACK"
    assert len(fake.requests) == 1
    statuses = sorted(AIInteractionAudit.objects.values_list("validation_status", flat=True))
    assert statuses == ["RATE_LIMITED", "VALID"]


def test_a_misconfigured_provider_fails_closed(families, api, settings):
    settings.LAI_AI_PROVIDER = "bedrock"
    settings.LAI_AI_GUARDRAIL_ID = ""
    assert_default(post(api(families.a), families.a1))
    row = audit(families.a1)
    assert (row.validation_status, row.failure_category) == ("ERROR", "CONFIGURATION")


# --- authorization and the request -------------------------------------------------------------


def test_each_of_a_parents_children_is_served(families, api, fake_model):
    fake_model()
    for child in (families.a1, families.a2):
        assert post(api(families.a), child).status_code == 200


def test_another_familys_child_and_an_unknown_child_get_the_identical_404(
    families, api, fake_model
):
    fake = fake_model()
    client = api(families.a)
    with CaptureQueriesContext(connection) as queries:
        foreign = post(client, families.b1)
    unknown = client.post(
        f"/api/v1/children/{uuid.uuid4()}/castle/director/",
        json.dumps(body()),
        content_type="application/json",
    )
    assert foreign.status_code == unknown.status_code == 404
    assert foreign.json()["error"] == unknown.json()["error"]
    assert fake.requests == []
    assert not [
        q for q in queries if q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))
    ]
    assert not CastleEventShown.objects.exists() and not CastleVisitState.objects.exists()


def test_no_token_is_unauthorised(families, api):
    assert post(api(), families.a1).status_code in (401, 403)


@pytest.mark.parametrize(
    "extra",
    [
        {"candidates": ["quiet-story-hall"]},
        {"childId": "x"},
        {"eventId": "quill-hums-in-hall"},
        {"ageBand": "EXPLORER"},
    ],
)
def test_the_client_cannot_supply_candidates_or_anything_else(families, api, fake_model, extra):
    fake = fake_model()
    response = post(api(families.a), families.a1, body(**extra))
    assert response.status_code == 400
    assert fake.requests == [] and not CastleEventShown.objects.exists()


@pytest.mark.parametrize(
    "payload",
    [{}, {"roomId": ROOM}, {"visitId": str(uuid.uuid4())}, body(visit="not-a-uuid"), body(room="a b")],
)
def test_a_malformed_request_is_a_400(families, api, payload):
    assert post(api(families.a), families.a1, payload).status_code == 400


def test_an_unknown_room_and_an_unfound_secret_get_the_identical_404(families, api, fake_model):
    fake_model()
    client = api(families.a)
    unknown = post(client, families.a1, body(room="no-such-room"))
    secret = post(client, families.a1, body(room="secret-chamber"))
    assert unknown.status_code == secret.status_code == 404
    assert unknown.json()["error"] == secret.json()["error"]


# --- the only write is the display counter ----------------------------------------------------


def test_the_shown_counter_is_updated_once_per_request(families, api, fake_model):
    fake_model(choice("quill-hums-in-hall"))
    visit = uuid.uuid4()
    post(api(families.a), families.a1, body(visit=visit))
    shown = CastleEventShown.objects.for_child(families.a1).get()
    assert (shown.event_id, shown.shown_count, shown.last_shown_visit) == (
        "quill-hums-in-hall",
        1,
        1,
    )
    assert CastleVisitState.objects.for_child(families.a1).get().visit_count == 1


def test_a_repeat_inside_the_gap_is_not_shown_again_in_the_same_visit(families, api, fake_model):
    fake_model(choice("quill-hums-in-hall"), choice("quill-hums-in-hall"))
    visit = uuid.uuid4()
    client = api(families.a)
    first = post(client, families.a1, body(visit=visit)).json()
    second = post(client, families.a1, body(visit=visit)).json()
    assert first["eventId"] == "quill-hums-in-hall"
    # minVisitGap 1: it is not eligible again until the next visit, so the pick is refused.
    assert second["source"] == "FALLBACK" and second["eventId"] != "quill-hums-in-hall"
    assert CastleVisitState.objects.for_child(families.a1).get().visit_count == 1


def test_a_new_visit_counts_once_and_makes_the_event_eligible_again(families, api, fake_model):
    fake_model(choice("quill-hums-in-hall"), choice("quill-hums-in-hall"))
    client = api(families.a)
    post(client, families.a1, body(visit=uuid.uuid4()))
    again = post(client, families.a1, body(visit=uuid.uuid4())).json()
    assert (again["source"], again["eventId"]) == ("AI", "quill-hums-in-hall")
    assert CastleVisitState.objects.for_child(families.a1).get().visit_count == 2
    shown = CastleEventShown.objects.for_child(families.a1).get(event_id="quill-hums-in-hall")
    assert (shown.shown_count, shown.last_shown_visit) == (2, 2)


def test_max_shows_stops_an_event_for_good(families, api, fake_model):
    fake_model(*[choice("quill-hums-in-hall")] * 6)
    client = api(families.a)
    sources = []
    for _ in range(5):
        sources.append(post(client, families.a1, body(visit=uuid.uuid4())).json()["eventId"])
    assert sources.count("quill-hums-in-hall") == 3  # maxShows is 3


def test_the_writes_are_only_the_audit_the_counters_and_usage(families, api, fake_model):
    fake_model()
    with CaptureQueriesContext(connection) as queries:
        post(api(families.a), families.a1)
    touched = {
        q["sql"].split()[2].strip('"') if q["sql"].upper().startswith("INSERT") else
        q["sql"].split()[1].strip('"')
        for q in queries
        if q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))
    }
    forbidden = ("quest", "progression", "inventory", "worldchange", "skill", "session")
    assert not [t for t in touched if any(word in t for word in forbidden)], touched


def test_the_audit_row_holds_no_event_text_or_child_data(families, api, fake_model):
    fake_model(choice("quill-hums-in-hall"))
    post(api(families.a), families.a1)
    row = audit(families.a1)
    dump = json.dumps(
        {k: v for k, v in vars(row).items() if not k.startswith("_")}, default=str
    )
    for text in ("Keeper Quill", "hums", "quill-hums-in-hall", "Zinnia", "Secret-Interest"):
        assert text not in dump
    assert str(families.a1.pk) not in dump.replace(str(row.child_id), "")
    assert row.step_id == ROOM


# --- the authored copy -------------------------------------------------------------------------


@pytest.mark.parametrize("event_id", sorted(EVENTS))
def test_every_authored_line_passes_the_output_policy(event_id):
    for band in ("SPROUT", "PATHFINDER", "EXPLORER"):
        assert boundary_violations(castle_events.turn_for(EVENTS[event_id], band)["spokenText"]) == []
