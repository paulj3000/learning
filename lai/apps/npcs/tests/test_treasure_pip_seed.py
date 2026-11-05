"""Pirate Pip as NPC Manager content (LAI-NPC-018, LAI-NPC-010): `seed_npc_pip` is create-only,
validates, publishes, and a rerun is `unchanged`; the published snapshot carries Pip's six
required behaviours; the runtime serves him on Treasure Cove's Pip spot; and nothing he says
writes progress."""

import json
from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.utils import timezone

from apps.npcs import pip_content as pip
from apps.npcs.management.commands.seed_npc_pip import animation_map_for, seed_pip
from apps.npcs.models import NpcDialogue, NpcPlacement, NpcRelease
from apps.npcs.publishing import active_release, preview
from apps.npcs.vocabulary import ReleaseStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

EM_DASH = "—"


def run(*args) -> str:
    out = StringIO()
    call_command("seed_npc_pip", *args, stdout=out)
    return out.getvalue()


def post(client, url, body=None):
    return client.post(url, json.dumps(body if body is not None else {}), "application/json")


def area(child) -> str:
    return f"/api/v1/children/{child.pk}/regions/{pip.AREA_ID}/npcs/"


# --- the command ---------------------------------------------------------------------------------


def test_needs_the_content_and_the_cove_first(families):
    with pytest.raises(CommandError, match="load_content and seed_treasure_rush"):
        run()


def test_creates_validates_and_a_rerun_creates_nothing(treasure):
    first = run()
    assert "created" in first and "Validation: no problems." in first
    dialogues = NpcDialogue.objects.filter(character__definition__npc_id=pip.NPC_ID)
    assert dialogues.count() == len(pip.dialogues())
    assert seed_pip() == []
    second = run()
    assert "unchanged" in second and "Validation: no problems." in second
    assert dialogues.count() == len(pip.dialogues())
    assert NpcRelease.objects.count() == 0  # validating never publishes


def test_never_overwrites_a_row_staff_changed(treasure):
    run()
    greeting = NpcDialogue.objects.get(dialogue_key="fallback")
    node = greeting.nodes.get()
    node.text = "Ahoy from staff!"
    node.save()
    run()
    node.refresh_from_db()
    assert node.text == "Ahoy from staff!"


def test_publishes_once_and_a_rerun_is_unchanged(treasure):
    out = run("--publish")
    assert "NPC release 1 is ACTIVE" in out
    again = run("--publish")
    assert "Publish: unchanged" in again
    assert NpcRelease.objects.count() == 1
    assert active_release().number == 1


def test_validation_problems_fail_the_command(treasure):
    run()
    NpcDialogue.objects.filter(dialogue_key="fallback").update(start_node=None)
    with pytest.raises(CommandError, match="Validation failed"):
        run("--publish")
    assert NpcRelease.objects.count() == 0


# --- the content ---------------------------------------------------------------------------------


def test_every_line_is_short_and_has_no_em_dash():
    for hybrid in (False, True):
        for dialogue in pip.dialogues(hybrid=hybrid):
            for node in dialogue.nodes:
                assert EM_DASH not in node.text and len(node.text) <= 400
                for choice in node.choices:
                    assert EM_DASH not in choice.label and len(choice.label) <= 80
    for line in pip.PERSONA["fallback_lines"]:
        assert EM_DASH not in line


def test_snapshot_has_the_six_required_behaviours_and_a_fallback(treasure):
    run()
    snapshot = preview().built.snapshot
    character = snapshot["characters"][pip.NPC_ID]
    published = {d["dialogueKey"]: d for d in character["dialogues"]}
    for behaviour, triggers in pip.REQUIRED_BEHAVIOURS.items():
        covering = [
            d
            for d in pip.dialogues()
            if d.behaviour == behaviour and d.key in published and d.trigger in triggers
        ]
        assert covering, f"no published dialogue covers {behaviour}"
    # The mission offers Pip's quest through OFFER_QUEST, never by itself.
    choices = [c for n in published["mission-offer"]["nodes"] for c in n["choices"]]
    assert {"action": "OFFER_QUEST", "actionValue": pip.PIPS_QUEST_ID}.items() <= next(
        c for c in choices if c["choiceKey"] == "yes"
    ).items()
    actions = {c["action"] for d in published.values() for n in d["nodes"] for c in n["choices"]}
    assert actions <= {"NONE", "END", "OFFER_QUEST"}
    # A condition-free fallback for on_interact, below every conditional one.
    fallback = published["fallback"]
    assert fallback["trigger"] == "on_interact" and fallback["conditions"] == []
    assert all(
        d["priority"] > fallback["priority"]
        for d in published.values()
        if d["trigger"] == "on_interact" and d["dialogueKey"] != "fallback"
    )


def test_variant_placement_and_behaviour(treasure):
    run()
    snapshot = preview().built.snapshot
    character = snapshot["characters"][pip.NPC_ID]
    assert character["role"] == "QUEST_GIVER" and character["dialogueMode"] == "AUTHORED"
    assert character["voiceProfile"] is None  # no Pip voice in the speech seeds
    (variant,) = character["variants"]
    assert variant["model"]["assetId"] == "npc-pip"
    assert variant["animationMap"] == {"idle": "Idle", "talk": "Talk", "wave": "Wave"}
    (placement,) = [p for p in snapshot["placements"] if p["npcId"] == pip.NPC_ID]
    legacy = treasure.region.placements.get(entity_id=pip.LEGACY_ENTITY_ID)
    assert placement["area"] == pip.AREA_ID
    assert placement["position"] == {"x": legacy.x, "y": legacy.elevation, "z": legacy.z}
    behavior = snapshot["behaviors"][placement["behavior"]]
    assert behavior["type"] == "stationary"
    assert behavior["parameters"]["reactions"]["treasure.found"] == "celebrate"


def test_animation_map_is_limited_to_the_models_clips(treasure):
    from apps.catalog.models import ContentAsset

    model = ContentAsset.objects.get(asset_id="npc-pip")
    model.clips = ["Idle", "Wave"]
    assert animation_map_for(model) == {"idle": "Idle", "wave": "Wave"}


def test_hybrid_hints_validate_with_an_approved_persona(treasure):
    out = run("--hybrid-hints", "--publish")
    assert "persona v1" in out and "is ACTIVE" in out
    snapshot = active_release().snapshot
    character = snapshot["characters"][pip.NPC_ID]
    assert character["dialogueMode"] == "HYBRID" and character["persona"]["version"] == 1
    hint = next(d for d in character["dialogues"] if d["dialogueKey"] == "hint-wrong-answer")
    assert any(n["allowAiHint"] for n in hint["nodes"])
    assert any(c["action"] == "REQUEST_HINT" for n in hint["nodes"] for c in n["choices"])


# --- served to a child ---------------------------------------------------------------------------


def test_the_area_serves_one_pip_on_his_spot_and_talking_writes_no_progress(treasure, api):
    from apps.progression.models import NpcRelationship
    from apps.quests.models import QuestProgress

    run("--publish")
    child = treasure.families.a1
    client = api(treasure.families.a)
    scene = client.get(area(child))
    assert scene.status_code == 200
    body = scene.json()
    assert [p["npcId"] for p in body["placements"]] == [pip.NPC_ID]
    assert body["placements"][0]["placementKey"] == pip.PLACEMENT_KEY

    talk = f"{area(child)}{pip.NPC_ID}/interactions/"
    greet = post(client, talk, {"trigger": "on_spawn"}).json()
    assert greet["dialogueKey"] == "greet-first-visit"
    offer = post(client, talk, {"trigger": "on_interact"}).json()
    assert offer["dialogueKey"] == "mission-offer"
    assert [c["choiceKey"] for c in offer["choices"]] == ["yes", "later"]
    chosen = post(client, f"{talk}{offer['conversationId']}/choose/", {"choiceKey": "yes"}).json()
    assert chosen["questOffer"] == {"questId": pip.PIPS_QUEST_ID}
    # Offering is not accepting: the quest starts only through POST quests/<id>/accept/.
    assert not QuestProgress.objects.filter(child=child).exists()
    assert not NpcRelationship.objects.filter(child=child).exists()
    # The first greeting is once per child; a return visit is welcomed instead.
    assert post(client, talk, {"trigger": "on_spawn"}).json()["node"] is None
    back = post(client, talk, {"trigger": "on_return_visit"}).json()
    assert back["dialogueKey"] == "welcome-back"


def test_quest_state_picks_the_line(treasure, api):
    from apps.quests.models import QuestProgress, QuestStatus

    run("--publish")
    child = treasure.families.a1
    client = api(treasure.families.a)
    talk = f"{area(child)}{pip.NPC_ID}/interactions/"
    accepted = post(client, f"/api/v1/children/{child.pk}/quests/{pip.PIPS_QUEST_ID}/accept/")
    assert accepted.status_code in (200, 201)
    assert QuestProgress.objects.get(child=child).status == QuestStatus.ACTIVE
    assert post(client, talk, {"trigger": "on_interact"}).json()["dialogueKey"] == (
        "treasure-active"
    )
    QuestProgress.objects.filter(child=child).update(
        status=QuestStatus.COMPLETED, completed_at=timezone.now()
    )
    assert post(client, talk, {"trigger": "on_interact"}).json()["dialogueKey"] == (
        "treasure-complete"
    )


def test_no_release_means_no_managed_pip(treasure, api):
    run()  # seeded but not published
    response = api(treasure.families.a).get(area(treasure.families.a1))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "no_active_release"
    assert not NpcRelease.objects.filter(status=ReleaseStatus.ACTIVE).exists()
    assert NpcPlacement.objects.filter(placement_key=pip.PLACEMENT_KEY).count() == 1
