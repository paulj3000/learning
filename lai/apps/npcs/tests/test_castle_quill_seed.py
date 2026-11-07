"""Keeper Quill as NPC Manager content (LAI-NPC-039): `seed_npc_quill` is create-only, validates,
publishes, and a rerun is `unchanged`; the published snapshot carries Quill's dialogues migrated
from the client; the Place route serves him on the castle's Quill spot; Pip and Quill publish
together in one (global) release; and nothing Quill says writes progress."""

import json
import math
from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from apps.npcs import pip_content as pip
from apps.npcs import quill_content as quill
from apps.npcs.management.commands.seed_npc_quill import animation_map_for, seed_quill
from apps.npcs.models import NpcCharacter, NpcDialogue, NpcRelease
from apps.npcs.publishing import active_release, preview

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

EM_DASH = "—"


@pytest.fixture
def castle(families):
    """The real content export imported (the castle Place, Quill, his model and quest)."""
    from types import SimpleNamespace

    from apps.catalog.importer import import_content

    import_content()
    return SimpleNamespace(families=families)


def run(*args, command: str = "seed_npc_quill") -> str:
    out = StringIO()
    call_command(command, *args, stdout=out)
    return out.getvalue()


def post(client, url, body=None):
    return client.post(url, json.dumps(body if body is not None else {}), "application/json")


def place(child) -> str:
    return f"/api/v1/children/{child.pk}/places/{quill.PLACE_SLUG}/npcs/"


# --- the command ---------------------------------------------------------------------------------


def test_needs_the_content_first(families):
    with pytest.raises(CommandError, match="load_content"):
        run()


def test_creates_validates_and_a_rerun_creates_nothing(castle):
    first = run()
    assert "Keeper Quill: created" in first and "Validation: no problems." in first
    dialogues = NpcDialogue.objects.filter(character__definition__npc_id=quill.NPC_ID)
    assert dialogues.count() == len(quill.dialogues())
    assert seed_quill() == []
    second = run()
    assert "unchanged" in second and "Validation: no problems." in second
    assert dialogues.count() == len(quill.dialogues())
    assert NpcRelease.objects.count() == 0  # validating never publishes


def test_never_overwrites_a_row_staff_changed(castle):
    run()
    node = NpcDialogue.objects.get(
        character__definition__npc_id=quill.NPC_ID, dialogue_key="fallback"
    ).nodes.get()
    node.text = "Hello from staff!"
    node.save()
    run()
    node.refresh_from_db()
    assert node.text == "Hello from staff!"


def test_publishes_once_and_a_rerun_is_unchanged(castle):
    assert "NPC release 1 is ACTIVE" in run("--publish")
    assert "Publish: unchanged" in run("--publish")
    assert NpcRelease.objects.count() == 1
    assert active_release().number == 1


def test_validation_problems_fail_the_command(castle):
    run()
    NpcDialogue.objects.filter(
        character__definition__npc_id=quill.NPC_ID, dialogue_key="fallback"
    ).update(start_node=None)
    with pytest.raises(CommandError, match="Validation failed"):
        run("--publish")
    assert NpcRelease.objects.count() == 0


def test_reuses_quills_voice_from_the_speech_seeds(castle):
    call_command("seed_speech_voices", stdout=StringIO())
    run()
    character = NpcCharacter.objects.get(definition__npc_id=quill.NPC_ID)
    assert character.voice_profile is not None
    assert character.voice_profile.profile_id == "keeper-quill"
    snapshot = preview().built.snapshot
    assert snapshot["characters"][quill.NPC_ID]["voiceProfile"] is not None


# --- the content ---------------------------------------------------------------------------------


def test_every_line_is_short_and_has_no_em_dash():
    for dialogue in quill.dialogues():
        for node in dialogue.nodes:
            assert EM_DASH not in node.text and len(node.text) <= 400
            for choice in node.choices:
                assert EM_DASH not in choice.label and len(choice.label) <= 80


def test_snapshot_has_quills_dialogues_and_a_fallback(castle):
    run()
    snapshot = preview().built.snapshot
    character = snapshot["characters"][quill.NPC_ID]
    published = {d["dialogueKey"]: d for d in character["dialogues"]}
    assert set(published) == {d.key for d in quill.dialogues()}
    for behaviour, triggers in quill.REQUIRED_BEHAVIOURS.items():
        assert any(d.behaviour == behaviour and d.trigger in triggers for d in quill.dialogues()), (
            f"no dialogue covers {behaviour}"
        )
    # Quill's legacy lines, word for word.
    texts = {n["text"] for d in published.values() for n in d["nodes"]}
    assert (
        "Welcome to the castle library. Every story here is missing one thing: your ideas." in texts
    )
    assert "The story you made is on my shelf now." in texts
    # The story quest is offered, never started, and only by OFFER_QUEST.
    offer = published["greeting-story-offer"]
    choices = [c for n in offer["nodes"] for c in n["choices"]]
    yes = next(c for c in choices if c["choiceKey"] == "yes")
    assert yes["action"] == "OFFER_QUEST" and yes["actionValue"] == quill.QUEST_ID
    actions = {c["action"] for d in published.values() for n in d["nodes"] for c in n["choices"]}
    assert actions <= {"NONE", "END", "OFFER_QUEST"}
    # A condition-free fallback for on_interact, below every other one.
    fallback = published["fallback"]
    assert fallback["trigger"] == "on_interact" and fallback["conditions"] == []
    assert all(
        d["priority"] > fallback["priority"]
        for d in published.values()
        if d["trigger"] == "on_interact" and d["dialogueKey"] != "fallback"
    )


def test_variant_place_level_placement_and_behaviour(castle):
    run()
    snapshot = preview().built.snapshot
    character = snapshot["characters"][quill.NPC_ID]
    assert character["role"] == "STORYTELLER" and character["dialogueMode"] == "AUTHORED"
    (variant,) = character["variants"]
    assert variant["model"]["assetId"] == "npc-quill"
    assert variant["animationMap"] == quill.ANIMATION_MAP
    (placement,) = [p for p in snapshot["placements"] if p["npcId"] == quill.NPC_ID]
    assert placement["place"] == quill.PLACE_SLUG and placement["area"] is None
    assert placement["position"] == {"x": -4.5, "y": 0.0, "z": 0.0}
    assert placement["rotationY"] == pytest.approx(-math.pi / 2)
    behavior = snapshot["behaviors"][placement["behavior"]]
    assert behavior["type"] == "stationary"
    assert behavior["parameters"]["reactions"]["adventure.completed"] == "celebrate"


def test_animation_map_is_limited_to_the_models_clips(castle):
    from apps.catalog.models import ContentAsset

    model = ContentAsset.objects.get(asset_id="npc-quill")
    assert set(quill.ANIMATION_MAP.values()) <= set(model.clips)
    model.clips = ["Idle", "Talk"]
    assert animation_map_for(model) == {"idle": "Idle", "talk": "Talk"}


# --- Pip and Quill in one global release ---------------------------------------------------------


def test_pip_and_quill_publish_together(treasure, api):
    run(command="seed_npc_pip")
    run()
    out = run("--publish")
    assert "NPC release 1 is ACTIVE" in out
    snapshot = active_release().snapshot
    assert {pip.NPC_ID, quill.NPC_ID} <= set(snapshot["characters"])
    # Seeding Pip again after Quill changes nothing; each scope serves only its own NPC.
    assert "unchanged" in run("--publish", command="seed_npc_pip")
    assert NpcRelease.objects.count() == 1
    child = treasure.families.a1
    client = api(treasure.families.a)
    castle_scene = client.get(place(child)).json()
    assert [p["npcId"] for p in castle_scene["placements"]] == [quill.NPC_ID]
    cove = client.get(f"/api/v1/children/{child.pk}/regions/{pip.AREA_ID}/npcs/").json()
    assert [p["npcId"] for p in cove["placements"]] == [pip.NPC_ID]


# --- served to a child ---------------------------------------------------------------------------


def test_the_place_serves_one_quill_and_talking_writes_no_progress(castle, api):
    from apps.progression.models import NpcRelationship
    from apps.quests.models import QuestProgress

    run("--publish")
    child = castle.families.a1  # a Pathfinder
    client = api(castle.families.a)
    scene = client.get(place(child))
    assert scene.status_code == 200
    body = scene.json()
    assert [p["placementKey"] for p in body["placements"]] == [quill.PLACEMENT_KEY]

    talk = f"{place(child)}{quill.NPC_ID}/interactions/"
    first = post(client, talk, {"trigger": "on_interact"}).json()
    assert first["dialogueKey"] == "greeting-story-offer"
    ideas = post(client, f"{talk}{first['conversationId']}/choose/", {"choiceKey": "ideas"}).json()
    assert [c["choiceKey"] for c in ideas["choices"]] == ["yes", "visiting"]
    chosen = post(client, f"{talk}{first['conversationId']}/choose/", {"choiceKey": "yes"}).json()
    assert chosen["questOffer"] == {"questId": quill.QUEST_ID}
    assert not QuestProgress.objects.filter(child=child).exists()
    assert not NpcRelationship.objects.filter(child=child).exists()
    # The first meeting is once per child; then what every story needs.
    again = post(client, talk, {"trigger": "on_interact"}).json()
    assert again["dialogueKey"] == "story-rules"
    told = post(client, talk, {"trigger": "on_adventure_complete"}).json()
    assert told["node"]["text"] == "The story you made is on my shelf now."
    back = post(client, talk, {"trigger": "on_return_visit"}).json()
    assert back["dialogueKey"] == "welcome-back"


def test_no_release_means_no_managed_quill(castle, api):
    run()  # seeded but not published
    response = api(castle.families.a).get(place(castle.families.a1))
    assert response.status_code == 200
    assert response.json()["release"] == 0 and response.json()["placements"] == []
