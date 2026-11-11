"""AP-03 Realm Explorer: subject areas from published learning objectives, authored overrides,
and Realm (Island) and Place pictures from the asset library, through the child-scoped islands
API. The families' children are Pathfinders.
"""

import io

import pytest

from apps.assets import services as asset_services
from apps.assets.tests.helpers import make_definition
from apps.assets.tests.media_files import png_bytes
from apps.catalog import authoring
from apps.catalog.models import Location, World
from apps.game_sessions.discovery import SUBJECT_AREAS

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

HOME = "learning-adventure-island"


@pytest.fixture
def a(treasure, api):
    return api(treasure.families.a), treasure.families.a1


def islands(client, child) -> dict:
    body = client.get(f"/api/v1/children/{child.pk}/islands/").json()
    return {island["islandId"]: island for island in body["islands"]}


def places(island) -> dict:
    return {place["placeId"]: place for place in island["places"]}


def author(row, **fields):
    """An administrator's published edit, as far as discovery reads it (the row's `source`)."""
    row.source = {**row.source, **fields}
    row.save(update_fields=["source"])


def image(asset_id, *, publish=True):
    asset = make_definition(asset_id, kind="image", category="image")
    if publish:
        version = asset_services.upload_version(
            asset, io.BytesIO(png_bytes(8, 8)), original_filename="art.png"
        )
        asset_services.publish_version(version)
    return asset


# --- subject areas -------------------------------------------------------------------------------


def test_subject_areas_come_from_the_objectives_a_place_teaches(a):
    client, child = a
    home = islands(client, child)[HOME]
    bay = places(home)["pirate-builder-bay"]
    # Pip's bridge adventures and Treasure Cove's chests teach numeracy objectives.
    assert "MATH" in bay["subjectAreas"]
    for entry in [home, *home["places"]]:
        assert set(entry["subjectAreas"]) <= set(SUBJECT_AREAS)
        assert entry["subjectAreas"] == [s for s in SUBJECT_AREAS if s in entry["subjectAreas"]]
    # The Realm teaches what its Places teach.
    union = {area for place in home["places"] for area in place["subjectAreas"]}
    assert set(home["subjectAreas"]) == union


def test_a_place_with_nothing_for_this_age_band_has_no_derived_subject_areas(a):
    client, child = a
    place = Location.objects.get(slug="storykeeper-castle")
    place.adventures.update(active=False)
    castle = places(islands(client, child)[HOME])["storykeeper-castle"]
    assert castle["subjectAreas"] == [] and castle["adventureCount"] == 0


def test_an_authored_subject_list_replaces_the_derived_one(a):
    client, child = a
    author(Location.objects.get(slug="pirate-builder-bay"), subjectAreas=["SCIENCE", "MATH"])
    author(World.objects.get(slug="creature-care-cove"), subjectAreas=["CREATIVITY", "NOPE"])
    found = islands(client, child)
    assert places(found[HOME])["pirate-builder-bay"]["subjectAreas"] == ["MATH", "SCIENCE"]
    # Unknown values are dropped; the order is always the filter order.
    assert found["creature-care-cove"]["subjectAreas"] == ["CREATIVITY"]


def test_places_carry_their_description_and_skills(a):
    client, child = a
    castle = places(islands(client, child)[HOME])["storykeeper-castle"]
    place = Location.objects.get(slug="storykeeper-castle")
    assert castle["description"] == place.description
    assert castle["skills"] == list(place.skills)
    assert islands(client, child)[HOME]["description"] == World.objects.get(slug=HOME).description


# --- pictures ------------------------------------------------------------------------------------


def test_there_is_no_picture_until_one_is_authored(a):
    client, child = a
    home = islands(client, child)[HOME]
    assert home["thumbnailAssetId"] is None
    assert all(place["thumbnailAssetId"] is None for place in home["places"])


def test_a_published_image_is_the_realm_and_place_picture(a):
    client, child = a
    image("realm-home-art")
    image("place-bay-art")
    author(World.objects.get(slug=HOME), artAssetId="realm-home-art")
    author(Location.objects.get(slug="pirate-builder-bay"), artAssetId="place-bay-art")
    home = islands(client, child)[HOME]
    assert home["thumbnailAssetId"] == "realm-home-art"
    assert places(home)["pirate-builder-bay"]["thumbnailAssetId"] == "place-bay-art"
    # The id resolves through the child-scoped resolver like any other published asset.
    resolved = client.get(f"/api/v1/children/{child.pk}/assets/", {"ids": "realm-home-art"}).json()[
        "assets"
    ][0]
    assert resolved["status"] == "resolved" and resolved["family"] == "image"


@pytest.mark.parametrize("case", ["unpublished", "retired", "model", "unknown"])
def test_an_art_id_that_cannot_be_delivered_is_left_out(a, case):
    client, child = a
    if case == "unpublished":
        image("realm-art", publish=False)
    elif case == "retired":
        asset_services.retire_asset(image("realm-art"))
    elif case == "model":
        make_definition("realm-art", kind="prop", category="prop")
    author(World.objects.get(slug=HOME), artAssetId="realm-art")
    assert islands(client, child)[HOME]["thumbnailAssetId"] is None


def test_another_childs_request_cannot_read_the_catalog(treasure, api):
    families = treasure.families
    assert api(families.a).get(f"/api/v1/children/{families.b1.pk}/islands/").status_code == 404


# --- authoring (ADR-047): the picture must name an image ----------------------------------------


@pytest.mark.parametrize(
    ("setup", "problem"),
    [
        (lambda: None, "unknown asset 'realm-art'"),
        (lambda: make_definition("realm-art", kind="prop", category="prop"), "not an image"),
    ],
)
def test_publishing_checks_the_art_reference(treasure, setup, problem):
    setup()
    for row in (World.objects.get(slug=HOME), Location.objects.get(slug="storykeeper-castle")):
        body = {**authoring.current_body(row), "artAssetId": "realm-art"}
        assert any(problem in p for p in authoring.validate(row, body))


def test_publishing_accepts_an_image_and_subject_areas(treasure):
    image("realm-art", publish=False)  # publication of the file is a delivery question
    row = Location.objects.get(slug="storykeeper-castle")
    body = {
        **authoring.current_body(row),
        "artAssetId": "realm-art",
        "subjectAreas": ["READING", "CREATIVITY"],
    }
    assert authoring.validate(row, body) == []
    body["subjectAreas"] = ["HISTORY"]
    assert authoring.validate(row, body) != []
