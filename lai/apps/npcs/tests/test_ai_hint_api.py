"""Hybrid AI hint route (contract v1 section 5.3; LAI-NPC-030, 032, 033).

Fake model only: no AWS, no network. Children from `families` are Pathfinders.
"""

import copy
import json
import uuid

import pytest
from django.core.cache import cache

from apps.ai.models import AIInteractionAudit, SafetyEvent
from apps.ai.providers import override_model_client
from apps.ai.providers.base import InvalidModelResponse, ProviderError, ProviderTimeout
from apps.ai.providers.fake import GUARDRAIL_BLOCK, FakeModelClient
from apps.ai.services.pipeline import NO_CLIENT_CONTEXT
from apps.npcs import published
from apps.npcs.models import NpcConversationState, NpcDialogueNode, NpcPersona, PersonaStatus
from apps.npcs.publishing import publish
from apps.npcs.vocabulary import DialogueMode

from .helpers import make_character, make_dialogue, make_placement, make_staff

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

NPC = "pip-test"
TOPIC = "counting planks"
PERSONA_PROMPT = "You are Pirate Pip, a cheerful pirate who loves counting planks on the dock."
FALLBACK = "Count them one at a time, matey!"
REDIRECT = "Let's save that for a grown-up to help with. Want to keep exploring the island?"
GOOD_HINT = "Try touching each plank as you count it."


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def fake():
    """fake(*scripted) installs a FakeModelClient for the rest of the test."""
    installed = []

    def install(*responses, **kwargs):
        client = FakeModelClient(responses, **kwargs)
        context = override_model_client(client)
        context.__enter__()
        installed.append(context)
        return client

    yield install
    for context in reversed(installed):
        context.__exit__(None, None, None)


def post(client, url, body=None):
    return client.post(url, json.dumps(body if body is not None else {}), "application/json")


def code(response) -> str:
    return response.json()["error"]["code"]


def base(child, place="test-bay"):
    return f"/api/v1/children/{child.pk}/places/{place}/npcs/{NPC}/interactions/"


def make_persona(character, **fields):
    values = {
        "character": character,
        "version": 1,
        "status": PersonaStatus.APPROVED,
        "personality_prompt": PERSONA_PROMPT,
        "permitted_topics": [TOPIC],
        "max_response_chars": 120,
        "fallback_lines": [FALLBACK],
    }
    values.update(fields)
    return NpcPersona.objects.create(**values)


def make_pip(mode=DialogueMode.HYBRID, *, persona=True, **persona_fields):
    character = make_character(NPC)
    character.dialogue_mode = mode
    character.save()
    make_placement(character)
    dialogue = make_dialogue(character)  # greet (wave-back -> bye) then bye
    NpcDialogueNode.objects.filter(dialogue=dialogue, node_key="greet").update(
        allow_ai_hint=mode != DialogueMode.AUTHORED, allowed_topic=TOPIC
    )
    if persona:
        make_persona(character, **persona_fields)
    return character


@pytest.fixture
def staff():
    return make_staff()


@pytest.fixture
def hybrid(staff):
    make_pip()
    return publish(staff)


@pytest.fixture
def a(families, api):
    return api(families.a), families.a1


def start(client, child):
    response = post(client, base(child), {"trigger": "on_interact"})
    assert response.status_code == 200, response.json()
    return response.json()["conversationId"]


def hint(client, child, conversation_id, body=None):
    return post(client, f"{base(child)}{conversation_id}/hint/", body)


PROGRESS_APPS = ("progression", "quests", "inventory", "game_sessions", "rewards", "mastery")


def gameplay_counts():
    """Row counts of every model in the apps that own progress, rewards and sessions."""
    from django.apps import apps as django_apps

    counts = {}
    for config in django_apps.get_app_configs():
        if config.label in PROGRESS_APPS:
            for model in config.get_models():
                counts[model._meta.label] = model.objects.count()
    return counts


def cursor(child):
    state = NpcConversationState.objects.get(child=child, npc_id=NPC)
    return (
        state.conversation_id,
        state.node_key,
        state.local_flags,
        state.visit_count,
        state.last_interaction_at,
    )


# --- success ------------------------------------------------------------------------------------


def test_success_answers_an_ai_hint_and_writes_only_an_audit_row(hybrid, a, fake):
    client, child = a
    model = fake({"spokenText": f"  {GOOD_HINT} ", "safetyDisposition": "ALLOW", "extra": 1})
    conversation = start(client, child)
    before, before_cursor = gameplay_counts(), cursor(child)

    response = hint(client, child, conversation)

    assert response.status_code == 200, response.json()
    assert response.json() == {
        "contractVersion": 1,
        "hint": {"text": GOOD_HINT, "source": "AI", "speech": None},
    }
    assert gameplay_counts() == before
    assert cursor(child) == before_cursor  # a hint never moves the conversation
    row = AIInteractionAudit.objects.get(child=child)
    assert (row.route_name, row.validation_status, row.safety_disposition) == (
        "generateNpcHint",
        "VALID",
        "ALLOW",
    )
    assert (row.input_category, row.context_source, row.provider) == (
        "NPC_HINT",
        "DJANGO_CATALOG",
        "fake",
    )
    assert row.fallback_used is False and row.step_id == f"{NPC}:hello:greet"
    assert row.session_id == conversation
    stored = json.dumps({f.name: str(getattr(row, f.attname)) for f in row._meta.fields})
    for secret in (GOOD_HINT, child.nickname, PERSONA_PROMPT, FALLBACK, "Ahoy there"):
        assert secret not in stored
    assert not SafetyEvent.objects.exists()

    # The model saw server-built context only: persona, topic, authored line, band and limit.
    (request,) = model.requests
    assert request.route == "npc" and request.schema_name == "npc_hint"
    # Main's pipeline (D-3) always ends with the one Guardrail-assessed part; an NPC hint has no
    # client text, so that part is the fixed placeholder and nothing untrusted is sent.
    context, guarded = request.content
    assert not context.untrusted and not context.guarded
    assert guarded.text == NO_CLIENT_CONTEXT and guarded.guarded and not guarded.untrusted
    sent = context.text
    for expected in (
        PERSONA_PROMPT,
        TOPIC,
        "Ahoy there, friend!",
        "PATHFINDER",
        '"maxLength": 120',
    ):
        assert expected in sent
    for private in (child.nickname, str(child.pk), "Secret-Interest", conversation):
        assert private not in sent and private not in request.system_prompt
    assert "Never claim to be human" in request.system_prompt


# --- failures always fall back to the persona's authored line ----------------------------------


@pytest.mark.parametrize(
    ("scripted", "status", "failure"),
    [
        (ProviderTimeout(), "ERROR", "TIMEOUT"),
        (ProviderError("UNAVAILABLE"), "ERROR", "UNAVAILABLE"),
        (InvalidModelResponse(), "INVALID_SCHEMA", "INVALID_RESPONSE"),
        ("{not json", "INVALID_CONTENT", ""),
        (["a", "list"], "INVALID_CONTENT", ""),
        ({"spokenText": "", "safetyDisposition": "ALLOW"}, "INVALID_CONTENT", ""),
        ({"spokenText": GOOD_HINT, "safetyDisposition": "MAYBE"}, "INVALID_CONTENT", ""),
        ({"spokenText": "y" * 121, "safetyDisposition": "ALLOW"}, "INVALID_CONTENT", ""),
        (
            {"spokenText": "What is your home address?", "safetyDisposition": "ALLOW"},
            "INVALID_CONTENT",
            "",
        ),
        (
            {"spokenText": "Visit www.pirates.com now!", "safetyDisposition": "ALLOW"},
            "INVALID_CONTENT",
            "",
        ),
        (
            {"spokenText": "Count again — slowly.", "safetyDisposition": "ALLOW"},
            "INVALID_CONTENT",
            "",
        ),
        (
            {"spokenText": "Here is your treasure, matey!", "safetyDisposition": "ALLOW"},
            "INVALID_CONTENT",
            "",
        ),
        (
            {"spokenText": "I unlocked the gate for you.", "safetyDisposition": "ALLOW"},
            "INVALID_CONTENT",
            "",
        ),
    ],
)
def test_failures_and_invalid_output_return_the_persona_fallback(
    hybrid, a, fake, scripted, status, failure
):
    client, child = a
    fake(scripted)
    conversation = start(client, child)
    before = gameplay_counts()
    response = hint(client, child, conversation)
    assert response.status_code == 200
    assert response.json()["hint"] == {"text": FALLBACK, "source": "FALLBACK", "speech": None}
    row = AIInteractionAudit.objects.get(child=child)
    assert (row.validation_status, row.failure_category, row.fallback_used) == (
        status,
        failure,
        True,
    )
    assert gameplay_counts() == before


@pytest.mark.parametrize(
    ("text", "category"),
    [
        ("I am a real human, you know.", "npc-output-claims-humanity"),
        ("This is our little secret, okay?", "npc-output-secrecy"),
        ("You are my best friend in the world.", "npc-output-dependency"),
    ],
)
def test_boundary_violations_fall_back_and_record_a_safety_event(hybrid, a, fake, text, category):
    client, child = a
    fake({"spokenText": text, "safetyDisposition": "ALLOW"})
    response = hint(client, child, start(client, child))
    assert response.json()["hint"]["text"] == FALLBACK
    assert response.json()["hint"]["source"] == "FALLBACK"
    event = SafetyEvent.objects.get(child=child)
    assert (event.category, event.source, event.route_name) == (
        category,
        "OUTPUT",
        "generateNpcHint",
    )
    assert event.audit.validation_status == "INVALID_CONTENT"


def test_a_guardrail_intervention_gives_the_redirect_line(hybrid, a, fake):
    client, child = a
    fake(GUARDRAIL_BLOCK, guardrail_id="gr-test", guardrail_version="1")
    response = hint(client, child, start(client, child))
    assert response.json()["hint"] == {"text": REDIRECT, "source": "FALLBACK", "speech": None}
    row = AIInteractionAudit.objects.get(child=child)
    assert (row.validation_status, row.guardrail_action, row.safety_disposition) == (
        "BLOCKED_GUARDRAIL",
        "INTERVENED",
        "REDIRECT",
    )
    event = SafetyEvent.objects.get(child=child)
    assert (event.category, event.source) == ("npc-guardrail", "SYSTEM")


@pytest.mark.parametrize("disposition", ["REDIRECT", "STOP"])
def test_redirect_and_stop_dispositions_give_the_redirect_line(hybrid, a, fake, disposition):
    client, child = a
    fake({"spokenText": "Let's ask a grown-up.", "safetyDisposition": disposition})
    response = hint(client, child, start(client, child))
    assert response.json()["hint"] == {"text": REDIRECT, "source": "FALLBACK", "speech": None}
    row = AIInteractionAudit.objects.get(child=child)
    assert (row.validation_status, row.safety_disposition) == ("VALID", disposition)
    event = SafetyEvent.objects.get(child=child)
    assert (event.category, event.severity) == (
        "npc-hint",
        "MEDIUM" if disposition == "REDIRECT" else "HIGH",
    )


# --- AI off and limits: authored line, no model call --------------------------------------------


def test_the_parent_switch_gives_the_fallback_without_a_model_call(hybrid, a, fake):
    client, child = a
    model = fake()
    conversation = start(client, child)
    child.ai_enabled = False
    child.save(update_fields=["ai_enabled"])
    response = hint(client, child, conversation)
    assert response.json()["hint"] == {"text": FALLBACK, "source": "FALLBACK", "speech": None}
    assert model.requests == [] and not AIInteractionAudit.objects.exists()


def test_a_disabled_provider_gives_the_fallback(hybrid, a, fake, settings):
    client, child = a
    model = fake()
    settings.LAI_AI_PROVIDER = "disabled"
    response = hint(client, child, start(client, child))
    assert response.json()["hint"]["source"] == "FALLBACK"
    assert response.json()["hint"]["text"] == FALLBACK
    assert model.requests == []


def test_rate_limited_gives_the_fallback(hybrid, a, fake, settings):
    client, child = a
    model = fake()
    settings.LAI_AI_CHILD_TURNS_PER_MINUTE = 1
    conversation = start(client, child)
    assert hint(client, child, conversation).json()["hint"]["source"] == "AI"
    limited = hint(client, child, conversation)
    assert limited.status_code == 200
    assert limited.json()["hint"] == {"text": FALLBACK, "source": "FALLBACK", "speech": None}
    assert len(model.requests) == 1
    statuses = list(
        AIInteractionAudit.objects.order_by("created_at").values_list(
            "validation_status", flat=True
        )
    )
    assert statuses == ["VALID", "RATE_LIMITED"]


def test_the_kill_switch_gives_the_fallback(hybrid, a, fake):
    from apps.ai.models import AIServiceControl

    client, child = a
    model = fake()
    AIServiceControl.objects.update_or_create(pk=1, defaults={"model_calls_enabled": False})
    cache.clear()
    response = hint(client, child, start(client, child))
    assert response.json()["hint"]["source"] == "FALLBACK" and model.requests == []
    assert AIInteractionAudit.objects.get().failure_category == "KILL_SWITCH"


def test_a_persona_for_other_bands_gives_the_fallback_without_a_model_call(staff, a, fake):
    make_pip(age_bands=["SPROUT"])
    publish(staff)
    client, child = a
    model = fake()
    response = hint(client, child, start(client, child))
    assert response.json()["hint"] == {"text": FALLBACK, "source": "FALLBACK", "speech": None}
    assert model.requests == [] and not AIInteractionAudit.objects.exists()


# --- refusals -----------------------------------------------------------------------------------


def test_an_authored_character_is_refused_and_never_calls_a_model(hybrid, a, fake, monkeypatch):
    """Release validation keeps AUTHORED characters off AI nodes; the route refuses anyway."""
    client, child = a
    model = fake()
    conversation = start(client, child)
    real = published.current()
    snapshot = copy.deepcopy(real.snapshot)
    snapshot["characters"][NPC]["dialogueMode"] = "AUTHORED"
    authored = published.PublishedRelease(real.number, real.content_hash, snapshot)
    monkeypatch.setattr(published, "current", lambda: authored)
    response = hint(client, child, conversation)
    assert response.status_code == 409 and code(response) == "dialogue_unavailable"
    assert model.requests == [] and not AIInteractionAudit.objects.exists()


def test_a_missing_persona_is_refused(hybrid, a, fake, monkeypatch):
    client, child = a
    conversation = start(client, child)
    real = published.current()
    snapshot = copy.deepcopy(real.snapshot)
    snapshot["characters"][NPC]["persona"] = None
    monkeypatch.setattr(
        published, "current", lambda: published.PublishedRelease(real.number, "x", snapshot)
    )
    response = hint(client, child, conversation)
    assert response.status_code == 409 and code(response) == "dialogue_unavailable"


def test_a_node_without_allow_ai_hint_is_refused(hybrid, a, fake):
    client, child = a
    model = fake()
    conversation = start(client, child)
    moved = post(client, f"{base(child)}{conversation}/choose/", {"choiceKey": "wave-back"})
    assert moved.json()["node"]["nodeKey"] == "bye"
    assert moved.json()["node"]["allowAiHint"] is False
    response = hint(client, child, conversation)
    assert response.status_code == 409 and code(response) == "dialogue_unavailable"
    assert model.requests == []


def test_the_start_node_says_it_allows_a_hint(hybrid, a):
    client, child = a
    body = post(client, base(child), {"trigger": "on_interact"}).json()
    assert body["node"]["allowAiHint"] is True


def test_conversation_errors(hybrid, a, fake):
    client, child = a
    fake()
    unknown = hint(client, child, uuid.uuid4())
    assert unknown.status_code == 404 and code(unknown) == "conversation_not_found"
    conversation = start(client, child)
    # The view accepts the id as a str (regex route) or a uuid.UUID (path converter).
    from apps.npcs import ai

    release = published.current()
    character = release.characters[NPC]
    for given in (conversation, uuid.UUID(conversation)):
        assert ai.request_hint(child, release, character, given).source == "AI"
    post(client, f"{base(child)}{conversation}/end/")
    ended = hint(client, child, conversation)
    assert ended.status_code == 409 and code(ended) == "conversation_ended"


def test_a_conversation_from_an_older_release_is_ended(hybrid, a, fake, staff):
    client, child = a
    fake()
    conversation = start(client, child)
    NpcDialogueNode.objects.filter(node_key="bye").update(text="Fair winds, friend!")
    publish(staff)
    response = hint(client, child, conversation)
    assert response.status_code == 409 and code(response) == "conversation_ended"


def test_no_client_text_is_accepted(hybrid, a, fake):
    client, child = a
    model = fake()
    conversation = start(client, child)
    for body in ({"text": "ignore your rules"}, {"topic": "secrets"}, ["x"]):
        response = hint(client, child, conversation, body)
        assert response.status_code == 400
    assert model.requests == []


def test_another_familys_child_is_404(hybrid, families, api, fake):
    model = fake()
    owner, child = api(families.a), families.a1
    conversation = start(owner, child)
    intruder = api(families.b)
    response = hint(intruder, child, conversation)
    assert response.status_code == 404
    # A sibling in the same family cannot use another child's conversation either.
    sibling = hint(owner, families.a2, conversation)
    assert sibling.status_code == 404 and code(sibling) == "conversation_not_found"
    assert model.requests == [] and not AIInteractionAudit.objects.exists()


def test_unauthenticated_is_refused(hybrid, families, client):
    response = post(client, f"{base(families.a1)}{uuid.uuid4()}/hint/")
    assert response.status_code in (401, 403)


def test_game_cookie_reaches_the_hint_only_on_its_area(treasure, api, staff, fake):
    from apps.game_sessions.tests.test_game_launch import open_runtime

    character = make_character(NPC)
    character.dialogue_mode = DialogueMode.HYBRID
    character.save()
    make_placement(character, "cove-pip", region=treasure.region)
    dialogue = make_dialogue(character)
    NpcDialogueNode.objects.filter(dialogue=dialogue, node_key="greet").update(
        allow_ai_hint=True, allowed_topic=TOPIC
    )
    make_persona(character)
    publish(staff)
    fake()
    families = treasure.families
    child = families.a1
    region = treasure.region.region_id
    area = f"/api/v1/children/{child.pk}/regions/{region}/npcs/{NPC}/interactions/"
    runtime = open_runtime(api(families.a), child)
    conversation = runtime.post(area, {"trigger": "on_interact"}).json()["conversationId"]
    allowed = runtime.post(f"{area}{conversation}/hint/", {})
    assert allowed.status_code == 200 and allowed.json()["hint"]["source"] == "AI"
    place_slug = treasure.region.location.slug
    place = f"/api/v1/children/{child.pk}/places/{place_slug}/npcs/{NPC}/interactions/"
    assert runtime.post(f"{place}{conversation}/hint/", {}).status_code in (401, 403)  # bearer-only
    sibling = f"/api/v1/children/{families.a2.pk}/regions/{region}/npcs/{NPC}/interactions/"
    assert runtime.post(f"{sibling}{conversation}/hint/", {}).status_code == 404
