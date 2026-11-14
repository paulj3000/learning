"""The Director on Django (AMP-05): the port of `getNextLearningActivity`.

Rules are pinned against hand-computed rankings over a small catalog, the curriculum mirror is
pinned to the export, and the route is proven child-scoped with the LAI-0403 fixtures.
"""

import json
from datetime import UTC, datetime, timedelta

import pytest
from django.conf import settings
from django.utils import timezone

from apps.catalog.importer import import_content
from apps.catalog.models import ContentRelease
from apps.catalog.tests.helpers import base_collections, write_export
from apps.education import director
from apps.education.models import SkillProgress
from apps.game_sessions.models import AdventureSession, SessionStatus
from apps.progression.models import WorldChange

pytestmark = pytest.mark.postgres

NOW = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)


def _adventure(slug, title, location, objectives, age_bands=("PATHFINDER",)):
    return {
        "slug": slug,
        "title": title,
        "version": 1,
        "locationSlug": location,
        "ageBands": list(age_bands),
        "entryStepId": "play",
        "steps": [
            {
                "id": "play",
                "type": "NUMBER_INPUT",
                "objectiveIds": list(objectives),
                "presentation": {"kind": "number-input", "prompt": "How many?", "correctValue": 3},
                "transitions": [{"when": "always", "nextStepId": "done"}],
                "fallback": {"text": "Try again"},
            },
            {
                "id": "done",
                "type": "COMPLETE",
                "objectiveIds": [],
                "presentation": {"kind": "complete", "text": "Done"},
                "transitions": [],
                "fallback": {"text": "Done"},
            },
        ],
    }


@pytest.fixture
def catalog(db, tmp_path):
    """Home island (bay), a far island behind BRIDGE_REPAIRED (cove), and a story-only place."""
    collections = base_collections()
    home = collections["islands.json"]["islands"][0]
    home["supportedAgeBands"] = ["SPROUT", "PATHFINDER", "EXPLORER"]
    home["pack"]["adventureSlugs"] = [
        "count-crates",
        "add-shells",
        "measure-masts",
        "the-tale",
        "sprout-only",
    ]
    collections["islands.json"]["islands"].append(
        {
            "slug": "far-isle",
            "title": "Far Isle",
            "tagline": "Across the water",
            "description": "A second island.",
            "isHome": False,
            "supportedAgeBands": ["PATHFINDER"],
            "travelRequirement": {
                "anyOfChangeKeys": ["BRIDGE_REPAIRED", "TIDE_GATE_SET"],
                "lockedHint": "Not yet.",
            },
            "pack": {"version": 1, "locationSlugs": ["cove"], "adventureSlugs": ["cove-count"]},
        }
    )
    collections["locations.json"]["locations"].append(
        {
            "slug": "cove",
            "worldSlug": "far-isle",
            "title": "The Cove",
            "tagline": "Quiet",
            "description": "A cove.",
            "skills": [],
            "decoration": "",
        }
    )
    collections["adventures.json"]["adventures"] = [
        _adventure("count-crates", "Count Crates", "bay", ["counting-sets"]),
        _adventure("add-shells", "Add Shells", "bay", ["addition-within-ten"]),
        _adventure("measure-masts", "Measure Masts", "bay", ["comparing-lengths", "measurement"]),
        _adventure("the-tale", "The Tale", "story-only-place", []),
        _adventure("sprout-only", "Sprout Sorting", "bay", ["classification"], ("SPROUT",)),
        _adventure("cove-count", "Cove Count", "cove", ["counting-sets"]),
    ]
    collections["quests.json"]["quests"][0]["stages"][0]["objectives"][0]["adventureSlug"] = (
        "count-crates"
    )
    import_content(write_export(tmp_path / "director-export", collections))


def slugs(result):
    return [s["adventureSlug"] for s in result["suggestions"]]


def play(child, slug, status=SessionStatus.COMPLETED, minutes_ago=10):
    from apps.catalog.models import Adventure

    adventure = Adventure.objects.get(slug=slug)
    at = NOW - timedelta(minutes=minutes_ago)
    return AdventureSession.objects.create(
        child=child,
        adventure=adventure,
        template_version=adventure.version,
        content_release=ContentRelease.objects.latest("imported_at"),
        status=status,
        started_at=at,
        last_activity_at=at,
        completed_at=at if status == SessionStatus.COMPLETED else None,
    )


def progress(child, skill, *, exposure, independent, streak, practiced=NOW):
    SkillProgress.objects.create(
        child=child,
        learning_objective_code=skill,
        exposure_count=exposure,
        independent_success_count=independent,
        consecutive_independent_correct=streak,
        last_practiced_at=practiced,
    )


# --- the rules --------------------------------------------------------------------------------


def test_a_new_pathfinder_gets_skill_ranked_reachable_adventures(catalog, families):
    result = director.next_learning_activity(families.a1, now=NOW)
    # count-crates and measure-masts both practise an INTRODUCED skill (3); addition and
    # measurement are LOCKED behind prerequisites (0). Ties break on title. The cove is closed,
    # the Sprout adventure is another band, and only three are returned.
    assert slugs(result) == ["count-crates", "measure-masts", "add-shells"]
    assert result["hasPersonalizedSignal"] is True
    first = result["suggestions"][0]
    assert first == {
        "adventureSlug": "count-crates",
        "title": "Count Crates",
        "score": 3,
        "reasons": [
            {
                "kind": "PRACTISES_SKILL",
                "skillId": "counting-sets",
                "status": "INTRODUCED",
                "weight": 3,
                "storyId": None,
                "penalty": None,
            }
        ],
    }
    add = result["suggestions"][2]
    assert add["score"] == 0
    assert [r["kind"] for r in add["reasons"]] == ["NO_SKILLS_NEEDED"]


def test_a_world_change_opens_the_far_island(catalog, families):
    WorldChange.objects.create(
        child=families.a1,
        location_slug="pirate-builder-bay",
        change_type="REPAIR",
        change_key="BRIDGE_REPAIRED",
        created_at=NOW,
    )
    result = director.next_learning_activity(families.a1, now=NOW)
    assert slugs(result) == ["count-crates", "cove-count", "measure-masts"]
    # Another child's world change opens nothing for this one.
    assert "cove-count" not in slugs(director.next_learning_activity(families.a2, now=NOW))


def test_completed_and_recent_adventures_sink_but_stay_reachable(catalog, families):
    play(families.a1, "count-crates")
    result = director.next_learning_activity(families.a1, now=NOW)
    assert slugs(result) == ["measure-masts", "add-shells", "the-tale"]
    full = director.rank(
        director.candidate_adventures("PATHFINDER", set()),
        {"counting-sets": ("INTRODUCED", 3)},
        {"count-crates"},
        ["count-crates"],
    )
    crates = next(s for s in full if s.adventure_slug == "count-crates")
    assert crates.score == 3 - director.COMPLETED_PENALTY - director.RECENT_PENALTY
    assert [r["kind"] for r in crates.reasons] == [
        "PRACTISES_SKILL",
        "ALREADY_COMPLETED",
        "PLAYED_RECENTLY",
    ]


def test_only_the_three_most_recent_sessions_count_as_recent(catalog, families):
    play(families.a1, "count-crates", status=SessionStatus.ABANDONED, minutes_ago=40)
    for minutes, slug in ((30, "add-shells"), (20, "the-tale"), (10, "measure-masts")):
        play(families.a1, slug, status=SessionStatus.ABANDONED, minutes_ago=minutes)
    result = director.next_learning_activity(families.a1, now=NOW)
    # count-crates is the fourth most recent: no penalty, so it leads on its own.
    assert slugs(result)[0] == "count-crates"
    assert result["suggestions"][0]["score"] == 3


def test_mastery_moves_the_need_and_unlocks_dependent_skills(catalog, families):
    progress(families.a1, "counting-sets", exposure=3, independent=3, streak=3)
    result = director.next_learning_activity(families.a1, now=NOW)
    # counting-sets is PROFICIENT (1), so addition-within-ten unlocks as INTRODUCED (3).
    assert slugs(result) == ["add-shells", "measure-masts", "count-crates"]
    assert result["suggestions"][2]["reasons"][0]["status"] == "PROFICIENT"


def test_review_decay_applies_at_read_time_without_relocking(catalog, families):
    progress(
        families.a1,
        "counting-sets",
        exposure=3,
        independent=3,
        streak=3,
        practiced=NOW - timedelta(days=30),
    )
    result = director.next_learning_activity(families.a1, now=NOW)
    by_slug = {s["adventureSlug"]: s for s in result["suggestions"]}
    # Decayed to DEVELOPING (2) for its own need; still known as a prerequisite.
    assert by_slug["count-crates"]["reasons"][0]["status"] == "DEVELOPING"
    assert by_slug["add-shells"]["score"] == 3


def test_a_band_without_authored_skills_or_adventures_is_not_personalised(catalog, families):
    families.a1.age_band = "EXPLORER"
    result = director.next_learning_activity(families.a1, now=NOW)
    assert result == {"suggestions": [], "hasPersonalizedSignal": False}


def test_a_sprout_sees_only_sprout_adventures_and_story_places(catalog, families):
    families.a1.age_band = "SPROUT"
    result = director.next_learning_activity(families.a1, now=NOW)
    assert slugs(result) == ["sprout-only"]
    # classification needs observation first: LOCKED, so no skill signal.
    assert result["hasPersonalizedSignal"] is False


def test_inactive_adventures_are_never_suggested(catalog, families):
    from apps.catalog.models import Adventure

    Adventure.objects.filter(slug="count-crates").update(active=False)
    assert "count-crates" not in slugs(director.next_learning_activity(families.a1, now=NOW))


def test_the_ranking_is_deterministic(catalog, families):
    play(families.a1, "measure-masts", status=SessionStatus.ABANDONED)
    first = director.next_learning_activity(families.a1, now=NOW)
    assert all(director.next_learning_activity(families.a1, now=NOW) == first for _ in range(3))


def test_the_curriculum_mirror_matches_the_export():
    data = json.loads((settings.CONTENT_DIR / "exported" / "curriculum.json").read_text())
    grade_bands = {g["id"]: frozenset(g["ageBands"]) for g in data["grades"]}
    domain_grade = {d["id"]: d["gradeId"] for d in data["domains"]}
    exported = {s["id"]: grade_bands[domain_grade[s["domainId"]]] for s in data["skills"]}
    assert director.SKILL_AGE_BANDS == exported


def test_the_real_export_never_suggests_an_unreachable_island(db, families):
    from apps.catalog.models import Adventure

    import_content()
    result = director.next_learning_activity(families.a1, now=NOW)
    assert 0 < len(result["suggestions"]) <= director.MAX_SUGGESTIONS
    for suggestion in result["suggestions"]:
        adventure = Adventure.objects.select_related("location__world").get(
            slug=suggestion["adventureSlug"]
        )
        assert "PATHFINDER" in adventure.age_bands
        world = adventure.location.world if adventure.location else None
        assert world is None or not (world.source or {}).get("travelRequirement")
        for reason in suggestion["reasons"]:
            assert reason["kind"] in director.REASON_KINDS


# --- the route ----------------------------------------------------------------------------------


def url(child):
    return f"/api/v1/children/{child.pk}/next-learning-activity/"


def test_the_route_answers_for_the_parents_own_child(catalog, families, api):
    response = api(families.a).get(url(families.a1))
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"suggestions", "hasPersonalizedSignal"}
    assert [s["adventureSlug"] for s in body["suggestions"]][:2] == [
        "count-crates",
        "measure-masts",
    ]


def test_the_route_is_child_scoped(catalog, families, api):
    assert api(families.b).get(url(families.a1)).status_code == 404
    assert api().get(url(families.a1)).status_code == 401
    assert api(families.a).post(url(families.a1), {}).status_code == 405


def test_another_familys_play_never_changes_this_childs_ranking(catalog, families):
    before = director.next_learning_activity(families.a1, now=NOW)
    play(families.b1, "count-crates")
    progress(families.b1, "counting-sets", exposure=5, independent=5, streak=5)
    assert director.next_learning_activity(families.a1, now=NOW) == before


def test_the_default_clock_is_now(catalog, families):
    assert director.next_learning_activity(families.a1) == director.next_learning_activity(
        families.a1, now=timezone.now()
    )
