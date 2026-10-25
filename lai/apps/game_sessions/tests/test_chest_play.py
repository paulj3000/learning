"""Challenge attempts and opening a chest (TR-4): snapshots, grading, replay, rollback."""

import uuid

import pytest
from django.db import IntegrityError, transaction

from apps.core.content_status import ContentStatus
from apps.core.models import CrossChildReference
from apps.education.challenges import InvalidAnswer, generate_challenge, public_challenge
from apps.education.models import ChallengeSpec, SkillEvidence
from apps.game_sessions.models import Correctness as EvidenceResult
from apps.game_sessions import play as services
from apps.game_sessions.models import (
    AttemptStatus,
    ChallengeAttempt,
    ImmutableRecord,
    SessionStatus,
)
from apps.game_sessions.play import (
    AttemptAlreadyAnswered,
    AttemptNotFound,
    ChestAlreadyOpen,
    ContentUnavailable,
    SessionNotOpen,
    chest_is_open,
    end_session,
    issue_chest_challenge,
    start_or_resume_region_session,
    submit_chest_answer,
)
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import WorldChange
from apps.quests.models import QuestStatus
from apps.quests.services import start_quest

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def play(treasure, child=None, seed=7):
    child = child or treasure.families.a1
    session, _ = start_or_resume_region_session(child, treasure.region)
    attempt, _ = issue_chest_challenge(session, treasure.chest, seed=seed)
    return child, session, attempt


def wrong(attempt) -> int:
    return next(choice for choice in attempt.choices if choice != attempt.answer)


def progress_counts(child_or_id) -> dict:
    child_id = getattr(child_or_id, "pk", child_or_id)
    return {
        "world_changes": WorldChange.objects.filter(child_id=child_id).count(),
        "items": InventoryItem.objects.filter(child_id=child_id).count(),
        "grants": GrantedRule.objects.filter(child_id=child_id).count(),
        "evidence": SkillEvidence.objects.filter(child_id=child_id).count(),
    }


# --- Issuing --------------------------------------------------------------------------------


def test_the_attempt_snapshots_what_was_shown_and_how(treasure):
    child, session, attempt = play(treasure, seed=1234)
    spec = treasure.chest.challenge_for(child.age_band)
    expected = generate_challenge(spec.parameters(), child.age_band, 1234)
    assert attempt.challenge() == expected
    assert (attempt.challenge_spec_slug, attempt.age_band, attempt.skill_id) == (
        "treasure-cove-pathfinder",
        "PATHFINDER",
        "addition-within-ten",
    )
    assert (attempt.min_value, attempt.max_value, attempt.response_mode, attempt.choice_count) == (
        spec.min_value,
        spec.max_value,
        spec.response_mode,
        spec.choice_count,
    )
    assert (attempt.region_id, attempt.target_entity_id) == ("treasure-rush-cove", "cove-chest")
    assert attempt.status == AttemptStatus.ISSUED and attempt.attempt_number == 1
    assert "answer" not in public_challenge(attempt.challenge())


def test_asking_again_returns_the_outstanding_challenge(treasure):
    _, session, attempt = play(treasure)
    again, created = issue_chest_challenge(session, treasure.chest, seed=999)
    assert not created and again.pk == attempt.pk and again.seed == attempt.seed


def test_the_server_chooses_the_seed(treasure):
    session, _ = start_or_resume_region_session(treasure.families.a1, treasure.region)
    attempt, _ = issue_chest_challenge(session, treasure.chest)
    assert 0 <= attempt.seed < services.SEED_LIMIT


def test_a_wrong_answer_leads_to_a_new_numbered_attempt(treasure):
    child, session, first = play(treasure)
    submit_chest_answer(child, first.pk, wrong(first))
    second, created = issue_chest_challenge(session, treasure.chest, seed=8)
    assert created and second.attempt_number == 2


def test_history_survives_editing_the_spec(treasure):
    child, _, attempt = play(treasure)
    spec = ChallengeSpec.objects.get(slug=attempt.challenge_spec_slug)
    spec.choice_count = 2
    spec.save()
    attempt.refresh_from_db()
    assert attempt.choice_count == 4 and len(attempt.choices) == 4
    outcome = submit_chest_answer(child, attempt.pk, attempt.answer)
    assert outcome.correct


@pytest.mark.parametrize("status", [ContentStatus.DRAFT, ContentStatus.RETIRED])
def test_an_unpublished_challenge_is_not_issued(treasure, status):
    ChallengeSpec.objects.filter(slug="treasure-cove-pathfinder").update(status=status)
    session, _ = start_or_resume_region_session(treasure.families.a1, treasure.region)
    with pytest.raises(ContentUnavailable):
        issue_chest_challenge(session, treasure.chest)


def test_a_band_without_a_challenge_cannot_open_the_chest(treasure):
    treasure.chest.pathfinder_challenge = None
    treasure.chest.save()
    session, _ = start_or_resume_region_session(treasure.families.a1, treasure.region)
    with pytest.raises(ContentUnavailable):
        issue_chest_challenge(session, treasure.chest)


def test_no_challenge_in_a_closed_session(treasure):
    session, _ = start_or_resume_region_session(treasure.families.a1, treasure.region)
    end_session(session)
    session.refresh_from_db()
    with pytest.raises(SessionNotOpen):
        issue_chest_challenge(session, treasure.chest)


# --- Snapshot and outcome integrity -------------------------------------------------------------


def test_snapshot_fields_cannot_be_rewritten(treasure):
    _, _, attempt = play(treasure)
    attempt.answer = attempt.answer + 1
    with pytest.raises(ImmutableRecord):
        attempt.save()


def test_an_answered_attempt_cannot_be_changed(treasure):
    child, _, attempt = play(treasure)
    submit_chest_answer(child, attempt.pk, wrong(attempt))
    attempt.refresh_from_db()
    attempt.correctness = "correct"
    with pytest.raises(ImmutableRecord):
        attempt.save()


@pytest.mark.parametrize(
    "fields",
    [
        {"correctness": "correct"},  # an outcome without an answer
        {"status": AttemptStatus.ANSWERED},  # answered without an outcome
        {"attempt_number": 0},
    ],
)
def test_the_database_refuses_inconsistent_attempts(treasure, fields):
    _, _, attempt = play(treasure)
    with pytest.raises(IntegrityError), transaction.atomic():
        ChallengeAttempt.objects.filter(pk=attempt.pk).update(**fields)


def test_the_database_allows_one_outstanding_attempt_per_chest(treasure):
    _, _, attempt = play(treasure)
    duplicate = ChallengeAttempt.objects.get(pk=attempt.pk)
    duplicate.pk = uuid.uuid4()
    duplicate._state.adding = True
    duplicate._loaded = None
    duplicate.attempt_number = 2
    with pytest.raises(IntegrityError), transaction.atomic():
        duplicate.save()


def test_an_attempt_cannot_point_at_another_childs_session(treasure):
    _, _, attempt = play(treasure)
    other_session, _ = start_or_resume_region_session(treasure.families.b1, treasure.region)
    stray = ChallengeAttempt.objects.get(pk=attempt.pk)
    stray.pk = uuid.uuid4()
    stray._state.adding = True
    stray._loaded = None
    stray.session = other_session
    with pytest.raises(CrossChildReference):
        stray.save()


# --- Answering ---------------------------------------------------------------------------------


def test_a_wrong_answer_is_recorded_and_opens_nothing(treasure):
    child, _, attempt = play(treasure)
    outcome = submit_chest_answer(child, attempt.pk, wrong(attempt), hint_level=1, duration_ms=900)
    attempt.refresh_from_db()
    assert not outcome.correct and not outcome.chest_opened and outcome.reward is None
    assert attempt.status == AttemptStatus.ANSWERED and attempt.correctness == "incorrect"
    assert attempt.submitted_answer == wrong(attempt) and attempt.answered_at is not None
    assert (attempt.hint_level, attempt.duration_ms) == (1, 900)
    evidence = SkillEvidence.objects.get(challenge_attempt=attempt)
    assert evidence.result == EvidenceResult.INCORRECT and evidence.support_level == 1
    assert not chest_is_open(child, treasure.chest)
    assert progress_counts(child) == {"world_changes": 0, "items": 0, "grants": 0, "evidence": 1}


def test_the_right_answer_opens_the_chest_grants_the_keepsake_and_completes_the_quest(treasure):
    child = treasure.families.a1
    start_quest(child, treasure.quest)
    _, session, attempt = play(treasure, child)
    outcome = submit_chest_answer(child, attempt.pk, attempt.answer)

    assert outcome.correct and outcome.chest_opened
    assert outcome.reward.granted and outcome.reward.new_item_ids == ("golden-doubloon",)
    change = WorldChange.objects.get(child=child)
    assert (change.location_slug, change.change_key, change.change_type) == (
        "pirate-builder-bay",
        "TREASURE_RUSH_COVE_CHEST_OPENED",
        "UNLOCK",
    )
    assert change.source_session_id == str(session.pk)
    assert change.payload == {"regionId": "treasure-rush-cove", "entityId": "cove-chest"}
    [update] = outcome.quest_updates
    assert update.result.just_completed
    assert update.progress.status == QuestStatus.COMPLETED
    assert SkillEvidence.objects.get(challenge_attempt=attempt).result == EvidenceResult.CORRECT
    assert chest_is_open(child, treasure.chest)


def test_a_replayed_submission_is_refused_and_grants_nothing_twice(treasure):
    child, _, attempt = play(treasure)
    submit_chest_answer(child, attempt.pk, attempt.answer)
    before = progress_counts(child)
    with pytest.raises(AttemptAlreadyAnswered):
        submit_chest_answer(child, attempt.pk, attempt.answer)
    assert progress_counts(child) == before


def test_an_open_chest_issues_no_more_challenges_even_in_a_later_session(treasure):
    child, session, attempt = play(treasure)
    submit_chest_answer(child, attempt.pk, attempt.answer)
    end_session(session)
    later, _ = start_or_resume_region_session(child, treasure.region)
    with pytest.raises(ChestAlreadyOpen):
        issue_chest_challenge(later, treasure.chest)


@pytest.mark.parametrize("raw", [True, "3", 3.0, None, 99])
def test_malformed_answers_write_nothing_and_keep_the_attempt_open(treasure, raw):
    child, _, attempt = play(treasure)
    with pytest.raises(InvalidAnswer):
        submit_chest_answer(child, attempt.pk, raw)
    attempt.refresh_from_db()
    assert attempt.status == AttemptStatus.ISSUED
    assert progress_counts(child)["evidence"] == 0


def test_another_childs_attempt_looks_like_no_attempt(treasure):
    _, _, attempt = play(treasure)
    intruder = treasure.families.b1
    with pytest.raises(AttemptNotFound):
        submit_chest_answer(intruder, attempt.pk, attempt.answer)
    with pytest.raises(AttemptNotFound):
        submit_chest_answer(treasure.families.a2, attempt.pk, attempt.answer)  # a sibling too
    attempt.refresh_from_db()
    assert attempt.status == AttemptStatus.ISSUED
    assert progress_counts(intruder) == {"world_changes": 0, "items": 0, "grants": 0, "evidence": 0}


@pytest.mark.parametrize("attempt_id", [uuid.uuid4(), "not-a-uuid"])
def test_an_unknown_attempt_is_not_found(treasure, attempt_id):
    with pytest.raises(AttemptNotFound):
        submit_chest_answer(treasure.families.a1, attempt_id, 3)


def test_one_childs_chest_is_not_anothers(treasure):
    child, _, attempt = play(treasure)
    submit_chest_answer(child, attempt.pk, attempt.answer)
    sibling = treasure.families.a2
    assert not chest_is_open(sibling, treasure.chest)
    _, _, sibling_attempt = play(treasure, sibling)
    assert sibling_attempt.attempt_number == 1


def test_no_answer_after_the_session_closed(treasure):
    child, session, attempt = play(treasure)
    end_session(session, SessionStatus.ABANDONED)
    with pytest.raises(SessionNotOpen):
        submit_chest_answer(child, attempt.pk, attempt.answer)


# --- All or nothing ------------------------------------------------------------------------------


def test_a_failure_part_way_keeps_nothing_and_the_attempt_can_be_answered_again(
    treasure, monkeypatch
):
    child, _, attempt = play(treasure)

    def broken(*args, **kwargs):
        raise RuntimeError("reward store unavailable")

    monkeypatch.setattr(services, "grant_reward_rule", broken)
    with pytest.raises(RuntimeError):
        submit_chest_answer(child, attempt.pk, attempt.answer)
    attempt.refresh_from_db()
    assert attempt.status == AttemptStatus.ISSUED
    assert progress_counts(child) == {"world_changes": 0, "items": 0, "grants": 0, "evidence": 0}

    monkeypatch.undo()
    assert submit_chest_answer(child, attempt.pk, attempt.answer).chest_opened


def test_a_chest_deleted_after_the_challenge_was_shown_opens_nothing(treasure):
    child, _, attempt = play(treasure)
    treasure.chest.delete()
    attempt.refresh_from_db()
    assert attempt.chest_id is None and attempt.target_entity_id == "cove-chest"
    with pytest.raises(ContentUnavailable):
        submit_chest_answer(child, attempt.pk, attempt.answer)
    attempt.refresh_from_db()
    assert attempt.status == AttemptStatus.ISSUED
    assert progress_counts(child)["world_changes"] == 0


def test_deleting_a_child_removes_their_progress_only(treasure):
    child, _, attempt = play(treasure)
    submit_chest_answer(child, attempt.pk, attempt.answer)
    _, _, other = play(treasure, treasure.families.b1)
    submit_chest_answer(treasure.families.b1, other.pk, other.answer)
    child_id = child.pk
    child.delete()
    assert progress_counts(child_id) == {"world_changes": 0, "items": 0, "grants": 0, "evidence": 0}
    assert not ChallengeAttempt.objects.filter(child_id=child_id).exists()
    assert progress_counts(treasure.families.b1)["items"] == 1
