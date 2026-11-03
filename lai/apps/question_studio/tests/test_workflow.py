import threading

import pytest
from django.db import close_old_connections, connection

from apps.question_studio import validation, workflow
from apps.question_studio.models import (
    ImmutableRevision,
    Question,
    QuestionRevision,
    ReviewEvent,
    ReviewStatus,
    RevisionStatus,
    ValidationStatus,
)

from .conftest import make_question

pytestmark = pytest.mark.django_db


def validated(**overrides):
    q = make_question(**overrides)
    validation.run_validation(q)
    q.refresh_from_db()
    return q


def test_happy_path_records_every_step(author, reviewer, publisher):
    q = validated()
    assert q.validation_status == ValidationStatus.WARNING
    workflow.submit_for_review(q, author)
    workflow.approve(q, reviewer, "checked by hand")
    revision = workflow.publish(q, publisher)
    q.refresh_from_db()
    assert q.review_status == ReviewStatus.PUBLISHED and q.reviewed_by == reviewer
    assert revision.number == 1 and revision.status == RevisionStatus.ACTIVE
    assert revision.published_by == publisher and revision.content["stem"] == q.stem
    actions = list(ReviewEvent.objects.filter(question=q).values_list("action", flat=True))
    assert actions == ["submitted", "approved", "published"]


@pytest.mark.parametrize(
    "call, who",
    [
        (workflow.approve, "author"),
        (workflow.reject, "author"),
        (workflow.publish, "reviewer"),
        (workflow.submit_for_review, "nobody"),
        (workflow.revalidate, "nobody"),
    ],
)
def test_every_operation_checks_permission(call, who, request):
    q = validated()
    with pytest.raises(workflow.NotPermitted):
        call(q, request.getfixturevalue(who))


def test_inactive_staff_lose_every_permission(reviewer):
    q = validated()
    reviewer.is_active = False
    reviewer.save()
    with pytest.raises(workflow.NotPermitted):
        workflow.approve(q, reviewer)


def test_unvalidated_question_cannot_be_approved(reviewer):
    q = make_question()
    with pytest.raises(workflow.NotValidated):
        workflow.approve(q, reviewer)


def test_failing_question_cannot_be_approved_or_published(reviewer, publisher):
    q = validated(correct_answer="B")
    assert q.validation_status == ValidationStatus.FAIL
    with pytest.raises(workflow.BlockedByValidation):
        workflow.approve(q, reviewer)
    Question.objects.filter(pk=q.pk).update(review_status=ReviewStatus.APPROVED)  # forced state
    with pytest.raises(workflow.BlockedByValidation):
        workflow.publish(q, publisher)
    assert not QuestionRevision.objects.exists()


def test_only_approved_questions_publish(publisher):
    q = validated()
    for status in (ReviewStatus.DRAFT, ReviewStatus.NEEDS_REVIEW, ReviewStatus.REJECTED):
        Question.objects.filter(pk=q.pk).update(review_status=status)
        with pytest.raises(workflow.InvalidTransition):
            workflow.publish(q, publisher)


def test_publish_rechecks_validation_at_publish_time(reviewer, publisher):
    q = validated()
    workflow.approve(q, reviewer)
    # An identical older question appears after approval.
    older = make_question()
    Question.objects.filter(pk=older.pk).update(created_at=q.created_at.replace(year=2000))
    with pytest.raises(workflow.BlockedByValidation):
        workflow.publish(q, publisher)


def test_editing_an_approved_question_withdraws_approval_and_revalidates(author, reviewer):
    q = validated()
    workflow.approve(q, reviewer)
    edited = workflow.edit(q, author, {"hint": "Think of 6 groups of 7."})
    assert edited.review_status == ReviewStatus.DRAFT and edited.reviewed_by is None
    assert edited.validation_status == ValidationStatus.WARNING and edited.validation_run == 2
    assert ReviewEvent.objects.filter(question=q, action="edited").exists()


def test_editing_a_wrong_key_then_revalidating_fixes_it(author):
    q = validated(correct_answer="B")
    fixed = workflow.edit(q, author, {"correct_answer": "A"})
    assert fixed.validation_status == ValidationStatus.WARNING


def test_an_edit_that_changes_nothing_is_a_noop(author):
    q = validated()
    assert workflow.edit(q, author, {"hint": q.hint}).validation_run == 1


def test_unknown_fields_cannot_be_edited(author):
    q = validated()
    workflow.edit(q, author, {"review_status": "PUBLISHED", "hint": "new hint"})
    q.refresh_from_db()
    assert q.review_status != ReviewStatus.PUBLISHED


def test_published_questions_are_frozen(author, reviewer, publisher):
    q = validated()
    workflow.approve(q, reviewer)
    workflow.publish(q, publisher)
    for call in (
        lambda: workflow.edit(q, author, {"hint": "x"}),
        lambda: workflow.revalidate(q, author),
    ):
        with pytest.raises(workflow.InvalidTransition):
            call()
    with pytest.raises(workflow.InvalidTransition):
        workflow.reject(q, reviewer)


def test_published_revisions_are_immutable(reviewer, publisher):
    q = validated()
    workflow.approve(q, reviewer)
    revision = workflow.publish(q, publisher)
    revision.content = {"stem": "tampered"}
    with pytest.raises(ImmutableRevision):
        revision.save()
    fresh = QuestionRevision.objects.get(pk=revision.pk)
    fresh.grade = "4"
    with pytest.raises(ImmutableRevision):
        fresh.save()
    with pytest.raises(ImmutableRevision):
        fresh.delete()
    assert QuestionRevision.objects.get(pk=revision.pk).content["stem"] == q.stem


def test_reject_and_reopen(reviewer):
    q = validated()
    workflow.reject(q, reviewer, "too easy")
    q.refresh_from_db()
    assert q.review_status == ReviewStatus.REJECTED
    workflow.reopen(q, reviewer)
    q.refresh_from_db()
    assert q.review_status == ReviewStatus.DRAFT


def test_correction_supersedes_the_old_revision_atomically(author, reviewer, publisher):
    q = validated()
    workflow.approve(q, reviewer)
    old = workflow.publish(q, publisher)
    fix = workflow.start_correction(q, author)
    assert fix.replaces_id == q.pk and fix.review_status == ReviewStatus.DRAFT
    with pytest.raises(workflow.InvalidTransition):
        workflow.start_correction(q, author)  # one at a time
    fix = workflow.edit(fix, author, {"stem": "What is 7 x 6?", "operands": [7, 6]})
    workflow.approve(fix, reviewer)
    new = workflow.publish(fix, publisher)
    old.refresh_from_db()
    q.refresh_from_db()
    assert old.status == RevisionStatus.SUPERSEDED and old.retired_at
    assert new.status == RevisionStatus.ACTIVE
    assert old.content["stem"] == "What is 6 x 7?"  # history intact
    assert q.review_status == ReviewStatus.REJECTED
    assert QuestionRevision.objects.filter(status=RevisionStatus.ACTIVE).count() == 1


def test_a_correction_may_change_only_the_hint(author, reviewer, publisher):
    q = validated()
    workflow.approve(q, reviewer)
    workflow.publish(q, publisher)
    fix = workflow.start_correction(q, author)
    fix = workflow.edit(fix, author, {"hint": "A better hint."})
    assert "duplicate_exact" not in {f.code for f in validation.latest_findings(fix)}


def test_retire_withdraws_a_revision(reviewer, publisher):
    q = validated()
    workflow.approve(q, reviewer)
    revision = workflow.publish(q, publisher)
    with pytest.raises(workflow.NotPermitted):
        workflow.retire(revision, reviewer)
    workflow.retire(revision, publisher, "wrong grade")
    revision.refresh_from_db()
    q.refresh_from_db()
    assert revision.status == RevisionStatus.RETIRED and q.review_status == ReviewStatus.REJECTED
    with pytest.raises(workflow.InvalidTransition):
        workflow.retire(revision, publisher)


def test_events_are_append_only(reviewer):
    q = validated()
    workflow.approve(q, reviewer)
    event = ReviewEvent.objects.filter(question=q).first()
    event.note = "changed"
    with pytest.raises(Exception, match="cannot change"):
        event.save()
    with pytest.raises(Exception, match="cannot be deleted"):
        event.delete()


def test_bulk_operations_honour_each_questions_state(reviewer, publisher):
    good = validated()
    bad = validated(stem="What is 6 x 8?", operands=[6, 8], correct_answer="B")
    unvalidated = make_question(stem="What is 6 x 9?", operands=[6, 9])
    done, refused = workflow.bulk(workflow.approve, [good, bad, unvalidated], reviewer)
    assert done == [good]
    assert {q.pk: code for q, code in refused} == {
        bad.pk: "blocked_by_validation",
        unvalidated.pk: "not_validated",
    }
    done, refused = workflow.bulk(workflow.publish, [good], reviewer)  # reviewer cannot publish
    assert not done and refused[0][1] == "not_permitted"
    done, _ = workflow.bulk(workflow.publish, [good], publisher)
    assert done == [good]


def test_bulk_revalidate_and_reject(author, reviewer):
    a, b = validated(), validated(stem="What is 6 x 8?", operands=[6, 8], correct_answer="B")
    done, _ = workflow.bulk(workflow.revalidate, [a, b], author)
    assert len(done) == 2
    done, _ = workflow.bulk(workflow.reject, [a, b], reviewer, note="batch cleanup")
    assert Question.objects.filter(review_status=ReviewStatus.REJECTED).count() == 2


@pytest.mark.django_db(transaction=True)
def test_concurrent_publishing_creates_one_revision(reviewer, publisher):
    q = validated()
    workflow.approve(q, reviewer)
    outcomes, barrier = [], threading.Barrier(2)

    def attempt():
        try:
            barrier.wait()
            workflow.publish(Question.objects.get(pk=q.pk), publisher)
            outcomes.append("ok")
        except workflow.StudioError as error:
            outcomes.append(error.code)
        finally:
            close_old_connections()
            connection.close()

    threads = [threading.Thread(target=attempt) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(outcomes) == ["invalid_transition", "ok"]
    assert QuestionRevision.objects.filter(question=q).count() == 1
