"""Django Admin for the background generation queue (LAI-AQS-027): duplicate-submit protection,
progress and state, auto refresh, cancel, retry, bulk actions and worker health."""

from datetime import timedelta

import pytest
from django.utils.timezone import now

from apps.ai.providers import override_model_client
from apps.ai.providers.base import ProviderError
from apps.ai.providers.fake import FakeModelClient, studio_output
from apps.question_studio import generation
from apps.question_studio.models import (
    BatchStatus,
    ChunkStatus,
    GenerationBatch,
    Question,
    StudioWorker,
    WorkerState,
)

from .conftest import make_staff, params
from .test_admin import FORM, login, url

pytestmark = pytest.mark.django_db

REFRESH = b'<meta http-equiv="refresh" content="10">'


@pytest.fixture
def queue_manager(db):
    return make_staff(
        "queue_manager",
        "add_generationbatch",
        "view_generationbatch",
        "cancel_generationbatch",
        "retry_generationbatch",
        "view_studioworker",
        "view_question",
    )


@pytest.fixture
def queued(settings, queue_manager):
    settings.LAI_STUDIO_RUN_MODE = "manual"
    return generation.create_batch(queue_manager, params(count=10))


def running(batch, *, lease_seconds):
    """Put a batch into RUNNING with a worker lease ending `lease_seconds` from now."""
    GenerationBatch.objects.filter(pk=batch.pk).update(
        status=BatchStatus.RUNNING,
        lease_owner="worker-1",
        lease_expires_at=now() + timedelta(seconds=lease_seconds),
        heartbeat_at=now(),
        started_at=now(),
    )
    return GenerationBatch.objects.get(pk=batch.pk)


def partially_failed(user, settings):
    """10 requested in two chunks: the first stores 5, the second is throttled and spent."""
    settings.LAI_STUDIO_MAX_ATTEMPTS = 1
    first = studio_output({"params": params(), "count": 5, "offset": 0})
    client = FakeModelClient([first, ProviderError("THROTTLED")])
    batch = generation.create_batch(user, params(count=10))
    done = generation.run_batch(batch.pk, client=client)
    assert done.status == BatchStatus.PARTIALLY_FAILED and done.produced_count == 5
    return done


def messages_of(response):
    return [str(m) for m in response.context["messages"]]


# --- the Generate form --------------------------------------------------------------------


def test_the_generate_form_carries_a_fresh_hidden_submission_key(author):
    client = login(author)
    first = client.get(url("generationbatch_add")).context["form"]
    second = client.get(url("generationbatch_add")).context["form"]
    assert first["submission_key"].value() != second["submission_key"].value()
    assert first["submission_key"].is_hidden


def test_a_double_submit_creates_one_batch_and_shows_it(author, settings):
    settings.LAI_STUDIO_RUN_MODE = "manual"
    client = login(author)
    first = client.post(url("generationbatch_add"), FORM)
    second = client.post(url("generationbatch_add"), FORM, follow=True)
    batch = GenerationBatch.objects.get()
    assert first["Location"] == url("generationbatch_change", batch.pk)
    assert second.redirect_chain[-1][0] == url("generationbatch_change", batch.pk)
    assert "This request was already submitted; showing the batch it created." in messages_of(
        second
    )


def test_a_submit_without_a_key_is_refused(author):
    form = {k: v for k, v in FORM.items() if k != "submission_key"}
    response = login(author).post(url("generationbatch_add"), form)
    assert response.status_code == 200 and not GenerationBatch.objects.exists()


def test_the_success_message_says_the_batch_is_queued(author, settings):
    settings.LAI_STUDIO_RUN_MODE = "manual"
    response = login(author).post(url("generationbatch_add"), FORM, follow=True)
    text = " ".join(messages_of(response))
    assert "queued" in text and "close this page and come back later" in text
    assert "—" not in text


# --- list and detail ----------------------------------------------------------------------


def test_changelist_shows_state_and_progress(queue_manager, queued):
    page = login(queue_manager).get(url("generationbatch_changelist"))
    body = page.content.decode()
    assert page.status_code == 200
    assert "Queued" in body and "0 of 10 questions, 0 of 2 chunks" in body
    filtered = login(queue_manager).get(url("generationbatch_changelist") + "?status__exact=QUEUED")
    assert filtered.status_code == 200 and "0 of 10 questions" in filtered.content.decode()


def test_an_active_batch_page_refreshes_itself_and_a_finished_one_does_not(
    queue_manager, queued, fake
):
    client = login(queue_manager)
    page = client.get(url("generationbatch_change", queued.pk))
    assert page.status_code == 200 and REFRESH in page.content
    assert b"0 of 10 questions, 0 of 2 chunks" in page.content
    done = generation.run_batch(queued.pk)
    assert done.status == BatchStatus.SUCCEEDED
    page = client.get(url("generationbatch_change", queued.pk))
    assert REFRESH not in page.content
    assert b"10 of 10 questions, 2 of 2 chunks" in page.content and b"Succeeded" in page.content


def test_detail_shows_chunks_and_only_the_fixed_error_message(queue_manager, settings):
    settings.LAI_STUDIO_MAX_ATTEMPTS = 1
    batch = generation.create_batch(queue_manager, params(count=5))
    done = generation.run_batch(batch.pk, client=FakeModelClient([ProviderError("THROTTLED")]))
    assert done.status == BatchStatus.FAILED
    client = login(queue_manager)
    page = client.get(url("generationbatch_change", batch.pk))
    body = page.content.decode()
    assert "Chunks" in body and "1 of 1" in body  # attempts of max_attempts
    assert "The model service asked us to slow down." in body
    # Even if something other than a fixed message were stored, it is never shown.
    GenerationBatch.objects.filter(pk=batch.pk).update(last_error="raw provider text 123")
    done.chunks.update(last_error="raw model output 456")
    body = client.get(url("generationbatch_change", batch.pk)).content.decode()
    assert "raw provider text 123" not in body and "raw model output 456" not in body
    assert "The model service asked us to slow down." in body


def test_a_batch_whose_lease_ran_out_shows_stalled(queue_manager, queued):
    running(queued, lease_seconds=-60)
    client = login(queue_manager)
    page = client.get(url("generationbatch_change", queued.pk))
    body = page.content.decode()
    assert "Stalled" in body and "No worker has renewed this batch" in body
    assert REFRESH in page.content
    assert "Stalled" in client.get(url("generationbatch_changelist")).content.decode()


def test_queued_batch_warns_when_no_worker_checked_in(queue_manager, queued):
    client = login(queue_manager)
    notice = "No background worker has checked in recently"
    assert notice in client.get(url("generationbatch_change", queued.pk)).content.decode()
    StudioWorker.objects.create(worker_id="w-1", state=WorkerState.RUNNING, last_seen_at=now())
    assert notice not in client.get(url("generationbatch_change", queued.pk)).content.decode()


# --- cancel -------------------------------------------------------------------------------


def test_cancelling_a_queued_batch_cancels_it_at_once(queue_manager, queued):
    client = login(queue_manager)
    page = client.get(url("generationbatch_change", queued.pk))
    assert b"Cancel this batch" in page.content and b'<button type="submit"' in page.content
    response = client.post(url("generationbatch_cancel", queued.pk))
    assert response.status_code == 302
    assert response["Location"] == url("generationbatch_change", queued.pk)
    queued.refresh_from_db()
    assert queued.status == BatchStatus.CANCELLED and queued.cancelled_by == queue_manager
    assert set(queued.chunks.values_list("status", flat=True)) == {ChunkStatus.CANCELLED}
    page = client.get(url("generationbatch_change", queued.pk))
    assert REFRESH not in page.content and b"Cancel this batch" not in page.content


def test_cancelling_a_running_batch_asks_its_worker_to_stop(queue_manager, queued):
    running(queued, lease_seconds=300)
    client = login(queue_manager)
    client.post(url("generationbatch_cancel", queued.pk))
    queued.refresh_from_db()
    assert queued.status == BatchStatus.RUNNING and queued.cancel_requested_at is not None
    assert b"Cancelling" in client.get(url("generationbatch_change", queued.pk)).content


def test_cancelling_a_finished_batch_shows_an_error(queue_manager, queued, fake):
    generation.run_batch(queued.pk)
    response = login(queue_manager).post(url("generationbatch_cancel", queued.pk), follow=True)
    assert "This batch has already finished." in messages_of(response)
    queued.refresh_from_db()
    assert queued.status == BatchStatus.SUCCEEDED


def test_cancel_needs_the_permission_and_a_post(author, queue_manager, queued):
    client = login(author)
    page = client.get(url("generationbatch_change", queued.pk))
    assert page.status_code == 200 and b"Cancel this batch" not in page.content
    assert client.post(url("generationbatch_cancel", queued.pk)).status_code == 403
    assert login(queue_manager).get(url("generationbatch_cancel", queued.pk)).status_code == 405
    queued.refresh_from_db()
    assert queued.status == BatchStatus.QUEUED


# --- retry --------------------------------------------------------------------------------


def test_retrying_a_partially_failed_batch_completes_it_without_duplicates(queue_manager, settings):
    batch = partially_failed(queue_manager, settings)
    settings.LAI_STUDIO_RUN_MODE = "inline"
    client = login(queue_manager)
    page = client.get(url("generationbatch_change", batch.pk))
    assert b"Retry failed chunks" in page.content
    with override_model_client(FakeModelClient()):
        response = client.post(url("generationbatch_retry", batch.pk), follow=True)
    assert "1 failed chunk(s) queued again." in messages_of(response)
    batch.refresh_from_db()
    assert batch.status == BatchStatus.SUCCEEDED and batch.retry_count == 1
    stems = list(Question.objects.filter(batch=batch).values_list("stem", flat=True))
    assert len(stems) == 10 and len(set(stems)) == 10
    page = client.get(url("generationbatch_change", batch.pk))
    assert b"Retry failed chunks" not in page.content


def test_retry_needs_the_permission(author, queue_manager, settings):
    batch = partially_failed(queue_manager, settings)
    client = login(author)
    page = client.get(url("generationbatch_change", batch.pk))
    assert b"Retry failed chunks" not in page.content
    assert client.post(url("generationbatch_retry", batch.pk)).status_code == 403
    assert client.get(url("generationbatch_retry", batch.pk)).status_code == 405
    batch.refresh_from_db()
    assert batch.status == BatchStatus.PARTIALLY_FAILED and batch.retry_count == 0


def test_retrying_a_succeeded_batch_is_refused(queue_manager, queued, fake):
    generation.run_batch(queued.pk)
    response = login(queue_manager).post(url("generationbatch_retry", queued.pk), follow=True)
    assert "Only a failed or partially failed batch can retry." in messages_of(response)


def test_queue_operations_are_audited_without_content(queue_manager, queued, caplog):
    with caplog.at_level("INFO", logger="lai.admin_audit"):
        login(queue_manager).post(url("generationbatch_cancel", queued.pk))
    lines = [r.getMessage() for r in caplog.records if r.name == "lai.admin_audit"]
    assert lines == [f"studio_cancel staff={queue_manager.pk} batch={queued.pk} outcome=cancelled"]


# --- bulk actions -------------------------------------------------------------------------


def offered(user):
    response = login(user).get(url("generationbatch_changelist"))
    form = response.context["action_form"]
    return set(dict(form.fields["action"].choices)) if form else set()


def test_bulk_actions_are_offered_only_with_permission(author, queue_manager, queued):
    assert offered(queue_manager) >= {"action_cancel", "action_retry"}
    assert not offered(author) & {"action_cancel", "action_retry", "delete_selected"}
    canceller = make_staff("canceller", "view_generationbatch", "cancel_generationbatch")
    assert "action_cancel" in offered(canceller) and "action_retry" not in offered(canceller)


def test_bulk_cancel_reports_refusals(queue_manager, queued, settings, fake):
    finished = generation.run_batch(generation.create_batch(queue_manager, params(count=5)).pk)
    response = login(queue_manager).post(
        url("generationbatch_changelist"),
        {"action": "action_cancel", "_selected_action": [str(queued.pk), str(finished.pk)]},
        follow=True,
    )
    text = " ".join(messages_of(response))
    assert "1 batch(es): cancel requested." in text and "already finished" in text
    queued.refresh_from_db()
    assert queued.status == BatchStatus.CANCELLED


def test_bulk_cancel_without_permission_changes_nothing(author, queued):
    login(author).post(
        url("generationbatch_changelist"),
        {"action": "action_cancel", "_selected_action": [str(queued.pk)]},
    )
    queued.refresh_from_db()
    assert queued.status == BatchStatus.QUEUED


def test_bulk_retry_queues_failed_chunks(queue_manager, settings):
    batch = partially_failed(queue_manager, settings)
    settings.LAI_STUDIO_RUN_MODE = "manual"
    response = login(queue_manager).post(
        url("generationbatch_changelist"),
        {"action": "action_retry", "_selected_action": [str(batch.pk)]},
        follow=True,
    )
    assert "1 batch(es): failed chunks queued again." in " ".join(messages_of(response))
    batch.refresh_from_db()
    assert batch.status == BatchStatus.QUEUED and batch.retry_count == 1


# --- workers ------------------------------------------------------------------------------


def test_worker_admin_needs_view_permission_and_is_read_only(author, queue_manager):
    alive = StudioWorker.objects.create(worker_id="w-alive", hostname="h", pid=1)
    StudioWorker.objects.create(
        worker_id="w-old", state=WorkerState.RUNNING, last_seen_at=now() - timedelta(minutes=5)
    )
    assert login(author).get(url("studioworker_changelist")).status_code == 403
    client = login(queue_manager)
    page = client.get(url("studioworker_changelist"))
    body = page.content.decode()
    assert page.status_code == 200 and "w-alive" in body and "w-old" in body
    assert body.count('alt="True"') == 1 and body.count('alt="False"') == 1
    assert client.get(url("studioworker_add")).status_code == 403
    assert client.get(url("studioworker_change", alive.pk)).status_code == 200
    client.post(url("studioworker_change", alive.pk), {"worker_id": "renamed"})
    assert client.post(url("studioworker_delete", alive.pk), {"post": "yes"}).status_code == 403
    alive.refresh_from_db()
    assert alive.worker_id == "w-alive"
