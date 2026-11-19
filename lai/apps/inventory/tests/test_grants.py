"""Reward grants and ownership (TR-4): one-time rules, set ownership, no currency."""

import pytest
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError

from apps.catalog.models import ItemDefinition, RewardRule
from apps.core.models import CrossChildReference
from apps.game_sessions.play import start_or_resume_region_session
from apps.inventory.models import GrantedRule, InventoryItem
from apps.inventory.services import grant_reward_rule, owned_item_ids

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def chest_rule(treasure):
    return treasure.chest.reward_rule


def test_a_rule_grants_its_items_once(treasure, chest_rule):
    child = treasure.families.a1
    first = grant_reward_rule(child, chest_rule)
    again = grant_reward_rule(child, chest_rule)
    assert first.granted and first.new_item_ids == ("golden-doubloon",)
    assert not again.granted and again.new_item_ids == ()
    assert InventoryItem.objects.filter(child=child).count() == 1
    assert GrantedRule.objects.filter(child=child).count() == 1


def test_an_item_already_owned_is_not_new_and_not_duplicated(treasure, chest_rule):
    child = treasure.families.a1
    second_rule = RewardRule.objects.create(
        rule_id="also-a-doubloon",
        trigger={"type": "WORLD_CHANGE", "changeKey": "x"},
        message="m",
        source={},
        last_seen_release=chest_rule.last_seen_release,
    )
    second_rule.items.add(ItemDefinition.objects.get(item_id="golden-doubloon"))
    grant_reward_rule(child, chest_rule)
    result = grant_reward_rule(child, second_rule)
    assert result.granted and result.new_item_ids == ()
    assert owned_item_ids(child) == {"golden-doubloon"}


def test_ownership_is_per_child(treasure, chest_rule):
    grant_reward_rule(treasure.families.a1, chest_rule)
    assert grant_reward_rule(treasure.families.b1, chest_rule).granted
    assert owned_item_ids(treasure.families.a2) == set()


def test_ownership_is_a_set_in_the_database(treasure):
    item = ItemDefinition.objects.get(item_id="golden-doubloon")
    InventoryItem.objects.create(child=treasure.families.a1, item=item)
    with pytest.raises(IntegrityError), transaction.atomic():
        InventoryItem.objects.create(child=treasure.families.a1, item=item)


def test_a_rule_fires_once_in_the_database(treasure, chest_rule):
    GrantedRule.objects.create(child=treasure.families.a1, rule=chest_rule)
    with pytest.raises(IntegrityError), transaction.atomic():
        GrantedRule.objects.create(child=treasure.families.a1, rule=chest_rule)


def test_an_owned_item_cannot_be_deleted_from_the_catalog(treasure, chest_rule):
    grant_reward_rule(treasure.families.a1, chest_rule)
    with pytest.raises(ProtectedError):
        ItemDefinition.objects.get(item_id="golden-doubloon").delete()


def test_there_is_no_quantity_or_balance_to_increase():
    fields = {field.name for field in InventoryItem._meta.get_fields()}
    assert not fields & {"quantity", "count", "balance", "amount"}


def test_a_grant_cannot_cite_another_childs_session(treasure, chest_rule):
    other_session, _ = start_or_resume_region_session(treasure.families.b1, treasure.region)
    with pytest.raises(CrossChildReference):
        grant_reward_rule(treasure.families.a1, chest_rule, source_session=other_session)
    assert not GrantedRule.objects.exists() and not InventoryItem.objects.exists()


def _rule(rule_id, items, release):
    rule = RewardRule.objects.create(
        rule_id=rule_id,
        trigger={"type": "WORLD_CHANGE", "changeKey": rule_id.upper()},
        message="m",
        source={},
        last_seen_release=release,
    )
    rule.items.add(*items)
    return rule


def test_owning_every_set_member_grants_the_completion_item_once(treasure, chest_rule):
    """FPV-18: the server form of the client's completionItemsToGrant."""
    from apps.catalog.models import CollectibleSet

    release = chest_rule.last_seen_release
    badge = ItemDefinition.objects.create(
        item_id="set-test-badge", display_name="Badge", category="KEEPSAKE", rarity="COMMON",
        source={}, last_seen_release=release,
    )
    collectible_set = CollectibleSet.objects.create(
        set_id="set-test", display_name="Set", completion_item=badge, source={},
        last_seen_release=release,
    )
    members = [
        ItemDefinition.objects.create(
            item_id=f"set-test-{n}", display_name=f"Member {n}", category="COLLECTIBLE",
            rarity="COMMON", collectible_set=collectible_set, source={}, last_seen_release=release,
        )
        for n in (1, 2)
    ]
    child = treasure.families.a1
    first = grant_reward_rule(child, _rule("set-test-one", members[:1], release))
    assert first.new_item_ids == ("set-test-1",)
    assert "set-test-badge" not in owned_item_ids(child)
    second = grant_reward_rule(child, _rule("set-test-two", members[1:], release))
    assert second.new_item_ids == ("set-test-2", "set-test-badge")
    # Another rule giving a member again neither re-grants nor duplicates the badge.
    third = grant_reward_rule(child, _rule("set-test-three", members, release))
    assert third.new_item_ids == ()
    assert InventoryItem.objects.filter(child=child, item=badge).count() == 1
    assert "set-test-badge" not in owned_item_ids(treasure.families.a2)
