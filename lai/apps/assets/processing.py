"""Submit an asset version for contract model validation (`asset.validate_model`, ADR-062).

`submit_model_validation(version, user=)` builds the request for one `AssetVersion` and hands it
to `apps.jobs.processing.submit_processing_job`: the input is the version's stored object in the
`assets` store (its key, SHA-256, size and content type as recorded at upload), the subject is
the version (`asset_version`, its uuid) and the asset context names the definition and number.

It only submits. It never changes the version's status, metadata or validation report, and it
never publishes: mapping a result onto the version is a later, staff-reviewed step (ADR-045).
Submitting the same version again returns the existing job (same idempotency key).
"""

#: The GLB validator's profile (WAVE2_INTERFACES section 2).
MODEL_VALIDATION_JOB_TYPE = "asset.validate_model"
MODEL_VALIDATION_PROFILE = ("glb-default", 1)
SUBJECT_TYPE = "asset_version"


def model_validation_request(version) -> dict:
    """The submit_processing_job arguments for `version` (no database writes)."""
    from lai_processing.contracts.common import AssetContext, ProfileRef, SubjectRef

    version_id = str(version.version_id)
    return {
        "job_type": MODEL_VALIDATION_JOB_TYPE,
        "subject": SubjectRef(subject_type=SUBJECT_TYPE, subject_id=version_id),
        "input": {
            "store": "assets",
            "key": version.storage_key,
            "version_id": None,  # the asset library keeps one immutable object per key
            "sha256": version.sha256,
            "size_bytes": version.size_bytes,
            "content_type": version.content_type,
        },
        "profile": ProfileRef(*MODEL_VALIDATION_PROFILE),
        "asset": AssetContext(
            asset_id=version.asset.asset_id,
            asset_version_id=version_id,
            asset_version_number=version.number,
        ),
    }


def submit_model_validation(version, *, user):
    from apps.jobs.processing import submit_processing_job

    return submit_processing_job(**model_validation_request(version), user=user)
