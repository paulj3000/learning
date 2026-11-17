"""Contract kinds on the canonical jobs path (ADR-064): `reference.checksum` end to end, and a
regression smoke that the schema-1 kinds still complete. In-memory asset storage, PostgreSQL."""

import hashlib
import io
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from apps.assets.jobs import InlinePorts
from apps.assets.storage import get_storage, reset_storage_cache
from apps.jobs import services
from apps.jobs.core import contract, envelope
from apps.jobs.models import JobStatus

from .helpers import MEDIA_URL, FakeS3, FakeSQS, result, tiny_glb, use_sqs

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

DATA = b"reference checksum input, 41 bytes long.\n"


@pytest.fixture(autouse=True)
def memory_storage(settings):
    settings.LAI_ASSET_STORAGE = "memory"
    reset_storage_cache()
    yield
    reset_storage_cache()


@pytest.fixture
def aws(settings):
    use_sqs(settings)
    fakes = SimpleNamespace(sqs=FakeSQS(), s3=FakeS3())
    services.set_aws_clients(sqs=fakes.sqs, s3=fakes.s3)
    yield fakes
    services.set_aws_clients()


def stored(data: bytes = DATA) -> str:
    key = f"assets/models/reference-{uuid.uuid4().hex[:8]}/v1/input.bin"
    get_storage().put(
        key,
        io.BytesIO(data),
        content_type="application/octet-stream",
        sha256=hashlib.sha256(data).hexdigest(),
    )
    return key


def reference_request(key: str, *, data: bytes = DATA, sha256: str | None = None) -> dict:
    """An ADR-061 `reference.checksum` request for an asset object (no artifact writes)."""
    from lai_processing.contracts.common import InputObject, ObjectRef, ProfileRef, SubjectRef
    from lai_processing.contracts.jobs import ProcessingJobRequest
    from lai_processing.core.idempotency import idempotency_key
    from lai_processing.core.registry import default_registry

    job_id = str(uuid.uuid4())
    profile_ref = ProfileRef("reference-default", 1)
    processor, profile = default_registry().resolve("reference.checksum", profile_ref)
    options = profile.resolve_options({"metadata_level": "full"})
    source = InputObject(
        ref=ObjectRef("assets", key, None, "local"),
        content_type="application/octet-stream",
        size_bytes=len(data),
        sha256=sha256 or hashlib.sha256(data).hexdigest(),
    )
    subject = SubjectRef("reference_input", job_id)
    request = ProcessingJobRequest(
        job_id=job_id,
        job_type="reference.checksum",
        namespace="local",
        subject=subject,
        profile=profile_ref,
        idempotency_key=idempotency_key(
            namespace="local",
            job_type="reference.checksum",
            subject=subject,
            profile=profile_ref,
            input=source,
            options=options,
            processor_version=processor.version,
        ),
        correlation_id=uuid.uuid4().hex,
        attempt_id=str(uuid.uuid4()),
        attempt_number=1,
        submitted_at=datetime.now(UTC).replace(microsecond=0),
        input=source,
        asset=None,
        expires_at=None,
        options=options,
        limits=profile.limits,
    )
    return request.to_dict()


def submit_reference(request: dict):
    job = services.submit(
        "reference.checksum",
        request,
        subject=("reference_input", request["job_id"]),
        job_id=request["job_id"],
        idempotency_key=request["idempotency_key"],
    )
    job.refresh_from_db()
    return job


# --- reference.checksum -----------------------------------------------------------------------


def test_reference_checksum_inline_completes_with_deterministic_metadata():
    key = stored()
    first = submit_reference(reference_request(key))
    second = submit_reference(reference_request(key))

    for job in (first, second):
        assert job.status == JobStatus.COMPLETED and job.queue == "media"
        assert job.backend == "inline" and job.attempts == 1 and job.error_code == ""
        assert job.result["status"] == "succeeded" and job.result["verdict"] == "pass"
        assert job.result["job_id"] == str(job.pk)
        assert job.result["input"]["verified"] is True
    assert first.result["metadata"] == {
        "byte_count": len(DATA),
        "sha256": hashlib.sha256(DATA).hexdigest(),
        "content_type": "application/octet-stream",
        "checksum_verified": True,
        "leading_bytes_hex": DATA[:16].hex(),
        "ascii_printable_permille": 1000,
    }
    assert second.result["metadata"] == first.result["metadata"]
    assert first.idempotency_key != second.idempotency_key  # one subject per request


def test_reference_checksum_mismatch_fails_with_the_contract_code():
    key = stored()
    job = submit_reference(reference_request(key, sha256="0" * 64))

    assert job.status == JobStatus.FAILED and job.error_code == "checksum_mismatch"
    assert job.result is None


def test_reference_checksum_missing_object_fails_without_a_result():
    job = submit_reference(reference_request("assets/models/nowhere/v1/input.bin"))

    assert job.status == JobStatus.FAILED and job.error_code == "input_missing"


def test_reference_checksum_through_the_media_queue(aws, django_capture_on_commit_callbacks):
    request = reference_request(stored())
    with django_capture_on_commit_callbacks(execute=True):
        job = submit_reference(request)
    assert job.status == JobStatus.PENDING
    [sent] = aws.sqs.sent
    assert sent["QueueUrl"] == MEDIA_URL
    work = envelope.parse_work(sent["Body"])
    assert work["job_id"] == request["job_id"] and work["payload"] == request

    output = contract.run(work["kind"], work["payload"], InlinePorts())
    assert services.apply_result(result(job, "running")) == services.RUNNING
    assert services.apply_result(result(job, "succeeded", result=output)) == services.APPLIED
    assert services.apply_result(result(job, "succeeded", result=output)) == services.DUPLICATE

    job.refresh_from_db()
    assert job.status == JobStatus.COMPLETED and job.result == output
    assert (job.attempts, job.deliveries) == (1, 3)


# --- the schema-1 kinds are unaffected --------------------------------------------------------


def test_asset_inspect_inline_still_completes():
    data = tiny_glb()
    key = f"assets/models/smoke/{uuid.uuid4()}/model.glb"
    get_storage().put(
        key,
        io.BytesIO(data),
        content_type="model/gltf-binary",
        sha256=hashlib.sha256(data).hexdigest(),
    )

    job = services.submit(
        envelope.ASSET_INSPECT,
        {"storage_key": key, "format": "glb"},
        subject=("assets.assetversion", "1"),
    )

    assert job.status == JobStatus.COMPLETED and job.error_code == ""
    assert job.result["metadata"]["glbVersion"] == 2
    assert job.result["metadata"]["byteLength"] == len(data)
    assert job.idempotency_key == "" and job.subject_outcome == ""


def test_asset_inspect_through_the_media_queue_still_applies(
    aws, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        job = services.submit(
            envelope.ASSET_INSPECT, {"storage_key": "assets/models/x/y/model.glb", "format": "glb"}
        )
    [sent] = aws.sqs.sent
    assert sent["QueueUrl"] == MEDIA_URL
    assert services.apply_result(result(job, "succeeded", result={"metadata": {}})) == (
        services.APPLIED
    )
    job.refresh_from_db()
    assert job.status == JobStatus.COMPLETED and job.subject_outcome == ""
