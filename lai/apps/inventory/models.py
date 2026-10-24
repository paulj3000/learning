"""Item catalog and reward rules (LAI-0304); what a child owns (LAI-0305 subset, TR-4).

ADR-011: there is no currency. A Treasure Rush "coin" is a KEEPSAKE item granted once by a
reward rule (proposed decision TR-D1), never a spendable balance.
"""

from django.db import models
from django.utils.timezone import now

from apps.core.catalog import AssetKind, AssetRefValidator
from apps.core.child_owned import ChildOwnedModel


class ItemCategory(models.TextChoices):
    COLLECTIBLE = "COLLECTIBLE"
    COSMETIC = "COSMETIC"
    QUEST_ITEM = "QUEST_ITEM"
    KEEPSAKE = "KEEPSAKE"


class ItemRarity(models.TextChoices):
    COMMON = "COMMON"
    UNCOMMON = "UNCOMMON"
    RARE = "RARE"


class CosmeticSlot(models.TextChoices):
    HAT = "HAT"
    BACKPACK = "BACKPACK"
    ACCESSORY = "ACCESSORY"
    OUTFIT = "OUTFIT"


class CollectibleSet(models.Model):
    set_id = models.SlugField(max_length=80, unique=True)
    display_name = models.CharField(max_length=120)
    completion_item = models.ForeignKey(
        "ItemDefinition", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    completion_message = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["set_id"]

    def __str__(self) -> str:
        return self.set_id


class ItemDefinition(models.Model):
    item_id = models.SlugField(max_length=80, unique=True)
    display_name = models.CharField(max_length=120)
    description = models.CharField(max_length=300)
    category = models.CharField(max_length=16, choices=ItemCategory.choices)
    rarity = models.CharField(max_length=16, choices=ItemRarity.choices)
    cosmetic_slot = models.CharField(max_length=16, choices=CosmeticSlot.choices, blank=True)
    hidden = models.BooleanField(default=False)
    collectible_set = models.ForeignKey(
        CollectibleSet, null=True, blank=True, on_delete=models.PROTECT, related_name="items"
    )
    asset_id = models.CharField(
        max_length=80,
        blank=True,
        validators=[AssetRefValidator(AssetKind.COLLECTIBLE, AssetKind.PROP)],
        help_text="3D model id from the asset manifest. Empty uses a placeholder.",
    )

    class Meta:
        ordering = ["item_id"]

    def __str__(self) -> str:
        return self.item_id


class RewardRule(models.Model):
    """What a trigger grants. `trigger` keeps the exported shape, e.g.
    `{"type": "ADVENTURE_COMPLETED", "templateSlug": "..."}`; Treasure Rush adds
    `{"type": "CHEST_OPENED", "chestId": "..."}` (TR-5 evaluates it)."""

    rule_id = models.SlugField(max_length=80, unique=True)
    trigger = models.JSONField()
    items = models.ManyToManyField(ItemDefinition, related_name="reward_rules")
    message = models.CharField(max_length=300)

    class Meta:
        ordering = ["rule_id"]

    def __str__(self) -> str:
        return self.rule_id


# --- What a child owns (TR-4) ----------------------------------------------------------------
#
# The Amplify `ChildInventory` row (`ownedItemIds`, `grantedRuleIds`) as rows, as the migration
# assessment maps it. Ownership is a set, not a quantity (docs/DATA_MODEL.md "ChildInventory"):
# one row per child and item, enforced by the database. There is no count to stack, spend, or
# lose; a stackable item would be a product change (ADR-011), not a schema tweak.


class InventoryItem(ChildOwnedModel):
    CHILD_LINKS = ("source_session",)

    child = models.ForeignKey(
        "users.ChildProfile", on_delete=models.CASCADE, related_name="inventory_items"
    )
    # PROTECT: an item a child owns is retired from the catalog, never deleted from under them.
    item = models.ForeignKey(ItemDefinition, on_delete=models.PROTECT, related_name="owners")
    source_rule = models.ForeignKey(
        RewardRule, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    source_session = models.ForeignKey(
        "game_sessions.AdventureSession",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    granted_at = models.DateTimeField(default=now)

    class Meta:
        ordering = ["granted_at"]
        constraints = [
            models.UniqueConstraint(fields=["child", "item"], name="inventory_item_owned_once")
        ]

    def __str__(self) -> str:
        return str(self.item_id)


class GrantedRewardRule(ChildOwnedModel):
    """`grantedRuleIds`: the idempotency key. A rule fires at most once per child."""

    CHILD_LINKS = ("source_session",)

    child = models.ForeignKey(
        "users.ChildProfile", on_delete=models.CASCADE, related_name="granted_reward_rules"
    )
    rule = models.ForeignKey(RewardRule, on_delete=models.PROTECT, related_name="grants")
    source_session = models.ForeignKey(
        "game_sessions.AdventureSession",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    granted_at = models.DateTimeField(default=now)

    class Meta:
        ordering = ["granted_at"]
        constraints = [
            models.UniqueConstraint(fields=["child", "rule"], name="inventory_rule_granted_once")
        ]

    def __str__(self) -> str:
        return str(self.rule_id)
