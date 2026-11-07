"""The Great Storybook quests on the server (SC-R04-01), against the real imported content.

Three quests, one per age band, each on its own page set. A page is derived from a record the
castle's existing content already writes, so these tests set those records and watch the quest
follow: nothing here grants a page.
"""

import pytest
from django.utils import timezone

from apps.catalog.models import Quest, RewardRule
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression import discoveries
from apps.progression.models import NpcRelationship, WorldChange
from apps.progression.services import record_world_change
from apps.quests import services
from apps.quests.models import QuestProgress, QuestStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

NOOK = "castle-tapestry-stair"
SPROUTS = "restore-the-great-storybook-sprouts"
PATHFINDERS = "restore-the-great-storybook-pathfinders"
EXPLORERS = "restore-the-great-storybook-explorers"
SEAL = "great-storybook-seal"


#: A session length the profile's own constraint accepts for each band (Sprouts: 5 to 8 minutes).
MINUTES = {"SPROUT": 6, "PATHFINDER": 10, "EXPLORER": 12}


def band(child, value):
    child.age_band = value
    child.session_minutes = MINUTES[value]
    child.save()
    return child


def meet_quill(child):
    now = timezone.now()
    NpcRelationship.objects.create(
        child=child,
        npc_id="keeper-quill",
        relationship_points=1,
        relationship_level="STRANGER",
        memory_flags={"metQuill": True},
        first_met_at=now,
        last_interacted_at=now,
    )


def write(child, key, location="storykeeper-castle"):
    record_world_change(child, location_slug=location, change_type="CREATE", change_key=key)


def refresh(child, slug):
    """Accept the quest, walk it against the child's real records, grant what completion owes."""
    quest = Quest.objects.get(slug=slug)
    progress, _ = services.start_quest(child, quest)
    update = services.refresh_quest(progress)
    return update, services.grant_quest_completion_rewards(child, [update])


def restored(child) -> int:
    return (
        WorldChange.objects.for_child(child).filter(change_key="GREAT_STORYBOOK_RESTORED").count()
    )


def seals(child) -> int:
    return InventoryItem.objects.for_child(child).filter(item__item_id=SEAL).count()


# --- the content -----------------------------------------------------------------------------


def test_three_quests_are_imported_one_per_band_with_their_own_pages(treasure):
    expected = {
        SPROUTS: ("SPROUT", {"FIRST_STORY_TOLD"}),
        PATHFINDERS: ("PATHFINDER", {"FIRST_STORY_TOLD"}),
        EXPLORERS: (
            "EXPLORER",
            {
                "SECRET_DOOR_CLUES_COLLECTED",
                "CASTLE_SECRET_DOOR_OPENED",
                "THE_CASTLES_SECRET_DOOR_COMPLETE",
            },
        ),
    }
    for slug, (age_band, keys) in expected.items():
        quest = Quest.objects.get(slug=slug)
        assert quest.age_bands == [age_band]
        objectives = [o for stage in quest.source["stages"] for o in stage["objectives"]]
        assert {o["changeKey"] for o in objectives if o["kind"] == "BUILD"} == keys
        # The hidden nook page is an optional bonus in every band, with a vague, unspoilt label.
        [bonus] = [o for o in objectives if o["kind"] == "DISCOVER"]
        assert bonus["discoveryKey"] == NOOK and bonus["optional"] is True
        assert "tapestry" not in bonus["label"].lower() and "stair" not in bonus["label"].lower()


def test_each_quest_is_offered_by_keeper_quill_and_ends_with_the_same_effects(treasure):
    for slug in (SPROUTS, PATHFINDERS, EXPLORERS):
        completion = Quest.objects.get(slug=slug).source["completion"]
        assert [c["changeKey"] for c in completion["worldChanges"]] == ["GREAT_STORYBOOK_RESTORED"]
        assert completion["setsNpcMemoryFlags"] == [
            {"npcId": "keeper-quill", "flags": ["restoredTheStorybook"]}
        ]
        rule = RewardRule.objects.get(rule_id=f"reward-{slug}")
        assert rule.trigger == {"type": "QUEST_COMPLETED", "questId": slug}
        assert [i.item_id for i in rule.items.all()] == [SEAL]


# --- eligibility -----------------------------------------------------------------------------


def test_a_child_can_start_only_their_own_bands_quest(treasure):
    child = band(treasure.families.a1, "PATHFINDER")
    for slug in (SPROUTS, EXPLORERS):
        with pytest.raises(services.QuestUnavailable):
            services.start_quest(child, Quest.objects.get(slug=slug))
    progress, created = services.start_quest(child, Quest.objects.get(slug=PATHFINDERS))
    assert created and progress.status == QuestStatus.ACTIVE


# --- the lifecycle ---------------------------------------------------------------------------


def test_a_pathfinder_restores_the_book_by_telling_the_first_story(treasure):
    child = band(treasure.families.a1, "PATHFINDER")
    update, rewards = refresh(child, PATHFINDERS)
    assert update.progress.status == QuestStatus.ACTIVE and not rewards
    meet_quill(child)
    update, _ = refresh(child, PATHFINDERS)
    assert update.progress.current_stage_id == "bring-back-the-pages"

    write(child, "FIRST_STORY_TOLD")
    update, rewards = refresh(child, PATHFINDERS)
    assert update.progress.status == QuestStatus.COMPLETED and update.result.just_completed
    assert restored(child) == 1 and seals(child) == 1
    assert [r.grant.granted for r in rewards] == [True]


def test_replaying_a_finished_quest_changes_and_grants_nothing(treasure):
    child = band(treasure.families.a1, "PATHFINDER")
    meet_quill(child)
    write(child, "FIRST_STORY_TOLD")
    refresh(child, PATHFINDERS)
    again, rewards = refresh(child, PATHFINDERS)
    assert not again.result.changed and not again.result.just_completed and not rewards
    assert restored(child) == 1 and seals(child) == 1
    assert QuestProgress.objects.for_child(child).count() == 1
    assert (
        GrantedRule.objects.for_child(child).filter(rule__rule_id=f"reward-{PATHFINDERS}").count()
        == 1
    )


def test_a_sprout_restores_the_book_with_the_same_page(treasure):
    child = band(treasure.families.a1, "SPROUT")
    meet_quill(child)
    write(child, "FIRST_STORY_TOLD")
    update, _ = refresh(child, SPROUTS)
    assert update.progress.status == QuestStatus.COMPLETED and restored(child) == 1


def test_an_explorer_needs_all_three_pages_and_not_the_hidden_one(treasure):
    child = band(treasure.families.a1, "EXPLORER")
    meet_quill(child)
    keys = [
        "SECRET_DOOR_CLUES_COLLECTED",
        "CASTLE_SECRET_DOOR_OPENED",
        "THE_CASTLES_SECRET_DOOR_COMPLETE",
    ]
    for key in keys[:2]:
        write(child, key, "castle-secret-passage")
        update, _ = refresh(child, EXPLORERS)
        assert update.progress.status == QuestStatus.ACTIVE
    assert restored(child) == 0
    write(child, keys[2], "castle-secret-passage")
    update, _ = refresh(child, EXPLORERS)
    assert update.progress.status == QuestStatus.COMPLETED
    assert "storybook-page-tapestry" not in update.progress.completed_objective_ids
    assert restored(child) == 1 and seals(child) == 1


def test_the_hidden_page_counts_when_found_but_never_when_missing(treasure):
    child = band(treasure.families.a1, "PATHFINDER")
    meet_quill(child)
    discoveries.record_discovery(child, NOOK)  # the server's own record, SC-R04-00
    write(child, "FIRST_STORY_TOLD")
    update, _ = refresh(child, PATHFINDERS)
    assert update.progress.status == QuestStatus.COMPLETED
    assert "storybook-page-tapestry" in update.progress.completed_objective_ids


def test_finding_only_the_hidden_page_does_not_restore_the_book(treasure):
    child = band(treasure.families.a1, "PATHFINDER")
    meet_quill(child)
    discoveries.record_discovery(child, NOOK)
    update, rewards = refresh(child, PATHFINDERS)
    assert update.progress.status == QuestStatus.ACTIVE and not rewards
    assert "storybook-page-tapestry" in update.progress.completed_objective_ids
    assert restored(child) == 0 and seals(child) == 0


def test_a_required_page_cannot_be_satisfied_by_a_different_record(treasure):
    child = band(treasure.families.a1, "EXPLORER")
    meet_quill(child)
    # Every other castle record in the world, but none of the three the Explorer's pages name.
    for key in ("FIRST_STORY_TOLD", "CASTLE_READING_NOOK_FOUND", "GREAT_STORYBOOK_RESTORED"):
        write(child, key)
    update, _ = refresh(child, EXPLORERS)
    assert update.progress.status == QuestStatus.ACTIVE


def test_quill_must_be_met_first_and_one_childs_records_never_count_for_a_sibling(treasure):
    a1 = band(treasure.families.a1, "PATHFINDER")
    a2 = band(treasure.families.a2, "PATHFINDER")
    write(a1, "FIRST_STORY_TOLD")
    update, _ = refresh(a1, PATHFINDERS)
    assert update.progress.status == QuestStatus.ACTIVE  # the page is back, but Quill was not met
    meet_quill(a2)
    update, rewards = refresh(a2, PATHFINDERS)
    assert update.progress.status == QuestStatus.ACTIVE and not rewards
    assert restored(a2) == 0 and seals(a2) == 0
