"""GLB optimization in Django (ADR-070): validators gated by the controls, the publication gate,
`asset.optimize` submission, result recording, the report display and promotion.

Synthetic Meshopt and KTX2 GLBs come from `tests/processing` builders (generated in code). No AWS:
SQS is a fake client; artifacts live in the in-memory asset storage.
"""

import io
import sys
import uuid
from pathlib import Path

import pytest
from django.core.management import call_command

from apps.assets import artifact_promotion, artifact_results, optimize, services
from apps.assets.artifact_jobs import derived_jobs
from apps.assets.models import ArtifactState, AssetVersion, DerivedArtifact, VersionStatus
from apps.assets.services import AssetActionRefused, publish_refusal
from apps.assets.tests.helpers import make_definition
from apps.assets.validation import validate_model
from apps.jobs import services as jobs
from apps.jobs.models import JobStatus, ProcessingJob
from lai_processing.processors.gltf.compression.optimize_contract import (
    OPTIMIZE_LIMITS,
    PROCESSOR_ID,
    PROCESSOR_VERSION,
)

from .admin_jobs import use_fake_sqs
from .artifact_helpers import deliver, reference, sha, user_with
from .test_admin import EDITORS, run_action, staff

TESTS = Path(__file__).resolve().parents[4] / "tests" / "processing"
if str(TESTS) not in sys.path:
    sys.path.insert(0, str(TESTS))

from glb_builder import glb, static_model  # noqa: E402
from ktx2_builder import ktx2  # noqa: E402
from meshopt_builder import compress_views  # noqa: E402

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

OPTIMIZE_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-jobs-optimize"
PROCESSOR = (PROCESSOR_ID, PROCESSOR_VERSION)


def meshopt_glb() -> bytes:
    document, binary = static_model()
    return glb(*compress_views(document, binary, [document["accessors"][0]["bufferView"]]))


def ktx2_glb() -> bytes:
    document, binary = static_model(texture=ktx2(64, 32), mime="image/ktx2")
    document["textures"] = [{"sampler": 0, "extensions": {"KHR_texture_basisu": {"source": 0}}}]
    document["extensionsUsed"] = ["KHR_texture_basisu"]
    document["extensionsRequired"] = ["KHR_texture_basisu"]
    return glb(document, binary)


def plain_glb() -> bytes:
    return glb(*static_model())


def upload(data: bytes, asset_id=None) -> AssetVersion:
    asset = make_definition(
        asset_id or f"prop-{uuid.uuid4().hex[:8]}", kind="prop", category="prop"
    )
    return services.upload_version(asset, io.BytesIO(data), original_filename="model.glb")


@pytest.fixture
def sqs(settings):
    fake = use_fake_sqs(settings)
    settings.LAI_JOBS_OPTIMIZE_QUEUE_URL = OPTIMIZE_URL
    yield fake
    jobs.set_aws_clients()


# --- the validators follow the controls --------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "control"), [(meshopt_glb, "LAI_GLB_MESHOPT"), (ktx2_glb, "LAI_GLB_KTX2")]
)
def test_compressed_models_are_refused_unless_their_control_is_on(settings, data, control):
    body = data()
    settings.LAI_GLB_MESHOPT = settings.LAI_GLB_KTX2 = "off"
    refused = validate_model(io.BytesIO(body), size=len(body))
    assert "needs_decoder" in {f.code for f in refused.errors}
    setattr(settings, control, "on")
    accepted = validate_model(io.BytesIO(body), size=len(body))
    assert accepted.passed, [f.code for f in accepted.errors]


def test_the_async_request_carries_the_enabled_controls(settings):
    from apps.assets.processing import model_validation_request

    settings.LAI_GLB_MESHOPT = "on"
    settings.LAI_GLB_KTX2 = "off"
    version = upload(meshopt_glb())
    request = model_validation_request(version, job_id=str(uuid.uuid4()))
    assert request["options"]["allow_meshopt"] is True
    # Off flags are not sent, so a worker released before validator 1.2.0 still accepts the
    # request (RELEASE invariant: no message an existing consumer would refuse).
    assert "allow_ktx2" not in request["options"]
    settings.LAI_GLB_MESHOPT = "off"
    other = model_validation_request(version, job_id=str(uuid.uuid4()))
    assert "allow_meshopt" not in other["options"]
    assert "allow_ktx2" not in other["options"]
    assert other["idempotency_key"] != request["idempotency_key"]  # a new logical validation


# --- publication gate --------------------------------------------------------------------------


def test_a_compressed_version_publishes_only_while_its_control_is_on(settings):
    settings.LAI_GLB_MESHOPT = "on"
    version = upload(meshopt_glb())
    assert version.status == VersionStatus.VALIDATED
    settings.LAI_GLB_MESHOPT = "off"
    refusal = publish_refusal(version)
    assert refusal is not None and refusal.code == "compression_disabled"
    with pytest.raises(AssetActionRefused) as refused:
        services.publish_version(version)
    assert refused.value.code == "compression_disabled"
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED  # refused, not rejected
    settings.LAI_GLB_MESHOPT = "on"
    published = services.publish_version(version)
    assert published.status == VersionStatus.PUBLISHED
    settings.LAI_GLB_MESHOPT = "off"  # never changes what is already published
    published.refresh_from_db()
    assert published.status == VersionStatus.PUBLISHED


def test_uncompressed_versions_are_unaffected_by_the_controls(settings):
    settings.LAI_GLB_MESHOPT = settings.LAI_GLB_KTX2 = "off"
    version = upload(plain_glb())
    assert publish_refusal(version) is None
    assert services.compressed_extensions(version) == frozenset()


def test_republication_of_a_retired_compressed_version_is_gated(settings):
    settings.LAI_GLB_KTX2 = "on"
    version = services.publish_version(upload(ktx2_glb()))
    other = AssetVersion.objects.get(
        pk=services.upload_version(
            version.asset, io.BytesIO(plain_glb()), original_filename="plain.glb"
        ).pk
    )
    services.set_default_version(services.publish_version(other))
    services.retire_version(AssetVersion.objects.get(pk=version.pk))
    settings.LAI_GLB_KTX2 = "off"
    with pytest.raises(AssetActionRefused) as refused:
        services.republish_version(AssetVersion.objects.get(pk=version.pk))
    assert refused.value.code == "compression_disabled"


# --- submission --------------------------------------------------------------------------------


def test_submission_is_refused_while_the_control_is_off(sqs, settings):
    settings.LAI_GLB_MESHOPT = "off"
    version = upload(plain_glb())
    with pytest.raises(optimize.OptimizeRefused) as refused:
        optimize.submit_optimization(version, "meshopt")
    assert refused.value.code == "optimization_disabled"
    assert ProcessingJob.objects.filter(kind="asset.optimize").count() == 0 and sqs.sent == []


def test_submission_routes_the_contract_request_to_the_optimize_queue(sqs, settings):
    settings.LAI_GLB_MESHOPT = "on"
    version = upload(plain_glb())
    job = optimize.submit_optimization(version, "meshopt")
    assert job.kind == "asset.optimize" and job.queue == "optimize"
    request = job.payload  # sent through the outbox after commit (not in this transaction)
    assert request["profile"] == {"profile_id": "meshopt-conservative", "version": 1}
    assert request["limits"]["max_input_bytes"] == OPTIMIZE_LIMITS.max_input_bytes
    assert request["input"]["sha256"] == version.sha256
    assert optimize.submit_optimization(version, "meshopt").pk == job.pk  # same logical work
    with pytest.raises(optimize.OptimizeRefused):
        optimize.submit_optimization(version, "ktx2")  # KTX2 is a separate control
    assert derived_jobs(version, "asset.optimize").count() == 1


@pytest.mark.parametrize(
    ("make", "status", "code"),
    [
        (meshopt_glb, VersionStatus.VALIDATED, "already_compressed"),
        (plain_glb, VersionStatus.REJECTED, "not_validated"),
    ],
)
def test_submission_refusals(sqs, settings, make, status, code):
    settings.LAI_GLB_MESHOPT = "on"
    version = upload(make())
    AssetVersion.objects.filter(pk=version.pk).update(status=status)
    version.refresh_from_db()
    with pytest.raises(optimize.OptimizeRefused) as refused:
        optimize.submit_optimization(version, "meshopt")
    assert refused.value.code == code


def test_the_optimizer_processor_version_is_registered():
    resolver = artifact_results.PROCESSOR_VERSION_RESOLVERS["asset.optimize"]
    assert resolver("meshopt-conservative", 1) == PROCESSOR
    assert resolver("ktx2-basisu", 1) == PROCESSOR
    assert resolver("other", 1) is None


# --- result recording, report, promotion ------------------------------------------------------


def _optimize_result(sqs, settings, *, processor=PROCESSOR):
    """Submit for a plain model, deliver a worker-shaped result with a Meshopt GLB and a report."""
    from apps.assets.storage import get_storage

    settings.LAI_GLB_MESHOPT = "on"
    source = upload(plain_glb())
    job = optimize.submit_optimization(source, "meshopt")
    ProcessingJob.objects.filter(pk=job.pk).update(status=JobStatus.RUNNING)
    job.refresh_from_db()
    model, report = meshopt_glb(), b'{"schema":"lai.optimize_report/1"}'
    refs = []
    for logical, data, ext, role, content_type in (
        ("model", model, "glb", "model.optimized", "model/gltf-binary"),
        ("report", report, "json", "model.optimize_report", "application/json"),
    ):
        attempt = job.payload["attempt_id"]
        key = f"processing/artifacts/{job.payload['namespace']}/{job.pk}/{attempt}/{logical}.{ext}"
        get_storage().put(key, io.BytesIO(data), content_type=content_type, sha256=sha(data))
        ref = reference(job, logical, data, key=key, role=role, content_type=content_type)
        ref["processor"] = {"processor_id": processor[0], "processor_version": processor[1]}
        refs.append(ref)
    facts = {
        "variant": "meshopt",
        "source_bytes": 3000,
        "output_bytes": 1000,
        "size_ratio": 0.3333,
        "preserved": True,
        "triangles": 2,
        "animation_clips": 0,
        "extensions": "EXT_meshopt_compression",
    }
    from . import artifact_helpers

    original = artifact_helpers.PROCESSOR
    artifact_helpers.PROCESSOR = processor
    try:
        outcome = deliver(
            job,
            refs,
            metadata={"tool_versions": {"gltfpack": "1.3"}, "artifact_facts": {"model": facts}},
        )
    finally:
        artifact_helpers.PROCESSOR = original
    job.refresh_from_db()
    return source, job, outcome


def test_a_result_is_recorded_with_its_report_facts(sqs, settings):
    _source, job, _outcome = _optimize_result(sqs, settings)
    assert job.subject_outcome == "artifacts_recorded"
    model = DerivedArtifact.objects.get(job_id_text=job.pk, logical_id="model")
    assert model.role == "model.optimized" and model.state == ArtifactState.PENDING_REVIEW
    assert model.metadata["tool_versions"] == {"gltfpack": "1.3"}
    rows = dict(optimize.facts_rows(model))
    assert rows["Optimized / original"] == "33.3%"
    assert rows["Hierarchy, materials, skins and clips preserved"] == "Yes"
    report = DerivedArtifact.objects.get(job_id_text=job.pk, logical_id="report")
    assert optimize.facts_rows(report) == []


def test_an_older_optimizer_result_is_outdated(sqs, settings):
    _source, job, _outcome = _optimize_result(sqs, settings, processor=(PROCESSOR_ID, "0.9.0"))
    assert job.subject_outcome == "processor_outdated"
    assert not DerivedArtifact.objects.filter(job_id_text=job.pk).exists()


def test_promotion_needs_the_control_and_the_promoted_model_passes_validation(sqs, settings):
    _source, job, _outcome = _optimize_result(sqs, settings)
    model = DerivedArtifact.objects.get(job_id_text=job.pk, logical_id="model")
    promoter = user_with("view_derivedartifact", "promote_derivedartifact")
    settings.LAI_GLB_MESHOPT = "off"
    with pytest.raises(AssetActionRefused) as refused:
        artifact_promotion.promote_artifact(model, promoter)
    assert refused.value.code == "compression_disabled"
    model.refresh_from_db()
    assert model.state == ArtifactState.PENDING_REVIEW
    settings.LAI_GLB_MESHOPT = "on"
    version = artifact_promotion.promote_artifact(model, promoter)
    assert version.status == VersionStatus.VALIDATED  # passed the updated validator, unpublished
    assert "EXT_meshopt_compression" in version.metadata["extensionsUsed"]
    assert version.metadata["derivedFrom"]["role"] == "model.optimized"


# --- Django Admin ------------------------------------------------------------------------------


@pytest.fixture
def roles():
    call_command("ensure_asset_roles", verbosity=0)


def test_admin_actions_submit_or_refuse(roles, sqs, settings):
    editor = staff("optimizer", EDITORS)
    version = upload(plain_glb())
    settings.LAI_GLB_MESHOPT = "off"
    page = run_action(editor, "optimize_meshopt", version).content.decode()
    assert "Meshopt optimization is switched off on this server." in page
    assert ProcessingJob.objects.filter(kind="asset.optimize").count() == 0
    settings.LAI_GLB_MESHOPT = "on"
    page = run_action(editor, "optimize_meshopt", version).content.decode()
    assert "Optimization submitted for 1 version(s)." in page
    assert ProcessingJob.objects.filter(kind="asset.optimize").count() == 1
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED
