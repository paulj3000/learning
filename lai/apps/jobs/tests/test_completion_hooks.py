"""The completion hook registry (`apps.jobs.processing`, WAVE3_INTERFACES section 3).

Registration is explicit and deterministic; a hook runs only for an APPLY, in a savepoint, under
the job lock; a hook bug is contained (`hook_error`) and a `DatabaseError` defers the completion.
Uses `reference.checksum` jobs on the in-memory transport; PostgreSQL only.
"""

import pytest
from django.apps import apps
from django.core.exceptions import ImproperlyConfigured
from django.db import OperationalError

from apps.assets.tests.helpers import make_definition
from apps.catalog.models import ContentAsset
from apps.jobs import processing
from apps.jobs.models import CompletionReceipt, JobState
from apps.jobs.processing import HookResult, register_completion_hook
from lai_processing.core.errors import ErrorCode

from .processing_fakes import (
    current_request,
    event_bytes,
    fake_transport,
    result_for,
    submit_reference,
)

__all__ = ["fake_transport"]  # the shared fixture

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

KEY = ("reference.checksum", "test_subject")


@pytest.fixture
def hooks():
    """An empty registry for the test; the real one is restored afterwards."""
    previous = processing.set_completion_hooks_for_tests(None)
    yield
    processing.set_completion_hooks_for_tests(previous)


class Recorder:
    def __init__(self, result=None):
        self.calls = []
        self.result = result or HookResult("recorded")

    def __call__(self, job, attempt, result):
        self.calls.append((str(job.pk), str(attempt.attempt_id), result.status.value))
        return self.result


def _apply(fake, body):
    return processing.apply_completion(body, storage=fake.storage)


# --- registration -------------------------------------------------------------------------------


def test_the_same_callable_again_is_a_no_op_and_another_is_refused(hooks):
    first, second = Recorder(), Recorder()
    register_completion_hook(*KEY, first)
    register_completion_hook(*KEY, first)
    assert processing.completion_hook(*KEY) is first
    with pytest.raises(ImproperlyConfigured):
        register_completion_hook(*KEY, second)
    assert processing.completion_hook(*KEY) is first


@pytest.mark.parametrize(
    ("job_type", "subject_type"),
    [
        ("asset.inspect", "asset_version"),
        ("no.such_kind", "x"),
        ("reference.checksum", ""),
        ("reference.checksum", "s" * 65),
    ],
)
def test_an_unknown_kind_or_bad_subject_type_is_refused(hooks, job_type, subject_type):
    with pytest.raises(ImproperlyConfigured):
        register_completion_hook(job_type, subject_type, Recorder())
    assert processing.completion_hook(job_type, subject_type) is None


def test_the_asset_hook_is_registered_and_a_second_ready_is_a_no_op(hooks):
    from apps.assets.completion import apply_model_validation

    config = apps.get_app_config("assets")
    config.ready()
    config.ready()
    assert processing.completion_hook("asset.validate_model", "asset_version") is (
        apply_model_validation
    )


# --- when a hook runs ---------------------------------------------------------------------------


def test_the_hook_runs_once_for_an_apply_and_never_for_a_duplicate(hooks, fake_transport):
    recorder = Recorder(HookResult("recorded", review_ready=True))
    register_completion_hook(*KEY, recorder)
    job = submit_reference(fake_transport.storage)
    body = event_bytes(result_for(current_request(job)))

    assert _apply(fake_transport, body).action == "apply"
    assert _apply(fake_transport, body).action == "duplicate"
    again = event_bytes(result_for(current_request(job)))  # same attempt, new event id
    assert _apply(fake_transport, again).action == "duplicate"

    assert len(recorder.calls) == 1
    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.READY_FOR_REVIEW, "recorded")


def test_the_hook_never_runs_for_retry_reject_or_stale(hooks, fake_transport):
    recorder = Recorder()
    register_completion_hook(*KEY, recorder)
    job = submit_reference(fake_transport.storage)
    first = current_request(job)

    retried = _apply(fake_transport, event_bytes(result_for(first, status="failed")))
    assert retried.action == "retry"
    forged = result_for(first, sha256="c" * 64)
    assert _apply(fake_transport, event_bytes(forged)).action == "reject"
    late = _apply(fake_transport, event_bytes(result_for(first)))
    assert late.action in ("duplicate", "stale")  # attempt 1 was recorded by the retry
    second = current_request(job)
    assert processing.cancel_job(job, user=None)
    assert _apply(fake_transport, event_bytes(result_for(second))).action == "stale"

    assert recorder.calls == []
    job.refresh_from_db()
    assert job.subject_outcome == ""


def test_the_hook_runs_for_an_applied_failure_without_review(hooks, fake_transport):
    recorder = Recorder(HookResult("noted", review_ready=True))
    register_completion_hook(*KEY, recorder)
    job = submit_reference(fake_transport.storage)
    failed = result_for(current_request(job), status="failed", code=ErrorCode.INVALID_INPUT)

    assert _apply(fake_transport, event_bytes(failed)).action == "apply"

    assert [call[2] for call in recorder.calls] == ["failed"]
    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.FAILED, "noted")


def test_without_review_ready_the_job_stays_validated(hooks, fake_transport):
    register_completion_hook(*KEY, Recorder(HookResult("x" * 80)))
    job = submit_reference(fake_transport.storage)

    assert _apply(fake_transport, event_bytes(result_for(current_request(job)))).action == "apply"

    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.VALIDATED, "x" * 64)


def test_a_job_without_a_hook_is_applied_as_before(hooks, fake_transport):
    job = submit_reference(fake_transport.storage)
    assert _apply(fake_transport, event_bytes(result_for(current_request(job)))).action == "apply"
    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.VALIDATED, "")


# --- failures -----------------------------------------------------------------------------------


def test_a_hook_bug_rolls_back_its_savepoint_and_keeps_the_result(hooks, fake_transport, caplog):
    def buggy(job, attempt, result):
        make_definition("hook-write")
        raise RuntimeError("secret detail")

    register_completion_hook(*KEY, buggy)
    job = submit_reference(fake_transport.storage)

    with caplog.at_level("ERROR", logger="lai.jobs"):
        outcome = _apply(fake_transport, event_bytes(result_for(current_request(job))))

    assert outcome.action == "apply"
    assert not ContentAsset.objects.filter(asset_id="hook-write").exists()
    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.VALIDATED, "hook_error")
    assert job.result["status"] == "succeeded"
    assert CompletionReceipt.objects.get(job=job).action == "apply"
    assert "processing.hook_error" in caplog.text and "RuntimeError" in caplog.text
    assert "secret detail" not in caplog.text


def test_a_database_error_defers_the_whole_completion(hooks, fake_transport):
    calls = []

    def flaky(job, attempt, result):
        calls.append(1)
        make_definition(f"hook-write-{len(calls)}")
        if len(calls) == 1:
            raise OperationalError("connection lost")
        return HookResult("done")

    register_completion_hook(*KEY, flaky)
    job = submit_reference(fake_transport.storage)
    body = event_bytes(result_for(current_request(job)))

    with pytest.raises(processing.CompletionDeferred):
        _apply(fake_transport, body)
    job.refresh_from_db()
    assert (job.state, job.result, job.subject_outcome) == (JobState.QUEUED, None, "")
    assert not CompletionReceipt.objects.exists()
    assert not ContentAsset.objects.filter(asset_id__startswith="hook-write").exists()

    assert _apply(fake_transport, body).action == "apply"
    job.refresh_from_db()
    assert (job.state, job.subject_outcome) == (JobState.VALIDATED, "done")
    assert list(ContentAsset.objects.values_list("asset_id", flat=True)) == ["hook-write-2"]
