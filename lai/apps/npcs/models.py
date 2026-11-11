"""The NPC Manager's Django-authored configuration and published releases (ADR-054).

Identity stays canonical: every character is a `catalog.NpcDefinition` (ADR-033), and its
`npc_id` is the stable slug everything else uses. This app adds what the content export does not
carry: model variants, placements, dialogue trees, behaviour profiles, AI personas and immutable
published releases. Voices are `speech.VoiceProfile` rows (ADR-049); sound cues are `audio`
(ADR-050); assets are `catalog.ContentAsset` with `assets.AssetVersion` (ADR-035).

**Draft content is never served.** Children read only the ACTIVE `NpcRelease` snapshot. Editing
any row here changes nothing a child sees until staff publish a new release.

Model ownership for parallel development (docs/NPC_MANAGER_IMPLEMENTATION_PLAN.md): every model
is defined in the foundation migration; workstreams add behaviour, admin, validation and APIs
without changing these tables. A schema change outside the foundation is a contract change.
"""

from __future__ import annotations

import hashlib
import json

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils.timezone import now

from apps.catalog.models import SLUG_LENGTH
from apps.core.models import ChildOwnedModel
from apps.users.models import AgeBand

from . import conditions
from .vocabulary import (
    ANIMATION_STATES,
    TRIGGERS,
    BehaviorType,
    CharacterStatus,
    ChoiceAction,
    DialogueMode,
    Emotion,
    NpcRole,
    ReleaseStatus,
    Trigger,
    VariantAssetRole,
)

MAX_LINE_LENGTH = 400
MAX_LABEL_LENGTH = 80


class Authored(models.Model):
    """Audit fields every staff-authored row carries."""

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        editable=False,
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        editable=False,
    )
    created_at = models.DateTimeField(default=now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


def _age_bands_field(help_text: str):
    return ArrayField(
        models.CharField(max_length=16, choices=AgeBand.choices),
        default=list,
        blank=True,
        help_text=help_text,
    )


def _check_conditions(value, field: str, errors: dict) -> None:
    found = conditions.problems(value, field)
    if found:
        errors[field] = found


def _check_age_bands(value, field: str, errors: dict) -> None:
    bad = [band for band in value or () if band not in AgeBand.values]
    if bad:
        errors[field] = f"Unknown age band(s): {', '.join(bad)}."
    elif len(set(value or ())) != len(value or ()):
        errors[field] = "List each age band once."


# --- LAI-NPC-002: the character registry -------------------------------------------------------


class NpcCharacter(Authored):
    """The NPC Manager profile of one canonical NPC (LAI-NPC-002).

    One per `catalog.NpcDefinition`; its slug is the definition's `npc_id`. Empty `age_bands`
    means every band.
    """

    definition = models.OneToOneField(
        "catalog.NpcDefinition",
        on_delete=models.PROTECT,
        related_name="character",
        verbose_name="NPC",
    )
    role = models.CharField(max_length=16, choices=NpcRole.choices)
    personality = models.JSONField(
        default=dict,
        blank=True,
        help_text='{"traits": ["curious"], "tone": "warm", "catchphrases": ["Ahoy!"]}',
    )
    age_bands = _age_bands_field("Bands this character appears for. Empty: every band.")
    status = models.CharField(
        max_length=8, choices=CharacterStatus.choices, default=CharacterStatus.DRAFT
    )
    dialogue_mode = models.CharField(
        max_length=8, choices=DialogueMode.choices, default=DialogueMode.AUTHORED
    )
    voice_profile = models.ForeignKey(
        "speech.VoiceProfile",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="npc_characters",
        help_text="Optional. Without one, authored lines are captions only.",
    )
    notes = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["definition__sort_order", "definition__npc_id"]
        verbose_name = "NPC character"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(role__in=NpcRole.values), name="npcs_character_role_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=CharacterStatus.values),
                name="npcs_character_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(dialogue_mode__in=DialogueMode.values),
                name="npcs_character_mode_valid",
            ),
        ]

    def __str__(self) -> str:
        return self.slug

    @property
    def slug(self) -> str:
        return self.definition.npc_id

    def clean(self):
        super().clean()
        errors: dict = {}
        _check_age_bands(self.age_bands, "age_bands", errors)
        personality_problems = personality_problems_for(self.personality)
        if personality_problems:
            errors["personality"] = personality_problems
        if errors:
            raise ValidationError(errors)


PERSONALITY_KEYS = {"traits": list, "tone": str, "catchphrases": list}


def personality_problems_for(value) -> list[str]:
    if not isinstance(value, dict):
        return ["Must be a JSON object."]
    found = []
    for key, item in value.items():
        expected = PERSONALITY_KEYS.get(key)
        if expected is None:
            found.append(f"Unknown key {key!r} (use traits, tone, catchphrases).")
        elif not isinstance(item, expected):
            found.append(f"{key} must be a {expected.__name__}.")
        elif expected is list and (
            len(item) > 8 or any(not isinstance(v, str) or len(v) > 80 for v in item)
        ):
            found.append(f"{key}: at most 8 short phrases.")
        elif expected is str and len(item) > 80:
            found.append(f"{key}: at most 80 characters.")
    return found


# --- LAI-NPC-004: model variants -----------------------------------------------------------------


class NpcModelVariant(Authored):
    """One appearance of a character: model, portrait, scale, offsets and clip mapping."""

    character = models.ForeignKey(NpcCharacter, on_delete=models.CASCADE, related_name="variants")
    variant_key = models.SlugField(max_length=60)
    display_name = models.CharField(max_length=80, blank=True)
    model_asset = models.ForeignKey(
        "catalog.ContentAsset",
        on_delete=models.PROTECT,
        related_name="npc_variant_models",
        help_text="A character-kind asset (GLB or glTF).",
    )
    pinned_version = models.ForeignKey(
        "assets.AssetVersion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        help_text="Optional. Empty: the asset's current published default.",
    )
    portrait_asset = models.ForeignKey(
        "catalog.ContentAsset",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="npc_variant_portraits",
        help_text="An image-kind asset shown beside dialogue.",
    )
    scale = models.FloatField(
        default=1.0, validators=[MinValueValidator(0.05), MaxValueValidator(20.0)]
    )
    rotation_offset_y = models.FloatField(default=0.0, help_text="Radians, added to facing.")
    position_offset_y = models.FloatField(default=0.0, help_text="Metres, added to elevation.")
    animation_map = models.JSONField(
        default=dict,
        blank=True,
        help_text='Runtime state to the model\'s clip name, e.g. {"idle": "Idle", "talk": "Talk"}.',
    )
    availability = models.JSONField(
        default=list, blank=True, help_text="Conditions; empty: always available."
    )
    is_default = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["character", "sort_order", "variant_key"]
        verbose_name = "NPC model variant"
        constraints = [
            models.UniqueConstraint(
                fields=["character", "variant_key"], name="npcs_variant_key_unique"
            ),
            models.UniqueConstraint(
                fields=["character"],
                condition=models.Q(is_default=True),
                name="npcs_variant_one_default",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.character_id}:{self.variant_key}"

    def clean(self):
        super().clean()
        errors: dict = {}
        if not isinstance(self.animation_map, dict):
            errors["animation_map"] = "Must be a JSON object."
        else:
            unknown = sorted(set(self.animation_map) - set(ANIMATION_STATES))
            if unknown:
                errors["animation_map"] = f"Unknown state(s): {', '.join(unknown)}."
            elif any(not isinstance(v, str) or not v for v in self.animation_map.values()):
                errors["animation_map"] = "Each state maps to a clip name."
        _check_conditions(self.availability, "availability", errors)
        if self.pinned_version_id and self.model_asset_id:
            if self.pinned_version.asset_id != self.model_asset_id:
                errors["pinned_version"] = "The pinned version belongs to a different asset."
        if errors:
            raise ValidationError(errors)


class NpcVariantAsset(models.Model):
    """A texture, accessory, extra portrait or audio file a variant uses (LAI-NPC-003)."""

    variant = models.ForeignKey(NpcModelVariant, on_delete=models.CASCADE, related_name="extras")
    role = models.CharField(max_length=10, choices=VariantAssetRole.choices)
    asset = models.ForeignKey(
        "catalog.ContentAsset", on_delete=models.PROTECT, related_name="npc_variant_extras"
    )
    attach_point = models.CharField(
        max_length=60, blank=True, help_text="Accessories: the model's bone or node name."
    )
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["variant", "sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["variant", "role", "asset"], name="npcs_variant_asset_unique"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.variant}:{self.role}:{self.asset_id}"


# --- LAI-NPC-019: behaviour profiles -------------------------------------------------------------


class NpcBehaviorProfile(Authored):
    """A reusable runtime behaviour. `parameters` is validated per type (apps.npcs.behaviors)."""

    key = models.SlugField(max_length=60, unique=True)
    display_name = models.CharField(max_length=80)
    behavior_type = models.CharField(max_length=12, choices=BehaviorType.choices)
    parameters = models.JSONField(default=dict, blank=True)
    notes = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["key"]
        verbose_name = "NPC behaviour profile"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(behavior_type__in=BehaviorType.values),
                name="npcs_behavior_type_valid",
            ),
        ]

    def __str__(self) -> str:
        return self.key

    def clean(self):
        super().clean()
        from .behaviors import parameter_problems

        found = parameter_problems(self.behavior_type, self.parameters)
        if found:
            raise ValidationError({"parameters": found})


# --- LAI-NPC-006: placement ----------------------------------------------------------------------


class NpcPlacement(Authored):
    """Where a character stands: an Island, a Place and optionally that Place's 3D Area.

    NPC-only exception to LAI-0805 approved by the owner (ADR-054 item 4): numeric fields, no
    visual layout editor. Coordinates are metres in the 3D Area's frame (y is elevation).
    """

    placement_key = models.SlugField(
        max_length=80, help_text="Stable id within the Place, e.g. cove-pip."
    )
    character = models.ForeignKey(NpcCharacter, on_delete=models.CASCADE, related_name="placements")
    world = models.ForeignKey(
        "catalog.World", on_delete=models.PROTECT, related_name="+", verbose_name="island"
    )
    location = models.ForeignKey(
        "catalog.Location", on_delete=models.PROTECT, related_name="+", verbose_name="place"
    )
    region = models.ForeignKey(
        "regions.WorldRegion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="3D Area",
        help_text="Empty: the NPC belongs to the Place without a 3D Area.",
    )
    variant = models.ForeignKey(
        NpcModelVariant,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="placements",
        help_text="Empty: the character's default variant.",
    )
    behavior = models.ForeignKey(
        NpcBehaviorProfile,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="placements",
        help_text="Empty: stationary.",
    )
    x = models.FloatField(default=0.0)
    y = models.FloatField(default=0.0, help_text="Elevation.")
    z = models.FloatField(default=0.0)
    rotation_y = models.FloatField(default=0.0, help_text="Facing, in radians.")
    scale = models.FloatField(
        default=1.0, validators=[MinValueValidator(0.05), MaxValueValidator(20.0)]
    )
    interaction_radius = models.FloatField(
        default=2.5, validators=[MinValueValidator(0.5), MaxValueValidator(30.0)]
    )
    spawn_conditions = models.JSONField(default=list, blank=True)
    active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["location", "sort_order", "placement_key"]
        verbose_name = "NPC placement"
        constraints = [
            models.UniqueConstraint(
                fields=["location", "placement_key"], name="npcs_placement_key_unique"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.location_id}:{self.placement_key}"

    def clean(self):
        super().clean()
        errors: dict = {}
        if self.location_id and self.world_id and self.location.world_id != self.world_id:
            errors["location"] = "This Place is on a different Island."
        if self.region_id and self.location_id and self.region.location_id != self.location_id:
            errors["region"] = "This 3D Area belongs to a different Place."
        if self.variant_id and self.character_id and self.variant.character_id != self.character_id:
            errors["variant"] = "This variant belongs to a different character."
        _check_conditions(self.spawn_conditions, "spawn_conditions", errors)
        if errors:
            raise ValidationError(errors)


# --- LAI-NPC-011: dialogue -----------------------------------------------------------------------


class NpcDialogue(Authored):
    """A conversation a trigger can start. The highest-priority dialogue whose conditions and age
    bands match is chosen (LAI-NPC-012)."""

    character = models.ForeignKey(NpcCharacter, on_delete=models.CASCADE, related_name="dialogues")
    dialogue_key = models.SlugField(max_length=80)
    title = models.CharField(max_length=120, help_text="Staff-facing.")
    trigger = models.CharField(max_length=24, choices=Trigger.choices)
    mode = models.CharField(
        max_length=8, choices=DialogueMode.choices, default=DialogueMode.AUTHORED
    )
    age_bands = _age_bands_field("Empty: every band.")
    conditions = models.JSONField(default=list, blank=True)
    priority = models.IntegerField(default=0, help_text="Higher wins when several match.")
    start_node = models.ForeignKey(
        "NpcDialogueNode",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    once_per_child = models.BooleanField(
        default=False, help_text="Shown at most once to each child (e.g. a first greeting)."
    )
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["character", "trigger", "-priority", "dialogue_key"]
        verbose_name = "NPC dialogue"
        constraints = [
            models.UniqueConstraint(
                fields=["character", "dialogue_key"], name="npcs_dialogue_key_unique"
            ),
            models.CheckConstraint(
                condition=models.Q(trigger__in=list(TRIGGERS)), name="npcs_dialogue_trigger_valid"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.character_id}:{self.dialogue_key}"

    def clean(self):
        super().clean()
        errors: dict = {}
        _check_age_bands(self.age_bands, "age_bands", errors)
        _check_conditions(self.conditions, "conditions", errors)
        if self.start_node_id and self.pk and self.start_node.dialogue_id != self.pk:
            errors["start_node"] = "The start node belongs to a different dialogue."
        if errors:
            raise ValidationError(errors)


class NpcDialogueNode(models.Model):
    """One line. Without choices it advances to `next_node`, or ends when that is empty."""

    dialogue = models.ForeignKey(NpcDialogue, on_delete=models.CASCADE, related_name="nodes")
    node_key = models.SlugField(max_length=80)
    text = models.TextField(
        max_length=MAX_LINE_LENGTH, help_text="Exactly what is shown and spoken. Read-aloud safe."
    )
    emotion = models.CharField(max_length=10, choices=Emotion.choices, default=Emotion.NEUTRAL)
    animation_state = models.CharField(
        max_length=10, blank=True, help_text="Runtime state to play, e.g. talk, wave, point."
    )
    audio_asset = models.ForeignKey(
        "catalog.ContentAsset",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="npc_dialogue_lines",
        help_text="Optional recorded line (audio kind). Otherwise speech is synthesized.",
    )
    age_bands = _age_bands_field("Empty: every band of the dialogue.")
    conditions = models.JSONField(default=list, blank=True)
    next_node = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    allow_ai_hint = models.BooleanField(
        default=False, help_text="Hybrid dialogue: the child may ask this NPC for an AI hint here."
    )
    allowed_topic = models.CharField(
        max_length=120, blank=True, help_text="Hybrid/AI: the one topic a generated line may cover."
    )
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["dialogue", "sort_order", "node_key"]
        verbose_name = "NPC dialogue node"
        constraints = [
            models.UniqueConstraint(
                fields=["dialogue", "node_key"], name="npcs_dialogue_node_key_unique"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.dialogue}:{self.node_key}"

    def clean(self):
        super().clean()
        errors: dict = {}
        if self.animation_state and self.animation_state not in ANIMATION_STATES:
            errors["animation_state"] = f"Use one of: {', '.join(ANIMATION_STATES)}."
        _check_age_bands(self.age_bands, "age_bands", errors)
        _check_conditions(self.conditions, "conditions", errors)
        if self.next_node_id and self.next_node.dialogue_id != self.dialogue_id:
            errors["next_node"] = "The next node must be in the same dialogue."
        if self.next_node_id and self.pk and self.next_node_id == self.pk:
            errors["next_node"] = "A node cannot lead to itself."
        if errors:
            raise ValidationError(errors)


class NpcDialogueChoice(models.Model):
    """A button the child can press. Its action comes from a closed, non-rewarding set."""

    node = models.ForeignKey(NpcDialogueNode, on_delete=models.CASCADE, related_name="choices")
    choice_key = models.SlugField(max_length=60)
    label = models.CharField(max_length=MAX_LABEL_LENGTH, help_text="Short, read-aloud safe.")
    next_node = models.ForeignKey(
        NpcDialogueNode, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    conditions = models.JSONField(default=list, blank=True)
    action = models.CharField(max_length=16, choices=ChoiceAction.choices, default="NONE")
    action_value = models.CharField(
        max_length=100,
        blank=True,
        help_text="SET_LOCAL_FLAG: the flag; OFFER_QUEST: the quest slug.",
    )
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["node", "sort_order", "choice_key"]
        verbose_name = "NPC dialogue choice"
        constraints = [
            models.UniqueConstraint(fields=["node", "choice_key"], name="npcs_choice_key_unique"),
            models.CheckConstraint(
                condition=models.Q(action__in=ChoiceAction.values),
                name="npcs_choice_action_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.node}:{self.choice_key}"

    def clean(self):
        super().clean()
        errors: dict = {}
        _check_conditions(self.conditions, "conditions", errors)
        if (
            self.next_node_id
            and self.node_id
            and self.next_node.dialogue_id != self.node.dialogue_id
        ):
            errors["next_node"] = "The next node must be in the same dialogue."
        needs_value = self.action in (ChoiceAction.SET_LOCAL_FLAG, ChoiceAction.OFFER_QUEST)
        if needs_value and not self.action_value:
            errors["action_value"] = "This action needs a value."
        if not needs_value and self.action_value:
            errors["action_value"] = "Only SET_LOCAL_FLAG and OFFER_QUEST take a value."
        if errors:
            raise ValidationError(errors)


# --- LAI-NPC-031: personas -----------------------------------------------------------------------


class PersonaStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    APPROVED = "APPROVED", "Approved"
    RETIRED = "RETIRED", "Retired"


class NpcPersona(Authored):
    """A versioned AI persona. Only an APPROVED persona can enter a release; an approved one is
    never edited (make a new version)."""

    character = models.ForeignKey(NpcCharacter, on_delete=models.CASCADE, related_name="personas")
    version = models.PositiveIntegerField()
    status = models.CharField(
        max_length=8, choices=PersonaStatus.choices, default=PersonaStatus.DRAFT
    )
    personality_prompt = models.TextField(
        max_length=1500, help_text="Staff-authored, trusted. Who the character is and how it talks."
    )
    permitted_topics = ArrayField(
        models.CharField(max_length=80), default=list, blank=True, size=20
    )
    age_bands = _age_bands_field("Empty: the character's bands.")
    max_response_chars = models.PositiveSmallIntegerField(
        default=220, validators=[MinValueValidator(40), MaxValueValidator(400)]
    )
    fallback_lines = models.JSONField(
        default=list, help_text="Authored lines used whenever AI is off, slow or refused."
    )

    class Meta:
        ordering = ["character", "-version"]
        verbose_name = "NPC persona"
        constraints = [
            models.UniqueConstraint(
                fields=["character", "version"], name="npcs_persona_version_unique"
            ),
            models.UniqueConstraint(
                fields=["character"],
                condition=models.Q(status=PersonaStatus.APPROVED),
                name="npcs_persona_one_approved",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.character_id}:v{self.version}"

    def clean(self):
        super().clean()
        errors: dict = {}
        _check_age_bands(self.age_bands, "age_bands", errors)
        lines = self.fallback_lines
        if not isinstance(lines, list) or not lines:
            errors["fallback_lines"] = "Write at least one fallback line."
        elif any(not isinstance(v, str) or not v.strip() or len(v) > 220 for v in lines):
            errors["fallback_lines"] = "Each fallback line is short text (at most 220 characters)."
        if errors:
            raise ValidationError(errors)


# --- LAI-NPC-034: publishing ---------------------------------------------------------------------


class ImmutableRelease(ValueError):
    """A published release was about to be edited or deleted."""


class NpcRelease(models.Model):
    """One immutable published snapshot of every READY character (LAI-NPC-034).

    Only the snapshot and its hash are what children are served. At most one release is ACTIVE.
    Rollback reactivates a SUPERSEDED release; a RETIRED release is never served again.
    """

    number = models.PositiveIntegerField(unique=True, editable=False)
    status = models.CharField(max_length=10, choices=ReleaseStatus.choices, editable=False)
    schema_version = models.PositiveSmallIntegerField(editable=False)
    snapshot = models.JSONField(editable=False)
    content_hash = models.CharField(max_length=64, editable=False)
    notes = models.CharField(max_length=300, blank=True)
    validation_report = models.JSONField(default=dict, editable=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="+",
        editable=False,
    )
    created_at = models.DateTimeField(default=now, editable=False)
    activated_at = models.DateTimeField(null=True, editable=False)
    activated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="+",
        editable=False,
    )
    retired_at = models.DateTimeField(null=True, editable=False)

    IMMUTABLE_FIELDS = ("number", "schema_version", "snapshot", "content_hash", "created_at")

    class Meta:
        ordering = ["-number"]
        verbose_name = "NPC release"
        permissions = [
            ("publish_npcrelease", "Can publish NPC releases"),
            ("rollback_npcrelease", "Can roll back or retire NPC releases"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["status"],
                condition=models.Q(status=ReleaseStatus.ACTIVE),
                name="npcs_release_one_active",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=ReleaseStatus.values),
                name="npcs_release_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"NPC release {self.number}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            stored = NpcRelease.objects.filter(pk=self.pk).values(*self.IMMUTABLE_FIELDS).first()
            if stored and any(stored[f] != getattr(self, f) for f in self.IMMUTABLE_FIELDS):
                raise ImmutableRelease("A published NPC release is never edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableRelease("A published NPC release is never deleted; retire it instead.")

    @staticmethod
    def hash_snapshot(snapshot: dict) -> str:
        canonical = json.dumps(snapshot, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()


class NpcReleaseAsset(models.Model):
    """An asset a release depends on (LAI-NPC-036). PROTECT keeps both rows alive while any
    release names them; `apps.npcs.dependencies` reports and refuses retirement."""

    release = models.ForeignKey(NpcRelease, on_delete=models.PROTECT, related_name="asset_links")
    asset = models.ForeignKey(
        "catalog.ContentAsset", on_delete=models.PROTECT, related_name="npc_release_links"
    )
    version = models.ForeignKey(
        "assets.AssetVersion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="npc_release_links",
        help_text="The version the release resolved when it was published.",
    )
    usage = models.CharField(max_length=120, help_text="Where in the release it is used.")

    class Meta:
        ordering = ["release", "asset"]
        constraints = [
            models.UniqueConstraint(
                fields=["release", "asset", "usage"], name="npcs_release_asset_unique"
            ),
        ]


# --- LAI-NPC-017: child NPC state ----------------------------------------------------------------


class NpcConversationState(ChildOwnedModel):
    """One child's conversation cursor with one NPC (LAI-NPC-017).

    Holds only the NPC Manager's own state: where the conversation is and NPC-local flags.
    Relationship, quest memory flags, world changes, rewards and completion stay in their
    authoritative records (`progression.NpcRelationship`, `quests`, `progression.WorldChange`,
    `inventory`), which this never writes.
    """

    npc_id = models.SlugField(max_length=SLUG_LENGTH)
    release_number = models.PositiveIntegerField(
        null=True, blank=True, help_text="The release the open conversation came from."
    )
    conversation_id = models.UUIDField(null=True, blank=True)
    dialogue_key = models.SlugField(max_length=80, blank=True)
    node_key = models.SlugField(max_length=80, blank=True)
    conversation_started_at = models.DateTimeField(null=True, blank=True)
    last_interaction_at = models.DateTimeField(null=True, blank=True)
    last_trigger = models.CharField(max_length=24, blank=True)
    local_flags = models.JSONField(default=dict, blank=True)
    seen_dialogue_keys = ArrayField(
        models.SlugField(max_length=80), default=list, blank=True, size=200
    )
    visit_count = models.PositiveIntegerField(default=0)

    MAX_LOCAL_FLAGS = 32

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["child", "npc_id"], name="npcs_state_once"),
        ]

    def __str__(self) -> str:
        return f"npc state {self.npc_id}"

    def clean(self):
        super().clean()
        flags = self.local_flags
        if not isinstance(flags, dict) or len(flags) > self.MAX_LOCAL_FLAGS:
            raise ValidationError({"local_flags": "At most 32 true/false flags."})
        for key, value in flags.items():
            if not isinstance(value, bool) or conditions.problems(
                [{"type": "LOCAL_FLAG", "flag": key}]
            ):
                raise ValidationError({"local_flags": f"Flag {key!r} is not a valid flag."})
