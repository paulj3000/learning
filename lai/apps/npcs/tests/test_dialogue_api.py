"""Interaction API (contract v1 section 5.2; LAI-NPC-012/013/017).

Children from `families` are Pathfinders. The Place route uses the helpers' `test-bay`; the 3D
Area route uses the real Treasure Cove (`treasure`).
"""

import json
import uuid

import pytest
from django.utils.timezone import now

from apps.catalog.models import Quest
from apps.inventory.models import InventoryItem
from apps.npcs import triggers
from apps.npcs.models import (
    NpcCharacter,
    NpcConversationState,
    NpcDialogue,
    NpcDialogueChoice,
    NpcDialogueNode,
)
from apps.npcs.publishing import publish
from apps.progression.models import NpcRelationship, WorldChange
from apps.quests.models import QuestProgress
from apps.users.models import ChildProfile

from .helpers import (
    content_release,
    make_character,
    make_dialogue,
    make_place,
    make_placement,
    make_staff,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

NPC = "pip-test"


def post(client, url, body=None):
    return client.post(url, json.dumps(body if body is not None else {}), "application/json")


def code(response) -> str:
    return response.json()["error"]["code"]


def place_url(child, npc=NPC, place="test-bay"):
    return f"/api/v1/children/{child.pk}/places/{place}/npcs/{npc}/interactions/"


def build(character, key, nodes, *, start=None, trigger="on_interact", **fields):
    """A dialogue from a compact spec: {nodeKey: {text, next, bands, conds, choices: [...]}}."""
    dialogue = NpcDialogue.objects.create(
        character=character, dialogue_key=key, title=key, trigger=trigger, **fields
    )
    rows = {}
    for order, (node_key, spec) in enumerate(nodes.items()):
        rows[node_key] = NpcDialogueNode.objects.create(
            dialogue=dialogue,
            node_key=node_key,
            text=spec.get("text", f"Line {node_key}."),
            age_bands=spec.get("bands", []),
            conditions=spec.get("conds", []),
            sort_order=order,
        )
    for node_key, spec in nodes.items():
        if spec.get("next"):
            rows[node_key].next_node = rows[spec["next"]]
            rows[node_key].save()
        for order, c in enumerate(spec.get("choices", [])):
            NpcDialogueChoice.objects.create(
                node=rows[node_key],
                choice_key=c["key"],
                label=c.get("label", c["key"].title()),
                next_node=rows.get(c.get("next")),
                conditions=c.get("conds", []),
                action=c.get("action", "NONE"),
                action_value=c.get("value", ""),
                sort_order=order,
            )
    dialogue.start_node = rows[start or next(iter(nodes))]
    dialogue.save()
    return dialogue


@pytest.fixture
def staff():
    return make_staff()


@pytest.fixture
def pip():
    character = make_character(NPC)
    make_placement(character)
    make_dialogue(character)  # greet (wave-back -> bye, leave: END) then bye
    return character


@pytest.fixture
def released(pip, staff):
    return publish(staff)


@pytest.fixture
def a(families, api):
    return api(families.a), families.a1


def start(client, child, trigger="on_interact", **extra):
    return post(client, place_url(child), {"trigger": trigger, **extra})


def act(client, child, conversation_id, action, body=None):
    return post(client, f"{place_url(child)}{conversation_id}/{action}/", body)


#: Apps that own authoritative progress. No interaction route may write any of their rows.
PROGRESS_APPS = ("progression", "quests", "inventory", "game_sessions", "rewards", "mastery")


def progress_counts(child):
    """Row counts for every child-owned model of the progress apps (plus a total of all rows)."""
    from django.apps import apps as django_apps

    counts = {
        "relationships": NpcRelationship.objects.filter(child=child).count(),
        "world_changes": WorldChange.objects.filter(child=child).count(),
        "quests": QuestProgress.objects.filter(child=child).count(),
        "inventory": InventoryItem.objects.filter(child=child).count(),
    }
    for config in django_apps.get_app_configs():
        if config.label not in PROGRESS_APPS:
            continue
        for model in config.get_models():
            counts[model._meta.label] = model.objects.count()
    return counts


# --- start ---------------------------------------------------------------------------------------


def test_start_answers_the_interaction_response(released, a):
    client, child = a
    response = start(client, child, placementKey="spot")
    assert response.status_code == 200, response.json()
    body = response.json()
    assert set(body) == {
        "contractVersion",
        "release",
        "npcId",
        "conversationId",
        "dialogueKey",
        "node",
        "choices",
        "ended",
        "questOffer",
    }
    assert body["contractVersion"] == 1 and body["release"] == released.number
    assert body["npcId"] == NPC and body["dialogueKey"] == "hello" and not body["ended"]
    assert uuid.UUID(body["conversationId"])
    assert body["node"] == {
        "nodeKey": "greet",
        "text": "Ahoy there, friend!",
        "emotion": "neutral",
        "animationState": "wave",
        "audio": None,
        "speech": None,
        "allowAiHint": False,
    }
    assert body["choices"] == [
        {"choiceKey": "wave-back", "label": "Wave", "action": "NONE"},
        {"choiceKey": "leave", "label": "Bye", "action": "END"},
    ]
    assert body["questOffer"] is None
    state = NpcConversationState.objects.get(child=child, npc_id=NPC)
    assert str(state.conversation_id) == body["conversationId"]
    assert state.release_number == released.number and state.node_key == "greet"
    assert state.visit_count == 1 and state.seen_dialogue_keys == ["hello"]
    assert state.last_trigger == "on_interact" and state.last_interaction_at is not None


def test_no_matching_dialogue_is_an_ended_response(released, a):
    client, child = a
    body = start(client, child, "on_spawn").json()
    assert body["node"] is None and body["ended"] is True and body["conversationId"] is None
    assert body["choices"] == [] and body["dialogueKey"] is None


def test_bodies_are_closed_and_triggers_checked(released, a):
    client, child = a
    bad = start(client, child, "on_dance")
    assert bad.status_code == 400 and code(bad) == "invalid_trigger"
    assert start(client, child, sneaky=True).status_code == 400
    assert post(client, place_url(child), {}).status_code == 400
    assert post(client, place_url(child), ["on_interact"]).status_code == 400
    wrong_spot = start(client, child, placementKey="elsewhere")
    assert wrong_spot.status_code == 404 and code(wrong_spot) == "npc_not_found"
    conversation = start(client, child).json()["conversationId"]
    assert (
        act(client, child, conversation, "choose", {"choiceKey": "no spaces!"}).status_code == 400
    )
    assert act(client, child, conversation, "choose", {}).status_code == 400
    assert act(client, child, conversation, "end", {"reward": 1}).status_code == 400
    assert not NpcConversationState.objects.filter(child=child, node_key="").exists()


# --- moving --------------------------------------------------------------------------------------


def test_branching_choose_advance_and_end(released, a):
    client, child = a
    conversation = start(client, child).json()["conversationId"]
    moved = act(client, child, conversation, "choose", {"choiceKey": "wave-back"}).json()
    assert moved["node"]["nodeKey"] == "bye" and moved["choices"] == [] and not moved["ended"]
    done = act(client, child, conversation, "advance").json()
    assert done["ended"] and done["node"] is None and done["conversationId"] == conversation
    again = act(client, child, conversation, "advance")
    assert again.status_code == 409 and code(again) == "conversation_ended"
    second = start(client, child).json()["conversationId"]
    assert second != conversation
    left = act(client, child, second, "choose", {"choiceKey": "leave"}).json()
    assert left["ended"] and left["node"] is None
    third = start(client, child).json()["conversationId"]
    assert act(client, child, third, "end").json()["ended"]
    assert NpcConversationState.objects.get(child=child).visit_count == 3


def test_invalid_transitions_are_refused(released, a, families, api):
    client, child = a
    conversation = start(client, child).json()["conversationId"]
    advance = act(client, child, conversation, "advance")
    assert advance.status_code == 409 and code(advance) == "invalid_choice"
    unknown = act(client, child, conversation, "choose", {"choiceKey": "fly-away"})
    assert unknown.status_code == 409 and code(unknown) == "invalid_choice"
    act(client, child, conversation, "choose", {"choiceKey": "wave-back"})
    replay = act(client, child, conversation, "choose", {"choiceKey": "wave-back"})
    assert replay.status_code == 409 and code(replay) == "invalid_choice"  # double submit
    foreign = act(client, child, uuid.uuid4(), "advance")
    assert foreign.status_code == 404 and code(foreign) == "conversation_not_found"
    # A sibling's conversation id is not this child's.
    sibling = families.a2
    other = start(client, sibling).json()["conversationId"]
    stolen = act(client, child, other, "advance")
    assert stolen.status_code == 404 and code(stolen) == "conversation_not_found"
    # A replaced conversation is no longer the current one.
    newer = start(client, child).json()["conversationId"]
    old = act(client, child, conversation, "advance")
    assert old.status_code == 404 and newer != conversation


def test_release_change_ends_a_conversation(released, a, pip, staff):
    client, child = a
    conversation = start(client, child).json()["conversationId"]
    NpcDialogueNode.objects.filter(node_key="greet").update(text="Ahoy, matey!")
    publish(staff)
    ended = act(client, child, conversation, "choose", {"choiceKey": "wave-back"})
    assert ended.status_code == 409 and code(ended) == "conversation_ended"
    assert NpcConversationState.objects.get(child=child).node_key == ""
    assert code(act(client, child, conversation, "advance")) == "conversation_ended"
    fresh = start(client, child).json()
    assert fresh["release"] == 2 and fresh["node"]["text"] == "Ahoy, matey!"


# --- authorization -------------------------------------------------------------------------------


def test_routes_are_child_scoped(released, families, api):
    client = api(families.a)
    assert start(api(), families.a1).status_code == 401
    foreign = start(client, families.b1)
    assert foreign.status_code == 404
    other_parent = api(families.b)
    conversation = start(client, families.a1).json()["conversationId"]
    assert act(other_parent, families.a1, conversation, "end").status_code == 404
    assert NpcConversationState.objects.filter(child=families.a1).get().node_key == "greet"


def test_npc_must_be_placed_published_and_eligible(pip, staff, a):
    client, child = a
    far = make_character("far-npc")
    make_place("test-island", "other-bay")
    from apps.catalog.models import Location

    far_place = Location.objects.get(slug="other-bay")
    from apps.npcs.models import NpcPlacement

    NpcPlacement.objects.create(
        character=far, placement_key="far", world=far_place.world, location=far_place
    )
    make_dialogue(far)
    sprouts_only = make_character("tiny-npc", age_bands=["SPROUT"])
    make_placement(sprouts_only, "tiny")
    make_dialogue(sprouts_only)
    publish(staff)
    not_here = post(client, place_url(child, "far-npc"), {"trigger": "on_interact"})
    assert not_here.status_code == 404 and code(not_here) == "npc_not_found"
    assert (
        post(
            client, place_url(child, "far-npc", "other-bay"), {"trigger": "on_interact"}
        ).status_code
        == 200
    )
    ineligible = post(client, place_url(child, "tiny-npc"), {"trigger": "on_interact"})
    assert ineligible.status_code == 404 and code(ineligible) == "npc_not_found"
    unknown = post(client, place_url(child, "nobody"), {"trigger": "on_interact"})
    assert unknown.status_code == 404
    missing_place = post(
        client, place_url(child, place="no-such-place"), {"trigger": "on_interact"}
    )
    assert missing_place.status_code == 404 and code(missing_place) == "place_not_found"


def test_no_active_release_is_404(pip, a):
    client, child = a
    response = start(client, child)
    assert response.status_code == 404 and code(response) == "no_active_release"


def test_game_cookie_reaches_only_its_own_area(treasure, api, staff):
    from apps.catalog.models import Location
    from apps.core.content_status import ContentStatus
    from apps.game_sessions.tests.test_game_launch import open_runtime
    from apps.regions.models import WorldRegion

    second = WorldRegion.objects.create(
        region_id="second-cove",
        location=Location.objects.get(slug="wonderwild-forest"),
        title="Second Cove",
        status=ContentStatus.PUBLISHED,
    )
    character = make_character(NPC)
    make_placement(character, "cove-pip", region=treasure.region)
    make_placement(character, "second-pip", region=second)  # placed in both Areas
    make_dialogue(character)
    publish(staff)
    families = treasure.families
    parent = api(families.a)
    child = families.a1
    region = treasure.region.region_id
    area = f"/api/v1/children/{child.pk}/regions/{region}/npcs/{NPC}/interactions/"
    runtime = open_runtime(parent, child)
    started = runtime.post(area, {"trigger": "on_interact"})
    assert started.status_code == 200, started.json()
    conversation = started.json()["conversationId"]
    assert runtime.post(f"{area}{conversation}/end/").json()["ended"]
    # The bearer token works on the area route as well.
    assert post(parent, area, {"trigger": "on_interact"}).status_code == 200
    place_slug = treasure.region.location.slug
    place = f"/api/v1/children/{child.pk}/places/{place_slug}/npcs/{NPC}/interactions/"
    # Place routes are bearer-only: the game cookie does not authenticate there at all.
    assert runtime.post(place, {"trigger": "on_interact"}).status_code in (401, 403)
    sibling = f"/api/v1/children/{families.a2.pk}/regions/{region}/npcs/{NPC}/interactions/"
    assert runtime.post(sibling, {"trigger": "on_interact"}).status_code == 404
    other_area = f"/api/v1/children/{child.pk}/regions/second-cove/npcs/{NPC}/interactions/"
    assert post(parent, other_area, {"trigger": "on_interact"}).status_code == 200  # bearer can
    assert runtime.post(other_area, {"trigger": "on_interact"}).status_code == 404
    unknown = f"/api/v1/children/{child.pk}/regions/some-other-area/npcs/{NPC}/interactions/"
    assert runtime.post(unknown, {"trigger": "on_interact"}).status_code == 404


# --- age bands, conditions, once per child -------------------------------------------------------


def test_age_bands_filter_dialogues_nodes_and_choices(staff, families, api):
    character = make_character(NPC)
    make_placement(character)
    build(
        character,
        "explorer-talk",
        {"deep": {"text": "Let us plan the voyage."}},
        age_bands=["EXPLORER"],
        priority=5,
    )
    build(
        character,
        "talk",
        {
            "little": {"text": "Hi, little one!", "bands": ["SPROUT"], "next": "hello"},
            "hello": {
                "text": "Hello!",
                "choices": [
                    {"key": "easy", "next": "end"},
                    {
                        "key": "tricky",
                        "next": "end",
                        "conds": [{"type": "AGE_BAND", "in": ["PATHFINDER", "EXPLORER"]}],
                    },
                ],
            },
            "end": {"text": "Bye."},
        },
    )
    publish(staff)
    client = api(families.a)
    sprout = families.a1
    ChildProfile.objects.filter(pk=sprout.pk).update(age_band="SPROUT")
    pathfinder = families.a2
    s = start(client, ChildProfile.objects.get(pk=sprout.pk)).json()
    assert s["dialogueKey"] == "talk" and s["node"]["nodeKey"] == "little"
    s2 = act(client, sprout, s["conversationId"], "advance").json()
    assert s2["node"]["nodeKey"] == "hello"
    assert [c["choiceKey"] for c in s2["choices"]] == ["easy"]
    hidden = act(client, sprout, s["conversationId"], "choose", {"choiceKey": "tricky"})
    assert code(hidden) == "invalid_choice"
    p = start(client, pathfinder).json()
    assert p["node"]["nodeKey"] == "hello"
    assert [c["choiceKey"] for c in p["choices"]] == ["easy", "tricky"]
    ChildProfile.objects.filter(pk=pathfinder.pk).update(age_band="EXPLORER")
    assert start(client, pathfinder).json()["dialogueKey"] == "explorer-talk"


def test_once_per_child_and_visit_conditions(staff, a, families, api):
    character = make_character(NPC)
    make_placement(character)
    build(
        character,
        "first-hello",
        {"n": {"text": "Nice to meet you!"}},
        once_per_child=True,
        priority=9,
    )
    build(
        character,
        "welcome-back",
        {"n": {"text": "Welcome back!"}},
        priority=5,
        conditions=[{"type": "RETURN_VISIT"}],
    )
    build(character, "plain", {"n": {"text": "Ahoy."}})
    publish(staff)
    client, child = a
    assert start(client, child).json()["dialogueKey"] == "first-hello"
    assert start(client, child).json()["dialogueKey"] == "welcome-back"
    assert start(client, child).json()["dialogueKey"] == "welcome-back"
    # A sibling has their own state.
    assert start(client, families.a2).json()["dialogueKey"] == "first-hello"


def test_visit_conditions_hold_steady_within_one_conversation(staff, a):
    """The visit a conversation belongs to is not a prior visit while it is open."""
    character = make_character(NPC)
    make_placement(character)
    build(
        character,
        "talk",
        {
            "hello": {"text": "Hello.", "next": "first"},
            "first": {
                "text": "First time here?",
                "conds": [{"type": "FIRST_VISIT"}],
                "next": "again",
            },
            "again": {"text": "Back again!", "conds": [{"type": "RETURN_VISIT"}]},
        },
    )
    publish(staff)
    client, child = a
    first = start(client, child).json()
    moved = act(client, child, first["conversationId"], "advance").json()
    assert moved["node"]["nodeKey"] == "first"
    assert act(client, child, first["conversationId"], "advance").json()["ended"]
    second = start(client, child).json()
    assert (
        act(client, child, second["conversationId"], "advance").json()["node"]["nodeKey"] == "again"
    )


def test_an_existing_relationship_makes_a_return_visit(staff, a):
    character = make_character(NPC)
    make_placement(character)
    build(character, "first", {"n": {}}, conditions=[{"type": "FIRST_VISIT"}], priority=1)
    build(character, "again", {"n": {}}, conditions=[{"type": "RETURN_VISIT"}])
    publish(staff)
    client, child = a
    NpcRelationship.objects.create(
        child=child,
        npc_id=NPC,
        relationship_level="FRIEND",
        first_met_at=now(),
        last_interacted_at=now(),
    )
    assert start(client, child).json()["dialogueKey"] == "again"


# --- actions and progress consistency ------------------------------------------------------------


def make_quest(slug):
    return Quest.objects.create(
        slug=slug,
        title=slug,
        age_bands=["PATHFINDER"],
        source={
            "stages": [
                {
                    "id": "s1",
                    "objectives": [
                        {"id": "o", "kind": "TALK_TO", "npcId": NPC, "memoryFlag": "met-pip"}
                    ],
                }
            ]
        },
        last_seen_release=content_release(),
    )


@pytest.fixture
def actions(staff):
    make_quest("pips-quest")
    character = make_character(NPC)
    make_placement(character)
    build(
        character,
        "acts",
        {
            "ask": {
                "choices": [
                    {
                        "key": "remember",
                        "action": "SET_LOCAL_FLAG",
                        "value": "heard-story",
                        "next": "told",
                    },
                    {
                        "key": "quest",
                        "action": "OFFER_QUEST",
                        "value": "pips-quest",
                        "next": "told",
                    },
                    {"key": "hint", "action": "REQUEST_HINT", "next": "told"},
                    {
                        "key": "secret",
                        "next": "told",
                        "conds": [{"type": "LOCAL_FLAG", "flag": "heard-story"}],
                    },
                ]
            },
            "told": {"text": "There you go."},
        },
    )
    return publish(staff)


def test_set_local_flag_writes_only_conversation_state(actions, a):
    client, child = a
    relationship = NpcRelationship.objects.create(
        child=child,
        npc_id=NPC,
        relationship_level="ACQUAINTANCE",
        memory_flags={"met-pip": False},
        first_met_at=now(),
        last_interacted_at=now(),
    )
    before = progress_counts(child)
    first = start(client, child).json()
    assert "secret" not in [c["choiceKey"] for c in first["choices"]]
    act(client, child, first["conversationId"], "choose", {"choiceKey": "remember"})
    state = NpcConversationState.objects.get(child=child, npc_id=NPC)
    assert state.local_flags == {"heard-story": True}
    relationship.refresh_from_db()
    assert relationship.memory_flags == {"met-pip": False}
    again = start(client, child).json()
    assert "secret" in [c["choiceKey"] for c in again["choices"]]
    assert progress_counts(child) == before


def test_offer_quest_returns_an_offer_and_never_starts_it(actions, a):
    client, child = a
    before = progress_counts(child)
    conversation = start(client, child).json()["conversationId"]
    offered = act(client, child, conversation, "choose", {"choiceKey": "quest"}).json()
    assert offered["questOffer"] == {"questId": "pips-quest"}
    assert offered["node"]["nodeKey"] == "told"
    assert progress_counts(child) == before
    Quest.objects.filter(slug="pips-quest").update(active=False)
    conversation = start(client, child).json()["conversationId"]
    retired = act(client, child, conversation, "choose", {"choiceKey": "quest"}).json()
    assert retired["questOffer"] is None


def test_no_interaction_writes_progress(actions, a):
    client, child = a
    before = progress_counts(child)
    for key in ("remember", "quest", "hint", "secret"):
        body = start(client, child).json()
        act(client, child, body["conversationId"], "choose", {"choiceKey": key})
        act(client, child, body["conversationId"], "advance")
    for trigger in triggers.TRIGGER_SOURCES:
        body = start(client, child, trigger).json()
        if body["conversationId"]:
            act(client, child, body["conversationId"], "end")
    assert progress_counts(child) == before
    assert len(before) > 4  # the generic sweep found the progress apps' models


def test_voiced_characters_get_a_speech_reference(pip, staff, a):
    from apps.speech.models import VoiceProfile

    voice = VoiceProfile.objects.create(
        profile_id="pip-voice", display_name="Pip", polly_voice_id="Justin"
    )
    NpcCharacter.objects.filter(pk=pip.pk).update(voice_profile=voice)
    release = publish(staff)
    client, child = a
    node = start(client, child).json()["node"]
    assert node["speech"] == {
        "kind": "npcDialogueNode",
        "npcId": NPC,
        "release": release.number,
        "dialogueKey": "hello",
        "nodeKey": "greet",
    }


def test_end_is_idempotent_for_a_conversation_already_over(released, a, staff):
    """A best-effort end that races the client's next start is a 200, not a logged 404/409."""
    client, child = a
    first = start(client, child).json()["conversationId"]
    ended = act(client, child, first, "end")
    assert ended.status_code == 200 and ended.json()["ended"] is True
    again = act(client, child, first, "end")  # already ended
    assert again.status_code == 200
    body = again.json()
    assert body["ended"] is True and body["node"] is None and body["conversationId"] == first
    # Replaced by a newer conversation: ending the old one leaves the new one open.
    newer = start(client, child).json()["conversationId"]
    stale = act(client, child, first, "end")
    assert stale.status_code == 200 and stale.json()["ended"] is True
    assert str(NpcConversationState.objects.get(child=child).conversation_id) == newer
    assert NpcConversationState.objects.get(child=child).node_key != ""
    # choose and advance still refuse a conversation that is over.
    assert code(act(client, child, first, "advance")) == "conversation_not_found"
    # A conversation from an older release: end is a 200, the cursor closes.
    NpcDialogueNode.objects.filter(node_key="greet").update(text="Ahoy, matey!")
    publish(staff)
    old_release = act(client, child, newer, "end")
    assert old_release.status_code == 200 and old_release.json()["ended"] is True
    assert NpcConversationState.objects.get(child=child).node_key == ""
