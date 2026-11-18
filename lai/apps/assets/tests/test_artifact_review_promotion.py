"""Review, staff capture and promotion of derived artifacts (ADR-066)."""

import threading

import pytest
from django.db import connection

from apps.assets import artifact_promotion, artifacts, services
from apps.assets.artifacts import ArtifactRefused
from apps.assets.models import ArtifactState, AssetVersion, DerivedArtifact, VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.storage import get_storage
from apps.assets.tests.helpers import make_definition
from apps.assets.tests.media_files import ogg_bytes, png_bytes, webp_bytes

from .artifact_helpers import (
    deliver,
    make_job,
    real_artifact,
    real_audio_source,
    recorded,
    sha,
    user_with,
    write,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REVIEW = ("view_derivedartifact", "review_derivedartifact")
PROMOTE = ("view_derivedartifact", "promote_derivedartifact")


# --- review ------------------------------------------------------------------------------------


def test_accept_and_reject_need_the_review_permission():
    _v, _j, artifact = recorded()
    outsider = user_with("view_derivedartifact")
    for action in (artifacts.accept_artifact, artifacts.reject_artifact):
        with pytest.raises(ArtifactRefused) as refused:
            action(artifact, outsider)
        assert refused.value.code == "permission_denied"
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.PENDING_REVIEW and artifact.reviewed_by is None


def test_accept_protects_and_reject_sets_the_short_deadline(settings):
    _v, _j, artifact = recorded()
    reviewer = user_with(*REVIEW)
    accepted = artifacts.accept_artifact(artifact, reviewer)
    assert accepted.state == ArtifactState.ACCEPTED and accepted.expires_at is None
    assert accepted.reviewed_by_id == reviewer.pk
    rejected = artifacts.reject_artifact(accepted, reviewer)
    assert rejected.state == ArtifactState.REJECTED and rejected.expires_at is not None
    with pytest.raises(ArtifactRefused):
        artifacts.reject_artifact(rejected, reviewer)  # already rejected


def test_hold_toggles_and_refuses_removed_artifacts():
    _v, _j, artifact = recorded()
    reviewer = user_with(*REVIEW)
    assert artifacts.set_hold(artifact, reviewer, hold=True).retention_hold is True
    assert artifacts.set_hold(artifact, reviewer, hold=False).retention_hold is False
    DerivedArtifact.objects.filter(pk=artifact.pk).update(state="expired")
    with pytest.raises(ArtifactRefused):
        artifacts.set_hold(artifact, reviewer, hold=True)


def test_inactive_or_anonymous_users_are_refused():
    _v, _j, artifact = recorded()
    with pytest.raises(ArtifactRefused):
        artifacts.accept_artifact(artifact, None)
    reviewer = user_with(*REVIEW)
    reviewer.is_active = False
    with pytest.raises(ArtifactRefused):
        artifacts.accept_artifact(artifact, reviewer)


# --- staff capture -----------------------------------------------------------------------------


@pytest.fixture
def glb(settings):
    from apps.assets.tests.helpers import make_version

    settings.LAI_THUMBNAIL_CAPTURE = "on"
    return make_version(make_definition("npc-pip"))


def test_capture_is_stored_create_only_and_pending(glb):
    capturer = user_with("capture_derivedartifact")
    data = png_bytes(8, 4)
    artifact = artifacts.record_staff_capture(glb, capturer, data, "image/png")
    assert artifact.state == ArtifactState.PENDING_REVIEW
    assert artifact.producer == "staff_capture" and artifact.job_id is None
    assert artifact.captured_by_id == capturer.pk
    assert artifact.metadata == {"width": 8, "height": 4}
    assert artifact.sha256 == sha(data)
    assert artifact.storage_key.endswith(f"/capture/{artifact.pk}.png")
    assert get_storage().open(artifact.storage_key).read() == data


def test_capture_is_refused_unless_enabled_and_permitted(glb, settings):
    capturer = user_with("capture_derivedartifact")
    with pytest.raises(ArtifactRefused) as refused:
        artifacts.record_staff_capture(
            glb, user_with("view_derivedartifact"), png_bytes(), "image/png"
        )
    assert refused.value.code == "permission_denied"
    settings.LAI_THUMBNAIL_CAPTURE = "off"
    with pytest.raises(ArtifactRefused) as refused:
        artifacts.record_staff_capture(glb, capturer, png_bytes(), "image/png")
    assert refused.value.code == "capture_disabled"
    assert DerivedArtifact.objects.count() == 0 and not list(get_storage().list("processing/"))


@pytest.mark.parametrize(
    ("data", "content_type", "code"),
    [
        (b"not an image at all, only text", "image/png", "bad_image"),
        (png_bytes(), "image/webp", "bad_image"),  # the browser's claim is not trusted
        (webp_bytes(), "image/png", "bad_image"),
        (b"", "image/png", "size"),
        (b"\x89PNG\r\n\x1a\n" + b"0" * (512 * 1024), "image/png", "size"),
        (png_bytes(), "image/jpeg", "role_not_allowed"),
        (b"<script>alert(1)</script>", "text/html", "role_not_allowed"),
    ],
)
def test_capture_validates_bytes_and_type_on_the_server(glb, data, content_type, code):
    with pytest.raises(ArtifactRefused) as refused:
        artifacts.record_staff_capture(
            glb, user_with("capture_derivedartifact"), data, content_type
        )
    assert refused.value.code == code
    assert DerivedArtifact.objects.count() == 0


def test_capture_source_must_be_an_active_glb(glb):
    capturer = user_with("capture_derivedartifact")
    sound = real_audio_source()
    with pytest.raises(ArtifactRefused) as refused:
        artifacts.record_staff_capture(sound, capturer, png_bytes(), "image/png")
    assert refused.value.code == "source_unavailable"
    AssetVersion.objects.filter(pk=glb.pk).update(status=VersionStatus.REJECTED)
    with pytest.raises(ArtifactRefused):
        artifacts.record_staff_capture(glb, capturer, png_bytes(), "image/png")


def test_capture_database_failure_removes_the_object(glb, monkeypatch):
    from django.db import IntegrityError

    def boom(*args, **kwargs):
        raise IntegrityError("simulated")

    monkeypatch.setattr(DerivedArtifact.objects, "create", boom)
    with pytest.raises(ArtifactRefused):
        artifacts.record_staff_capture(
            glb, user_with("capture_derivedartifact"), png_bytes(), "image/png"
        )
    assert list(get_storage().list("processing/")) == []


def test_a_second_capture_supersedes_the_first(glb):
    capturer = user_with("capture_derivedartifact")
    first = artifacts.record_staff_capture(glb, capturer, png_bytes(4, 4), "image/png")
    second = artifacts.record_staff_capture(glb, capturer, png_bytes(6, 6), "image/png")
    first.refresh_from_db()
    assert first.state == ArtifactState.SUPERSEDED and first.superseded_by_id == second.pk
    assert second.state == ArtifactState.PENDING_REVIEW
    assert artifacts.is_inline(second)


def test_a_capture_cannot_be_promoted(glb):
    artifact = artifacts.record_staff_capture(
        glb, user_with("capture_derivedartifact"), png_bytes(), "image/png"
    )
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    assert refused.value.code == "not_promotable"


# --- promotion ---------------------------------------------------------------------------------


def test_promotion_creates_a_new_unpublished_version_with_provenance():
    source, artifact = real_artifact(seconds=2)
    promoter = user_with(*PROMOTE)
    version = artifact_promotion.promote_artifact(artifact, promoter)
    artifact.refresh_from_db()
    assert version.number == 2 and version.asset_id == source.asset_id
    assert version.status == VersionStatus.VALIDATED  # never published
    assert version.published_at is None and version.published_by is None
    assert artifact.state == ArtifactState.PROMOTED
    assert artifact.promoted_version_id == version.pk and artifact.expires_at is None
    assert artifact.promoted_by_id == promoter.pk
    derived = version.metadata["derivedFrom"]
    assert derived["sourceVersion"] == str(source.version_id)
    assert derived["sourceSha256"] == source.sha256
    assert derived["artifactId"] == str(artifact.pk)
    assert derived["processor"] == {"id": "lai.test_transcoder", "version": "1.0.0"}
    assert derived["profile"] == {"id": "audio-opus", "version": 1}
    assert derived["jobId"] == str(artifact.job_id_text)
    assert version.sha256 == artifact.sha256
    assert version.storage_key.startswith("assets/audio/")  # a fresh library key
    source.refresh_from_db()
    assert source.status == VersionStatus.VALIDATED  # the source is untouched


def test_provenance_is_copied_from_the_source():
    source, artifact = real_artifact(seconds=2)
    AssetVersion.objects.filter(pk=source.pk).update(
        metadata={**source.metadata, "licence": "CC0", "credit": "Staff", "secret": "x"}
    )
    version = artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    assert version.metadata["licence"] == "CC0" and version.metadata["credit"] == "Staff"
    assert "secret" not in version.metadata


def test_the_promoted_version_is_published_only_by_the_existing_explicit_action():
    _source, artifact = real_artifact(seconds=2)
    version = artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    assert version.status != VersionStatus.PUBLISHED
    published = services.publish_version(version, user=None)
    assert published.status == VersionStatus.PUBLISHED


def test_unauthorized_promotion_changes_nothing():
    _source, artifact = real_artifact(seconds=2)
    for user in (user_with("view_derivedartifact"), user_with(*REVIEW), None):
        with pytest.raises(ArtifactRefused) as refused:
            artifact_promotion.promote_artifact(artifact, user)
        assert refused.value.code == "permission_denied"
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.PENDING_REVIEW
    assert AssetVersion.objects.filter(asset=artifact.asset).count() == 1


def test_promotion_is_refused_twice():
    _source, artifact = real_artifact(seconds=2)
    promoter = user_with(*PROMOTE)
    artifact_promotion.promote_artifact(artifact, promoter)
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(artifact, promoter)
    assert refused.value.code == "already_promoted"
    assert AssetVersion.objects.filter(asset=artifact.asset).count() == 2


@pytest.mark.parametrize("state", ["rejected", "superseded", "expired", "deleted"])
def test_only_pending_or_accepted_artifacts_are_promotable(state):
    _source, artifact = real_artifact(seconds=2)
    stamp = "2026-01-01T00:00:00Z"
    changes = {"state": state, "reviewed_at": stamp, "superseded_at": stamp}
    if state in ("expired", "deleted"):
        changes.update(object_deleted_at=stamp, job=None)
    DerivedArtifact.objects.filter(pk=artifact.pk).update(
        expires_at="2027-01-01T00:00:00Z", **changes
    )
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    assert refused.value.code == "not_promotable_state"


def test_a_non_promotable_role_is_refused():
    version = real_audio_source()
    job = make_job(version)
    report = b'{"loudness": -16}'
    deliver(
        job,
        [
            write(
                job,
                "report",
                report,
                ext="json",
                role="audio.report",
                content_type="application/json",
            )
        ],
    )
    artifact = DerivedArtifact.objects.get(job_id_text=job.pk)
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    assert refused.value.code == "not_promotable"


def test_a_duplicate_of_an_existing_version_is_refused():
    source = real_audio_source()
    job = make_job(source)
    same_bytes = get_storage().open(source.storage_key).read()
    deliver(job, [write(job, "opus", same_bytes)])
    artifact = DerivedArtifact.objects.get(job_id_text=job.pk)
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    assert refused.value.code == "duplicate_version"
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.PENDING_REVIEW


def test_source_changed_retired_or_rejected_blocks_promotion():
    _source, artifact = real_artifact(seconds=2)
    promoter = user_with(*PROMOTE)
    AssetVersion.objects.filter(pk=artifact.source_version_id).update(sha256="d" * 64)
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(artifact, promoter)
    assert refused.value.code == "source_changed"
    AssetVersion.objects.filter(pk=artifact.source_version_id).update(
        sha256=artifact.source_sha256, status=VersionStatus.REJECTED
    )
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(artifact, promoter)
    assert refused.value.code == "source_unavailable"


def test_a_deleted_source_cannot_exist_while_artifacts_do():
    from django.db.models import ProtectedError

    source, _artifact = real_artifact(seconds=2)
    with pytest.raises(ProtectedError):
        source.delete()
    with pytest.raises(AssetActionRefused) as refused:
        services.delete_unpublished_version(source)
    assert refused.value.code == "has_derived_artifacts"


def test_a_retired_asset_blocks_promotion():
    from apps.catalog.models import AssetStatus, ContentAsset

    _source, artifact = real_artifact(seconds=2)
    ContentAsset.objects.filter(pk=artifact.asset_id).update(status=AssetStatus.RETIRED)
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    assert refused.value.code == "asset_retired"


def test_a_published_source_can_still_be_derived_from():
    source, artifact = real_artifact(seconds=2)
    services.publish_version(source)
    version = artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    assert version.status == VersionStatus.VALIDATED
    source.refresh_from_db()
    assert source.status == VersionStatus.PUBLISHED


def test_a_tampered_object_is_never_promoted():
    _source, artifact = real_artifact(seconds=2)
    storage = get_storage()
    storage.objects[artifact.storage_key] = (ogg_bytes(seconds=3),) + storage.objects[
        artifact.storage_key
    ][1:]
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    assert refused.value.code == "artifact_changed"
    assert AssetVersion.objects.filter(asset=artifact.asset).count() == 1


def test_a_missing_or_unreadable_object_is_refused():
    _source, artifact = real_artifact(seconds=2)
    storage = get_storage()
    storage.fail_next.add("head")
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    assert refused.value.code == "storage_failed"
    del storage.objects[artifact.storage_key]
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    assert refused.value.code == "object_missing"


def test_ktx2_has_no_library_format_yet():
    version = real_audio_source()
    job = make_job(version, kind="asset.optimize", profile=("ktx2-default", 1))
    deliver(
        job,
        [
            write(
                job,
                "tex",
                b"\xabKTX 20\xbb\r\n\x1a\n" + b"\x00" * 20,
                ext="ktx2",
                role="texture.compressed",
                content_type="image/ktx2",
            )
        ],
    )
    artifact = DerivedArtifact.objects.get(job_id_text=job.pk)
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    assert refused.value.code == "format_not_supported"


def test_partial_database_failure_rolls_the_whole_promotion_back(monkeypatch):
    _source, artifact = real_artifact(seconds=2)
    original = DerivedArtifact.save

    def fail_on_promotion(self, *args, **kwargs):
        if self.state == ArtifactState.PROMOTED:
            raise RuntimeError("simulated database failure")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(DerivedArtifact, "save", fail_on_promotion)
    with pytest.raises(RuntimeError):
        artifact_promotion.promote_artifact(artifact, user_with(*PROMOTE))
    monkeypatch.undo()
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.PENDING_REVIEW and artifact.promoted_version is None
    assert AssetVersion.objects.filter(asset=artifact.asset).count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_promotions_create_exactly_one_version():
    _source, artifact = real_artifact(seconds=2)
    promoter = user_with(*PROMOTE)
    barrier = threading.Barrier(2)
    outcomes = []

    def run():
        try:
            barrier.wait(timeout=10)
            outcomes.append(("ok", artifact_promotion.promote_artifact(artifact, promoter).pk))
        except (AssetActionRefused, ArtifactRefused) as refused:
            outcomes.append(("refused", refused.code))
        finally:
            connection.close()

    threads = [threading.Thread(target=run) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    assert sorted(kind for kind, _ in outcomes) == ["ok", "refused"]
    assert AssetVersion.objects.filter(asset=artifact.asset).count() == 2
    assert [c for k, c in outcomes if k == "refused"] == ["already_promoted"]


def test_preview_stream_is_verified_and_permissioned():
    _source, artifact = real_artifact(seconds=2)
    viewer = user_with("view_derivedartifact")
    stream = artifacts.open_for_view(artifact, viewer)
    assert stream.read() == get_storage().open(artifact.storage_key).read()
    with pytest.raises(ArtifactRefused) as refused:
        artifacts.open_for_view(artifact, user_with())
    assert refused.value.code == "permission_denied"
    get_storage().objects[artifact.storage_key] = (b"tampered",) + get_storage().objects[
        artifact.storage_key
    ][1:]
    with pytest.raises(ArtifactRefused) as refused:
        artifacts.open_for_view(artifact, viewer)
    assert refused.value.code == "artifact_changed"
