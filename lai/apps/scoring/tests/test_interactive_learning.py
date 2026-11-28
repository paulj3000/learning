"""Issue #102: scoring and progression for interactive Treasure Rush puzzles.

Hints and mistakes never lower what a child earns; replay and retries never pay twice; coins and
jumps are accomplishments, never skill evidence; a puzzle that opens a chest is one star goal
whichever way the child opened it; and a parent can tell adventures, practice, mastery and
needs-practice apart."""

import pytest
from django.urls import reverse

from apps.core.content_status import ContentStatus
from apps.education.models import SkillEvidence, SkillProgress
from apps.game_sessions import play
from apps.game_sessions.play_state import practice_summary
from apps.regions.models import AreaPuzzle, PuzzleKind
from apps.regions.seeding import seed_puzzle
from apps.regions.tests.test_interactive_puzzle_kinds import (
    RIGHT_SORT,
    SORT,
    WRONG_SORT,
)
from apps.regions.tests.test_puzzles import puzzle_body
from apps.scoring import collectors, engine_events, ledger, reconcile
from apps.scoring.contracts import SourceKind
from apps.scoring.models import AwardLedgerEntry

from .test_collectors_and_reconcile import answer_chest, pickup, set_key_category

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def sorting(treasure):
    """Treasure Cove with a published SORT_ITEMS puzzle (classification)."""
    seed_puzzle(
        treasure.region,
        puzzle_id="sort-cargo",
        kind=PuzzleKind.SORT_ITEMS,
        entity_ids=[],
        body=puzzle_body("sort-cargo", PuzzleKind.SORT_ITEMS, "COVE_CARGO_SORTED", SORT),
    )
    AreaPuzzle.objects.update(status=ContentStatus.PUBLISHED)
    return treasure


def solve(treasure, child, submission, *, hints=None, new_visit=False):
    if new_visit:
        session = play.start_or_resume_region_session(child, treasure.region)[0]
        play.end_session(session)
    session, _ = play.start_or_resume_region_session(child, treasure.region)
    return play.solve_puzzle(child, session.pk, "sort-cargo", submission, hints_used=hints)


def awards(child):
    return sorted(
        AwardLedgerEntry.objects.filter(child=child).values_list(
            "source_kind", "source_ref", "currency", "amount"
        )
    )


def test_mistakes_and_hints_earn_exactly_what_a_first_try_earns(sorting, scoring):
    families = sorting.families
    quick, helped = families.a1, families.a2
    assert solve(sorting, quick, RIGHT_SORT).solved_now
    assert not solve(sorting, helped, WRONG_SORT).correct
    assert not solve(sorting, helped, WRONG_SORT, hints=1).correct
    assert solve(sorting, helped, RIGHT_SORT, hints=1).solved_now
    for child in (quick, helped):
        reconcile.reconcile_child(child)
    assert awards(quick) == awards(helped)
    assert any(kind == SourceKind.PUZZLE_SOLVED for kind, *_ in awards(quick))
    # No negative entries anywhere: wrong answers are never debited.
    assert not AwardLedgerEntry.objects.filter(amount__lt=0).exists()


def test_retries_replays_and_reconciles_never_pay_twice(sorting, scoring):
    child = sorting.families.a1
    solve(sorting, child, WRONG_SORT)
    solve(sorting, child, RIGHT_SORT)
    reconcile.reconcile_child(child)
    paid = awards(child)
    # A later visit replays it as practice; reconcile runs again.
    replay = solve(sorting, child, RIGHT_SORT, new_visit=True)
    assert replay.practice and replay.attempt is None
    reconcile.reconcile_child(child)
    reconcile.reconcile_child(child)
    assert awards(child) == paid
    assert ledger.projection_matches_ledger(child)
    puzzle_awards = [a for a in paid if a[0] == SourceKind.PUZZLE_SOLVED]
    assert len(puzzle_awards) == len({a[1:3] for a in puzzle_awards})


def test_coins_are_rewards_never_skill_evidence(treasure, scoring):
    child = treasure.families.a1
    set_key_category(treasure, "COLLECTIBLE")
    assert pickup(treasure).picked_up
    reconcile.reconcile_child(child)
    assert AwardLedgerEntry.objects.filter(
        child=child, source_kind=SourceKind.PICKUP_COLLECTED
    ).exists()
    assert not SkillEvidence.objects.filter(child=child).exists()
    assert not SkillProgress.objects.filter(child=child).exists()
    assert practice_summary(child) == []


@pytest.mark.parametrize(
    ("event_type", "payload"),
    [
        ("jump.challenge.completed", {"challengeId": "leap-1", "routeId": "high"}),
        ("jump.alternative.used", {"challengeId": "leap-1", "routeId": "ramp"}),
        ("course.completed", {"courseId": "cove-course", "goalId": "flag"}),
    ],
)
def test_a_jump_or_course_claim_is_never_scored_or_evidence(event_type, payload):
    event = {
        "schema": engine_events.SCHEMA,
        "version": engine_events.VERSION,
        "type": event_type,
        "eventId": "0f8e2c1a-5b7d-4e2f-9a31-000000000102",
        "occurredAt": "2026-11-26T10:00:00.000Z",
        "sessionRef": "3b9f6a2e-1c4d-4f8a-b7e2-9d0c5a6f1e23",
        "realmId": "treasure-rush",
        "adventureId": "treasure-cove",
        "areaId": "treasure-rush-cove",
        "payload": payload,
    }
    assert engine_events.validate(event) == []
    classification = engine_events.classify(event)
    assert classification.disposition != engine_events.Disposition.SERVER_RECORD
    assert classification.source_kind not in {
        SourceKind.LEARNING_CHALLENGE,
        SourceKind.PUZZLE_SOLVED,
        SourceKind.MASTERY_MILESTONE,
    }


def test_a_puzzle_that_opens_a_chest_is_one_star_goal_either_way(treasure, scoring):
    """LAI 01's #102 seed lets a puzzle record a chest's world change key. A child who opened the
    chest through its old challenge and a child who solves the puzzle meet the same goal."""
    chest = treasure.chest
    seed_puzzle(
        treasure.region,
        puzzle_id="cove-route",
        kind=PuzzleKind.SORT_ITEMS,
        entity_ids=[],
        body=puzzle_body("cove-route", PuzzleKind.SORT_ITEMS, "COVE_ROUTE_WALKED", SORT),
    )
    AreaPuzzle.objects.update(status=ContentStatus.PUBLISHED)
    # The seed may already carry the real covering puzzle (#109's stage seed); two puzzles never
    # share a key, so set it aside and let `cove-route` stand in for it, with a known answer.
    for other in AreaPuzzle.objects.filter(world_change_key=chest.world_change_key):
        AreaPuzzle.objects.filter(pk=other.pk).update(
            status=ContentStatus.DRAFT, world_change_key=f"TEST_SET_ASIDE_{other.pk}"
        )
    region_id = treasure.region.region_id
    before, new = treasure.families.a1, treasure.families.a2

    # A child who opened the chest through its old challenge, before any puzzle covered it
    # (once a puzzle covers it, `chest_lock` says PUZZLE and the challenge no longer runs).
    assert answer_chest(treasure, before).correct
    # Then the puzzle takes the chest's key. Set the column directly: this test is about the
    # collector, not authoring.
    AreaPuzzle.objects.filter(puzzle_id="cove-route").update(
        world_change_key=chest.world_change_key
    )
    session, _ = play.start_or_resume_region_session(new, treasure.region)
    assert play.solve_puzzle(new, session.pk, "cove-route", RIGHT_SORT).solved_now

    goals = {c.pk: collectors._goals(region_id, *collectors._achieved(c)) for c in (before, new)}
    assert goals[before.pk] == goals[new.pk]
    assert goals[new.pk][0] >= 1
    # The covering puzzle replaces the chest's goal rather than adding one.
    with_cover = goals[new.pk][1]
    AreaPuzzle.objects.filter(puzzle_id="cove-route").update(status=ContentStatus.DRAFT)
    assert collectors._goals(region_id, set(), set(), set())[1] == with_cover


def test_a_parent_can_tell_adventures_practice_mastery_and_needs_practice_apart(
    sorting, scoring, api
):
    families = sorting.families
    child = families.a1
    set_key_category(sorting, "COLLECTIBLE")
    pickup(sorting, child)  # coins: a reward, not learning
    solve(sorting, child, WRONG_SORT)
    solve(sorting, child, RIGHT_SORT, hints=1)  # a mistake, then a hinted solve
    reconcile.reconcile_child(child)

    response = api(families.a).get(reverse("skill-progress", kwargs={"child_id": child.pk}))
    assert response.status_code == 200
    skills = {row["learningObjectiveCode"]: row for row in response.json()["skills"]}
    # Practised: only the skill a graded decision showed. Coins and the chest key added none.
    assert set(skills) == {"classification"}
    row = skills["classification"]
    assert (row["exposureCount"], row["independentSuccessCount"], row["supportedSuccessCount"]) == (
        2,
        0,
        1,
    )
    # Not mastery yet, and flagged as an area needing more practice.
    assert row["recentLevel"] not in ("PROFICIENT", "MASTERED")
    assert row["errorPattern"] == "NEEDS_SUPPORT"
    assert practice_summary(child) == [
        {"objective_code": "classification", "attempts": 2, "correct": 1}
    ]
    # No mastery milestone is paid for a supported solve or for coins.
    assert not AwardLedgerEntry.objects.filter(
        child=child, source_kind=SourceKind.MASTERY_MILESTONE
    ).exists()
    # Another family cannot read this child's skills.
    other = api(families.b).get(reverse("skill-progress", kwargs={"child_id": child.pk}))
    assert other.status_code in (403, 404)
