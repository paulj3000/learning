"""Shared sample contracts for the processing tests, and the fixture generator.

The committed fixtures under `processing/lai_processing/contracts/fixtures/` are exactly what
`build_fixture_files()` returns; `test_processing_fixtures.py` checks that they have not drifted.
To regenerate after an intentional contract change:

    /Coding/ENV/bin/python tests/processing/processing_samples.py

Everything here is synthetic: fixed UUIDs, fixed timestamps, no child data.
"""

from __future__ import annotations

import copy
import json
import sys
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
if str(REPO / "processing") not in sys.path:  # for direct script use
    sys.path.insert(0, str(REPO / "processing"))

from lai_processing.contracts import (  # noqa: E402
    ArtifactReference,
    AssetContext,
    CompletionEvent,
    Finding,
    InputIdentity,
    InputObject,
    JobError,
    ObjectRef,
    ProcessingJobRequest,
    ProcessingJobResult,
    ProcessorIdentity,
    ProfileRef,
    ResultStatus,
    Severity,
    StoreName,
    SubjectRef,
    Verdict,
    artifact_key,
    build_completion_event,
)
from lai_processing.contracts.events import (  # noqa: E402
    RESULT_ARTIFACT_TYPE,
    RESULT_LOGICAL_ID,
    result_digest,
)
from lai_processing.core.canonical import canonical_json, sha256_hex  # noqa: E402
from lai_processing.core.errors import ErrorCode, ProcessingError  # noqa: E402
from lai_processing.core.idempotency import idempotency_key  # noqa: E402
from lai_processing.core.limits import DEFAULT_LIMITS  # noqa: E402

FIXTURES = REPO / "processing/lai_processing/contracts/fixtures"
INVALID = FIXTURES / "invalid"
SCHEMAS = REPO / "processing/lai_processing/contracts/schemas"

NAMESPACE = "local"
JOB_ID = "6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f"
ATTEMPT_ID = "0b9a8c7d-6e5f-4a3b-9c2d-1e0f2a3b4c5d"
ASSET_JOB_ID = "2d4f6a8c-1b3d-4e5f-8a7b-9c0d1e2f3a4b"
ASSET_ATTEMPT_ID = "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918"
ASSET_VERSION_ID = "c0ffee00-1234-4abc-8def-0123456789ab"
OTHER_JOB_ID = "99999999-8888-4777-8666-555555555555"
OTHER_ATTEMPT_ID = "11111111-2222-4333-8444-555555555555"
EVENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
EVENT_ID_REF = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"

INPUT_BYTES = b"Learning makes the island grow.\n"
INPUT_KEY = f"processing/quarantine/{NAMESPACE}/{JOB_ID}/input.bin"
ASSET_KEY = f"assets/models/npc-pip/{ASSET_VERSION_ID}/model.glb"
ASSET_SHA256 = sha256_hex(b"synthetic glb bytes for the asset.validate_model fixture")

SUBMITTED = datetime(2026, 11, 16, 12, 0, 0, tzinfo=UTC)
STARTED = SUBMITTED + timedelta(seconds=5)
COMPLETED = STARTED + timedelta(milliseconds=1250)

REFERENCE_PROFILE = ProfileRef("reference-default", 1)
REFERENCE_OPTIONS: dict[str, Any] = {"metadata_level": "full", "write_report": True}
PROCESSOR = ProcessorIdentity("reference.checksum", "1.0.0")


def reference_input() -> InputObject:
    return InputObject(
        ref=ObjectRef(StoreName.QUARANTINE, INPUT_KEY, None, NAMESPACE),
        content_type="text/plain",
        size_bytes=len(INPUT_BYTES),
        sha256=sha256_hex(INPUT_BYTES),
    )


def reference_request(**overrides: Any) -> ProcessingJobRequest:
    subject = SubjectRef("reference_input", JOB_ID)
    inp = reference_input()
    fields: dict[str, Any] = {
        "job_id": JOB_ID,
        "job_type": "reference.checksum",
        "namespace": NAMESPACE,
        "subject": subject,
        "profile": REFERENCE_PROFILE,
        "input": inp,
        "idempotency_key": idempotency_key(
            namespace=NAMESPACE,
            job_type="reference.checksum",
            subject=subject,
            profile=REFERENCE_PROFILE,
            input=inp,
            options=REFERENCE_OPTIONS,
        ),
        "correlation_id": "corr-reference-0001",
        "attempt_id": ATTEMPT_ID,
        "attempt_number": 1,
        "submitted_at": SUBMITTED,
        "expires_at": SUBMITTED + timedelta(days=1),
        "options": REFERENCE_OPTIONS,
        "limits": DEFAULT_LIMITS,
    }
    fields.update(overrides)
    return ProcessingJobRequest(**fields)


def asset_request() -> ProcessingJobRequest:
    subject = SubjectRef("asset_version", ASSET_VERSION_ID)
    profile = ProfileRef("model-default", 1)
    inp = InputObject(
        ref=ObjectRef(StoreName.ASSETS, ASSET_KEY, "3sL4kqtJlcpXroDTDmJ.rmSpXd3dIbrHY", NAMESPACE),
        content_type="model/gltf-binary",
        size_bytes=482_133,
        sha256=ASSET_SHA256,
    )
    options: dict[str, Any] = {}
    return ProcessingJobRequest(
        job_id=ASSET_JOB_ID,
        job_type="asset.validate_model",
        namespace=NAMESPACE,
        subject=subject,
        asset=AssetContext("npc-pip", ASSET_VERSION_ID, 3),
        profile=profile,
        input=inp,
        idempotency_key=idempotency_key(
            namespace=NAMESPACE,
            job_type="asset.validate_model",
            subject=subject,
            profile=profile,
            input=inp,
            options=options,
        ),
        correlation_id="corr-asset-model-0001",
        attempt_id=ASSET_ATTEMPT_ID,
        attempt_number=1,
        submitted_at=SUBMITTED,
        expires_at=None,
        options=options,
    )


def _artifact(
    logical_id: str,
    artifact_type: str,
    data: bytes,
    *,
    job_id: str = JOB_ID,
    attempt_id: str = ATTEMPT_ID,
) -> ArtifactReference:
    return ArtifactReference(
        artifact_type=artifact_type,
        logical_id=logical_id,
        ref=ObjectRef(
            StoreName.ARTIFACTS,
            artifact_key(NAMESPACE, job_id, attempt_id, logical_id, "json"),
            "v000002",
            NAMESPACE,
        ),
        content_type="application/json",
        size_bytes=len(data),
        sha256=sha256_hex(data),
        source_job_id=job_id,
        source_attempt_id=attempt_id,
        processor=PROCESSOR,
        profile=REFERENCE_PROFILE,
    )


REPORT_BYTES = canonical_json({"line_count": 1, "sha256": sha256_hex(INPUT_BYTES)})


def result_base(request: ProcessingJobRequest) -> dict[str, Any]:
    return {
        "job_id": request.job_id,
        "job_type": request.job_type,
        "namespace": request.namespace,
        "idempotency_key": request.idempotency_key,
        "correlation_id": request.correlation_id,
        "attempt_id": request.attempt_id,
        "attempt_number": request.attempt_number,
        "profile": request.profile,
        "processor": PROCESSOR,
        "started_at": STARTED,
        "completed_at": COMPLETED,
        "duration_ms": 1250,
    }


def result_succeeded(request: ProcessingJobRequest | None = None) -> ProcessingJobResult:
    request = request or reference_request()
    assert request.input is not None
    return ProcessingJobResult(
        **result_base(request),
        status=ResultStatus.SUCCEEDED,
        verdict=Verdict.PASS,
        input=InputIdentity(
            ref=request.input.ref,
            sha256=request.input.sha256,
            size_bytes=request.input.size_bytes,
            verified=True,
        ),
        metadata={"line_count": 1, "metadata_level": "full", "size_bytes": len(INPUT_BYTES)},
        findings=(Finding("checksum_verified", Severity.INFO, "The input checksum matched."),),
        artifacts=(
            _artifact(
                "reference-report",
                "report.reference",
                REPORT_BYTES,
                job_id=request.job_id,
                attempt_id=request.attempt_id,
            ),
        ),
    )


def result_failed_retryable(request: ProcessingJobRequest | None = None) -> ProcessingJobResult:
    request = request or reference_request()
    error = ProcessingError(ErrorCode.STORAGE_FAILURE, {"phase": "read_input"})
    return ProcessingJobResult(
        **result_base(request),
        status=ResultStatus.FAILED,
        errors=(JobError.from_error(error),),
    )


def result_cancelled(request: ProcessingJobRequest | None = None) -> ProcessingJobResult:
    request = request or reference_request()
    return ProcessingJobResult(
        **result_base(request),
        status=ResultStatus.CANCELLED,
        errors=(JobError.from_error(ProcessingError(ErrorCode.CANCELLED)),),
    )


def event_inline(result: ProcessingJobResult | None = None) -> CompletionEvent:
    return build_completion_event(
        result or result_succeeded(),
        event_id=EVENT_ID,
        emitted_at=COMPLETED + timedelta(milliseconds=10),
        max_message_bytes=240 * 1024,
    )


def event_by_reference(result: ProcessingJobResult | None = None) -> CompletionEvent:
    result = result or result_succeeded()
    body = canonical_json(result.to_dict())
    ref = _artifact(
        RESULT_LOGICAL_ID,
        RESULT_ARTIFACT_TYPE,
        body,
        job_id=result.job_id,
        attempt_id=result.attempt_id,
    )
    assert ref.sha256 == result_digest(result)
    return CompletionEvent(
        event_id=EVENT_ID_REF,
        emitted_at=COMPLETED + timedelta(milliseconds=20),
        job_id=result.job_id,
        job_type=result.job_type,
        namespace=result.namespace,
        idempotency_key=result.idempotency_key,
        correlation_id=result.correlation_id,
        attempt_id=result.attempt_id,
        attempt_number=result.attempt_number,
        status=result.status,
        result_sha256=ref.sha256,
        retry_class=result.retry_class,
        result_ref=ref,
    )


def pretty(data: Any) -> str:
    return json.dumps(data, indent=2, sort_keys=True, ensure_ascii=True, allow_nan=False) + "\n"


VALID_BUILDERS: dict[str, Callable[[], Any]] = {
    "request.reference.json": reference_request,
    "request.asset_validate_model.json": asset_request,
    "result.succeeded.json": result_succeeded,
    "result.failed_retryable.json": result_failed_retryable,
    "result.cancelled.json": result_cancelled,
    "event.inline.json": event_inline,
    "event.by_reference.json": event_by_reference,
}

# Which decoder each valid fixture belongs to.
VALID_DECODERS: dict[str, str] = {name: name.split(".", 1)[0] for name in VALID_BUILDERS}


def _mutate(base: dict[str, Any], fn: Callable[[dict[str, Any]], None]) -> str:
    data = copy.deepcopy(base)
    fn(data)
    return pretty(data)


def _set(path: str, value: Any) -> Callable[[dict[str, Any]], None]:
    def apply(data: dict[str, Any]) -> None:
        *parents, last = path.split(".")
        node: Any = data
        for part in parents:
            node = node[int(part)] if isinstance(node, list) else node[part]
        if isinstance(node, list):
            node[int(last)] = value
        else:
            node[last] = value

    return apply


def _delete(key: str) -> Callable[[dict[str, Any]], None]:
    return lambda data: data.pop(key)


def _invalid_cases() -> list[tuple[str, str, str, str]]:
    """(file, decoder, error_code, text) for every committed invalid fixture."""
    req = reference_request().to_dict()
    asset = asset_request().to_dict()
    ok = result_succeeded().to_dict()
    failed = result_failed_retryable().to_dict()
    inline = event_inline().to_dict()
    by_ref = event_by_reference().to_dict()
    other_key = artifact_key(NAMESPACE, OTHER_JOB_ID, OTHER_ATTEMPT_ID, "reference-report", "json")
    q = f"processing/quarantine/{NAMESPACE}"
    ii, ior = "invalid_input", "invalid_object_reference"
    ss = "unsupported_schema_version"
    raw_request = pretty(req)
    deep = "[" * 40 + "]" * 40

    def foreign_source(data: dict[str, Any]) -> None:
        art = data["artifacts"][0]
        art["source_job_id"] = OTHER_JOB_ID
        art["source_attempt_id"] = OTHER_ATTEMPT_ID
        art["ref"]["key"] = other_key

    cases: list[tuple[str, str, str, str]] = [
        ("request.unknown_field.json", "request", ii, _mutate(req, _set("priority", 1))),
        ("request.unknown_nested_field.json", "request", ii, _mutate(req, _set("subject.x", 1))),
        ("request.missing_field.json", "request", ii, _mutate(req, _delete("correlation_id"))),
        (
            "request.wrong_kind.json",
            "request",
            ii,
            _mutate(req, _set("kind", "lai.processing.job_result")),
        ),
        ("request.schema_version_2.json", "request", ss, _mutate(req, _set("schema_version", 2))),
        (
            "request.schema_version_string.json",
            "request",
            ii,
            _mutate(req, _set("schema_version", "1")),
        ),
        (
            "request.key_traversal.json",
            "request",
            ior,
            _mutate(req, _set("input.ref.key", f"{q}/{JOB_ID}/../../prod/input.bin")),
        ),
        (
            "request.key_absolute.json",
            "request",
            ior,
            _mutate(req, _set("input.ref.key", f"/{INPUT_KEY}")),
        ),
        (
            "request.key_backslash.json",
            "request",
            ior,
            _mutate(req, _set("input.ref.key", f"{q}/{JOB_ID}\\input.bin")),
        ),
        (
            "request.key_other_namespace.json",
            "request",
            ior,
            _mutate(req, _set("input.ref.key", f"processing/quarantine/prod/{JOB_ID}/input.bin")),
        ),
        (
            "request.store_bucket_name.json",
            "request",
            ior,
            _mutate(req, _set("input.ref.store", "lai-quarantine-prod-123456789012")),
        ),
        (
            "request.key_presigned_url.json",
            "request",
            ior,
            _mutate(
                req,
                _set("input.ref.key", f"{INPUT_KEY}?X-Amz-Signature=abc&X-Amz-Expires=3600"),
            ),
        ),
        (
            "request.key_url_scheme.json",
            "request",
            ior,
            _mutate(req, _set("input.ref.key", f"s3://lai-prod/{INPUT_KEY}")),
        ),
        (
            "request.naive_timestamp.json",
            "request",
            ii,
            _mutate(req, _set("submitted_at", "2026-11-16T12:00:00")),
        ),
        (
            "request.offset_timestamp.json",
            "request",
            ii,
            _mutate(req, _set("submitted_at", "2026-11-16T12:00:00+02:00")),
        ),
        (
            "request.nan.json",
            "request",
            ii,
            raw_request.replace('"metadata_level": "full"', '"metadata_level": NaN'),
        ),
        (
            "request.duplicate_key.json",
            "request",
            ii,
            raw_request.replace(
                f'"job_id": "{JOB_ID}"', f'"job_id": "{JOB_ID}",\n  "job_id": "{OTHER_JOB_ID}"'
            ),
        ),
        (
            "request.deep_nesting.json",
            "request",
            ii,
            raw_request.replace('"metadata_level": "full"', f'"metadata_level": {deep}'),
        ),
        ("request.bool_as_int.json", "request", ii, _mutate(req, _set("attempt_number", True))),
        (
            "request.oversized_option.json",
            "request",
            ii,
            _mutate(req, _set("options.metadata_level", "x" * 300)),
        ),
        (
            "request.option_control_chars.json",
            "request",
            ii,
            _mutate(req, _set("options.metadata_level", "full\nInjected: yes")),
        ),
        (
            "request.unknown_job_type.json",
            "request",
            "unsupported_job_type",
            _mutate(req, _set("job_type", "asset.delete_everything")),
        ),
        (
            "request.asset_job_without_asset.json",
            "request",
            ii,
            _mutate(asset, _set("asset", None)),
        ),
        (
            "request.subject_not_asset_version.json",
            "request",
            ii,
            _mutate(asset, _set("subject.subject_id", OTHER_JOB_ID)),
        ),
        (
            "request.bad_idempotency_key.json",
            "request",
            ii,
            _mutate(req, _set("idempotency_key", "ik2:" + "0" * 64)),
        ),
        ("request.zero_limit.json", "request", ii, _mutate(req, _set("limits.max_input_bytes", 0))),
        (
            "request.input_over_limit.json",
            "request",
            "resource_limit_exceeded",
            _mutate(req, _set("limits.max_input_bytes", 4)),
        ),
        (
            "result.smuggled_error_message.json",
            "result",
            ii,
            _mutate(failed, _set("errors.0.message", "Traceback: secret=abc child=Ana")),
        ),
        (
            "result.error_retry_class_inconsistent.json",
            "result",
            ii,
            _mutate(failed, _set("errors.0.retry_class", "permanent")),
        ),
        (
            "result.top_retry_class_inconsistent.json",
            "result",
            ii,
            _mutate(failed, _set("retry_class", "permanent")),
        ),
        (
            "result.unsafe_error_details.json",
            "result",
            ii,
            _mutate(failed, _set("errors.0.details", {"free text": "child said hello"})),
        ),
        (
            "result.succeeded_with_errors.json",
            "result",
            ii,
            _mutate(ok, _set("errors", failed["errors"])),
        ),
        (
            "result.pass_with_error_findings.json",
            "result",
            ii,
            _mutate(ok, _set("findings.0.severity", "error")),
        ),
        (
            "result.cross_job_artifact_key.json",
            "result",
            ior,
            _mutate(ok, _set("artifacts.0.ref.key", other_key)),
        ),
        ("result.foreign_artifact_source.json", "result", ior, _mutate(ok, foreign_source)),
        (
            "event.result_sha256_mismatch.json",
            "event",
            "checksum_mismatch",
            _mutate(inline, _set("result_sha256", "0" * 64)),
        ),
        (
            "event.status_mirror_mismatch.json",
            "event",
            ii,
            _mutate(inline, _set("status", "failed")),
        ),
        (
            "event.result_and_ref.json",
            "event",
            ii,
            _mutate(inline, _set("result_ref", by_ref["result_ref"])),
        ),
        (
            "event.result_ref_wrong_type.json",
            "event",
            ii,
            _mutate(by_ref, _set("result_ref.artifact_type", "report.reference")),
        ),
        ("event.schema_version_2.json", "event", ss, _mutate(by_ref, _set("schema_version", 2))),
        (
            "any.unknown_kind.json",
            "any",
            ii,
            _mutate(req, _set("kind", "lai.processing.job_deleted")),
        ),
        ("any.schema_version_2.json", "any", ss, _mutate(ok, _set("schema_version", 2))),
        ("any.not_an_object.json", "any", ii, "[]\n"),
    ]
    return cases


def build_fixture_files() -> dict[Path, str]:
    """Every committed fixture file and its exact text."""
    files: dict[Path, str] = {
        FIXTURES / name: pretty(build().to_dict()) for name, build in VALID_BUILDERS.items()
    }
    files[FIXTURES / "request.reference.input.txt"] = INPUT_BYTES.decode("ascii")
    manifest = []
    for name, decoder, code, text in _invalid_cases():
        files[INVALID / name] = text
        manifest.append({"file": name, "decoder": decoder, "error_code": code})
    files[INVALID / "manifest.json"] = pretty(manifest)
    return files


# Objects whose keys are free-form data rather than contract fields.
FREE_FORM_KEYS = frozenset({"metadata", "options", "details", "complexity"})


def contract_object_paths(
    data: Any, path: tuple[str | int, ...] = ()
) -> list[tuple[str | int, ...]]:
    """Paths of every JSON object in `data` whose keys are contract fields (not free-form)."""
    out: list[tuple[str | int, ...]] = []
    if isinstance(data, dict):
        out.append(path)
        for key, value in data.items():
            if key not in FREE_FORM_KEYS:
                out.extend(contract_object_paths(value, (*path, key)))
    elif isinstance(data, list):
        for index, value in enumerate(data):
            out.extend(contract_object_paths(value, (*path, index)))
    return out


def node_at(data: Any, path: tuple[str | int, ...]) -> Any:
    for part in path:
        data = data[part]
    return data


def main() -> None:
    for path, text in build_fixture_files().items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("ascii"))
        print(f"wrote {path.relative_to(REPO)}")


if __name__ == "__main__":
    main()
