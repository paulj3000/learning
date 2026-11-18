"""Fixtures for derived-artifact tests: a source version, a workload job row and the worker's
result (artifacts written to the in-memory store). No AWS, no network."""

import hashlib
import io
import uuid
from datetime import UTC, datetime

from apps.assets.artifact_jobs import JOB_SUBJECT, derived_request
from apps.assets.models import AssetVersion, ModelFormat, VersionStatus
from apps.assets.processing import namespace
from apps.assets.storage import get_storage
from apps.assets.tests.helpers import make_definition, make_version
from apps.jobs import services
from apps.jobs.core import envelope
from apps.jobs.models import JobStatus, ProcessingJob

PROCESSOR = ("lai.test_transcoder", "1.0.0")
PROFILE = ("audio-opus", 1)

OGG = b"OggS" + b"\x00" * 60
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 24


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_version(asset_id="npc-pip", **fields) -> AssetVersion:
    asset = make_definition(asset_id)
    return make_version(asset, **fields)


def make_job(version, *, kind="asset.transcode_audio", profile=PROFILE, status=JobStatus.RUNNING):
    """A workload job row as `submit_derived_job` would have recorded it (no queueing)."""
    job_id = str(uuid.uuid4())
    payload = derived_request(
        version,
        kind=kind,
        profile=profile,
        processor_version=PROCESSOR[1],
        job_id=job_id,
    )
    return ProcessingJob.objects.create(
        id=uuid.UUID(job_id),
        kind=kind,
        queue=envelope.KIND_QUEUE[kind],
        backend="sqs",
        status=status,
        payload=payload,
        subject_type=JOB_SUBJECT,
        subject_id=str(version.pk),
        idempotency_key=payload["idempotency_key"],
    )


def write(job, logical_id, data, *, ext="ogg", role="audio.transcoded", content_type="audio/ogg"):
    """Store `data` as the worker would and return the `ArtifactReference` dict."""
    attempt = job.payload["attempt_id"]
    key = f"processing/artifacts/{namespace()}/{job.pk}/{attempt}/{logical_id}.{ext}"
    get_storage().put(key, io.BytesIO(data), content_type=content_type, sha256=sha(data))
    return reference(job, logical_id, data, key=key, ext=ext, role=role, content_type=content_type)


def reference(job, logical_id, data, *, key=None, ext="ogg", role="audio.transcoded", **over):
    attempt = job.payload["attempt_id"]
    key = key or f"processing/artifacts/{namespace()}/{job.pk}/{attempt}/{logical_id}.{ext}"
    ref = {
        "artifact_type": role,
        "logical_id": logical_id,
        "ref": {
            "store": "artifacts",
            "key": key,
            "version_id": None,
        },
        "content_type": "audio/ogg",
        "size_bytes": len(data),
        "sha256": sha(data),
        "source_job_id": str(job.pk),
        "source_attempt_id": attempt,
        "processor": {"processor_id": PROCESSOR[0], "processor_version": PROCESSOR[1]},
        "profile": {
            "profile_id": job.payload["profile"]["profile_id"],
            "version": job.payload["profile"]["version"],
        },
    }
    ref.update(over)
    return ref


def result_dict(job, artifacts, *, metadata=None, input_override=None) -> dict:
    payload = job.payload
    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    source = payload["input"]
    return {
        "kind": "lai.processing.job_result",
        "schema_version": 1,
        "job_id": str(job.pk),
        "job_type": job.kind,
        "namespace": payload["namespace"],
        "idempotency_key": payload["idempotency_key"],
        "correlation_id": payload["correlation_id"],
        "attempt_id": payload["attempt_id"],
        "attempt_number": payload["attempt_number"],
        "processor": {"processor_id": PROCESSOR[0], "processor_version": PROCESSOR[1]},
        "profile": payload["profile"],
        "status": "succeeded",
        "verdict": "pass",
        "retry_class": None,
        "input": input_override
        or {
            "ref": source["ref"],
            "sha256": source["sha256"],
            "size_bytes": source["size_bytes"],
            "verified": True,
        },
        "started_at": stamp,
        "completed_at": stamp,
        "duration_ms": 10,
        "metadata": metadata or {},
        "findings": [],
        "warnings": [],
        "errors": [],
        "artifacts": artifacts,
    }


def deliver(job, artifacts, **kwargs) -> str:
    """Deliver a succeeded result through the real `apply_result` path."""
    message = envelope.build_result(
        str(job.pk),
        job.kind,
        envelope.SUCCEEDED,
        result=result_dict(job, artifacts, **kwargs),
        function="lai-test",
        request_id="req-1",
    )
    return services.apply_result(message)


def recorded(version=None, *, logical="opus", data=OGG, **kwargs):
    """A source, a job and one delivered artifact. Returns (version, job, artifact)."""
    from apps.assets.models import DerivedArtifact

    version = version or source_version()
    job = make_job(version)
    deliver(job, [write(job, logical, data)], **kwargs)
    job.refresh_from_db()
    return version, job, DerivedArtifact.objects.get(job_id_text=job.pk, logical_id=logical)


__all__ = ["JobStatus", "ModelFormat", "VersionStatus"]
