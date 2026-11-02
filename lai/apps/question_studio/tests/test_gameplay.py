"""Published questions in Treasure Rush: selection, grading, mastery, fallback (AQS-020 to 022)."""

import pytest

from apps.catalog.models import LearningObjective
from apps.education.challenges import MathChallenge, Operation, ResponseMode, public_challenge
from apps.education.models import SkillEvidence
from apps.game_sessions.models import AttemptStatus
from apps.game_sessions.play import (
    issue_chest_challenge,
    start_or_resume_region_session,
    submit_chest_answer,
)
from apps.progression.models import WorldChange
from apps.question_studio import selection, workflow
from apps.question_studio.models import (
    Question,
    QuestionPool,
    QuestionRevision,
    ReviewStatus,
    RevisionStatus,
)
from apps.question_studio.selection import to_challenge

from .conftest import make_question, params, publish_questions

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REGION = "treasure-rush-cove"
CHEST = "cove-chest"


def explorer(treasure):
    child = treasure.families.a1
    type(child).objects.filter(pk=child.pk).update(age_band="EXPLORER")
    child.refresh_from_db()
    return child


def pool(**overrides):
    base = dict(
        name="Cove multiplication",
        enabled=True,
        region_id=REGION,
        entity_id=CHEST,
        grade="3",
        min_pool_size=3,
    )
    base.update(overrides)
    return QuestionPool.objects.create(**base)


def issue(treasure, child):
    session, _ = start_or_resume_region_session(child, treasure.region)
    return session, issue_chest_challenge(session, treasure.chest)[0]


# --- the whole flow -----------------------------------------------------------------------------


def test_generate_review_publish_play_and_grade(
    treasure, author, reviewer, publisher, fake, objective
):
    """LAI-AQS-024 workflow 1 to 14, with the fake model standing in for Bedrock."""
    from apps.question_studio import generation

    batch = generation.create_batch(author, params(count=25))
    generation.run_batch(batch.pk)
    drafts = Question.objects.filter(batch=batch)
    assert drafts.count() == 25 and not QuestionRevision.objects.exists()

    # Unapproved questions cannot be served, even with a pool configured.
    pool()
    child = explorer(treasure)
    assert (
        selection.pick_bank_challenge(
            "EXPLORER", start_or_resume_region_session(child, treasure.region)[0], REGION, CHEST
        )
        is None
    )

    done, refused = workflow.bulk(workflow.approve, list(drafts), reviewer)
    assert len(done) == 25 and not refused
    done, refused = workflow.bulk(workflow.publish, done, publisher)
    assert len(done) == 25
    assert QuestionRevision.objects.filter(status=RevisionStatus.ACTIVE).count() == 25

    session, attempt = issue(treasure, child)
    assert attempt.source == "BANK" and attempt.bank_revision_id
    revision = QuestionRevision.objects.get(pk=attempt.bank_revision_id)
    assert revision.question.batch_id == batch.pk
    shown = public_challenge(attempt.challenge())
    assert (
        shown["operation"] == "MULTIPLY"
        and shown["responseMode"] == "CHOICE"
        and "answer" not in shown
    )
    assert attempt.skill_id == "multiplication-facts" and attempt.choice_count == len(
        attempt.choices
    )

    wrong = next(c for c in attempt.choices if c != attempt.answer)
    outcome = submit_chest_answer(child, attempt.pk, wrong)
    assert not outcome.correct and not WorldChange.objects.filter(child=child).exists()
    again = issue_chest_challenge(session, treasure.chest)[0]
    assert (
        again.pk != attempt.pk and again.bank_revision_id != attempt.bank_revision_id
    )  # no repeat
    outcome = submit_chest_answer(child, again.pk, again.answer)
    assert outcome.correct and outcome.chest_opened
    evidence = list(SkillEvidence.objects.filter(child=child).order_by("observed_at"))
    assert [e.learning_objective_code for e in evidence] == ["multiplication-facts"] * 2
    assert [e.result for e in evidence] == ["INCORRECT", "CORRECT"]


# --- only published, matching questions are served ---------------------------------------------


@pytest.mark.parametrize(
    "status",
    [ReviewStatus.DRAFT, ReviewStatus.NEEDS_REVIEW, ReviewStatus.APPROVED, ReviewStatus.REJECTED],
)
def test_questions_that_are_not_published_are_never_served(treasure, objective, status):
    pool()
    for index in range(4):
        make_question(
            stem=f"What is {index + 2} x 9?", operands=[index + 2, 9], review_status=status
        )
    child = explorer(treasure)
    session, _ = start_or_resume_region_session(child, treasure.region)
    assert selection.pick_bank_challenge("EXPLORER", session, REGION, CHEST) is None


def test_retired_and_superseded_revisions_are_not_served(treasure, objective, reviewer, publisher):
    pool(min_pool_size=1)
    first, second = publish_questions(reviewer, publisher, 2)
    workflow.retire(first, publisher)
    fix = workflow.start_correction(second.question, publisher)
    workflow.approve(fix, reviewer)
    workflow.publish(fix, publisher)
    served = {r.pk for r, _ in selection.eligible_revisions(QuestionPool.objects.get(), "EXPLORER")}
    assert served == {QuestionRevision.objects.get(question=fix).pk}


def test_grade_band_adventure_and_catalog_skill_filters(treasure, objective, reviewer, publisher):
    publish_questions(reviewer, publisher, 3, grade="3")
    p = pool(grade="")
    assert len(selection.eligible_revisions(p, "EXPLORER")) == 3
    assert selection.eligible_revisions(p, "PATHFINDER") == []  # grade 3 is for Explorers only
    assert (
        len(selection.eligible_revisions(pool(name="x", entity_id="", grade="4"), "EXPLORER")) == 0
    )
    LearningObjective.objects.all().delete()  # no evidence target: nothing is served
    assert selection.eligible_revisions(p, "EXPLORER") == []


def test_pool_by_adventure(treasure, objective, reviewer, publisher):
    from apps.catalog.models import Adventure

    adventure = Adventure.objects.first()
    publish_questions(reviewer, publisher, 3, adventure=adventure)
    publish_questions(reviewer, publisher, 3, start=20)
    assert len(selection.eligible_revisions(pool(adventure=adventure, grade=""), "EXPLORER")) == 3
    assert (
        len(selection.eligible_revisions(pool(name="all", entity_id="", grade=""), "EXPLORER")) == 6
    )


# --- fallback and existing behaviour ------------------------------------------------------------


def test_no_pool_means_the_authored_challenge_as_before(treasure, objective, reviewer, publisher):
    publish_questions(
        reviewer,
        publisher,
        5,
        grade="2",
        topic="addition",
        operation="ADD",
        skill="addition-within-ten",
    )
    session, attempt = issue(treasure, treasure.families.a1)  # a Pathfinder
    assert (
        attempt.source == "GENERATED" and attempt.challenge_spec_slug == "treasure-cove-pathfinder"
    )
    assert attempt.bank_revision_id is None


def test_a_disabled_or_too_small_pool_falls_back(treasure, objective, reviewer, publisher):
    publish_questions(
        reviewer,
        publisher,
        2,
        grade="2",
        topic="addition",
        operation="ADD",
        skill="addition-within-ten",
    )
    p = pool(grade="2", min_pool_size=3)
    assert issue(treasure, treasure.families.a1)[1].source == "GENERATED"  # 2 < 3
    QuestionPool.objects.filter(pk=p.pk).update(min_pool_size=1, enabled=False)
    assert issue(treasure, treasure.families.a1)[1].source == "GENERATED"  # disabled


def test_an_exhausted_pool_falls_back_instead_of_repeating(
    treasure, objective, reviewer, publisher
):
    publish_questions(
        reviewer,
        publisher,
        2,
        grade="2",
        topic="addition",
        operation="ADD",
        skill="addition-within-ten",
        start=2,
    )
    pool(grade="2", min_pool_size=1)
    child = treasure.families.a1
    session, _ = start_or_resume_region_session(child, treasure.region)
    seen = []
    for _ in range(3):
        attempt, _ = issue_chest_challenge(session, treasure.chest)
        seen.append((attempt.source, attempt.bank_revision_id))
        submit_chest_answer(child, attempt.pk, wrong_answer(attempt))
    assert [s for s, _ in seen] == ["BANK", "BANK", "GENERATED"]
    assert len({r for _, r in seen if r}) == 2


def wrong_answer(attempt):
    return next(c for c in attempt.choices if c != attempt.answer)


def test_exact_chest_pool_beats_the_region_pool(treasure, objective, reviewer, publisher):
    broad = pool(name="region", entity_id="", grade="")
    exact = pool(name="chest")
    assert (
        selection.pool_for(REGION, CHEST) == exact and selection.pool_for(REGION, "other") == broad
    )
    assert selection.pool_for("elsewhere", CHEST) is None


def test_two_enabled_pools_for_one_chest_are_rejected(treasure, db):
    from django.db import IntegrityError, transaction

    pool()
    with pytest.raises(IntegrityError), transaction.atomic():
        pool(name="dup")


def test_old_attempts_survive_a_correction(treasure, objective, reviewer, publisher):
    revisions = publish_questions(reviewer, publisher, 3)
    pool()
    child = explorer(treasure)
    session, attempt = issue(treasure, child)
    revision = QuestionRevision.objects.get(pk=attempt.bank_revision_id)
    fix = workflow.start_correction(revision.question, publisher)
    workflow.edit(fix, publisher, {"stem": f"{fix.stem} Count carefully.", "hint": "x"})
    workflow.approve(fix, reviewer)
    workflow.publish(fix, publisher)
    attempt.refresh_from_db()
    assert attempt.status == AttemptStatus.ISSUED and attempt.source == "BANK"
    outcome = submit_chest_answer(child, attempt.pk, attempt.answer)  # still gradable
    assert outcome.correct and len(revisions) == 3


# --- conversion rules ---------------------------------------------------------------------------


def rev(**content):
    base = {
        "subject": "MATH",
        "questionType": "MULTIPLE_CHOICE",
        "operation": "MULTIPLY",
        "operands": [6, 7],
        "choices": [
            {"id": "A", "text": "42"},
            {"id": "B", "text": "36"},
            {"id": "C", "text": "48"},
        ],
        "correctAnswer": "A",
        "skillCode": "multiplication-facts",
    }
    base.update(content)
    return QuestionRevision(content=base)


def test_a_valid_revision_becomes_the_same_challenge_the_generator_makes():
    challenge = to_challenge(rev(), "EXPLORER")
    assert challenge == MathChallenge(
        "multiplication-facts", Operation.MULTIPLY, (6, 7), 42, ResponseMode.CHOICE, (36, 42, 48)
    )


@pytest.mark.parametrize(
    "content, band",
    [
        (
            {
                "operation": "DIVIDE",
                "operands": [42, 6],
                "choices": [{"id": "A", "text": "7"}, {"id": "B", "text": "8"}],
            },
            "EXPLORER",
        ),
        ({"questionType": "SHORT_ANSWER", "choices": [], "correctAnswer": "42"}, "EXPLORER"),
        ({"correctAnswer": "B"}, "EXPLORER"),  # key disagrees with the arithmetic
        ({"operands": [6]}, "EXPLORER"),
        ({"choices": [{"id": "A", "text": "42"}, {"id": "B", "text": "forty"}]}, "EXPLORER"),
        ({"choices": [{"id": "A", "text": "42"}, {"id": "B", "text": "42"}]}, "EXPLORER"),
        ({"subject": "SCIENCE"}, "EXPLORER"),
        ({}, "UNKNOWN"),
    ],
)
def test_revisions_that_cannot_be_served_exactly_are_skipped(content, band):
    assert to_challenge(rev(**content), band) is None


def test_sprouts_get_at_most_three_choices():
    assert to_challenge(rev(), "SPROUT") is not None  # three choices fit
    four = [
        {"id": "A", "text": "42"},
        {"id": "B", "text": "36"},
        {"id": "C", "text": "48"},
        {"id": "D", "text": "40"},
    ]
    assert to_challenge(rev(choices=four), "SPROUT") is None
    assert to_challenge(rev(choices=four), "PATHFINDER") is not None


def test_numeric_questions_follow_the_typed_answer_limit_and_band():
    numeric = dict(questionType="NUMERIC", choices=[], correctAnswer="42")
    assert to_challenge(rev(**numeric), "EXPLORER").response_mode == ResponseMode.NUMBER_INPUT
    assert to_challenge(rev(**numeric), "SPROUT") is None  # sprouts never type numbers
    assert (
        to_challenge(rev(**{**numeric, "operands": [20, 20], "correctAnswer": "400"}), "EXPLORER")
        is None
    )  # over 100
