"""Catalog administration (LAI-0304), on the project's one Django Admin site (LAI-0404).

Registered on Django's default `admin.site`, mounted at `settings.ADMIN_URL_PATH`. Access is
decided per request by `admin_access` from the signed-in staff account (ADR-034).

Editable now (catalog fields, Django-owned): `active` and `sort_order` on worlds, locations,
adventures, quests and NPCs. Everything else is imported content and read-only until the content
authoring cutover, when content fields become editable and the export reverses direction.
Assets, steps, releases, objectives, items, sets and reward rules are read-only entirely. Nobody
can add a record here (the importer creates them), and nobody can delete one before the cutover.
"""

from django.contrib import admin, messages
from django.db.models import BooleanField, Count, ExpressionWrapper, Q, Subquery

from apps.assets.models import AssetVersion
from apps.catalog import admin_access
from apps.catalog.models import (
    Adventure,
    AdventureStep,
    AssetOrigin,
    CollectibleSet,
    ContentAsset,
    ContentRelease,
    ItemDefinition,
    LearningObjective,
    Location,
    LocationAsset,
    NpcDefinition,
    Quest,
    RewardRule,
    World,
)

CATALOG_FIELDS = ("active", "sort_order")


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


@admin.register(World)
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


@admin.register(Location)
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


@admin.register(Adventure)
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


@admin.register(AdventureStep)
class AdventureStepAdmin(CatalogModelAdmin):
    list_display = ("adventure", "position", "step_id", "step_type", "in_latest_release")
    list_filter = ("step_type", "adventure__world", InLatestReleaseFilter)
    search_fields = ("step_id", "adventure__slug")
    list_select_related = ("adventure",)


@admin.register(Quest)
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


def _has_perm(request, name: str) -> bool:
    has_perm = getattr(getattr(request, "user", None), "has_perm", None)
    return bool(has_perm and has_perm(name))


class AssetVersionInline(ReadOnlyInline):
    """A definition's versions, newest first; each links to its own page (LAI-2200)."""

    model = AssetVersion
    fields = ("number", "status", "format", "size_bytes", "published_at")
    readonly_fields = fields
    ordering = ("-number",)
    verbose_name_plural = "versions (upload, publish and retire on the Asset versions page)"

    def has_view_permission(self, request, obj=None):
        return admin_access.can_view(request) and _has_perm(request, "assets.view_assetversion")


# Django-owned display fields, editable on every definition by `catalog.change_contentasset`.
DEFINITION_FIELDS = ("display_name", "description", "category", "tags")
# Content fields an administrator owns only on definitions made in Django.
DJANGO_CONTENT_FIELDS = ("kind", "clips")
ADD_FIELDS = ("asset_id", "kind", "category", "display_name", "description", "tags", "clips")


@admin.register(ContentAsset)
class ContentAssetAdmin(CatalogModelAdmin):
    """Asset definitions (LAI-2200, ADR-035): viewable by every staff role, created and edited with
    the `catalog` asset permissions, retired with `assets.retire_assetversion`, never deleted."""

    list_display = (
        "asset_id",
        "display_name",
        "kind",
        "category",
        "status",
        "origin",
        "default_version_number",
        "used_by",
        "in_latest_release",
    )
    list_filter = ("status", "origin", "category", "kind", InLatestReleaseFilter)
    search_fields = ("asset_id", "display_name", "description", "tags", "bundled_path")
    list_select_related = ("default_version",)
    readonly_display = ("used_by", "default_version_number")
    inlines = [AssetVersionInline]
    actions = ["retire_assets"]

    def has_add_permission(self, request, obj=None):
        return admin_access.can_view(request) and _has_perm(request, "catalog.add_contentasset")

    def has_change_permission(self, request, obj=None):
        return admin_access.can_view(request) and _has_perm(request, "catalog.change_contentasset")

    def has_delete_permission(self, request, obj=None):
        return False  # a definition is retired, never deleted (versions PROTECT it anyway)

    def has_retire_permission(self, request):
        return admin_access.can_view(request) and _has_perm(request, "assets.retire_assetversion")

    def get_inlines(self, request, obj):
        return self.inlines if obj is not None else []  # a new definition has no versions

    def get_fields(self, request, obj=None):
        if obj is None:
            return ADD_FIELDS
        return super().get_fields(request, obj)

    def get_readonly_fields(self, request, obj=None):
        everything = super().get_readonly_fields(request, obj)
        if obj is None:  # the add form, for those who may add; otherwise nothing is editable
            return () if self.has_add_permission(request) else everything
        if not self.has_change_permission(request, obj):
            return everything
        editable = set(DEFINITION_FIELDS)
        if obj.origin == AssetOrigin.DJANGO:
            editable |= set(DJANGO_CONTENT_FIELDS)
        return [name for name in everything if name not in editable]

    def get_form(self, request, obj=None, change=False, **kwargs):
        form = super().get_form(request, obj, change=change, **kwargs)
        if obj is None:

            class DjangoDefinitionForm(form):
                def __init__(self, *args, **form_kwargs):
                    super().__init__(*args, **form_kwargs)
                    # Set before validation so `ContentAsset.clean` checks a Django definition.
                    self.instance.origin = AssetOrigin.DJANGO

            return DjangoDefinitionForm
        return form

    def save_model(self, request, obj, form, change):
        if not change:
            obj.origin = AssetOrigin.DJANGO
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

    @admin.display(description="Default version", ordering="default_version__number")
    def default_version_number(self, obj) -> str:
        return f"v{obj.default_version.number}" if obj.default_version_id else "None"

    @admin.display(description="Used by locations")
    def used_by(self, obj) -> str:
        slugs = obj.location_links.order_by("location__slug").values_list(
            "location__slug", flat=True
        )
        return ", ".join(slugs) or "No shipped scene"

    @admin.action(description="Retire selected assets", permissions=["retire"])
    def retire_assets(self, request, queryset):
        from apps.assets.services import retire_asset

        for asset in queryset:
            retire_asset(asset)
        self.message_user(request, f"Retired {queryset.count()} asset(s).", messages.SUCCESS)


@admin.register(ContentRelease)
class ContentReleaseAdmin(CatalogModelAdmin):
    list_display = ("content_digest", "schema_version", "export_tool", "imported_at")
    search_fields = ("content_digest",)


@admin.register(LearningObjective)
class LearningObjectiveAdmin(CatalogModelAdmin):
    list_display = ("code", "domain", "title", "in_latest_release")
    list_filter = ("domain", InLatestReleaseFilter)
    search_fields = ("code", "title")


@admin.register(NpcDefinition)
class NpcDefinitionAdmin(CatalogModelAdmin):
    has_catalog_fields = True
    list_display = (
        "npc_id",
        "display_name",
        "home_location_slug",
        "active",
        "sort_order",
        "in_latest_release",
    )
    list_filter = ("active", "home_location", InLatestReleaseFilter)
    search_fields = ("npc_id", "display_name", "home_location_slug")
    list_select_related = ("home_location",)
    readonly_display = ("in_latest_release",)


@admin.register(CollectibleSet)
class CollectibleSetAdmin(CatalogModelAdmin):
    list_display = ("set_id", "display_name", "completion_item", "in_latest_release")
    list_filter = (InLatestReleaseFilter,)
    search_fields = ("set_id", "display_name")
    list_select_related = ("completion_item",)


@admin.register(ItemDefinition)
class ItemDefinitionAdmin(CatalogModelAdmin):
    list_display = (
        "item_id",
        "display_name",
        "category",
        "rarity",
        "collectible_set",
        "hidden",
        "in_latest_release",
    )
    list_filter = ("category", "rarity", "hidden", InLatestReleaseFilter)
    search_fields = ("item_id", "display_name")
    list_select_related = ("collectible_set",)


@admin.register(RewardRule)
class RewardRuleAdmin(CatalogModelAdmin):
    list_display = ("rule_id", "message", "in_latest_release")
    list_filter = (InLatestReleaseFilter,)
    search_fields = ("rule_id",)
