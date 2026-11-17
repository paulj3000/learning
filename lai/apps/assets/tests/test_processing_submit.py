"""submit_model_validation: an AssetVersion becomes an asset.validate_model contract job without
changing the version (no status, metadata or publication change)."""

import hashlib
import io

import pytest

from apps.assets.models import VersionStatus
from apps.assets.processing import model_validation_request, submit_model_validation
from apps.assets.storage import get_storage
from apps.assets.tests.helpers import glb_bytes, make_definition, make_version
from apps.jobs import processing
from apps.jobs import processing_transport as transport
from apps.jobs.models import JobOutbox, JobState, ProcessingJob
from lai_processing.contracts.codec import decode_request
from lai_processing.contracts.profiles import ProcessingProfile
from lai_processing.contracts.results import Verdict
from lai_processing.core.processor import Processor, ProcessorOutput
from lai_processing.core.registry import ProcessorRegistry
from lai_processing.processors.reference import ReferenceProcessor

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


class StandInGlbValidator(Processor):
    """Stands in for LAI-LAMBDA-002's validator (same id, version and profile)."""

    processor_id = "asset.glb_validator"
    version = "1.0.0"
    job_types = frozenset({"asset.validate_model"})

    def profiles(self):
        return (
            ProcessingProfile(
                profile_id="glb-default",
                version=1,
                job_type="asset.validate_model",
                description="Stand-in GLB profile.",
            ),
        )

    def process(self, context):
        size = context.input_path.stat().st_size
        return ProcessorOutput(verdict=Verdict.PASS, metadata={"byte_length": size})


@pytest.fixture
def registry():
    registry = ProcessorRegistry()
    registry.register(ReferenceProcessor())
    registry.register(StandInGlbValidator())
    registry.freeze()
    processing.set_registry_for_tests(registry)
    transport.reset_transport()
    yield registry
    processing.set_registry_for_tests(None)
    transport.reset_transport()


@pytest.fixture
def version():
    data = glb_bytes()
    definition = make_definition()
    row = make_version(
        definition,
        status=VersionStatus.DRAFT,
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
    )
    get_storage().put(
        row.storage_key, io.BytesIO(data), content_type=row.content_type, sha256=row.sha256
    )
    return row


def snapshot(row):
    row.refresh_from_db()
    return (row.status, row.metadata, row.validation_report, row.published_at, row.validated_at)


def test_the_request_describes_the_version(version):
    request = model_validation_request(version)
    assert request["subject"].to_dict() == {
        "subject_type": "asset_version",
        "subject_id": str(version.version_id),
    }
    assert request["input"] == {
        "store": "assets",
        "key": version.storage_key,
        "version_id": None,
        "sha256": version.sha256,
        "size_bytes": version.size_bytes,
        "content_type": "model/gltf-binary",
    }
    assert request["asset"].to_dict() == {
        "asset_id": "npc-pip",
        "asset_version_id": str(version.version_id),
        "asset_version_number": version.number,
    }
    assert request["profile"].to_dict() == {"profile_id": "glb-default", "version": 1}


def test_submit_queues_once_and_leaves_the_version_alone(settings, registry, version):
    settings.LAI_PROCESSING_BACKEND = "local"  # nothing runs: only the submission is tested
    transport.set_transport_for_tests(work=object(), completions=object(), storage=object())
    before = snapshot(version)
    job = submit_model_validation(version, user=None)
    again = submit_model_validation(version, user=None)
    assert again.pk == job.pk and ProcessingJob.objects.count() == 1
    job.refresh_from_db()
    assert (job.kind, job.state, job.subject_type, job.subject_id) == (
        "asset.validate_model",
        JobState.QUEUED,
        "asset_version",
        str(version.version_id),
    )
    assert (job.processor_id, job.processor_version) == ("asset.glb_validator", "1.0.0")
    request = decode_request(JobOutbox.objects.get(job=job).body.encode())
    assert request.asset.asset_version_id == str(version.version_id)
    assert request.input.ref.key == version.storage_key
    assert snapshot(version) == before


def test_inline_validation_reads_the_stored_version_and_still_changes_nothing(
    settings, registry, version, django_capture_on_commit_callbacks
):
    settings.LAI_PROCESSING_BACKEND = "inline"
    before = snapshot(version)
    with django_capture_on_commit_callbacks(execute=True):
        job = submit_model_validation(version, user=None)
    job.refresh_from_db()
    assert job.state == JobState.VALIDATED
    assert job.result["metadata"] == {"byte_length": version.size_bytes}
    assert snapshot(version) == before  # validated by processing, never published by it


def test_without_a_glb_processor_the_submission_is_refused(settings, version):
    processing.set_registry_for_tests(None)
    from lai_processing.contracts.common import ProfileRef
    from lai_processing.core.errors import ProcessingError

    try:
        processing.get_registry().resolve("asset.validate_model", ProfileRef("glb-default", 1))
    except ProcessingError:
        with pytest.raises(processing.ProcessingJobsError) as error:
            submit_model_validation(version, user=None)
        assert error.value.code == "unsupported_processor"
        assert not ProcessingJob.objects.exists()
    else:
        pytest.skip("the GLB validator (LAI-LAMBDA-002) is registered")
