"""Two simultaneous completions of the same Great Storybook quest (SC-R04-01): real parallel
transactions on PostgreSQL. The progress row lock decides: the quest completes once, and its world
change and its seal are written once."""

import pytest
from django.utils import timezone

from apps.catalog.models import Quest
from apps.game_sessions.tests.test_concurrency import race
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import NpcRelationship, WorldChange
from apps.progression.services import record_world_change
from apps.quests import services
from apps.quests.models import QuestStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db(transaction=True)]

SLUG = "restore-the-great-storybook-pathfinders"


def test_four_simultaneous_refreshes_complete_the_quest_and_grant_the_seal_once(treasure):
    child = treasure.families.a1  # a Pathfinder
    now = timezone.now()
    NpcRelationship.objects.create(
        child=child,
        npc_id="keeper-quill",
        relationship_level="STRANGER",
        memory_flags={"metQuill": True},
        first_met_at=now,
        last_interacted_at=now,
    )
    record_world_change(
        child,
        location_slug="storykeeper-castle",
        change_type="CREATE",
        change_key="FIRST_STORY_TOLD",
    )
    progress, _ = services.start_quest(child, Quest.objects.get(slug=SLUG))

    def work():
        update = services.refresh_quest(progress)
        rewards = services.grant_quest_completion_rewards(child, [update])
        return update.result.just_completed, [r.grant.granted for r in rewards]

    results = race(work, count=4)
    assert len(results) == 4 and all(isinstance(r, tuple) for r in results), results
    assert sorted(r[0] for r in results) == [False, False, False, True]
    assert [g for _, grants in results for g in grants] == [True]
    progress.refresh_from_db()
    assert progress.status == QuestStatus.COMPLETED
    assert (
        WorldChange.objects.for_child(child).filter(change_key="GREAT_STORYBOOK_RESTORED").count()
        == 1
    )
    assert (
        InventoryItem.objects.for_child(child).filter(item__item_id="great-storybook-seal").count()
        == 1
    )
    assert GrantedRule.objects.for_child(child).count() == 1
