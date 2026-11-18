"""Sound Manager transcoding and normalising (`asset.transcode_audio`, ADR-067): permissions, the
feature control, the submission payload, result application and what staff see. The worker is a
fake result (the real worker is covered in tests/lambda); no AWS, no network, no FFmpeg."""

from types import SimpleNamespace

import pytest
from django.contrib.auth.models import Group, Permission
from django.test import Client

from apps.assets.models import AssetVersion, DerivedArtifact, IMMUTABLE_FIELDS
from apps.assets.tests import artifact_helpers as helpers
from apps.audio import transcoding
from apps.audio.management.commands.ensure_sound_roles import EDITORS, PUBLISHERS
from apps.audio.tests.helpers import audio_asset, cue
from apps.jobs import services as jobs
from apps.jobs.models import JobStatus, ProcessingJob
from apps.jobs.tests.helpers import FakeSQS, use_sqs
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db(transaction=True)]

AUDIO_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-jobs-audio"
FILES = "/admin/audio/audiofile/"
CUES = "/admin/audio/soundcue/"
OGG, MP3 = helpers.OGG, b"\xff\xfb\x90\x00" + b"\x00" * 60


@pytest.fixture(autouse=True)
def real_processor(monkeypatch):
    monkeypatch.setattr(helpers, "PROCESSOR", (transcoding.PROCESSOR_ID, transcoding.processor_version()))


@pytest.fixture
def sqs(settings):
    fake = FakeSQS()
    use_sqs(settings)
    settings.LAI_AUDIO_TRANSCODING = "on"
    settings.LAI_JOBS_AUDIO_QUEUE_URL = AUDIO_URL
    jobs.set_aws_clients(sqs=fake)
    yield fake
    jobs.set_aws_clients()


def staff(username, *, groups=(), perms=(), is_staff=True):
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}", admin_username=username, is_staff=is_staff
    )
    account.groups.set(Group.objects.filter(name__in=groups))
    for name in perms:
        app_label, codename = name.split(".")
        account.user_permissions.add(
            Permission.objects.get(content_type__app_label=app_label, codename=codename)
        )
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


def run_action(client, url, pks, action):
    return client.post(
        url, {"action": action, "_selected_action": [str(pk) for pk in pks]}, follow=True
    )


def frozen(version) -> dict:
    version.refresh_from_db()
    return {n: getattr(version, n) for n in (*IMMUTABLE_FIELDS, "status", "retired_at")}


def music_cue():
    asset, version = audio_asset("music-harbor-theme", category="music")
    sound = cue("music.harbor.theme", asset=asset)
    return sound, version


def outputs_metadata(job, normalize):
    def out(label, ctype, rate, kbps):
        return {
            "label": label, "content_type": ctype, "duration_seconds": 12.04, "bitrate_kbps": kbps,
            "sample_rate_hz": rate, "channels": 2, "size_bytes": 1000,
            "measured_after": {"integrated_lufs": -18.1, "true_peak_dbtp": -2.4,
                               "sample_peak_dbfs": -2.6, "loudness_range_lu": 3.0},
        }

    return {
        "normalize": normalize,
        "source": {"format": "wav", "codec": "pcm", "duration_seconds": 12.0,
                   "sample_rate_hz": 44100, "channels": 2},
        "measured_before": {l: {"integrated_lufs": -30.4, "true_peak_dbtp": -21.0, "mode": "integrated"}
                            for l in ("opus", "mp3")},
        "gain_db": {"opus": 12.4, "mp3": 12.4},
        "outputs": [out("opus", "audio/ogg", 48000, 96), out("mp3", "audio/mpeg", 44100, 128)],
        "tool": {"name": "ffmpeg", "version": "7.1.5", "license_class": "lgpl"},
        "tool_versions": {"ffmpeg": "7.1.5"},
        "artifact_facts": {"opus": {"duration_seconds": 12.04, "bitrate_kbps": 96},
                           "mp3": {"duration_seconds": 12.04, "bitrate_kbps": 128}},
    }


def deliver_outputs(job, normalize=True):
    opus = helpers.write(job, "opus", OGG)
    mp3 = helpers.write(job, "mp3", MP3, ext="mp3", content_type="audio/mpeg")
    mp3["content_type"] = "audio/mpeg"
    report = helpers.write(job, "report", b"{}", ext="json", role="audio.report",
                           content_type="application/json")
    report["content_type"] = "application/json"
    return helpers.deliver(job, [opus, mp3, report], metadata=outputs_metadata(job, normalize))


# --- control, permissions, payload --------------------------------------------------------------


def test_control_off_refuses_with_a_safe_message_and_records_nothing(sqs, settings):
    settings.LAI_AUDIO_TRANSCODING = "off"
    sound, version = music_cue()
    with pytest.raises(jobs.WorkloadUnavailable):
        transcoding.submit_transcode(version, normalize=True, user=None)
    assert ProcessingJob.objects.filter(kind=transcoding.JOB_TYPE).count() == 0 and sqs.sent == []
    client = staff("edith", groups=[EDITORS])
    page = run_action(client, CUES, [sound.pk], "normalize_audio").content.decode()
    assert "switched off" in page and "Traceback" not in page
    assert not ProcessingJob.objects.filter(kind=transcoding.JOB_TYPE).exists() and sqs.sent == []


def test_control_on_submits_the_profile_for_the_cue_channel(sqs):
    sound, version = music_cue()
    before = frozen(version)
    job = transcoding.submit_transcode(version, normalize=True, user=None)
    assert job.kind == "asset.transcode_audio" and job.queue == "audio"
    request = sqs.sent[0]["Body"]["payload"]
    assert sqs.sent[0]["QueueUrl"] == AUDIO_URL
    assert request["profile"] == {"profile_id": "audio-music", "version": 1}
    assert request["options"] == {"normalize": True}
    assert request["input"]["sha256"] == version.sha256
    assert request["limits"]["max_input_bytes"] == 20 * 1024 * 1024 and request["limits"]["max_artifact_count"] == 4
    assert request["idempotency_key"].startswith("ik1:")
    assert frozen(version) == before


def test_transcode_and_normalize_are_different_work_and_resubmission_is_idempotent(sqs):
    _sound, version = music_cue()
    a = transcoding.submit_transcode(version, normalize=False, user=None)
    b = transcoding.submit_transcode(version, normalize=True, user=None)
    assert a.pk != b.pk and a.payload["options"] == {"normalize": False}
    assert transcoding.submit_transcode(version, normalize=True, user=None).pk == b.pk
    assert len(sqs.sent) == 2


def test_the_channel_must_be_clear(sqs):
    asset, version = audio_asset("loose-sound")
    with pytest.raises(transcoding.TranscodeRefused) as raised:
        transcoding.submit_transcode(version, normalize=True, user=None)
    assert raised.value.code == "channel_needed"
    cue("sfx.loose.one", asset=asset)
    cue("ui.loose.two", asset=asset)
    with pytest.raises(transcoding.TranscodeRefused):
        transcoding.submit_transcode(version, normalize=True, user=None)
    assert transcoding.submit_transcode(version, normalize=True, user=None, channel="sfx").payload[
        "profile"
    ]["profile_id"] == "audio-sfx"
    with pytest.raises(transcoding.TranscodeRefused) as raised:
        transcoding.submit_transcode(version, normalize=True, user=None, channel="pet")
    assert raised.value.code == "bad_channel"


def test_a_non_audio_version_is_refused(sqs):
    version = helpers.source_version()
    with pytest.raises(transcoding.TranscodeRefused) as raised:
        transcoding.submit_transcode(version, normalize=True, user=None)
    assert raised.value.code == "not_audio"


# --- admin actions and permissions ----------------------------------------------------------------


def test_editors_can_run_both_actions_from_cues_and_files(sqs):
    sound, version = music_cue()
    client = staff("edith", groups=[EDITORS])
    page = run_action(client, CUES, [sound.pk], "transcode_audio").content.decode()
    assert "Transcoding submitted for 1 file(s)" in page and "Nothing was changed or published" in page
    page = run_action(client, FILES, [version.pk], "normalize_audio").content.decode()
    assert "Normalising submitted for 1 file(s)" in page
    jobs_made = list(transcoding.transcode_jobs(version))
    assert sorted(j.payload["options"]["normalize"] for j in jobs_made) == [False, True]
    assert all(j.submitted_by.admin_username == "edith" for j in jobs_made)
    again = run_action(client, FILES, [version.pk], "normalize_audio").content.decode()
    assert "already queued or running" in again
    assert len(jobs_made) == 2


def test_publishers_have_the_permission_too_and_viewers_do_not(sqs):
    sound, version = music_cue()
    assert "audio.transcode_audiofile" in {
        f"{p.content_type.app_label}.{p.codename}" for p in Group.objects.get(name=PUBLISHERS).permissions.all()
    }
    viewer = staff("vera", perms=["audio.view_audiofile", "audio.view_soundcue"])
    for url, pk in ((FILES, version.pk), (CUES, sound.pk)):
        run_action(viewer, url, [pk], "transcode_audio")
        run_action(viewer, url, [pk], "normalize_audio")
    assert not ProcessingJob.objects.filter(kind="asset.transcode_audio").exists() and sqs.sent == []
    assert staff("nobody").get(FILES).status_code == 403
    parent = staff("parent", perms=["audio.view_audiofile", "audio.transcode_audiofile"], is_staff=False)
    assert parent.get(FILES).status_code == 302


# --- results -------------------------------------------------------------------------------------


def test_a_worker_result_records_private_previews_and_staff_see_the_facts(sqs):
    sound, version = music_cue()
    before = frozen(version)
    client = staff("edith", groups=[EDITORS, "Asset editors"])
    run_action(client, CUES, [sound.pk], "normalize_audio")
    job = transcoding.latest_job(AssetVersion.objects.get(pk=version.pk))
    ProcessingJob.objects.filter(pk=job.pk).update(status=JobStatus.RUNNING)
    job.refresh_from_db()
    deliver_outputs(job)
    job.refresh_from_db()
    assert job.subject_outcome == "artifacts_recorded", job.subject_outcome
    rows = DerivedArtifact.objects.filter(job=job)
    assert {r.logical_id: r.state for r in rows} == {
        "opus": "pending_review", "mp3": "pending_review", "report": "pending_review",
    }
    assert rows.get(logical_id="opus").metadata["bitrate_kbps"] == 96
    detail = client.get(f"{FILES}{version.pk}/change/").content.decode()
    for needle in ("Normalised to the channel target", "audio/ogg", "audio/mpeg", "96 kbit/s",
                   "-30.4 to -18.1 LUFS", "-21 to -2.4 dBTP", "12.4 dB", "ffmpeg 7.1.5",
                   "Review and promote", "Nothing is published or replaced"):
        assert needle in detail, needle
    opus = rows.get(logical_id="opus")
    assert f"/admin/assets/derivedartifact/{opus.pk}/media/" in detail
    assert f"/admin/assets/derivedartifact/{opus.pk}/change/" in detail
    assert "Normalised to the channel target" in client.get(f"{CUES}{sound.pk}/change/").content.decode()
    # Nothing was replaced: the version, the cue's version and every asset field are as before.
    assert frozen(version) == before
    sound.refresh_from_db()
    assert sound.asset.default_version_id == version.pk and sound.pinned_version_id is None
    assert AssetVersion.objects.filter(asset=sound.asset).count() == 1
    assert rows.get(logical_id="opus").promoted_version_id is None


def test_values_in_a_result_are_escaped_and_bounded(sqs):
    sound, version = music_cue()
    job = transcoding.submit_transcode(version, normalize=False, user=None)
    ProcessingJob.objects.filter(pk=job.pk).update(status=JobStatus.RUNNING)
    job.refresh_from_db()
    meta = outputs_metadata(job, False)
    meta["tool"]["version"] = "<script>alert(1)</script>"
    helpers.deliver(job, [helpers.write(job, "opus", OGG)], metadata=meta)
    client = staff("edith", groups=[EDITORS])
    detail = client.get(f"{FILES}{version.pk}/change/").content.decode()
    assert "<script>alert(1)</script>" not in detail and "&lt;script&gt;" in detail
    assert "Converted, level kept" in detail


def test_an_outdated_processor_result_is_not_recorded(sqs, monkeypatch):
    _sound, version = music_cue()
    job = transcoding.submit_transcode(version, normalize=True, user=None)
    ProcessingJob.objects.filter(pk=job.pk).update(status=JobStatus.RUNNING)
    job.refresh_from_db()
    monkeypatch.setattr(helpers, "PROCESSOR", (transcoding.PROCESSOR_ID, "0.0.1"))
    deliver_outputs(job)
    job.refresh_from_db()
    assert job.subject_outcome == "processor_outdated"
    assert not DerivedArtifact.objects.filter(job=job).exists()


def test_the_resolver_knows_every_profile_and_rejects_others():
    from apps.assets import artifact_results

    resolver = artifact_results.PROCESSOR_VERSION_RESOLVERS["asset.transcode_audio"]
    for channel in ("sfx", "ui", "ambient", "music", "voice"):
        assert resolver(f"audio-{channel}", 1) == (transcoding.PROCESSOR_ID, transcoding.processor_version())
    assert resolver("audio-music", 2) is None and resolver("audio-pet", 1) is None


def test_an_unfinished_job_shows_progress(sqs):
    _sound, version = music_cue()
    transcoding.submit_transcode(version, normalize=True, user=None)
    client = staff("edith", groups=[EDITORS])
    detail = client.get(f"{FILES}{version.pk}/change/").content.decode()
    assert "Queued" in detail and "In progress: no result yet." in detail
