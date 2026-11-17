"""Shared NPC speech through the media worker (speech.synthesize jobs; fake Polly and SQS only)."""

import pytest

from apps.jobs import services as jobs
from apps.jobs.core import envelope, tasks
from apps.jobs.models import JobStatus, ProcessingJob
from apps.jobs.tests.helpers import FakeSQS, use_sqs
from apps.npcs.publishing import publish
from apps.npcs.speech import pregenerate_release_speech
from apps.speech import jobs as speech_jobs
from apps.speech import services
from apps.speech.models import ClipScope, SpeechClip, SpeechDailyTotal
from apps.speech.polly import FakePollyClient, set_polly_client
from apps.speech.storage import get_speech_storage, reset_speech_storage_cache

from .helpers import make_staff
from .test_voice_validation import make_profile, voiced

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture(autouse=True)
def fresh_speech():
    set_polly_client(None)
    reset_speech_storage_cache()
    services._concurrency = None  # noqa: SLF001
    yield
    set_polly_client(None)
    reset_speech_storage_cache()
    services._concurrency = None  # noqa: SLF001


@pytest.fixture
def sqs(settings):
    use_sqs(settings)
    fake = FakeSQS()
    jobs.set_aws_clients(sqs=fake)
    yield fake
    jobs.set_aws_clients()


def resolved_line(text="Ahoy there, friend!", scope=ClipScope.AUTHORED):
    profile = make_profile()
    return services.Resolved(text, profile, scope, "npc:test")


def counters():
    total = SpeechDailyTotal.objects.first()
    return (total.cache_misses, total.characters_synthesized) if total else (0, 0)


def test_inline_job_records_exactly_what_the_synchronous_path_records():
    line = resolved_line()
    assert services.queue_shared_clip(line) == "queued"  # the inline backend runs it now
    clip = SpeechClip.objects.get()
    job = ProcessingJob.objects.get()
    assert job.status == JobStatus.COMPLETED and job.subject_type == "speech.clip"
    assert clip.scope == ClipScope.AUTHORED and clip.expires_at is None
    assert clip.storage_key == job.payload["storage_key"]
    assert clip.storage_key.startswith("speech/shared/")
    assert get_speech_storage().read(clip.storage_key).startswith(b"ID3")
    assert counters() == (1, len(line.text))
    expected_key = services.cache_key(line, None)
    assert clip.cache_key == expected_key
    # Compare with the synchronous path on a fresh cache.
    SpeechClip.objects.all().delete()
    SpeechDailyTotal.objects.all().delete()
    assert services.prepare_shared_clip(line) is True
    sync = SpeechClip.objects.get()
    assert (sync.cache_key, sync.storage_key, sync.characters) == (
        clip.cache_key,
        clip.storage_key,
        clip.characters,
    )
    assert counters() == (1, len(line.text))


def test_cached_lines_are_not_queued_again():
    line = resolved_line()
    services.queue_shared_clip(line)
    assert services.queue_shared_clip(line) == "cached"
    assert ProcessingJob.objects.count() == 1


def test_child_scoped_text_never_becomes_a_job():
    line = resolved_line(scope=ClipScope.CHILD)
    with pytest.raises(services.SpeechError):
        services.queue_shared_clip(line)
    assert not ProcessingJob.objects.exists()


def test_the_worker_refuses_a_child_key():
    line = resolved_line()
    payload = services.shared_clip_payload(line, services.cache_key(line, None))
    payload["storage_key"] = payload["storage_key"].replace("speech/shared/", "speech/child/")
    with pytest.raises(tasks.TaskError) as raised:
        tasks.run(envelope.SPEECH_SYNTHESIZE, payload, speech_jobs.InlinePorts())
    assert raised.value.code == "invalid_speech_key"


def test_sqs_pregeneration_queues_then_records_once(sqs, django_capture_on_commit_callbacks):
    voiced()
    release = publish(make_staff())
    fake = FakePollyClient()
    set_polly_client(fake)
    with django_capture_on_commit_callbacks(execute=True):
        report = pregenerate_release_speech(release)
    assert (report.queued, report.synthesized, report.failed) == (2, 0, 0)
    assert fake.calls == [] and SpeechClip.objects.count() == 0  # Polly runs in the worker
    assert len(sqs.sent) == 2 and {m["QueueUrl"] for m in sqs.sent} == {
        "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-jobs-media"
    }
    # A second pass while the jobs are in flight queues nothing new.
    with django_capture_on_commit_callbacks(execute=True):
        again = pregenerate_release_speech(release)
    assert again.queued == 2 and len(sqs.sent) == 2
    # The worker (its task code, in process) answers; results are applied once.
    characters = 0
    for message in sqs.sent:
        work = envelope.parse_work(message["Body"])
        result = tasks.run(work["kind"], work["payload"], speech_jobs.InlinePorts())
        final = envelope.build_result(work["job_id"], work["kind"], "succeeded", result=result)
        assert jobs.apply_result(final) == jobs.APPLIED
        assert jobs.apply_result(final) == jobs.DUPLICATE
        characters += work["payload"]["characters"]
    assert SpeechClip.objects.count() == 2
    assert counters() == (2, characters)
    assert len(fake.calls) == 2
    with django_capture_on_commit_callbacks(execute=True):
        assert pregenerate_release_speech(release).cached == 2


def test_a_failed_speech_job_is_counted(sqs, django_capture_on_commit_callbacks):
    line = resolved_line()
    with django_capture_on_commit_callbacks(execute=True):
        services.queue_shared_clip(line)
    work = envelope.parse_work(sqs.sent[0]["Body"])
    failed = envelope.build_result(
        work["job_id"], work["kind"], "failed", error_code="access_denied"
    )
    jobs.apply_result(failed)
    assert SpeechClip.objects.count() == 0
    assert SpeechDailyTotal.objects.get().failures == 1


def test_the_command_reports_queued_lines(sqs, capsys, django_capture_on_commit_callbacks):
    from django.core.management import call_command

    voiced()
    publish(make_staff())
    with django_capture_on_commit_callbacks(execute=True):
        call_command("npc_pregenerate_speech")
    assert "queued 2" in capsys.readouterr().out
