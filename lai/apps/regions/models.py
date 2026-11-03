"""Play regions authored as rows by the Treasure Rush seed (POST-MERGE-03; TR-2, TR-7).

Spatial data: a region's bounds, spawn points, object placements and treasure chests. This is
**not** authoritative Django layout administration, which needs LAI-0805's ADR. The temporary
source of truth is `treasure_rush_seed.py`, a source-controlled file; these rows are its
applied copy, served to the play API so the Three.js client can build a location manifest
(TR-D15). No admin site registers them. Locations, NPCs, quests and reward rules are the
canonical catalog's rows (`apps.catalog`); nothing here duplicates them.
"""

from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import models

from apps.catalog.asset_refs import AssetKind, AssetRefValidator, validate_asset_ref
from apps.catalog.models import Authorable
from apps.core.content_status import ContentStatus
from apps.users.models import AgeBand


class WorldRegion(Authorable, models.Model):
    """A Place's 3D Area: the explorable Three.js environment of one catalog Location (ADR-041).

    Shown as "3D Area" (and its Location as "Place") everywhere people read it; the class, table
    and `region_id` keep their names. A Place has at most one 3D Area (database constraint
    `regions_one_area_per_place`) and is valid with none.

    `scene` holds what is not yet modelled as rows (bounds, environment, copy, and since TR-13
    the spatial `layout`), in the manifest's own field names; TR-7 validates the assembled
    manifest on the client too.

    ADR-043: the title and the non-spatial part of `scene` (`copy`, `environment`) are authored
    content ("area-copy" revisions); `bounds`, `layout` and everything spatial stay seed-owned.
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
    # Firepeak FP-D2: which age bands may see and play this 3D Area. Empty means every band its
    # Island supports (every existing 3D Area). Seed-authored with the layout.
    age_bands = ArrayField(
        models.CharField(max_length=16, choices=AgeBand.choices),
        default=list,
        blank=True,
        help_text="Leave empty for every age band the Island supports.",
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

    def supports_band(self, age_band: str) -> bool:
        return not self.age_bands or age_band in self.age_bands

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
    # TR-14: a collectible the child picks up through the play API. Picking it up records
    # `pickup_change_key` once and fires `pickup_reward_rule` (the item it puts in the backpack).
    pickup_change_key = models.CharField(
        max_length=80,
        blank=True,
        help_text="Collectibles only. Recorded once when the child picks it up, e.g. "
        "TREASURE_COVE_KEY_FOUND. Blank: not a pickup.",
    )
    pickup_reward_rule = models.ForeignKey(
        "catalog.RewardRule",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
        help_text="What picking it up grants, usually the item itself.",
    )

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
        if self.pickup_change_key and self.kind != PlacementKind.COLLECTIBLE:
            errors["pickup_change_key"] = "Only a collectible can be picked up."
        if self.pickup_reward_rule_id and not self.pickup_change_key:
            errors["pickup_reward_rule"] = "A pickup reward needs a pickup change key."
        if errors:
            raise ValidationError(errors)

    @property
    def is_pickup(self) -> bool:
        return self.kind == PlacementKind.COLLECTIBLE and bool(self.pickup_change_key)


class ChestPresentation(models.TextChoices):
    """How a chest appears (TR-14). Presentation only, except REPLAY (TR-20): that is a rule."""

    CHEST = "CHEST", "Treasure chest"
    HIDDEN = "HIDDEN", "Hidden chest (appears once the child may open it)"
    PUZZLE = "PUZZLE", "Puzzle (answered by touching the answer objects)"
    REPLAY = "REPLAY", "Replay activity (repeatable; never opens, grants nothing permanent)"


class TreasureChest(Placed):
    """A chest the child opens by solving a challenge chosen for their age band.

    A band with no challenge cannot open this chest (the client shows it as not for now).
    Opening it records `world_change_key` and grants `reward_rule` (TR-5).

    TR-14 adds what a multi-encounter adventure needs, all checked by the play services:

    - **Requirements.** `required_world_change_key` (an earlier encounter, so encounters run in
      order) and `required_item` (a key in the backpack). Until both hold, the chest is locked
      and no challenge is issued.
    - **Presentation.** A `HIDDEN` chest is not drawn until it may be opened; a `PUZZLE` is a
      challenge answered by touching objects in the world (`answer_entity_ids`, one per choice,
      in choice order) rather than buttons, and draws no chest of its own.
    - **`clue`.** What Pip says to send the child here, and the hint when it is next.

    TR-20 adds `REPLAY`: a small activity the child may repeat once the adventure is done. It
    issues a fresh challenge every time and records skill evidence, but never opens, never
    records `world_change_key`, and has no reward rule, so a replay can never award a second
    permanent reward. It must be locked behind an earlier encounter (`clean()` enforces both).
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
    presentation = models.CharField(
        max_length=8, choices=ChestPresentation.choices, default=ChestPresentation.CHEST
    )
    sort_order = models.PositiveSmallIntegerField(
        default=0, help_text="The order the encounters come in; hints point at the first one left."
    )
    required_world_change_key = models.CharField(
        max_length=80,
        blank=True,
        help_text="Locked until the child has this world change here (an earlier chest's key).",
    )
    required_item = models.ForeignKey(
        "catalog.ItemDefinition",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
        help_text="Locked until this item is in the child's backpack (a key).",
    )
    answer_entity_ids = models.JSONField(
        default=list,
        blank=True,
        help_text="Puzzles only: the entity ids of the objects the child touches to answer, one "
        "per choice, in choice order.",
    )
    clue = models.CharField(
        max_length=200,
        blank=True,
        help_text="Child-facing. What Pip says to send the child here, e.g. 'Follow the flowers "
        "in the grove.'",
    )

    class Meta:
        ordering = ["region", "sort_order", "entity_id"]
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
        answers = self.answer_entity_ids
        if self.presentation == ChestPresentation.PUZZLE:
            if not (
                isinstance(answers, list)
                and answers
                and all(isinstance(a, str) and a for a in answers)
                and len(set(answers)) == len(answers)
            ):
                errors["answer_entity_ids"] = "A puzzle needs a list of distinct entity ids."
            else:
                if self.region_id:
                    placed = set(self.region.placements.values_list("entity_id", flat=True))
                    missing = [a for a in answers if a not in placed]
                    if missing:
                        errors["answer_entity_ids"] = f"Not placed in this region: {missing}."
                for field in self.BAND_FIELDS.values():
                    spec = getattr(self, field)
                    if spec is not None and (
                        spec.response_mode != "CHOICE" or spec.choice_count != len(answers)
                    ):
                        errors[field] = (
                            f"A puzzle answered by {len(answers)} objects needs a CHOICE "
                            f"challenge with {len(answers)} choices."
                        )
        elif answers:
            errors["answer_entity_ids"] = "Only a puzzle has answer objects."
        if self.presentation == ChestPresentation.REPLAY:
            if self.reward_rule_id:
                errors["reward_rule"] = "A replay activity grants nothing permanent."
            if not self.required_world_change_key:
                errors["required_world_change_key"] = (
                    "A replay activity needs the encounter it repeats (the quest's completion)."
                )
        if self.required_world_change_key and self.required_world_change_key == (
            self.world_change_key
        ):
            errors["required_world_change_key"] = "A chest cannot require its own opening."
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


class PuzzleKind(models.TextChoices):
    """The closed registry of puzzle mechanics (ADR-043 F). A new kind is a code change: its
    parameter schema and grader live in `apps.regions.puzzles`, its scene in the client."""

    OBSERVE_FEATURES = "OBSERVE_FEATURES", "Observe features (look at each one)"
    PLACE_PLATFORMS = "PLACE_PLATFORMS", "Place platforms (match each gap)"
    VALVE_SEQUENCE = "VALVE_SEQUENCE", "Valve sequence (cause and effect)"
    COLLECT_OBJECT = "COLLECT_OBJECT", "Collect an object"
    RETURN_TO_NPC = "RETURN_TO_NPC", "Return to a character"


class AreaPuzzle(Authorable, models.Model):
    """A spatial puzzle in a 3D Area: the generalisation of `TreasureChest` (ADR-043, LAI-0812).

    Two owners, kept apart:

    - **Seed** (code, like all layout until LAI-0805): which 3D Area, the stable `puzzle_id`, the
      mechanic (`kind`) and the placements it uses (`entity_ids`).
    - **Authored content** (Django Admin, versioned revisions): title, per-age-band parameters,
      the change keys that must exist first (stage order), the change key it records, and its
      reward rule. The columns below the line are copied from the published revision; edit them
      through a new version, never directly.

    The server grades every solution against the revision the child's session pinned
    (LAI-0813); the client only renders.
    """

    region = models.ForeignKey(
        WorldRegion, on_delete=models.CASCADE, related_name="puzzles", verbose_name="3D Area"
    )
    puzzle_id = models.SlugField(max_length=80, help_text="Stable id within the 3D Area.")
    kind = models.CharField(max_length=24, choices=PuzzleKind.choices)
    entity_ids = ArrayField(
        models.SlugField(max_length=80),
        default=list,
        blank=True,
        help_text="Placements in this 3D Area the puzzle uses (seed-authored).",
    )
    sort_order = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=16, choices=ContentStatus.choices, default=ContentStatus.DRAFT
    )
    # --- Copied from the published revision (ADR-043) ---
    title = models.CharField(max_length=120, blank=True)
    parameters = models.JSONField(
        default=dict, blank=True, help_text="Per age band, validated by the kind's schema."
    )
    requires_change_keys = ArrayField(models.CharField(max_length=80), default=list, blank=True)
    world_change_key = models.CharField(max_length=80, unique=True)
    reward_rule = models.ForeignKey(
        "catalog.RewardRule", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["region", "sort_order", "puzzle_id"]
        verbose_name = "3D Area puzzle"
        constraints = [
            models.UniqueConstraint(
                fields=["region", "puzzle_id"], name="regions_puzzle_id_unique"
            ),
            models.CheckConstraint(
                condition=models.Q(kind__in=PuzzleKind.values), name="regions_puzzle_kind_valid"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.region}:{self.puzzle_id}"

    def clean(self):
        super().clean()
        if self.region_id:
            placed = set(self.region.placements.values_list("entity_id", flat=True))
            unknown = [entity for entity in self.entity_ids if entity not in placed]
            if unknown:
                raise ValidationError(
                    {"entity_ids": f"No placement in this 3D Area has id {', '.join(unknown)}."}
                )
