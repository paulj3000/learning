"""Reward grant shapes (LAI-0604). Contract: docs/PLAY_API.md, "Rewards".

A grant names the rule that fired, the authored message, every item the rule gives and which
of them were new to the child. Items use the existing item shape (`ItemSerializer`), so reward
feedback and the backpack (`inventory/`) describe an item identically. No rule internals (the
trigger's keys), no other rules, and nothing about unpublished content are returned.
"""

from apps.catalog.models import ItemDefinition
from apps.game_sessions.serializers import ItemSerializer


def _items(item_ids) -> list[dict]:
    by_id = {item.item_id: item for item in ItemDefinition.objects.filter(item_id__in=item_ids)}
    return [ItemSerializer(by_id[i]).data for i in item_ids if i in by_id]


def grant_body(grant, *, newly_granted: bool) -> dict:
    """One `GrantedRule` as a client sees it."""
    rule = grant.rule
    trigger = rule.trigger if isinstance(rule.trigger, dict) else {}
    authored = rule.source.get("itemIds", []) if isinstance(rule.source, dict) else []
    return {
        "grantId": str(grant.pk),
        "ruleId": rule.rule_id,
        "source": trigger.get("type", ""),
        "message": rule.message,
        "newlyGranted": newly_granted,
        "grantedAt": grant.granted_at.isoformat(),
        "items": _items(
            list(dict.fromkeys(authored)) or sorted(rule.items.values_list("item_id", flat=True))
        ),
    }


def rewards_body(grants) -> dict:
    """The additive `rewards` object on answer and completion responses.

    - `grants`: the rules this event fired, `newlyGranted: true`, or, for a replayed request,
      the rules its first processing fired, `newlyGranted: false`. A rule that already fired in
      an earlier, different event (a second play-through) is not this event's reward and is not
      listed.
    - `newItems`: items new to the backpack because of this event, set-completion cosmetics
      included. Empty on a replay: nothing is new the second time.
    """
    shown = [g for g in grants if g.grant is not None and (g.granted or g.replayed)]
    new_items = [item for g in grants if g.granted for item in g.new_item_ids]
    return {
        "grants": [grant_body(g.grant, newly_granted=g.granted) for g in shown],
        "newItems": _items(list(dict.fromkeys(new_items))),
    }
