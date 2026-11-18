"""Quill flavour in the castle through the `npc_hint` route (SC-R09-02). Fake model only."""

import json

import pytest

from apps.ai.models import AIInteractionAudit, SafetyEvent
from apps.ai.providers import override_model_client
from apps.ai.providers.base import ProviderTimeout
from apps.ai.providers.fake import FakeModelClient
from apps.npcs.castle_flavour import ALLOWED_TOPIC, QUILL, authored_line, quill_flavour
from apps.npcs.models import NpcDialogueNode, NpcPersona, PersonaStatus
from apps.npcs.publishing import publish
from apps.npcs.vocabulary import DialogueMode
from apps.regions import castle_events

from .helpers import make_character, make_dialogue, make_placement, make_staff

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

EVENT = next(e for e in castle_events.CATALOG if e["id"] == "quill-hums-in-hall")
AUTHORED = authored_line(EVENT, "PATHFINDER")
PROMPT = "You are Keeper Quill, a kind keeper of stories who speaks softly."
GOOD = "Keeper Quill hums while the shelves settle."


@pytest.fixture
def fake():
    installed = []

    def install(*responses):
        client = FakeModelClient(responses)
        context = override_model_client(client)
        context.__enter__()
        installed.append(context)
        return client

    yield install
    for context in reversed(installed):
        context.__exit__(None, None, None)


def publish_quill(mode=DialogueMode.HYBRID, *, persona=True, **fields):
    character = make_character(QUILL)
    character.dialogue_mode = mode
    character.save()
    make_placement(character)
    dialogue = make_dialogue(character)
    NpcDialogueNode.objects.filter(dialogue=dialogue, node_key="greet").update(
        allow_ai_hint=mode != DialogueMode.AUTHORED, allowed_topic=ALLOWED_TOPIC
    )
    if persona:
        values = {
            "character": character,
            "version": 1,
            "status": PersonaStatus.APPROVED,
            "personality_prompt": PROMPT,
            "permitted_topics": [ALLOWED_TOPIC],
            "max_response_chars": 120,
            "fallback_lines": ["Persona fallback."],
        }
        values.update(fields)
        NpcPersona.objects.create(**values)
    publish(make_staff())
    return character


def test_a_published_quill_persona_voices_the_line_through_the_npc_hint_route(families, fake):
    publish_quill()
    model = fake({"spokenText": GOOD, "safetyDisposition": "ALLOW"})
    hint = quill_flavour(families.a1, EVENT)
    assert (hint.text, hint.source) == (GOOD, "AI")
    row = AIInteractionAudit.objects.get(child=families.a1)
    assert (row.route_name, row.input_category) == ("generateNpcHint", "NPC_HINT")
    stored = json.dumps({f.name: str(getattr(row, f.attname)) for f in row._meta.fields})
    assert GOOD not in stored and AUTHORED not in stored
    # The model saw the persona, the topic and the authored line, and nothing from a child.
    (request,) = model.requests
    sent = request.content[0].text
    for expected in (PROMPT, ALLOWED_TOPIC, AUTHORED, "PATHFINDER"):
        assert expected in sent
    for forbidden in ("Zinnia", str(families.a1.pk), "Secret-Interest"):
        assert forbidden not in sent
    assert request.content[1].guarded and not request.content[1].untrusted


@pytest.mark.parametrize(
    ("reply", "category"),
    [
        ("x" * 400, None),  # over the band's length limit
        ("Read more at https://example.com now.", None),
        ("Tell me your home address and your name.", None),
        ("You earned a new star! Keeper Quill hums happily.", None),
        ("Keeper Quill hums — a lovely tune.", None),
        ("This is our little secret, okay?", "npc-output-secrecy"),
    ],
)
def test_an_unsafe_reply_shows_the_authored_line(families, fake, reply, category):
    publish_quill()
    fake({"spokenText": reply, "safetyDisposition": "ALLOW"})
    hint = quill_flavour(families.a1, EVENT)
    assert (hint.text, hint.source) == (AUTHORED, "FALLBACK")
    assert AIInteractionAudit.objects.get(child=families.a1).validation_status == "INVALID_CONTENT"
    if category:
        assert SafetyEvent.objects.get().category == category


def test_a_provider_failure_shows_the_authored_line(families, fake):
    publish_quill()
    fake(ProviderTimeout())
    assert quill_flavour(families.a1, EVENT).text == AUTHORED


def test_the_reply_is_capped_to_the_age_band(families, fake):
    publish_quill()
    families.a1.age_band = "SPROUT"
    families.a1.save()
    fake({"spokenText": "y" * 130, "safetyDisposition": "ALLOW"})
    hint = quill_flavour(families.a1, EVENT)
    assert hint.source == "FALLBACK" and hint.text == authored_line(EVENT, "SPROUT")


@pytest.mark.parametrize("off", ["ai", "authored-mode", "no-release", "other-npc"])
def test_no_model_is_called_unless_a_published_persona_allows_it(families, fake, off):
    event = EVENT
    if off == "no-release":
        pass
    elif off == "authored-mode":
        publish_quill(DialogueMode.AUTHORED)
    elif off == "other-npc":
        publish_quill()
        event = next(e for e in castle_events.CATALOG if e["npcId"] == "ember-dragon")
    else:
        publish_quill()
        families.a1.ai_enabled = False
        families.a1.save()
    model = fake()
    hint = quill_flavour(families.a1, event)
    assert hint.source == "FALLBACK" and hint.text == authored_line(event, "PATHFINDER")
    assert model.requests == []
    assert not AIInteractionAudit.objects.exists()


def test_flavour_writes_no_gameplay_state(families, fake):
    from apps.progression.models import NpcRelationship, WorldChange
    from apps.npcs.models import NpcConversationState

    publish_quill()
    fake({"spokenText": GOOD, "safetyDisposition": "ALLOW"})
    quill_flavour(families.a1, EVENT)
    assert not WorldChange.objects.exists() and not NpcRelationship.objects.exists()
    assert not NpcConversationState.objects.exists()
