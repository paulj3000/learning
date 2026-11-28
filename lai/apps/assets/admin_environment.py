"""Django Admin for image profiles and materials (LAI-ENV-02; `docs/ENVIRONMENT_ASSETS.md`).

- **Image profiles** follow the collision profile admin: one default per image asset plus an
  optional per-version override, saved changes reach children on their next visit through the
  resolver. The page previews the image, its transparency (over a checkerboard), a 3 x 3 tiling
  preview for surfaces and maps, and the frame grid of a sprite sheet. Previews use the existing
  staff media route, which verifies the checksum and sends hardening headers.
- **Materials** are ADR-047 authorable records: the row is created here (pick a content asset of
  kind `material`), and its content is edited, published and rolled back through the shared
  content-version editor ("Edit content (start a draft)").

Permissions are the models' own (`assets.*_imageprofile`, `assets.*_materialdefinition`) plus
ADR-047's `catalog.edit_content_draft` and `catalog.publish_content` for material content.
"""

import logging

from django import forms
from django.contrib import admin, messages
from django.urls import reverse
from django.utils.html import format_html, format_html_join

from apps.catalog.authoring_admin import AuthoredContentAdminMixin
from apps.catalog.models import ContentAsset

from . import image_profiles, licences
from .models import AssetVersion, ImageProfile, MaterialDefinition, VersionStatus

logger = logging.getLogger("lai.assets")

IMAGE_KINDS = tuple(image_profiles.KIND_ROLES)

GRID_LINES = (
    "background-image:linear-gradient(to right,rgba(255,0,0,.6) 1px,transparent 1px),"
    "linear-gradient(to bottom,rgba(255,0,0,.6) 1px,transparent 1px);"
)

PROFILE_HELP = (
    "How this image is drawn wherever a scene uses it. Fill in only the fields for its role; "
    "the others are refused. Sprites, decals, particles, backdrops and skies never block "
    "movement: collision is authored on models and placements only."
)


class ImageProfileForm(forms.ModelForm):
    class Meta:
        model = ImageProfile
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if "asset" in self.fields:
            self.fields["asset"].queryset = ContentAsset.objects.filter(kind__in=IMAGE_KINDS)
        if "version" in self.fields:
            versions = AssetVersion.objects.filter(
                status__in=[VersionStatus.VALIDATED, VersionStatus.PUBLISHED],
                asset__kind__in=IMAGE_KINDS,
            ).select_related("asset")
            asset = self._chosen_asset()
            if asset is not None:
                versions = versions.filter(asset=asset)
            self.fields["version"].queryset = versions
        self.warnings: list[str] = []

    def _chosen_asset(self):
        if self.is_bound and "asset" in self.fields:
            try:
                return self.fields["asset"].clean(self.data.get(self.add_prefix("asset")))
            except forms.ValidationError:
                return None
        return self.instance.asset if self.instance.asset_id else None

    def clean(self):
        cleaned = super().clean()
        if self.errors:
            return cleaned
        candidate = self.instance
        for name, value in cleaned.items():
            setattr(candidate, name, value)
        self.warnings = image_profiles.clean_profile(candidate)
        return cleaned


def _media_url(version) -> str:
    return reverse("admin:assets_assetversion_media", args=[version.pk])


@admin.register(ImageProfile)
class ImageProfileAdmin(admin.ModelAdmin):
    form = ImageProfileForm
    list_display = ("asset", "scope", "role", "colour_space", "alpha_mode", "updated_at")
    list_filter = ("role", "colour_space", "alpha_mode", "asset__kind")
    search_fields = ("asset__asset_id", "asset__display_name", "recommended_usage", "notes")
    list_select_related = ("asset", "version")
    autocomplete_fields = ("asset",)
    readonly_fields = ("image_facts", "preview", "runtime_preview", "updated_by", "updated_at")
    fieldsets = (
        (None, {"fields": ("asset", "version", "role"), "description": PROFILE_HELP}),
        (
            "Colour and transparency",
            {
                "fields": (
                    "colour_space",
                    "data_channel",
                    "normal_convention",
                    ("alpha_mode", "alpha_cutoff"),
                )
            },
        ),
        (
            "Tiling (surfaces and material maps)",
            {
                "fields": (
                    ("seamless", "wrap"),
                    "metres_per_repeat",
                    ("repeat_u", "repeat_v"),
                    "rotation_degrees",
                )
            },
        ),
        (
            "Size and placement (sprites, decals, particles, backdrops)",
            {
                "fields": (
                    ("world_width_m", "world_height_m"),
                    ("anchor_x", "anchor_y"),
                    "placement",
                    "decal_depth_m",
                    "opacity",
                    "blending",
                )
            },
        ),
        (
            "Sprite sheet",
            {
                "fields": (
                    ("sheet_columns", "sheet_rows"),
                    ("frame_count", "frames_per_second", "loop"),
                )
            },
        ),
        ("Sky", {"fields": ("sky_layout",)}),
        ("What the game receives", {"fields": ("image_facts", "preview", "runtime_preview")}),
        (None, {"fields": ("recommended_usage", "notes", "updated_by", "updated_at")}),
    )

    def _perm(self, request, codename: str) -> bool:
        return request.user.has_perm(f"assets.{codename}_imageprofile")

    def has_view_permission(self, request, obj=None):
        return self._perm(request, "view") or self._perm(request, "change")

    def has_add_permission(self, request):
        return self._perm(request, "add")

    def has_change_permission(self, request, obj=None):
        return self._perm(request, "change")

    def has_delete_permission(self, request, obj=None):
        return self._perm(request, "delete")

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)
        logger.info("image profile saved: %s", obj)
        for warning in getattr(form, "warnings", []):
            self.message_user(request, warning, messages.WARNING)
        version = image_profiles.profile_version(obj)
        problem = licences.licence_problem(version) if version is not None else None
        if problem:
            # D-3: an existing image keeps resolving; it simply cannot join new realm content.
            self.message_user(
                request,
                f"licence_required: {obj.asset.asset_id} v{version.number} cannot be used by "
                f"materials or new versions published until it is licensed ({problem}).",
                messages.WARNING,
            )

    @admin.display(description="Scope")
    def scope(self, obj):
        return f"v{obj.version.number} only" if obj.version_id else "Asset default"

    @admin.display(description="Image")
    def image_facts(self, obj):
        version = image_profiles.profile_version(obj) if obj and obj.asset_id else None
        if version is None:
            return "No published or chosen version yet."
        meta = version.metadata or {}
        alpha = {True: "yes", False: "no"}.get(meta.get("hasAlpha"), "not recorded")
        return format_html(
            "{} v{}: {} x {} px, {}, alpha: {}, colour model: {}",
            version.asset.asset_id,
            version.number,
            meta.get("width", "?"),
            meta.get("height", "?"),
            version.format.upper(),
            alpha,
            meta.get("colourModel") or "not recorded",
        )

    @admin.display(description="Preview")
    def preview(self, obj):
        version = image_profiles.profile_version(obj) if obj and obj.asset_id else None
        if version is None or version.family != "image":
            return "-"
        url = _media_url(version)
        checker = (
            "background-color:#fff;background-image:linear-gradient(45deg,#ccc 25%,transparent "
            "25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,"
            "transparent 75%,#ccc 75%);background-size:16px 16px;background-position:0 0,8px 8px"
        )
        parts = [
            format_html(
                '<div style="{}display:inline-block;padding:4px"><img src="{}" alt="Image" '
                'style="max-width:256px;max-height:256px;display:block"></div>',
                checker + ";",
                url,
            )
        ]
        if obj.role in image_profiles.TILING_ROLES:
            parts.append(
                format_html(
                    '<div title="Tiling preview, 3 x 3 repeats" style="width:384px;height:384px;'
                    "margin-top:8px;border:1px solid #999;background-image:url('{}');"
                    'background-size:128px 128px;background-repeat:repeat"></div>'
                    "<p>3 x 3 repeats: a visible seam means the image is not seamless.</p>",
                    url,
                )
            )
        columns, rows = obj.sheet_columns or 1, obj.sheet_rows or 1
        if columns > 1 or rows > 1:
            parts.append(
                format_html(
                    '<div style="position:relative;display:inline-block;margin-top:8px">'
                    '<img src="{}" alt="Sprite sheet" style="max-width:384px;display:block">'
                    '<div style="position:absolute;inset:0;{}'
                    'background-size:calc(100% / {}) calc(100% / {})"></div>'
                    "</div><p>Red lines: the {} x {} frame grid.</p>",
                    url,
                    GRID_LINES,
                    columns,
                    rows,
                    columns,
                    rows,
                )
            )
        return format_html_join("", "{}", ((part,) for part in parts))

    @admin.display(description="Runtime block (render)")
    def runtime_preview(self, obj):
        version = image_profiles.profile_version(obj) if obj and obj.asset_id else None
        if obj is None or obj.pk is None or version is None:
            return "Saved profiles show the block children receive."
        import json

        return format_html(
            "<pre>{}</pre>", json.dumps(image_profiles.render_block(obj, version), indent=2)
        )


class MaterialDefinitionForm(forms.ModelForm):
    class Meta:
        model = MaterialDefinition
        fields = ("asset",)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if "asset" in self.fields:
            self.fields["asset"].queryset = ContentAsset.objects.filter(
                kind="material", material_definition__isnull=True
            )
            self.fields["asset"].help_text = (
                "A content asset of kind material (Catalog > Content assets > Add). After "
                "saving, use Edit content to choose its textures and settings."
            )


@admin.register(MaterialDefinition)
class MaterialDefinitionAdmin(AuthoredContentAdminMixin, admin.ModelAdmin):
    form = MaterialDefinitionForm
    list_display = ("material_id", "published_version", "texture_list", "asset_status")
    search_fields = ("asset__asset_id", "asset__display_name")
    list_select_related = ("asset", "published_revision")
    readonly_fields = ("maps_summary", "texture_asset_ids", "updated_at")

    def get_fields(self, request, obj=None):
        if obj is None:
            return ["asset"]
        return [*super().get_fields(request, obj)]

    def get_readonly_fields(self, request, obj=None):
        fields = list(super().get_readonly_fields(request, obj))
        if obj is not None and "asset" not in fields:
            fields.append("asset")  # a material's identity never changes
        return fields

    def _perm(self, request, codename: str) -> bool:
        return request.user.has_perm(f"assets.{codename}_materialdefinition")

    def has_view_permission(self, request, obj=None):
        return self._perm(request, "view") or self._perm(request, "change")

    def has_add_permission(self, request):
        return self._perm(request, "add")

    def has_change_permission(self, request, obj=None):
        return self._perm(request, "change")

    def has_delete_permission(self, request, obj=None):
        return False  # authored records are never deleted (ADR-047-Q3); retire the asset

    @admin.display(description="Material", ordering="asset__asset_id")
    def material_id(self, obj):
        return obj.asset.asset_id

    @admin.display(description="Published version")
    def published_version(self, obj):
        return obj.published_revision.number if obj.published_revision_id else "none"

    @admin.display(description="Textures")
    def texture_list(self, obj):
        return ", ".join(obj.texture_asset_ids) or "-"

    @admin.display(description="Asset status")
    def asset_status(self, obj):
        return obj.asset.get_status_display()

    @admin.display(description="Published maps")
    def maps_summary(self, obj):
        maps = (obj.definition or {}).get("maps", {}) if obj else {}
        if not maps:
            return "No published maps (factors only, or not published yet)."
        rows = []
        for slot, entry in maps.items():
            asset = ContentAsset.objects.filter(asset_id=entry["assetId"]).first()
            link = (
                reverse("admin:catalog_contentasset_change", args=[asset.pk])
                if asset is not None
                else ""
            )
            rows.append((slot, link, entry["assetId"]))
        return format_html(
            "<ul>{}</ul>", format_html_join("", '<li>{}: <a href="{}">{}</a></li>', rows)
        )
