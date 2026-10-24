"""Earned items and granted reward rules (LAI-0305).

Amplify keeps one `ChildInventory` row with two id arrays (`ownedItemIds`, `grantedRuleIds`).
Here each becomes rows (the documented choice for these two arrays): a uniqueness constraint
then makes "owns this item" and "this rule already granted" database facts, which the
idempotent reward writes of LAI-0604 rely on. Item and rule ids are the export's stable ids;
`ItemDefinition` and reward-rule catalog models do not exist yet (proposed LAI-0309).
"""

from django.db import models

from apps.core.models import ChildOwnedModel


class InventoryItem(ChildOwnedModel):
    item_id = models.CharField(max_length=100)
    acquired_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["child", "item_id"], name="inventory_item_once")]


class GrantedRule(ChildOwnedModel):
    rule_id = models.CharField(max_length=100)
    granted_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["child", "rule_id"], name="granted_rule_once")]
