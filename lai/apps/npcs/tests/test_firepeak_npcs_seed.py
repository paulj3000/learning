"""The Heart of Firepeak NPCs (`seed_npc_firepeak`): create-only, clear failure without the
catalog NPCs, placements wait for the 3D Area, DRAFT until the model is live, publishes the five
characters, dialogue validates and the copy is child safe."""

import re
from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from apps.catalog.models import AssetOrigin, NpcDefinition
from apps.core.content_status import ContentStatus
from apps.npcs import firepeak_content as fp
from apps.npcs.management.commands.seed_npc_firepeak import seed_firepeak
from apps.npcs.models import NpcCharacter, NpcDialogue, NpcPlacement, NpcRelease
from apps.npcs.publishing import active_release, preview
from apps.npcs.tests.helpers import content_release, make_place
from apps.npcs.vocabulary import ANIMATION_STATES, CharacterStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

PLACEMENTS = {
    "fh-flint",
    "fh-kindle",
    "fh-kindle-heart",
    "fh-basalt",
    "fh-basalt-summit",
    "fh-cinder",
    "fh-ignis",
}


def run(*args) -> str:
    out = StringIO()
    call_command("seed_npc_firepeak", *args, stdout=out)
    return out.getvalue()


def catalog_npcs() -> None:
    """What `load_content` gives: the five catalog NPC rows and the Heart quest (made directly)."""
    catalog_quest()
    for npc in fp.NPCS:
        NpcDefinition.objects.get_or_create(
            npc_id=npc.npc_id,
            defaults={
                "display_name": npc.name,
                "home_location_slug": fp.PLACE_SLUG,
                "origin": AssetOrigin.DJANGO,
            },
        )


def catalog_quest() -> None:
    """What `load_content` gives: the Heart quest Flint offers (validated as an active quest)."""
    from apps.catalog.models import Quest

    Quest.objects.get_or_create(
        slug=fp.HEART_QUEST_ID,
        defaults={
            "title": "The Heart of Firepeak",
            "age_bands": ["PATHFINDER", "EXPLORER"],
            "active": True,
            "source": {"stages": []},
            "last_seen_release": content_release(),
        },
    )


def models_live() -> None:
    """The uploaded GLBs, stood in for by bundled model assets with the full clip set."""
    from apps.catalog.models import ContentAsset

    for npc in fp.NPCS:
        ContentAsset.objects.get_or_create(
            asset_id=npc.asset_id,
            defaults={
                "kind": "character",
                "category": "npc",
                "bundled_path": f"/models/{npc.asset_id}.glb",
                "clips": list(fp.CLIPS),
                "origin": AssetOrigin.EXPORT,
                "last_seen_release": content_release(),
            },
        )


def area():
    from apps.regions.models import WorldRegion

    _world, place = make_place("firepeak-island", fp.PLACE_SLUG)
    return WorldRegion.objects.create(
        region_id=fp.REGION_ID, location=place, title="Heart", status=ContentStatus.PUBLISHED
    )


@pytest.fixture
def ready():
    catalog_npcs()
    models_live()
    area()


def test_missing_catalog_npcs_fail_with_the_owner_step():
    with pytest.raises(CommandError, match="load_content"):
        run()
    catalog_npcs()
    NpcDefinition.objects.filter(npc_id="ignis").delete()
    with pytest.raises(CommandError, match="ignis"):
        run()
    assert not NpcCharacter.objects.exists()


def test_creates_everything_once_and_a_rerun_creates_nothing(ready):
    first = run()
    assert "Firepeak NPCs: created" in first and "Validation: no problems." in first
    assert set(NpcCharacter.objects.values_list("definition__npc_id", flat=True)) == set(fp.NPC_IDS)
    assert set(NpcPlacement.objects.values_list("placement_key", flat=True)) == PLACEMENTS
    for character in NpcCharacter.objects.all():
        assert character.status == CharacterStatus.READY
        assert character.age_bands == ["PATHFINDER", "EXPLORER"]
        assert character.voice_profile is not None
        assert character.personas.filter(status="APPROVED").count() == 1
    modes = {c.slug: c.dialogue_mode for c in NpcCharacter.objects.all()}
    assert modes["kindle"] == "HYBRID"
    assert {m for slug, m in modes.items() if slug != "kindle"} == {"AUTHORED"}
    assert seed_firepeak() == ([], [])
    second = run()
    assert "unchanged" in second and "Validation: no problems." in second
    assert NpcRelease.objects.count() == 0


def test_never_overwrites_a_row_staff_changed(ready):
    run()
    node = NpcDialogue.objects.get(
        character__definition__npc_id="flint", dialogue_key="fallback"
    ).nodes.get()
    node.text = "Hello from staff!"
    node.save()
    run()
    node.refresh_from_db()
    assert node.text == "Hello from staff!"


def test_placements_wait_for_the_area_and_are_created_later():
    catalog_npcs()
    models_live()
    out = run()
    assert "placements skipped" in out
    assert not NpcPlacement.objects.exists()
    area()
    run()
    assert set(NpcPlacement.objects.values_list("placement_key", flat=True)) == PLACEMENTS
    assert seed_firepeak() == ([], [])


def test_draft_until_the_model_is_live_then_promote():
    catalog_npcs()
    area()
    out = run()
    assert "is DRAFT" in out and "Validation: skipped" in out
    with pytest.raises(CommandError, match="Publish|Validation"):
        run("--publish")
    assert set(NpcCharacter.objects.values_list("status", flat=True)) == {CharacterStatus.DRAFT}
    from apps.catalog.models import ContentAsset

    ContentAsset.objects.filter(
        asset_id__in=[
            "firepeak-flint",
            "firepeak-kindle",
            "firepeak-professor-basalt",
            "firepeak-cinder",
            "firepeak-ignis",
        ]
    ).update(bundled_path="/models/x.glb")
    assert "Promote:" in run("--promote")
    assert set(NpcCharacter.objects.values_list("status", flat=True)) == {CharacterStatus.READY}


def test_publish_carries_the_five_characters_and_a_rerun_is_unchanged(ready):
    assert "NPC release 1 is ACTIVE" in run("--publish")
    assert "Publish: unchanged" in run("--publish")
    snapshot = active_release().snapshot
    assert set(snapshot["characters"]) == set(fp.NPC_IDS)
    assert {p["placementKey"] for p in snapshot["placements"]} == PLACEMENTS
    for npc in fp.NPCS:
        character = snapshot["characters"][npc.npc_id]
        variant = character["variants"][0]
        assert variant["model"]["assetId"] == npc.asset_id
        assert set(variant["animationMap"]) <= set(ANIMATION_STATES)
        assert character["voiceProfile"] == npc.npc_id
        assert character["persona"]["fallbackLines"]
        keys = {d["dialogueKey"] for d in character["dialogues"]}
        assert {"greeting-explorer", "greeting-pathfinder", "welcome-back", "fallback"} <= keys


def test_dialogue_validates_and_only_kindle_allows_ai_hints(ready):
    run()
    assert preview().problems == []
    hint_nodes = NpcDialogue.objects.filter(nodes__allow_ai_hint=True).distinct()
    assert {d.character.slug for d in hint_nodes} == {"kindle"}
    from apps.npcs.models import NpcDialogueNode

    for node in NpcDialogueNode.objects.filter(allow_ai_hint=True):
        assert node.allowed_topic == fp.KINDLE_TOPIC
    for dialogue in NpcDialogue.objects.all():
        assert dialogue.start_node_id is not None
        assert dialogue.conditions is not None


def test_behaviours_and_age_bands(ready):
    run()
    types = {p.placement_key: p.behavior.behavior_type for p in NpcPlacement.objects.all()}
    assert types["fh-kindle"] == "follow"
    assert types["fh-kindle-heart"] == "stationary"
    assert types["fh-flint"] == types["fh-ignis"] == "stationary"
    greetings = NpcDialogue.objects.filter(dialogue_key__startswith="greeting-")
    for dialogue in greetings:
        assert dialogue.conditions[0]["type"] == "AGE_BAND"


def test_copy_is_child_safe():
    texts = []
    for npc in fp.NPCS:
        texts += [npc.persona_prompt, *npc.fallback_lines]
        for dialogue in fp.dialogues(npc):
            for node in dialogue.nodes:
                texts.append(node.text)
                texts += [c.label for c in node.choices]
                assert len(node.text) <= 400
    for text in texts:
        assert "—" not in text and "–" not in text
    spoken = " ".join(
        t for npc in fp.NPCS for d in fp.dialogues(npc) for n in d.nodes for t in [n.text]
    )
    assert not re.search(
        r"\b(your name|where do you live|your school|secret|i am (a )?human)\b", spoken, re.I
    )
    for npc in fp.NPCS:
        assert "never a person" in npc.persona_prompt
        assert "Never ask for private" in npc.persona_prompt
    basalt = next(n for n in fp.NPCS if n.npc_id == "professor-basalt")
    assert "Real volcanoes" in basalt.greeting_explorer


def _choice_actions(npc_id: str) -> set[tuple[str, str]]:
    npc = next(n for n in fp.NPCS if n.npc_id == npc_id)
    return {
        (c.action, c.value)
        for d in fp.dialogues(npc)
        for node in d.nodes
        for c in node.choices
        if c.action == "OFFER_QUEST"
    }


def test_only_flint_offers_the_quest_and_it_is_the_catalog_quest():
    # A managed NPC does not use the legacy quest list, so Flint's greeting offers it (FPV-NPC).
    assert _choice_actions("flint") == {("OFFER_QUEST", "the-heart-of-firepeak")}
    for other in ("kindle", "professor-basalt", "cinder", "ignis"):
        assert _choice_actions(other) == set()
