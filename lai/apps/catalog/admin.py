"""Catalog administration (LAI-0304). Built here, mounted by LAI-0404.

`catalog_admin_site` is a standalone `AdminSite`. Django Admin is not installed in the
project settings and no URL serves this site: LAI-0404 installs the admin stack and mounts it
behind the Cognito-group gate (ADR-024 A4). Until then these classes are exercised by unit
tests only.

Editable now (catalog fields, Django-owned): `active` and `sort_order` on worlds, locations,
adventures and quests. Everything else is imported content and read-only until the content
authoring cutover, when content fields become editable and the export reverses direction.
Assets, steps and releases are read-only entirely. Nobody can add a record here (the importer
creates them), and nobody can delete one before the cutover.
"""

from django.contrib import admin
from django.db.models import BooleanField, Count, ExpressionWrapper, Q, Subquery
from django.http import HttpRequest

from apps.catalog import admin_access
from apps.catalog.models import (
    Adventure,
    AdventureStep,
    ContentAsset,
    ContentRelease,
    Location,
    LocationAsset,
    Quest,
    World,
)

CATALOG_FIELDS = ("active", "sort_order")


class CatalogAdminSite(admin.AdminSite):
    site_header = "Learning Adventure Island content catalog"
    site_title = "Content catalog"
    index_title = "Worlds, locations, adventures, quests and assets"

    def has_permission(self, request: HttpRequest) -> bool:
        return admin_access.can_view(request)


catalog_admin_site = CatalogAdminSite(name="catalog_admin")


def _latest_release():
    return ContentRelease.objects.order_by("-imported_at", "-id").values("pk")[:1]


class InLatestReleaseFilter(admin.SimpleListFilter):
    title = "in the latest export"
    parameter_name = "in_latest"

    def lookups(self, request, model_admin):
        return [("yes", "Yes"), ("no", "No, kept from an earlier export")]

    def queryset(self, request, queryset):
        if self.value() == "yes":
            return queryset.filter(in_latest=True)
        if self.value() == "no":
            return queryset.filter(in_latest=False)
        return queryset


class CatalogModelAdmin(admin.ModelAdmin):
    """Permission and read-only rules shared by every catalog admin."""

    #: Whether this model has Django-owned catalog fields that may be edited now.
    has_catalog_fields = False

    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        if any(field.name == "last_seen_release" for field in self.model._meta.fields):
            queryset = queryset.annotate(
                in_latest=ExpressionWrapper(
                    Q(last_seen_release_id=Subquery(_latest_release())),
                    output_field=BooleanField(),
                )
            )
        return queryset

    @admin.display(boolean=True, description="In latest export")
    def in_latest_release(self, obj) -> bool:
        return bool(getattr(obj, "in_latest", False))

    def has_module_permission(self, request):
        return admin_access.can_view(request)

    def has_view_permission(self, request, obj=None):
        return admin_access.can_view(request)

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return self.has_catalog_fields and admin_access.can_edit_catalog_fields(request)

    def has_delete_permission(self, request, obj=None):
        return admin_access.can_delete(request)

    def get_readonly_fields(self, request, obj=None):
        editable = CATALOG_FIELDS if self.has_catalog_fields else ()
        names = [f.name for f in self.model._meta.fields if f.name not in editable]
        names += [f.name for f in self.model._meta.many_to_many]
        return [*names, *self.readonly_display]

    #: Computed fields shown on the change page.
    readonly_display: tuple[str, ...] = ()


class ReadOnlyInline(admin.TabularInline):
    extra = 0
    can_delete = False
    show_change_link = True

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_view_permission(self, request, obj=None):
        return admin_access.can_view(request)


class LocationInline(ReadOnlyInline):
    model = Location
    fields = ("slug", "title", "active", "sort_order")


class AdventureInline(ReadOnlyInline):
    model = Adventure
    fk_name = "location"
    fields = ("slug", "title", "age_bands", "active", "sort_order")


class StepInline(ReadOnlyInline):
    model = AdventureStep
    fields = ("position", "step_id", "step_type", "objective_ids")
    show_change_link = False


class LocationAssetInline(ReadOnlyInline):
    model = LocationAsset
    fields = ("position", "asset")
    show_change_link = False
    verbose_name = "scene asset"
    verbose_name_plural = "scene assets (ids only; placement is LAI-0805)"


@admin.register(World, site=catalog_admin_site)
class WorldAdmin(CatalogModelAdmin):
    has_catalog_fields = True
    list_display = (
        "slug",
        "title",
        "is_home",
        "active",
        "sort_order",
        "location_count",
        "in_latest_release",
    )
    list_filter = ("active", "is_home", InLatestReleaseFilter)
    search_fields = ("slug", "title", "description")
    inlines = [LocationInline]
    readonly_display = ("in_latest_release",)

    def get_queryset(self, request):
        return (
            super().get_queryset(request).annotate(location_total=Count("locations", distinct=True))
        )

    @admin.display(description="Locations", ordering="location_total")
    def location_count(self, obj) -> int:
        return obj.location_total


@admin.register(Location, site=catalog_admin_site)
class LocationAdmin(CatalogModelAdmin):
    has_catalog_fields = True
    list_display = (
        "slug",
        "title",
        "world",
        "active",
        "sort_order",
        "adventure_count",
        "asset_count",
        "in_latest_release",
    )
    list_filter = ("world", "active", InLatestReleaseFilter)
    search_fields = ("slug", "title", "description", "skills")
    list_select_related = ("world",)
    inlines = [AdventureInline, LocationAssetInline]
    readonly_display = ("in_latest_release",)

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .annotate(
                adventure_total=Count("adventures", distinct=True),
                asset_total=Count("asset_links", distinct=True),
            )
        )

    @admin.display(description="Adventures", ordering="adventure_total")
    def adventure_count(self, obj) -> int:
        return obj.adventure_total

    @admin.display(description="Scene assets", ordering="asset_total")
    def asset_count(self, obj) -> int:
        return obj.asset_total


@admin.register(Adventure, site=catalog_admin_site)
class AdventureAdmin(CatalogModelAdmin):
    has_catalog_fields = True
    list_display = (
        "slug",
        "title",
        "location_slug",
        "world",
        "age_bands",
        "version",
        "active",
        "sort_order",
        "in_latest_release",
    )
    list_filter = ("world", "location", "active", "skill_domain", InLatestReleaseFilter)
    search_fields = ("slug", "title", "location_slug")
    list_select_related = ("world", "location")
    inlines = [StepInline]
    readonly_display = ("scene_assets", "in_latest_release")

    @admin.display(description="Scene assets of its location")
    def scene_assets(self, obj) -> str:
        if obj.location_id is None:
            return "No location record (story-only place)"
        ids = obj.location.asset_links.order_by("position").values_list(
            "asset__asset_id", flat=True
        )
        return ", ".join(ids) or "None"


@admin.register(AdventureStep, site=catalog_admin_site)
class AdventureStepAdmin(CatalogModelAdmin):
    list_display = ("adventure", "position", "step_id", "step_type", "in_latest_release")
    list_filter = ("step_type", "adventure__world", InLatestReleaseFilter)
    search_fields = ("step_id", "adventure__slug")
    list_select_related = ("adventure",)


@admin.register(Quest, site=catalog_admin_site)
class QuestAdmin(CatalogModelAdmin):
    has_catalog_fields = True
    list_display = (
        "slug",
        "title",
        "world",
        "giver_npc_id",
        "active",
        "sort_order",
        "in_latest_release",
    )
    list_filter = ("world", "active", InLatestReleaseFilter)
    search_fields = ("slug", "title", "giver_npc_id")
    list_select_related = ("world",)
    readonly_display = ("in_latest_release",)


@admin.register(ContentAsset, site=catalog_admin_site)
class ContentAssetAdmin(CatalogModelAdmin):
    list_display = ("asset_id", "kind", "bundled_path", "used_by", "in_latest_release")
    list_filter = ("kind", InLatestReleaseFilter)
    search_fields = ("asset_id", "bundled_path")
    readonly_display = ("used_by",)

    @admin.display(description="Used by locations")
    def used_by(self, obj) -> str:
        slugs = obj.location_links.order_by("location__slug").values_list(
            "location__slug", flat=True
        )
        return ", ".join(slugs) or "No shipped scene"


@admin.register(ContentRelease, site=catalog_admin_site)
class ContentReleaseAdmin(CatalogModelAdmin):
    list_display = ("content_digest", "schema_version", "export_tool", "imported_at")
    search_fields = ("content_digest",)
