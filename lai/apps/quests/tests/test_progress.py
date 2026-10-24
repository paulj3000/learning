"""Quest progress (TR-4): availability, idempotent start, server-derived completion."""

import pytest
from django.db import IntegrityError, transaction

from apps.core.catalog import ContentStatus
from apps.progression.models import WorldChange
from apps.progression.services import record_world_change_once
from apps.quests.models import QuestDefinition, QuestProgress, QuestStatus
from apps.quests.services import QuestUnavailable, refresh_quest, start_quest

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

CHEST_KEY = "TREASURE_RUSH_COVE_CHEST_OPENED"


def open_chest(child):
    record_world_change_once(
        child, location_slug="pirate-builder-bay", change_type="UNLOCK", change_key=CHEST_KEY
    )


def test_starting_is_idempotent(treasure):
    child = treasure.families.a1
    first, created = start_quest(child, treasure.quest)
    again, created_again = start_quest(child, treasure.quest)
    assert created and not created_again and first.pk == again.pk
    assert (first.status, first.current_stage_id) == (QuestStatus.ACTIVE, "open-the-chest")
    assert first.completed_at is None


@pytest.mark.parametrize("status", [ContentStatus.DRAFT, ContentStatus.RETIRED])
def test_an_unpublished_quest_cannot_start(treasure, status):
    QuestDefinition.objects.filter(pk=treasure.quest.pk).update(status=status)
    treasure.quest.refresh_from_db()
    with pytest.raises(QuestUnavailable):
        start_quest(treasure.families.a1, treasure.quest)


def test_a_quest_for_other_age_bands_cannot_start(treasure):
    treasure.quest.age_bands = ["SPROUT"]
    treasure.quest.save()
    with pytest.raises(QuestUnavailable):
        start_quest(treasure.families.a1, treasure.quest)


def test_prerequisites_are_checked_on_the_server(treasure):
    treasure.quest.prerequisites = [{"type": "ITEM_OWNED", "itemId": "spiral-shell"}]
    treasure.quest.save()
    with pytest.raises(QuestUnavailable):
        start_quest(treasure.families.a1, treasure.quest)


def test_refresh_does_nothing_until_the_world_says_so(treasure):
    progress, _ = start_quest(treasure.families.a1, treasure.quest)
    update = refresh_quest(progress)
    assert not update.result.changed
    assert update.progress.status == QuestStatus.ACTIVE


def test_the_quest_completes_from_the_chest_world_change(treasure):
    child = treasure.families.a1
    progress, _ = start_quest(child, treasure.quest)
    open_chest(child)
    update = refresh_quest(progress)
    assert update.result.just_completed
    progress.refresh_from_db()
    assert progress.status == QuestStatus.COMPLETED and progress.completed_at is not None
    assert progress.completed_stage_ids == ["open-the-chest"]
    assert progress.completed_objective_ids == ["treasure-cove-open-chest"]
    assert not refresh_quest(progress).result.changed


def test_a_siblings_open_chest_does_not_complete_my_quest(treasure):
    progress, _ = start_quest(treasure.families.a1, treasure.quest)
    open_chest(treasure.families.a2)
    assert refresh_quest(progress).progress.status == QuestStatus.ACTIVE


def test_stage_and_completion_world_changes_are_recorded_once(treasure):
    child = treasure.families.a1
    quest = treasure.quest
    quest.stages[0]["worldChanges"] = [
        {"locationSlug": "pirate-builder-bay", "changeType": "CREATE", "changeKey": "COVE_FLAG"}
    ]
    quest.completion["worldChanges"] = [
        {"locationSlug": "pirate-builder-bay", "changeType": "CREATE", "changeKey": "COVE_PARTY"}
    ]
    quest.save()
    progress, _ = start_quest(child, quest)
    open_chest(child)
    refresh_quest(progress)
    refresh_quest(progress)
    keys = sorted(WorldChange.objects.filter(child=child).values_list("change_key", flat=True))
    assert keys == ["COVE_FLAG", "COVE_PARTY", CHEST_KEY]


def test_the_database_keeps_one_row_per_child_and_quest(treasure):
    start_quest(treasure.families.a1, treasure.quest)
    with pytest.raises(IntegrityError), transaction.atomic():
        QuestProgress.objects.create(
            child=treasure.families.a1, quest=treasure.quest, current_stage_id="open-the-chest"
        )


@pytest.mark.parametrize(
    "fields",
    [{"status": QuestStatus.COMPLETED}, {"status": "AVAILABLE"}],
)
def test_the_database_refuses_inconsistent_progress(treasure, fields):
    progress, _ = start_quest(treasure.families.a1, treasure.quest)
    with pytest.raises(IntegrityError), transaction.atomic():
        QuestProgress.objects.filter(pk=progress.pk).update(**fields)
