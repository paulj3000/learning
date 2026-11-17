"""Submit an asset version for contract model validation (`asset.validate_model`, ADR-062).

`submit_model_validation(version, user=)` builds the request for one `AssetVersion` and hands it
to `apps.jobs.processing.submit_processing_job`: the input is the version's stored object in the
`assets` store (its key, SHA-256, size and content type as recorded at upload), the subject is
the version (`asset_version`, its uuid) and the asset context names the definition and number.

It only submits. It never changes the version's status, metadata or validation report, and it
never publishes: mapping a result onto the version is a later, staff-reviewed step (ADR-045).
Submitting the same version again returns the existing job (same idempotency key).

Wave 3 (LAI-LAMBDA-006/007, `docs/processing/WAVE3_INTERFACES.md`) adds the shared helpers below:
the `LAI_ASSET_ASYNC_VALIDATION` flag, which versions it applies to, the validation jobs of a
version, and `identity_mismatch`, the one definition of "this job validated exactly these bytes
of this version" used by the completion hook and by the publication gate.
"""

from django.conf import settings

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


#: Formats asynchronous validation applies to (the GLB validator reads the GLB container only).
#: Every other format keeps the synchronous path whatever the flag says.
ASYNC_FORMATS = frozenset({"glb"})
#: Job states that carry an applied, successful result.
RESULT_STATES = frozenset({"validated", "ready_for_review"})


def async_validation_enabled() -> bool:
    """`LAI_ASSET_ASYNC_VALIDATION == "on"` (default off in every environment)."""
    return getattr(settings, "LAI_ASSET_ASYNC_VALIDATION", "off") == "on"


def async_validation_applies(version_or_format) -> bool:
    """True when the flag is on and the version (or a format name) is a GLB model."""
    # A str has a `.format` method, so a format name is never looked up as an attribute.
    fmt = version_or_format if isinstance(version_or_format, str) else version_or_format.format
    return async_validation_enabled() and fmt in ASYNC_FORMATS


def current_processor() -> tuple[str, str]:
    """The (processor_id, version) this build runs for the model validation profile."""
    from apps.jobs.processing import get_registry
    from lai_processing.contracts.common import ProfileRef

    processor, _profile = get_registry().resolve(
        MODEL_VALIDATION_JOB_TYPE, ProfileRef(*MODEL_VALIDATION_PROFILE)
    )
    return processor.processor_id, processor.version


def validation_jobs(version):
    """This version's `asset.validate_model` jobs, newest first (never locked)."""
    from apps.jobs.models import ProcessingJob

    return ProcessingJob.objects.filter(
        kind=MODEL_VALIDATION_JOB_TYPE,
        subject_type=SUBJECT_TYPE,
        subject_id=str(version.version_id),
    ).order_by("-created_at")


def identity_mismatch(job, version, *, require_current_processor: bool = False) -> str | None:
    """None when `job` is a model validation of exactly `version`'s stored bytes, else a safe
    reason code. Checks the kind, subject, namespace, the asset context (asset id, version id
    and number), the input (store `assets`, key, no object version, SHA-256, size) and the
    profile; with `require_current_processor`, also that the job ran this build's processor
    version (the publication gate). Attempt identity, forged and stale events are already
    refused by `apps.jobs.processing` before any hook or gate sees a job's result."""
    version_id = str(version.version_id)
    if job.kind != MODEL_VALIDATION_JOB_TYPE:
        return "kind_mismatch"
    if job.subject_type != SUBJECT_TYPE or job.subject_id != version_id:
        return "subject_mismatch"
    if job.namespace != settings.LAI_PROCESSING_NAMESPACE:
        return "namespace_mismatch"
    context = (job.payload or {}).get("asset") or {}
    if (
        context.get("asset_id") != version.asset.asset_id
        or context.get("asset_version_id") != version_id
        or context.get("asset_version_number") != version.number
    ):
        return "asset_mismatch"
    ref = job.input_ref or {}
    if (
        ref.get("store") != "assets"
        or ref.get("key") != version.storage_key
        or ref.get("version_id") not in (None, "")
    ):
        return "storage_mismatch"
    if job.input_sha256 != version.sha256:
        return "checksum_mismatch"
    if job.input_size != version.size_bytes:
        return "size_mismatch"
    if (job.profile_id, job.profile_version) != MODEL_VALIDATION_PROFILE:
        return "profile_mismatch"
    if require_current_processor and (job.processor_id, job.processor_version) != (
        current_processor()
    ):
        return "processor_outdated"
    return None


#: Metadata keys copied from the GLB validator's result (CONTRACTS.md "GLB validation metadata").
_SUMMARY_METADATA_KEYS = (
    "metadata_version",
    "generator",
    "counts",
    "vertex_count",
    "triangle_count",
    "material_names",
    "images",
    "skins",
    "animations",
    "bounds",
    "extensions_used",
    "extensions_required",
    "unsupported_extensions",
    "lists_truncated",
)
#: Most processing findings copied onto a version's validation report.
MAX_PROCESSING_FINDINGS = 200
#: The `source` of a finding produced by the background validator ("upload" findings, written
#: by the synchronous checks, carry no source key, as before Wave 3).
PROCESSING_SOURCE = "processing"


def model_validation_summary(job) -> dict | None:
    """The normalized summary of a job's applied model validation result, or None when the job
    has no successful result. One shape for the completion hook (stored on the draft version as
    `metadata["model_validation"]`) and for Django Admin (rendered, always escaped).

    Keys: job and attempt identity, processor and profile, `verdict`, `completed_at`,
    `error_count`, `warning_count`, `run_warnings` (codes), and the validator's metadata keys
    (`counts`, `vertex_count`, `triangle_count`, `material_names`, `images`, `skins`,
    `animations` with exact names and `duration_seconds`, `bounds`, extensions, `generator`).
    Findings are not in the summary: `processing_findings(job)` returns them."""
    result = job.result if isinstance(job.result, dict) else None
    if not result or result.get("status") != "succeeded":
        return None
    metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
    processor = result.get("processor") or {}
    profile = result.get("profile") or {}
    findings = [f for f in result.get("findings") or [] if isinstance(f, dict)]
    summary = {
        "job_id": str(job.pk),
        "attempt_id": result.get("attempt_id"),
        "attempt_number": result.get("attempt_number"),
        "processor_id": processor.get("processor_id"),
        "processor_version": processor.get("processor_version"),
        "profile_id": profile.get("profile_id"),
        "profile_version": profile.get("version"),
        "verdict": result.get("verdict"),
        "completed_at": result.get("completed_at"),
        "error_count": sum(1 for f in findings if f.get("severity") == "error"),
        "warning_count": sum(1 for f in findings if f.get("severity") == "warning"),
        "run_warnings": [
            str(w.get("code", ""))[:64] for w in result.get("warnings") or [] if isinstance(w, dict)
        ][:50],
    }
    for key in _SUMMARY_METADATA_KEYS:
        summary[key] = metadata.get(key)
    return summary


def processing_findings(job) -> list[dict]:
    """The job's findings in the Asset Library report shape plus `source: "processing"`
    (at most `MAX_PROCESSING_FINDINGS`)."""
    result = job.result if isinstance(job.result, dict) else {}
    findings = []
    for finding in (result.get("findings") or [])[:MAX_PROCESSING_FINDINGS]:
        if not isinstance(finding, dict):
            continue
        findings.append(
            {
                "code": str(finding.get("code", ""))[:64],
                "severity": "error" if finding.get("severity") == "error" else "warning",
                "message": str(finding.get("message", ""))[:500],
                "path": str(finding.get("path", ""))[:200],
                "source": PROCESSING_SOURCE,
            }
        )
    return findings
