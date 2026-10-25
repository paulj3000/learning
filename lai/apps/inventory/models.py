"""Earned items and granted reward rules (LAI-0305, with Treasure Rush's grants, POST-MERGE-03).

Amplify keeps one `ChildInventory` row with two id arrays (`ownedItemIds`, `grantedRuleIds`).
Here each becomes rows (the documented choice for these two arrays): a uniqueness constraint
makes "owns this item" and "this rule already granted" database facts, which idempotent reward
writes rely on. Items and rules are catalog rows (`catalog.ItemDefinition`, `catalog.RewardRule`,
imported from the export), never deleted by an import, so PROTECT keeps every grant meaningful.
"""

from django.db import models
from django.utils.timezone import now

from apps.core.models import ChildOwnedModel


class InventoryItem(ChildOwnedModel):
    CHILD_LINKS = ("source_session",)

    item = models.ForeignKey("catalog.ItemDefinition", on_delete=models.PROTECT, related_name="owners")
    source_rule = models.ForeignKey(
        "catalog.RewardRule", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    source_session = models.ForeignKey(
        "game_sessions.AdventureSession", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+",
    )
    acquired_at = models.DateTimeField(default=now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["child", "item"], name="inventory_item_once")]


class GrantedRule(ChildOwnedModel):
    CHILD_LINKS = ("source_session",)

    rule = models.ForeignKey("catalog.RewardRule", on_delete=models.PROTECT, related_name="grants")
    source_session = models.ForeignKey(
        "game_sessions.AdventureSession", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+",
    )
    granted_at = models.DateTimeField(default=now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["child", "rule"], name="granted_rule_once")]
