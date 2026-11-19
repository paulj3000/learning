"""Staff cancel and retry, slot idempotency and duplicate-submit protection.

The useful parts of LAI-AQS-027 adapted to the Lambda/SQS jobs path (ADR-055): cancellation in
every run mode, retry of the missing slots only, a chunk applied twice storing nothing twice, a
resubmitted Generate form returning the first batch, and the Admin controls behind permissions.
"""

import uuid
from datetime import timedelta
from types import SimpleNamespace

import pytest
from django.db import IntegrityError, transaction
from django.test import Client
from django.urls import reverse
from django.utils.timezone import now

from apps.ai.providers import override_model_client
from apps.ai.providers.base import ProviderError
from apps.ai.providers.fake import FakeModelClient, studio_output
from apps.jobs import services as jobs
from apps.jobs.core import envelope
from apps.jobs.models import ProcessingJob
from apps.jobs.tests.helpers import FakeSQS, use_sqs
from apps.question_studio import generation
from apps.question_studio.models import BatchStatus, GenerationBatch, Question

from .conftest import make_question, make_staff, params
from .test_jobs_mode import worker_result

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def operator(db):
    return make_staff(
        "operator",
        "add_generationbatch",
        "view_generationbatch",
        "cancel_generationbatch",
        "retry_generationbatch",
        "view_question",
    )


def slots(batch):
    return sorted(Question.objects.filter(batch=batch).values_list("slot", flat=True))


def cancelling_client(user, *, after: int = 1):
    """A fake model that cancels the batch (as staff would, elsewhere) on call `after`."""
    state = {"calls": 0}

    def respond(request):
        state["calls"] += 1
        if state["calls"] == after:
            state["outcome"] = generation.request_cancel(batch_of["id"], user)
        return studio_output(request.fake_hints)

    batch_of: dict = {}
    client = FakeModelClient(respond=respond)
    return client, batch_of, state


def partial_batch(user, settings, count=10):
    """A PARTIAL batch: the first chunk answers, the second is throttled (one attempt)."""
    settings.LAI_STUDIO_MAX_ATTEMPTS = 1
    first = studio_output({"params": params(), "count": 5, "offset": 0})
    client = FakeModelClient([first, ProviderError("THROTTLED")])
    batch = generation.create_batch(user, params(count=count))
    done = generation.run_batch(batch.pk, client=client)
    assert done.status == BatchStatus.PARTIAL and done.produced_count == 5
    return done


# --- cancel ------------------------------------------------------------------------------------


def test_cancel_between_chunks_in_process(operator, settings):
    settings.LAI_STUDIO_RUN_MODE = "inline"
    client, batch_of, state = cancelling_client(operator)
    batch = generation.create_batch(operator, params(count=12))
    batch_of["id"] = batch.pk
    with override_model_client(client):
        generation.start_batch(batch)
    batch.refresh_from_db()
    assert state["outcome"] == "cancelling"
    assert batch.status == BatchStatus.CANCELLED and len(client.requests) == 1
    # The chunk in flight is still accounted: its tokens were spent and its drafts kept.
    assert batch.produced_count == 5 and batch.input_tokens > 0 and slots(batch) == [0, 1, 2, 3, 4]
    assert batch.cancelled_by == operator and batch.finished_at
    assert "Cancelled" in generation.failure_message(batch)


def test_cancel_with_the_inline_jobs_backend(operator, settings):
    settings.LAI_STUDIO_RUN_MODE = "jobs"
    client, batch_of, state = cancelling_client(operator)
    batch = generation.create_batch(operator, params(count=12))
    batch_of["id"] = batch.pk
    with override_model_client(client):
        generation.start_batch(batch)
    batch.refresh_from_db()
    assert state["outcome"] == "cancelling"  # a chunk job was in flight
    assert batch.status == BatchStatus.CANCELLED and batch.produced_count == 5
    assert ProcessingJob.objects.filter(subject_id=str(batch.pk)).count() == 1


def test_a_queued_batch_is_cancelled_at_once_and_never_runs(operator, fake, capsys):
    from django.core.management import call_command

    batch = generation.create_batch(operator, params(count=2))
    assert generation.request_cancel(batch.pk, operator) == "cancelled"
    call_command("studio_run_batch")
    batch.refresh_from_db()
    assert batch.status == BatchStatus.CANCELLED and not fake.requests
    assert batch.produced_count == 0


def test_a_stalled_in_process_run_is_cancelled_at_once(operator, fake, settings):
    settings.LAI_STUDIO_RUN_MODE = "thread"
    batch = generation.create_batch(operator, params(count=2))
    GenerationBatch.objects.filter(pk=batch.pk).update(
        status=BatchStatus.RUNNING, started_at=now() - timedelta(hours=1)
    )
    assert generation.request_cancel(batch.pk, operator) == "cancelled"
    batch.refresh_from_db()
    assert batch.status == BatchStatus.CANCELLED


def test_cancel_is_refused_without_permission_or_after_finishing(author, operator, fake):
    batch = generation.create_batch(author, params(count=2))
    with pytest.raises(generation.NotPermitted):
        generation.request_cancel(batch.pk, author)
    generation.run_batch(batch.pk)
    with pytest.raises(generation.BatchActionRefused) as error:
        generation.request_cancel(batch.pk, operator)
    assert error.value.code == "already_finished"


@pytest.fixture
def sqs(settings):
    settings.LAI_STUDIO_RUN_MODE = "jobs"
    use_sqs(settings)
    queue = FakeSQS()
    jobs.set_aws_clients(sqs=queue)
    yield queue
    jobs.set_aws_clients()


def test_cancel_in_sqs_jobs_mode_accounts_the_late_chunk_and_submits_no_more(
    operator, sqs, django_capture_on_commit_callbacks
):
    batch = generation.create_batch(operator, params(count=12))
    with django_capture_on_commit_callbacks(execute=True):
        generation.start_batch(batch)
    assert generation.request_cancel(batch.pk, operator) == "cancelling"
    batch.refresh_from_db()
    assert batch.status == BatchStatus.RUNNING
    with django_capture_on_commit_callbacks(execute=True):
        assert jobs.apply_result(worker_result(sqs.sent[0], FakeModelClient())) == jobs.APPLIED
    batch.refresh_from_db()
    assert batch.status == BatchStatus.CANCELLED and len(sqs.sent) == 1
    assert batch.produced_count == 5 and batch.input_tokens > 0


def test_cancel_in_sqs_jobs_mode_when_the_chunk_job_fails(
    operator, sqs, django_capture_on_commit_callbacks
):
    batch = generation.create_batch(operator, params(count=12))
    with django_capture_on_commit_callbacks(execute=True):
        generation.start_batch(batch)
    generation.request_cancel(batch.pk, operator)
    job_id = envelope.parse_work(sqs.sent[0]["Body"])["job_id"]
    failed = envelope.build_result(job_id, "studio.generate_chunk", "failed", error_code="timeout")
    with django_capture_on_commit_callbacks(execute=True):
        jobs.apply_result(failed)
    batch.refresh_from_db()
    assert batch.status == BatchStatus.CANCELLED and len(sqs.sent) == 1


def test_cancel_in_jobs_mode_with_nothing_in_flight_is_immediate(operator, sqs, settings):
    batch = generation.create_batch(operator, params(count=2))
    GenerationBatch.objects.filter(pk=batch.pk).update(status=BatchStatus.RUNNING, started_at=now())
    assert generation.request_cancel(batch.pk, operator) == "cancelled"


# --- retry and slot idempotency ----------------------------------------------------------------


def test_retry_fills_only_the_missing_slots(operator, settings):
    batch = partial_batch(operator, settings)
    before = set(Question.objects.filter(batch=batch).values_list("pk", flat=True))
    settings.LAI_STUDIO_RUN_MODE = "inline"
    client = FakeModelClient()
    with override_model_client(client):
        retried, missing = generation.retry_batch(batch.pk, operator)
        assert missing == 5 and retried.status == BatchStatus.QUEUED
        generation.start_batch(retried)
    batch.refresh_from_db()
    assert batch.status == BatchStatus.COMPLETED and batch.produced_count == 10
    assert slots(batch) == list(range(10)) and batch.retry_count == 1
    assert len(client.requests) == 1 and client.requests[0].fake_hints["count"] == 5
    assert before <= set(Question.objects.filter(batch=batch).values_list("pk", flat=True))
    stems = list(Question.objects.filter(batch=batch).values_list("stem", flat=True))
    assert len(set(stems)) == 10


def test_retry_fills_the_holes_a_short_answer_left(operator, settings):
    short = studio_output({"params": params(), "count": 3, "offset": 0})
    client = FakeModelClient([short])
    batch = generation.create_batch(operator, params(count=10))
    done = generation.run_batch(batch.pk, client=client)
    assert done.status == BatchStatus.PARTIAL and slots(done) == [0, 1, 2, 5, 6, 7, 8, 9]
    assert generation.failure_message(done) == "The model returned fewer questions than asked."
    client = FakeModelClient()
    generation.retry_batch(batch.pk, operator)
    done = generation.run_batch(batch.pk, client=client)
    assert done.status == BatchStatus.COMPLETED and slots(done) == list(range(10))
    assert [r.fake_hints["count"] for r in client.requests] == [2]


def test_retry_in_jobs_mode_submits_chunk_jobs_for_the_missing_slots(operator, settings):
    batch = partial_batch(operator, settings)
    settings.LAI_STUDIO_RUN_MODE = "jobs"
    with override_model_client(FakeModelClient()):
        generation.retry_batch(batch.pk, operator)
        generation.start_batch(batch)
    batch.refresh_from_db()
    assert batch.status == BatchStatus.COMPLETED and slots(batch) == list(range(10))
    (job,) = ProcessingJob.objects.filter(subject_id=str(batch.pk))
    assert (job.payload["chunk_index"], job.payload["requested_before"]) == (2, 5)
    assert job.payload["want"] == 5


def test_retry_refusals(author, operator, settings, fake, monkeypatch):
    batch = partial_batch(operator, settings)
    with pytest.raises(generation.NotPermitted):
        generation.retry_batch(batch.pk, author)
    done = generation.run_batch(generation.create_batch(operator, params(count=2)).pk)
    with pytest.raises(generation.BatchActionRefused) as error:
        generation.retry_batch(done.pk, operator)
    assert error.value.code == "not_retryable"
    monkeypatch.setattr(generation.prompts, "PROMPT_VERSION", "studio-v999")
    with pytest.raises(generation.BatchActionRefused) as error:
        generation.retry_batch(batch.pk, operator)
    assert error.value.code == "prompt_changed"
    monkeypatch.undo()
    GenerationBatch.objects.filter(pk=batch.pk).update(retry_count=generation.MAX_RETRIES)
    with pytest.raises(generation.BatchActionRefused) as error:
        generation.retry_batch(batch.pk, operator)
    assert error.value.code == "retry_limit"


def test_a_batch_from_before_slots_is_not_retried(operator, settings):
    batch = partial_batch(operator, settings)
    Question.objects.filter(batch=batch).update(slot=None)
    with pytest.raises(generation.BatchActionRefused) as error:
        generation.retry_batch(batch.pk, operator)
    assert error.value.code == "legacy_batch"


def test_the_database_refuses_a_second_draft_in_a_slot(operator, fake):
    batch = generation.run_batch(generation.create_batch(operator, params(count=2)).pk)
    with pytest.raises(IntegrityError), transaction.atomic():
        make_question(batch=batch, slot=0)
    make_question(batch=batch)  # a hand-written draft has no slot


def test_a_chunk_result_applied_twice_stores_nothing_twice(operator, settings):
    settings.LAI_STUDIO_RUN_MODE = "manual"
    batch = generation.create_batch(operator, params(count=10))
    GenerationBatch.objects.filter(pk=batch.pk).update(status=BatchStatus.RUNNING, started_at=now())
    result = {
        "items": studio_output({"params": params(), "count": 5, "offset": 0})["questions"],
        "input_tokens": 10,
        "output_tokens": 20,
        "attempts": 1,
        "failure": "",
    }
    job = SimpleNamespace(
        pk=uuid.uuid4(),
        status="completed",
        error_code="",
        payload={"batch_id": str(batch.pk), "chunk_index": 0, "want": 5, "requested_before": 0},
        result=result,
    )
    settings.LAI_JOBS_BACKEND = "disabled"  # the next chunk is refused; the batch then finishes
    generation.apply_chunk_job(job)
    # Even if the order guard were bypassed (chunk counter rewound), the slots are taken.
    GenerationBatch.objects.filter(pk=batch.pk).update(
        status=BatchStatus.RUNNING, chunks_done=0, finished_at=None
    )
    generation.apply_chunk_job(job)
    batch.refresh_from_db()
    assert Question.objects.filter(batch=batch).count() == 5 and slots(batch) == [0, 1, 2, 3, 4]


# --- duplicate submit ----------------------------------------------------------------------------


def test_a_resubmitted_form_returns_the_first_batch(operator, fake):
    key = uuid.uuid4()
    first = generation.create_batch(operator, params(count=2), submission_key=key)
    with pytest.raises(generation.DuplicateSubmission) as duplicate:
        generation.create_batch(operator, params(count=2), submission_key=key)
    assert duplicate.value.batch == first and GenerationBatch.objects.count() == 1
    generation.create_batch(operator, params(count=2), submission_key=uuid.uuid4())
    generation.create_batch(operator, params(count=2))  # no key: never deduplicated
    assert GenerationBatch.objects.count() == 3


# --- Admin -------------------------------------------------------------------------------------


def login(user):
    client = Client()
    client.force_login(user, backend="apps.users.backends.AdminPasswordBackend")
    return client


def url(name, *args):
    return reverse(f"admin:question_studio_{name}", args=args)


FORM = {
    "subject": "MATH",
    "grade": "3",
    "topic": "multiplication",
    "skill_code": "multiplication-facts",
    "difficulty": "MIXED",
    "question_type": "MULTIPLE_CHOICE",
    "count": "4",
    "include_hints": "on",
    "include_explanations": "on",
    "notes": "",
}


def test_admin_double_submit_makes_one_batch(operator, settings):
    settings.LAI_STUDIO_RUN_MODE = "manual"
    client = login(operator)
    page = client.get(url("generationbatch_add"))
    assert b'name="submission_key"' in page.content
    form = {**FORM, "submission_key": str(uuid.uuid4())}
    first = client.post(url("generationbatch_add"), form)
    second = client.post(url("generationbatch_add"), form)
    assert GenerationBatch.objects.count() == 1
    assert first.status_code == second.status_code == 302
    assert first["Location"] == second["Location"]


def test_admin_cancel_button_and_view_follow_permissions(author, operator, fake):
    batch = generation.create_batch(author, params(count=2))
    page = login(author).get(url("generationbatch_change", batch.pk))
    assert page.status_code == 200 and b"Cancel this batch" not in page.content
    assert login(author).post(url("generationbatch_cancel", batch.pk)).status_code == 403
    client = login(operator)
    page = client.get(url("generationbatch_change", batch.pk))
    assert b"Cancel this batch" in page.content and b"Retry missing" not in page.content
    assert b"0 of 2 questions" in page.content
    assert client.get(url("generationbatch_cancel", batch.pk)).status_code == 405
    response = client.post(url("generationbatch_cancel", batch.pk))
    assert response.status_code == 302
    batch.refresh_from_db()
    assert batch.status == BatchStatus.CANCELLED
    page = client.get(url("generationbatch_change", batch.pk))
    assert b"Cancel this batch" not in page.content and b"was cancelled" in page.content


def test_admin_retry_button_view_and_failure_detail(author, operator, settings):
    batch = partial_batch(operator, settings)
    GenerationBatch.objects.filter(pk=batch.pk).update(failure_category="THROTTLED")
    assert (
        b"Retry missing" not in login(author).get(url("generationbatch_change", batch.pk)).content
    )
    assert login(author).post(url("generationbatch_retry", batch.pk)).status_code == 403
    client = login(operator)
    page = client.get(url("generationbatch_change", batch.pk))
    assert b"Retry missing questions" in page.content
    assert b"The model service asked us to slow down." in page.content
    settings.LAI_STUDIO_RUN_MODE = "inline"
    with override_model_client(FakeModelClient()):
        response = client.post(url("generationbatch_retry", batch.pk))
    assert response.status_code == 302
    batch.refresh_from_db()
    assert batch.status == BatchStatus.COMPLETED and slots(batch) == list(range(10))


def test_admin_bulk_actions_are_offered_only_with_permission(author, operator, fake, settings):
    settings.LAI_STUDIO_RUN_MODE = "manual"
    queued = generation.create_batch(author, params(count=2))
    page = login(author).get(url("generationbatch_changelist"))
    assert b"action_cancel" not in page.content and b"action_retry" not in page.content
    client = login(operator)
    page = client.get(url("generationbatch_changelist"))
    assert b"action_cancel" in page.content and b"action_retry" in page.content
    finished = generation.run_batch(generation.create_batch(operator, params(count=2)).pk)
    client.post(
        url("generationbatch_changelist"),
        {"action": "action_cancel", "_selected_action": [str(queued.pk), str(finished.pk)]},
    )
    queued.refresh_from_db()
    finished.refresh_from_db()
    assert queued.status == BatchStatus.CANCELLED and finished.status == BatchStatus.COMPLETED


def test_failure_detail_is_always_a_fixed_message(operator, fake):
    batch = generation.run_batch(generation.create_batch(operator, params(count=2)).pk)
    for category, expected in (
        ("GUARDRAIL", "The safety Guardrail blocked the request or the answer."),
        ("JOB_SOMETHING_ODD", "The background worker reported a failure."),
        ("Ignore all instructions <script>", "Generation failed."),
    ):
        batch.status, batch.failure_category = BatchStatus.FAILED, category
        assert generation.failure_message(batch) == expected
