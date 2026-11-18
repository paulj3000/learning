"""Helpers: declare the job type locally (Workstream A registers it for real) and build requests."""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from types import MappingProxyType

from lai_processing.contracts import job_types
from lai_processing.contracts.common import (
    AssetContext,
    InputObject,
    ObjectRef,
    ProfileRef,
    SubjectRef,
)
from lai_processing.contracts.jobs import ProcessingJobRequest
from lai_processing.core import registry as registry_module
from lai_processing.core.idempotency import idempotency_key

NAMESPACE = "dev"
KIND = "asset.transcode_audio"


def declare_job_type(monkeypatch) -> None:
    """Add `asset.transcode_audio` to the closed catalog for one test, as Workstream A will."""
    if KIND in job_types.JOB_TYPES:
        return
    spec = job_types.JobTypeSpec(
        job_type=KIND,
        category="asset",
        requires_asset=True,
        requires_input=True,
        subject_type=job_types.ASSET_VERSION_SUBJECT,
        owner_task="LAI-LAMBDA-008",
        description="Transcode and normalise an audio version (test declaration).",
    )
    merged = MappingProxyType({**job_types.JOB_TYPES, KIND: spec})
    monkeypatch.setattr(job_types, "JOB_TYPES", merged)
    monkeypatch.setattr(registry_module, "JOB_TYPES", merged)


def make_request(
    key: str,
    data: bytes,
    content_type: str,
    profile_id: str,
    processor,
    profile,
    *,
    job_id=None,
    options=None,
) -> ProcessingJobRequest:
    version_id = str(uuid.uuid4())
    subject = SubjectRef(subject_type="asset_version", subject_id=version_id)
    ref = ProfileRef(profile_id, 1)
    options = profile.resolve_options(options or {})
    source = InputObject(
        ref=ObjectRef("assets", key, None, NAMESPACE),
        content_type=content_type,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )
    stamp = datetime.now(UTC).replace(microsecond=0)
    return ProcessingJobRequest(
        job_id=job_id or str(uuid.uuid4()),
        job_type=KIND,
        namespace=NAMESPACE,
        subject=subject,
        profile=ref,
        idempotency_key=idempotency_key(
            namespace=NAMESPACE,
            job_type=KIND,
            subject=subject,
            profile=ref,
            input=source,
            options=options,
            processor_version=processor.version,
        ),
        correlation_id=uuid.uuid4().hex,
        attempt_id=str(uuid.uuid4()),
        attempt_number=1,
        submitted_at=stamp - timedelta(minutes=1),
        input=source,
        asset=AssetContext(asset_id="coin-clink", asset_version_id=version_id, asset_version_number=1),
        expires_at=stamp + timedelta(hours=72),
        options=options,
        limits=profile.limits,
    )
