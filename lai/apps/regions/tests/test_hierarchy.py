"""Island > Place > 3D Area (ADR-041): terminology, one 3D Area per Place, launch-point rules,
and their Django Admin. Uses the real content export and the Treasure Cove seed (`treasure`).
"""

from types import SimpleNamespace

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.test import RequestFactory

from apps.catalog.models import Adventure, Location, Quest, World
from apps.core.content_status import ContentStatus
from apps.regions.admin import AreaAdmin, LaunchPointAdmin, LaunchPointForm
from apps.regions.models import (
    AdventureLaunchPoint,
    LaunchObjectKind,
    WorldRegion,
)
from apps.regions.publishing import area_problems, launch_point_problems
from apps.regions.treasure_rush_seed import SIGNPOST_ID

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def staff_request():
    request = RequestFactory().get("/admin/")
    request.user = SimpleNamespace(
        is_authenticated=True, is_active=True, is_staff=True, is_superuser=False
    )
    return request


def point(region, adventure, **fields):
    defaults = {
        "launch_id": "test-point",
        "entity_id": SIGNPOST_ID,
        "object_kind": LaunchObjectKind.SIGN,
        "label": "Go",
    }
    return AdventureLaunchPoint(region=region, adventure=adventure, **{**defaults, **fields})


@pytest.fixture
def messages_sent(monkeypatch):
    sent: list[str] = []
    for cls in (AreaAdmin, LaunchPointAdmin):
        monkeypatch.setattr(cls, "message_user", lambda self, r, text, *a, **k: sent.append(text))
    return sent


# --- terminology and stable identifiers ---------------------------------------------------------


def test_people_read_island_place_and_3d_area(treasure):
    assert (World._meta.verbose_name, World._meta.verbose_name_plural) == ("island", "islands")
    assert (Location._meta.verbose_name, Location._meta.verbose_name_plural) == ("place", "places")
    assert WorldRegion._meta.verbose_name == "3D Area"
    assert WorldRegion._meta.verbose_name_plural == "3D Areas"
    assert Adventure._meta.get_field("location").verbose_name == "place"
    assert Adventure._meta.get_field("world").verbose_name == "island"
    assert Quest._meta.get_field("world").verbose_name == "island"
    assert WorldRegion._meta.get_field("location").verbose_name == "place"


def test_tables_classes_and_ids_are_unchanged(treasure):
    assert World._meta.db_table == "catalog_world"
    assert Location._meta.db_table == "catalog_location"
    assert WorldRegion._meta.db_table == "regions_worldregion"
    region = WorldRegion.objects.get(region_id="treasure-rush-cove")
    assert region.location.slug == "pirate-builder-bay"
    assert region.location.world.slug == "learning-adventure-island"
    assert {f.name for f in WorldRegion._meta.fields} >= {"region_id", "location", "status"}


def test_admin_navigation_uses_the_new_names(treasure):
    registry = admin.site._registry
    assert WorldRegion in registry and AdventureLaunchPoint in registry
    location_admin = registry[Location]
    assert location_admin.area(Location.objects.get(slug="pirate-builder-bay")) == (
        "treasure-rush-cove (Published)"
    )
    assert location_admin.area(Location.objects.get(slug="wonderwild-forest")) == "None yet"
    assert registry[World].location_count.short_description == "Places"


# --- one optional 3D Area per Place ---------------------------------------------------------------


def test_a_place_without_a_3d_area_is_valid(treasure):
    forest = Location.objects.get(slug="wonderwild-forest")
    assert not forest.regions.exists()
    forest.full_clean()
    assert forest.adventures.exists()  # still owns its adventures


def test_a_second_3d_area_for_a_place_is_rejected_by_validation_and_the_database(treasure):
    bay = treasure.region.location
    second = WorldRegion(region_id="second-cove", location=bay, title="Second")
    with pytest.raises(ValidationError) as error:
        second.full_clean()
    assert "already has a 3D Area" in str(error.value)
    with pytest.raises(IntegrityError), transaction.atomic():
        WorldRegion.objects.create(region_id="second-cove", location=bay, title="Second")
    assert bay.regions.count() == 1


def test_another_place_can_have_its_own_3d_area(treasure):
    forest = Location.objects.get(slug="wonderwild-forest")
    area = WorldRegion(region_id="forest-area", location=forest, title="Forest")
    area.full_clean()
    area.save()
    assert forest.regions.get() == area


def test_the_report_command_lists_nothing_when_every_place_is_fine(treasure, capsys):
    call_command("report_place_areas")
    assert "at most one 3D Area" in capsys.readouterr().out


def test_the_migration_check_refuses_duplicates_without_changing_anything(treasure):
    import importlib

    migration = importlib.import_module("apps.regions.migrations.0002_place_area_and_launch_points")

    class Apps:
        @staticmethod
        def get_model(app, name):
            return FakeRegions

    class FakeRegions:
        class objects:  # noqa: N801 - mimics a manager
            @staticmethod
            def values(*_):
                return FakeQuery()

    class FakeQuery:
        def annotate(self, **_):
            return self

        def filter(self, **_):
            return self

        def order_by(self, *_):
            return [{"location__slug": "pirate-builder-bay", "areas": 2}]

    with pytest.raises(RuntimeError) as error:
        migration.refuse_duplicate_areas(Apps, None)
    assert "pirate-builder-bay (2)" in str(error.value) and "Nothing was changed" in str(
        error.value
    )


def test_the_report_command_fails_and_lists_duplicates(treasure, monkeypatch, capsys):
    from apps.regions.management.commands import report_place_areas

    class Rows(list):
        def annotate(self, **_):
            return self

        def filter(self, **_):
            return self

        def order_by(self, *_):
            return self

    monkeypatch.setattr(
        report_place_areas.WorldRegion.objects,
        "values",
        lambda *_: Rows([{"location__slug": "pirate-builder-bay", "areas": 2}]),
    )
    with pytest.raises(CommandError):
        call_command("report_place_areas")
    assert "pirate-builder-bay" in capsys.readouterr().out


# --- launch points ------------------------------------------------------------------------------


def test_the_seed_puts_one_launch_point_per_age_band_on_the_signpost(treasure):
    points = treasure.region.launch_points.order_by("launch_id")
    assert {p.entity_id for p in points} == {SIGNPOST_ID}
    assert {p.adventure.slug for p in points} == {
        "three-planks-for-the-bridge",
        "repair-the-moonlight-bridge",
        "the-tide-gate-calculation",
    }
    assert {p.adventure.location_id for p in points} == {treasure.region.location_id}


def test_a_launch_point_cannot_start_another_places_adventure(treasure):
    other = Adventure.objects.exclude(location=treasure.region.location).exclude(location=None)
    with pytest.raises(ValidationError) as error:
        point(treasure.region, other.first()).full_clean()
    assert "adventure" in error.value.message_dict


def test_a_launch_point_must_name_an_object_of_its_3d_area(treasure):
    bridge = Adventure.objects.get(slug="repair-the-moonlight-bridge")
    with pytest.raises(ValidationError) as error:
        point(treasure.region, bridge, entity_id="no-such-object").full_clean()
    assert "No placement" in str(error.value)
    with pytest.raises(ValidationError) as error:
        point(treasure.region, bridge, entity_id="cove-chest").full_clean()
    assert "Treasure Rush chest" in str(error.value)


def test_the_object_kind_must_match_npc_placements(treasure):
    bridge = Adventure.objects.get(slug="repair-the-moonlight-bridge")
    with pytest.raises(ValidationError):
        point(treasure.region, bridge, object_kind=LaunchObjectKind.NPC).full_clean()
    with pytest.raises(ValidationError):
        point(treasure.region, bridge, entity_id="cove-pip").full_clean()
    point(
        treasure.region, bridge, entity_id="cove-pip", object_kind=LaunchObjectKind.NPC
    ).full_clean()


def test_one_adventure_can_have_several_launch_points_but_not_twice_on_one_object(treasure):
    bridge = Adventure.objects.get(slug="repair-the-moonlight-bridge")
    point(
        treasure.region,
        bridge,
        launch_id="pip-bridge",
        entity_id="cove-pip",
        object_kind=LaunchObjectKind.NPC,
    ).save()
    assert bridge.launch_points.count() == 2
    with pytest.raises(IntegrityError), transaction.atomic():
        point(treasure.region, bridge, launch_id="dup").save()


def test_publishing_validates_area_and_launch_points(treasure):
    assert area_problems(treasure.region) == []
    bridge = treasure.region.launch_points.get(adventure__slug="repair-the-moonlight-bridge")
    assert launch_point_problems(bridge) == []
    Adventure.objects.filter(pk=bridge.adventure_id).update(active=False)
    bridge.refresh_from_db()
    assert any("inactive" in p for p in launch_point_problems(bridge))


# --- Django Admin ---------------------------------------------------------------------------------


def test_the_launch_point_form_offers_only_this_areas_objects_and_places_adventures(treasure):
    form = LaunchPointForm(region=treasure.region)
    objects = [value for value, _ in form.fields["entity_id"].choices if value]
    assert set(objects) == {"cove-pip", SIGNPOST_ID}  # the chest is not offered
    places = set(form.fields["adventure"].queryset.values_list("location__slug", flat=True))
    assert places == {"pirate-builder-bay"}


def test_the_admin_form_refuses_a_cross_place_adventure(treasure):
    other = Adventure.objects.exclude(location=treasure.region.location).exclude(location=None)
    form = LaunchPointForm(
        data={
            "launch_id": "x",
            "entity_id": SIGNPOST_ID,
            "object_kind": "SIGN",
            "adventure": other.first().pk,
            "label": "Go",
            "sort_order": 0,
        },
        instance=AdventureLaunchPoint(region=treasure.region),
        region=treasure.region,
    )
    assert not form.is_valid()
    assert "adventure" in form.errors


def test_the_publish_action_refuses_an_invalid_area(treasure, messages_sent):
    area_admin = admin.site._registry[WorldRegion]
    WorldRegion.objects.filter(pk=treasure.region.pk).update(status=ContentStatus.DRAFT)
    treasure.region.spawn_points.update(is_default=False)
    area_admin.publish_areas(staff_request(), WorldRegion.objects.filter(pk=treasure.region.pk))
    treasure.region.refresh_from_db()
    assert treasure.region.status == ContentStatus.DRAFT
    assert "no default spawn point" in messages_sent[-1]
    treasure.region.spawn_points.update(is_default=True)
    area_admin.publish_areas(staff_request(), WorldRegion.objects.filter(pk=treasure.region.pk))
    treasure.region.refresh_from_db()
    assert treasure.region.status == ContentStatus.PUBLISHED


def test_launch_points_publish_only_with_a_published_area(treasure, messages_sent):
    points_admin = admin.site._registry[AdventureLaunchPoint]
    AdventureLaunchPoint.objects.update(status=ContentStatus.DRAFT)
    WorldRegion.objects.filter(pk=treasure.region.pk).update(status=ContentStatus.DRAFT)
    points_admin.publish_points(staff_request(), AdventureLaunchPoint.objects.all())
    assert set(AdventureLaunchPoint.objects.values_list("status", flat=True)) == {"DRAFT"}
    assert "not published" in messages_sent[-1]
    WorldRegion.objects.filter(pk=treasure.region.pk).update(status=ContentStatus.PUBLISHED)
    points_admin.publish_points(staff_request(), AdventureLaunchPoint.objects.all())
    assert set(AdventureLaunchPoint.objects.values_list("status", flat=True)) == {"PUBLISHED"}


def test_admin_permissions(treasure):
    area_admin = admin.site._registry[WorldRegion]
    points_admin = admin.site._registry[AdventureLaunchPoint]
    request = staff_request()
    assert area_admin.has_view_permission(request) and area_admin.has_change_permission(request)
    assert not area_admin.has_add_permission(request)
    assert not area_admin.has_delete_permission(request, treasure.region)
    published = treasure.region.launch_points.first()
    assert not points_admin.has_delete_permission(request, published)
    draft = point(
        treasure.region,
        published.adventure,
        launch_id="draft-one",
        entity_id="cove-pip",
        object_kind=LaunchObjectKind.NPC,
    )
    draft.save()
    assert points_admin.has_delete_permission(request, draft)
    nobody = RequestFactory().get("/admin/")
    nobody.user = SimpleNamespace(is_authenticated=True, is_active=True, is_staff=False)
    assert not area_admin.has_view_permission(nobody)
    assert not points_admin.has_add_permission(nobody)


def test_the_area_page_shows_the_code_authored_layout_read_only(treasure):
    area_admin = admin.site._registry[WorldRegion]
    layout = str(area_admin.layout(treasure.region))
    assert "cove-landing" in layout and "cove-chest" in layout and SIGNPOST_ID in layout
    assert "region_id" in area_admin.readonly_fields and "location" in area_admin.readonly_fields
