"""The game content catalog (LAI-0304, ADR-019 sub-decision 8).

Hierarchy, as the content export actually shapes it (owner decision, 2026-10-24):

    World -> Location -> Adventure -> AdventureStep
    World -> Quest -> (adventures named by its SOLVE objectives)

- A World is a themed world (the export's `islands.json`; ADR-019's "Island").
- A Location is an explorable region in a world (`locations.json`). The Amplify catalog's
  `Island` record (ADR-031) is a Location, not a World.
- A Quest belongs to its world's content pack, not to one adventure: one quest can span two
  adventures, and some name none.

Two kinds of field, kept apart on purpose:

- *Content fields* come from the versioned JSON export and are replaced on every import until
  the content authoring cutover. `source` keeps the exported record exactly as exported, so
  nothing the export carries is lost even where it has no column here.
- *Catalog fields* (`active`, `sort_order`) belong to Django. The importer sets them only when
  it creates a row and never overwrites them afterwards.

Nothing is deleted by an import. A record the latest export no longer contains keeps its row,
and `last_seen_release` shows it was not in the latest release.

Spatial data (positions, spawn points, trigger zones) is not modelled here (LAI-0805). Asset
bytes and versions are not modelled here either: `ContentAsset` is the asset definition, keyed by
the same id as the bundled manifest and the Amplify `Asset.slug` (ADR-030), and the asset manager
(`apps.assets`, LAI-2200, ADR-035) attaches immutable versions to it.
"""

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.timezone import now

from apps.users.models import AgeBand

SLUG_LENGTH = 100


class ContentRelease(models.Model):
    """One successful import of a content export. Failed imports leave no row."""

    content_digest = models.CharField(max_length=64)
    schema_version = models.PositiveSmallIntegerField()
    export_tool = models.CharField(max_length=100)
    files = models.JSONField(help_text="The export manifest's file list: path, sha256, counts.")
    report = models.JSONField(help_text="What the import created, updated, kept and skipped.")
    imported_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-imported_at", "-id"]
        indexes = [models.Index(fields=["content_digest"])]

    def __str__(self) -> str:
        return f"release {self.content_digest[:12]}"


class ImportedContent(models.Model):
    """Fields every imported record shares."""

    source = models.JSONField(help_text="The record exactly as the export carried it.")
    last_seen_release = models.ForeignKey(
        ContentRelease, on_delete=models.PROTECT, related_name="+", editable=False
    )

    class Meta:
        abstract = True


class CatalogFields(models.Model):
    """Django-owned fields: set when a row is created, never overwritten by an import."""

    active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        abstract = True


class World(ImportedContent, CatalogFields):
    """A themed world or island grouping: the export's `islands.json`."""

    slug = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    title = models.CharField(max_length=200)
    tagline = models.TextField(blank=True)
    description = models.TextField(blank=True)
    is_home = models.BooleanField(default=False)
    supported_age_bands = ArrayField(models.CharField(max_length=16, choices=AgeBand.choices))
    pack_version = models.PositiveIntegerField()

    class Meta:
        ordering = ["sort_order", "slug"]
        verbose_name = "world"
        verbose_name_plural = "worlds (themed islands)"

    def __str__(self) -> str:
        return self.slug


class Location(ImportedContent, CatalogFields):
    """An explorable region inside a world: the export's `locations.json`."""

    slug = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    world = models.ForeignKey(World, on_delete=models.PROTECT, related_name="locations")
    title = models.CharField(max_length=200)
    tagline = models.TextField(blank=True)
    description = models.TextField(blank=True)
    skills = ArrayField(models.CharField(max_length=100), default=list, blank=True)

    class Meta:
        ordering = ["sort_order", "slug"]
        verbose_name = "location"
        verbose_name_plural = "locations (regions inside a world)"

    def __str__(self) -> str:
        return self.slug


class Adventure(ImportedContent, CatalogFields):
    slug = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    title = models.CharField(max_length=200)
    version = models.PositiveIntegerField()
    world = models.ForeignKey(
        World,
        on_delete=models.PROTECT,
        related_name="adventures",
        null=True,
        blank=True,
        help_text="The world whose content pack lists this adventure.",
    )
    location = models.ForeignKey(
        Location,
        on_delete=models.PROTECT,
        related_name="adventures",
        null=True,
        blank=True,
        help_text="Empty for a story-only pseudo-location, which has no Location record.",
    )
    location_slug = models.SlugField(
        max_length=SLUG_LENGTH, help_text="As exported, including story-only pseudo-locations."
    )
    age_bands = ArrayField(models.CharField(max_length=16, choices=AgeBand.choices))
    entry_step_id = models.CharField(max_length=SLUG_LENGTH)
    skill_domain = models.CharField(max_length=32, blank=True)
    skill_level = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["sort_order", "slug"]

    def __str__(self) -> str:
        return self.slug


class AdventureStep(ImportedContent):
    """One step. Step ids are unique within an adventure only, so the key is the pair."""

    adventure = models.ForeignKey(Adventure, on_delete=models.CASCADE, related_name="steps")
    step_id = models.CharField(max_length=SLUG_LENGTH)
    position = models.PositiveIntegerField(help_text="Order within the adventure, as exported.")
    step_type = models.CharField(max_length=32)
    objective_ids = ArrayField(models.CharField(max_length=100), default=list, blank=True)

    class Meta:
        ordering = ["adventure", "position"]
        constraints = [
            models.UniqueConstraint(fields=["adventure", "step_id"], name="catalog_step_unique_id"),
        ]

    def __str__(self) -> str:
        return f"{self.adventure_id}:{self.step_id}"


class Quest(ImportedContent, CatalogFields):
    slug = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    title = models.CharField(max_length=200)
    summary = models.TextField(blank=True)
    world = models.ForeignKey(
        World,
        on_delete=models.PROTECT,
        related_name="quests",
        null=True,
        blank=True,
        help_text="The world whose content pack lists this quest.",
    )
    giver_npc_id = models.CharField(max_length=SLUG_LENGTH, blank=True)
    age_bands = ArrayField(models.CharField(max_length=16, choices=AgeBand.choices))
    adventures = models.ManyToManyField(
        Adventure,
        related_name="quests",
        blank=True,
        help_text="The adventures this quest's SOLVE objectives name, derived on import.",
    )

    class Meta:
        ordering = ["sort_order", "slug"]

    def __str__(self) -> str:
        return self.slug


class AssetOrigin(models.TextChoices):
    EXPORT = "EXPORT", "Content export"
    DJANGO = "DJANGO", "Created in Django"


class AssetStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    RETIRED = "RETIRED", "Retired"


class AssetCategory(models.TextChoices):
    """How administrators browse assets. Deliberately broad; `tags` carry anything finer."""

    CHARACTER = "character", "Character"
    NPC = "npc", "NPC"
    CREATURE = "creature", "Creature"
    PROP = "prop", "Prop"
    COLLECTIBLE = "collectible", "Collectible"
    BUILDING = "building", "Building"
    SCENERY = "scenery", "Scenery and environment"
    VEHICLE = "vehicle", "Vehicle"
    EQUIPMENT = "equipment", "Equipment and wearable"
    OTHER = "other", "Other"


# The engine's runtime kinds (`manifest.ts` `AssetKind`, `asset_refs.AssetKind`).
ASSET_KINDS = ("character", "prop", "collectible", "kit-piece")

# Which browsing categories make sense for each runtime kind (validation, ADR-035).
KIND_CATEGORIES = {
    "character": {"character", "npc", "creature"},
    "prop": {"prop", "building", "scenery", "vehicle", "equipment", "other"},
    "collectible": {"collectible", "equipment", "prop", "other"},
    "kit-piece": {"building", "scenery", "prop", "other"},
}


class ContentAsset(ImportedContent):
    """The asset definition: one stable identity per shared asset (ADR-030, ADR-035).

    Content fields (`kind`, `bundled_path`, `clips`, `low_detail`, `lod_distance_meters`,
    `source`) come from the export for `EXPORT` rows and are set once by an administrator for
    `DJANGO` rows. The remaining fields are Django-owned and never touched by an import. Binary
    versions live in `apps.assets.AssetVersion`; `default_version` is the published version an
    unpinned reference resolves to.
    """

    asset_id = models.SlugField(
        max_length=SLUG_LENGTH,
        unique=True,
        help_text="The bundled manifest id; also the Amplify Asset.slug namespace (ADR-030).",
    )
    kind = models.CharField(max_length=32)
    bundled_path = models.CharField(
        max_length=300, blank=True, help_text="Served from react/public today (export rows)."
    )
    clips = ArrayField(models.CharField(max_length=64), default=list, blank=True)
    low_detail = models.ForeignKey(
        "self", on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    lod_distance_meters = models.FloatField(null=True, blank=True)
    # Overrides of `ImportedContent`: a definition made in Django has no export record.
    source = models.JSONField(
        default=dict, blank=True, help_text="The record exactly as the export carried it."
    )
    last_seen_release = models.ForeignKey(
        ContentRelease,
        on_delete=models.PROTECT,
        related_name="+",
        editable=False,
        null=True,
        blank=True,
    )

    # --- Django-owned (LAI-2200) ---
    origin = models.CharField(
        max_length=8, choices=AssetOrigin.choices, default=AssetOrigin.EXPORT, editable=False
    )
    display_name = models.CharField(max_length=120, blank=True)
    description = models.CharField(max_length=1000, blank=True)
    category = models.CharField(
        max_length=16, choices=AssetCategory.choices, default=AssetCategory.OTHER
    )
    tags = ArrayField(models.SlugField(max_length=32), size=20, default=list, blank=True)
    status = models.CharField(
        max_length=8, choices=AssetStatus.choices, default=AssetStatus.ACTIVE, editable=False
    )
    default_version = models.ForeignKey(
        "assets.AssetVersion",
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
        editable=False,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
        editable=False,
    )
    created_at = models.DateTimeField(default=now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["asset_id"]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(origin=AssetOrigin.EXPORT)
                | models.Q(last_seen_release__isnull=False),
                name="catalog_contentasset_export_rows_have_a_release",
            ),
            models.CheckConstraint(
                condition=models.Q(origin__in=AssetOrigin.values),
                name="catalog_contentasset_origin_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=AssetStatus.values),
                name="catalog_contentasset_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(category__in=AssetCategory.values),
                name="catalog_contentasset_category_valid",
            ),
        ]

    def clean(self):
        errors = {}
        if self.origin == AssetOrigin.DJANGO and self.kind not in ASSET_KINDS:
            errors["kind"] = ValidationError(
                "Choose one of: %(kinds)s.",
                code="asset_kind",
                params={"kinds": ", ".join(ASSET_KINDS)},
            )
        allowed = KIND_CATEGORIES.get(self.kind)
        if allowed is not None and self.category not in allowed:
            errors["category"] = ValidationError(
                "A %(kind)s asset cannot be in the %(category)s category.",
                code="asset_category_mismatch",
                params={"kind": self.kind, "category": self.get_category_display()},
            )
        if errors:
            raise ValidationError(errors)

    @property
    def name(self) -> str:
        return self.display_name or self.asset_id

    def __str__(self) -> str:
        return self.asset_id


class LocationAsset(models.Model):
    """A shared asset a location's scene uses, by id only: placement is LAI-0805."""

    location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name="asset_links")
    asset = models.ForeignKey(ContentAsset, on_delete=models.PROTECT, related_name="location_links")
    position = models.PositiveIntegerField(help_text="First-use order in the scene, as exported.")
    last_seen_release = models.ForeignKey(
        ContentRelease, on_delete=models.PROTECT, related_name="+", editable=False
    )

    class Meta:
        ordering = ["location", "position"]
        constraints = [
            models.UniqueConstraint(
                fields=["location", "asset"], name="catalog_location_asset_unique"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.location_id}:{self.asset_id}"


# --- Catalog rows that Treasure Rush needed first (POST-MERGE-03; was proposed as LAI-0309) ---


class LearningObjective(ImportedContent):
    """A learning objective (`adventures.json` `learningObjectives`). Referenced by code."""

    code = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    domain = models.CharField(max_length=40)
    title = models.CharField(max_length=200)

    class Meta:
        ordering = ["code"]

    def __str__(self) -> str:
        return self.code


class NpcDefinition(ImportedContent, CatalogFields):
    """A character (`npcs.json`). Dialogue, schedule and quest offers stay in `source`."""

    npc_id = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    display_name = models.CharField(max_length=80)
    role = models.CharField(max_length=200, blank=True)
    home_location = models.ForeignKey(
        Location, on_delete=models.PROTECT, related_name="npcs", null=True, blank=True
    )
    home_location_slug = models.SlugField(max_length=SLUG_LENGTH)
    interaction_id = models.CharField(max_length=SLUG_LENGTH, blank=True)

    class Meta:
        ordering = ["sort_order", "npc_id"]

    def __str__(self) -> str:
        return self.npc_id


class DiscoveryDefinition(ImportedContent, CatalogFields):
    """An authored secret to find (`discoveries.json` `discoveries`, LAI-0605).

    Requirements, messages and the optional world change stay in `source`, exactly as exported;
    the columns are what the server queries by.
    """

    discovery_id = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    kind = models.CharField(max_length=32)
    title = models.CharField(max_length=200)
    location = models.ForeignKey(
        Location, on_delete=models.PROTECT, related_name="discoveries", null=True, blank=True
    )
    location_slug = models.SlugField(max_length=SLUG_LENGTH)
    starts_quest_slug = models.SlugField(max_length=SLUG_LENGTH, blank=True)

    class Meta:
        ordering = ["sort_order", "discovery_id"]

    def __str__(self) -> str:
        return self.discovery_id


class CollectibleSet(ImportedContent):
    set_id = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    display_name = models.CharField(max_length=120)
    completion_item = models.ForeignKey(
        "catalog.ItemDefinition", on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    completion_message = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["set_id"]

    def __str__(self) -> str:
        return self.set_id


class ItemDefinition(ImportedContent):
    """An earnable item (`rewards.json` `items`). No currency or drop-rate fields (ADR-011)."""

    item_id = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    display_name = models.CharField(max_length=120)
    description = models.CharField(max_length=300, blank=True)
    category = models.CharField(max_length=16)
    rarity = models.CharField(max_length=16)
    cosmetic_slot = models.CharField(max_length=16, blank=True)
    hidden = models.BooleanField(default=False)
    collectible_set = models.ForeignKey(
        CollectibleSet, on_delete=models.PROTECT, related_name="items", null=True, blank=True
    )

    class Meta:
        ordering = ["item_id"]

    def __str__(self) -> str:
        return self.item_id


class RewardRule(ImportedContent):
    """What a trigger grants (`rewards.json` `rewardRules`); resolved without randomness."""

    rule_id = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    trigger = models.JSONField()
    items = models.ManyToManyField(ItemDefinition, related_name="reward_rules", blank=True)
    message = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["rule_id"]

    def __str__(self) -> str:
        return self.rule_id
