"""Owner-QA acceptance coverage for AI Question Studio (QA 2026-11-07, card "[Subproject] AI
Question Studio"). Fills the gaps the AQS-023 suite left and holds the regression tests for the
defects found in the QA pass:

- QA-AQS-D1: a retired or superseded question could be edited back to DRAFT and republished,
  leaving two ACTIVE revisions (the original beside its correction).
- QA-AQS-D2: the serve path ignored the grade's number range (only a validation warning), so a
  Grade K "30 + 20" was served to a Sprout.

The model is always the deterministic fake here; live Bedrock is AQS-025 and is not simulated.
"""

import logging

import pytest
from django.test import Client
from django.urls import reverse

from apps.ai.providers.base import ProviderError
from apps.ai.providers.fake import FakeModelClient
from apps.game_sessions.play import issue_chest_challenge, start_or_resume_region_session
from apps.question_studio import contracts, generation, selection, taxonomy, validation, workflow
from apps.question_studio.models import (
    BatchStatus,
    Question,
    QuestionPool,
    QuestionRevision,
    ReviewStatus,
    RevisionStatus,
    ValidationStatus,
)
from apps.users.models import AgeBand

from .conftest import make_question, params, publish_questions

pytestmark = pytest.mark.django_db

REGION, CHEST = "treasure-rush-cove", "cove-chest"


def login(user):
    client = Client()
    client.force_login(user, backend="apps.users.backends.AdminPasswordBackend")
    return client


def url(name, *args):
    return reverse(f"admin:question_studio_{name}", args=args)


def published(reviewer, publisher, **overrides):
    q = make_question(**overrides)
    validation.run_validation(q)
    workflow.approve(q, reviewer)
    return q, workflow.publish(q, publisher)


def item(**overrides):
    base = {
        "stem": "What is 4 x 5?",
        "difficulty": "EASY",
        "choices": [
            {"id": "A", "text": "20"},
            {"id": "B", "text": "21"},
            {"id": "C", "text": "19"},
        ],
        "correctAnswer": "A",
        "acceptedAnswers": [],
        "operation": "MULTIPLY",
        "operands": [4, 5],
        "hint": "Count in fours.",
        "explanation": "Five fours make twenty.",
    }
    base.update(overrides)
    return base


# --- Taxonomy, age bands and difficulty ---------------------------------------------------------


def test_every_grade_maps_to_at_least_one_band_and_bands_are_ordered():
    for grade in taxonomy.Grade.values:
        assert taxonomy.bands_for_grade(grade), grade
    assert taxonomy.bands_for_grade("K") == {AgeBand.SPROUT, AgeBand.PATHFINDER}
    assert AgeBand.SPROUT not in taxonomy.bands_for_grade("1")
    assert taxonomy.bands_for_grade("3") == {AgeBand.EXPLORER}
    assert taxonomy.bands_for_grade("not-a-grade") == frozenset()


@pytest.mark.parametrize(
    "overrides, code",
    [
        ({"subject": "HISTORY"}, "unknown_subject"),
        ({"topic": "vocabulary"}, "unknown_topic"),  # a READING topic under MATH
        ({"grade": "13"}, "unknown_grade"),
        ({"difficulty": "IMPOSSIBLE"}, "unknown_difficulty"),
        ({"question_type": "ESSAY"}, "unknown_question_type"),
        ({"count": 0}, "count_below_one"),
        ({"notes": "x" * 201}, "notes_too_long"),
    ],
)
def test_invalid_generation_input_is_refused_with_a_stable_code(author, fake, overrides, code):
    with pytest.raises(contracts.InvalidGenerationRequest) as refused:
        generation.create_batch(author, params(**overrides))
    assert code in refused.value.codes
    assert not fake.requests


@pytest.mark.parametrize("difficulty", ["EASY", "MEDIUM", "HARD"])
def test_each_requested_difficulty_is_stored_concretely(author, fake, difficulty):
    batch = generation.run_batch(
        generation.create_batch(author, params(count=2, difficulty=difficulty)).pk
    )
    stored = set(Question.objects.filter(batch=batch).values_list("difficulty", flat=True))
    assert stored == {difficulty}


def test_mixed_difficulty_never_reaches_a_stored_question(author, fake):
    batch = generation.run_batch(generation.create_batch(author, params(count=5)).pk)
    stored = set(Question.objects.filter(batch=batch).values_list("difficulty", flat=True))
    assert stored and stored <= set(taxonomy.Difficulty.values)


# --- Generation and persistence ------------------------------------------------------------------


def test_generated_drafts_carry_full_provenance_and_are_not_playable(author, fake):
    batch = generation.run_batch(generation.create_batch(author, params(count=3)).pk)
    assert batch.status == BatchStatus.COMPLETED and batch.finished_at
    assert batch.prompt_version and batch.schema_version == contracts.OUTPUT_SCHEMA_VERSION
    for q in Question.objects.filter(batch=batch):
        assert q.review_status == ReviewStatus.NEEDS_REVIEW
        assert q.source_model == batch.model_id and q.generated_at and q.content_hash
        assert q.events.filter(action="generated", actor=author).exists()
        assert q.findings.filter(run=q.validation_run).exists()
    assert not QuestionRevision.objects.exists()


def test_unsafe_generated_content_is_stored_failing_and_cannot_be_published(
    author, reviewer, publisher
):
    unsafe = [
        item(stem="What is 4 x 5? Visit www.example.com to check", operands=[4, 5]),
        item(
            stem="What is 3 x 5?",
            operands=[3, 5],
            hint="Tell me your home address first.",
            choices=[{"id": "A", "text": "15"}, {"id": "B", "text": "16"}],
        ),
    ]
    client = FakeModelClient([{"questions": unsafe}])
    batch = generation.run_batch(generation.create_batch(author, params(count=2)).pk, client=client)
    drafts = list(Question.objects.filter(batch=batch))
    assert len(drafts) == 2
    for q in drafts:
        assert (
            q.validation_status == ValidationStatus.FAIL and q.review_status == ReviewStatus.DRAFT
        )
        codes = set(validation.latest_findings(q).values_list("code", flat=True))
        assert codes & {"unsafe_url", "unsafe_personal_information"}, codes
        with pytest.raises(workflow.BlockedByValidation):
            workflow.approve(q, reviewer)
        with pytest.raises(workflow.InvalidTransition):
            workflow.publish(q, publisher)
    assert not QuestionRevision.objects.exists()


# --- Failures, retries and provider errors ----------------------------------------------------


@pytest.mark.parametrize("category", ["THROTTLED", "UNAVAILABLE"])
def test_retryable_provider_errors_are_retried_once_then_succeed(author, category):
    client = FakeModelClient([ProviderError(category)])
    batch = generation.run_batch(generation.create_batch(author, params(count=2)).pk, client=client)
    assert batch.status == BatchStatus.COMPLETED and batch.attempts == 2
    assert batch.failure_category == ""


@pytest.mark.parametrize("category", ["ACCESS_DENIED", "CONFIGURATION"])
def test_setup_errors_fail_fast_store_nothing_and_never_publish(author, settings, category):
    settings.LAI_STUDIO_CHUNK_SIZE = 2
    client = FakeModelClient([ProviderError(category)] * 5)
    batch = generation.run_batch(generation.create_batch(author, params(count=6)).pk, client=client)
    assert batch.status == BatchStatus.FAILED and batch.failure_category == category
    assert len(client.requests) == 1  # no retry, and the other chunks are not attempted
    assert not Question.objects.filter(batch=batch).exists()


def test_batch_logs_never_contain_staff_notes_or_question_text(author, fake, caplog):
    secret_note = "pirate-themed-note-abc123"
    with caplog.at_level(logging.DEBUG):
        batch = generation.create_batch(author, params(count=2, notes=secret_note))
        generation.run_batch(batch.pk)
    text = caplog.text
    assert "studio.batch" in text
    assert secret_note not in text
    for stem in Question.objects.filter(batch=batch).values_list("stem", flat=True):
        assert stem not in text


# --- Admin approval and rejection, permissions -------------------------------------------------


def post_action(client, action, *questions):
    return client.post(
        url("question_changelist"),
        {"action": action, "_selected_action": [str(q.pk) for q in questions]},
        follow=True,
    )


def test_admin_reject_records_reviewer_and_blocks_publishing(reviewer, publisher):
    q = make_question()
    validation.run_validation(q)
    response = post_action(login(reviewer), "action_reject", q)
    assert b"1 question(s) rejected" in response.content
    q.refresh_from_db()
    assert q.review_status == ReviewStatus.REJECTED and q.reviewed_by == reviewer and q.reviewed_at
    assert q.events.filter(action="rejected", actor=reviewer).exists()
    post_action(login(publisher), "action_publish", q)
    assert not QuestionRevision.objects.exists()


def test_an_author_cannot_approve_by_posting_the_action(author):
    q = make_question()
    validation.run_validation(q)
    post_action(login(author), "action_approve", q)
    q.refresh_from_db()
    assert q.review_status == ReviewStatus.DRAFT


def test_anonymous_and_non_staff_are_kept_out_of_the_studio(nobody):
    from apps.core.tests.test_django_admin import make_admin

    anonymous = Client().get(url("question_changelist"))
    assert anonymous.status_code == 302 and "login" in anonymous["Location"]
    parent, _ = make_admin("parent-not-staff")
    type(parent).objects.filter(pk=parent.pk).update(is_staff=False)
    parent.refresh_from_db()
    for user in (parent, nobody):
        response = login(user).get(url("question_changelist"))
        assert response.status_code in (302, 403)
        assert login(user).get(url("generationbatch_add")).status_code in (302, 403)


# --- Publishing, unpublishing and versions ------------------------------------------------------


def test_publish_then_retire_moves_a_question_in_and_out_of_play(reviewer, publisher, objective):
    QuestionPool.objects.create(
        name="p", enabled=True, region_id=REGION, entity_id=CHEST, grade="3", min_pool_size=1
    )
    q, revision = published(reviewer, publisher)
    pool = selection.pool_for(REGION, CHEST)
    assert [r for r, _ in selection.eligible_revisions(pool, "EXPLORER")] == [revision]
    workflow.retire(revision, publisher, note="QA unpublish")
    revision.refresh_from_db()
    q.refresh_from_db()
    assert revision.status == RevisionStatus.RETIRED and revision.retired_at
    assert q.review_status == ReviewStatus.REJECTED
    assert selection.eligible_revisions(pool, "EXPLORER") == []


def test_a_correction_is_a_new_versioned_lineage_and_the_old_revision_is_kept(
    author, reviewer, publisher
):
    q, first = published(reviewer, publisher)
    fix = workflow.start_correction(q, author)
    fix = workflow.edit(fix, author, {"hint": "Think of six groups of seven."})
    workflow.approve(fix, reviewer)
    second = workflow.publish(fix, publisher)
    first.refresh_from_db()
    assert first.status == RevisionStatus.SUPERSEDED and first.content["hint"] == "Count in sixes."
    assert second.status == RevisionStatus.ACTIVE and second.question.replaces_id == q.pk
    assert QuestionRevision.objects.filter(status=RevisionStatus.ACTIVE).count() == 1


# QA-AQS-D1 regressions ---------------------------------------------------------------------------


def test_d1_a_retired_question_cannot_be_edited_back_into_the_workflow(author, reviewer, publisher):
    q, revision = published(reviewer, publisher)
    workflow.retire(revision, publisher)
    with pytest.raises(workflow.InvalidTransition):
        workflow.edit(q, author, {"hint": "Count by sixes again."})
    q.refresh_from_db()
    assert q.review_status == ReviewStatus.REJECTED
    with pytest.raises(workflow.InvalidTransition):
        workflow.reopen(q, reviewer)


def test_d1_a_superseded_original_cannot_be_republished_beside_its_correction(
    author, reviewer, publisher
):
    q, _ = published(reviewer, publisher)
    fix = workflow.start_correction(q, author)
    fix = workflow.edit(fix, author, {"hint": "Think of six groups."})
    workflow.approve(fix, reviewer)
    workflow.publish(fix, publisher)
    with pytest.raises(workflow.InvalidTransition):
        workflow.edit(q, author, {"explanation": "Six sevens are forty two."})
    assert QuestionRevision.objects.filter(status=RevisionStatus.ACTIVE).count() == 1


def test_d1_a_retired_question_page_is_view_only_in_the_admin(reviewer, publisher):
    q, revision = published(reviewer, publisher)
    workflow.retire(revision, publisher)
    client = login(publisher)
    page = client.get(url("question_change", q.pk))
    assert page.status_code == 200 and b'name="_save"' not in page.content
    client.post(url("question_change", q.pk), {"stem": "What is 6 x 9?", "hint": "x"})
    q.refresh_from_db()
    assert q.stem == "What is 6 x 7?" and q.review_status == ReviewStatus.REJECTED


def test_a_never_published_rejected_question_can_still_be_fixed(author, reviewer):
    q = make_question()
    validation.run_validation(q)
    workflow.reject(q, reviewer)
    fixed = workflow.edit(q, author, {"hint": "Count in sixes, slowly."})
    assert fixed.review_status == ReviewStatus.DRAFT


# --- Children never receive unapproved or out-of-band questions --------------------------------


def test_d2_a_grade_k_question_beyond_its_number_range_is_never_served_to_a_sprout(
    reviewer, publisher, objective
):
    q, revision = published(
        reviewer,
        publisher,
        grade="K",
        topic="addition",
        operation="ADD",
        operands=[30, 20],
        stem="What is 30 + 20?",
        choices=[{"id": "A", "text": "50"}, {"id": "B", "text": "40"}, {"id": "C", "text": "60"}],
        hint="Count on in tens.",
        explanation="Thirty and twenty make fifty.",
    )
    q.refresh_from_db()
    assert q.validation_status == ValidationStatus.WARNING  # approvable, so serving must refuse
    assert selection.to_challenge(revision, AgeBand.SPROUT) is None
    assert selection.to_challenge(revision, AgeBand.PATHFINDER) is None


def test_d2_in_range_questions_are_still_served(reviewer, publisher, objective):
    _, small = published(
        reviewer,
        publisher,
        grade="K",
        topic="addition",
        operation="ADD",
        operands=[2, 1],
        stem="What is 2 + 1?",
        choices=[{"id": "A", "text": "3"}, {"id": "B", "text": "4"}, {"id": "C", "text": "2"}],
        hint="Count on one.",
        explanation="Two and one make three.",
    )
    assert selection.to_challenge(small, AgeBand.SPROUT).answer == 3
    _, grade3 = published(reviewer, publisher)
    assert selection.to_challenge(grade3, AgeBand.EXPLORER).answer == 42


def test_band_mismatch_is_never_served_through_the_pool(reviewer, publisher, objective):
    """The grade-to-band gate lives in `eligible_revisions`, the only path gameplay uses."""
    published(reviewer, publisher)  # Grade 3: Explorers only
    pool = QuestionPool.objects.create(
        name="p", enabled=True, region_id=REGION, entity_id=CHEST, min_pool_size=1
    )
    assert len(selection.eligible_revisions(pool, AgeBand.EXPLORER)) == 1
    assert selection.eligible_revisions(pool, AgeBand.SPROUT) == []
    assert selection.eligible_revisions(pool, AgeBand.PATHFINDER) == []


# --- Treasure Rush: precedence and fallback ----------------------------------------------------


@pytest.mark.postgres
def test_published_bank_questions_take_precedence_over_the_authored_challenge(
    treasure, reviewer, publisher
):
    child = treasure.families.a1  # a Pathfinder
    QuestionPool.objects.create(
        name="cove addition",
        enabled=True,
        region_id=REGION,
        entity_id=CHEST,
        grade="1",
        min_pool_size=3,
    )
    publish_questions(
        reviewer,
        publisher,
        3,
        grade="1",
        topic="addition",
        operation="ADD",
        skill="addition-within-ten",
        start=1,
    )
    session, _ = start_or_resume_region_session(child, treasure.region)
    attempt, _ = issue_chest_challenge(session, treasure.chest)
    assert attempt.source == "BANK" and attempt.bank_revision_id


@pytest.mark.postgres
@pytest.mark.parametrize("action", ["draft", "approved", "rejected", "retired"])
def test_unplayable_questions_leave_the_authored_fallback_in_place(
    treasure, reviewer, publisher, action
):
    child = treasure.families.a1
    QuestionPool.objects.create(
        name="cove addition",
        enabled=True,
        region_id=REGION,
        entity_id=CHEST,
        grade="1",
        min_pool_size=1,
    )
    q = make_question(
        grade="1",
        topic="addition",
        operation="ADD",
        operands=[2, 3],
        skill_code="addition-within-ten",
        stem="What is 2 + 3?",
        choices=[{"id": "A", "text": "5"}, {"id": "B", "text": "6"}],
        hint="Count on.",
        explanation="Two and three make five.",
    )
    validation.run_validation(q)
    if action in ("approved", "retired"):
        workflow.approve(q, reviewer)
    if action == "rejected":
        workflow.reject(q, reviewer)
    if action == "retired":
        workflow.retire(workflow.publish(q, publisher), publisher)
    session, _ = start_or_resume_region_session(child, treasure.region)
    attempt, _ = issue_chest_challenge(session, treasure.chest)
    assert attempt.source != "BANK" and attempt.bank_revision_id is None
    assert attempt.challenge_spec_id is not None
