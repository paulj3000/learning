import pytest
from django.test import RequestFactory

from apps.catalog import admin_access
from apps.catalog.admin import catalog_admin_site
from apps.catalog.admin_access import AdminRole
from apps.catalog.importer import import_content
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
from apps.catalog.tests.helpers import base_collections, write_export

CATALOG_MODELS = (World, Location, Adventure, Quest)
READ_ONLY_MODELS = (AdventureStep, ContentAsset, ContentRelease)


def request_as(role=None):
    request = RequestFactory().get("/catalog-admin/")
    if role is not None:
        request.catalog_admin_role = role
    return request


def model_admin(model):
    return catalog_admin_site._registry[model]


def test_every_catalog_model_is_registered_on_the_catalog_site():
    assert set(catalog_admin_site._registry) == {*CATALOG_MODELS, *READ_ONLY_MODELS}


@pytest.mark.parametrize("role", [None, AdminRole.NONE, "admin", "superuser"])
def test_deny_by_default_without_a_resolved_role(role):
    request = request_as(role)
    assert catalog_admin_site.has_permission(request) is False
    for model in (*CATALOG_MODELS, *READ_ONLY_MODELS):
        admin = model_admin(model)
        assert not admin.has_module_permission(request)
        assert not admin.has_view_permission(request)
        assert not admin.has_change_permission(request)
        assert not admin.has_add_permission(request)
        assert not admin.has_delete_permission(request)


@pytest.mark.parametrize("role", [AdminRole.ADMIN, AdminRole.SUPERUSER])
def test_admins_view_everything_and_edit_only_catalog_models(role):
    request = request_as(role)
    assert catalog_admin_site.has_permission(request)
    for model in CATALOG_MODELS:
        assert model_admin(model).has_view_permission(request)
        assert model_admin(model).has_change_permission(request)
    for model in READ_ONLY_MODELS:
        assert model_admin(model).has_view_permission(request)
        assert not model_admin(model).has_change_permission(request)


@pytest.mark.parametrize("role", [AdminRole.ADMIN, AdminRole.SUPERUSER])
def test_nobody_adds_or_deletes_imported_content_before_the_cutover(role):
    request = request_as(role)
    for model in (*CATALOG_MODELS, *READ_ONLY_MODELS):
        assert not model_admin(model).has_add_permission(request)
        assert not model_admin(model).has_delete_permission(request)


def test_after_the_cutover_only_superusers_may_delete(monkeypatch):
    monkeypatch.setattr(admin_access, "CONTENT_AUTHORING_CUTOVER", True)
    assert model_admin(Adventure).has_delete_permission(request_as(AdminRole.SUPERUSER))
    assert not model_admin(Adventure).has_delete_permission(request_as(AdminRole.ADMIN))


@pytest.mark.parametrize("model", CATALOG_MODELS)
def test_only_active_and_sort_order_are_editable_on_catalog_models(model):
    readonly = set(model_admin(model).get_readonly_fields(request_as(AdminRole.ADMIN)))
    names = {f.name for f in model._meta.fields} | {f.name for f in model._meta.many_to_many}
    assert names - readonly == {"active", "sort_order"}
    assert {"slug", "title", "source", "last_seen_release"} <= readonly


@pytest.mark.parametrize("model", READ_ONLY_MODELS)
def test_assets_steps_and_releases_are_read_only(model):
    readonly = set(model_admin(model).get_readonly_fields(request_as(AdminRole.ADMIN)))
    assert {f.name for f in model._meta.fields} <= readonly


def test_admins_support_search_filters_and_navigation():
    world, location, adventure = (model_admin(m) for m in (World, Location, Adventure))
    assert "slug" in world.search_fields and "title" in location.search_fields
    assert "world" in location.list_filter and "location" in adventure.list_filter
    assert [type(i).__name__ for i in world.get_inline_instances(request_as(AdminRole.ADMIN))] == [
        "LocationInline"
    ]
    assert {i.__name__ for i in location.inlines} == {"AdventureInline", "LocationAssetInline"}
    assert [i.__name__ for i in adventure.inlines] == ["StepInline"]


@pytest.mark.postgres
@pytest.mark.django_db
def test_list_columns_show_counts_assets_and_whether_a_row_is_in_the_latest_export(tmp_path):
    import_content(write_export(tmp_path / "v1"))
    smaller = base_collections()
    smaller["adventures.json"]["adventures"] = smaller["adventures.json"]["adventures"][:1]
    smaller["islands.json"]["islands"][0]["pack"]["adventureSlugs"] = ["fix-bridge"]
    import_content(write_export(tmp_path / "v2", smaller))
    request = request_as(AdminRole.ADMIN)

    location_admin = model_admin(Location)
    bay = location_admin.get_queryset(request).get(slug="bay")
    assert (location_admin.adventure_count(bay), location_admin.asset_count(bay)) == (1, 2)

    adventure_admin = model_admin(Adventure)
    adventures = {a.slug: a for a in adventure_admin.get_queryset(request)}
    assert adventure_admin.in_latest_release(adventures["fix-bridge"]) is True
    assert adventure_admin.in_latest_release(adventures["tale"]) is False
    assert adventure_admin.scene_assets(adventures["fix-bridge"]) == "tree, rock"
    assert (
        adventure_admin.scene_assets(adventures["tale"]) == "No location record (story-only place)"
    )

    asset_admin = model_admin(ContentAsset)
    assert asset_admin.used_by(ContentAsset.objects.get(asset_id="rock")) == "bay"
    assert asset_admin.used_by(ContentAsset.objects.get(asset_id="tree-lod1")) == "No shipped scene"
    assert LocationAsset.objects.count() == 2
