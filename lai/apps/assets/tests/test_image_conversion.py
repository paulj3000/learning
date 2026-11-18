"""Image conversion in the Asset Library (LAI-LAMBDA-013a, ADR-068): staff actions, permissions,
the control, submission through `submit_derived_job`, result application with fake worker
results, the staff display, promotion with the metadata-free outputs, and stale and duplicate
results through the shared handler. No AWS, no Pillow (the worker side is in tests/native_image)."""

import hashlib
import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse

from apps.assets import artifact_results, image_conversion
from apps.assets.artifact_promotion import promote_artifact
from apps.assets.models import (
    ArtifactState,
    AssetVersion,
    DerivedArtifact,
    FileFormat,
    VersionStatus,
)
from apps.assets.storage import get_storage
from apps.jobs import services
from apps.jobs.models import JobStatus, ProcessingJob
from apps.jobs.tests.helpers import FakeSQS, use_sqs
from lai_native.image import contract

from . import artifact_helpers as helpers
from .artifact_helpers import deliver, make_job, reference, source_version, user_with
from .helpers import make_definition, make_version
from .media_files import png_bytes, webp_bytes
from .test_admin import EDITORS, VERSIONS, run_action, staff

pytestmark = [pytest.mark.postgres, pytest.mark.django_db(transaction=True)]

IMAGE_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-jobs-image"
PROCESSOR = (contract.PROCESSOR_ID, contract.PROCESSOR_VERSION)
SECRET = b"SecretMaker"


@pytest.fixture(autouse=True)
def roles():
    call_command("ensure_asset_roles", verbosity=0)


@pytest.fixture(autouse=True)
def processor(monkeypatch):
    """Fake worker results are signed by the real image processor identity."""
    monkeypatch.setattr(helpers, "PROCESSOR", PROCESSOR)


@pytest.fixture
def sqs(settings):
    fake = FakeSQS()
    use_sqs(settings)
    settings.LAI_IMAGE_CONVERSION = "on"
    settings.LAI_JOBS_IMAGE_QUEUE_URL = IMAGE_URL
    services.set_aws_clients(sqs=fake)
    yield fake
    services.set_aws_clients()


def image_version(*, status=VersionStatus.VALIDATED, fmt="png", data=None):
    asset = make_definition(f"icon-{uuid.uuid4().hex[:8]}", kind="image", category="image")
    data = data or png_bytes(64, 48)
    return make_version(
        asset,
        status=status,
        format=fmt,
        content_type=f"image/{fmt}",
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        storage_key=f"assets/images/{asset.asset_id}/{uuid.uuid4()}/image.{fmt}",
        metadata={"width": 64, "height": 48},
        clips=[],
    )


def job_for(version, action=image_conversion.THUMBNAIL, options=None, **kw):
    ref = image_conversion.ACTION_PROFILES[action]
    job = make_job(version, kind=contract.JOB_TYPE, profile=ref, **kw)
    return job


def facts(width, height, **extra):
    return {
        "width": width,
        "height": height,
        "format": "webp",
        "source_width": 64,
        "source_height": 48,
        "source_format": "png",
        "colour_action": "converted_to_srgb",
        "colour_class": "display-p3",
        "alpha_action": "kept",
        "orientation": 0,
        "sanitized": True,
        **extra,
    }


def write_webp(job, logical, data=None, role="image.thumbnail"):
    data = data or webp_bytes(16, 16)
    return helpers.write(
        job, logical, data, ext="webp", role=role, content_type="image/webp"
    )


# --- control, submission, validation ------------------------------------------------------------


def test_control_off_refuses_with_a_safe_message_and_records_nothing(sqs, settings):
    settings.LAI_IMAGE_CONVERSION = "off"
    version = image_version()
    with pytest.raises(image_conversion.ImageConversionRefused) as refused:
        image_conversion.submit(version, image_conversion.THUMBNAIL)
    assert refused.value.code == "workload_disabled"
    assert refused.value.message == "Image conversion is switched off."
    assert "—" not in refused.value.message
    assert ProcessingJob.objects.count() == 0 and sqs.sent == []
    assert image_conversion.enabled() is False


def test_control_on_submits_through_the_shared_helper(sqs):
    version = image_version()
    assert image_conversion.enabled() is True
    job = image_conversion.submit(version, image_conversion.THUMBNAIL)
    assert job.kind == "asset.convert_image" and job.queue == "image"
    work = sqs.sent[0]["Body"]
    assert sqs.sent[0]["QueueUrl"] == IMAGE_URL and work["kind"] == "asset.convert_image"
    request = work["payload"]
    assert request["profile"] == {"profile_id": "image-thumbnails", "version": 1}
    assert request["input"]["sha256"] == version.sha256
    assert request["limits"]["max_input_bytes"] == 10 * 1024 * 1024
    assert request["limits"]["max_execution_seconds"] == 60
    # the idempotency key covers the processor version; the same work returns the same job
    assert image_conversion.submit(version, image_conversion.THUMBNAIL).pk == job.pk
    assert ProcessingJob.objects.count() == 1


def test_convert_and_resize_carry_resolved_options(sqs):
    version = image_version()
    convert = image_conversion.submit(
        version, image_conversion.CONVERT, {"target_format": "png", "purpose": "data"}
    )
    resize = image_conversion.submit(version, image_conversion.RESIZE, {"max_side": 256})
    one = sqs.sent[0]["Body"]["payload"]
    two = sqs.sent[1]["Body"]["payload"]
    assert one["options"]["target_format"] == "png" and one["options"]["purpose"] == "data"
    assert two["options"]["max_side"] == 256 and two["options"]["target_format"] == "source"
    assert convert.idempotency_key != resize.idempotency_key


@pytest.mark.parametrize(
    ("action", "options"),
    [
        (image_conversion.CONVERT, {"target_format": "jpeg", "purpose": "data"}),
        (image_conversion.CONVERT, {"target_format": "gif"}),
        (image_conversion.CONVERT, {"quality": 0}),
        (image_conversion.RESIZE, {"max_side": 5}),
        (image_conversion.RESIZE, {"max_side": 9000}),
        (image_conversion.THUMBNAIL, {"max_side": 64}),
        (image_conversion.CONVERT, {"unknown": 1}),
    ],
)
def test_invalid_settings_are_refused_before_anything_is_recorded(sqs, action, options):
    with pytest.raises(image_conversion.ImageConversionRefused) as refused:
        image_conversion.submit(image_version(), action, options)
    assert refused.value.code == "invalid_options"
    assert ProcessingJob.objects.count() == 0 and sqs.sent == []


def test_only_validated_published_or_retired_images(sqs):
    for status in (VersionStatus.DRAFT, VersionStatus.REJECTED):
        version = image_version(status=status)
        with pytest.raises(image_conversion.ImageConversionRefused) as refused:
            image_conversion.submit(version, image_conversion.THUMBNAIL)
        assert refused.value.code == "not_eligible"
    for status in (VersionStatus.VALIDATED, VersionStatus.PUBLISHED, VersionStatus.RETIRED):
        image_conversion.submit(image_version(status=status), image_conversion.THUMBNAIL)
    model = source_version()
    with pytest.raises(image_conversion.ImageConversionRefused) as refused:
        image_conversion.submit(model, image_conversion.THUMBNAIL)
    assert refused.value.code == "not_image"


def test_attempts_are_capped(sqs, settings):
    settings.LAI_ASSET_VALIDATION_MAX_ATTEMPTS = 1
    version = image_version()
    first = image_conversion.submit(version, image_conversion.THUMBNAIL)
    services.fail_job(first.pk, "timeout")
    with pytest.raises(image_conversion.ImageConversionRefused) as refused:
        image_conversion.submit(version, image_conversion.THUMBNAIL)
    assert refused.value.code == "attempts_exhausted"


def test_submission_never_changes_the_version_or_publishes(sqs):
    version = image_version(status=VersionStatus.PUBLISHED)
    before = AssetVersion.objects.filter(pk=version.pk).values().get()
    image_conversion.submit(version, image_conversion.RESIZE, {"max_side": 64})
    assert AssetVersion.objects.filter(pk=version.pk).values().get() == before


# --- the admin actions --------------------------------------------------------------------------


def test_actions_need_the_upload_and_view_permissions(sqs):
    version = image_version()
    nobody = staff("nobody")
    viewer = user_with("view_assetversion")
    from django.test import Client

    reader = Client()
    reader.force_login(viewer, backend="apps.users.backends.AdminPasswordBackend")
    response = run_action(reader, "generate_thumbnail", version)
    assert ProcessingJob.objects.count() == 0 and response.status_code in (200, 403)
    assert run_action(nobody, "generate_thumbnail", version).status_code in (200, 403)
    assert ProcessingJob.objects.count() == 0
    editor = staff("editor", EDITORS)
    page = editor.get(VERSIONS)
    assert "generate_thumbnail" in page.content.decode()
    assert "convert_image" in page.content.decode() and "resize_image" in page.content.decode()


def test_generate_thumbnail_action_submits_and_reports(sqs):
    version = image_version()
    editor = staff("editor", EDITORS)
    response = run_action(editor, "generate_thumbnail", version)
    text = response.content.decode()
    assert "Generate thumbnail submitted" in text and "nothing is published" in text
    assert ProcessingJob.objects.get().kind == "asset.convert_image"
    assert len(sqs.sent) == 1


def test_action_is_refused_with_a_safe_message_when_the_control_is_off(sqs, settings):
    settings.LAI_IMAGE_CONVERSION = "off"
    version = image_version()
    editor = staff("editor", EDITORS)
    for action in ("generate_thumbnail", "convert_image", "resize_image"):
        text = run_action(editor, action, version).content.decode()
        assert "Image conversion is switched off." in text
    assert ProcessingJob.objects.count() == 0 and sqs.sent == []


def test_convert_and_resize_open_a_settings_page_that_submits(sqs):
    version = image_version()
    editor = staff("editor", EDITORS)
    response = run_action(editor, "convert_image", version)
    assert response.redirect_chain[-1][0].endswith(f"/{version.pk}/image/convert/")
    assert "Output format" in response.content.decode()
    url = f"{VERSIONS}{version.pk}/image/convert/"
    posted = editor.post(
        url,
        {"purpose": "artwork", "quality": 80, "target_format": "jpeg", "flatten_background": ""},
        follow=True,
    )
    assert "Convert image submitted" in posted.content.decode()
    options = sqs.sent[0]["Body"]["payload"]["options"]
    assert options["target_format"] == "jpeg" and options["quality"] == 80
    bad = editor.post(url, {"purpose": "artwork", "quality": 500, "target_format": "jpeg"})
    assert bad.status_code == 200 and len(sqs.sent) == 1
    resize = editor.post(
        f"{VERSIONS}{version.pk}/image/resize/",
        {"purpose": "data", "quality": 85, "max_side": 128, "target_format": "png"},
        follow=True,
    )
    assert "Resize image submitted" in resize.content.decode()


def test_settings_page_is_permission_gated_and_refuses_other_actions(sqs):
    version = image_version()
    assert staff("nobody").get(f"{VERSIONS}{version.pk}/image/convert/").status_code in (302, 403)
    editor = staff("editor", EDITORS)
    assert editor.get(f"{VERSIONS}{version.pk}/image/bogus/").status_code == 403
    model = source_version()
    assert editor.get(f"{VERSIONS}{model.pk}/image/convert/", follow=True).status_code == 200
    assert ProcessingJob.objects.count() == 0


# --- result application, display, promotion -----------------------------------------------------


def delivered(version, action=image_conversion.THUMBNAIL, status=JobStatus.RUNNING):
    job = job_for(version, action, status=status)
    refs = [
        write_webp(job, "thumb-128", webp_bytes(16, 16)),
        write_webp(job, "thumb-256", webp_bytes(32, 16)),
    ]
    metadata = {
        "tool_versions": {"pillow": "13.0.0"},
        "artifact_facts": {"thumb-128": facts(128, 96), "thumb-256": facts(256, 192)},
    }
    deliver(job, refs, metadata=metadata)
    job.refresh_from_db()
    return job


def test_a_fake_result_is_recorded_with_its_facts(sqs):
    version = image_version()
    job = delivered(version)
    assert job.subject_outcome == "artifacts_recorded"
    rows = DerivedArtifact.objects.filter(job_id_text=job.pk).order_by("logical_id")
    assert [r.logical_id for r in rows] == ["thumb-128", "thumb-256"]
    first = rows[0]
    assert first.state == ArtifactState.PENDING_REVIEW and first.role == "image.thumbnail"
    assert first.metadata["width"] == 128 and first.metadata["sanitized"] is True
    assert first.metadata["tool_versions"] == {"pillow": "13.0.0"}
    assert first.processor_id == contract.PROCESSOR_ID
    assert first.source_version_id == version.pk


def test_the_version_page_shows_dimensions_sizes_format_colour_sanitization(sqs):
    version = image_version()
    delivered(version)
    editor = staff("editor", EDITORS)
    text = editor.get(f"{VERSIONS}{version.pk}/change/").content.decode()
    assert "Image conversions" in text
    assert "64 x 48" in text and "128 x 96" in text and "256 x 192" in text
    assert f"{version.size_bytes:,} bytes" in text
    assert "webp" in text and "converted to sRGB (source: display-p3)" in text
    assert "metadata removed" in text
    artifact = DerivedArtifact.objects.filter(logical_id="thumb-128").get()
    assert reverse("admin:assets_derivedartifact_media", args=[artifact.pk]) in text
    assert reverse("admin:assets_derivedartifact_change", args=[artifact.pk]) in text
    assert "nothing is published automatically" in text


def test_a_staff_member_without_artifact_view_does_not_see_the_section(sqs):
    version = image_version()
    delivered(version)
    from django.test import Client

    client = Client()
    only = user_with("view_assetversion", "add_assetversion")
    client.force_login(only, backend="apps.users.backends.AdminPasswordBackend")
    assert "Image conversions" not in client.get(f"{VERSIONS}{version.pk}/change/").content.decode()


def test_outputs_are_never_published_automatically(sqs):
    version = image_version(status=VersionStatus.PUBLISHED)
    delivered(version)
    assert AssetVersion.objects.filter(asset=version.asset).count() == 1
    version.refresh_from_db()
    assert version.status == VersionStatus.PUBLISHED
    assert not DerivedArtifact.objects.exclude(state=ArtifactState.PENDING_REVIEW).exists()


def test_a_promoted_output_is_a_new_unpublished_version_without_metadata(sqs):
    """The worker output is metadata free; promotion re-validates it as an upload and creates a
    new, unpublished version. The original version is not touched."""
    version = image_version(status=VersionStatus.PUBLISHED)
    job = job_for(version, image_conversion.CONVERT)
    data = png_bytes(16, 16)
    ref = helpers.write(
        job, "converted", data, ext="png", role="image.converted", content_type="image/png"
    )
    deliver(job, [ref], metadata={"artifact_facts": {"converted": facts(16, 16, format="png")}})
    artifact = DerivedArtifact.objects.get(logical_id="converted")
    publisher = user_with("promote_derivedartifact", "view_derivedartifact")
    new = promote_artifact(artifact, publisher)
    assert new.status in (VersionStatus.VALIDATED, VersionStatus.DRAFT)
    assert new.status != VersionStatus.PUBLISHED and new.published_at is None
    assert new.format == FileFormat.PNG
    stored = get_storage().get(new.storage_key) if hasattr(get_storage(), "get") else None
    blob = stored.read() if hasattr(stored, "read") else (stored or data)
    assert SECRET not in blob and b"Exif" not in blob and b"GPS" not in blob
    assert new.metadata["derivedFrom"]["processor_id"] == contract.PROCESSOR_ID
    version.refresh_from_db()
    assert version.status == VersionStatus.PUBLISHED
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.PROMOTED


def test_thumbnails_cannot_be_promoted(sqs):
    from apps.assets.services import AssetActionRefused

    version = image_version()
    delivered(version)
    artifact = DerivedArtifact.objects.get(logical_id="thumb-128")
    with pytest.raises(AssetActionRefused):
        promote_artifact(artifact, user_with("promote_derivedartifact", "view_derivedartifact"))


# --- stale, duplicate and outdated results ------------------------------------------------------


def test_duplicate_delivery_creates_nothing_more(sqs):
    version = image_version()
    job = delivered(version)
    again = deliver(job, [reference(job, "thumb-128", webp_bytes(16, 16), ext="webp")])
    assert again == services.DUPLICATE
    assert DerivedArtifact.objects.filter(job_id_text=job.pk).count() == 2


def test_stale_source_records_no_rows(sqs):
    version = image_version()
    job = job_for(version)
    refs = [write_webp(job, "thumb-128")]
    AssetVersion.objects.filter(pk=version.pk).update(sha256="f" * 64)  # replaced after submit
    deliver(job, refs)
    job.refresh_from_db()
    assert job.subject_outcome == "stale_source"
    assert DerivedArtifact.objects.count() == 0


def test_a_result_of_an_older_processor_is_outdated(sqs, monkeypatch):
    monkeypatch.setattr(contract, "PROCESSOR_VERSION", "2.0.0")  # this build moved on
    version = image_version()
    job = job_for(version)
    deliver(job, [write_webp(job, "thumb-128")])  # signed by 1.0.0 (patched above)
    job.refresh_from_db()
    assert job.subject_outcome == "processor_outdated"
    assert DerivedArtifact.objects.count() == 0


def test_the_resolver_is_registered_for_the_kind():
    resolver = artifact_results.PROCESSOR_VERSION_RESOLVERS[contract.JOB_TYPE]
    assert resolver("image-convert", 1) == (contract.PROCESSOR_ID, contract.PROCESSOR_VERSION)
    assert resolver("image-resize", 1) == (contract.PROCESSOR_ID, contract.PROCESSOR_VERSION)
    assert resolver("image-thumbnails", 1) == (contract.PROCESSOR_ID, contract.PROCESSOR_VERSION)
    assert resolver("image-convert", 2) is None and resolver("nope", 1) is None


def test_a_newer_conversion_supersedes_the_older_outputs(sqs):
    version = image_version()
    delivered(version)
    first = set(DerivedArtifact.objects.values_list("pk", flat=True))
    newer = job_for(version)
    deliver(newer, [write_webp(newer, "thumb-128")], metadata={"artifact_facts": {"thumb-128": facts(128, 96)}})
    states = {
        a.logical_id + str(a.pk in first): a.state for a in DerivedArtifact.objects.all()
    }
    assert states["thumb-128True"] == ArtifactState.SUPERSEDED
    assert states["thumb-128False"] == ArtifactState.PENDING_REVIEW
    assert states["thumb-256True"] == ArtifactState.PENDING_REVIEW
