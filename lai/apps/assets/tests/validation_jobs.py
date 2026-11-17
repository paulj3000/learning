"""Background validation jobs attached to asset versions, for the admin and gate tests.

Jobs are submitted for real
(`submit_model_validation`, `local` backend: nothing runs) and its applied state and result are
then written straight to the row, keeping every identity field `identity_mismatch` checks.
"""

import io
import uuid
from datetime import UTC, datetime

from django.test import override_settings
from django.utils import timezone

from apps.assets import services
from apps.assets.processing import submit_model_validation
from apps.jobs.models import STATE_STATUS, JobAttempt, JobState

METADATA = {
    "metadata_version": 1,
    "generator": "Blender <b>4.2</b>",
    "counts": {"meshes": 2, "primitives": 3, "materials": 1, "skins": 1, "animations": 2},
    "vertex_count": 1234,
    "triangle_count": 2048,
    "material_names": ["Body"],
    "images": [{"index": 0, "mime_type": "image/png", "width": 512, "height": 256}],
    "skins": [{"name": "Armature", "joint_count": 52}],
    "animations": [
        {"name": "Armature|mixamo.com|Layer0", "duration_seconds": 1.25},
        {"name": "Idle", "duration_seconds": 2.0},
    ],
    "bounds": {"min": [-0.5, 0.0, -0.25], "max": [0.5, 1.8, 0.25]},
    "extensions_used": ["KHR_materials_unlit"],
    "extensions_required": [],
    "unsupported_extensions": [],
    "lists_truncated": False,
}


def upload(asset, data):
    """A VALIDATED version through the synchronous upload path, with the flag off for the upload
    only: the gate and admin tests start from a validated version (as one uploaded before the
    flag was switched on). The flag-on DRAFT path is covered by test_async_upload.py and the
    end-to-end tests."""
    with override_settings(LAI_ASSET_ASYNC_VALIDATION="off"):
        return services.upload_version(asset, io.BytesIO(data), original_filename="pip.glb")


def submit(version, user=None):
    return submit_model_validation(version, user=user)


def result(job, *, verdict="pass", findings=(), metadata=None, warnings=()):
    """A succeeded `ProcessingJobResult.to_dict()`-shaped result for `job`."""
    stamp = datetime(2026, 11, 17, 12, 0, tzinfo=UTC).isoformat()
    return {
        "status": "succeeded",
        "job_id": str(job.pk),
        "job_type": job.kind,
        "attempt_id": str(job.current_attempt.attempt_id),
        "attempt_number": job.current_attempt.number,
        "processor": {
            "processor_id": job.processor_id,
            "processor_version": job.processor_version,
        },
        "profile": {"profile_id": job.profile_id, "version": job.profile_version},
        "verdict": verdict,
        "findings": list(findings),
        "warnings": list(warnings),
        "metadata": dict(METADATA if metadata is None else metadata),
        "errors": [],
        "started_at": stamp,
        "completed_at": stamp,
    }


def set_state(job, state, **fields):
    job.state = state
    job.status = STATE_STATUS[state]
    for name, value in fields.items():
        setattr(job, name, value)
    job.save()
    return job


def complete(version, *, verdict="pass", user=None, **options):
    """A job for `version` in `ready_for_review` with a succeeded result."""
    job = submit(version, user=user)
    now = timezone.now()
    return set_state(
        job,
        JobState.READY_FOR_REVIEW,
        result=result(job, verdict=verdict, **options),
        started_at=now,
        finished_at=now,
        subject_outcome="result_recorded",
    )


def retry_attempt(job):
    """Queue a second attempt (the automatic retry after a retryable failure)."""
    attempt = JobAttempt.objects.create(attempt_id=uuid.uuid4(), job=job, number=2)
    return set_state(job, JobState.QUEUED, current_attempt=attempt)
