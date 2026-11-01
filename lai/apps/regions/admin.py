"""3D Areas and their Adventure launch points in Django Admin (ADR-041).

What staff can and cannot change here, on purpose:

- **Configuration (editable):** a 3D Area's publication (through the validating actions, never a
  raw status field), and its Adventure launch points: which object starts which Adventure, the
  child-facing label and prompt, the order and the publication.
- **Spatial layout (read-only):** where the spawn point, NPCs, props and chests stand is still
  authored in code (`treasure_rush_seed.py`) until LAI-0805 decides how layouts are edited. The
  page lists them so a launch point can be pointed at an existing object; it does not pretend to
  be a level editor.

Access follows the catalog admin (`apps.catalog.admin_access`, ADR-034): active staff view and
configure, nobody adds or deletes a 3D Area here, and only a draft launch point can be deleted.
"""

from django import forms
from django.contrib import admin, messages
from django.utils.html import format_html_join

from apps.catalog import admin_access
from apps.catalog.authoring_admin import AuthoredContentAdminMixin
from apps.catalog.models import Adventure
from apps.core.content_status import ContentStatus

from .models import AdventureLaunchPoint, AreaPuzzle, WorldRegion
from .publishing import area_problems, launch_point_problems


def _object_choices(region: WorldRegion | None) -> list[tuple[str, str]]:
    if region is None:
        return []
    choices = []
    for placement in region.placements.order_by("entity_id"):
        text = f"{placement.entity_id} ({placement.get_kind_display()})"
        label = f"{text}: {placement.label}" if placement.label else text
        choices.append((placement.entity_id, label))
    return choices


class LaunchPointForm(forms.ModelForm):
    """Offers only this 3D Area's objects and its own Place's Adventures; `clean()` re-checks."""

    class Meta:
        model = AdventureLaunchPoint
        fields = (
            "launch_id",
            "entity_id",
            "object_kind",
            "adventure",
            "label",
            "prompt",
            "sort_order",
        )

    def __init__(self, *args, region: WorldRegion | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        region = region or (self.instance.region if self.instance.region_id else None)
        if region is not None:
            self.fields["entity_id"] = forms.ChoiceField(
                label="Object",
                choices=[("", "---------"), *_object_choices(region)],
                help_text="An NPC, prop or scenery placement of this 3D Area. Where it stands is "
                "authored in code (LAI-0805).",
            )
            self.fields["adventure"].queryset = Adventure.objects.filter(
                location_id=region.location_id
            ).order_by("sort_order", "slug")


class LaunchPointInline(admin.TabularInline):
    model = AdventureLaunchPoint
    form = LaunchPointForm
    extra = 0
    fields = ("launch_id", "entity_id", "object_kind", "adventure", "label", "prompt", "sort_order")
    readonly_fields = ()
    show_change_link = True
    verbose_name_plural = "Adventure launch points (new ones start as drafts)"

    def get_formset(self, request, obj=None, **kwargs):
        formset = super().get_formset(request, obj, **kwargs)
        region = obj

        class Form(formset.form):
            def __init__(self, *args, **inner):
                super().__init__(*args, region=region, **inner)

        formset.form = Form
        return formset

    def has_view_permission(self, request, obj=None):
        return admin_access.can_view(request)

    def has_add_permission(self, request, obj=None):
        return admin_access.can_edit_catalog_fields(request)

    def has_change_permission(self, request, obj=None):
        return admin_access.can_edit_catalog_fields(request)

    def has_delete_permission(self, request, obj=None):
        return False  # draft points are deleted from their own page


@admin.register(WorldRegion)
class AreaAdmin(AuthoredContentAdminMixin, admin.ModelAdmin):
    list_display = ("region_id", "title", "place", "island", "status", "launch_point_count")
    list_filter = ("status", "location__world")
    search_fields = ("region_id", "title", "location__slug")
    list_select_related = ("location__world",)
    inlines = [LaunchPointInline]
    actions = ["publish_areas", "retire_areas"]
    readonly_fields = (
        "region_id",
        "location",
        "title",
        "version",
        "status",
        "offered_quests",
        "scene",
        "layout",
        "updated_at",
    )
    fields = readonly_fields

    @admin.display(description="Place", ordering="location__slug")
    def place(self, obj) -> str:
        return obj.location.slug

    @admin.display(description="Island", ordering="location__world__slug")
    def island(self, obj) -> str:
        return obj.location.world.slug

    @admin.display(description="Launch points")
    def launch_point_count(self, obj) -> int:
        return obj.launch_points.count()

    @admin.display(description="Layout (authored in code until LAI-0805)")
    def layout(self, obj):
        rows = [
            ("spawn", s.checkpoint_id, s.label, f"x {s.x:g}, z {s.z:g}")
            for s in obj.spawn_points.all()
        ]
        rows += [
            (p.get_kind_display(), p.entity_id, p.label, f"x {p.x:g}, z {p.z:g}")
            for p in obj.placements.order_by("entity_id")
        ]
        rows += [
            ("treasure chest", c.entity_id, c.label, f"x {c.x:g}, z {c.z:g}")
            for c in obj.chests.order_by("entity_id")
        ]
        if not rows:
            return "Nothing placed yet."
        return format_html_join("\n", "<div>{}: <code>{}</code> {} ({})</div>", rows)

    def has_module_permission(self, request):
        return admin_access.can_view(request)

    def has_view_permission(self, request, obj=None):
        return admin_access.can_view(request)

    def has_change_permission(self, request, obj=None):
        # Changing means editing launch points; every 3D Area field above is read-only.
        return admin_access.can_edit_catalog_fields(request)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.action(description="Validate and publish the selected 3D Areas")
    def publish_areas(self, request, queryset):
        for region in queryset.select_related("location__world"):
            problems = area_problems(region)
            if problems:
                self.message_user(
                    request,
                    f"{region.region_id} was not published: {'; '.join(problems)}",
                    messages.ERROR,
                )
                continue
            if region.status != ContentStatus.PUBLISHED:
                region.status = ContentStatus.PUBLISHED
                region.save(update_fields=["status", "updated_at"])
            self.message_user(request, f"{region.region_id} is published.", messages.SUCCESS)

    @admin.action(description="Retire the selected 3D Areas (children stop seeing them)")
    def retire_areas(self, request, queryset):
        count = queryset.exclude(status=ContentStatus.RETIRED).update(status=ContentStatus.RETIRED)
        self.message_user(request, f"{count} 3D Area(s) retired.", messages.SUCCESS)


@admin.register(AdventureLaunchPoint)
class LaunchPointAdmin(admin.ModelAdmin):
    form = LaunchPointForm
    list_display = (
        "launch_id",
        "region",
        "entity_id",
        "object_kind",
        "adventure",
        "status",
        "sort_order",
    )
    list_filter = ("status", "object_kind", "region")
    search_fields = ("launch_id", "entity_id", "adventure__slug", "label")
    list_select_related = ("region", "adventure")
    actions = ["publish_points", "retire_points"]

    def get_fields(self, request, obj=None):
        base = ["launch_id", "entity_id", "object_kind", "adventure", "label", "prompt"]
        return [*base, "sort_order", "status"] if obj else ["region", *base, "sort_order"]

    def get_readonly_fields(self, request, obj=None):
        return ("region", "status") if obj else ()

    def get_form(self, request, obj=None, change=False, **kwargs):
        if obj is None:
            # Adding from this page: pick the 3D Area first; the objects and Adventures are
            # checked by `clean()` (the inline on the 3D Area page offers them as choices).
            kwargs["fields"] = [
                "region",
                "launch_id",
                "entity_id",
                "object_kind",
                "adventure",
                "label",
                "prompt",
                "sort_order",
            ]
            return forms.modelform_factory(AdventureLaunchPoint, fields=kwargs["fields"])
        return super().get_form(request, obj, change, **kwargs)

    def has_module_permission(self, request):
        return admin_access.can_view(request)

    def has_view_permission(self, request, obj=None):
        return admin_access.can_view(request)

    def has_add_permission(self, request):
        return admin_access.can_edit_catalog_fields(request)

    def has_change_permission(self, request, obj=None):
        return admin_access.can_edit_catalog_fields(request)

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.status != ContentStatus.DRAFT:
            return False
        return admin_access.can_edit_catalog_fields(request)

    @admin.action(description="Validate and publish the selected launch points")
    def publish_points(self, request, queryset):
        for point in queryset.select_related("region__location", "adventure__location"):
            problems = launch_point_problems(point)
            if point.region.status != ContentStatus.PUBLISHED:
                problems.append(f"its 3D Area {point.region.region_id} is not published")
            if problems:
                self.message_user(
                    request,
                    f"{point.launch_id} was not published: {'; '.join(problems)}",
                    messages.ERROR,
                )
                continue
            if point.status != ContentStatus.PUBLISHED:
                point.status = ContentStatus.PUBLISHED
                point.save(update_fields=["status", "updated_at"])
            self.message_user(request, f"{point.launch_id} is published.", messages.SUCCESS)

    @admin.action(description="Retire the selected launch points")
    def retire_points(self, request, queryset):
        count = queryset.exclude(status=ContentStatus.RETIRED).update(status=ContentStatus.RETIRED)
        self.message_user(request, f"{count} launch point(s) retired.", messages.SUCCESS)


@admin.register(AreaPuzzle)
class AreaPuzzleAdmin(AuthoredContentAdminMixin, admin.ModelAdmin):
    """3D Area puzzles (ADR-043 F). Which mechanic and which objects are seed-authored; the
    parameters are edited as content versions ("Edit content"), never in these fields."""

    list_display = ("puzzle_id", "region", "kind", "title", "status", "authority")
    list_filter = ("status", "kind", "region")
    search_fields = ("puzzle_id", "title", "region__region_id")
    actions = ["publish_puzzles", "retire_puzzles"]
    readonly_fields = (
        "region",
        "puzzle_id",
        "kind",
        "entity_ids",
        "sort_order",
        "status",
        "title",
        "parameters",
        "requires_change_keys",
        "world_change_key",
        "reward_rule",
        "authority",
        "updated_at",
    )
    fields = readonly_fields

    def has_module_permission(self, request):
        return admin_access.can_view(request)

    def has_view_permission(self, request, obj=None):
        return admin_access.can_view(request)

    def has_change_permission(self, request, obj=None):
        return admin_access.can_edit_catalog_fields(request)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.action(description="Publish the selected puzzles (children can play them)")
    def publish_puzzles(self, request, queryset):
        for puzzle in queryset:
            if puzzle.published_revision_id is None:
                self.message_user(
                    request, f"{puzzle.puzzle_id} has no published content.", messages.ERROR
                )
                continue
            if puzzle.status != ContentStatus.PUBLISHED:
                puzzle.status = ContentStatus.PUBLISHED
                puzzle.save(update_fields=["status", "updated_at"])
            self.message_user(request, f"{puzzle.puzzle_id} is published.", messages.SUCCESS)

    @admin.action(description="Retire the selected puzzles (children stop seeing them)")
    def retire_puzzles(self, request, queryset):
        count = queryset.exclude(status=ContentStatus.RETIRED).update(status=ContentStatus.RETIRED)
        self.message_user(request, f"{count} puzzle(s) retired.", messages.SUCCESS)
