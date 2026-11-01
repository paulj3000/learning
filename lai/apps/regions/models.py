"""Play regions authored as rows by the Treasure Rush seed (POST-MERGE-03; TR-2, TR-7).

Spatial data: a region's bounds, spawn points, object placements and treasure chests. This is
**not** authoritative Django layout administration, which needs LAI-0805's ADR. The temporary
source of truth is `treasure_rush_seed.py`, a source-controlled file; these rows are its
applied copy, served to the play API so the Three.js client can build a location manifest
(TR-D15). No admin site registers them. Locations, NPCs, quests and reward rules are the
canonical catalog's rows (`apps.catalog`); nothing here duplicates them.
"""

from django.core.exceptions import ValidationError
from django.db import models

from apps.catalog.asset_refs import AssetKind, AssetRefValidator, validate_asset_ref
from apps.core.content_status import ContentStatus
from apps.users.models import AgeBand


class WorldRegion(models.Model):
    """A Place's 3D Area: the explorable Three.js environment of one catalog Location (ADR-041).

    Shown as "3D Area" (and its Location as "Place") everywhere people read it; the class, table
    and `region_id` keep their names. A Place has at most one 3D Area (database constraint
    `regions_one_area_per_place`) and is valid with none.

    `scene` holds what is not yet modelled as rows (bounds, environment, copy, and since TR-13
    the spatial `layout`), in the manifest's own field names; TR-7 validates the assembled
    manifest on the client too.
    """

    region_id = models.SlugField(
        "3D Area id", max_length=80, unique=True, help_text="Stable id used by the API and URLs."
    )
    location = models.ForeignKey(
        "catalog.Location",
        on_delete=models.PROTECT,
        related_name="regions",
        verbose_name="place",
        help_text="The Place this 3D Area belongs to. A Place has at most one 3D Area.",
    )
    title = models.CharField(max_length=120, help_text="Child-facing name.")
    version = models.PositiveIntegerField(default=1)
    scene = models.JSONField(default=dict, blank=True)
    # The quests an NPC here offers the child (TR-5). Accepting one is the child's choice; a
    # session never starts a quest by itself.
    offered_quests = models.ManyToManyField(
        "catalog.Quest", blank=True, related_name="offered_in_regions"
    )
    status = models.CharField(
        max_length=16, choices=ContentStatus.choices, default=ContentStatus.DRAFT
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["region_id"]
        verbose_name = "3D Area"
        verbose_name_plural = "3D Areas"
        constraints = [
            models.UniqueConstraint(fields=["location"], name="regions_one_area_per_place"),
        ]

    def __str__(self) -> str:
        return self.region_id

    def clean(self):
        super().clean()
        if not isinstance(self.scene, dict):
            raise ValidationError({"scene": "Must be a JSON object."})
        if self.location_id is not None:
            other = WorldRegion.objects.filter(location_id=self.location_id).exclude(pk=self.pk)
            if other.exists():
                raise ValidationError(
                    {"location": "This Place already has a 3D Area. A Place can have only one."},
                    code="place_has_area",
                )

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
                fields=["region", "checkpoint_id"], name="regions_spawn_checkpoint_unique"
            ),
            models.UniqueConstraint(
                fields=["region"],
                condition=models.Q(is_default=True),
                name="regions_spawn_one_default",
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
        "catalog.NpcDefinition",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="placements",
    )
    interaction_id = models.CharField(max_length=80, blank=True)

    class Meta:
        ordering = ["region", "entity_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["region", "entity_id"], name="regions_placement_entity_unique"
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
        "catalog.RewardRule", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    world_change_key = models.CharField(
        max_length=80,
        unique=True,
        help_text="Recorded once when the chest opens, e.g. TREASURE_RUSH_COVE_CHEST_OPENED.",
    )

    class Meta:
        ordering = ["region", "entity_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["region", "entity_id"], name="regions_chest_entity_unique"
            )
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


class LaunchObjectKind(models.TextChoices):
    """How an Adventure launch point looks to the child. Presentation only; no behaviour."""

    NPC = "NPC", "Character (NPC)"
    CHEST = "CHEST", "Treasure chest"
    DOOR = "DOOR", "Door or portal"
    SIGN = "SIGN", "Sign or marker"
    OTHER = "OTHER", "Other object"


class AdventureLaunchPoint(models.Model):
    """An object in a 3D Area that starts one of its Place's Adventures (ADR-041 decision C).

    Points at an existing placement in the same 3D Area by `entity_id`. Where the object stands
    stays in the code-authored layout (LAI-0805); only which Adventure it starts, its wording and
    its publication are configuration. One object may offer several Adventures (one per age band,
    for example) and one Adventure may have several launch points. The Adventure must belong to
    this 3D Area's Place: `clean()` refuses any other, and the start endpoint checks it again
    before a session starts. A Treasure Rush chest (`TreasureChest`) cannot be a launch point; its
    interaction is the chest challenge. A decorative chest is a PROP placement of kind CHEST.
    Nothing here is executable: the client only shows the label and calls the start endpoint.
    """

    region = models.ForeignKey(
        WorldRegion,
        on_delete=models.CASCADE,
        related_name="launch_points",
        verbose_name="3D Area",
    )
    launch_id = models.SlugField(max_length=80, help_text="Stable id within the 3D Area.")
    entity_id = models.SlugField(
        "object",
        max_length=80,
        help_text="The entity id of a placement in this 3D Area (an NPC, prop or scenery item).",
    )
    object_kind = models.CharField(
        max_length=8, choices=LaunchObjectKind.choices, default=LaunchObjectKind.OTHER
    )
    adventure = models.ForeignKey(
        "catalog.Adventure",
        on_delete=models.PROTECT,
        related_name="launch_points",
        help_text="Must be an Adventure of this 3D Area's Place.",
    )
    label = models.CharField(
        max_length=120, help_text="Child-facing button text, e.g. 'Help fix the bridge'."
    )
    prompt = models.CharField(
        max_length=300, blank=True, help_text="Optional child-facing line shown with the button."
    )
    sort_order = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=16, choices=ContentStatus.choices, default=ContentStatus.DRAFT
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["region", "sort_order", "launch_id"]
        verbose_name = "Adventure launch point"
        constraints = [
            models.UniqueConstraint(
                fields=["region", "launch_id"], name="regions_launch_point_id_unique"
            ),
            models.UniqueConstraint(
                fields=["region", "entity_id", "adventure"],
                name="regions_launch_point_once_per_object",
            ),
            models.CheckConstraint(
                condition=models.Q(object_kind__in=LaunchObjectKind.values),
                name="regions_launch_point_kind_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.region}:{self.launch_id}"

    def placement(self) -> "WorldObjectPlacement | None":
        if not self.region_id:
            return None
        return self.region.placements.filter(entity_id=self.entity_id).first()

    def clean(self):
        super().clean()
        errors: dict[str, str] = {}
        if self.region_id and self.adventure_id:
            if self.adventure.location_id != self.region.location_id:
                errors["adventure"] = (
                    "This Adventure belongs to another Place. A launch point can only start an "
                    "Adventure of its own 3D Area's Place."
                )
        if self.region_id and self.entity_id:
            placement = self.placement()
            if placement is None:
                if self.region.chests.filter(entity_id=self.entity_id).exists():
                    errors["entity_id"] = (
                        "That is a Treasure Rush chest; its interaction is the chest challenge. "
                        "Use a prop placement for a chest that starts an Adventure."
                    )
                else:
                    errors["entity_id"] = "No placement in this 3D Area has that entity id."
            else:
                is_npc = placement.kind == PlacementKind.NPC
                if (self.object_kind == LaunchObjectKind.NPC) != is_npc:
                    errors["object_kind"] = (
                        "Choose 'Character (NPC)' for an NPC placement, and only for one."
                    )
        if errors:
            raise ValidationError(errors)
