"""Skill evidence from Area puzzles (FPV-D10), played through the API on the Heart of Firepeak.

Expected evidence is derived from the shipped content and the catalog at run time (which code
each answered variant names, and whether the catalog holds it), so re-tagging puzzle content
(LAI 03) changes the expectations, not the rules these tests pin:

- every graded attempt of a skill kind whose objective is in the catalog records one row;
- a skill the catalog does not hold is skipped, and never undoes the solve or its reward;
- mechanical kinds, practice re-grades and replays record nothing;
- an unexpected failure is not swallowed: the attempt rolls back with it.
"""

import json
import logging

import pytest
from django.core.management import call_command
from django.db import DatabaseError, IntegrityError, transaction
from django.test import override_settings

from apps.catalog.importer import import_content
from apps.catalog.models import LearningObjective
from apps.core.models import CrossChildReference
from apps.education import services
from apps.education.models import SkillEvidence, SkillProgress
from apps.game_sessions.models import Correctness, PuzzleAttempt
from apps.game_sessions.play_state import practice_summary
from apps.inventory.models import GrantedRule
from apps.progression.models import WorldChange
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions import firepeak_heart_content as content
from apps.regions import firepeak_heart_seed as seed
from apps.regions import puzzles

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REGION = seed.REGION_ID
QUEST = seed.QUEST_ID


def _seed_heart():
    import_content()
    with override_settings(DEBUG=True):
        call_command("seed_firepeak_heart", stdout=None)
        call_command("publish_firepeak_heart", stdout=None)


@pytest.fixture(scope="module")
def heart_content(module_content):
    """`_seed_heart()` once for the module (lai/conftest.py, "Module content baseline")."""
    return module_content.seed("heart", _seed_heart)


@pytest.fixture
def heart(heart_content, families):
    if not heart_content.has("heart"):
        _seed_heart()
    return families


def base(child):
    return f"/api/v1/children/{child.pk}/"


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


def start(client, child):
    response = post(client, f"{base(child)}regions/{REGION}/session/")
    assert response.status_code in (200, 201), response.content
    return response.json()["sessionId"]


def solve(client, child, session, puzzle_id, submission):
    return post(
        client,
        f"{base(child)}sessions/{session}/puzzles/{puzzle_id}/solve/",
        {"submission": submission},
    )


def right_answer(kind, params):
    if kind == "OBSERVE_FEATURES":
        return {"observed": [f["id"] for f in params["features"]]}
    variant = (params.get("variants") or [{}])[0]
    if kind == "CHOOSE_ANSWER":
        return {"variantId": variant["id"], "choice": variant["answer"]}
    if kind == "ORDER_SEQUENCE":
        return {"variantId": variant["id"], "order": variant["answer"]}
    return {}


def wrong_answer(kind, params):
    variant = (params.get("variants") or [{}])[0]
    if kind == "CHOOSE_ANSWER":
        other = next(o["id"] for o in variant["options"] if o["id"] != variant["answer"])
        return {"variantId": variant["id"], "choice": other}
    if kind == "ORDER_SEQUENCE":
        return {"variantId": variant["id"], "order": list(reversed(variant["answer"]))}
    return None


def play_all(client, child, band="PATHFINDER"):
    """Every puzzle in order, one wrong answer first where the kind has one.

    Returns what the evidence should be: [(puzzle id, objective code, correct, support level)]
    for each graded attempt whose objective the catalog holds, and the skipped codes."""
    known = set(LearningObjective.objects.values_list("code", flat=True))
    session = start(client, child)
    assert post(client, f"{base(child)}quests/{QUEST}/accept/").status_code in (200, 201)
    expected, skipped = [], set()
    for puzzle_id, kind, _entities, body in content.puzzle_rows():
        params = body["ageBands"][band]
        wrong = wrong_answer(kind, params)
        attempts = [(wrong, False)] if wrong else []
        attempts.append((right_answer(kind, params), True))
        for number, (submission, correct) in enumerate(attempts):
            outcome = solve(client, child, session, puzzle_id, submission).json()
            assert outcome["correct"] is correct, (puzzle_id, outcome)
            code = puzzles.skill_for(kind, params, submission)
            if code in known:
                expected.append((puzzle_id, code, correct, 1 if number else 0))
            elif code:
                skipped.add(code)
        assert outcome["solvedNow"], (puzzle_id, outcome)
    return session, expected, skipped


def evidence_rows(child):
    rows = SkillEvidence.objects.filter(child=child).select_related("puzzle_attempt")
    return sorted(
        (
            e.puzzle_attempt.puzzle_key,
            e.learning_objective_code,
            e.result == Correctness.CORRECT,
            e.support_level,
        )
        for e in rows
    )


# --- Recording ------------------------------------------------------------------------------------


@pytest.mark.parametrize("band", ["PATHFINDER", "EXPLORER"])
def test_each_graded_attempt_with_a_catalog_objective_records_one_row(heart, api, band):
    child = heart.a1
    child.age_band = band
    child.save()
    _session, expected, _skipped = play_all(api(heart.a), child, band)
    assert expected  # the Heart has at least one puzzle whose skill is a catalog objective
    assert evidence_rows(child) == sorted(expected)
    rows = SkillEvidence.objects.filter(child=child)
    assert {r.evidence_type for r in rows} == {services.PUZZLE_EVIDENCE_TYPE}
    assert all(r.puzzle_attempt.child_id == child.pk for r in rows)
    assert all(r.observed_at == r.puzzle_attempt.submitted_at for r in rows)


def test_wrong_then_right_counts_as_one_exposure_each_and_a_supported_success(heart, api):
    child = heart.a1
    _session, expected, _skipped = play_all(api(heart.a), child)
    code = expected[0][1]
    attempts = [e for e in expected if e[1] == code]
    progress = SkillProgress.objects.get(child=child, learning_objective_code=code)
    assert progress.exposure_count == len(attempts)
    # Each puzzle was answered wrong first, so each success came after a miss: supported.
    assert progress.independent_success_count == 0
    assert progress.supported_success_count == sum(1 for e in attempts if e[2])


def test_mechanical_kinds_record_no_evidence(heart, api):
    child = heart.a1
    play_all(api(heart.a), child)
    mechanical = PuzzleAttempt.objects.filter(child=child).exclude(
        area_puzzle__kind__in=puzzles.SKILL_KINDS
    )
    assert mechanical.exists()
    assert not SkillEvidence.objects.filter(puzzle_attempt__in=mechanical).exists()


def test_an_unknown_objective_is_skipped_and_never_undoes_the_solve_or_reward(heart, api, caplog):
    child = heart.a1
    with caplog.at_level(logging.WARNING, logger="apps.education.services"):
        _session, _expected, skipped = play_all(api(heart.a), child)
    if not skipped:
        pytest.skip("every Heart puzzle skill is a catalog objective now")
    # The quest completed and every puzzle's world change and grant exist.
    assert QuestProgress.objects.get(child=child, quest__slug=QUEST).status == (
        QuestStatus.COMPLETED
    )
    keys = set(WorldChange.objects.filter(child=child).values_list("change_key", flat=True))
    assert {row[3]["worldChangeKey"] for row in content.puzzle_rows()} <= keys
    assert GrantedRule.objects.filter(child=child).exists()
    assert not SkillEvidence.objects.filter(learning_objective_code__in=skipped).exists()
    warned = " ".join(r.getMessage() for r in caplog.records)
    assert all(code in warned for code in skipped)
    # The diagnostic names content, never the child.
    assert str(child.pk) not in warned and child.nickname not in warned


def test_replays_and_practice_regrades_record_nothing_more(heart, api):
    child = heart.a1
    client = api(heart.a)
    session, _expected, _skipped = play_all(client, child)
    before = SkillEvidence.objects.filter(child=child).count()
    progress_before = list(
        SkillProgress.objects.filter(child=child).values_list("exposure_count", flat=True)
    )
    for puzzle_id, kind, _e, body in content.puzzle_rows():
        params = body["ageBands"]["PATHFINDER"]
        solve(client, child, session, puzzle_id, right_answer(kind, params))
        wrong = wrong_answer(kind, params)
        if wrong:
            solve(client, child, session, puzzle_id, wrong)
    assert SkillEvidence.objects.filter(child=child).count() == before
    assert (
        list(SkillProgress.objects.filter(child=child).values_list("exposure_count", flat=True))
        == progress_before
    )


def test_recording_the_same_attempt_twice_writes_once(heart, api):
    child = heart.a1
    play_all(api(heart.a), child)
    evidence = SkillEvidence.objects.filter(child=child).select_related("puzzle_attempt").first()
    progress = SkillProgress.objects.get(
        child=child, learning_objective_code=evidence.learning_objective_code
    )
    outcome = services.record_puzzle_evidence(
        evidence.puzzle_attempt, evidence.learning_objective_code, failed_before=0
    )
    assert outcome is services.PuzzleEvidence.ALREADY_RECORDED
    assert SkillEvidence.objects.filter(puzzle_attempt=evidence.puzzle_attempt).count() == 1
    progress.refresh_from_db()
    assert (
        progress.exposure_count
        == SkillEvidence.objects.filter(
            child=child, learning_objective_code=evidence.learning_objective_code
        ).count()
    )


def test_an_unexpected_failure_is_not_swallowed_and_rolls_the_attempt_back(heart, api, monkeypatch):
    """Only the expected gaps are skipped: a database error while writing evidence fails the
    request, and the attempt and world change roll back with it (nothing half-recorded)."""
    child = heart.a1
    client = api(heart.a)
    session = start(client, child)
    pid, kind, _e, body = content.puzzle_rows()[0]

    def broken(evidence):
        raise DatabaseError("simulated")

    # Make the first puzzle resolve to a catalog objective, then break the evidence write.
    monkeypatch.setattr(puzzles, "skill_for", lambda *args: "patterns")
    monkeypatch.setattr(services, "apply_evidence", broken)
    response = solve(
        client, child, session, pid, right_answer(kind, body["ageBands"]["PATHFINDER"])
    )
    assert response.status_code >= 500
    assert not PuzzleAttempt.objects.filter(child=child).exists()
    assert not SkillEvidence.objects.filter(child=child).exists()
    assert not WorldChange.objects.filter(child=child).exists()


# --- Integrity ------------------------------------------------------------------------------------


def test_a_row_cannot_name_two_sources(heart, api):
    child = heart.a1
    play_all(api(heart.a), child)
    evidence = SkillEvidence.objects.filter(child=child).first()
    with pytest.raises(IntegrityError), transaction.atomic():
        SkillEvidence.objects.filter(pk=evidence.pk).update(
            adventure_session=evidence.puzzle_attempt.session
        )


def test_evidence_cannot_point_at_another_childs_attempt(heart, api):
    play_all(api(heart.a), heart.a1)
    attempt = PuzzleAttempt.objects.filter(child=heart.a1).first()
    with pytest.raises(CrossChildReference):
        SkillEvidence.objects.create(
            child=heart.b1,
            puzzle_attempt=attempt,
            learning_objective_code="patterns",
            evidence_type=services.PUZZLE_EVIDENCE_TYPE,
            result=Correctness.CORRECT,
            support_level=0,
            observed_at=attempt.submitted_at,
        )


# --- Parent dashboard -----------------------------------------------------------------------------


def test_the_dashboard_counts_puzzle_evidence_once_and_only_for_the_owner(heart, api):
    child = heart.a1
    _session, expected, _skipped = play_all(api(heart.a), child)
    by_code: dict[str, list[int]] = {}
    for _pid, code, correct, _support in expected:
        tally = by_code.setdefault(code, [0, 0])
        tally[0] += 1
        tally[1] += int(correct)
    assert practice_summary(child) == [
        {"objective_code": code, "attempts": a, "correct": c}
        for code, (a, c) in sorted(by_code.items())
    ]

    url = f"{base(child)}skill-progress/"
    skills = api(heart.a).get(url).json()["skills"]
    assert {s["learningObjectiveCode"]: s["exposureCount"] for s in skills} == {
        code: a for code, (a, _c) in by_code.items()
    }
    assert api(heart.b).get(url).status_code == 404  # another family
    assert api(heart.a).get(f"{base(heart.a2)}skill-progress/").json() == {"skills": []}


# --- Diagnostics ----------------------------------------------------------------------------------


def test_the_report_lists_each_unmapped_puzzle_skill_with_content_only(heart):
    known = set(LearningObjective.objects.values_list("code", flat=True))
    rows = services.puzzle_skill_report()
    named = {
        (pid, band, params.get("skill"))
        for pid, kind, _e, body in content.puzzle_rows()
        if kind in puzzles.SKILL_KINDS
        for band, params in body["ageBands"].items()
    }
    assert {(r["puzzle"], r["band"], r["code"]) for r in rows if r["variant"] is None} == {
        n for n in named if n[2] not in known
    }
    assert all(set(r) == {"region", "puzzle", "band", "variant", "code"} for r in rows)


def test_the_report_command_fails_in_strict_mode_only_when_something_is_unmapped(heart):
    from io import StringIO

    from django.core.management.base import CommandError

    out = StringIO()
    call_command("puzzle_skill_report", stdout=out)
    unmapped = len(services.puzzle_skill_report())
    assert f"{unmapped} unmapped puzzle skill(s)." in out.getvalue()
    if unmapped:
        with pytest.raises(CommandError):
            call_command("puzzle_skill_report", "--strict", stdout=StringIO())


def test_adding_the_missing_objective_clears_it_from_the_report(heart):
    """Adding the objective is enough: no puzzle content change is needed."""
    rows = services.puzzle_skill_report()
    if not rows:
        pytest.skip("nothing is unmapped")
    code = rows[0]["code"]
    existing = LearningObjective.objects.first()  # borrow the imported release
    LearningObjective.objects.create(
        code=code,
        domain="numeracy",
        title="Test objective",
        source={},
        last_seen_release=existing.last_seen_release,
    )
    assert code not in {r["code"] for r in services.puzzle_skill_report()}


def test_with_no_published_puzzles_the_report_is_empty(db):
    assert services.puzzle_skill_report() == []


# --- A variant override next to chest evidence (Treasure Cove) -----------------------------------


@pytest.fixture
def cove_quiz(treasure):
    """Treasure Cove with one published CHOOSE_ANSWER whose second variant names its own skill."""
    from apps.core.content_status import ContentStatus
    from apps.regions.models import AreaPuzzle, PlacementKind, PuzzleKind, WorldObjectPlacement
    from apps.regions.seeding import seed_puzzle
    from apps.regions.tests.test_puzzle_kinds import CHOOSE, CHOOSE_ENTITIES, edited
    from apps.regions.tests.test_puzzles import puzzle_body

    for index, entity in enumerate(CHOOSE_ENTITIES):
        WorldObjectPlacement.objects.create(
            region=treasure.region, entity_id=entity, kind=PlacementKind.PROP, x=index, z=-3
        )
    params = edited(CHOOSE, lambda p: p["variants"][1].update(skill="addition-within-ten"))
    seed_puzzle(
        treasure.region,
        puzzle_id="choose",
        kind=PuzzleKind.CHOOSE_ANSWER,
        entity_ids=CHOOSE_ENTITIES,
        body=puzzle_body("choose", PuzzleKind.CHOOSE_ANSWER, "COVE_CHOSE", params),
    )
    # Only this puzzle: the cove's own stages (#102) would open the chest this test quizzes.
    AreaPuzzle.objects.filter(puzzle_id="choose").update(status=ContentStatus.PUBLISHED)
    return treasure


def test_the_answered_variants_skill_is_recorded_next_to_chest_evidence(cove_quiz, api):
    from apps.game_sessions.play import (
        issue_chest_challenge,
        start_or_resume_region_session,
        submit_chest_answer,
    )

    treasure = cove_quiz
    child = treasure.families.a1
    client = api(treasure.families.a)
    region_session, _ = start_or_resume_region_session(child, treasure.region)
    chest, _ = issue_chest_challenge(region_session, treasure.chest, seed=3)
    submit_chest_answer(child, chest.pk, chest.answer, hint_level=0, duration_ms=900)
    assert chest.skill_id == "addition-within-ten"

    session = str(region_session.pk)
    # v1 names no skill of its own: the band's `addition-within-10` is not a catalog code.
    assert (
        solve(client, child, session, "choose", {"variantId": "v1", "choice": "a"}).json()[
            "correct"
        ]
        is False
    )
    # v2 overrides it with a catalog objective, the same one the chest practises.
    assert solve(client, child, session, "choose", {"variantId": "v2", "choice": "a"}).json()[
        "solvedNow"
    ]

    puzzle_rows = SkillEvidence.objects.filter(child=child, puzzle_attempt__isnull=False)
    assert [(r.learning_objective_code, r.result) for r in puzzle_rows] == [
        ("addition-within-ten", Correctness.CORRECT)
    ]
    chest_row = SkillEvidence.objects.get(challenge_attempt=chest)
    assert (chest_row.evidence_type, chest_row.learning_objective_code) == (
        "CHALLENGE",
        "addition-within-ten",
    )
    summary = {r["objective_code"]: r for r in practice_summary(child)}
    assert summary["addition-within-ten"] == {
        "objective_code": "addition-within-ten",
        "attempts": 2,
        "correct": 2,
    }
    progress = SkillProgress.objects.get(child=child, learning_objective_code="addition-within-ten")
    # The chest was first-time right (independent); the puzzle came after a miss (supported).
    assert (progress.exposure_count, progress.supported_success_count) == (2, 1)
