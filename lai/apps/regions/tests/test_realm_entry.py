"""Entering Firepeak and North Pole the way a child does, from Realms (#98, #100).

The gameplay tests start a region session directly. These start where the Realm Explorer does,
at `GET /children/<id>/islands/`, and follow what it serves: the Area must be listed and
available for the child's age band, a session started from it, left part-way, shown as
resumable on the next catalog read, and re-entered as the same session.

#100: an Area made only of puzzles (Firepeak Volcano, the Heart of Firepeak) was never
available, because only chests counted. #98 was client routing; its Django half is that North
Pole is served as an unlocked Realm whose Area is available to every band.
"""

import json

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.catalog.importer import import_content
from apps.core.content_status import ContentStatus
from apps.game_sessions import discovery
from apps.regions.models import AreaPuzzle, WorldRegion

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

HOME = "learning-adventure-island"
BANDS = ("SPROUT", "PATHFINDER", "EXPLORER")


def _seed_realms():
    """A fresh environment set up as the local playthrough instructions say."""
    import_content()
    with override_settings(DEBUG=True):
        for command in (
            "seed_firepeak",
            "publish_firepeak",
            "seed_firepeak_heart",
            "publish_firepeak_heart",
            "seed_north_pole",
            "publish_north_pole",
            "seed_seasonal_events",
        ):
            call_command(command, stdout=None)


@pytest.fixture(scope="module")
def realms_content(module_content):
    """`_seed_realms()` once for the module (lai/conftest.py, "Module content baseline")."""
    return module_content.seed("realms", _seed_realms)


@pytest.fixture
def realms(realms_content, families):
    if not realms_content.has("realms"):
        _seed_realms()
    return families


def base(child):
    return f"/api/v1/children/{child.pk}/"


def post(client, url):
    return client.post(url, json.dumps({}), content_type="application/json")


def islands(client, child) -> dict:
    response = client.get(f"{base(child)}islands/")
    assert response.status_code == 200, response.content
    return {island["islandId"]: island for island in response.json()["islands"]}


def place(view, island_id, place_id):
    island = view[island_id]
    return next((p for p in island["places"] if p["placeId"] == place_id), None)


def as_band(child, band):
    child.age_band = band
    child.save()
    return child


# --- Discovery: what Realms is served -----------------------------------------------------------


@pytest.mark.parametrize("band", ["PATHFINDER", "EXPLORER"])
@pytest.mark.parametrize("region_id", ["firepeak-volcano", "firepeak-heart"])
def test_firepeak_areas_are_available_from_the_home_realm(realms, api, band, region_id):
    child = as_band(realms.a1, band)
    view = islands(api(realms.a), child)
    area = place(view, HOME, region_id)["area"]
    assert area["regionId"] == region_id
    assert area["available"] is True, area
    assert area["lockedReason"] is None
    assert area["ageBands"] == ["PATHFINDER", "EXPLORER"]


@pytest.mark.parametrize("region_id", ["firepeak-volcano", "firepeak-heart"])
def test_a_sprout_is_not_offered_firepeak(realms, api, region_id):
    child = as_band(realms.a1, "SPROUT")
    assert place(islands(api(realms.a), child), HOME, region_id)["area"] is None
    response = post(api(realms.a), f"{base(child)}regions/{region_id}/session/")
    assert response.status_code != 201


@pytest.mark.parametrize("band", BANDS)
def test_north_pole_is_an_open_realm_with_an_available_village(realms, api, band):
    child = as_band(realms.a1, band)
    view = islands(api(realms.a), child)
    assert view["north-pole"]["unlocked"] is True
    assert view["north-pole"]["isHome"] is False
    area = place(view, "north-pole", "north-pole-village")["area"]
    assert area["available"] is True, area
    assert area["ageBands"] == list(BANDS)


def test_puzzles_without_parameters_for_the_band_do_not_make_an_area_available(realms):
    """The rule `solve_puzzle` applies: no parameters for the band, nothing to play."""
    region = WorldRegion.objects.get(region_id="firepeak-heart")
    child = as_band(realms.a1, "PATHFINDER")
    assert discovery.has_puzzle_for_band(region, "PATHFINDER")
    assert not discovery.has_puzzle_for_band(region, "SPROUT")

    AreaPuzzle.objects.filter(region=region).update(status=ContentStatus.DRAFT)
    assert not discovery.has_puzzle_for_band(region, "PATHFINDER")
    [entry] = discovery.region_entries(child, [region])
    assert entry.playable is False


def test_a_puzzle_only_area_is_not_suggested_as_next_on_the_home_screen(realms):
    """Home's "next" list counts unopened chests; a puzzle-only Area has none (unchanged)."""
    child = as_band(realms.a1, "EXPLORER")
    suggested = {e.region.region_id for e in discovery.child_home(child)["next_regions"]}
    assert not suggested & {"firepeak-volcano", "firepeak-heart"}


# --- Entry, exit and re-entry through what Realms served ----------------------------------------


ENTRY = [
    ("PATHFINDER", HOME, "firepeak-volcano"),
    ("EXPLORER", HOME, "firepeak-heart"),
    ("PATHFINDER", HOME, "firepeak-heart"),
    ("SPROUT", "north-pole", "north-pole-village"),
    ("PATHFINDER", "north-pole", "north-pole-village"),
    ("EXPLORER", "north-pole", "north-pole-village"),
]


@pytest.mark.parametrize(("band", "island_id", "region_id"), ENTRY)
def test_enter_leave_and_re_enter_from_realms(realms, api, band, island_id, region_id):
    child = as_band(realms.a1, band)
    client = api(realms.a)

    # Enter: the Area Realms links to starts a session.
    area = place(islands(client, child), island_id, region_id)["area"]
    assert area["available"] is True and area["resume"] is None
    started = post(client, f"{base(child)}regions/{area['regionId']}/session/")
    assert started.status_code == 201, started.content
    session = started.json()["sessionId"]

    # Leave part-way ("Leave island" pauses play): Realms now offers Continue.
    assert post(client, f"{base(child)}sessions/{session}/pause/").status_code == 200
    area = place(islands(client, child), island_id, region_id)["area"]
    assert area["status"] == "IN_PROGRESS"
    assert area["resume"]["sessionId"] == session

    # Re-enter: the same session, resumed, never a second one.
    again = post(client, f"{base(child)}regions/{region_id}/session/")
    assert again.status_code == 200, again.content
    assert again.json()["sessionId"] == session
    assert again.json()["status"] == "ACTIVE"


def test_another_family_cannot_read_or_enter_a_childs_realms(realms, api):
    child = realms.a1
    assert api(realms.b).get(f"{base(child)}islands/").status_code in (403, 404)
    response = post(api(realms.b), f"{base(child)}regions/north-pole-village/session/")
    assert response.status_code in (403, 404)
