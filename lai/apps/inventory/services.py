"""Reward grants (Treasure Rush TR-4/TR-5, LAI-0604). The Django form of the client's `grantRewards`.

The rules are the Reward Engine's (`react/src/features/rewards`, ADR-011):
- a trigger grants every matching rule (`apps.inventory.rewards`, the golden-vector port), with
  no randomness and no weighting;
- a rule fires at most once per child (`GrantedRule`, `granted_rule_once`): replaying an
  adventure, retrying a request or racing two requests grants nothing a second time;
- an item is owned or not (`InventoryItem`, `inventory_item_once`), never a quantity;
- finishing a collectible set grants its completion cosmetic in the same write
  (`pendingSetCompletionItems`).

Only server code calls these, with a trigger the server derived from a graded outcome. There is
no route that grants anything.
"""

from dataclasses import dataclass, field

from django.db import transaction

from apps.catalog.models import CollectibleSet, ContentRelease, ItemDefinition, RewardRule

from . import rewards
from .models import GrantedRule, InventoryItem


@dataclass(frozen=True)
class RewardGrant:
    granted: bool
    """False when this rule had already fired for this child: nothing was given again."""
    new_item_ids: tuple[str, ...] = ()
    """Items the child did not own before this grant (an item from another rule is not new),
    set-completion cosmetics included."""
    rule: RewardRule | None = None
    grant: GrantedRule | None = None
    item_ids: tuple[str, ...] = field(default=())
    """Every item the rule names, in authored order, whether new or already owned."""
    replayed: bool = False
    """A grant this event made when it was first processed, reported again for its replay."""


def _rule_item_ids(rule: RewardRule) -> tuple[str, ...]:
    authored = rule.source.get("itemIds") if isinstance(rule.source, dict) else None
    known = set(rule.items.values_list("item_id", flat=True))
    if isinstance(authored, list):
        return tuple(dict.fromkeys(i for i in authored if i in known))
    return tuple(sorted(known))


def _pending_set_items(child) -> list[ItemDefinition]:
    """Completion cosmetics for sets the child has just finished (`pendingSetCompletionItems`)."""
    owned = set(InventoryItem.objects.for_child(child).values_list("item_id", flat=True))
    pending = []
    for collectible_set in CollectibleSet.objects.exclude(completion_item=None).prefetch_related(
        "items"
    ):
        members = [item.pk for item in collectible_set.items.all()]
        if members and all(pk in owned for pk in members):
            if collectible_set.completion_item_id not in owned:
                pending.append(collectible_set.completion_item)
    return pending


def grant_reward_rule(child, rule, *, source_session=None, source_action=None) -> RewardGrant:
    """Fire `rule` (a `catalog.RewardRule`) for `child` once. Replays grant nothing.

    The `GrantedRule` row is claimed first, under its unique constraint, so of two concurrent
    grants exactly one proceeds to add items. Must run inside the caller's transaction when
    combined with other writes.
    """
    item_ids = _rule_item_ids(rule)
    with transaction.atomic():
        grant, claimed = GrantedRule.objects.get_or_create(
            child=child,
            rule=rule,
            defaults={"source_session": source_session, "source_action": source_action},
        )
        if not claimed:
            return RewardGrant(granted=False, rule=rule, grant=grant, item_ids=item_ids)
        new_items = []
        for item in ItemDefinition.objects.filter(item_id__in=item_ids):
            _, created = InventoryItem.objects.get_or_create(
                child=child,
                item=item,
                defaults={"source_rule": rule, "source_session": source_session},
            )
            if created:
                new_items.append(item.item_id)
        new_items.sort(key=item_ids.index)
        for cosmetic in _pending_set_items(child):
            _, created = InventoryItem.objects.get_or_create(
                child=child,
                item=cosmetic,
                defaults={"source_rule": rule, "source_session": source_session},
            )
            if created:
                new_items.append(cosmetic.item_id)
        return RewardGrant(
            granted=True, new_item_ids=tuple(new_items), rule=rule, grant=grant, item_ids=item_ids
        )


def current_rules() -> list[RewardRule]:
    """The reward table as published: rules in the latest content release, by `rule_id`."""
    release = ContentRelease.objects.order_by("-imported_at", "-id").first()
    if release is None:
        return []
    return list(RewardRule.objects.filter(last_seen_release=release).prefetch_related("items"))


def grant_for_trigger(
    child, trigger: dict, *, source_session=None, source_action=None
) -> list[RewardGrant]:
    """Every published rule `trigger` matches, each fired once for `child` (LAI-0604)."""
    rules = current_rules()
    table = [
        {
            "id": rule.rule_id,
            "trigger": rule.trigger if isinstance(rule.trigger, dict) else {},
            "itemIds": list(_rule_item_ids(rule)),
            "message": rule.message,
        }
        for rule in rules
    ]
    by_id = {rule.rule_id: rule for rule in rules}
    return [
        grant_reward_rule(
            child, by_id[match["ruleId"]], source_session=source_session, source_action=source_action
        )
        for match in rewards.resolve_rewards(table, trigger)
    ]


# The order one answer fires its triggers in (`submit_answer`): a step's own reward, then the
# adventure's. Within a trigger, rules fire in `rule_id` order (`current_rules`).
_EVENT_ORDER = {"WORLD_CHANGE": 0, "ADVENTURE_COMPLETED": 1}


def grants_recorded_for_action(action) -> list[RewardGrant]:
    """What an answer granted when it was first processed, for its replay (nothing new), in
    the order the answer granted them."""
    grants = list(GrantedRule.objects.filter(source_action=action).select_related("rule"))
    grants.sort(
        key=lambda g: (_EVENT_ORDER.get(_trigger_type(g.rule), len(_EVENT_ORDER)), g.rule.rule_id)
    )
    return [
        RewardGrant(
            granted=False, rule=g.rule, grant=g, item_ids=_rule_item_ids(g.rule), replayed=True
        )
        for g in grants
    ]


def _trigger_type(rule: RewardRule) -> str:
    return rule.trigger.get("type", "") if isinstance(rule.trigger, dict) else ""


def grants_recorded_for_completion(session) -> list[RewardGrant]:
    """The ADVENTURE_COMPLETED grants this session's completion made, for a repeated finalise."""
    grants = (
        GrantedRule.objects.filter(source_session=session, rule__trigger__type="ADVENTURE_COMPLETED")
        .select_related("rule")
        .order_by("rule__rule_id")
    )
    return [
        RewardGrant(
            granted=False, rule=g.rule, grant=g, item_ids=_rule_item_ids(g.rule), replayed=True
        )
        for g in grants
    ]


def owned_item_ids(child) -> set[str]:
    return set(InventoryItem.objects.for_child(child).values_list("item__item_id", flat=True))
