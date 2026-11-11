"""The game content catalog (LAI-0304, ADR-019 sub-decision 8).

Hierarchy, as the content export actually shapes it (owner decision, 2026-10-24):

    World -> Location -> Adventure -> AdventureStep
    World -> Quest -> (adventures named by its SOLVE objectives)

People read these as Island (World), Place (Location) and 3D Area (`regions.WorldRegion`), the
approved terms of ADR-041. Class, table, field and API names are unchanged on purpose: only
verbose names and help text say Island and Place.

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
the same id as the bundled manifest and the Amplify `Asset.slug` (ADR-030), and the asset library
(`apps.assets`, LAI-2200, ADR-035) attaches immutable versions to it.
"""

import uuid

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


class ContentAuthority(models.TextChoices):
    """Who owns a record's content (ADR-047 J).

    `EXPORT`: every published revision came from the export (or a code seed); an import may
    publish a newer one. `DJANGO`: an administrator has published an edit; no import changes it.
    """

    EXPORT = "EXPORT", "Export-owned"
    DJANGO = "DJANGO", "Django-owned (edited in Admin)"


class RevisionStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    SUBMITTED = "SUBMITTED", "Submitted for approval"
    REJECTED = "REJECTED", "Returned with a reason"
    PUBLISHED = "PUBLISHED", "Published"
    SUPERSEDED = "SUPERSEDED", "Superseded"
    DISCARDED = "DISCARDED", "Discarded"


class RevisionOrigin(models.TextChoices):
    IMPORT = "IMPORT", "Content import"
    SEED = "SEED", "Code seed"
    ADMIN = "ADMIN", "Django Admin"
    ROLLBACK = "ROLLBACK", "Rollback"


class RevisionImmutable(ValueError):
    """A published, superseded or discarded revision was about to change (ADR-047 E)."""


# Which status changes a revision may make. Anything else is refused by `save()`.
_REVISION_TRANSITIONS = {
    RevisionStatus.DRAFT: {
        RevisionStatus.DRAFT,
        RevisionStatus.SUBMITTED,
        RevisionStatus.PUBLISHED,
        RevisionStatus.DISCARDED,
    },
    # Submitted: awaiting an approver. The body is frozen until it is withdrawn or returned.
    RevisionStatus.SUBMITTED: {
        RevisionStatus.SUBMITTED,
        RevisionStatus.DRAFT,
        RevisionStatus.PUBLISHED,
        RevisionStatus.REJECTED,
    },
    # Returned with a reason: the author reopens it as a draft, or discards it.
    RevisionStatus.REJECTED: {RevisionStatus.DRAFT, RevisionStatus.DISCARDED},
    RevisionStatus.PUBLISHED: {RevisionStatus.SUPERSEDED},
    RevisionStatus.SUPERSEDED: set(),
    RevisionStatus.DISCARDED: set(),
}


class ContentRevision(models.Model):
    """One immutable version of one authorable record's content (ADR-047 C, LAI-0810).

    `body` is the record in the export's own shape, so the export's JSON Schema and the
    importer's per-record checks validate it. Publishing (`apps.catalog.authoring`) copies it
    into the record's columns and `source`; nothing reads a revision body directly except the
    authoring service and session pinning (LAI-0813). Never deleted (ADR-047-Q3).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=32)
    content_type = models.ForeignKey(
        "contenttypes.ContentType", on_delete=models.PROTECT, related_name="+"
    )
    object_id = models.CharField(max_length=64)
    record_key = models.CharField(
        max_length=SLUG_LENGTH, help_text="The record's stable content id, for people reading."
    )
    number = models.PositiveIntegerField()
    body = models.JSONField()
    status = models.CharField(
        max_length=12, choices=RevisionStatus.choices, default=RevisionStatus.DRAFT
    )
    origin = models.CharField(max_length=8, choices=RevisionOrigin.choices)
    based_on = models.ForeignKey(
        "self", on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    content_release = models.ForeignKey(
        ContentRelease, on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    note = models.CharField(max_length=300, blank=True, help_text="Why this version exists.")
    validation_report = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(default=now)
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
    )
    published_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.CharField(
        max_length=300, blank=True, help_text="Why the approver returned this version."
    )

    class Meta:
        ordering = ["kind", "record_key", "-number"]
        verbose_name = "content version"
        verbose_name_plural = "content versions"
        permissions = [
            ("edit_content_draft", "Can create and edit content drafts"),
            ("publish_content", "Can publish and roll back content"),
            ("edit_content_json", "Can edit a content draft as raw JSON (debugging)"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["content_type", "object_id", "number"], name="content_revision_number"
            ),
            models.UniqueConstraint(
                fields=["content_type", "object_id"],
                condition=models.Q(status=RevisionStatus.PUBLISHED),
                name="content_revision_one_published",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=RevisionStatus.values),
                name="content_revision_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(origin__in=RevisionOrigin.values),
                name="content_revision_origin_valid",
            ),
        ]
        indexes = [models.Index(fields=["content_type", "object_id", "status"])]

    def __str__(self) -> str:
        return f"{self.kind} {self.record_key} v{self.number}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            stored = ContentRevision.objects.filter(pk=self.pk).values("status", "body").first()
            if stored is not None:
                before = stored["status"]
                if self.status not in _REVISION_TRANSITIONS.get(before, set()):
                    raise RevisionImmutable(
                        f"A {before.lower()} version cannot become {self.status}."
                    )
                if before != RevisionStatus.DRAFT and stored["body"] != self.body:
                    raise RevisionImmutable("Only a draft's content can change.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RevisionImmutable("Content versions are kept permanently (ADR-047-Q3).")


class Authorable(models.Model):
    """A record whose content is versioned and editable in Django Admin (ADR-047, LAI-0810)."""

    authority = models.CharField(
        max_length=8,
        choices=ContentAuthority.choices,
        default=ContentAuthority.EXPORT,
        editable=False,
    )
    published_revision = models.ForeignKey(
        ContentRevision,
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
        editable=False,
    )

    class Meta:
        abstract = True


class World(Authorable, ImportedContent, CatalogFields):
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
        verbose_name = "island"
        verbose_name_plural = "islands"

    def __str__(self) -> str:
        return self.slug


class Location(Authorable, ImportedContent, CatalogFields):
    """An explorable region inside a world: the export's `locations.json`."""

    slug = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    world = models.ForeignKey(
        World, on_delete=models.PROTECT, related_name="locations", verbose_name="island"
    )
    title = models.CharField(max_length=200)
    tagline = models.TextField(blank=True)
    description = models.TextField(blank=True)
    skills = ArrayField(models.CharField(max_length=100), default=list, blank=True)

    class Meta:
        ordering = ["sort_order", "slug"]
        verbose_name = "place"
        verbose_name_plural = "places"

    def __str__(self) -> str:
        return self.slug


class Adventure(Authorable, ImportedContent, CatalogFields):
    slug = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    title = models.CharField(max_length=200)
    version = models.PositiveIntegerField()
    world = models.ForeignKey(
        World,
        on_delete=models.PROTECT,
        related_name="adventures",
        null=True,
        blank=True,
        verbose_name="island",
        help_text="The Island whose content pack lists this adventure.",
    )
    location = models.ForeignKey(
        Location,
        on_delete=models.PROTECT,
        related_name="adventures",
        null=True,
        blank=True,
        verbose_name="place",
        help_text="The Place that owns this adventure. Empty for a story-only place, which has "
        "no Place record.",
    )
    location_slug = models.SlugField(
        "place slug",
        max_length=SLUG_LENGTH,
        help_text="As exported, including story-only places.",
    )
    age_bands = ArrayField(models.CharField(max_length=16, choices=AgeBand.choices))
    entry_step_id = models.CharField(max_length=SLUG_LENGTH)
    skill_domain = models.CharField(max_length=32, blank=True)
    skill_level = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["sort_order", "slug"]

    def __str__(self) -> str:
        return self.slug


class AdventureStep(Authorable, ImportedContent):
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


class Quest(Authorable, ImportedContent, CatalogFields):
    slug = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    title = models.CharField(max_length=200)
    summary = models.TextField(blank=True)
    world = models.ForeignKey(
        World,
        on_delete=models.PROTECT,
        related_name="quests",
        null=True,
        blank=True,
        verbose_name="island",
        help_text="The Island that owns this quest. A quest may span several of its Places.",
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


class Story(Authorable, ImportedContent, CatalogFields):
    """A Storykeeper Castle story (`stories.json`), as an authorable catalog row (LAI-0309).

    The chapters and scenes live in `source`; the row holds what other code queries. Its links
    are derived, never typed twice: adventures from its ADVENTURE scenes, characters from its
    speakers, learning objectives and quests through those adventures.
    """

    slug = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    supported_age_bands = ArrayField(models.CharField(max_length=16, choices=AgeBand.choices))
    entry_chapter_id = models.CharField(max_length=SLUG_LENGTH)
    adventures = models.ManyToManyField(
        Adventure,
        related_name="stories",
        blank=True,
        help_text="The adventures this story's ADVENTURE scenes name, derived on import.",
    )

    class Meta:
        ordering = ["sort_order", "slug"]
        verbose_name_plural = "stories"

    def __str__(self) -> str:
        return self.slug

    def speakers(self) -> list[str]:
        """Names that speak in the story's narrative scenes, in order of first appearance."""
        found = (
            scene.get("speaker")
            for chapter in self.source.get("chapters", [])
            for scene in chapter.get("scenes", [])
        )
        return list(dict.fromkeys(name for name in found if name))

    def characters(self):
        """NPC definitions whose display name is a speaker (a story may also use a narrator)."""
        return NpcDefinition.objects.filter(display_name__in=self.speakers())

    def learning_objectives(self):
        """Objectives practised by the steps of the story's adventures."""
        codes = {
            code
            for steps in AdventureStep.objects.filter(
                adventure__in=self.adventures.all()
            ).values_list("objective_ids", flat=True)
            for code in steps
        }
        return LearningObjective.objects.filter(code__in=codes)

    def related_quests(self):
        """Quests that solve any of the story's adventures."""
        return Quest.objects.filter(adventures__in=self.adventures.all()).distinct()


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
    TEXTURE = "texture", "Texture"
    IMAGE = "image", "Image and sprite"
    SOUND = "sound", "Sound effect"
    MUSIC = "music", "Music and voice"
    OTHER = "other", "Other"


# Runtime kinds. The first four are the engine's model kinds (`manifest.ts` `AssetKind`,
# `asset_refs.AssetKind`); texture, image, sprite and audio are the non-model kinds (AM-13). The
# kind decides which family of file a definition accepts (`apps.assets.formats.KIND_FAMILY`).
ASSET_KINDS = (
    "character",
    "prop",
    "collectible",
    "kit-piece",
    "texture",
    "image",
    "sprite",
    "audio",
)

# The kinds an Island or Place picture (`artAssetId`, AP-03) may name: a single still image.
ART_ASSET_KINDS = ("image",)

# Which browsing categories make sense for each runtime kind (validation, ADR-035).
KIND_CATEGORIES = {
    "character": {"character", "npc", "creature"},
    "prop": {"prop", "building", "scenery", "vehicle", "equipment", "other"},
    "collectible": {"collectible", "equipment", "prop", "other"},
    "kit-piece": {"building", "scenery", "prop", "other"},
    "texture": {"texture", "scenery", "other"},
    "image": {"image", "other"},
    "sprite": {"image", "other"},
    "audio": {"sound", "music", "other"},
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

    location = models.ForeignKey(
        Location, on_delete=models.CASCADE, related_name="asset_links", verbose_name="place"
    )
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


class LearningObjective(Authorable, ImportedContent):
    """A learning objective (`adventures.json` `learningObjectives`). Referenced by code."""

    code = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    domain = models.CharField(max_length=40)
    title = models.CharField(max_length=200)

    class Meta:
        ordering = ["code"]

    def __str__(self) -> str:
        return self.code


class NpcDefinition(Authorable, ImportedContent, CatalogFields):
    """A character (`npcs.json`). Dialogue, schedule and quest offers stay in `source`.

    The canonical NPC identity (ADR-033). `npc_id` is the stable slug every system uses. Rows come
    from the export (`EXPORT`) or, since the NPC Manager (ADR-054), from Django Admin (`DJANGO`):
    the import never creates, updates or claims a `DJANGO` row. Django-authored NPC configuration
    (variants, dialogue, behaviours, personas) lives in `apps.npcs`, keyed to this row.
    """

    npc_id = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    # Overrides of `ImportedContent`: an NPC made in Django has no export record (ADR-054).
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
    origin = models.CharField(
        max_length=8, choices=AssetOrigin.choices, default=AssetOrigin.EXPORT, editable=False
    )
    display_name = models.CharField(max_length=80)
    role = models.CharField(max_length=200, blank=True)
    home_location = models.ForeignKey(
        Location,
        on_delete=models.PROTECT,
        related_name="npcs",
        null=True,
        blank=True,
        verbose_name="home place",
    )
    home_location_slug = models.SlugField("home place slug", max_length=SLUG_LENGTH)
    interaction_id = models.CharField(max_length=SLUG_LENGTH, blank=True)

    class Meta:
        ordering = ["sort_order", "npc_id"]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(origin=AssetOrigin.EXPORT)
                | models.Q(last_seen_release__isnull=False),
                name="catalog_npcdefinition_export_rows_have_a_release",
            ),
            models.CheckConstraint(
                condition=models.Q(origin__in=AssetOrigin.values),
                name="catalog_npcdefinition_origin_valid",
            ),
        ]

    def __str__(self) -> str:
        return self.npc_id


class CollectibleSet(Authorable, ImportedContent):
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


class ItemDefinition(Authorable, ImportedContent):
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


class RewardRule(Authorable, ImportedContent):
    """What a trigger grants (`rewards.json` `rewardRules`); resolved without randomness."""

    rule_id = models.SlugField(max_length=SLUG_LENGTH, unique=True)
    trigger = models.JSONField()
    items = models.ManyToManyField(ItemDefinition, related_name="reward_rules", blank=True)
    message = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["rule_id"]

    def __str__(self) -> str:
        return self.rule_id
