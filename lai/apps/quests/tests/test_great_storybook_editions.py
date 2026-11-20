"""Versioned Great Storybook completion: a child who restored edition 1 keeps it when a later
edition adds a required page (`page-painted-words`, edition 2).

A legacy child here has exactly what a real one has in the database: the original quest COMPLETED,
the `GREAT_STORYBOOK_RESTORED` world change, and the seal, but no `STUDIO_PAGE_MENDED`. Asking for
the book writes nothing; the follow-up quest asks for the one new page and writes only
`GREAT_STORYBOOK_RESTORED_V2`, never a second seal.
"""

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.catalog.models import Quest, RewardRule
from apps.inventory.models import GrantedRule, InventoryItem
from apps.inventory.services import grant_reward_rule
from apps.progression.models import NpcRelationship, WorldChange
from apps.progression.services import record_world_change
from apps.quests import services
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions import great_storybook

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

PATHFINDERS = "restore-the-great-storybook-pathfinders"
MORE = "restore-the-great-storybook-pathfinders-more"
SPROUTS = "restore-the-great-storybook-sprouts"
EXPLORERS = "restore-the-great-storybook-explorers"
SEAL = "great-storybook-seal"


def band(child, value):
    child.age_band = value
    child.save()
    return child


def write(child, key, location="storykeeper-castle"):
    record_world_change(child, location_slug=location, change_type="CREATE", change_key=key)


def meet_quill(child):
    now = timezone.now()
    NpcRelationship.objects.create(
        child=child,
        npc_id="keeper-quill",
        relationship_level="STRANGER",
        memory_flags={"metQuill": True},
        first_met_at=now,
        last_interacted_at=now,
    )


def legacy_completed(child):
    """A Pathfinder who finished the book before the Painted Words page existed."""
    meet_quill(child)
    write(child, "FIRST_STORY_TOLD")
    write(child, "GREAT_STORYBOOK_RESTORED")
    at = timezone.now()
    quest = Quest.objects.get(slug=PATHFINDERS)
    QuestProgress.objects.create(
        child=child,
        quest=quest,
        status=QuestStatus.COMPLETED,
        current_stage_id="bring-back-the-pages",
        started_at=at,
        last_updated_at=at,
        completed_at=at,
    )
    grant_reward_rule(child, RewardRule.objects.get(rule_id=f"reward-{PATHFINDERS}"))


def refresh(child, slug):
    progress, _ = services.start_quest(child, Quest.objects.get(slug=slug))
    update = services.refresh_quest(progress)
    return update, services.grant_quest_completion_rewards(child, [update])


def count(child, key) -> int:
    return WorldChange.objects.for_child(child).filter(change_key=key).count()


def seals(child) -> int:
    return InventoryItem.objects.for_child(child).filter(item__item_id=SEAL).count()


def rows(child) -> tuple:
    return (
        WorldChange.objects.for_child(child).count(),
        QuestProgress.objects.for_child(child).count(),
        InventoryItem.objects.for_child(child).count(),
        GrantedRule.objects.for_child(child).count(),
    )


def test_a_completed_child_reads_restored_more_pages_with_everything_intact(treasure):
    child = band(treasure.families.a1, "PATHFINDER")
    legacy_completed(child)
    before = rows(child)
    with CaptureQueriesContext(connection) as queries:
        book = great_storybook.progress(child)
    assert book["state"] == great_storybook.RESTORED_MORE_PAGES
    assert book["complete"] is False  # strict meaning unchanged
    assert book["edition"] == 2
    assert book["quest"] == {"questId": PATHFINDERS, "status": "COMPLETED"}
    assert book["moreQuest"] == {"questId": MORE, "status": "NOT_STARTED"}
    # The new page is one the child can still find; the old one is back.
    restored = {page["id"]: page["restored"] for page in book["pages"]}
    assert restored == {"page-first-story": True, "page-painted-words": False}
    # A read writes nothing, and the old rewards are all still there.
    assert rows(child) == before
    writes = ("INSERT", "UPDATE", "DELETE")
    assert not [q["sql"] for q in queries if q["sql"].lstrip().upper().startswith(writes)]
    assert count(child, "GREAT_STORYBOOK_RESTORED") == 1 and seals(child) == 1
    assert count(child, "GREAT_STORYBOOK_RESTORED_V2") == 0


def test_the_endpoint_adds_the_state_and_writes_nothing(treasure, api):
    child = band(treasure.families.a1, "PATHFINDER")
    legacy_completed(child)
    before = rows(child)
    response = api(treasure.families.a).get(f"/api/v1/children/{child.pk}/castle/storybook/")
    assert response.status_code == 200
    body = response.json()
    # Additive: every earlier field is still there, with its meaning.
    for key in ("band", "pages", "restoredRequired", "totalRequired", "restoredBonus", "complete"):
        assert key in body
    assert body["state"] == "RESTORED_MORE_PAGES" and body["complete"] is False
    assert rows(child) == before


def test_the_new_page_completes_the_follow_up_once_and_grants_no_second_seal(treasure):
    child = band(treasure.families.a1, "PATHFINDER")
    legacy_completed(child)
    update, rewards = refresh(child, MORE)
    assert update.progress.status == QuestStatus.ACTIVE and not rewards
    assert count(child, "GREAT_STORYBOOK_RESTORED_V2") == 0

    write(child, "STUDIO_PAGE_MENDED")
    update, rewards = refresh(child, MORE)
    assert update.progress.status == QuestStatus.COMPLETED and update.result.just_completed
    assert rewards == []
    assert count(child, "GREAT_STORYBOOK_RESTORED_V2") == 1
    assert great_storybook.progress(child)["state"] == great_storybook.RESTORED
    assert great_storybook.progress(child)["complete"] is True

    # Replay: nothing changes, nothing is granted, nothing is duplicated.
    before = rows(child)
    again, rewards = refresh(child, MORE)
    assert not again.result.changed and not again.result.just_completed and not rewards
    assert rows(child) == before
    assert count(child, "GREAT_STORYBOOK_RESTORED") == 1
    assert count(child, "GREAT_STORYBOOK_RESTORED_V2") == 1
    assert seals(child) == 1
    original = QuestProgress.objects.for_child(child).get(quest__slug=PATHFINDERS)
    assert original.status == QuestStatus.COMPLETED


def test_the_follow_up_needs_the_original_to_be_completed(treasure):
    child = band(treasure.families.a1, "PATHFINDER")
    with pytest.raises(services.QuestUnavailable):
        services.start_quest(child, Quest.objects.get(slug=MORE))


def test_a_new_pathfinder_gets_both_changes_in_one_completion(treasure):
    child = band(treasure.families.a1, "PATHFINDER")
    meet_quill(child)
    write(child, "FIRST_STORY_TOLD")
    write(child, "STUDIO_PAGE_MENDED")
    update, rewards = refresh(child, PATHFINDERS)
    assert update.progress.status == QuestStatus.COMPLETED and update.result.just_completed
    assert count(child, "GREAT_STORYBOOK_RESTORED") == 1
    assert count(child, "GREAT_STORYBOOK_RESTORED_V2") == 1
    assert [r.grant.granted for r in rewards] == [True] and seals(child) == 1
    assert great_storybook.progress(child)["state"] == great_storybook.RESTORED

    # The follow-up is trivially satisfied if asked for, and still duplicates nothing.
    follow, rewards = refresh(child, MORE)
    assert follow.progress.status == QuestStatus.COMPLETED and rewards == []
    assert count(child, "GREAT_STORYBOOK_RESTORED_V2") == 1 and seals(child) == 1


def test_sprouts_and_explorers_are_unchanged(treasure):
    sprout = band(treasure.families.a1, "SPROUT")
    meet_quill(sprout)
    write(sprout, "FIRST_STORY_TOLD")
    update, _ = refresh(sprout, SPROUTS)
    assert update.progress.status == QuestStatus.COMPLETED
    assert count(sprout, "GREAT_STORYBOOK_RESTORED") == 1
    assert count(sprout, "GREAT_STORYBOOK_RESTORED_V2") == 0
    book = great_storybook.progress(sprout)
    assert book["state"] == great_storybook.RESTORED and book["moreQuest"] is None
    with pytest.raises(services.QuestUnavailable):
        services.start_quest(sprout, Quest.objects.get(slug=MORE))

    explorer = band(treasure.families.a2, "EXPLORER")
    meet_quill(explorer)
    for key in (
        "SECRET_DOOR_CLUES_COLLECTED",
        "CASTLE_SECRET_DOOR_OPENED",
        "THE_CASTLES_SECRET_DOOR_COMPLETE",
    ):
        write(explorer, key, "castle-secret-passage")
    update, _ = refresh(explorer, EXPLORERS)
    assert update.progress.status == QuestStatus.COMPLETED
    assert count(explorer, "GREAT_STORYBOOK_RESTORED_V2") == 0
    assert great_storybook.progress(explorer)["state"] == great_storybook.RESTORED
    with pytest.raises(services.QuestUnavailable):
        services.start_quest(explorer, Quest.objects.get(slug=MORE))


def test_siblings_never_share_an_edition_standing(treasure):
    legacy = band(treasure.families.a1, "PATHFINDER")
    other = band(treasure.families.a2, "PATHFINDER")
    legacy_completed(legacy)
    assert great_storybook.progress(other)["state"] == great_storybook.IN_PROGRESS
    write(legacy, "STUDIO_PAGE_MENDED")
    refresh(legacy, MORE)
    assert great_storybook.progress(legacy)["state"] == great_storybook.RESTORED
    assert great_storybook.progress(other)["state"] == great_storybook.IN_PROGRESS
    assert count(other, "GREAT_STORYBOOK_RESTORED_V2") == 0 and seals(other) == 0
