"""Model validation jobs attached to asset versions, for the upload and publication gate tests.

Jobs go through the real canonical path: `submit_model_validation` with the inline backend runs
the shipped GLB validator in process and applies the result (`apps.assets.processing.apply`).
`queued` uses the SQS backend with fake clients, so the job stays `pending`. No AWS.
"""

import io

from django.test import override_settings

from apps.assets import services
from apps.assets.processing import submit_model_validation
from apps.assets.tests.helpers import glb_bytes, gltf_document
from apps.jobs import services as jobs
from apps.jobs.models import JobStatus
from apps.jobs.tests.helpers import FakeS3, FakeSQS, use_sqs


def upload(asset, data, name="pip.glb"):
    """A VALIDATED version through the synchronous upload path, with the flag off for the upload
    only (a version uploaded before the flag was switched on)."""
    with override_settings(LAI_ASSET_ASYNC_VALIDATION="off"):
        return services.upload_version(asset, io.BytesIO(data), original_filename=name)


def complete(version, user=None):
    """A completed validation job for `version`, run inline by the real validator."""
    with override_settings(LAI_JOBS_BACKEND="inline"):
        job = submit_model_validation(version, user=user)
    job.refresh_from_db()
    assert job.status == JobStatus.COMPLETED, job.error_code
    return job


def queued(version, settings, user=None):
    """A pending validation job for `version` (SQS backend, fake clients; nothing runs).
    Returns (job, fake_sqs). The caller restores the backend through the `settings` fixture."""
    sqs = FakeSQS()
    use_sqs(settings)
    jobs.set_aws_clients(sqs=sqs, s3=FakeS3())
    job = submit_model_validation(version, user=user)
    return job, sqs


def refused_glb() -> bytes:
    """A GLB the synchronous Django checks accept but the background validator refuses: a node
    translation too large for a 64-bit float."""
    document, binary = gltf_document()
    document["nodes"][0]["translation"] = [10**400, 0, 0]
    return glb_bytes(document, binary)
