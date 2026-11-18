"""Derived-artifact results (ADR-066, docs/processing/DERIVED_ARTIFACTS.md section 7).

`apply(job)` is the handler of `asset.transcode_audio`, `asset.convert_image` and `asset.optimize`
(`apps.jobs.services.HANDLER_MODULES`). `jobs_consume_results` (or the inline backend) calls it
once, under the job row lock, inside the transaction that records the result. It verifies the
result and every artifact it names, and only then creates `DerivedArtifact` rows. It never calls
`upload_version`, never publishes, never touches a version's fields.

Order of checks (each fails closed, creating no row, with a safe outcome code; logs carry the job
id and the code, never a key or file name):

1. the job completed and its result is a valid ADR-061 result of exactly its request;
2. the source version exists, is not rejected, and is the version the request describes (same
   stored object, SHA-256 and size): otherwise `stale_source` (decision D7: no rows are kept);
3. the processor is not older than this build's (when Django knows the processor);
4. every reference sits under this attempt's prefix, uses a declared role with an allowed content
   type, extension and size, within the role's and the request's counts and byte bounds;
5. every object exists, has the claimed size by HEAD and the claimed SHA-256 by a bounded read.

A storage fault or a 403 during step 5 is not an outcome: `ArtifactStorageUnavailable` propagates,
the whole application rolls back and the message is retried. The all-or-none rule holds per
attempt: one bad reference records `artifact_invalid` and no row.
"""

import json
import logging
import re
from collections.abc import Callable
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils.timezone import now

from . import artifact_storage as store
from .artifact_storage import (
    ArtifactMismatch,
    ArtifactObjectMissing,
    ArtifactStorageUnavailable,
)

logger = logging.getLogger("lai.assets")

# Outcome codes (stored in `ProcessingJob.subject_outcome`; safe, no names).
RECORDED = "artifacts_recorded"
INVALID = "artifact_invalid"
STALE_SOURCE = "stale_source"
PROCESSOR_OUTDATED = "processor_outdated"
RESULT_RECORDED = "result_recorded"
PROCESSING_FAILED = "processing_failed"
#: Outcomes after which the job's result counts as applied (the gate and resubmission read this).
APPLIED_OUTCOMES = frozenset({RECORDED, RESULT_RECORDED})

#: The largest stored result Django reads (the same bound the worker uses), and the most artifacts
#: any one result may name whatever a role says.
MAX_RESULT_BYTES = 4 * 1024 * 1024
MAX_ARTIFACTS_PER_RESULT = 16
MAX_METADATA_BYTES = 2048
_META_KEY = re.compile(r"^[a-z][a-z0-9_]{0,31}$")

#: (job type) -> callable(profile_id, profile_version) -> (processor_id, version) | None. A workload
#: registers the processor version this build expects when Django can know it; unregistered
#: kinds fall back to the standard-library registry, and an unresolvable profile skips the check.
PROCESSOR_VERSION_RESOLVERS: dict[str, Callable[[str, int], tuple[str, str] | None]] = {}


def _current_processor(job_type: str, profile_id: str, profile_version: int):
    resolver = PROCESSOR_VERSION_RESOLVERS.get(job_type)
    try:
        if resolver is not None:
            return resolver(profile_id, profile_version)
        from lai_processing.contracts.common import ProfileRef

        from .processing import _registry

        processor, _profile = _registry().resolve(job_type, ProfileRef(profile_id, profile_version))
        return processor.processor_id, processor.version
    except Exception:  # noqa: BLE001 - an unknown processor means "cannot tell", not "outdated"
        return None


# --- the kind's handler -------------------------------------------------------------------------


def apply(job) -> None:
    """Record the artifacts of a finished workload job and its safe outcome (`subject_outcome`)."""
    code = apply_artifact_result(job)
    job.subject_outcome = code[:64]
    job.save(update_fields=["subject_outcome"])
    level = logging.INFO if code in APPLIED_OUTCOMES else logging.WARNING
    logger.log(level, "derived artifacts outcome job=%s kind=%s code=%s", job.pk, job.kind, code)


def inline_ports(job):
    """No in-process ports: a workload runs only in its native worker."""
    return None


def apply_artifact_result(job) -> str:
    """Verify `job`'s result and record its artifacts. Returns a safe outcome code. Call inside
    the job-locked transaction. Raises `ArtifactStorageUnavailable` to roll back and retry."""
    from apps.catalog.models import ContentAsset
    from apps.jobs.models import JobStatus
    from lai_processing.contracts.job_types import job_type_spec
    from lai_processing.contracts.jobs import ProcessingJobRequest
    from lai_processing.contracts.results import ProcessingJobResult
    from lai_processing.core.errors import ProcessingError

    from .models import AssetVersion, VersionStatus
    from .processing import identity_mismatch, result_mismatch

    if job.status != JobStatus.COMPLETED:
        return PROCESSING_FAILED
    if len(json.dumps(job.result or {}, separators=(",", ":"))) > MAX_RESULT_BYTES:
        return "result_invalid"
    reason = result_mismatch(job)
    if reason is not None:
        return reason
    try:
        request = ProcessingJobRequest.from_dict(job.payload)
        result = ProcessingJobResult.from_dict(job.result)
        spec = job_type_spec(job.kind)
    except (ProcessingError, KeyError, TypeError, ValueError):
        return "result_invalid"

    found = (
        AssetVersion.objects.filter(pk=job.subject_id).values_list("pk", "asset_id").first()
        if str(job.subject_id).isdigit()
        else None
    )
    if found is None:
        return STALE_SOURCE  # the source version was deleted meanwhile
    version_pk, asset_pk = found
    ContentAsset.objects.select_for_update().filter(pk=asset_pk).first()  # lock order: asset
    version = (
        AssetVersion.objects.select_for_update()
        .select_related("asset")
        .filter(pk=version_pk, asset_id=asset_pk)
        .first()
    )
    if version is None or version.status == VersionStatus.REJECTED:
        return STALE_SOURCE
    reason = identity_mismatch(
        job,
        version,
        kind=job.kind,
        profile_ref=(request.profile.profile_id, request.profile.version),
    )
    if reason in ("storage_mismatch", "checksum_mismatch", "size_mismatch"):
        return STALE_SOURCE  # the source is no longer the object the job read
    if reason is not None:
        return reason
    if result.processor is None:
        return "result_invalid"
    current = _current_processor(job.kind, request.profile.profile_id, request.profile.version)
    if current is not None and current != (
        result.processor.processor_id,
        result.processor.processor_version,
    ):
        return PROCESSOR_OUTDATED
    if not result.artifacts:
        return RESULT_RECORDED
    if not spec.artifact_roles:
        return INVALID
    problem = check_references(job, request, result, spec)
    if problem is not None:
        logger.warning("derived artifacts refused job=%s reason=%s", job.pk, problem)
        return INVALID
    return _verify_and_record(job, request, result, version)


# --- reference checks (no I/O) -------------------------------------------------------------------


def check_references(job, request, result, spec) -> str | None:
    """None when every `ArtifactReference` in `result` is acceptable for `spec`, else a short
    reason code (logged, never shown). No storage access."""
    refs = list(result.artifacts)
    if len(refs) > MAX_ARTIFACTS_PER_RESULT or len(refs) > request.limits.max_artifact_count:
        return "too_many_artifacts"
    if sum(ref.size_bytes for ref in refs) > request.limits.max_output_bytes:
        return "output_too_large"
    prefix = store.job_prefix(str(job.pk), request.attempt_id)
    seen: set[str] = set()
    per_role: dict[str, int] = {}
    for ref in refs:
        if not ref.belongs_to(str(job.pk), request.attempt_id):
            return "foreign_attempt"
        role = spec.role(ref.artifact_type)
        if role is None or role.producer != "job":
            return "role_undeclared"
        if ref.ref.namespace != store.namespace() or not ref.ref.key.startswith(prefix):
            return "key_outside_attempt"
        parsed = store.parse_job_key(ref.ref.key)
        if (
            parsed is None
            or parsed["job_id"] != str(job.pk)
            or parsed["attempt_id"] != request.attempt_id
            or parsed["logical_id"] != ref.logical_id
        ):
            return "key_shape"
        if ref.content_type not in role.content_types:
            return "content_type"
        if parsed["extension"] not in role.extensions_for(ref.content_type):
            return "extension"
        if not 1 <= ref.size_bytes <= role.max_size_bytes:
            return "size_bound"
        if ref.processor != result.processor or ref.profile != result.profile:
            return "provenance"
        if ref.logical_id in seen:
            return "duplicate_logical_id"
        seen.add(ref.logical_id)
        per_role[role.role] = per_role.get(role.role, 0) + 1
        if per_role[role.role] > role.max_count:
            return "role_count"
    return None


def safe_metadata(result, logical_id: str) -> dict:
    """The safe, bounded facts about one artifact: the tool versions and the worker's per-artifact
    facts (`metadata["artifact_facts"][logical_id]`), scalars only, never free text."""
    out: dict = {}
    meta = result.metadata
    tools = meta.get("tool_versions")
    if hasattr(tools, "items"):
        clean = {
            str(k)[:32]: str(v)[:64]
            for k, v in list(tools.items())[:8]
            if _META_KEY.fullmatch(str(k))
        }
        if clean:
            out["tool_versions"] = clean
    facts = meta.get("artifact_facts")
    fact = facts.get(logical_id) if hasattr(facts, "get") else None
    if hasattr(fact, "items"):
        for k, v in list(fact.items())[:12]:
            if _META_KEY.fullmatch(str(k)) and isinstance(v, int | float | bool) and abs(v) < 2**53:
                out[str(k)] = v
            elif _META_KEY.fullmatch(str(k)) and isinstance(v, str) and len(v) <= 64:
                out[str(k)] = v
    if len(json.dumps(out, separators=(",", ":"))) > MAX_METADATA_BYTES:
        return {}
    return out


# --- verify the objects, then record ------------------------------------------------------------


def _verify_and_record(job, request, result, version) -> str:
    from .models import ArtifactProducer, ArtifactState, DerivedArtifact

    existing = {
        a.logical_id: a
        for a in DerivedArtifact.objects.filter(job_id_text=job.pk, attempt_id=request.attempt_id)
    }
    refs = list(result.artifacts)
    for ref in refs:
        if ref.logical_id in existing:
            continue  # recorded by an earlier delivery: nothing to verify or create
        role = job_role(job.kind, ref.artifact_type)
        try:
            store.verify(
                ref.ref.key,
                sha256=ref.sha256,
                size_bytes=ref.size_bytes,
                max_bytes=role.max_size_bytes,
            )
        except (ArtifactObjectMissing, ArtifactMismatch):
            return INVALID
        # ArtifactStorageUnavailable propagates on purpose: retry, never "missing".

    stamp = now()
    created = []
    try:
        with transaction.atomic():
            for ref in refs:
                if ref.logical_id in existing:
                    continue
                row, _made = DerivedArtifact.objects.get_or_create(
                    job_id_text=job.pk,
                    attempt_id=request.attempt_id,
                    logical_id=ref.logical_id,
                    defaults={
                        "source_version": version,
                        "asset": version.asset,
                        "source_sha256": version.sha256,
                        "source_storage_key": version.storage_key,
                        "job": job,
                        "role": ref.artifact_type,
                        "producer": ArtifactProducer.JOB,
                        "processor_id": ref.processor.processor_id,
                        "processor_version": ref.processor.processor_version,
                        "profile_id": ref.profile.profile_id,
                        "profile_version": ref.profile.version,
                        "sha256": ref.sha256,
                        "size_bytes": ref.size_bytes,
                        "content_type": ref.content_type,
                        "storage_key": ref.ref.key,
                        "state": ArtifactState.PENDING_REVIEW,
                        "created_at": stamp,
                        "expires_at": stamp
                        + timedelta(days=settings.LAI_ARTIFACT_RETENTION_UNREVIEWED_DAYS),
                        "metadata": safe_metadata(result, ref.logical_id),
                    },
                )
                if _made:
                    created.append(row)
    except IntegrityError:
        return INVALID  # a key or (job, attempt, logical id) already belongs to something else
    for row in created:
        supersede_older(row, job, stamp)
    return RECORDED


def job_role(kind: str, role: str):
    from lai_processing.contracts.job_types import job_type_spec

    return job_type_spec(kind).role(role)


def supersede_older(row, job, stamp) -> None:
    """Retire older live rows of the same source, role, logical id and profile id (they become
    `superseded` with the 30-day deadline). When a row of a newer job already exists the new row is
    the stale one and is superseded instead (a late result never displaces newer work)."""
    from .models import ArtifactState, DerivedArtifact

    live = [ArtifactState.PENDING_REVIEW, ArtifactState.ACCEPTED]
    group = (
        DerivedArtifact.objects.select_for_update(of=("self",))
        .filter(
            source_version_id=row.source_version_id,
            role=row.role,
            logical_id=row.logical_id,
            profile_id=row.profile_id,
            state__in=live,
        )
        .exclude(pk=row.pk)
        .select_related("job")
    )
    deadline = stamp + timedelta(days=settings.LAI_ARTIFACT_RETENTION_SUPERSEDED_DAYS)
    newer = [a for a in group if a.job is not None and a.job.created_at > job.created_at]
    if newer:
        winner = max(newer, key=lambda a: a.job.created_at)
        _mark_superseded(row, winner, stamp, deadline)
        return
    for older in group:
        _mark_superseded(older, row, stamp, deadline)


def _mark_superseded(artifact, by, stamp, deadline) -> None:
    from .models import ArtifactState

    artifact.state = ArtifactState.SUPERSEDED
    artifact.superseded_by = by
    artifact.superseded_at = stamp
    artifact.expires_at = deadline
    artifact.save(update_fields=["state", "superseded_by", "superseded_at", "expires_at"])


__all__ = [
    "APPLIED_OUTCOMES",
    "ArtifactStorageUnavailable",
    "apply",
    "apply_artifact_result",
    "check_references",
    "inline_ports",
]
