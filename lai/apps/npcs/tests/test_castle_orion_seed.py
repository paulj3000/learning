"""Professor Orion as NPC Manager content (SC-R05-03): `seed_npc_orion` is create-only,
validates, publishes, and a rerun is `unchanged`; the snapshot carries his age-band lines and a
fallback; the Place route serves him on the castle's Orion spot beside Quill; he never marks an
answer wrong; and nothing he says writes progress."""

import json
import math
from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from apps.npcs import orion_content as orion
from apps.npcs import quill_content as quill
from apps.npcs.castle_seed import animation_map_for
from apps.npcs.management.commands.seed_npc_orion import seed_orion
from apps.npcs.models import NpcDialogue, NpcRelease
from apps.npcs.publishing import active_release, preview

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.django_db,
    # One content import for the module (lai/conftest.py, "Module content baseline").
    pytest.mark.usefixtures("module_content"),
]


@pytest.fixture
def castle(families):
    from types import SimpleNamespace

    from apps.catalog.importer import import_content

    import_content()
    return SimpleNamespace(families=families)


def run(*args, command: str = "seed_npc_orion") -> str:
    out = StringIO()
    call_command(command, *args, stdout=out)
    return out.getvalue()


def post(client, url, body=None):
    return client.post(url, json.dumps(body if body is not None else {}), "application/json")


def place(child) -> str:
    return f"/api/v1/children/{child.pk}/places/{orion.PLACE_SLUG}/npcs/"


def set_band(child, band: str):
    child.age_band = band
    child.save(update_fields=["age_band"])


# --- the command ---------------------------------------------------------------------------------


@pytest.mark.without_module_content  # the content must be absent
def test_needs_the_content_first(families):
    with pytest.raises(CommandError, match="load_content"):
        run()


def test_creates_validates_and_a_rerun_creates_nothing(castle):
    first = run()
    assert "Professor Orion: created" in first and "Validation: no problems." in first
    dialogues = NpcDialogue.objects.filter(character__definition__npc_id=orion.NPC_ID)
    assert dialogues.count() == len(orion.dialogues())
    assert seed_orion() == []
    second = run()
    assert "unchanged" in second and "Validation: no problems." in second
    assert dialogues.count() == len(orion.dialogues())
    assert NpcRelease.objects.count() == 0


def test_never_overwrites_a_row_staff_changed(castle):
    run()
    node = NpcDialogue.objects.get(
        character__definition__npc_id=orion.NPC_ID, dialogue_key="fallback"
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


# --- the content ---------------------------------------------------------------------------------


def test_snapshot_has_band_lines_required_behaviours_and_a_fallback(castle):
    run()
    character = preview().built.snapshot["characters"][orion.NPC_ID]
    assert character["role"] == "TEACHER" and character["dialogueMode"] == "AUTHORED"
    published = {d["dialogueKey"]: d for d in character["dialogues"]}
    assert set(published) == {d.key for d in orion.dialogues()}
    for behaviour, triggers in orion.REQUIRED_BEHAVIOURS.items():
        assert any(d.behaviour == behaviour and d.trigger in triggers for d in orion.dialogues())
    # One first meeting per band, each gated on its band.
    for band in orion.BANDS:
        greeting = published[f"greeting-{band.lower()}"]
        assert greeting["conditions"] == [{"type": "AGE_BAND", "in": [band]}]
        assert greeting["nodes"][0]["text"] == orion.GREETING_LINES[band]
    # Choices only ever end or move on: nothing offered, granted or flagged.
    actions = {c["action"] for d in published.values() for n in d["nodes"] for c in n["choices"]}
    assert actions <= {"NONE", "END"}
    fallback = published["fallback"]
    assert fallback["trigger"] == "on_interact" and fallback["conditions"] == []
    assert all(
        d["priority"] > fallback["priority"]
        for d in published.values()
        if d["trigger"] == "on_interact" and d["dialogueKey"] != "fallback"
    )


def test_counting_the_stars_has_no_wrong_answer():
    (count,) = [d for d in orion.dialogues() if d.key == "count-the-stars"]
    ask = count.nodes[0]
    # The only replies are "I counted them!" (praised) and "Not right now." (a warm goodbye).
    assert [c.label for c in ask.choices] == ["I counted them!", "Not right now."]
    praise = next(n for n in count.nodes if n.key == ask.choices[0].next)
    assert praise.text.startswith("Wonderful counting!")
    words = " ".join(n.text for d in orion.dialogues() for n in d.nodes).lower()
    for unkind in ("wrong", "incorrect", "try again", "no,"):
        assert unkind not in words


def test_variant_placement_and_behaviour(castle):
    run()
    snapshot = preview().built.snapshot
    (variant,) = snapshot["characters"][orion.NPC_ID]["variants"]
    assert variant["model"]["assetId"] == "npc-professor-ticktock"
    assert variant["animationMap"] == {"idle": "Idle", "wave": "Wave"}
    (placement,) = [p for p in snapshot["placements"] if p["npcId"] == orion.NPC_ID]
    assert placement["placementKey"] == orion.PLACEMENT_KEY
    assert placement["place"] == orion.PLACE_SLUG and placement["area"] is None
    assert placement["position"] == {"x": 9.5, "y": 0.0, "z": 5.8}
    assert placement["rotationY"] == pytest.approx(math.atan2(-2.0, 1.7))
    behavior = snapshot["behaviors"][placement["behavior"]]
    assert behavior["type"] == "stationary" and behavior["parameters"]["facePlayer"] is True


def test_animation_map_is_limited_to_the_models_clips(castle):
    from apps.catalog.models import ContentAsset

    model = ContentAsset.objects.get(asset_id=orion.MODEL_ASSET_ID)
    assert set(orion.ANIMATION_MAP.values()) <= set(model.clips)
    model.clips = ["Idle"]
    assert animation_map_for(orion, model) == {"idle": "Idle"}


# --- served to a child ---------------------------------------------------------------------------


@pytest.mark.parametrize("band", ["SPROUT", "PATHFINDER", "EXPLORER"])
def test_each_band_meets_its_own_orion_and_talking_writes_no_progress(castle, api, band):
    from apps.progression.models import NpcRelationship
    from apps.quests.models import QuestProgress

    run("--publish")
    child = castle.families.a1
    set_band(child, band)
    client = api(castle.families.a)
    talk = f"{place(child)}{orion.NPC_ID}/interactions/"
    first = post(client, talk, {"trigger": "on_interact"}).json()
    assert first["dialogueKey"] == f"greeting-{band.lower()}"
    assert first["node"]["text"] == orion.GREETING_LINES[band]
    looked = post(client, f"{talk}{first['conversationId']}/choose/", {"choiceKey": "ask"}).json()
    assert looked["node"]["text"] == orion.TELESCOPE_LINES[band]
    # Then, on a return, counting the stars; every count is praised.
    count = post(client, talk, {"trigger": "on_interact"}).json()
    assert count["dialogueKey"] == "count-the-stars"
    praised = post(
        client, f"{talk}{count['conversationId']}/choose/", {"choiceKey": "counted"}
    ).json()
    assert praised["node"]["text"] == orion.LEGACY_LINES["orion-counting-praise"]
    assert not QuestProgress.objects.filter(child=child).exists()
    assert not NpcRelationship.objects.filter(child=child).exists()


def test_a_told_story_and_a_restored_book_are_noticed(castle, api):
    from django.utils import timezone

    from apps.progression.models import WorldChange

    run("--publish")
    child = castle.families.a1
    client = api(castle.families.a)
    talk = f"{place(child)}{orion.NPC_ID}/interactions/"
    assert post(client, talk, {"trigger": "on_interact"}).json()["dialogueKey"] == (
        "greeting-pathfinder"
    )
    for key in (orion.FIRST_STORY_TOLD_KEY, orion.STORYBOOK_RESTORED_KEY):
        WorldChange.objects.create(
            child=child,
            location_slug=orion.PLACE_SLUG,
            change_key=key,
            change_type="CREATE",
            created_at=timezone.now(),
        )
    restored = post(client, talk, {"trigger": "on_interact"}).json()
    assert restored["dialogueKey"] == "storybook-restored"
    told = post(client, talk, {"trigger": "on_interact"}).json()
    assert told["node"]["text"] == orion.LEGACY_LINES["orion-story-told"]
    # Both once; then the stars to count.
    assert post(client, talk, {"trigger": "on_interact"}).json()["dialogueKey"] == (
        "count-the-stars"
    )


def test_quill_and_orion_share_the_castle_and_quill_stays_first(castle, api):
    run(command="seed_npc_quill")
    run("--publish")
    snapshot = active_release().snapshot
    assert {quill.NPC_ID, orion.NPC_ID} <= set(snapshot["characters"])
    child = castle.families.a1
    scene = api(castle.families.a).get(place(child)).json()
    # Quill first: a play line with nobody near goes to the first placement (the host's rule).
    assert [p["placementKey"] for p in scene["placements"]] == [
        quill.PLACEMENT_KEY,
        orion.PLACEMENT_KEY,
    ]
