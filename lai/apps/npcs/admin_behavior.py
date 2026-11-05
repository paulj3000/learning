"""NPC behaviour profiles in the Django Admin (LAI-NPC-019, LAI-NPC-025), workstream D.

- List, search (`key`, `display_name`: workstream A's autocomplete selects rely on it), filter by
  type; saving records `created_by` / `updated_by`. Parameters are validated per type by the
  model's `clean` (`apps.npcs.behaviors.parameter_problems`); once that schema holds, the form
  also refuses what release validation would refuse (`validation.behavior.behavior_problems`:
  waypoints outside `boundsRadius`, wander radius, follow distances), so staff see it at save time.
- "Preview" (`<id>/preview/`): a read-only, server-rendered top-down SVG plot and the release
  validation problems for the profile (`preview_behavior`). Staff with the view permission only;
  it shows staff-authored content and placement keys, never child data, and changes nothing.
"""

from __future__ import annotations

from django import forms
from django.contrib import admin
from django.core.exceptions import PermissionDenied
from django.db.models import Count
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html

from . import preview_behavior
from .behaviors import parameter_problems, runtime_parameters
from .models import NpcBehaviorProfile, NpcPlacement
from .validation.behavior import behavior_problems

PARAMETERS_HELP = (
    "JSON object; metres, metres per second, seconds. Every type also accepts boundsRadius "
    "(default 15) and reactions {adventure event: animation state}. "
    'stationary {"facePlayer"}; wander {"radius", "speed", "pauseSeconds": [min, max]}; '
    'patrol {"waypoints": [{"x", "z", "pauseSeconds"?}], "speed", "loop"}; '
    'follow {"stopDistance", "speed", "giveUpDistance"}; '
    'guide {"waypoints", "speed", "waitForPlayerDistance"}; reactive {}; '
    'scripted {"steps": [moveTo(x, z) | play(state) | wait(seconds) | face(yaw)], "loop"}. '
    "Waypoint and moveTo coordinates are offsets from the placement."
)


class NpcBehaviorProfileForm(forms.ModelForm):
    class Meta:
        model = NpcBehaviorProfile
        fields = "__all__"

    def clean(self):
        data = super().clean()
        behavior_type, parameters = data.get("behavior_type"), data.get("parameters")
        # Schema problems are the model's to report (`NpcBehaviorProfile.clean`); geometry only
        # makes sense once the schema holds.
        if isinstance(parameters, dict) and behavior_type:
            if not parameter_problems(behavior_type, parameters):
                published = runtime_parameters(behavior_type, parameters)
                found = behavior_problems(behavior_type, published)
                if found:
                    self.add_error("parameters", found)
        return data


@admin.register(NpcBehaviorProfile)
class NpcBehaviorProfileAdmin(admin.ModelAdmin):
    form = NpcBehaviorProfileForm
    list_display = ("key", "display_name", "behavior_type", "placement_count", "preview_link")
    list_filter = ("behavior_type",)
    search_fields = ("key", "display_name")
    ordering = ("key",)
    fields = (
        "key",
        "display_name",
        "behavior_type",
        "parameters",
        "notes",
        "preview_link",
        "created_by",
        "created_at",
        "updated_by",
        "updated_at",
    )
    readonly_fields = ("preview_link", "created_by", "created_at", "updated_by", "updated_at")

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_placement_count=Count("placements"))

    @admin.display(description="placements", ordering="_placement_count")
    def placement_count(self, obj) -> int:
        return getattr(obj, "_placement_count", 0)

    @admin.display(description="preview")
    def preview_link(self, obj) -> str:
        if obj is None or obj.pk is None:
            return "-"
        url = reverse("admin:npcs_npcbehaviorprofile_preview", args=[obj.pk])
        return format_html('<a href="{}">Preview</a>', url)

    def get_form(self, request, obj=None, change=False, **kwargs):
        form = super().get_form(request, obj, change=change, **kwargs)
        if "parameters" in form.base_fields:
            form.base_fields["parameters"].help_text = PARAMETERS_HELP
        return form

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)

    def get_urls(self):
        return [
            path(
                "<path:object_id>/preview/",
                self.admin_site.admin_view(self.preview_view),
                name="npcs_npcbehaviorprofile_preview",
            ),
            *super().get_urls(),
        ]

    def preview_view(self, request, object_id):
        if not self.has_view_permission(request):
            raise PermissionDenied
        profile = self.get_object(request, object_id)
        if profile is None:
            return self._get_obj_does_not_exist_redirect(request, self.model._meta, object_id)
        placements = (
            NpcPlacement.objects.filter(behavior=profile)
            .select_related("location")
            .order_by("location__slug", "placement_key")
        )
        context = {
            **self.admin_site.each_context(request),
            "opts": self.model._meta,
            "title": f"Preview {profile.key}",
            "profile": profile,
            "placements": [
                f"{placement.location.slug}/{placement.placement_key}" for placement in placements
            ],
            "change_url": reverse("admin:npcs_npcbehaviorprofile_change", args=[profile.pk]),
            **preview_behavior.preview(profile),
        }
        return TemplateResponse(request, "npcs/behavior/preview.html", context)
