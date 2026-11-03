"""The Great Storybook's page state (SC-R04-02): the child-scoped checklist
(docs/TESTING_STRATEGY.md, LAI-0403) and the rules of a derived page: read-only, from the server's
own records, the child's own band, and a hidden page that gives nothing away until it is found."""

import json
import uuid

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.catalog.models import Quest
from apps.progression import discoveries
from apps.progression.models import WorldChange, WorldState
from apps.progression.services import record_world_change
from apps.quests import services
from apps.regions import great_storybook
from apps.users.tests.helpers import access_claims

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

NOOK = "castle-tapestry-stair"
MINUTES = {"SPROUT": 6, "PATHFINDER": 10, "EXPLORER": 12}


def url(child) -> str:
    return f"/api/v1/children/{child.pk}/castle/storybook/"


def band(child, value):
    child.age_band = value
    child.session_minutes = MINUTES[value]
    child.save()
    return child


def write(child, key, location="storykeeper-castle"):
    record_world_change(child, location_slug=location, change_type="CREATE", change_key=key)


@pytest.fixture
def fam(treasure):
    return treasure.families


def get(api_client, child):
    response = api_client.get(url(child))
    assert response.status_code == 200, response.content
    return response.json()


def ids(body):
    return [page["id"] for page in body["pages"]]


# --- the checklist ---------------------------------------------------------------------------


def test_each_of_a_parents_children_reads_their_own_book(fam, api):
    client = api(fam.a)
    for child in (fam.a1, fam.a2):
        assert get(client, child)["band"] == "PATHFINDER"


def test_another_familys_child_and_an_unknown_child_get_the_identical_404(fam, api):
    client = api(fam.a)
    foreign = client.get(url(fam.b1))
    unknown = client.get(f"/api/v1/children/{uuid.uuid4()}/castle/storybook/")
    assert foreign.status_code == unknown.status_code == 404
    assert foreign.json()["error"] == unknown.json()["error"]


def test_no_token_bad_token_unprovisioned_and_inactive_are_denied(fam, api, cognito):
    assert api().get(url(fam.a1)).status_code == 401
    expired = cognito.sign(access_claims(fam.a.cognito_sub, exp=1))
    for token in ("garbage", expired):
        assert api(token=token).get(url(fam.a1)).status_code == 401
    assert api("sub-never-onboarded").get(url(fam.a1)).status_code == 403
    fam.a.is_active = False
    fam.a.save()
    assert api(fam.a).get(url(fam.a1)).status_code == 403


def test_ids_in_the_query_are_ignored_and_siblings_are_isolated(fam, api):
    client = api(fam.a)
    write(fam.a1, "FIRST_STORY_TOLD")
    own = client.get(url(fam.a1) + f"?child={fam.b1.pk}&band=EXPLORER").json()
    assert own["band"] == "PATHFINDER" and own["restoredRequired"] == 1
    assert get(client, fam.a2)["restoredRequired"] == 0


def test_an_admins_token_gets_no_cross_family_access(fam, api, token_for):
    admin = api(token=token_for(fam.b.cognito_sub, **{"cognito:groups": ["Admins"]}))
    assert admin.get(url(fam.a1)).status_code == 404


def test_error_bodies_name_no_nickname_or_foreign_id(fam, api):
    response = api(fam.a).get(url(fam.b1))
    text = response.content.decode()
    for forbidden in ("Zinnia", "Zephyr", "Quince", "Quill-B2", "Secret-Interest", str(fam.b1.pk)):
        assert forbidden not in text


# --- read-only, derived ----------------------------------------------------------------------


def test_asking_runs_no_insert_update_or_delete_and_changes_nothing(fam, api):
    client = api(fam.a)
    write(fam.a1, "FIRST_STORY_TOLD")
    before = (WorldChange.objects.count(), WorldState.objects.count())
    with CaptureQueriesContext(connection) as queries:
        first = get(client, fam.a1)
        second = get(client, fam.a1)
    written = [
        q for q in queries if q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))
    ]
    assert not written
    assert first == second  # asking twice is asking once
    assert (WorldChange.objects.count(), WorldState.objects.count()) == before


def test_a_page_is_back_exactly_when_its_record_exists(fam, api):
    client = api(fam.a)
    empty = get(client, fam.a1)
    assert ids(empty) == ["page-first-story"]
    assert empty["pages"][0]["restored"] is False
    assert empty["restoredRequired"] == 0 and empty["totalRequired"] == 1 and not empty["complete"]
    write(fam.a1, "FIRST_STORY_TOLD")
    back = get(client, fam.a1)
    assert back["pages"][0]["restored"] is True
    assert back["restoredRequired"] == 1 and back["complete"] is True


def test_a_page_cannot_be_restored_by_another_challenges_record(fam, api):
    client = api(fam.a)
    # Everything else the castle writes, but not the one this band's page names.
    for key in (
        "SECRET_DOOR_CLUES_COLLECTED",
        "CASTLE_SECRET_DOOR_OPENED",
        "CASTLE_READING_NOOK_FOUND",
    ):
        write(fam.a1, key, "castle-secret-passage")
    body = get(client, fam.a1)
    assert body["restoredRequired"] == 0 and not body["complete"]


def test_each_band_sees_only_its_own_pages(fam, api):
    client = api(fam.a)
    expected = {
        "SPROUT": ["page-first-story"],
        "PATHFINDER": ["page-first-story"],
        "EXPLORER": ["page-three-clues", "page-pattern-lock", "page-what-was-waiting"],
    }
    for value, pages in expected.items():
        child = band(fam.a1, value)
        assert ids(get(client, child)) == pages


def test_an_explorers_book_needs_all_three_and_is_whole_with_them(fam, api):
    client = api(fam.a)
    child = band(fam.a1, "EXPLORER")
    for index, key in enumerate(
        [
            "SECRET_DOOR_CLUES_COLLECTED",
            "CASTLE_SECRET_DOOR_OPENED",
            "THE_CASTLES_SECRET_DOOR_COMPLETE",
        ]
    ):
        write(child, key, "castle-secret-passage")
        body = get(client, child)
        assert body["restoredRequired"] == index + 1
        assert body["complete"] is (index == 2)


# --- the hidden page -------------------------------------------------------------------------


def test_the_hidden_page_is_not_listed_until_it_is_found_and_the_response_gives_it_away_to_no_one(
    fam, api
):
    client = api(fam.a)
    for value in ("SPROUT", "PATHFINDER", "EXPLORER"):
        child = band(fam.a1, value)
        response = client.get(url(child))
        text = response.content.decode().lower()
        assert "page-tapestry" not in text
        for giveaway in ("tapestry", "nook", "stair", "hidden", "castle-reading"):
            assert giveaway not in text, f"{value}: {giveaway}"


def test_the_hidden_page_appears_once_found_counts_as_a_bonus_and_never_completes_the_book(
    fam, api
):
    client = api(fam.a)
    discoveries.record_discovery(fam.a1, NOOK)
    body = get(client, fam.a1)
    assert "page-tapestry" in ids(body)
    assert body["restoredBonus"] == 1
    assert body["restoredRequired"] == 0 and body["complete"] is False
    [bonus] = [p for p in body["pages"] if p["id"] == "page-tapestry"]
    assert bonus["required"] is False and bonus["restored"] is True


def test_finding_the_hidden_page_for_one_child_shows_it_to_no_sibling(fam, api):
    client = api(fam.a)
    discoveries.record_discovery(fam.a1, NOOK)
    assert "page-tapestry" not in ids(get(client, fam.a2))


# --- the quest ---------------------------------------------------------------------------------


def test_the_response_names_the_bands_quest_and_follows_its_status(fam, api):
    client = api(fam.a)
    assert get(client, fam.a1)["quest"] == {
        "questId": "restore-the-great-storybook-pathfinders",
        "status": "NOT_STARTED",
    }
    quest = Quest.objects.get(slug="restore-the-great-storybook-pathfinders")
    progress, _ = services.start_quest(fam.a1, quest)
    assert get(client, fam.a1)["quest"]["status"] == "ACTIVE"
    services.refresh_quest(progress)  # no records yet: still active
    assert get(client, fam.a1)["quest"]["status"] == "ACTIVE"


def test_the_pages_file_is_well_formed_and_matches_the_quests_that_exist():
    assert len({p["id"] for p in great_storybook.PAGES}) == len(great_storybook.PAGES)
    assert set(great_storybook.QUEST_SLUGS) == {"SPROUT", "PATHFINDER", "EXPLORER"}
    for band_name in great_storybook.QUEST_SLUGS:
        assert great_storybook.pages_for_band(band_name)
        assert any(p["required"] for p in great_storybook.pages_for_band(band_name))
    for page in great_storybook.PAGES:
        assert set(page["bands"]) <= set(great_storybook.QUEST_SLUGS)


def test_every_quest_the_pages_file_names_exists_in_the_imported_content(treasure):
    for slug in great_storybook.QUEST_SLUGS.values():
        assert Quest.objects.filter(slug=slug).exists()


def test_the_response_is_valid_json_with_the_documented_keys(fam, api):
    body = get(api(fam.a), fam.a1)
    assert set(body) == {
        "band",
        "pages",
        "restoredRequired",
        "totalRequired",
        "restoredBonus",
        "complete",
        "quest",
    }
    assert set(body["pages"][0]) == {"id", "title", "required", "restored", "roomId", "text"}
    json.dumps(body)
