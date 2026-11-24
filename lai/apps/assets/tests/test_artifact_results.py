"""Result application for derived-artifact workloads (ADR-066): verification, idempotency, stale
sources, forged references and all-or-none recording."""

import logging

import pytest

from apps.assets.artifact_storage import ArtifactStorageUnavailable
from apps.assets.models import ArtifactState, AssetVersion, DerivedArtifact, VersionStatus
from apps.assets.storage import get_storage
from apps.jobs import services
from apps.jobs.models import JobStatus

from .artifact_helpers import (
    OGG,
    PNG,
    deliver,
    make_job,
    recorded,
    reference,
    sha,
    source_version,
    write,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def test_valid_artifact_is_recorded_pending_review():
    version, job, artifact = recorded(metadata={"tool_versions": {"ffmpeg": "7.1"}})
    assert job.status == JobStatus.COMPLETED
    assert job.subject_outcome == "artifacts_recorded"
    assert artifact.state == ArtifactState.PENDING_REVIEW
    assert artifact.source_version_id == version.pk
    assert artifact.asset_id == version.asset_id
    assert artifact.source_sha256 == version.sha256
    assert artifact.sha256 == sha(OGG) and artifact.size_bytes == len(OGG)
    assert artifact.role == "audio.transcoded" and artifact.logical_id == "opus"
    assert artifact.processor_id == "lai.test_transcoder"
    assert (artifact.profile_id, artifact.profile_version) == ("audio-opus", 1)
    assert artifact.job_id == job.pk and artifact.expires_at is not None
    assert artifact.metadata == {"tool_versions": {"ffmpeg": "7.1"}}
    assert artifact.storage_key.startswith("processing/artifacts/")


def test_duplicate_delivery_creates_nothing_more():
    version, job, artifact = recorded()
    again = deliver(job, [reference(job, "opus", OGG)])
    assert again == services.DUPLICATE
    assert DerivedArtifact.objects.count() == 1


def test_redelivery_after_rollback_is_idempotent_by_attempt_and_logical_id():
    version, job, artifact = recorded()
    from apps.assets.artifact_results import apply_artifact_result

    job.refresh_from_db()
    assert apply_artifact_result(job) == "artifacts_recorded"
    assert DerivedArtifact.objects.count() == 1


def test_two_artifacts_one_attempt():
    version = source_version()
    job = make_job(version)
    opus, mp3 = OGG, b"ID3" + b"\x00" * 40
    deliver(
        job,
        [
            write(job, "opus", opus),
            write(job, "mp3", mp3, ext="mp3", content_type="audio/mpeg"),
        ],
    )
    assert sorted(DerivedArtifact.objects.values_list("logical_id", flat=True)) == ["mp3", "opus"]


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(lambda r: r.update(sha256="a" * 64), id="wrong checksum"),
        pytest.param(lambda r: r.update(size_bytes=r["size_bytes"] + 1), id="wrong size"),
        pytest.param(lambda r: r.update(content_type="text/html"), id="content type"),
        pytest.param(lambda r: r.update(artifact_type="audio.surprise"), id="undeclared role"),
        pytest.param(
            lambda r: r.update(artifact_type="image.thumbnail"), id="role of another kind"
        ),
        pytest.param(lambda r: r.update(size_bytes=0), id="empty"),
    ],
)
def test_one_bad_reference_records_nothing(mutate):
    version = source_version()
    job = make_job(version)
    good = write(job, "opus", OGG)
    bad = write(job, "second", OGG + b"1")
    mutate(bad)
    deliver(job, [good, bad])
    job.refresh_from_db()
    assert DerivedArtifact.objects.count() == 0
    assert job.subject_outcome in ("artifact_invalid", "result_invalid", "")


def test_forged_storage_key_is_refused():
    version = source_version()
    job = make_job(version)
    forged = write(job, "opus", OGG)
    other_attempt = "00000000-0000-4000-8000-000000000000"
    forged["ref"]["key"] = forged["ref"]["key"].replace(job.payload["attempt_id"], other_attempt)
    deliver(job, [forged])
    job.refresh_from_db()
    assert DerivedArtifact.objects.count() == 0
    assert job.status == JobStatus.COMPLETED
    assert job.subject_outcome in ("artifact_invalid", "result_invalid")


def test_key_under_assets_or_another_job_is_refused():
    version = source_version()
    job = make_job(version)
    data = OGG
    get_storage().put(
        "assets/audio/npc-pip/x/audio.ogg",
        __import__("io").BytesIO(data),
        content_type="audio/ogg",
        sha256=sha(data),
    )
    ref = reference(job, "opus", data, key="assets/audio/npc-pip/x/audio.ogg")
    deliver(job, [ref])
    job.refresh_from_db()
    assert DerivedArtifact.objects.count() == 0
    assert job.subject_outcome in ("artifact_invalid", "result_invalid")


def test_extension_must_agree_with_content_type():
    version = source_version()
    job = make_job(version)
    ref = write(job, "opus", OGG, ext="html")
    deliver(job, [ref])
    job.refresh_from_db()
    assert DerivedArtifact.objects.count() == 0
    assert job.subject_outcome == "artifact_invalid"


def test_missing_object_is_invalid_not_retried():
    version = source_version()
    job = make_job(version)
    ref = reference(job, "opus", OGG)  # never written
    assert deliver(job, [ref]) == services.APPLIED
    job.refresh_from_db()
    assert job.subject_outcome == "artifact_invalid"
    assert DerivedArtifact.objects.count() == 0


def test_object_with_other_bytes_is_invalid():
    version = source_version()
    job = make_job(version)
    ref = write(job, "opus", OGG)
    ref["sha256"] = sha(b"something else")
    deliver(job, [ref])
    job.refresh_from_db()
    assert job.subject_outcome == "artifact_invalid"
    assert DerivedArtifact.objects.count() == 0


def test_storage_fault_rolls_back_and_is_retryable():
    version = source_version()
    job = make_job(version)
    ref = write(job, "opus", OGG)
    get_storage().fail_next.add("head")
    with pytest.raises(ArtifactStorageUnavailable):
        deliver(job, [ref])
    job.refresh_from_db()
    assert job.status == JobStatus.RUNNING  # the whole application rolled back
    assert DerivedArtifact.objects.count() == 0
    assert deliver(job, [ref]) == services.APPLIED  # the redelivered message succeeds
    assert DerivedArtifact.objects.count() == 1


def test_a_403_is_never_read_as_missing():
    from apps.assets import artifact_storage as store
    from apps.assets.storage import S3AssetStorage, StorageError

    class Denied(Exception):
        response = {"Error": {"Code": "403"}, "ResponseMetadata": {"HTTPStatusCode": 403}}

    class Client:
        def head_object(self, **kwargs):
            from botocore.exceptions import ClientError

            raise ClientError(Denied.response, "HeadObject")

    s3 = S3AssetStorage("bucket", "us-west-1", client=Client())
    with pytest.raises(StorageError) as raised:
        s3.head("processing/artifacts/dev/x")
    assert type(raised.value) is StorageError  # not ObjectMissing
    assert store.ArtifactObjectMissing is not store.ArtifactStorageUnavailable


def test_stale_source_changed_object_records_no_rows():
    version = source_version()
    job = make_job(version)
    ref = write(job, "opus", OGG)
    AssetVersion.objects.filter(pk=version.pk).update(sha256="b" * 64)
    deliver(job, [ref])
    job.refresh_from_db()
    assert job.status == JobStatus.COMPLETED
    assert job.subject_outcome == "stale_source"
    assert DerivedArtifact.objects.count() == 0


def test_stale_source_deleted_or_rejected():
    version = source_version()
    job = make_job(version)
    ref = write(job, "opus", OGG)
    AssetVersion.objects.filter(pk=version.pk).update(status=VersionStatus.REJECTED)
    deliver(job, [ref])
    job.refresh_from_db()
    assert job.subject_outcome == "stale_source"
    other = source_version("npc-two")
    job2 = make_job(other)
    ref2 = write(job2, "opus", OGG)
    other.delete()
    deliver(job2, [ref2])
    job2.refresh_from_db()
    assert job2.subject_outcome == "stale_source"
    assert DerivedArtifact.objects.count() == 0


def test_published_source_is_not_stale():
    version = source_version(status=VersionStatus.PUBLISHED)
    job = make_job(version)
    deliver(job, [write(job, "opus", OGG)])
    job.refresh_from_db()
    assert job.subject_outcome == "artifacts_recorded"


def test_failed_job_records_nothing():
    version = source_version()
    job = make_job(version)
    services.fail_job(job.pk, "timeout")
    job.refresh_from_db()
    assert job.subject_outcome == "processing_failed"
    assert DerivedArtifact.objects.count() == 0


def test_processor_outdated(monkeypatch):
    from apps.assets import artifact_results

    monkeypatch.setitem(
        artifact_results.PROCESSOR_VERSION_RESOLVERS,
        "asset.transcode_audio",
        lambda profile_id, version: ("lai.test_transcoder", "2.0.0"),
    )
    version = source_version()
    job = make_job(version)
    deliver(job, [write(job, "opus", OGG)])
    job.refresh_from_db()
    assert job.subject_outcome == "processor_outdated"
    assert DerivedArtifact.objects.count() == 0


def test_newer_run_supersedes_older_rows():
    version = source_version()
    first_job = make_job(version)
    deliver(first_job, [write(first_job, "opus", OGG)])
    second_job = make_job(version)
    deliver(second_job, [write(second_job, "opus", OGG + b"2")])
    old = DerivedArtifact.objects.get(job_id_text=first_job.pk)
    new = DerivedArtifact.objects.get(job_id_text=second_job.pk)
    assert old.state == ArtifactState.SUPERSEDED
    assert old.superseded_by_id == new.pk and old.expires_at is not None
    assert new.state == ArtifactState.PENDING_REVIEW


def test_late_result_of_an_older_job_does_not_displace_newer_work():
    version = source_version()
    older_job = make_job(version)
    newer_job = make_job(version)
    deliver(newer_job, [write(newer_job, "opus", OGG + b"n")])
    deliver(older_job, [write(older_job, "opus", OGG + b"o")])
    assert DerivedArtifact.objects.get(job_id_text=newer_job.pk).state == (
        ArtifactState.PENDING_REVIEW
    )
    assert DerivedArtifact.objects.get(job_id_text=older_job.pk).state == ArtifactState.SUPERSEDED


def test_logs_carry_no_file_names(caplog):
    caplog.set_level(logging.INFO, logger="lai.assets")
    recorded()
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "processing/artifacts" not in text and ".ogg" not in text
    assert "artifacts_recorded" in text


def test_oversized_result_is_bounded():
    from apps.assets import artifact_results

    version = source_version()
    job = make_job(version)
    deliver(job, [write(job, "opus", OGG)], metadata={"note": "x"})
    assert artifact_results.MAX_RESULT_BYTES == 4 * 1024 * 1024
    assert artifact_results.MAX_ARTIFACTS_PER_RESULT == 16


def test_image_kind_roles_and_png_bytes():
    version = source_version("img-one")
    job = make_job(version, kind="asset.convert_image", profile=("image-webp", 1))
    ref = write(job, "thumb-256", PNG, ext="png", role="image.thumbnail", content_type="image/png")
    deliver(job, [ref])
    job.refresh_from_db()
    assert job.subject_outcome == "artifacts_recorded"
    assert DerivedArtifact.objects.get().role == "image.thumbnail"


# --- review fixes (DB-F3, DB-F6, DB-F8) ---------------------------------------------------------


def _resolver(monkeypatch, version):
    from apps.assets import artifact_results

    monkeypatch.setitem(
        artifact_results.PROCESSOR_VERSION_RESOLVERS,
        "asset.transcode_audio",
        lambda profile_id, v: ("lai.test_transcoder", version),
    )


def _deliver_with_processor(version_text, processor_version):
    version = source_version()
    job = make_job(version)
    artifact = write(job, "opus", OGG)
    artifact["processor"] = {
        "processor_id": "lai.test_transcoder",
        "processor_version": processor_version,
    }
    deliver(
        job,
        [artifact],
        processor={"processor_id": "lai.test_transcoder", "processor_version": processor_version},
    )
    job.refresh_from_db()
    return job


def test_a_newer_processor_version_is_accepted(monkeypatch):
    _resolver(monkeypatch, "1.0.0")
    job = _deliver_with_processor("1.0.0", "1.1.0")
    assert job.subject_outcome == "artifacts_recorded"
    assert DerivedArtifact.objects.count() == 1


def test_processor_versions_compare_as_numbers_not_text(monkeypatch):
    _resolver(monkeypatch, "1.10.0")
    job = _deliver_with_processor("1.10.0", "1.9.0")  # "1.9.0" > "1.10.0" as text
    assert job.subject_outcome == "processor_outdated"
    assert DerivedArtifact.objects.count() == 0
    _resolver(monkeypatch, "1.9.0")
    assert _deliver_with_processor("1.9.0", "1.10.0").subject_outcome == "artifacts_recorded"


def test_a_different_processor_id_is_outdated(monkeypatch):
    from apps.assets import artifact_results

    assert artifact_results.processor_outdated(("a", "1.0.0"), ("b", "2.0.0")) is True
    assert artifact_results.processor_outdated(("a", "1.0"), ("a", "1.0.0")) is False
    assert artifact_results.processor_outdated(("a", "1.0.0"), ("a", "1.0.0rc1")) is True
    assert artifact_results.processor_outdated(None, ("a", "0")) is False


@pytest.mark.parametrize("verdict", ["fail", "not_applicable"])
def test_a_non_pass_verdict_records_no_artifact_and_is_not_applied(verdict):
    from apps.assets import artifact_results

    version = source_version()
    job = make_job(version)
    deliver(job, [write(job, "opus", OGG)], verdict=verdict)
    job.refresh_from_db()
    assert DerivedArtifact.objects.count() == 0
    assert job.subject_outcome == "result_not_applied"
    assert job.subject_outcome not in artifact_results.APPLIED_OUTCOMES


@pytest.mark.django_db(transaction=True)
def test_objects_are_verified_before_the_asset_and_version_locks(monkeypatch):
    """While storage is read, a second connection can still lock the asset and version rows."""
    import threading

    from django.db import connection, transaction

    from apps.assets import artifact_storage as store
    from apps.catalog.models import ContentAsset

    version = source_version()
    job = make_job(version)
    ref = write(job, "opus", OGG)
    seen = []
    real = store.verify

    def probing(*args, **kwargs):
        def probe():
            try:
                with transaction.atomic():
                    ContentAsset.objects.select_for_update(nowait=True).get(pk=version.asset_id)
                    AssetVersion.objects.select_for_update(nowait=True).get(pk=version.pk)
                seen.append("free")
            except Exception as error:  # noqa: BLE001 - a lock error means it was held
                seen.append(type(error).__name__)
            finally:
                connection.close()

        thread = threading.Thread(target=probe)
        thread.start()
        thread.join(10)
        return real(*args, **kwargs)

    monkeypatch.setattr(store, "verify", probing)
    assert deliver(job, [ref]) == services.APPLIED
    assert seen == ["free"]
    assert DerivedArtifact.objects.count() == 1


def test_the_source_is_rechecked_after_the_locks(monkeypatch):
    """A source that changes between verification and the locks records nothing."""
    from apps.assets import artifact_storage as store

    version = source_version()
    job = make_job(version)
    ref = write(job, "opus", OGG)
    real = store.verify

    def verify_then_change(*args, **kwargs):
        real(*args, **kwargs)
        AssetVersion.objects.filter(pk=version.pk).update(sha256="c" * 64)

    monkeypatch.setattr(store, "verify", verify_then_change)
    deliver(job, [ref])
    job.refresh_from_db()
    assert job.subject_outcome == "stale_source"
    assert DerivedArtifact.objects.count() == 0
