"""Reward grants (Treasure Rush TR-4/TR-5). The Django form of the client's `grantRewards`."""

from dataclasses import dataclass

from django.db import transaction

from .models import GrantedRule, InventoryItem


@dataclass(frozen=True)
class RewardGrant:
    granted: bool
    """False when this rule had already fired for this child: nothing was given again."""
    new_item_ids: tuple[str, ...] = ()
    """Items the child did not own before this grant (an item from another rule is not new)."""


def grant_reward_rule(child, rule, *, source_session=None) -> RewardGrant:
    """Fire `rule` (a `catalog.RewardRule`) for `child` once. Replays grant nothing.

    The `GrantedRule` row is claimed first, under its unique constraint, so of two concurrent
    grants exactly one proceeds to add items. Must run inside the caller's transaction when
    combined with other writes.
    """
    with transaction.atomic():
        _, claimed = GrantedRule.objects.get_or_create(
            child=child, rule=rule, defaults={"source_session": source_session}
        )
        if not claimed:
            return RewardGrant(granted=False)
        new_items = []
        for item in rule.items.order_by("item_id"):
            _, created = InventoryItem.objects.get_or_create(
                child=child,
                item=item,
                defaults={"source_rule": rule, "source_session": source_session},
            )
            if created:
                new_items.append(item.item_id)
        new_items.extend(
            _complete_sets(child, rule, new_items, source_session=source_session)
        )
        return RewardGrant(granted=True, new_item_ids=tuple(new_items))


def _complete_sets(child, rule, new_item_ids, *, source_session=None) -> list[str]:
    """Give each collectible set's completion item once every member is owned (FPV-18).

    The server form of the client's `completionItemsToGrant` (`rewards/sets.ts`). Only sets
    touched by this grant are checked; the item is added with `get_or_create`, so a completion
    item is never given twice, and a set without a completion item gives nothing.
    """
    from apps.catalog.models import CollectibleSet

    if not new_item_ids:
        return []
    granted: list[str] = []
    sets = (
        CollectibleSet.objects.filter(
            items__item_id__in=new_item_ids, completion_item__isnull=False
        )
        .select_related("completion_item")
        .distinct()
        .order_by("set_id")
    )
    for collectible_set in sets:
        members = set(collectible_set.items.values_list("item_id", flat=True))
        owned = set(
            InventoryItem.objects.for_child(child)
            .filter(item__item_id__in=members)
            .values_list("item__item_id", flat=True)
        )
        if members and members <= owned:
            _, created = InventoryItem.objects.get_or_create(
                child=child,
                item=collectible_set.completion_item,
                defaults={"source_rule": rule, "source_session": source_session},
            )
            if created:
                granted.append(collectible_set.completion_item.item_id)
    return granted


def owned_item_ids(child) -> set[str]:
    return set(InventoryItem.objects.for_child(child).values_list("item__item_id", flat=True))
