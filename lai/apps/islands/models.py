"""Islands, locations, NPCs, and admin-authored world placement (LAI-0304, Treasure Rush TR-2).

The first three groups mirror the exported content (`load_content` fills them). The world
placement models are new: they let an administrator place a region's spawn points, objects,
and treasure chests as rows instead of in a source manifest (proposed decisions TR-D3, TR-D4).
TR-7 assembles a `ThreeLocationManifest` from them; field names follow
`react/src/features/island-map/three/runtime/locationManifest.ts`.

Nested authored structures that only the game engine interprets (quest offers, dialogue
conditions and choices, a region's bounds and environment) stay JSON, as in the export; the
things an administrator edits one at a time (dialogue lines, placements) are rows.
"""

from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import models

from apps.core.catalog import AssetKind, AssetRefValidator, ContentStatus, validate_asset_ref
from apps.users.models import AgeBand


def _age_bands_field(**kwargs) -> ArrayField:
    return ArrayField(models.CharField(max_length=16, choices=AgeBand.choices), **kwargs)


class Island(models.Model):
    slug = models.SlugField(max_length=80, unique=True)
    title = models.CharField(max_length=120)
    tagline = models.CharField(max_length=200)
    description = models.TextField()
    is_home = models.BooleanField(default=False)
    supported_age_bands = _age_bands_field()
    pack = models.JSONField(help_text="Content pack: the ids this island includes.")
    arrival = models.JSONField(null=True, blank=True)
    travel_requirement = models.JSONField(null=True, blank=True)
    status = models.CharField(
        max_length=16, choices=ContentStatus.choices, default=ContentStatus.PUBLISHED
    )

    class Meta:
        ordering = ["slug"]

    def __str__(self) -> str:
        return self.slug


class IslandLocation(models.Model):
    slug = models.SlugField(max_length=80, unique=True)
    island = models.ForeignKey(Island, on_delete=models.PROTECT, related_name="locations")
    title = models.CharField(max_length=120)
    tagline = models.CharField(max_length=200)
    description = models.TextField()
    decoration = models.CharField(max_length=300)
    skills = ArrayField(models.CharField(max_length=80), default=list, blank=True)
    unlock_requirement = models.JSONField(null=True, blank=True)
    status = models.CharField(
        max_length=16, choices=ContentStatus.choices, default=ContentStatus.PUBLISHED
    )

    class Meta:
        ordering = ["slug"]

    def __str__(self) -> str:
        return self.slug


class NpcDefinition(models.Model):
    npc_id = models.SlugField(max_length=80, unique=True)
    display_name = models.CharField(max_length=80)
    role = models.CharField(max_length=200)
    home_location = models.ForeignKey(IslandLocation, on_delete=models.PROTECT, related_name="npcs")
    interaction_id = models.CharField(max_length=80)
    schedule = models.JSONField(default=list)
    quest_offers = models.JSONField(default=list, blank=True)
    asset_id = models.CharField(
        max_length=80,
        blank=True,
        validators=[AssetRefValidator(AssetKind.CHARACTER)],
        help_text="Character model id. Empty uses the placement's own model or a placeholder.",
    )
    status = models.CharField(
        max_length=16, choices=ContentStatus.choices, default=ContentStatus.PUBLISHED
    )

    class Meta:
        ordering = ["npc_id"]

    def __str__(self) -> str:
        return self.npc_id


class NpcDialogueNode(models.Model):
    """One line of an NPC's dialogue. Child-facing: readable aloud, no em dashes."""

    npc = models.ForeignKey(NpcDefinition, on_delete=models.CASCADE, related_name="dialogue")
    node_id = models.SlugField(max_length=80)
    sort_order = models.PositiveSmallIntegerField(default=0)
    text = models.CharField(max_length=500)
    conditions = models.JSONField(default=list, blank=True)
    choices = models.JSONField(default=list, blank=True)
    sets_memory_flags = ArrayField(models.CharField(max_length=80), default=list, blank=True)
    awards_relationship_points = models.PositiveSmallIntegerField(default=0)
    follow_up_only = models.BooleanField(default=False)
    narration = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["npc", "sort_order"]
        constraints = [
            models.UniqueConstraint(fields=["npc", "node_id"], name="islands_dialogue_node_unique")
        ]

    def __str__(self) -> str:
        return f"{self.npc}:{self.node_id}"


# --- Admin-authored world placement (Treasure Rush) ------------------------------------------


class WorldRegion(models.Model):
    """An explorable region whose layout is authored in admin rather than in source.

    `scene` holds what is not yet modelled as rows (bounds, environment, copy), in the
    manifest's own field names; TR-7 validates the assembled manifest on the client too.
    """

    region_id = models.SlugField(max_length=80, unique=True)
    location = models.ForeignKey(IslandLocation, on_delete=models.PROTECT, related_name="regions")
    title = models.CharField(max_length=120, help_text="Child-facing name.")
    version = models.PositiveIntegerField(default=1)
    scene = models.JSONField(default=dict, blank=True)
    # The quests an NPC here offers the child (TR-5). Accepting one is the child's choice; a
    # session never starts a quest by itself.
    offered_quests = models.ManyToManyField(
        "quests.QuestDefinition", blank=True, related_name="offered_in_regions"
    )
    status = models.CharField(
        max_length=16, choices=ContentStatus.choices, default=ContentStatus.DRAFT
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["region_id"]

    def __str__(self) -> str:
        return self.region_id

    def clean(self):
        super().clean()
        if not isinstance(self.scene, dict):
            raise ValidationError({"scene": "Must be a JSON object."})

    def entity_ids(self, exclude: models.Model | None = None) -> set[str]:
        """Every entity id used by this region's placements and chests."""
        ids: set[str] = set()
        for queryset in (self.placements.all(), self.chests.all()):
            if exclude is not None and exclude.pk and queryset.model is type(exclude):
                queryset = queryset.exclude(pk=exclude.pk)
            ids.update(queryset.values_list("entity_id", flat=True))
        return ids


class SpawnPoint(models.Model):
    """Where the player appears (TR-D4). One default per region."""

    region = models.ForeignKey(WorldRegion, on_delete=models.CASCADE, related_name="spawn_points")
    checkpoint_id = models.SlugField(max_length=80)
    label = models.CharField(max_length=80, help_text="Child-facing checkpoint name.")
    x = models.FloatField()
    z = models.FloatField()
    yaw = models.FloatField(default=0.0, help_text="Facing, in radians.")
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ["region", "checkpoint_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["region", "checkpoint_id"], name="islands_spawn_checkpoint_unique"
            ),
            models.UniqueConstraint(
                fields=["region"],
                condition=models.Q(is_default=True),
                name="islands_spawn_one_default",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.region}:{self.checkpoint_id}"


class PlacementKind(models.TextChoices):
    PROP = "PROP", "Prop"
    NPC = "NPC", "NPC"
    COLLECTIBLE = "COLLECTIBLE", "Collectible"
    SCENERY = "SCENERY", "Scenery"


_PLACEMENT_ASSET_KINDS = {
    PlacementKind.PROP: (AssetKind.PROP,),
    PlacementKind.NPC: (AssetKind.CHARACTER,),
    PlacementKind.COLLECTIBLE: (AssetKind.COLLECTIBLE, AssetKind.PROP),
    PlacementKind.SCENERY: (AssetKind.KIT_PIECE, AssetKind.PROP),
}


class Placed(models.Model):
    """Ground position and placeholder size shared by placements and chests."""

    entity_id = models.SlugField(max_length=80)
    label = models.CharField(max_length=80, blank=True, help_text="Child-facing crosshair label.")
    x = models.FloatField()
    z = models.FloatField()
    elevation = models.FloatField(default=0.0)
    rotation_y = models.FloatField(default=0.0, help_text="Radians.")
    scale = models.FloatField(default=1.0)
    # TR-7a: the size of the primitive drawn when the model is missing or fails to load.
    placeholder_width = models.FloatField(default=1.0)
    placeholder_height = models.FloatField(default=1.0)
    placeholder_depth = models.FloatField(default=1.0)

    class Meta:
        abstract = True

    def clean(self):
        super().clean()
        if self.scale <= 0:
            raise ValidationError({"scale": "Must be greater than zero."})
        if self.region_id and self.entity_id in self.region.entity_ids(exclude=self):
            raise ValidationError({"entity_id": "Another object in this region uses this id."})


class WorldObjectPlacement(Placed):
    region = models.ForeignKey(WorldRegion, on_delete=models.CASCADE, related_name="placements")
    kind = models.CharField(max_length=16, choices=PlacementKind.choices)
    asset_id = models.CharField(max_length=80, blank=True, validators=[AssetRefValidator()])
    npc = models.ForeignKey(
        NpcDefinition, null=True, blank=True, on_delete=models.PROTECT, related_name="placements"
    )
    interaction_id = models.CharField(max_length=80, blank=True)

    class Meta:
        ordering = ["region", "entity_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["region", "entity_id"], name="islands_placement_entity_unique"
            )
        ]

    def __str__(self) -> str:
        return f"{self.region}:{self.entity_id}"

    def clean(self):
        super().clean()
        errors = {}
        if (self.kind == PlacementKind.NPC) != (self.npc_id is not None):
            errors["npc"] = "An NPC placement needs an NPC; other kinds must not have one."
        try:
            validate_asset_ref(self.asset_id, *_PLACEMENT_ASSET_KINDS.get(self.kind, ()))
        except ValidationError as error:
            errors["asset_id"] = error
        if errors:
            raise ValidationError(errors)


class TreasureChest(Placed):
    """A chest the child opens by solving a challenge chosen for their age band.

    A band with no challenge cannot open this chest (the client shows it as not for now).
    Opening it records `world_change_key` and grants `reward_rule` (TR-5).
    """

    region = models.ForeignKey(WorldRegion, on_delete=models.CASCADE, related_name="chests")
    asset_id = models.CharField(
        max_length=80,
        default="treasure-chest",
        blank=True,
        validators=[AssetRefValidator(AssetKind.PROP)],
    )
    open_clip = models.CharField(max_length=40, default="Open", blank=True)
    sprout_challenge = models.ForeignKey(
        "education.ChallengeSpec",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )
    pathfinder_challenge = models.ForeignKey(
        "education.ChallengeSpec",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )
    explorer_challenge = models.ForeignKey(
        "education.ChallengeSpec",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )
    reward_rule = models.ForeignKey(
        "inventory.RewardRule", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    world_change_key = models.CharField(
        max_length=80,
        unique=True,
        help_text="Recorded once when the chest opens, e.g. TREASURE_RUSH_COVE_CHEST_OPENED.",
    )

    class Meta:
        ordering = ["region", "entity_id"]
        constraints = [
            models.UniqueConstraint(fields=["region", "entity_id"], name="islands_chest_entity_unique")
        ]

    def __str__(self) -> str:
        return f"{self.region}:{self.entity_id}"

    BAND_FIELDS = {
        AgeBand.SPROUT: "sprout_challenge",
        AgeBand.PATHFINDER: "pathfinder_challenge",
        AgeBand.EXPLORER: "explorer_challenge",
    }

    def challenge_for(self, age_band: str):
        field = self.BAND_FIELDS.get(age_band)
        return getattr(self, field) if field else None

    def clean(self):
        super().clean()
        errors = {}
        for band, field in self.BAND_FIELDS.items():
            spec = getattr(self, field)
            if spec is not None and spec.age_band != band:
                errors[field] = f"This challenge is for {spec.age_band}, not {band}."
        if not any(getattr(self, f"{field}_id") for field in self.BAND_FIELDS.values()):
            errors["__all__"] = "A chest needs a challenge for at least one age band."
        if errors:
            raise ValidationError(errors)
