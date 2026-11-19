"""Quest-based Places in the Realm Explorer payload: the quests a published 3D Area offers this
child's band, and this child's own progress (additive `questCount`, `questsCompleted`,
`questsInProgress`, `completed`). Treasure Cove stands in for any quest-based Place."""

import pytest
from django.utils import timezone

from apps.core.content_status import ContentStatus
from apps.quests.models import QuestProgress, QuestStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

HOME = "learning-adventure-island"


def cove(client, child) -> dict:
    body = client.get(f"/api/v1/children/{child.pk}/islands/").json()
    for island in body["islands"]:
        for place in island["places"]:
            if place["area"] and place["area"]["regionId"] == "treasure-rush-cove":
                return place
    raise AssertionError("no Treasure Cove place")


def progress(child, quest, status):
    now = timezone.now()
    QuestProgress.objects.create(
        child=child,
        quest=quest,
        status=status,
        current_stage_id="s",
        started_at=now,
        last_updated_at=now,
        completed_at=now if status == QuestStatus.COMPLETED else None,
    )


def test_offered_quests_are_counted_and_not_started(treasure, api):
    place = cove(api(treasure.families.a), treasure.families.a1)
    total = treasure.region.offered_quests.filter(active=True).count()
    assert total >= 1
    assert place["questCount"] == total
    assert (place["questsCompleted"], place["questsInProgress"]) == (0, 0)
    assert place["completed"] is False


def test_progress_is_this_childs_own(treasure, api):
    f = treasure.families
    progress(f.a1, treasure.quest, QuestStatus.ACTIVE)
    progress(f.b1, treasure.quest, QuestStatus.COMPLETED)
    mine = cove(api(f.a), f.a1)
    assert mine["questsInProgress"] == 1 and mine["questsCompleted"] == 0
    assert mine["completed"] is False
    sibling = cove(api(f.a), f.a2)
    assert (sibling["questsInProgress"], sibling["questsCompleted"]) == (0, 0)


def test_all_offered_quests_completed_marks_the_place_completed(treasure, api):
    f = treasure.families
    for quest in treasure.region.offered_quests.filter(active=True):
        progress(f.a1, quest, QuestStatus.COMPLETED)
    place = cove(api(f.a), f.a1)
    assert place["completed"] is True
    assert place["questsCompleted"] == place["questCount"]
    # Still launchable for replay.
    assert place["area"]["available"] is True


def test_unpublished_area_lists_no_quests(treasure, api):
    f = treasure.families
    treasure.region.status = ContentStatus.DRAFT
    treasure.region.save(update_fields=["status"])
    body = api(f.a).get(f"/api/v1/children/{f.a1.pk}/islands/").json()
    for island in body["islands"]:
        for place in island["places"]:
            assert place["area"] is None
            assert (place["questCount"], place["completed"]) == (0, False)


def test_unsupported_band_lists_no_quests(treasure, api):
    f = treasure.families
    treasure.region.age_bands = ["EXPLORER"]
    treasure.region.save(update_fields=["age_bands"])
    body = api(f.a).get(f"/api/v1/children/{f.a1.pk}/islands/").json()
    for island in body["islands"]:
        for place in island["places"]:
            assert place["area"] is None and place["questCount"] == 0
