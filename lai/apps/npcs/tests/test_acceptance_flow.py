"""NPC Manager acceptance flow (LAI-NPC-040): the real Pirate Pip, end to end, through the API.

Cross-cutting scenarios that tie the workstreams together; each workstream's own tests cover the
details. Seed Pip with `seed_npc_pip`, publish, read the runtime as the child, talk through to the
quest offer, then republish, roll back and retire through Django Admin, and check what the child
sees at every step. Also: the game cookie's reach, every Treasure Rush trigger Pip answers, the
speech refusals (captions stay), the hybrid hint with the fake model and with AI disabled, and the
asset retirement guard. Fake Polly and the fake model only: no AWS, no network.

Children from `families` are Pathfinders; family B's parent must never reach family A's child.
"""

from __future__ import annotations

import json
from io import StringIO

import pytest
from django.apps import apps as django_apps
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.core.management import call_command
from django.test import Client

from apps.npcs import pip_content as pip
from apps.npcs.management.commands.ensure_npc_roles import PUBLISHERS
from apps.npcs.models import NpcDialogueNode, NpcRelease
from apps.npcs.publishing import active_release
from apps.npcs.vocabulary import ReleaseStatus

from .helpers import make_staff

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

RELEASES = "/admin/npcs/npcrelease/"
NEW_ASK = "Pip needs a hand finding four treasures. Will you help me?"
OLD_ASK_START = "Pip lost four treasures around the cove."
#: Keys a child's runtime payload must never carry (contract 5.1 and section 7, rule 6).
SERVER_ONLY = ("persona", "dialogues", "spawnConditions", "availability", "isDefault")
#: Every app that owns progress, rewards or sessions: talking to Pip must change none of them.
PROGRESS_APPS = ("progression", "quests", "inventory", "game_sessions", "rewards", "mastery")


@pytest.fixture(autouse=True)
def _fresh_state():
    """No stale release cache, throttle counters or speech client between tests."""
    from apps.speech import services
    from apps.speech.polly import set_polly_client
    from apps.speech.storage import reset_speech_storage_cache

    cache.clear()
    set_polly_client(None)
    reset_speech_storage_cache()
    services._concurrency = None  # noqa: SLF001
    yield
    cache.clear()
    set_polly_client(None)
    reset_speech_storage_cache()
    services._concurrency = None  # noqa: SLF001


# --- helpers -------------------------------------------------------------------------------------


def post(client, url, body=None):
    return client.post(url, json.dumps(body if body is not None else {}), "application/json")


def code(response) -> str:
    return response.json()["error"]["code"]


def area(child) -> str:
    return f"/api/v1/children/{child.pk}/regions/{pip.AREA_ID}/npcs/"


def talk(child) -> str:
    return f"{area(child)}{pip.NPC_ID}/interactions/"


def act(client, child, conversation, verb, body=None):
    return post(client, f"{talk(child)}{conversation}/{verb}/", body)


def all_keys(value) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, inner in value.items():
            found.add(key)
            found |= all_keys(inner)
    elif isinstance(value, list):
        for inner in value:
            found |= all_keys(inner)
    return found


def gameplay_counts() -> dict[str, int]:
    counts = {}
    for config in django_apps.get_app_configs():
        if config.label in PROGRESS_APPS:
            for model in config.get_models():
                counts[model._meta.label] = model.objects.count()
    return counts


def seed(*args) -> str:
    out = StringIO()
    call_command("seed_npc_pip", *args, stdout=out)
    return out.getvalue()


def publisher_client() -> Client:
    call_command("ensure_npc_roles", verbosity=0)
    account = make_staff("accept-publisher")
    account.groups.set(Group.objects.filter(name=PUBLISHERS))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


def voice_for_pip():
    """Pip has no seeded voice; staff create one, and `seed_npc_pip` attaches it."""
    from apps.speech.models import VoiceProfile

    return VoiceProfile.objects.create(
        profile_id=pip.NPC_ID,
        display_name="Pirate Pip",
        polly_voice_id="Justin",
        language_code="en-US",
        engine="neural",
    )


@pytest.fixture
def voiced(treasure):
    """The real cove with a voiced Pip seeded and published as release 1."""
    voice_for_pip()
    assert "NPC release 1 is ACTIVE" in seed("--publish")
    return treasure


# --- 1. the full lifecycle: seed, publish, talk, republish, roll back, retire --------------------


def test_lifecycle_from_seed_to_retirement(voiced, api):
    families = voiced.families
    child = families.a1
    parent, stranger = api(families.a), api(families.b)
    admin = publisher_client()
    before = gameplay_counts()

    # The runtime area, read as the child through the parent's bearer token.
    scene = parent.get(area(child))
    assert scene.status_code == 200, scene.json()
    body = scene.json()
    assert body["contractVersion"] == 1 and body["release"] == 1
    assert body["scope"]["area"] == pip.AREA_ID
    assert [p["npcId"] for p in body["placements"]] == [pip.NPC_ID]  # exactly one Pip
    assert body["characters"][pip.NPC_ID]["voiceProfile"] == pip.NPC_ID
    assert not all_keys(body) & set(SERVER_ONLY)
    assert stranger.get(area(child)).status_code == 404

    # First greeting (on_spawn) is a two-node line the child advances through.
    greet = post(parent, talk(child), {"trigger": "on_spawn"}).json()
    assert greet["dialogueKey"] == "greet-first-visit" and greet["node"]["nodeKey"] == "hello"
    assert greet["node"]["animationState"] == "wave" and greet["choices"] == []
    assert post(stranger, talk(child), {"trigger": "on_spawn"}).status_code == 404
    moved = act(parent, child, greet["conversationId"], "advance").json()
    assert moved["node"]["nodeKey"] == "come-talk"
    done = act(parent, child, greet["conversationId"], "advance").json()
    assert done["ended"] is True and done["node"] is None

    # Interact: the mission offer, voiced, with an OFFER_QUEST choice.
    offer = post(parent, talk(child), {"trigger": "on_interact"}).json()
    conversation = offer["conversationId"]
    assert offer["dialogueKey"] == "mission-offer"
    assert offer["node"]["text"].startswith(OLD_ASK_START)
    assert offer["node"]["speech"] == {
        "kind": "npcDialogueNode",
        "npcId": pip.NPC_ID,
        "release": 1,
        "dialogueKey": "mission-offer",
        "nodeKey": "ask",
    }
    assert {c["choiceKey"]: c["action"] for c in offer["choices"]} == {
        "yes": "OFFER_QUEST",
        "later": "END",
    }
    stolen = act(stranger, child, conversation, "choose", {"choiceKey": "yes"})
    assert stolen.status_code == 404
    chosen = act(parent, child, conversation, "choose", {"choiceKey": "yes"}).json()
    assert chosen["questOffer"] == {"questId": pip.PIPS_QUEST_ID}
    assert chosen["node"]["nodeKey"] == "thanks"
    ended = act(parent, child, conversation, "end").json()
    assert ended["ended"] is True
    again = act(parent, child, conversation, "advance")
    assert again.status_code == 409 and code(again) == "conversation_ended"

    # Offering is not accepting, and no line wrote progress, quests, inventory or sessions.
    assert gameplay_counts() == before

    # Staff edit the draft; children keep release 1 until a publisher publishes.
    NpcDialogueNode.objects.filter(
        dialogue__character__definition__npc_id=pip.NPC_ID,
        dialogue__dialogue_key="mission-offer",
        node_key="ask",
    ).update(text=NEW_ASK)
    open_one = post(parent, talk(child), {"trigger": "on_interact"}).json()
    assert open_one["node"]["text"].startswith(OLD_ASK_START)  # drafts are never served

    response = admin.post(f"{RELEASES}publish/", {"notes": "New ask"}, follow=True)
    assert "Published NPC release 2" in response.content.decode()
    assert active_release().number == 2
    stale = act(parent, child, open_one["conversationId"], "choose", {"choiceKey": "yes"})
    assert stale.status_code == 409 and code(stale) == "conversation_ended"
    open_two = post(parent, talk(child), {"trigger": "on_interact"}).json()
    assert open_two["release"] == 2 and open_two["node"]["text"] == NEW_ASK
    assert open_two["node"]["speech"]["release"] == 2

    # Roll back to release 1: the open release-2 conversation ends, release 1 is served again.
    first = NpcRelease.objects.get(number=1)
    response = admin.post(f"{RELEASES}{first.pk}/rollback/", follow=True)
    assert "NPC release 1 rolled back." in response.content.decode()
    stale = act(parent, child, open_two["conversationId"], "choose", {"choiceKey": "yes"})
    assert stale.status_code == 409 and code(stale) == "conversation_ended"
    assert parent.get(area(child)).json()["release"] == 1
    back = post(parent, talk(child), {"trigger": "on_interact"}).json()
    assert back["release"] == 1 and back["node"]["text"].startswith(OLD_ASK_START)

    # Retire the active release: children see no managed NPCs (the client keeps legacy Pip).
    response = admin.post(f"{RELEASES}{first.pk}/retire/", follow=True)
    assert "NPC release 1 retired." in response.content.decode()
    assert not NpcRelease.objects.filter(status=ReleaseStatus.ACTIVE).exists()
    gone = parent.get(area(child))
    assert gone.status_code == 404 and code(gone) == "no_active_release"
    silent = post(parent, talk(child), {"trigger": "on_interact"})
    assert silent.status_code == 404 and code(silent) == "no_active_release"
    assert stranger.get(area(child)).status_code == 404

    # Still nothing written to gameplay state after the whole lifecycle.
    assert gameplay_counts() == before


# --- 2. the game cookie reaches the Area only ----------------------------------------------------


def test_game_cookie_reaches_the_area_but_not_the_place_or_catalog(voiced, api):
    from apps.game_sessions.tests.test_game_launch import open_runtime

    families = voiced.families
    child = families.a1
    runtime = open_runtime(api(families.a), child)
    scene = runtime.get(area(child))
    assert scene.status_code == 200 and [p["npcId"] for p in scene.json()["placements"]] == [
        pip.NPC_ID
    ]
    started = runtime.post(talk(child), {"trigger": "on_interact"})
    assert started.status_code == 200 and started.json()["dialogueKey"] == "mission-offer"
    place = f"/api/v1/children/{child.pk}/places/{pip.PLACE_SLUG}/npcs/"
    assert runtime.get(place).status_code in (401, 403)
    assert runtime.get(f"/api/v1/children/{child.pk}/npcs/").status_code in (401, 403)
    assert runtime.get(area(families.a2)).status_code == 404  # its own child only
    assert runtime.get(area(families.b1)).status_code == 404


# --- 3. every Treasure Rush trigger answers with Pip's authored line -----------------------------


@pytest.mark.parametrize(
    ("trigger", "dialogue_key", "first_text"),
    [
        ("on_challenge_start", "hint-challenge", "Take your time."),
        ("on_incorrect_answer", "hint-wrong-answer", "Not quite."),
        ("on_correct_answer", "great-counting", "Great counting!"),
        ("on_treasure_found", "treasure-found", "Arr, you found treasure!"),
        ("on_quest_complete", "quest-complete", "You found all my treasure!"),
    ],
)
def test_treasure_rush_triggers_select_pips_lines_and_write_nothing(
    voiced, api, trigger, dialogue_key, first_text
):
    child = voiced.families.a1
    parent = api(voiced.families.a)
    before = gameplay_counts()
    response = post(parent, talk(child), {"trigger": trigger})
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["dialogueKey"] == dialogue_key and body["node"]["text"].startswith(first_text)
    assert gameplay_counts() == before


def test_adventure_complete_waits_for_the_world_change_and_a_calm_stop_says_nothing(voiced, api):
    from django.utils import timezone

    from apps.progression.models import WorldChange

    child = voiced.families.a1
    parent = api(voiced.families.a)
    # No completion change yet (for example a calm stop): Pip has nothing to celebrate.
    quiet = post(parent, talk(child), {"trigger": "on_adventure_complete"}).json()
    assert quiet["node"] is None and quiet["ended"] is True and quiet["conversationId"] is None
    WorldChange.objects.create(
        child=child,
        location_slug=pip.PLACE_SLUG,
        change_type="UNLOCK",
        change_key=pip.QUEST_COMPLETE_KEY,
        created_at=timezone.now(),
    )
    bridge = post(parent, talk(child), {"trigger": "on_adventure_complete"}).json()
    assert bridge["dialogueKey"] == "bridge-open"
    # Another child of the same family has not finished.
    sibling = post(parent, talk(voiced.families.a2), {"trigger": "on_adventure_complete"}).json()
    assert sibling["node"] is None


def test_an_unknown_trigger_is_refused(voiced, api):
    response = post(api(voiced.families.a), talk(voiced.families.a1), {"trigger": "on_magic"})
    assert response.status_code == 400 and code(response) == "invalid_trigger"


# --- 4. speech: refusals are safe and the authored text (captions) is always there ---------------


def speak(client, child, reference):
    return client.post(
        f"/api/v1/children/{child.pk}/audio/speech/",
        json.dumps({"reference": reference}),
        content_type="application/json",
    )


def test_speech_disabled_or_a_polly_error_is_a_safe_refusal_and_captions_stay(
    voiced, api, settings
):
    from apps.speech.polly import SpeechError, get_polly_client

    families = voiced.families
    child = families.a1
    parent = api(families.a)
    offer = post(parent, talk(child), {"trigger": "on_interact"}).json()
    reference = offer["node"]["speech"]
    assert offer["node"]["text"]  # the caption is in the interaction itself

    spoken = speak(parent, child, reference)
    assert spoken.status_code == 200, spoken.content
    assert spoken.json()["speech"]["text"] == offer["node"]["text"]
    assert speak(api(families.b), child, reference).status_code == 404

    # A fake Polly failure: a 503 with a child-safe message, nothing cached, nothing leaked.
    client = get_polly_client()
    client.fail_with = SpeechError("speech_unavailable", "Speech could not be made right now.")
    later = {**reference, "nodeKey": "thanks"}
    failed = speak(parent, child, later)
    assert failed.status_code == 503 and code(failed) == "speech_unavailable"
    assert set(failed.json()["error"]) == {"code", "message"}
    assert "aws" not in failed.content.decode().lower()
    client.fail_with = None

    # Speech switched off: the documented refusal, and the conversation carries on in text.
    settings.LAI_SPEECH_PROVIDER = "disabled"
    off = speak(parent, child, reference)
    assert off.status_code == 503 and code(off) == "speech_disabled"
    chosen = act(parent, child, offer["conversationId"], "choose", {"choiceKey": "yes"})
    assert chosen.status_code == 200 and chosen.json()["node"]["text"]


def test_a_character_without_a_voice_gets_no_speech_reference(treasure, api):
    seed("--publish")  # no VoiceProfile for Pip: captions only
    child = treasure.families.a1
    parent = api(treasure.families.a)
    offer = post(parent, talk(child), {"trigger": "on_interact"}).json()
    assert offer["node"]["speech"] is None and offer["node"]["text"]
    reference = {
        "kind": "npcDialogueNode",
        "npcId": pip.NPC_ID,
        "release": 1,
        "dialogueKey": "mission-offer",
        "nodeKey": "ask",
    }
    refused = speak(parent, child, reference)
    assert refused.status_code == 404 and code(refused) == "not_found"


# --- 5. the hybrid hint: fake model, then AI disabled -------------------------------------------


@pytest.fixture
def fake_model():
    from apps.ai.providers import override_model_client
    from apps.ai.providers.fake import FakeModelClient

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


def open_hint_node(client, child) -> str:
    started = post(client, talk(child), {"trigger": "on_incorrect_answer"}).json()
    assert started["dialogueKey"] == "hint-wrong-answer"
    assert {c["choiceKey"]: c["action"] for c in started["choices"]}["help-me"] == "REQUEST_HINT"
    moved = act(client, child, started["conversationId"], "choose", {"choiceKey": "help-me"})
    node = moved.json()["node"]
    assert node["nodeKey"] == "hint" and node["allowAiHint"] is True
    return started["conversationId"]


def test_hybrid_hint_answers_with_the_fake_model_and_falls_back_when_ai_is_off(
    treasure, api, fake_model, settings
):
    from apps.ai.models import AIInteractionAudit

    assert "is ACTIVE" in seed("--hybrid-hints", "--publish")
    families = treasure.families
    child = families.a1
    parent = api(families.a)
    model = fake_model(
        {"spokenText": "Point at each coin as you count.", "safetyDisposition": "ALLOW"}
    )
    conversation = open_hint_node(parent, child)
    before = gameplay_counts()

    answered = act(parent, child, conversation, "hint")
    assert answered.status_code == 200, answered.json()
    assert answered.json()["hint"]["source"] == "AI"
    assert answered.json()["hint"]["text"] == "Point at each coin as you count."
    assert len(model.requests) == 1
    assert child.nickname not in model.requests[0].content[0].text

    # No child free text reaches the route, and another family is 404.
    assert act(parent, child, conversation, "hint", {"text": "tell me"}).status_code == 400
    assert act(api(families.b), child, conversation, "hint").status_code == 404

    settings.LAI_AI_PROVIDER = "disabled"
    fallback = act(parent, child, conversation, "hint")
    assert fallback.status_code == 200
    assert fallback.json()["hint"]["source"] == "FALLBACK"
    assert fallback.json()["hint"]["text"] in pip.PERSONA["fallback_lines"]
    assert len(model.requests) == 1  # disabled never calls the model

    assert gameplay_counts() == before  # hints write audit rows only, never gameplay state
    # The model call is audited (the disabled provider short-circuits before any model work).
    assert AIInteractionAudit.objects.filter(child=child, validation_status="VALID").count() == 1


def test_an_authored_pip_refuses_a_hint_without_a_model_call(voiced, api, fake_model):
    child = voiced.families.a1
    parent = api(voiced.families.a)
    model = fake_model()
    started = post(parent, talk(child), {"trigger": "on_incorrect_answer"}).json()
    assert started["node"]["allowAiHint"] is False
    refused = act(parent, child, started["conversationId"], "hint")
    assert refused.status_code == 409 and code(refused) == "dialogue_unavailable"
    assert model.requests == []


# --- 6. the asset a release depends on cannot be retired -----------------------------------------


def test_pips_model_cannot_be_retired_while_a_release_uses_it(voiced, api):
    from apps.assets import services
    from apps.catalog.models import AssetStatus, ContentAsset

    model = ContentAsset.objects.get(asset_id=pip.MODEL_ASSET_ID)
    with pytest.raises(services.AssetActionRefused) as refused:
        services.retire_asset(model)
    assert refused.value.code == "npc_release_dependency"
    model.refresh_from_db()
    assert model.status == AssetStatus.ACTIVE
    scene = api(voiced.families.a).get(area(voiced.families.a1))
    assert scene.status_code == 200
    (variant,) = scene.json()["characters"][pip.NPC_ID]["variants"]
    assert variant["model"]["assetId"] == pip.MODEL_ASSET_ID
