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
        return RewardGrant(granted=True, new_item_ids=tuple(new_items))


def owned_item_ids(child) -> set[str]:
    return set(InventoryItem.objects.for_child(child).values_list("item__item_id", flat=True))
