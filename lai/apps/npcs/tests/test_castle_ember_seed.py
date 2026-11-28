"""Ember visits Storykeeper's Castle (SC-R05-02): one `ember-dragon` character (no second
identity) with one gated Place-level placement beside the hearth, wearing the sanctuary's
`npc-pip` stand-in; castle-only lines per band; `seed_npc_ember` is create-only; and she appears
only after the Ember Mountain story, a restored Great Storybook and a first meeting."""

import json
from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.utils import timezone

from apps.npcs import ember_content as ember
from apps.npcs import quill_content as quill
from apps.npcs.management.commands.seed_npc_ember import seed_ember
from apps.npcs.models import NpcCharacter, NpcDialogue, NpcPlacement, NpcRelease
from apps.npcs.publishing import preview

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


def run(*args, command: str = "seed_npc_ember") -> str:
    out = StringIO()
    call_command(command, *args, stdout=out)
    return out.getvalue()


def post(client, url, body=None):
    return client.post(url, json.dumps(body if body is not None else {}), "application/json")


def place(child) -> str:
    return f"/api/v1/children/{child.pk}/places/{ember.PLACE_SLUG}/npcs/"


def record(child, location_slug: str, change_key: str):
    from apps.progression.models import WorldChange

    WorldChange.objects.create(
        child=child,
        location_slug=location_slug,
        change_key=change_key,
        change_type="CREATE",
        created_at=timezone.now(),
    )


def met_ember(child):
    from apps.progression.npcs import set_memory_flags

    set_memory_flags(child, ember.NPC_ID, ["metEmber"])


def served(client, child) -> list[str]:
    return [p["npcId"] for p in client.get(place(child)).json()["placements"]]


@pytest.mark.without_module_content  # the content must be absent
def test_needs_the_content_first(families):
    with pytest.raises(CommandError, match="load_content"):
        run()


def test_one_ember_one_gated_castle_placement_and_a_rerun_creates_nothing(castle):
    out = run()
    assert "Ember: created" in out and "Validation: no problems." in out
    assert NpcCharacter.objects.filter(definition__npc_id=ember.NPC_ID).count() == 1
    (placement,) = NpcPlacement.objects.filter(character__definition__npc_id=ember.NPC_ID)
    assert placement.placement_key == ember.PLACEMENT_KEY
    assert placement.location.slug == "storykeeper-castle" and placement.region is None
    assert placement.spawn_conditions == ember.SPAWN_CONDITIONS
    assert placement.variant.model_asset.asset_id == "npc-pip"  # the sanctuary's stand-in
    assert seed_ember() == []
    assert "unchanged" in run()
    assert NpcRelease.objects.count() == 0


def test_never_overwrites_a_row_staff_changed(castle):
    run()
    node = NpcDialogue.objects.get(
        character__definition__npc_id=ember.NPC_ID, dialogue_key="fallback"
    ).nodes.get()
    node.text = "Hello from staff!"
    node.save()
    run()
    node.refresh_from_db()
    assert node.text == "Hello from staff!"


def test_spawn_conditions_use_only_known_condition_types_and_are_valid():
    from apps.npcs import conditions

    assert conditions.problems(ember.SPAWN_CONDITIONS) == []
    assert [c["type"] for c in ember.SPAWN_CONDITIONS] == [
        "WORLD_CHANGE",
        "WORLD_CHANGE",
        "RETURN_VISIT",
    ]


def test_she_visits_only_after_the_story_the_storybook_and_a_meeting(castle, api):
    run(command="seed_npc_quill")
    run("--publish")
    child = castle.families.a1
    client = api(castle.families.a)
    assert served(client, child) == [quill.NPC_ID]
    record(child, "welcome-harbor", ember.EMBER_STORY_KEY)
    assert served(client, child) == [quill.NPC_ID]
    record(child, ember.PLACE_SLUG, ember.STORYBOOK_RESTORED_KEY)
    assert served(client, child) == [quill.NPC_ID]  # never met her: no visit yet
    met_ember(child)
    assert served(client, child) == [quill.NPC_ID, ember.NPC_ID]  # Quill stays first
    # Another child of the same family is unaffected.
    assert served(client, castle.families.a2) == [quill.NPC_ID]


@pytest.mark.parametrize("band", ["SPROUT", "PATHFINDER", "EXPLORER"])
def test_her_castle_line_is_for_the_childs_band(castle, api, band):
    run("--publish")
    child = castle.families.a1
    child.age_band = band
    child.save(update_fields=["age_band"])
    record(child, "welcome-harbor", ember.EMBER_STORY_KEY)
    record(child, ember.PLACE_SLUG, ember.STORYBOOK_RESTORED_KEY)
    met_ember(child)
    client = api(castle.families.a)
    talk = f"{place(child)}{ember.NPC_ID}/interactions/"
    said = post(client, talk, {"trigger": "on_interact"}).json()
    assert said["dialogueKey"] == f"castle-visit-{band.lower()}"
    assert said["node"]["text"] == ember.CASTLE_VISIT_LINES[band]
    assert [c["action"] for c in said["choices"]] == ["END", "END"]


def test_snapshot_has_a_fallback_and_no_new_flags_or_offers(castle):
    run()
    character = preview().built.snapshot["characters"][ember.NPC_ID]
    published = {d["dialogueKey"]: d for d in character["dialogues"]}
    assert published["fallback"]["conditions"] == []
    assert published["fallback"]["nodes"][0]["text"] == ember.CASTLE_VISIT_LINE
    actions = {c["action"] for d in published.values() for n in d["nodes"] for c in n["choices"]}
    assert actions <= {"NONE", "END"}
