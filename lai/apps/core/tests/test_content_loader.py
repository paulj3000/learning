"""`load_content` (LAI-0304): row counts match the export, idempotent, all-or-nothing."""

import json
import shutil

import pytest
from django.conf import settings

from apps.adventures.models import AdventureTemplate
from apps.core.catalog import ContentStatus
from apps.core.content_loader import load_content
from apps.core.content_schema import ContentSchemaError
from apps.education.models import LearningObjective
from apps.inventory.models import CollectibleSet, ItemDefinition, RewardRule
from apps.islands.models import Island, IslandLocation, NpcDefinition, NpcDialogueNode
from apps.islands.treasure_rush_seed import seed_treasure_rush
from apps.quests.models import QuestDefinition

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

EXPORTED = settings.CONTENT_DIR / "exported"


def exported(name: str) -> dict:
    return json.loads((EXPORTED / name).read_text(encoding="utf-8"))


def expected_counts() -> dict:
    adventures = exported("adventures.json")
    rewards = exported("rewards.json")
    npcs = exported("npcs.json")["npcs"]
    return {
        AdventureTemplate: len(adventures["adventures"]),
        LearningObjective: len(adventures["learningObjectives"]),
        Island: len(exported("islands.json")["islands"]),
        IslandLocation: len(exported("locations.json")["locations"]),
        ItemDefinition: len(rewards["items"]),
        CollectibleSet: len(rewards["collectibleSets"]),
        RewardRule: len(rewards["rewardRules"]),
        NpcDefinition: len(npcs),
        NpcDialogueNode: sum(len(npc["dialogue"]) for npc in npcs),
        QuestDefinition: len(exported("quests.json")["quests"]),
    }


def counts() -> dict:
    return {model: model.objects.count() for model in expected_counts()}


def test_row_counts_match_the_export():
    load_content()
    assert counts() == expected_counts()


def test_loading_twice_changes_nothing():
    load_content()
    before = counts()
    rule_items = {r.rule_id: set(r.items.values_list("item_id", flat=True)) for r in RewardRule.objects.all()}
    report = load_content()
    assert report.created == {}
    assert counts() == before
    assert {
        r.rule_id: set(r.items.values_list("item_id", flat=True)) for r in RewardRule.objects.all()
    } == rule_items


def test_relationships_are_loaded():
    load_content()
    bridge = AdventureTemplate.objects.get(slug="repair-the-moonlight-bridge")
    assert "counting-sets" in set(bridge.learning_objectives.values_list("code", flat=True))
    assert QuestDefinition.objects.get(quest_id="repair-the-bridge").giver_npc.npc_id == "pirate-pip"
    assert IslandLocation.objects.get(slug="pirate-builder-bay").island.slug == (
        "learning-adventure-island"
    )
    shells = CollectibleSet.objects.get(set_id="harbor-shells")
    assert shells.completion_item.item_id == "beachcomber-hat"
    assert shells.items.count() == 4


def test_a_schema_error_loads_nothing(tmp_path):
    shutil.copytree(settings.CONTENT_DIR, tmp_path / "content")
    broken = tmp_path / "content" / "exported" / "quests.json"
    data = json.loads(broken.read_text())
    data["quests"][0]["unexpected"] = True
    broken.write_text(json.dumps(data))
    with pytest.raises(ContentSchemaError):
        load_content(tmp_path / "content")
    assert all(count == 0 for count in counts().values())


def test_an_admin_retirement_survives_a_reload():
    load_content()
    AdventureTemplate.objects.filter(slug="repair-the-moonlight-bridge").update(
        status=ContentStatus.RETIRED
    )
    load_content()
    retired = AdventureTemplate.objects.get(slug="repair-the-moonlight-bridge")
    assert retired.status == ContentStatus.RETIRED


def test_admin_authored_rows_are_left_alone():
    load_content()
    seed_treasure_rush()
    load_content()
    assert QuestDefinition.objects.filter(quest_id="treasure-rush-cove").exists()
    assert ItemDefinition.objects.filter(item_id="golden-doubloon").exists()


def test_a_dialogue_line_removed_from_the_export_is_removed(tmp_path):
    load_content()
    shutil.copytree(settings.CONTENT_DIR, tmp_path / "content")
    path = tmp_path / "content" / "exported" / "npcs.json"
    data = json.loads(path.read_text())
    removed = data["npcs"][0]["dialogue"].pop()
    path.write_text(json.dumps(data))
    load_content(tmp_path / "content")
    assert not NpcDialogueNode.objects.filter(node_id=removed["id"]).exists()
