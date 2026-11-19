"""Player avatars in Django Admin (LAI-JMP-01c, `docs/PLAYER_AVATAR_ASSETS.md` section "Staff
workflow").

Staff upload, validate, version, publish and retire the GLB in the existing asset library
(Assets pages); this page only says which published character each of the six identities is
drawn with, and how. Grant access with `manage.py ensure_asset_roles`:

- Asset editors: view and configure avatars (model, pinned version, scale, facing, animation
  map, customization, thumbnail). A draft never reaches children.
- Asset publishers: also "Make available" and "Disable" (`avatars.publish_playeravatar`).

The six rows are created by the migration; there is no add or delete. Every page shows exactly
what children choosing that avatar would receive, from the same function the play API uses.
"""

from __future__ import annotations

import json

from django.contrib import admin, messages
from django.utils.html import format_html, format_html_join

from apps.assets import preview as asset_preview

from . import services, validation
from .models import PlayerAvatar
from .vocabulary import AvatarStatus


def _pretty(value) -> str:
    return format_html("<pre style='white-space:pre-wrap'>{}</pre>", json.dumps(value, indent=2))


@admin.register(PlayerAvatar)
class PlayerAvatarAdmin(admin.ModelAdmin):
    list_display = ("avatar_key", "display_name", "status", "model_asset", "served", "readiness")
    list_filter = ("status",)
    search_fields = ("avatar_key", "display_name", "model_asset__asset_id")
    autocomplete_fields = ("model_asset", "thumbnail_asset")
    raw_id_fields = ("pinned_version",)
    readonly_fields = (
        "avatar_key",
        "status",
        "model_clips",
        "effective_map",
        "findings",
        "children_receive",
        "preview_link",
        "updated_at",
        "updated_by",
    )
    fieldsets = (
        ("Identity", {"fields": ("avatar_key", "display_name", "status", "notes")}),
        (
            "Model (from the asset library)",
            {
                "fields": (
                    "model_asset",
                    "pinned_version",
                    "preview_link",
                    "scale",
                    "rotation_offset_y",
                )
            },
        ),
        ("Animation", {"fields": ("model_clips", "animation_map", "effective_map")}),
        ("Customization", {"fields": ("customization",)}),
        ("Thumbnail", {"fields": ("thumbnail_asset",)}),
        ("Check", {"fields": ("findings", "children_receive", "updated_at", "updated_by")}),
    )
    actions = ("make_available", "make_draft", "disable")

    # The six identities are fixed: the migration creates them, nobody adds or deletes one.
    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)

    # --- read-only facts -------------------------------------------------------------------

    @admin.display(description="Served version")
    def served(self, obj: PlayerAvatar) -> str:
        version = validation.served_version(obj)
        return f"v{version.number} ({version.status.lower()})" if version else "-"

    @admin.display(description="Check")
    def readiness(self, obj: PlayerAvatar) -> str:
        found = validation.problems(obj, for_availability=True)
        return "Ready" if not found else f"{len(found)} to fix"

    @admin.display(description="Clips in the served model")
    def model_clips(self, obj: PlayerAvatar) -> str:
        version = validation.served_version(obj)
        return ", ".join(version.clips) if version and version.clips else "-"

    @admin.display(description="Clip each state will play")
    def effective_map(self, obj: PlayerAvatar):
        version = validation.served_version(obj)
        if version is None:
            return "-"
        return _pretty(validation.effective_animation_map(obj.animation_map, version.clips))

    @admin.display(description="Problems and warnings")
    def findings(self, obj: PlayerAvatar):
        problems = validation.problems(obj, for_availability=True)
        notes = validation.warnings(obj)
        if not problems and not notes:
            return "Ready to make available."
        rows = [("Problem", text) for text in problems] + [("Warning", text) for text in notes]
        return format_html(
            "<ul>{}</ul>", format_html_join("", "<li><strong>{}:</strong> {}</li>", rows)
        )

    @admin.display(description="What children choosing this avatar receive")
    def children_receive(self, obj: PlayerAvatar):
        return _pretty(services.describe(obj, obj.avatar_key))

    @admin.display(description="Preview")
    def preview_link(self, obj: PlayerAvatar):
        version = validation.served_version(obj)
        if version is None:
            return "-"
        return format_html(
            '<a href="{}">Preview v{} in the asset library</a>',
            asset_preview.link_for(version),
            version.number,
        )

    # --- state changes ---------------------------------------------------------------------

    def _can_publish(self, request) -> bool:
        return request.user.has_perm("avatars.publish_playeravatar")

    @admin.action(description="Make available to children")
    def make_available(self, request, queryset):
        if not self._can_publish(request):
            self.message_user(request, "Only asset publishers can do that.", messages.ERROR)
            return
        for avatar in queryset:
            found = validation.problems(avatar, for_availability=True)
            if found:
                self.message_user(
                    request,
                    f"{avatar.display_name} was not made available: {' '.join(found)}",
                    messages.ERROR,
                )
                continue
            avatar.status = AvatarStatus.AVAILABLE
            avatar.updated_by = request.user
            avatar.save(update_fields=["status", "updated_by", "updated_at"])
            self.message_user(request, f"{avatar.display_name} is now available to children.")

    def _set(self, request, queryset, status: str, label: str) -> None:
        if not self._can_publish(request):
            self.message_user(request, "Only asset publishers can do that.", messages.ERROR)
            return
        count = queryset.update(status=status, updated_by=request.user)
        self.message_user(request, f"{count} avatar(s) {label}; children get the placeholder.")

    @admin.action(description="Make draft (children get the placeholder)")
    def make_draft(self, request, queryset):
        self._set(request, queryset, AvatarStatus.DRAFT, "made drafts")

    @admin.action(description="Disable (children get the placeholder)")
    def disable(self, request, queryset):
        self._set(request, queryset, AvatarStatus.DISABLED, "disabled")
