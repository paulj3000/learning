import pytest
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError

from apps.catalog.importer import import_content
from apps.catalog.models import Adventure, AdventureStep, ContentAsset, Location, LocationAsset, World
from apps.catalog.tests.helpers import write_export

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def imported(tmp_path):
    import_content(write_export(tmp_path / "v1"))


def test_a_step_id_is_unique_within_its_adventure(imported):
    step = AdventureStep.objects.get(adventure__slug="fix-bridge", step_id="count")
    with pytest.raises(IntegrityError), transaction.atomic():
        AdventureStep.objects.create(
            adventure=step.adventure, step_id="count", position=9, step_type="NARRATIVE",
            source={}, last_seen_release=step.last_seen_release,
        )


def test_an_asset_is_linked_to_a_location_at_most_once(imported):
    link = LocationAsset.objects.first()
    with pytest.raises(IntegrityError), transaction.atomic():
        LocationAsset.objects.create(
            location=link.location, asset=link.asset, position=9,
            last_seen_release=link.last_seen_release,
        )


def test_parents_and_used_assets_cannot_be_deleted_out_from_under_their_children(imported):
    with pytest.raises(ProtectedError):
        World.objects.get(slug="home-island").delete()
    with pytest.raises(ProtectedError):
        Location.objects.get(slug="bay").delete()  # an adventure still points at it
    with pytest.raises(ProtectedError):
        ContentAsset.objects.get(asset_id="rock").delete()


def test_slugs_are_unique(imported):
    world = World.objects.get()
    with pytest.raises(IntegrityError), transaction.atomic():
        World.objects.create(
            slug=world.slug, title="Copy", supported_age_bands=[], pack_version=1, source={},
            last_seen_release=world.last_seen_release,
        )


def test_records_print_their_stable_identifier(imported):
    assert str(Adventure.objects.get(slug="fix-bridge")) == "fix-bridge"
    assert str(ContentAsset.objects.get(asset_id="rock")) == "rock"


def test_worlds_and_locations_are_labelled_apart():
    assert World._meta.verbose_name_plural == "worlds (themed islands)"
    assert Location._meta.verbose_name_plural == "locations (regions inside a world)"
