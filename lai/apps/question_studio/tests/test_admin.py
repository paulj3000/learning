import pytest
from django.test import Client
from django.urls import reverse

from apps.question_studio import validation
from apps.question_studio.models import (
    BatchStatus,
    GenerationBatch,
    Question,
    QuestionRevision,
    ReviewStatus,
)

from .conftest import make_question, make_staff

pytestmark = pytest.mark.django_db

FORM = {
    "subject": "MATH",
    "grade": "3",
    "topic": "multiplication",
    "skill_code": "multiplication-facts",
    "difficulty": "MIXED",
    "question_type": "MULTIPLE_CHOICE",
    "count": "10",
    "include_hints": "on",
    "include_explanations": "on",
    "notes": "",
}


def login(user):
    client = Client()
    client.force_login(user, backend="apps.users.backends.AdminPasswordBackend")
    return client


def url(name, *args):
    return reverse(f"admin:question_studio_{name}", args=args)


def test_staff_without_permissions_see_nothing(nobody):
    client = login(nobody)
    for name in (
        "generationbatch_changelist",
        "question_changelist",
        "questionrevision_changelist",
    ):
        assert client.get(url(name)).status_code == 403
    assert client.get(url("generationbatch_add")).status_code == 403


def test_authorised_staff_generate_through_the_form(author, settings):
    settings.LAI_STUDIO_RUN_MODE = "inline"
    client = login(author)
    page = client.get(url("generationbatch_add"))
    assert page.status_code == 200 and b"Generate Questions" in page.content
    response = client.post(url("generationbatch_add"), FORM)
    batch = GenerationBatch.objects.get()
    assert response.status_code == 302 and str(batch.pk) in response["Location"]
    assert batch.requested_by == author and batch.status == BatchStatus.COMPLETED
    assert Question.objects.filter(batch=batch).count() == 10
    detail = client.get(url("generationbatch_change", batch.pk))
    assert detail.status_code == 200 and b"Review the 10 questions" in detail.content


def test_queued_batch_shows_status_feedback_and_manual_mode_does_not_block(author, settings):
    settings.LAI_STUDIO_RUN_MODE = "manual"
    client = login(author)
    client.post(url("generationbatch_add"), FORM)
    batch = GenerationBatch.objects.get()
    assert batch.status == BatchStatus.QUEUED
    page = client.get(url("generationbatch_change", batch.pk))
    assert b"queued" in page.content.lower()


def test_form_errors_and_limit_refusals_are_shown_not_raised(author):
    client = login(author)
    bad = client.post(url("generationbatch_add"), {**FORM, "topic": "astrology"})
    assert bad.status_code == 200 and not GenerationBatch.objects.exists()
    huge = client.post(url("generationbatch_add"), {**FORM, "count": "500"})
    assert (
        huge.status_code == 200 and b"batch_too_large" in huge.content or b"At most" in huge.content
    )
    assert not GenerationBatch.objects.exists()


def test_reviewers_cannot_open_the_generate_form(reviewer):
    assert login(reviewer).get(url("generationbatch_add")).status_code == 403


def test_batches_are_read_only(author):
    batch = GenerationBatch.objects.create(
        requested_by=author,
        subject="MATH",
        grade="3",
        topic="multiplication",
        difficulty="MIXED",
        question_type="NUMERIC",
        requested_count=1,
        prompt_version="v",
        schema_version=1,
    )
    client = login(author)
    assert client.get(url("generationbatch_change", batch.pk)).status_code == 200
    assert (
        client.post(url("generationbatch_change", batch.pk), {"topic": "addition"}).status_code
        == 403
    )
    assert client.post(url("generationbatch_delete", batch.pk), {"post": "yes"}).status_code == 403


def test_question_review_page_shows_choices_answer_report_and_history(reviewer):
    q = make_question()
    validation.run_validation(q)
    page = login(reviewer).get(url("question_change", q.pk))
    body = page.content.decode()
    assert page.status_code == 200
    assert "What is 6 x 7?" in body and "42" in body and "answer_verified" in body
    assert "Validation report" in body and "History" in body


def test_editing_through_the_admin_revalidates_and_records(reviewer):
    q = make_question(correct_answer="B")
    validation.run_validation(q)
    client = login(reviewer)
    page = client.get(url("question_change", q.pk))
    form = {f"{k}": v for k, v in page.context["adminform"].form.initial.items() if v is not None}
    form.update(
        correct_answer="A",
        choices='[{"id":"A","text":"42"},{"id":"B","text":"36"},{"id":"C","text":"48"}]',
        operands="6,7",
        accepted_answers="[]",
        **{
            "findings-TOTAL_FORMS": "0",
            "findings-INITIAL_FORMS": "0",
            "events-TOTAL_FORMS": "0",
            "events-INITIAL_FORMS": "0",
        },
    )
    for key in ("world", "location", "adventure"):
        form[key] = ""
    response = client.post(url("question_change", q.pk), form)
    q.refresh_from_db()
    assert response.status_code == 302, (
        response.context and response.context["adminform"].form.errors
    )
    assert q.correct_answer == "A" and q.validation_status == "WARNING"
    assert q.events.filter(action="edited").exists()


def test_actions_are_offered_only_with_permission(author, reviewer, publisher):
    make_question()

    def offered(user):
        response = login(user).get(url("question_changelist"))
        return set(dict(response.context["action_form"].fields["action"].choices))

    assert "action_approve" not in offered(author) and "action_publish" not in offered(author)
    assert "action_approve" in offered(reviewer) and "action_publish" not in offered(reviewer)
    assert "action_publish" in offered(publisher)


def post_action(client, action, *questions):
    return client.post(
        url("question_changelist"),
        {"action": action, "_selected_action": [str(q.pk) for q in questions]},
        follow=True,
    )


def test_bulk_approve_and_publish_through_the_admin(reviewer, publisher):
    good, bad = (
        make_question(),
        make_question(stem="What is 6 x 8?", operands=[6, 8], correct_answer="B"),
    )
    for q in (good, bad):
        validation.run_validation(q)
    response = post_action(login(reviewer), "action_approve", good, bad)
    assert (
        b"1 question(s) approved" in response.content
        and b"blocked_by_validation" in response.content
    )
    good.refresh_from_db()
    assert good.review_status == ReviewStatus.APPROVED
    response = post_action(login(publisher), "action_publish", good, bad)
    assert b"1 question(s) published" in response.content
    assert QuestionRevision.objects.count() == 1


def test_a_reviewer_cannot_force_a_publish_by_posting_the_action(reviewer):
    q = make_question()
    validation.run_validation(q)
    from apps.question_studio import workflow

    workflow.approve(q, reviewer)
    post_action(login(reviewer), "action_publish", q)
    assert not QuestionRevision.objects.exists()


def test_bulk_regenerate_rejects_and_queues_a_replacement(author, settings):
    settings.LAI_STUDIO_RUN_MODE = "manual"
    both = make_staff(
        "both",
        "add_generationbatch",
        "view_question",
        "change_question",
        "approve_question",
        "view_generationbatch",
    )
    qs = [
        make_question(),
        make_question(stem="What is 6 x 8?", operands=[6, 8], correct_answer="A"),
    ]
    response = post_action(login(both), "action_regenerate", *qs)
    assert b"2 rejected" in response.content
    assert Question.objects.filter(review_status=ReviewStatus.REJECTED).count() == 2
    assert GenerationBatch.objects.get().requested_count == 2


def test_regenerate_refuses_mixed_specifications(both_perms=None):
    both = make_staff(
        "both2", "add_generationbatch", "view_question", "change_question", "approve_question"
    )
    a, b = (
        make_question(),
        make_question(
            topic="addition",
            operation="ADD",
            stem="What is 3 + 4?",
            operands=[3, 4],
            correct_answer="A",
        ),
    )
    response = post_action(login(both), "action_regenerate", a, b)
    assert b"mixed_specifications" in response.content
    assert not GenerationBatch.objects.exists()


def test_published_questions_and_revisions_are_read_only_in_the_admin(reviewer, publisher):
    from apps.question_studio import workflow

    q = make_question()
    validation.run_validation(q)
    workflow.approve(q, reviewer)
    revision = workflow.publish(q, publisher)
    client = login(publisher)
    page = client.get(url("question_change", q.pk))
    assert page.status_code == 200 and b'name="stem"' not in page.content
    assert client.post(url("question_change", q.pk), {"stem": "tampered"}).status_code in (
        200,
        302,
        403,
    )
    q.refresh_from_db()
    assert q.stem == "What is 6 x 7?"
    assert client.get(url("questionrevision_change", revision.pk)).status_code == 200
    assert (
        client.post(url("questionrevision_delete", revision.pk), {"post": "yes"}).status_code == 403
    )


def test_retire_action_needs_the_retire_permission(reviewer, publisher):
    from apps.question_studio import workflow

    q = make_question()
    validation.run_validation(q)
    workflow.approve(q, reviewer)
    revision = workflow.publish(q, publisher)
    client = login(reviewer)
    client.post(
        url("questionrevision_changelist"),
        {"action": "action_retire", "_selected_action": [str(revision.pk)]},
    )
    revision.refresh_from_db()
    assert revision.status == "ACTIVE"
    login(publisher).post(
        url("questionrevision_changelist"),
        {"action": "action_retire", "_selected_action": [str(revision.pk)]},
    )
    revision.refresh_from_db()
    assert revision.status == "RETIRED"
