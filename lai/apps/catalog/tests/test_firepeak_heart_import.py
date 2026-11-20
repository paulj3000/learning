"""The Heart of Firepeak's authored content (docs/firepeak/HEART_OF_FIREPEAK_DESIGN.md).

Imports the committed export and checks the new Place, NPCs, quest, items and rules, that the
puzzle lines pass the same validation Django applies when an administrator publishes an NPC, and
that the existing Firepeak Volcano content is unchanged.
"""

import pytest

from apps.catalog import authoring, records
from apps.catalog.importer import import_content
from apps.catalog.models import (
    CollectibleSet,
    ItemDefinition,
    Location,
    NpcDefinition,
    Quest,
    RewardRule,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

NPCS = {"flint", "kindle", "professor-basalt", "cinder", "ignis"}
PUZZLES = {
    "fh-landing-map",
    "fh-emberwood-pattern",
    "fh-emberwood-count",
    "fh-lava-numbers",
    "fh-lava-compare",
    "fh-caverns-shapes",
    "fh-caverns-arrange",
    "fh-forge-switches",
    "fh-forge-circuit",
    "fh-summit-rocks",
    "fh-summit-island",
    "fh-heart-crystals",
    "fh-heart-restore",
    "fh-heart-return",
}


def test_the_heart_of_firepeak_imports_with_valid_puzzle_lines():
    import_content()

    assert Location.objects.get(slug="firepeak-heart").title == "Heart of Firepeak"
    assert set(NpcDefinition.objects.filter(home_location_slug="firepeak-heart").values_list(
        "npc_id", flat=True
    )) == NPCS

    lined = set()
    for npc in NpcDefinition.objects.filter(npc_id__in=NPCS):
        body = authoring.current_body(npc)
        problems: list[str] = []
        records.npc_dialogue_problems(body, records.ALL_AGE_BANDS, npc.npc_id, problems)
        assert problems == [], npc.npc_id
        lined |= {n["puzzleLine"]["puzzleId"] for n in body["dialogue"] if "puzzleLine" in n}
    assert lined == PUZZLES

    quest = Quest.objects.get(slug="the-heart-of-firepeak")
    body = authoring.current_body(quest)
    assert [s["id"] for s in body["stages"]] == [
        "fh-stage-landing",
        "fh-stage-emberwood",
        "fh-stage-lava",
        "fh-stage-caverns",
        "fh-stage-forge",
        "fh-stage-summit",
        "fh-stage-heart",
    ]
    assert body["completion"]["worldChanges"][0]["changeKey"] == "FIREPEAK_HEART_COMPLETE"

    assert ItemDefinition.objects.filter(item_id__startswith="fh-").count() == 24
    assert RewardRule.objects.filter(rule_id__startswith="fh-rule-").count() == 14
    crystals = CollectibleSet.objects.get(set_id="fh-set-elemental-crystals")
    assert crystals.completion_item.item_id == "fh-badge-crystal-collector"
    assert CollectibleSet.objects.get(set_id="fh-set-ember-shards").completion_item.item_id == (
        "fh-badge-master-explorer"
    )
    scientist = RewardRule.objects.get(rule_id="fh-rule-scientist")
    assert scientist.trigger == {
        "type": "WORLD_CHANGE",
        "changeKey": "FIREPEAK_HEART_SUMMIT_REACHED",
    }


def test_existing_firepeak_volcano_content_is_unchanged():
    import_content()

    ember = NpcDefinition.objects.get(npc_id="professor-ember")
    dialogue = authoring.current_body(ember)["dialogue"]
    assert sum("puzzleLine" in n for n in dialogue) == 19
    assert ember.home_location_slug == "firepeak-volcano"
    quest = authoring.current_body(Quest.objects.get(slug="the-volcano-awakens"))
    assert len(quest["stages"]) == 5
    assert RewardRule.objects.filter(rule_id__startswith="reward-firepeak-").count() == 3
    assert ItemDefinition.objects.filter(item_id="volcano-explorer-badge").exists()
