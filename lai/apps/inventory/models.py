"""Item catalog and reward rules (LAI-0304). Per-child inventory is LAI-0305.

ADR-011: there is no currency. A Treasure Rush "coin" is a KEEPSAKE item granted once by a
reward rule (proposed decision TR-D1), never a spendable balance.
"""

from django.db import models

from apps.core.catalog import AssetKind, AssetRefValidator


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
