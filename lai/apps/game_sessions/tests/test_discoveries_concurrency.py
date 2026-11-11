"""Two simultaneous finds of the same secret (SC-R04-00): real parallel transactions on
PostgreSQL. The row lock decides, not timing: exactly one find is `FOUND_NOW`, and the world
change and the reward are written once."""

import pytest

from apps.game_sessions.tests.test_concurrency import race
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression import discoveries
from apps.progression.models import WorldChange, WorldState

pytestmark = [pytest.mark.postgres, pytest.mark.django_db(transaction=True)]

NOOK = "castle-tapestry-stair"


def test_two_simultaneous_finds_record_one_world_change_and_grant_one_book(treasure):
    child = treasure.families.a1
    results = race(lambda: discoveries.record_discovery(child, NOOK), count=4)
    outcomes = [r for r in results if isinstance(r, discoveries.DiscoveryOutcome)]
    assert len(outcomes) == 4, results
    assert sorted(o.status for o in outcomes) == sorted(
        [discoveries.FOUND_NOW] + [discoveries.ALREADY_FOUND] * 3
    )
    assert WorldState.objects.get(child=child).discovered_objects == [NOOK]
    assert (
        WorldChange.objects.for_child(child).filter(change_key="CASTLE_READING_NOOK_FOUND").count()
        == 1
    )
    assert GrantedRule.objects.for_child(child).count() == 1
    assert (
        InventoryItem.objects.for_child(child).filter(item__item_id="blank-page-storybook").count()
        == 1
    )
