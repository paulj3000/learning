"""Contract validation: requests, results, artifacts and completion events, built in code and
decoded from JSON, including adversarial and structural cases."""

from __future__ import annotations

import copy
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import pytest
from lai_processing.contracts import (
    JOB_TYPES,
    ArtifactReference,
    AssetContext,
    CompletionEvent,
    Finding,
    InputObject,
    JobError,
    ObjectRef,
    ProcessingJobResult,
    ProcessingWarning,
    ProcessorIdentity,
    ProfileRef,
    ResultStatus,
    Severity,
    StoreName,
    SubjectRef,
    Verdict,
    artifact_key,
    build_completion_event,
    decode,
    encode,
    job_type_spec,
)
from lai_processing.contracts.events import RESULT_ARTIFACT_TYPE, result_digest
from lai_processing.core.canonical import canonical_json, sha256_hex
from lai_processing.core.errors import SAFE_MESSAGES, ErrorCode, ProcessingError, RetryClass
from lai_processing.core.limits import DEFAULT_LIMITS
from processing_samples import (
    ASSET_VERSION_ID,
    ATTEMPT_ID,
    FIXTURES,
    JOB_ID,
    NAMESPACE,
    OTHER_ATTEMPT_ID,
    OTHER_JOB_ID,
    PROCESSOR,
    REFERENCE_PROFILE,
    SUBMITTED,
    VALID_BUILDERS,
    asset_request,
    contract_object_paths,
    event_by_reference,
    event_inline,
    node_at,
    reference_request,
    result_cancelled,
    result_failed_retryable,
    result_succeeded,
)


def _code(fn: Any, *args: Any, **kwargs: Any) -> ErrorCode:
    with pytest.raises(ProcessingError) as err:
        fn(*args, **kwargs)
    return err.value.code


def _fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text())


# --- structure: every required key, every unknown key, at every nesting level --------------------


def _structural_cases() -> list[tuple[str, tuple[str | int, ...], str]]:
    cases = []
    for name in sorted(VALID_BUILDERS):
        data = _fixture(name)
        for path in contract_object_paths(data):
            for key in sorted(node_at(data, path)):
                cases.append((name, path, key))
    return cases


STRUCTURAL = _structural_cases()


def test_structural_cases_cover_nested_objects() -> None:
    paths = {path for _, path, _ in STRUCTURAL}
    assert ("input", "ref") in paths
    assert ("result", "artifacts", 0, "processor") in paths
    assert ("result_ref", "ref") in paths
    assert ("limits",) in paths and ("findings", 0) in paths


@pytest.mark.parametrize(("name", "path", "key"), STRUCTURAL)
def test_every_required_key_is_enforced(name: str, path: tuple[Any, ...], key: str) -> None:
    data = _fixture(name)
    del node_at(data, path)[key]
    assert _code(decode, json.dumps(data)) is ErrorCode.INVALID_INPUT


@pytest.mark.parametrize(
    ("name", "path"),
    sorted({(name, path) for name, path, _ in STRUCTURAL}, key=repr),
)
def test_unknown_keys_are_refused_at_every_level(name: str, path: tuple[Any, ...]) -> None:
    data = _fixture(name)
    node_at(data, path)["zz_unknown"] = None
    assert _code(decode, json.dumps(data)) is ErrorCode.INVALID_INPUT


@pytest.mark.parametrize(("name", "path"), sorted({(n, p) for n, p, _ in STRUCTURAL}, key=repr))
def test_contract_objects_must_be_objects(name: str, path: tuple[Any, ...]) -> None:
    if not path:
        return
    data = _fixture(name)
    parent = node_at(data, path[:-1])
    parent[path[-1]] = [node_at(data, path)]
    assert _code(decode, json.dumps(data)) in {
        ErrorCode.INVALID_INPUT,
        ErrorCode.INVALID_OBJECT_REFERENCE,
    }


# --- requests ----------------------------------------------------------------------------------


def test_valid_requests() -> None:
    request = reference_request()
    assert request.spec.job_type == "reference.checksum"
    assert request.options == {"metadata_level": "full", "write_report": True}
    with pytest.raises(TypeError):
        request.options["x"] = 1  # type: ignore[index]
    asset = asset_request()
    assert asset.asset == AssetContext("npc-pip", ASSET_VERSION_ID, 3)
    assert asset.expires_at is None and not asset.is_expired(SUBMITTED + timedelta(days=999))


def test_is_expired_boundary() -> None:
    request = reference_request()
    assert request.expires_at is not None
    assert not request.is_expired(request.expires_at - timedelta(microseconds=1))
    assert request.is_expired(request.expires_at)


def test_timestamps_are_normalised_to_utc() -> None:
    plus2 = timezone(timedelta(hours=2))
    request = reference_request(
        submitted_at=datetime(2026, 11, 16, 14, 0, tzinfo=plus2), expires_at=None
    )
    assert request.submitted_at == SUBMITTED and request.submitted_at.tzinfo is UTC
    assert request.to_dict()["submitted_at"] == "2026-11-16T12:00:00.000000Z"


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"job_id": "not-a-uuid"}, ErrorCode.INVALID_INPUT),
        ({"job_id": JOB_ID.upper()}, ErrorCode.INVALID_INPUT),
        ({"job_type": "reference.unknown"}, ErrorCode.UNSUPPORTED_JOB_TYPE),
        ({"job_type": None}, ErrorCode.UNSUPPORTED_JOB_TYPE),
        ({"namespace": "Local"}, ErrorCode.INVALID_INPUT),
        ({"namespace": "a" * 33}, ErrorCode.INVALID_INPUT),
        ({"subject": {"subject_type": "x", "subject_id": "y"}}, ErrorCode.INVALID_INPUT),
        ({"profile": None}, ErrorCode.INVALID_INPUT),
        ({"idempotency_key": "ik1:short"}, ErrorCode.INVALID_INPUT),
        ({"correlation_id": "short"}, ErrorCode.INVALID_INPUT),
        ({"correlation_id": "has spaces in it"}, ErrorCode.INVALID_INPUT),
        ({"attempt_id": "x"}, ErrorCode.INVALID_INPUT),
        ({"attempt_number": 0}, ErrorCode.INVALID_INPUT),
        ({"attempt_number": 101}, ErrorCode.INVALID_INPUT),
        ({"attempt_number": True}, ErrorCode.INVALID_INPUT),
        ({"submitted_at": datetime(2026, 11, 16, 12, 0)}, ErrorCode.INVALID_INPUT),
        ({"submitted_at": "2026-11-16T12:00:00Z"}, ErrorCode.INVALID_INPUT),
        ({"expires_at": SUBMITTED}, ErrorCode.INVALID_INPUT),
        ({"expires_at": SUBMITTED - timedelta(seconds=1)}, ErrorCode.INVALID_INPUT),
        ({"expires_at": datetime(2030, 1, 1)}, ErrorCode.INVALID_INPUT),
        ({"input": None}, ErrorCode.INVALID_INPUT),
        ({"input": {"ref": None}}, ErrorCode.INVALID_INPUT),
        ({"asset": "npc-pip"}, ErrorCode.INVALID_INPUT),
        ({"options": {"Bad": 1}}, ErrorCode.INVALID_INPUT),
        ({"options": {"x": {"nested": True}}}, ErrorCode.INVALID_INPUT),
        ({"options": {"x": [[1]]}}, ErrorCode.INVALID_INPUT),
        ({"options": {"x": list(range(33))}}, ErrorCode.INVALID_INPUT),
        ({"options": {f"k{i}": 1 for i in range(33)}}, ErrorCode.INVALID_INPUT),
        ({"options": {"x": float("inf")}}, ErrorCode.INVALID_INPUT),
        ({"options": {"x": 2**53 + 1}}, ErrorCode.INVALID_INPUT),
        ({"options": {"x": "tab\there"}}, ErrorCode.INVALID_INPUT),
        ({"limits": DEFAULT_LIMITS.to_dict()}, ErrorCode.INVALID_INPUT),
        ({"limits": replace(DEFAULT_LIMITS, max_input_bytes=31)},
         ErrorCode.RESOURCE_LIMIT_EXCEEDED),
        ({"schema_version": 2}, ErrorCode.UNSUPPORTED_SCHEMA_VERSION),
    ],
)
def test_invalid_requests(overrides: dict[str, Any], code: ErrorCode) -> None:
    assert _code(reference_request, **overrides) is code


def test_input_size_equal_to_limit_is_allowed() -> None:
    request = reference_request(limits=replace(DEFAULT_LIMITS, max_input_bytes=32))
    assert request.input is not None and request.input.size_bytes == 32


def test_input_validated_for_another_namespace_is_refused() -> None:
    other = InputObject(
        ref=ObjectRef(
            StoreName.QUARANTINE, f"processing/quarantine/prod/{JOB_ID}/input.bin", None, "prod"
        ),
        content_type="text/plain",
        size_bytes=1,
        sha256="0" * 64,
    )
    assert _code(reference_request, input=other) is ErrorCode.INVALID_OBJECT_REFERENCE


def test_input_from_artifacts_store_is_refused() -> None:
    key = artifact_key(NAMESPACE, JOB_ID, ATTEMPT_ID, "x", "bin")
    assert (
        _code(
            InputObject,
            ref=ObjectRef(StoreName.ARTIFACTS, key, None, NAMESPACE),
            content_type="text/plain",
            size_bytes=1,
            sha256="0" * 64,
        )
        is ErrorCode.INVALID_OBJECT_REFERENCE
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("content_type", "Text/Plain"),
        ("content_type", "text"),
        ("content_type", "text/plain; charset=utf-8"),
        ("size_bytes", -1),
        ("size_bytes", 2**53 + 1),
        ("size_bytes", "32"),
        ("sha256", "A" * 64),
        ("sha256", "0" * 63),
    ],
)
def test_invalid_input_objects(field: str, value: object) -> None:
    base = reference_request().input
    assert base is not None
    assert _code(replace, base, **{field: value}) is ErrorCode.INVALID_INPUT


def test_asset_job_rules() -> None:
    request = asset_request()
    data = request.to_dict()
    bad = copy.deepcopy(data)
    bad["asset"] = None
    assert _code(decode, json.dumps(bad)) is ErrorCode.INVALID_INPUT
    bad = copy.deepcopy(data)
    bad["subject"]["subject_type"] = "reference_input"
    assert _code(decode, json.dumps(bad)) is ErrorCode.INVALID_INPUT
    bad = copy.deepcopy(data)
    bad["subject"]["subject_id"] = OTHER_JOB_ID
    assert _code(decode, json.dumps(bad)) is ErrorCode.INVALID_INPUT
    bad = copy.deepcopy(data)
    bad["input"] = None
    assert _code(decode, json.dumps(bad)) is ErrorCode.INVALID_INPUT


@pytest.mark.parametrize(
    "asset",
    [
        {"asset_id": "NPC", "asset_version_id": ASSET_VERSION_ID, "asset_version_number": 1},
        {"asset_id": "npc", "asset_version_id": "x", "asset_version_number": 1},
        {"asset_id": "npc", "asset_version_id": ASSET_VERSION_ID, "asset_version_number": 0},
        {"asset_id": "npc", "asset_version_id": ASSET_VERSION_ID, "asset_version_number": "1"},
    ],
)
def test_invalid_asset_context(asset: dict[str, Any]) -> None:
    assert _code(AssetContext.from_dict, asset) is ErrorCode.INVALID_INPUT


def test_reference_job_accepts_an_asset_context_but_does_not_require_it() -> None:
    assert not job_type_spec("reference.checksum").requires_asset
    assert all(spec.requires_asset for k, spec in JOB_TYPES.items() if k.startswith("asset."))


@pytest.mark.parametrize(
    "subject",
    [("Bad", "x"), ("ok", ""), ("ok", "x" * 129), ("ok", "a/b"), ("ok", "a b")],
)
def test_invalid_subjects(subject: tuple[str, str]) -> None:
    assert _code(SubjectRef, *subject) is ErrorCode.INVALID_INPUT


@pytest.mark.parametrize("profile", [("Bad", 1), ("ok", 0), ("ok", 1_000_001), ("ok", True)])
def test_invalid_profile_refs(profile: tuple[str, int]) -> None:
    assert _code(ProfileRef, *profile) is ErrorCode.INVALID_INPUT


# --- results -----------------------------------------------------------------------------------


def test_valid_results() -> None:
    ok = result_succeeded()
    assert ok.retry_class is None and ok.primary_error is None
    failed = result_failed_retryable()
    assert failed.retry_class is RetryClass.RETRYABLE
    assert failed.primary_error is not None and failed.primary_error.code is (
        ErrorCode.STORAGE_FAILURE
    )
    assert result_cancelled().retry_class is RetryClass.CANCELLED
    with pytest.raises(TypeError):
        ok.metadata["x"] = 1  # type: ignore[index]


@pytest.mark.parametrize(
    "overrides",
    [
        {"verdict": None},
        {"processor": None},
        {"errors": result_failed_retryable().errors},
        {"verdict": Verdict.PASS,
         "findings": (Finding("bad_mesh", Severity.ERROR, "Mesh has no faces."),)},
        {"completed_at": SUBMITTED},
        {"duration_ms": -1},
        {"duration_ms": 86_400_001},
        {"status": "done"},
        {"verdict": "maybe"},
        {"metadata": {"x": float("nan")}},
        {"metadata": [1]},
        {"metadata": {"k" * 129: 1}},
        {"findings": ({"code": "x"},)},
        {"warnings": ("text",)},
        {"artifacts": (result_succeeded().artifacts[0],) * 2},
        {"started_at": datetime(2026, 11, 16, 12, 0, 5)},
    ],
)
def test_invalid_success_results(overrides: dict[str, Any]) -> None:
    assert _code(replace, result_succeeded(), **overrides) is ErrorCode.INVALID_INPUT


def test_fail_verdict_may_carry_error_findings() -> None:
    result = replace(
        result_succeeded(),
        verdict=Verdict.FAIL,
        findings=(Finding("bad_mesh", Severity.ERROR, "Mesh has no faces.", "meshes/0"),),
    )
    assert decode(encode(result)) == result


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"errors": ()}, ErrorCode.INVALID_INPUT),
        ({"verdict": Verdict.FAIL}, ErrorCode.INVALID_INPUT),
        ({"status": ResultStatus.CANCELLED}, ErrorCode.INVALID_INPUT),
        ({"errors": (JobError.from_error(ProcessingError(ErrorCode.THROTTLED)),) * 9},
         ErrorCode.RESOURCE_LIMIT_EXCEEDED),
    ],
)
def test_invalid_failed_results(overrides: dict[str, Any], code: ErrorCode) -> None:
    assert _code(replace, result_failed_retryable(), **overrides) is code


def test_failed_status_with_cancel_error_is_invalid() -> None:
    assert _code(replace, result_cancelled(), status=ResultStatus.FAILED) is ErrorCode.INVALID_INPUT


def test_result_limits() -> None:
    finding = Finding("x", Severity.INFO, "m")
    many = (finding,) * 501
    assert _code(replace, result_succeeded(), findings=many) is ErrorCode.RESOURCE_LIMIT_EXCEEDED
    warn = ProcessingWarning("w", "m")
    assert (
        _code(replace, result_succeeded(), warnings=(warn,) * 51)
        is ErrorCode.RESOURCE_LIMIT_EXCEEDED
    )
    big = {"blob": "x" * (256 * 1024)}
    assert _code(replace, result_succeeded(), metadata=big) is ErrorCode.RESOURCE_LIMIT_EXCEEDED


@pytest.mark.parametrize(
    ("cls", "kwargs"),
    [
        (Finding, {"code": "Bad", "severity": "info", "message": "m"}),
        (Finding, {"code": "x", "severity": "fatal", "message": "m"}),
        (Finding, {"code": "x", "severity": "info", "message": "line\nbreak"}),
        (Finding, {"code": "x", "severity": "info", "message": "m" * 501}),
        (Finding, {"code": "x", "severity": "info", "message": "m", "path": "p" * 201}),
        (Finding, {"code": "x", "severity": "info", "message": "bell\x07"}),
        (ProcessingWarning, {"code": "x", "message": "\x1b[31mred"}),
    ],
)
def test_invalid_findings_and_warnings(cls: Any, kwargs: dict[str, Any]) -> None:
    assert _code(cls, **kwargs) is ErrorCode.INVALID_INPUT


@pytest.mark.parametrize("code", list(ErrorCode))
def test_job_error_for_every_code_round_trips(code: ErrorCode) -> None:
    error = JobError.from_error(ProcessingError(code, {"field": "x"}))
    assert JobError.from_dict(error.to_dict()) == error


@pytest.mark.parametrize(
    "kwargs",
    [
        {"message": "The job failed: Traceback (most recent call last) ..."},
        {"message": SAFE_MESSAGES[ErrorCode.THROTTLED]},
        {"retry_class": RetryClass.PERMANENT},
        {"retry_class": "sometimes"},
        {"code": "made_up"},
        {"details": {"free text": "x"}},
        {"details": {"field": "x" * 201}},
        {"details": {"field": "a\nb"}},
        {"details": {"nested": {"a": 1}}},
        {"details": []},
    ],
)
def test_job_errors_cannot_smuggle_text(kwargs: dict[str, Any]) -> None:
    base: dict[str, Any] = {
        "code": ErrorCode.STORAGE_FAILURE,
        "retry_class": RetryClass.RETRYABLE,
        "message": SAFE_MESSAGES[ErrorCode.STORAGE_FAILURE],
        "details": {},
    }
    base.update(kwargs)
    assert _code(JobError, **base) is ErrorCode.INVALID_INPUT


# --- artifacts ---------------------------------------------------------------------------------


def _artifact(**overrides: Any) -> ArtifactReference:
    return replace(result_succeeded().artifacts[0], **overrides)


def test_artifact_must_sit_under_its_attempt_prefix() -> None:
    other_key = artifact_key(NAMESPACE, OTHER_JOB_ID, ATTEMPT_ID, "reference-report", "json")
    ref = ObjectRef(StoreName.ARTIFACTS, other_key, None, NAMESPACE)
    assert _code(_artifact, ref=ref) is ErrorCode.INVALID_OBJECT_REFERENCE
    other_attempt = artifact_key(NAMESPACE, JOB_ID, OTHER_ATTEMPT_ID, "reference-report", "json")
    ref = ObjectRef(StoreName.ARTIFACTS, other_attempt, None, NAMESPACE)
    assert _code(_artifact, ref=ref) is ErrorCode.INVALID_OBJECT_REFERENCE


def test_artifact_must_be_in_artifacts_store() -> None:
    ref = ObjectRef(StoreName.ASSETS, "assets/x/model.glb", None, NAMESPACE)
    assert _code(_artifact, ref=ref) is ErrorCode.INVALID_OBJECT_REFERENCE


def test_artifact_needs_a_namespace() -> None:
    art = result_succeeded().artifacts[0]
    with pytest.raises(ProcessingError):
        _artifact(ref=ObjectRef(StoreName.ARTIFACTS, art.ref.key, None, None))


def test_result_refuses_foreign_artifacts() -> None:
    foreign_key = artifact_key(NAMESPACE, OTHER_JOB_ID, OTHER_ATTEMPT_ID, "r", "json")
    foreign = _artifact(
        ref=ObjectRef(StoreName.ARTIFACTS, foreign_key, None, NAMESPACE),
        source_job_id=OTHER_JOB_ID,
        source_attempt_id=OTHER_ATTEMPT_ID,
    )
    code = _code(replace, result_succeeded(), artifacts=(foreign,))
    assert code is ErrorCode.INVALID_OBJECT_REFERENCE


def test_result_refuses_artifacts_from_another_profile_or_processor() -> None:

    for overrides in (
        {"profile": ProfileRef("other", 1)},
        {"processor": ProcessorIdentity("other.proc", "1.0.0")},
    ):
        art = _artifact(**overrides)
        assert _code(replace, result_succeeded(), artifacts=(art,)) is ErrorCode.INVALID_INPUT


# --- events ------------------------------------------------------------------------------------


def test_event_mirrors_and_digest() -> None:
    event = event_inline()
    assert event.result is not None and event.result_ref is None
    assert event.result_sha256 == sha256_hex(canonical_json(event.result.to_dict()))
    assert event.retry_class is None
    assert event_inline(result_failed_retryable()).retry_class is RetryClass.RETRYABLE


def test_by_reference_event() -> None:
    event = event_by_reference()
    assert event.result is None and event.result_ref is not None
    assert event.result_ref.artifact_type == RESULT_ARTIFACT_TYPE
    event.verify_result(result_succeeded())
    with pytest.raises(ProcessingError) as err:
        event.verify_result(replace(result_succeeded(), duration_ms=1))
    assert err.value.code is ErrorCode.CHECKSUM_MISMATCH
    with pytest.raises(ProcessingError) as err:
        event.verify_result(result_failed_retryable())
    assert err.value.code is ErrorCode.INVALID_INPUT


def test_event_requires_exactly_one_of_result_and_ref() -> None:
    inline, by_ref = event_inline(), event_by_reference()
    assert _code(replace, inline, result=None) is ErrorCode.INVALID_INPUT
    assert _code(replace, inline, result_ref=by_ref.result_ref) is ErrorCode.INVALID_INPUT


@pytest.mark.parametrize(
    "overrides",
    [
        {"job_id": OTHER_JOB_ID},
        {"attempt_id": OTHER_ATTEMPT_ID},
        {"attempt_number": 2},
        {"correlation_id": "corr-other-0002"},
        {"idempotency_key": "ik1:" + "1" * 64},
        {"job_type": "asset.optimize"},
        {"status": ResultStatus.FAILED},
    ],
)
def test_inline_event_must_mirror_its_result(overrides: dict[str, Any]) -> None:
    assert _code(replace, event_inline(), **overrides) is ErrorCode.INVALID_INPUT


def test_inline_event_digest_must_match() -> None:
    assert _code(replace, event_inline(), result_sha256="0" * 64) is ErrorCode.CHECKSUM_MISMATCH


@pytest.mark.parametrize(
    "overrides",
    [
        {"job_id": OTHER_JOB_ID},
        {"attempt_id": OTHER_ATTEMPT_ID},
        {"result_sha256": "0" * 64},
        {"namespace": "prod"},
    ],
)
def test_by_reference_event_ref_must_belong_to_the_attempt(overrides: dict[str, Any]) -> None:
    assert _code(replace, event_by_reference(), **overrides) is ErrorCode.INVALID_INPUT


def test_result_ref_must_be_a_job_result_artifact() -> None:
    event = event_by_reference()
    assert event.result_ref is not None
    wrong = replace(event.result_ref, artifact_type="report.reference")
    assert _code(replace, event, result_ref=wrong) is ErrorCode.INVALID_INPUT


def test_build_completion_event_inlines_when_it_fits() -> None:
    result = result_succeeded()
    event = build_completion_event(
        result, event_id=JOB_ID, emitted_at=SUBMITTED, max_message_bytes=64 * 1024
    )
    assert event.result == result and event.result_sha256 == result_digest(result)


def test_build_completion_event_stores_large_results() -> None:
    result = result_succeeded()
    stored: list[tuple[bytes, str]] = []

    def store(data: bytes, digest: str) -> ArtifactReference:
        stored.append((data, digest))
        return event_by_reference(result).result_ref  # type: ignore[return-value]

    event = build_completion_event(
        result, event_id=JOB_ID, emitted_at=SUBMITTED, max_message_bytes=1500, store_result=store
    )
    assert event.result is None and event.result_ref is not None
    assert stored == [(canonical_json(result.to_dict()), result_digest(result))]
    assert len(encode(event)) <= 1500


def test_build_completion_event_refuses_oversize_without_storage() -> None:
    with pytest.raises(ProcessingError) as err:
        build_completion_event(
            result_succeeded(), event_id=JOB_ID, emitted_at=SUBMITTED, max_message_bytes=500
        )
    assert err.value.code is ErrorCode.MESSAGE_TOO_LARGE
    with pytest.raises(ProcessingError) as err:
        build_completion_event(
            result_succeeded(),
            event_id=JOB_ID,
            emitted_at=SUBMITTED,
            max_message_bytes=100,
            store_result=lambda d, s: (
                event_by_reference().result_ref  # type: ignore[arg-type,return-value]
            ),
        )
    assert err.value.code is ErrorCode.MESSAGE_TOO_LARGE


def test_by_reference_event_declared_retry_class_must_be_known() -> None:
    data = event_by_reference(result_failed_retryable()).to_dict()
    data["retry_class"] = "sometimes"
    assert _code(decode, json.dumps(data)) is ErrorCode.INVALID_INPUT


def test_inline_event_declared_retry_class_must_match() -> None:
    data = event_inline(result_failed_retryable()).to_dict()
    data["retry_class"] = "permanent"
    assert _code(decode, json.dumps(data)) is ErrorCode.INVALID_INPUT


def test_by_reference_failed_event_round_trips_retry_class() -> None:
    data = event_by_reference(result_failed_retryable()).to_dict()
    data["retry_class"] = "retryable"
    assert decode(json.dumps(data)).to_dict()["retry_class"] == "retryable"


def test_result_metadata_refuses_nul() -> None:
    assert _code(replace, result_succeeded(), metadata={"k": "a\u0000b"}) is (
        ErrorCode.INVALID_INPUT
    )


def test_completion_event_is_decoded_by_type() -> None:
    assert isinstance(decode(encode(event_inline())), CompletionEvent)
    assert isinstance(decode(encode(result_succeeded())), ProcessingJobResult)


def test_profile_ref_round_trip() -> None:
    assert ProfileRef.from_dict(REFERENCE_PROFILE.to_dict()) == REFERENCE_PROFILE
    assert PROCESSOR.to_dict() == {
        "processor_id": "reference.checksum",
        "processor_version": "1.0.0",
    }
