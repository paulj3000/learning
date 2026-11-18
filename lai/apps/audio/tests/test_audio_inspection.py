"""Background audio inspection (`asset.process_audio`, LAI-LAMBDA-008 phase 1) on the canonical
jobs path: submission, idempotency, result verification, stale versions, immutability of
published audio, the Sound Manager admin and its permissions. No AWS: the inline backend runs the
real inspector in process, and the SQS backend uses fake clients."""

import hashlib
import importlib.util
import io
import struct
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from django.contrib.auth.models import Group, Permission
from django.test import Client

from apps.assets import services as asset_services
from apps.assets.jobs import InlinePorts
from apps.assets.models import IMMUTABLE_FIELDS, AssetVersion, VersionStatus
from apps.assets.storage import get_storage
from apps.assets.tests.helpers import make_definition, make_version
from apps.assets.tests.media_files import mp3_bytes, wav_bytes
from apps.assets.validation_media import max_audio_bytes
from apps.audio import inspection
from apps.audio.management.commands.ensure_sound_roles import EDITORS
from apps.audio.tests.helpers import audio_asset, cue
from apps.jobs import services as jobs
from apps.jobs.core import contract, envelope
from apps.jobs.models import JobStatus, ProcessingJob
from apps.jobs.tests.helpers import FakeS3, FakeSQS, use_sqs
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount
from lai_processing.processors.audio.processor import AUDIO_PROFILE

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

_BUILDER = Path(__file__).resolve().parents[4] / "tests/processing/audio_builder.py"


def _builder():
    """tests/processing/audio_builder.py (spec-exact Ogg pages, with real checksums)."""
    name = "lai_audio_builder"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, _BUILDER)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name]


def ogg_vorbis(seconds=1.0) -> bytes:
    return _builder().ogg_vorbis(seconds=seconds)


FILES = "/admin/audio/audiofile/"
CUES = "/admin/audio/soundcue/"


@pytest.fixture
def aws(settings):
    use_sqs(settings)
    fakes = SimpleNamespace(sqs=FakeSQS(), s3=FakeS3())
    jobs.set_aws_clients(sqs=fakes.sqs, s3=fakes.s3)
    yield fakes
    jobs.set_aws_clients()


def published(data: bytes = None, asset_id="coin-clink", name="a.wav"):
    """A published audio version through the real upload and publish services."""
    asset = make_definition(asset_id, kind="audio", category="sound")
    version = asset_services.upload_version(
        asset, io.BytesIO(data or wav_bytes()), original_filename=name
    )
    return asset_services.publish_version(version)


def stored(data: bytes, *, asset_id="odd-sound", content_type="audio/wav", fmt="wav", **fields):
    """A version row with `data` in the asset store (for declared-type cases the upload refuses)."""
    asset = make_definition(asset_id, kind="audio", category="sound")
    row = make_version(
        asset,
        storage_key=f"assets/audio/{asset_id}/v1/audio.{fmt}",
        content_type=content_type,
        format=fmt,
        clips=[],
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
        **fields,
    )
    get_storage().put(
        row.storage_key, io.BytesIO(data), content_type=content_type, sha256=row.sha256
    )
    return row


def frozen(version) -> dict:
    version.refresh_from_db()
    return {name: getattr(version, name) for name in (*IMMUTABLE_FIELDS, "status", "retired_at")}


def message(job, status="succeeded", *, result=None, code=None) -> dict:
    return envelope.build_result(
        str(job.pk),
        job.kind,
        status,
        result=result,
        error_code=code,
        function="lai-dev-jobs-media",
        request_id="req-1",
    )


def worker_result(job) -> dict:
    return contract.run(job.kind, job.payload, InlinePorts())


# --- the inline path, every format --------------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "name", "codec", "kind"),
    [
        (wav_bytes(seconds=2), "a.wav", "pcm", "exact"),
        (mp3_bytes(frames=20), "a.mp3", "mp3", "estimated"),
        (ogg_vorbis(seconds=1), "a.ogg", "vorbis", "exact"),
    ],
)
def test_inspecting_published_audio_records_the_result_on_the_job_only(data, name, codec, kind):
    version = published(data, name=name)
    before = frozen(version)
    job = inspection.submit_audio_inspection(version, user=None)
    job.refresh_from_db()
    assert job.kind == "asset.process_audio" and job.queue == "media"
    assert job.status == JobStatus.COMPLETED, job.error_code
    assert job.subject_outcome == "inspection_recorded"
    assert job.idempotency_key.startswith("ik1:")
    metadata = job.result["metadata"]
    assert metadata["codec"] == codec and metadata["duration_kind"] == kind
    assert job.result["verdict"] == "pass"
    assert frozen(version) == before  # bytes, metadata and report of the published version
    summary = inspection.inspection_summary(job)
    assert summary["codec"] == codec and summary["limitations"]


def test_the_profile_input_limit_is_the_audio_upload_ceiling():
    assert AUDIO_PROFILE.limits.max_input_bytes == max_audio_bytes() == 20 * 1024 * 1024


def test_audio_is_never_inspected_on_upload(settings):
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    version = published()
    assert version.status == VersionStatus.PUBLISHED
    assert not ProcessingJob.objects.filter(kind="asset.process_audio").exists()


# --- submission rules ---------------------------------------------------------------------------


def test_a_non_audio_version_is_refused():
    version = make_version(make_definition("chest-model"))
    with pytest.raises(jobs.JobsError) as raised:
        inspection.submit_audio_inspection(version, user=None)
    assert raised.value.code == "not_audio"


def test_an_oversized_version_is_refused_before_a_job_exists():
    version = stored(wav_bytes())
    AssetVersion.objects.filter(pk=version.pk).update(size_bytes=20 * 1024 * 1024 + 1)
    version.refresh_from_db()
    with pytest.raises(jobs.JobsError) as raised:
        inspection.submit_audio_inspection(version, user=None)
    assert raised.value.code == "resource_limit_exceeded"
    assert not inspection.inspection_jobs(version).exists()


def test_an_invalid_declared_type_is_a_failing_finding():
    version = stored(wav_bytes(), content_type="image/png")
    job = inspection.submit_audio_inspection(version, user=None)
    job.refresh_from_db()
    assert job.subject_outcome == "inspection_recorded" and job.result["verdict"] == "fail"
    codes = {f["code"] for f in job.result["findings"]}
    assert codes == {"declared_type_not_audio"}
    assert job.result["metadata"]["detected_format"] == "wav"


def test_a_declared_type_that_disagrees_with_the_bytes_is_a_failing_finding():
    version = stored(ogg_vorbis(), content_type="audio/mpeg", fmt="mp3", asset_id="liar")
    job = inspection.submit_audio_inspection(version, user=None)
    job.refresh_from_db()
    assert {f["code"] for f in job.result["findings"]} == {"declared_type_mismatch"}
    assert job.result["metadata"]["detected_format"] == "ogg"


def test_a_malformed_file_succeeds_with_verdict_fail():
    broken = wav_bytes()[:-500]
    version = stored(broken, asset_id="cut-short")
    job = inspection.submit_audio_inspection(version, user=None)
    job.refresh_from_db()
    assert job.status == JobStatus.COMPLETED and job.result["verdict"] == "fail"
    assert "wav_truncated" in {f["code"] for f in job.result["findings"]}


# --- duplicates and idempotency -----------------------------------------------------------------


def test_the_same_logical_work_returns_the_existing_job(aws):
    version = published()
    first = inspection.submit_audio_inspection(version, user=None)
    assert first.status == JobStatus.PENDING
    assert str(inspection.submit_audio_inspection(version, user=None).pk) == str(first.pk)
    jobs.apply_result(message(first, result=worker_result(first)))
    first.refresh_from_db()
    assert first.subject_outcome == "inspection_recorded"
    assert str(inspection.submit_audio_inspection(version, user=None).pk) == str(first.pk)
    assert inspection.inspection_jobs(version).count() == 1


def test_a_failed_or_refused_job_may_be_submitted_again(aws):
    version = published()
    failed = inspection.submit_audio_inspection(version, user=None)
    jobs.apply_result(message(failed, "failed", code="storage_failure"))
    failed.refresh_from_db()
    assert failed.status == JobStatus.FAILED and failed.subject_outcome == "processing_failed"
    again = inspection.submit_audio_inspection(version, user=None)
    assert str(again.pk) != str(failed.pk) and again.idempotency_key == failed.idempotency_key
    tampered = worker_result(again)
    tampered["attempt_id"] = "00000000-0000-4000-8000-000000000000"
    jobs.apply_result(message(again, result=tampered))
    again.refresh_from_db()
    assert again.subject_outcome == "attempt_mismatch"
    third = inspection.submit_audio_inspection(version, user=None)
    assert str(third.pk) not in (str(failed.pk), str(again.pk))


def test_a_duplicate_result_is_a_no_op(aws):
    version = published()
    before = frozen(version)
    job = inspection.submit_audio_inspection(version, user=None)
    body = message(job, result=worker_result(job))
    assert jobs.apply_result(body) == jobs.APPLIED
    job.refresh_from_db()
    recorded = (job.result, job.subject_outcome, job.finished_at)
    assert jobs.apply_result(body) == jobs.DUPLICATE
    assert jobs.apply_result(message(job, "running")) == jobs.DUPLICATE
    job.refresh_from_db()
    assert (job.result, job.subject_outcome, job.finished_at) == recorded
    assert job.deliveries == 3
    assert frozen(version) == before


# --- verification and stale versions ------------------------------------------------------------


def test_a_result_for_another_input_is_refused(aws):
    version = published()
    job = inspection.submit_audio_inspection(version, user=None)
    result = worker_result(job)
    result["input"]["sha256"] = "0" * 64
    jobs.apply_result(message(job, result=result))
    job.refresh_from_db()
    assert job.subject_outcome == "input_mismatch"
    assert inspection.inspection_summary(job) is None


def test_a_result_for_a_stale_version_is_refused(aws):
    version = stored(wav_bytes(), asset_id="replaced")
    job = inspection.submit_audio_inspection(version, user=None)
    result = worker_result(job)
    # The (unpublished) row now describes different bytes than the inspected request.
    AssetVersion.objects.filter(pk=version.pk).update(sha256="f" * 64)
    jobs.apply_result(message(job, result=result))
    job.refresh_from_db()
    assert job.subject_outcome == "checksum_mismatch"
    version.refresh_from_db()
    assert version.metadata == {} and version.sha256 == "f" * 64


def test_a_result_for_a_deleted_version_is_recorded_as_missing(aws):
    version = stored(wav_bytes(), asset_id="gone")
    job = inspection.submit_audio_inspection(version, user=None)
    result = worker_result(job)
    version.delete()
    jobs.apply_result(message(job, result=result))
    job.refresh_from_db()
    assert job.subject_outcome == "version_missing"


def test_a_newer_version_does_not_inherit_an_older_inspection():
    asset, first = audio_asset("drum-hit")
    inspection.submit_audio_inspection(first, user=None)
    second = asset_services.publish_version(
        asset_services.upload_version(
            asset, io.BytesIO(wav_bytes(seconds=2)), original_filename="b.wav"
        )
    )
    assert inspection.latest_job(first) is not None
    assert inspection.latest_job(AssetVersion.objects.get(pk=second.pk)) is None


# --- Django Admin -------------------------------------------------------------------------------


def staff(username, *, groups=(), perms=(), is_staff=True):
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}",
        admin_username=username,
        is_staff=is_staff,
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


def run_action(client, url, pks, action="inspect_audio"):
    return client.post(
        url, {"action": action, "_selected_action": [str(pk) for pk in pks]}, follow=True
    )


def test_sound_editors_can_inspect_audio_files_from_the_admin():
    client = staff("edith", groups=[EDITORS])
    version = published()
    page = client.get(FILES)
    assert page.status_code == 200 and "coin-clink@1" in page.content.decode()
    response = run_action(client, FILES, [version.pk])
    assert "Audio inspection submitted for 1 file(s)" in response.content.decode()
    job = inspection.latest_job(AssetVersion.objects.get(pk=version.pk))
    assert job.status == JobStatus.COMPLETED and job.submitted_by.admin_username == "edith"
    detail = client.get(f"{FILES}{version.pk}/change/").content.decode()
    assert "Inspected: the headers are consistent" in detail
    assert f"/admin/jobs/processingjob/{job.pk}/change/" in detail
    assert "does not prove the file is decodable" in detail
    assert "pcm" in detail
    response = run_action(client, FILES, [version.pk])
    assert "already inspected" in response.content.decode()
    assert inspection.inspection_jobs(version).count() == 1


def test_the_cue_action_inspects_the_cue_version():
    client = staff("edith", groups=[EDITORS])
    sound = cue("sfx.coin.collect")
    response = run_action(client, CUES, [sound.pk])
    assert "Audio inspection submitted for 1 file(s)" in response.content.decode()
    version = sound.asset.default_version
    assert inspection.latest_job(version).subject_outcome == "inspection_recorded"
    detail = client.get(f"{CUES}{sound.pk}/change/").content.decode()
    assert "Audio inspection" in detail and "Inspected: the headers are consistent" in detail


def test_staff_without_the_permission_cannot_inspect():
    viewer = staff("vera", perms=["audio.view_audiofile", "audio.view_soundcue"])
    version = published()
    assert viewer.get(FILES).status_code == 200
    run_action(viewer, FILES, [version.pk])
    assert not inspection.inspection_jobs(version).exists()
    sound = cue("sfx.bell.ring")
    run_action(viewer, CUES, [sound.pk])
    assert not ProcessingJob.objects.filter(kind="asset.process_audio").exists()


def test_non_staff_and_unprivileged_staff_cannot_see_audio_files():
    published()
    assert staff("nobody").get(FILES).status_code == 403
    granted = staff(
        "parent", perms=["audio.view_audiofile", "audio.inspect_audiofile"], is_staff=False
    )
    assert granted.get(FILES).status_code == 302  # the admin login page


def test_audio_files_are_read_only_and_list_audio_only():
    client = staff("edith", groups=[EDITORS])
    audio = published()
    model = make_version(make_definition("chest-model"))
    listing = client.get(FILES).content.decode()
    assert "coin-clink@1" in listing and "chest-model" not in listing
    assert client.get(f"{FILES}{model.pk}/change/").status_code == 302  # not in the queryset
    assert client.get(f"{FILES}add/").status_code == 403
    assert client.post(f"{FILES}{audio.pk}/delete/", {"post": "yes"}).status_code == 403
    assert AssetVersion.objects.filter(pk=audio.pk).exists()


def test_the_result_panel_escapes_every_value(aws):
    client = staff("edith", groups=[EDITORS])
    version = published()
    job = inspection.submit_audio_inspection(version, user=None)
    result = worker_result(job)
    jobs.apply_result(message(job, result=result))
    job.refresh_from_db()
    hostile = dict(job.result)
    hostile["metadata"] = {
        **hostile["metadata"],
        "codec": "<script>alert(1)</script>",
        "limitations": [{"code": "x", "message": "<img src=x onerror=alert(2)>"}],
    }
    hostile["findings"] = [
        {"code": "x", "severity": "error", "message": "<b>bold</b>", "path": "<i>"}
    ]
    ProcessingJob.objects.filter(pk=job.pk).update(result=hostile)
    detail = client.get(f"{FILES}{version.pk}/change/").content.decode()
    assert "<script>alert(1)" not in detail and "&lt;script&gt;alert(1)" in detail
    assert "<img src=x" not in detail and "<b>bold</b>" not in detail


def test_a_failed_job_is_reported_and_can_be_resubmitted_from_the_admin(aws):
    client = staff("edith", groups=[EDITORS])
    version = published()
    job = inspection.submit_audio_inspection(version, user=None)
    jobs.apply_result(message(job, "failed", code="processing_timeout"))
    detail = client.get(f"{FILES}{version.pk}/change/").content.decode()
    assert "The inspection failed, so there is no result." in detail
    response = run_action(client, FILES, [version.pk])
    assert "a new one was submitted" in response.content.decode()
    assert inspection.inspection_jobs(version).count() == 2


def test_an_inspection_never_publishes_or_changes_a_release():
    from apps.audio.models import SoundRelease

    client = staff("edith", groups=[EDITORS])
    sound = cue("sfx.door.open")
    releases = SoundRelease.objects.count()
    version = sound.asset.default_version
    before = frozen(version)
    run_action(client, CUES, [sound.pk])
    assert SoundRelease.objects.count() == releases
    assert frozen(version) == before
    sound.refresh_from_db()
    assert sound.pinned_version_id is None


def test_header_problems_the_upload_check_accepts_are_reported():
    """The upload check (validation_media) does not read the full Vorbis identification header;
    the inspector does. The Asset Library's minimal test Ogg has a 26-byte identification packet,
    so it passes upload and the inspection fails it."""
    from apps.assets.tests.media_files import ogg_bytes

    version = published(ogg_bytes(), asset_id="lenient-ogg", name="a.ogg")
    job = inspection.submit_audio_inspection(version, user=None)
    job.refresh_from_db()
    assert job.result["verdict"] == "fail"
    codes = {f["code"] for f in job.result["findings"]}
    assert "ogg_vorbis_header_invalid" in codes and "ogg_crc_mismatch" not in codes
    assert version.status == VersionStatus.PUBLISHED  # nothing was changed


def test_a_damaged_ogg_stored_before_the_upload_crc_check_is_reported():
    """Ogg files uploaded before the upload check verified page checksums may be damaged; the
    upload now refuses them, and the inspection still reports a stored one."""
    from apps.assets.tests.media_files import ogg_bytes

    with pytest.raises(asset_services.AssetActionRefused) as refused:
        published(ogg_bytes(crc=False), asset_id="damaged-ogg-upload", name="a.ogg")
    assert "ogg_crc" in {f.code for f in refused.value.findings}
    version = stored(
        ogg_bytes(crc=False), asset_id="damaged-ogg", content_type="audio/ogg", fmt="ogg"
    )
    job = inspection.submit_audio_inspection(version, user=None)
    job.refresh_from_db()
    assert job.result["verdict"] == "fail"
    assert "ogg_crc_mismatch" in {f["code"] for f in job.result["findings"]}


def test_the_wav_fixture_helper_is_valid_riff():
    data = wav_bytes()
    assert data[:4] == b"RIFF" and struct.unpack("<I", data[4:8])[0] + 8 == len(data)
