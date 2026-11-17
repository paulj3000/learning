"""asset.validate_model on the canonical jobs path (ADR-064): inline backend, real GLB validator."""

import hashlib
import io

import pytest

from apps.assets.models import VersionStatus
from apps.assets.processing import submit_model_validation, validation_jobs
from apps.assets.storage import get_storage
from apps.assets.tests.helpers import glb_bytes, gltf_document, make_definition, make_version
from apps.jobs.models import JobStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

MIXAMO = "Armature|mixamo.com|Layer0"


def stored_draft(data: bytes, asset_id="treasure-chest"):
    row = make_version(
        make_definition(asset_id, kind="prop", category="prop"),
        status=VersionStatus.DRAFT,
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
    )
    get_storage().put(
        row.storage_key, io.BytesIO(data), content_type=row.content_type, sha256=row.sha256
    )
    return row


def test_a_passing_model_moves_the_draft_to_validated(settings):
    settings.LAI_ASSET_STORAGE = "memory"
    document, binary = gltf_document(clips=("Idle", MIXAMO))
    version = stored_draft(glb_bytes(document, binary))
    job = submit_model_validation(version, user=None)
    job.refresh_from_db()
    assert job.queue == "media" and job.status == JobStatus.COMPLETED
    assert job.subject_outcome == "version_validated"
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED and version.published_at is None
    summary = version.metadata["model_validation"]
    assert [clip["name"] for clip in summary["animations"]] == ["Idle", MIXAMO]
    assert submit_model_validation(version, user=None).pk == job.pk
    assert validation_jobs(version).count() == 1
