"""NPC Manager authoring and publishing in Django Admin (LAI-NPC-003, 004, 005, 035, 036).

Workstream A. Every page is staff-only and permission-checked (grant roles with
`manage.py ensure_npc_roles`):

- characters, variants and their extras, placements, dialogue trees: the model permissions
  (`npcs.add_*`, `change_*`, `view_*`, `delete_*`); a character is retired through its status;
- releases: read-only for `npcs.view_npcrelease`, which also opens "Validate draft" and the
  asset dependency report; "Publish" needs `npcs.publish_npcrelease`; "Roll back" and "Retire"
  need `npcs.rollback_npcrelease`. Every state change goes through `apps.npcs.publishing`.

Editing here never changes what a child sees: children are served only the ACTIVE release. No
page here reads or shows child data (conversation state is deliberately not registered).

Assets are picked from the existing Asset Library (`catalog.ContentAsset`, autocomplete) and
checked by kind on save; previews link to the asset library's own preview page for the version
a variant resolves to (no second viewer).
"""

from __future__ import annotations

from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.db.models import Count
from django.http import HttpResponseNotAllowed
from django.shortcuts import get_object_or_404, redirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html, format_html_join

from apps.assets import preview as asset_preview
from apps.catalog.models import SLUG_LENGTH, AssetOrigin, AssetStatus, Location, NpcDefinition

from . import dependencies, publishing
from .models import (
    NpcCharacter,
    NpcDialogue,
    NpcDialogueChoice,
    NpcDialogueNode,
    NpcModelVariant,
    NpcPlacement,
    NpcRelease,
    NpcVariantAsset,
)
from .validation.assets import EXTRA_KINDS
from .vocabulary import ANIMATION_STATES, CONDITION_TYPES, CharacterStatus, ReleaseStatus

CONDITIONS_HELP = (
    "A JSON list of conditions, all of which must hold; empty means always. Types: "
    + ", ".join(CONDITION_TYPES)
    + '. Example: [{"type": "AGE_BAND", "in": ["SPROUT"]}, '
    '{"type": "WORLD_CHANGE", "key": "BRIDGE_FIXED"}].'
)
ANIMATION_MAP_HELP = (
    "A JSON object from runtime state to a clip name in the model. States: "
    + ", ".join(ANIMATION_STATES)
    + '. Example: {"idle": "Idle", "talk": "Talk"}. The clips the selected model has are listed '
    "under Available clips after saving; unknown clip names are refused."
)


# --- shared helpers ------------------------------------------------------------------------------


def asset_problem(asset, kinds: tuple[str, ...], *, check_status: bool = True) -> str | None:
    """Why `asset` cannot be used where one of `kinds` is expected, or None."""
    if asset is None:
        return None
    if kinds and asset.kind not in kinds:
        return (
            f"{asset.asset_id} is a {asset.kind} asset; choose a {' or '.join(kinds)} asset "
            "from the Asset Library."
        )
    if check_status and asset.status == AssetStatus.RETIRED:
        return f"{asset.asset_id} is retired; choose an active asset or reactivate it first."
    return None


def resolved_version(variant: NpcModelVariant):
    """The version a variant's model resolves to now: the pinned one, else the default."""
    if variant.pinned_version_id:
        return variant.pinned_version
    if variant.model_asset_id:
        return variant.model_asset.default_version
    return None


def model_clips(variant: NpcModelVariant) -> tuple[list[str], str]:
    """The clips of the model the variant resolves to, and a label saying where they came from."""
    version = resolved_version(variant)
    if version is not None:
        return list(version.clips), f"{variant.model_asset.asset_id} v{version.number}"
    return list(variant.model_asset.clips), f"{variant.model_asset.asset_id} (bundled)"


def _user_label(user) -> str:
    if user is None:
        return ""
    return getattr(user, "admin_username", "") or f"staff #{user.pk}"


class AuditedAdmin(admin.ModelAdmin):
    """Fills `created_by` / `updated_by` on the row and on inline rows that carry them."""

    def save_model(self, request, obj, form, change):
        _stamp(obj, request.user, adding=not change)
        super().save_model(request, obj, form, change)

    def save_formset(self, request, form, formset, change):
        instances = formset.save(commit=False)
        for obj in formset.deleted_objects:
            obj.delete()
        for obj in instances:
            _stamp(obj, request.user, adding=obj._state.adding)
            obj.save()
        formset.save_m2m()


def _stamp(obj, user, *, adding: bool) -> None:
    if not hasattr(obj, "updated_by_id"):
        return
    if adding:
        obj.created_by = user
    obj.updated_by = user


# --- forms ---------------------------------------------------------------------------------------


class VariantForm(forms.ModelForm):
    """Model variant: kind checks on every asset and clip names against the resolved model."""

    class Meta:
        model = NpcModelVariant
        fields = "__all__"
        help_texts = {"animation_map": ANIMATION_MAP_HELP, "availability": CONDITIONS_HELP}

    def _asset(self, name: str, kinds: tuple[str, ...]):
        asset = self.cleaned_data.get(name)
        problem = asset_problem(asset, kinds, check_status=name in self.changed_data)
        if problem:
            raise forms.ValidationError(problem, code="npc_asset_kind")
        return asset

    def clean_model_asset(self):
        return self._asset("model_asset", ("character",))

    def clean_portrait_asset(self):
        return self._asset("portrait_asset", ("image", "sprite"))

    def clean_pinned_version(self):
        version = self.cleaned_data.get("pinned_version")
        if (
            version is not None
            and not version.is_published
            and "pinned_version" in self.changed_data
        ):
            raise forms.ValidationError(
                f"Version {version.number} is {version.get_status_display().lower()}; pin a "
                "published version, or leave it empty to use the asset's default.",
                code="npc_version_unpublished",
            )
        return version

    def clean(self):
        cleaned = super().clean()
        asset, version = cleaned.get("model_asset"), cleaned.get("pinned_version")
        mapping = cleaned.get("animation_map")
        if asset is None or not isinstance(mapping, dict) or not mapping:
            return cleaned
        if "pinned_version" in self.errors or set(mapping) - set(ANIMATION_STATES):
            return cleaned  # fix the version, or the unknown states, first
        if version is not None and version.asset_id != asset.pk:
            return cleaned  # the model's clean() names this mismatch
        resolved = version or asset.default_version
        clips = list(resolved.clips) if resolved is not None else list(asset.clips)
        missing = sorted(
            f"{state} -> {clip!r}" for state, clip in mapping.items() if clip not in clips
        )
        if missing:
            self.add_error(
                "animation_map",
                forms.ValidationError(
                    "These clips are not in %(asset)s: %(missing)s. Available clips: "
                    "%(available)s.",
                    code="npc_unknown_clip",
                    params={
                        "asset": asset.asset_id,
                        "missing": ", ".join(missing),
                        "available": ", ".join(clips) or "none",
                    },
                ),
            )
        return cleaned


class VariantAssetForm(forms.ModelForm):
    class Meta:
        model = NpcVariantAsset
        fields = "__all__"

    def clean(self):
        cleaned = super().clean()
        role, asset = cleaned.get("role"), cleaned.get("asset")
        if role and asset is not None:
            problem = asset_problem(
                asset, EXTRA_KINDS.get(role, ()), check_status="asset" in self.changed_data
            )
            if problem:
                self.add_error("asset", forms.ValidationError(problem, code="npc_asset_kind"))
        return cleaned


class CharacterCreateForm(forms.ModelForm):
    """Attach a profile to an existing NPC, or create a Django-only NPC in the same transaction."""

    definition = forms.ModelChoiceField(
        queryset=NpcDefinition.objects.filter(character__isnull=True).order_by("npc_id"),
        required=False,
        label="Existing NPC",
        help_text="An NPC from the content export (or made in Django) that has no profile yet.",
    )
    new_npc_id = forms.SlugField(
        max_length=SLUG_LENGTH,
        required=False,
        label="New NPC id",
        help_text="Or create a Django-only NPC: its stable slug, e.g. harbor-gull. Never reused.",
    )
    new_display_name = forms.CharField(max_length=80, required=False, label="New NPC name")
    new_home_place = forms.ModelChoiceField(
        queryset=Location.objects.order_by("slug"), required=False, label="New NPC home place"
    )

    class Meta:
        model = NpcCharacter
        fields = (
            "definition",
            "role",
            "status",
            "dialogue_mode",
            "age_bands",
            "personality",
            "voice_profile",
            "notes",
        )

    def clean(self):
        cleaned = super().clean()
        existing, new_id = cleaned.get("definition"), cleaned.get("new_npc_id")
        if existing and new_id:
            raise forms.ValidationError(
                "Choose an existing NPC or create a new one, not both.", code="npc_choose_one"
            )
        if not existing and not new_id:
            if "new_npc_id" not in self.errors:
                raise forms.ValidationError(
                    "Choose an existing NPC, or give a new NPC id, name and home place.",
                    code="npc_choose_one",
                )
            return cleaned
        if new_id:
            if NpcDefinition.objects.filter(npc_id=new_id).exists():
                self.add_error(
                    "new_npc_id",
                    "An NPC with this id already exists; choose it under Existing NPC instead.",
                )
            if not cleaned.get("new_display_name"):
                self.add_error("new_display_name", "A new NPC needs a name.")
            if not cleaned.get("new_home_place"):
                self.add_error("new_home_place", "A new NPC needs a home place.")
        return cleaned

    def new_definition(self) -> NpcDefinition | None:
        """The unsaved Django-origin definition this form asks for, or None."""
        if not self.cleaned_data.get("new_npc_id"):
            return None
        place = self.cleaned_data["new_home_place"]
        return NpcDefinition(
            npc_id=self.cleaned_data["new_npc_id"],
            display_name=self.cleaned_data["new_display_name"],
            home_location=place,
            home_location_slug=place.slug,
            origin=AssetOrigin.DJANGO,
            source={},
        )


# --- characters and variants ---------------------------------------------------------------------


class VariantInline(admin.StackedInline):
    model = NpcModelVariant
    form = VariantForm
    extra = 0
    show_change_link = True
    autocomplete_fields = ("model_asset", "pinned_version", "portrait_asset")
    fields = (
        ("variant_key", "display_name", "is_default", "sort_order"),
        ("model_asset", "pinned_version"),
        "available_clips",
        "preview_link",
        "portrait_asset",
        ("scale", "rotation_offset_y", "position_offset_y"),
        "animation_map",
        "availability",
    )
    readonly_fields = ("available_clips", "preview_link")

    def get_readonly_fields(self, request, obj=None):
        return _preview_readonly(super().get_readonly_fields(request, obj), request)

    def get_fields(self, request, obj=None):
        return _without_hidden_preview(super().get_fields(request, obj), request)

    @admin.display(description="Available clips")
    def available_clips(self, obj):
        return _available_clips(obj)

    @admin.display(description="Model preview")
    def preview_link(self, obj):
        return _preview(obj)


def _preview_readonly(fields, request):
    fields = list(fields)
    if not asset_preview.can_preview(request.user):
        fields = [name for name in fields if name != "preview_link"]
    return fields


def _without_hidden_preview(fields, request):
    if asset_preview.can_preview(request.user):
        return fields
    return [name for name in fields if name != "preview_link"]


def _available_clips(variant) -> str:
    if variant is None or not variant.model_asset_id:
        return "Choose a model and save to see its clips."
    clips, source = model_clips(variant)
    if not clips:
        return (
            f"{source} has no animation clips; the game uses a gentle placeholder motion. "
            "Leave the animation map empty."
        )
    return f"{source}: {', '.join(clips)}"


def _preview(variant) -> str:
    if variant is None or not variant.model_asset_id:
        return "Choose a model and save to preview it."
    version = resolved_version(variant)
    if version is None:
        return "Bundled with the game (no stored version to preview)."
    return asset_preview.link_for(version)


@admin.register(NpcCharacter)
class NpcCharacterAdmin(AuditedAdmin):
    list_display = (
        "npc_id",
        "display_name",
        "role",
        "status",
        "dialogue_mode",
        "origin",
        "variant_count",
        "updated_at",
    )
    list_filter = ("role", "status", "dialogue_mode", "definition__origin")
    search_fields = ("definition__npc_id", "definition__display_name")
    list_select_related = ("definition",)
    actions = ("mark_ready", "mark_draft", "mark_retired")
    autocomplete_fields = ()
    readonly_fields = ("definition", "origin", "placements_summary", "dialogues_summary")
    inlines = (VariantInline,)

    fieldsets = (
        (None, {"fields": ("definition", "origin")}),
        (
            "Profile",
            {
                "fields": (
                    ("role", "status", "dialogue_mode"),
                    "age_bands",
                    "personality",
                    "voice_profile",
                    "notes",
                )
            },
        ),
        ("Used in", {"fields": ("placements_summary", "dialogues_summary")}),
    )
    add_fieldsets = (
        (
            "NPC",
            {
                "description": (
                    "Attach this profile to an NPC that has none yet, or create a new "
                    "Django-only NPC. Nothing is shown to children until it is Ready and "
                    "published."
                ),
                "fields": ("definition", "new_npc_id", "new_display_name", "new_home_place"),
            },
        ),
        (
            "Profile",
            {
                "fields": (
                    ("role", "status", "dialogue_mode"),
                    "age_bands",
                    "personality",
                    "voice_profile",
                    "notes",
                )
            },
        ),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_variants=Count("variants"))

    def get_fieldsets(self, request, obj=None):
        return self.add_fieldsets if obj is None else self.fieldsets

    def get_readonly_fields(self, request, obj=None):
        if obj is None:
            return ()
        return super().get_readonly_fields(request, obj)

    def get_inlines(self, request, obj):
        return self.inlines if obj is not None else ()

    def get_form(self, request, obj=None, change=False, **kwargs):
        if obj is None:
            kwargs["form"] = CharacterCreateForm
        return super().get_form(request, obj, change=change, **kwargs)

    def save_model(self, request, obj, form, change):
        if not change:
            definition = form.new_definition()
            if definition is not None:
                # Same transaction as the profile: Django Admin wraps the add view atomically.
                definition.full_clean()
                definition.save()
                obj.definition = definition
        super().save_model(request, obj, form, change)

    def has_delete_permission(self, request, obj=None):
        return False  # retire through the status; releases keep their own copy

    # --- display ---

    @admin.display(description="NPC id", ordering="definition__npc_id")
    def npc_id(self, obj) -> str:
        return obj.definition.npc_id

    @admin.display(description="Name", ordering="definition__display_name")
    def display_name(self, obj) -> str:
        return obj.definition.display_name

    @admin.display(description="Origin", ordering="definition__origin")
    def origin(self, obj) -> str:
        return obj.definition.get_origin_display() if obj and obj.definition_id else ""

    @admin.display(description="Variants", ordering="_variants")
    def variant_count(self, obj) -> int:
        return getattr(obj, "_variants", 0)

    @admin.display(description="Placements")
    def placements_summary(self, obj):
        rows = obj.placements.select_related("location").order_by("location__slug")
        if not rows:
            return "Not placed anywhere yet."
        return format_html_join(
            ", ",
            '<a href="{}">{}/{}</a>',
            (
                (
                    reverse("admin:npcs_npcplacement_change", args=[p.pk]),
                    p.location.slug,
                    p.placement_key,
                )
                for p in rows
            ),
        )

    @admin.display(description="Dialogues")
    def dialogues_summary(self, obj):
        rows = obj.dialogues.order_by("dialogue_key")
        if not rows:
            return "No dialogue yet."
        return format_html_join(
            ", ",
            '<a href="{}">{}</a> ({})',
            (
                (reverse("admin:npcs_npcdialogue_change", args=[d.pk]), d.dialogue_key, d.trigger)
                for d in rows
            ),
        )

    # --- status actions ---

    def _set_status(self, request, queryset, status: str) -> None:
        count = 0
        for character in queryset.select_related("definition"):
            if character.status == status:
                continue
            character.status = status
            character.updated_by = request.user
            character.save(update_fields=["status", "updated_by", "updated_at"])
            self.log_change(request, character, f"Status set to {status}.")
            count += 1
        label = CharacterStatus(status).label
        self.message_user(
            request,
            f"{count} character(s) set to {label}. Children see the change only after the next "
            "publish.",
            messages.SUCCESS,
        )

    @admin.action(description="Mark selected characters Ready to publish", permissions=["change"])
    def mark_ready(self, request, queryset):
        self._set_status(request, queryset, CharacterStatus.READY)

    @admin.action(description="Mark selected characters Draft", permissions=["change"])
    def mark_draft(self, request, queryset):
        self._set_status(request, queryset, CharacterStatus.DRAFT)

    @admin.action(description="Retire selected characters", permissions=["change"])
    def mark_retired(self, request, queryset):
        self._set_status(request, queryset, CharacterStatus.RETIRED)


class VariantAssetInline(admin.TabularInline):
    model = NpcVariantAsset
    form = VariantAssetForm
    extra = 0
    autocomplete_fields = ("asset",)
    fields = ("role", "asset", "attach_point", "sort_order")
    verbose_name = "extra asset"
    verbose_name_plural = (
        "extra assets (texture: texture or image; accessory: prop or character; portrait: image "
        "or sprite; audio: audio)"
    )


@admin.register(NpcModelVariant)
class NpcModelVariantAdmin(AuditedAdmin):
    form = VariantForm
    list_display = (
        "__str__",
        "character",
        "variant_key",
        "model_asset",
        "pinned_version",
        "is_default",
        "preview_link",
    )
    list_filter = ("is_default", "character__status")
    search_fields = ("variant_key", "character__definition__npc_id", "model_asset__asset_id")
    list_select_related = (
        "character__definition",
        "model_asset__default_version",
        "pinned_version",
    )
    autocomplete_fields = ("character", "model_asset", "pinned_version", "portrait_asset")
    inlines = (VariantAssetInline,)
    fields = ("character", *VariantInline.fields)
    readonly_fields = ("available_clips", "preview_link")

    def get_readonly_fields(self, request, obj=None):
        return _preview_readonly(super().get_readonly_fields(request, obj), request)

    def get_fields(self, request, obj=None):
        return _without_hidden_preview(super().get_fields(request, obj), request)

    @admin.display(description="Available clips")
    def available_clips(self, obj):
        return _available_clips(obj)

    @admin.display(description="Model preview")
    def preview_link(self, obj):
        return _preview(obj)


# --- placements ----------------------------------------------------------------------------------


class PlacementForm(forms.ModelForm):
    class Meta:
        model = NpcPlacement
        fields = "__all__"
        help_texts = {"spawn_conditions": CONDITIONS_HELP}


@admin.register(NpcPlacement)
class NpcPlacementAdmin(AuditedAdmin):
    form = PlacementForm
    list_display = (
        "placement_key",
        "character",
        "world",
        "location",
        "region",
        "variant",
        "behavior",
        "active",
    )
    list_filter = ("active", "world", "location")
    search_fields = ("placement_key", "character__definition__npc_id", "location__slug")
    list_select_related = (
        "character__definition",
        "world",
        "location",
        "region",
        "variant",
        "behavior",
    )
    autocomplete_fields = ("character",)
    fieldsets = (
        (None, {"fields": ("placement_key", "character", "active", "sort_order")}),
        (
            "Where",
            {
                "description": (
                    "Island, then a Place on it, then optionally that Place's 3D Area. "
                    "Coordinates are metres in the 3D Area's frame; y is elevation."
                ),
                "fields": ("world", "location", "region", ("x", "y", "z"), "rotation_y"),
            },
        ),
        (
            "Look and behaviour",
            {"fields": ("variant", "behavior", "scale", "interaction_radius", "spawn_conditions")},
        ),
    )

    def get_form(self, request, obj=None, change=False, **kwargs):
        form = super().get_form(request, obj, change=change, **kwargs)
        if obj is not None and "variant" in form.base_fields:
            form.base_fields["variant"].queryset = obj.character.variants.all()
        return form


# --- dialogue authoring (the engine is workstream C) ---------------------------------------------


def _audio_problem(asset, changed: bool) -> str | None:
    return asset_problem(asset, ("audio",), check_status=changed)


class DialogueNodeForm(forms.ModelForm):
    class Meta:
        model = NpcDialogueNode
        fields = "__all__"
        help_texts = {"conditions": CONDITIONS_HELP}

    def clean_audio_asset(self):
        asset = self.cleaned_data.get("audio_asset")
        problem = _audio_problem(asset, "audio_asset" in self.changed_data)
        if problem:
            raise forms.ValidationError(problem, code="npc_asset_kind")
        return asset


def _limit_nodes(form_class, field: str, dialogue):
    """A form class whose `field` offers only the nodes of `dialogue` (none when unsaved)."""
    queryset = dialogue.nodes.all() if dialogue is not None else NpcDialogueNode.objects.none()

    class Limited(form_class):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            if field in self.fields:
                self.fields[field].queryset = queryset

    return Limited


class DialogueNodeInline(admin.TabularInline):
    model = NpcDialogueNode
    form = DialogueNodeForm
    fk_name = "dialogue"
    extra = 0
    show_change_link = True
    autocomplete_fields = ("audio_asset",)
    fields = (
        "node_key",
        "text",
        "emotion",
        "animation_state",
        "audio_asset",
        "next_node",
        "allow_ai_hint",
        "sort_order",
    )
    verbose_name_plural = "nodes (open a node to edit its choices, conditions and age bands)"

    def get_formset(self, request, obj=None, **kwargs):
        kwargs["form"] = _limit_nodes(self.form, "next_node", obj)
        return super().get_formset(request, obj, **kwargs)


class DialogueForm(forms.ModelForm):
    class Meta:
        model = NpcDialogue
        fields = "__all__"
        help_texts = {"conditions": CONDITIONS_HELP}


@admin.register(NpcDialogue)
class NpcDialogueAdmin(AuditedAdmin):
    form = DialogueForm
    list_display = ("dialogue_key", "character", "trigger", "mode", "priority", "active")
    list_filter = ("trigger", "mode", "active")
    search_fields = ("dialogue_key", "title", "character__definition__npc_id")
    list_select_related = ("character__definition",)
    autocomplete_fields = ("character",)
    inlines = (DialogueNodeInline,)
    fields = (
        ("character", "dialogue_key"),
        "title",
        ("trigger", "mode", "priority"),
        "start_node",
        ("once_per_child", "active"),
        "age_bands",
        "conditions",
    )

    def get_form(self, request, obj=None, change=False, **kwargs):
        kwargs["form"] = _limit_nodes(self.form, "start_node", obj)
        form = super().get_form(request, obj, change=change, **kwargs)
        if "start_node" in form.base_fields:
            form.base_fields[
                "start_node"
            ].help_text = "One of this dialogue's nodes. Add nodes below and save, then choose it."
        return form


class DialogueChoiceInline(admin.TabularInline):
    model = NpcDialogueChoice
    fk_name = "node"
    extra = 0
    fields = ("choice_key", "label", "next_node", "action", "action_value", "conditions")

    def get_formset(self, request, obj=None, **kwargs):
        dialogue = obj.dialogue if obj is not None else None
        kwargs["form"] = _limit_nodes(forms.ModelForm, "next_node", dialogue)
        return super().get_formset(request, obj, **kwargs)


@admin.register(NpcDialogueNode)
class NpcDialogueNodeAdmin(admin.ModelAdmin):
    form = DialogueNodeForm
    list_display = ("__str__", "dialogue", "node_key", "emotion", "allow_ai_hint")
    search_fields = ("node_key", "text", "dialogue__dialogue_key")
    list_select_related = ("dialogue__character__definition",)
    autocomplete_fields = ("dialogue", "audio_asset")
    inlines = (DialogueChoiceInline,)
    fields = (
        ("dialogue", "node_key", "sort_order"),
        "text",
        ("emotion", "animation_state"),
        "audio_asset",
        "next_node",
        ("allow_ai_hint", "allowed_topic"),
        "age_bands",
        "conditions",
    )

    def get_form(self, request, obj=None, change=False, **kwargs):
        dialogue = obj.dialogue if obj is not None else None
        kwargs["form"] = _limit_nodes(self.form, "next_node", dialogue)
        return super().get_form(request, obj, change=change, **kwargs)


# --- releases ------------------------------------------------------------------------------------

PUBLISH_REFUSALS = {
    "unchanged": "Nothing changed since the active release, so there is nothing to publish.",
    "already_active": "That release is already active.",
    "retired": "A retired release never comes back. Publish a new one instead.",
    "schema_mismatch": "That release was made for an older format and cannot be reactivated.",
}


@admin.register(NpcRelease)
class NpcReleaseAdmin(admin.ModelAdmin):
    """Read-only release history plus validate, publish, roll back and retire pages."""

    list_display = (
        "number",
        "status",
        "notes",
        "short_hash",
        "created_by_label",
        "created_at",
        "activated_at",
    )
    list_filter = ("status",)
    search_fields = ("notes", "content_hash")
    ordering = ("-number",)
    change_list_template = "admin/npcs/npcrelease/change_list.html"
    change_form_template = "admin/npcs/npcrelease/change_form.html"
    fields = (
        "number",
        "status",
        "notes",
        "content_hash",
        "schema_version",
        "created_by_label",
        "created_at",
        "activated_by_label",
        "activated_at",
        "retired_at",
        "contents",
        "asset_dependencies",
    )
    readonly_fields = fields

    # --- permissions ---

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False  # releases are immutable and never deleted

    def can_publish(self, request) -> bool:
        return request.user.has_perm("npcs.publish_npcrelease")

    def can_rollback(self, request) -> bool:
        return request.user.has_perm("npcs.rollback_npcrelease")

    # --- pages ---

    def get_urls(self):
        view = self.admin_site.admin_view
        return [
            path("validate/", view(self.validate_view), name="npcs_npcrelease_validate"),
            path("publish/", view(self.publish_view), name="npcs_npcrelease_publish"),
            path(
                "dependencies/", view(self.dependencies_view), name="npcs_npcrelease_dependencies"
            ),
            path(
                "<int:object_id>/rollback/",
                view(self.rollback_view),
                name="npcs_npcrelease_rollback",
            ),
            path("<int:object_id>/retire/", view(self.retire_view), name="npcs_npcrelease_retire"),
            *super().get_urls(),
        ]

    def changelist_view(self, request, extra_context=None):
        extra_context = {**(extra_context or {}), **self._tool_context(request)}
        return super().changelist_view(request, extra_context)

    def change_view(self, request, object_id, form_url="", extra_context=None):
        context = self._tool_context(request)
        release = NpcRelease.objects.filter(pk=object_id).first()
        if release is not None:
            context.update(
                show_rollback=context["can_rollback"]
                and release.status == ReleaseStatus.SUPERSEDED,
                show_retire=context["can_rollback"] and release.status != ReleaseStatus.RETIRED,
                is_active=release.status == ReleaseStatus.ACTIVE,
            )
        return super().change_view(
            request, object_id, form_url, {**context, **(extra_context or {})}
        )

    def _tool_context(self, request) -> dict:
        return {
            "can_publish": self.can_publish(request),
            "can_rollback": self.can_rollback(request),
        }

    def _page(self, request, template: str, title: str, **context):
        return TemplateResponse(
            request,
            f"admin/npcs/npcrelease/{template}",
            {
                **self.admin_site.each_context(request),
                "opts": self.model._meta,
                "title": title,
                **self._tool_context(request),
                **context,
            },
        )

    def validate_view(self, request, problems=None, refused=False):
        if not self.has_view_permission(request):
            raise PermissionDenied
        result = publishing.preview()
        found = result.problems if problems is None else problems
        snapshot = result.built.snapshot
        return self._page(
            request,
            "validate.html",
            "Validate the NPC draft",
            problems=found,
            unchanged=result.unchanged and not found,
            ready=not found and not result.unchanged,
            refused=refused,
            character_count=len(snapshot.get("characters", {})),
            placement_count=len(snapshot.get("placements", [])),
            asset_count=len({use.asset_id for use in result.built.asset_uses}),
            active=publishing.active_release(),
        )

    def publish_view(self, request):
        if request.method != "POST":
            return HttpResponseNotAllowed(["POST"])
        if not self.can_publish(request):
            raise PermissionDenied
        try:
            release = publishing.publish(request.user, notes=request.POST.get("notes", ""))
        except publishing.PublishError as error:
            if error.code == "invalid":
                self.message_user(
                    request,
                    f"Not published: {len(error.problems)} problem(s) must be fixed first. "
                    "Nothing was changed.",
                    messages.ERROR,
                )
                return self.validate_view(request, problems=error.problems, refused=True)
            self.message_user(
                request, PUBLISH_REFUSALS.get(error.code, error.code), messages.WARNING
            )
            return redirect("admin:npcs_npcrelease_validate")
        self.log_addition(request, release, [{"added": {}}])
        self.message_user(
            request,
            f"Published NPC release {release.number}. Children now see it.",
            messages.SUCCESS,
        )
        return redirect("admin:npcs_npcrelease_change", release.pk)

    def _lifecycle(self, request, object_id, action, done: str):
        if request.method != "POST":
            return HttpResponseNotAllowed(["POST"])
        if not self.can_rollback(request):
            raise PermissionDenied
        release = get_object_or_404(NpcRelease, pk=object_id)
        try:
            release = action(release, request.user)
        except publishing.PublishError as error:
            if error.problems:
                text = f"Not {done}: " + "; ".join(error.problems)
            else:
                text = f"Not {done}: " + PUBLISH_REFUSALS.get(error.code, error.code)
            self.message_user(request, text, messages.ERROR)
        else:
            self.log_change(request, release, f"{done.capitalize()} the release.")
            self.message_user(request, f"{release} {done}.", messages.SUCCESS)
            if done == "retired" and publishing.active_release() is None:
                self.message_user(
                    request,
                    "No NPC release is active now: children see no NPCs until you publish or "
                    "roll back.",
                    messages.WARNING,
                )
        return redirect("admin:npcs_npcrelease_change", object_id)

    def rollback_view(self, request, object_id):
        return self._lifecycle(request, object_id, publishing.rollback, "rolled back")

    def retire_view(self, request, object_id):
        return self._lifecycle(request, object_id, publishing.retire, "retired")

    def dependencies_view(self, request):
        if not self.has_view_permission(request):
            raise PermissionDenied
        asset_id = request.GET.get("asset", "").strip() or None
        return self._page(
            request,
            "dependencies.html",
            "NPC asset dependencies",
            reports=dependencies.report(asset_id),
            asset_id=asset_id or "",
        )

    # --- display ---

    @admin.display(description="Hash")
    def short_hash(self, obj) -> str:
        return obj.content_hash[:12]

    @admin.display(description="Created by")
    def created_by_label(self, obj) -> str:
        return _user_label(obj.created_by)

    @admin.display(description="Activated by")
    def activated_by_label(self, obj) -> str:
        return _user_label(obj.activated_by)

    @admin.display(description="Contents")
    def contents(self, obj) -> str:
        snapshot = obj.snapshot or {}
        names = sorted(snapshot.get("characters", {}))
        return (
            f"{len(names)} character(s): {', '.join(names) or 'none'}; "
            f"{len(snapshot.get('placements', []))} placement(s)."
        )

    @admin.display(description="Asset dependencies")
    def asset_dependencies(self, obj):
        links = obj.asset_links.select_related("asset", "version").order_by("asset__asset_id")
        if not links:
            return "None."
        return format_html(
            "<ul>{}</ul>",
            format_html_join(
                "",
                "<li><code>{}</code> {}: {}</li>",
                (
                    (
                        link.asset.asset_id,
                        f"v{link.version.number}" if link.version_id else "(bundled)",
                        link.usage,
                    )
                    for link in links
                ),
            ),
        )
