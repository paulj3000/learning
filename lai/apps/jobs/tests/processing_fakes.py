"""Shared fakes for the contract-job tests: in-memory transport, a worker, crafted results.

Everything is `lai_processing.testing` (MemoryQueue, MemoryObjectStorage): no AWS, no network.
"""

from __future__ import annotations

import dataclasses
import hashlib
import uuid
from datetime import UTC, datetime

import pytest

from apps.jobs import processing
from apps.jobs import processing_transport as transport
from apps.jobs.models import JobOutbox, ProcessingJob
from lai_processing.contracts.artifacts import ArtifactReference
from lai_processing.contracts.codec import decode_request, encode
from lai_processing.contracts.common import ObjectRef, ProcessorIdentity
from lai_processing.contracts.events import build_completion_event
from lai_processing.contracts.identifiers import StoreName, artifact_key
from lai_processing.contracts.results import (
    InputIdentity,
    JobError,
    ProcessingJobResult,
    ResultStatus,
    Verdict,
)
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.core.execution import ExecutionEngine
from lai_processing.testing import MemoryObjectStorage, MemoryQueue

REFERENCE = ProcessorIdentity("reference.checksum", "1.0.0")
DATA = b"hello processing"
KEY = "assets/models/npc-pip/0d7f2c4e-8f1a-4d6b-9a39-2f3e4d5c6b7a/model.glb"


class Transport:
    def __init__(self):
        self.work = MemoryQueue()
        self.completions = MemoryQueue()
        self.storage = MemoryObjectStorage()


@pytest.fixture
def fake_transport(settings):
    """Manual control: the `local` backend (nothing runs after commit) on in-memory ports."""
    settings.LAI_PROCESSING_BACKEND = "local"
    settings.LAI_PROCESSING_DISPATCH = "enabled"
    settings.LAI_PROCESSING_MAX_ATTEMPTS = 3
    fake = Transport()
    transport.set_transport_for_tests(
        work=fake.work, completions=fake.completions, storage=fake.storage
    )
    processing.set_registry_for_tests(None)
    yield fake
    transport.reset_transport()
    processing.set_registry_for_tests(None)


def seed(storage, data: bytes = DATA, key: str = KEY):
    storage.seed(ObjectRef(StoreName.ASSETS, key), data)
    return {
        "store": "assets",
        "key": key,
        "version_id": None,
        "sha256": hashlib.sha256(data).hexdigest(),
        "size_bytes": len(data),
        "content_type": "application/octet-stream",
    }


def submit_reference(storage, *, data: bytes = DATA, key: str = KEY, options=None, subject=None):
    return processing.submit_processing_job(
        job_type="reference.checksum",
        subject=subject or ("test_subject", "subject-1"),
        input=seed(storage, data, key),
        profile=("reference-default", 1),
        options=options,
    )


def current_request(job: ProcessingJob):
    job.refresh_from_db()
    return decode_request(JobOutbox.objects.get(attempt=job.current_attempt).body.encode())


def engine(storage) -> ExecutionEngine:
    return ExecutionEngine(registry=processing.get_registry(), storage=storage, namespace="test")


def run_worker(fake: Transport) -> int:
    """Execute every visible work message and send its completion (the Lambda worker's loop)."""
    worker = engine(fake.storage)
    ran = 0
    for delivery in fake.work.receive(max_messages=10):
        result = worker.decode_and_execute(delivery.body)
        event = worker.complete(result, max_message_bytes=fake.completions.max_message_bytes)
        fake.completions.send(encode(event))
        fake.work.ack(delivery)
        ran += 1
    return ran


def consume(fake: Transport) -> list:
    outcomes = []
    for delivery in fake.completions.receive(max_messages=10):
        outcome = processing.apply_completion(delivery.body, storage=fake.storage)
        if outcome.ack:
            fake.completions.ack(delivery)
        outcomes.append(outcome)
    return outcomes


def result_for(
    request,
    *,
    status: str = "succeeded",
    code: ErrorCode | None = None,
    processor: ProcessorIdentity | None = REFERENCE,
    sha256: str | None = None,
    verified: bool = True,
    artifacts=(),
    metadata=None,
    attempt_id: str | None = None,
    attempt_number: int | None = None,
    profile=None,
) -> ProcessingJobResult:
    """A contract-valid result for `request`, as a worker would report it."""
    stamp = datetime(2026, 11, 16, 12, 0, tzinfo=UTC)
    identity = None
    if request.input is not None:
        identity = InputIdentity(
            ref=request.input.ref,
            sha256=sha256 or request.input.sha256,
            size_bytes=request.input.size_bytes,
            verified=verified,
        )
    common = {
        "job_id": request.job_id,
        "job_type": request.job_type,
        "namespace": request.namespace,
        "idempotency_key": request.idempotency_key,
        "correlation_id": request.correlation_id,
        "attempt_id": attempt_id or request.attempt_id,
        "attempt_number": attempt_number or request.attempt_number,
        "profile": profile or request.profile,
        "started_at": stamp,
        "completed_at": stamp,
        "duration_ms": 5,
        "processor": processor,
        "input": identity,
        "artifacts": tuple(artifacts),
    }
    if status == "succeeded":
        return ProcessingJobResult(
            **common,
            status=ResultStatus.SUCCEEDED,
            verdict=Verdict.PASS,
            metadata=metadata or {"byte_count": request.input.size_bytes if request.input else 0},
        )
    error = ProcessingError(code or ErrorCode.TEMPORARY_FAILURE)
    result_status = ResultStatus.CANCELLED if error.code is ErrorCode.CANCELLED else "failed"
    return ProcessingJobResult(**common, status=result_status, errors=(JobError.from_error(error),))


def event_bytes(
    result: ProcessingJobResult, *, event_id: str | None = None, store=None, max_bytes=None
) -> bytes:
    """The encoded completion event. With `store` (and a small `max_bytes`), the result is
    stored as the attempt's `job-result` artifact and the event carries a reference."""
    event_id = event_id or str(uuid.uuid4())
    if store is not None:
        event = engine(store).complete(result, max_message_bytes=max_bytes or 2000)
        return encode(dataclasses.replace(event, event_id=event_id))
    event = build_completion_event(
        result,
        event_id=event_id,
        emitted_at=datetime(2026, 11, 16, 12, 1, tzinfo=UTC),
        max_message_bytes=max_bytes or 240 * 1024,
    )
    return encode(event)


def artifact_for(request, *, job_id=None, attempt_id=None, namespace="test", logical_id="report"):
    job_id = job_id or request.job_id
    attempt_id = attempt_id or request.attempt_id
    key = artifact_key(namespace, job_id, attempt_id, logical_id, "json")
    return ArtifactReference(
        artifact_type="report.reference",
        logical_id=logical_id,
        ref=ObjectRef(StoreName.ARTIFACTS, key, "v1", namespace),
        content_type="application/json",
        size_bytes=2,
        sha256="0" * 64,
        source_job_id=job_id,
        source_attempt_id=attempt_id,
        processor=REFERENCE,
        profile=request.profile,
    )
