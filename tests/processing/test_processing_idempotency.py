"""Idempotency keys: determinism, sensitivity to the logical work, and nothing else."""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import timedelta
from typing import Any

import pytest
from processing_samples import (
    ASSET_JOB_ID,
    FIXTURES,
    INPUT_KEY,
    NAMESPACE,
    OTHER_ATTEMPT_ID,
    OTHER_JOB_ID,
    REFERENCE_OPTIONS,
    REFERENCE_PROFILE,
    asset_request,
    reference_input,
    reference_request,
)

from lai_processing.contracts import (
    InputObject,
    ObjectRef,
    ProfileRef,
    StoreName,
    SubjectRef,
)
from lai_processing.contracts.identifiers import IDEMPOTENCY_KEY
from lai_processing.contracts.profiles import OptionSpec, ProcessingProfile
from lai_processing.core.canonical import canonical_json, sha256_hex
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.core.idempotency import (
    IDEMPOTENCY_KEY_VERSION,
    idempotency_key,
    idempotency_material,
    request_idempotency_key,
    verify_idempotency_key,
)
from lai_processing.core.limits import ResourceLimits

SUBJECT = SubjectRef("reference_input", "subject-1")


def _key(**overrides: Any) -> str:
    args: dict[str, Any] = {
        "namespace": NAMESPACE,
        "job_type": "reference.checksum",
        "subject": SUBJECT,
        "profile": REFERENCE_PROFILE,
        "input": reference_input(),
        "options": REFERENCE_OPTIONS,
        "processor_version": None,
    }
    args.update(overrides)
    return idempotency_key(**args)


def _input(**overrides: Any) -> InputObject:
    base = reference_input()
    ref_fields = {k: overrides.pop(k) for k in ("store", "key", "version_id") if k in overrides}
    ref = ObjectRef(
        ref_fields.get("store", base.ref.store),
        ref_fields.get("key", base.ref.key),
        ref_fields.get("version_id", base.ref.version_id),
        NAMESPACE,
    )
    return replace(base, ref=ref, **overrides)


def test_format_and_version() -> None:
    key = _key()
    assert IDEMPOTENCY_KEY_VERSION == "ik1"
    assert key.startswith("ik1:") and IDEMPOTENCY_KEY.fullmatch(key)


def test_deterministic_and_matches_documented_material() -> None:
    assert _key() == _key()
    material = idempotency_material(
        namespace=NAMESPACE,
        job_type="reference.checksum",
        subject=SUBJECT,
        profile=REFERENCE_PROFILE,
        input=reference_input(),
        options=REFERENCE_OPTIONS,
    )
    assert material == {
        "v": 1,
        "namespace": "local",
        "job_type": "reference.checksum",
        "subject": {"subject_type": "reference_input", "subject_id": "subject-1"},
        "profile": {"profile_id": "reference-default", "version": 1},
        "input": {
            "store": "quarantine",
            "key": INPUT_KEY,
            "version_id": None,
            "sha256": reference_input().sha256,
            "size_bytes": 32,
            "content_type": "text/plain",
        },
        "options": {"metadata_level": "full", "write_report": True},
        "processor_version": None,
    }
    assert _key() == "ik1:" + sha256_hex(canonical_json(material))


def test_known_vector_is_stable() -> None:
    # A change to this value means every stored key changes: bump IDEMPOTENCY_KEY_VERSION.
    fixture = json.loads((FIXTURES / "request.reference.json").read_text())
    assert reference_request().idempotency_key == fixture["idempotency_key"]


def test_option_order_and_tuple_vs_list_do_not_matter() -> None:
    a = _key(options={"b": [1, 2], "a": "x"})
    b = _key(options={"a": "x", "b": (1, 2)})
    assert a == b


@pytest.mark.parametrize(
    "overrides",
    [
        {"namespace": "staging"},
        {"job_type": "asset.optimize"},
        {"subject": SubjectRef("reference_input", "subject-2")},
        {"subject": SubjectRef("other_type", "subject-1")},
        {"profile": ProfileRef("reference-default", 2)},
        {"profile": ProfileRef("reference-strict", 1)},
        {"input": None},
        {"options": {"metadata_level": "basic", "write_report": True}},
        {"options": {"metadata_level": "full"}},
        {"options": {"metadata_level": "full", "write_report": True, "extra": None}},
        {"options": {"metadata_level": "full", "write_report": 1}},
        {"processor_version": "1.0.0"},
    ],
)
def test_each_stable_field_changes_the_key(overrides: dict[str, Any]) -> None:
    if overrides.get("namespace") == "staging":
        key = f"processing/quarantine/staging/{ASSET_JOB_ID}/input.bin"
        overrides["input"] = replace(
            reference_input(), ref=ObjectRef(StoreName.QUARANTINE, key, None, "staging")
        )
    assert _key(**overrides) != _key()


@pytest.mark.parametrize(
    "input_overrides",
    [
        {"key": f"processing/quarantine/local/{OTHER_JOB_ID}/input.bin"},
        {"version_id": "v000001"},
        {"sha256": "0" * 64},
        {"size_bytes": 33},
        {"content_type": "application/octet-stream"},
        {"store": StoreName.ASSETS, "key": "assets/models/x/model.glb"},
    ],
)
def test_each_input_identity_field_changes_the_key(input_overrides: dict[str, Any]) -> None:
    assert _key(input=_input(**input_overrides)) != _key()


def test_processor_versions_differ() -> None:
    assert _key(processor_version="1.0.0") != _key(processor_version="1.0.1")


def test_execution_details_do_not_change_the_key() -> None:
    base = reference_request()
    variants = [
        reference_request(job_id=OTHER_JOB_ID),
        reference_request(attempt_id=OTHER_ATTEMPT_ID, attempt_number=2),
        reference_request(correlation_id="corr-other-9999"),
        reference_request(submitted_at=base.submitted_at + timedelta(hours=3), expires_at=None),
        reference_request(expires_at=base.submitted_at + timedelta(minutes=5)),
        reference_request(
            limits=ResourceLimits(
                max_input_bytes=1000,
                max_output_bytes=1000,
                max_execution_seconds=10,
                max_temp_bytes=1000,
                max_artifact_count=1,
                max_metadata_bytes=1000,
                max_message_bytes=1000,
                complexity={"max_lines": 5},
            )
        ),
    ]
    for request in variants:
        assert request_idempotency_key(request) == request_idempotency_key(base)
        assert verify_idempotency_key(request)


def test_resolved_options_make_equivalent_requests_equal() -> None:
    profile = ProcessingProfile(
        profile_id="reference-default",
        version=1,
        job_type="reference.checksum",
        description="test",
        options={
            "metadata_level": OptionSpec("str", default="full", choices=("full", "basic")),
            "write_report": OptionSpec("bool", default=True),
        },
    )
    explicit = profile.resolve_options({"metadata_level": "full", "write_report": True})
    implicit = profile.resolve_options({})
    assert _key(options=explicit) == _key(options=implicit) == _key()


def test_request_key_and_verification() -> None:
    request = reference_request()
    assert request_idempotency_key(request) == request.idempotency_key
    assert verify_idempotency_key(request)
    assert not verify_idempotency_key(request, processor_version="1.0.0")
    assert verify_idempotency_key(asset_request())


def test_verification_detects_tampering() -> None:
    forged = reference_request(idempotency_key="ik1:" + "0" * 64)
    assert not verify_idempotency_key(forged)
    changed = reference_request(options={"metadata_level": "basic", "write_report": True})
    assert not verify_idempotency_key(changed)


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"namespace": "Prod"}, ErrorCode.INVALID_INPUT),
        ({"namespace": None}, ErrorCode.INVALID_INPUT),
        ({"job_type": "asset.delete"}, ErrorCode.UNSUPPORTED_JOB_TYPE),
        ({"subject": {"subject_type": "x", "subject_id": "y"}}, ErrorCode.INVALID_INPUT),
        ({"profile": ("reference-default", 1)}, ErrorCode.INVALID_INPUT),
        ({"input": {"store": "quarantine"}}, ErrorCode.INVALID_INPUT),
        ({"options": [("a", 1)]}, ErrorCode.INVALID_INPUT),
        ({"options": {"Bad-Key": 1}}, ErrorCode.INVALID_INPUT),
        ({"options": {"x": float("nan")}}, ErrorCode.INVALID_INPUT),
        ({"options": {"x": {"nested": 1}}}, ErrorCode.INVALID_INPUT),
        ({"options": {"x": "y" * 300}}, ErrorCode.INVALID_INPUT),
        ({"processor_version": "v1"}, ErrorCode.INVALID_INPUT),
        ({"processor_version": 1}, ErrorCode.INVALID_INPUT),
        ({"namespace": "prod"}, ErrorCode.INVALID_OBJECT_REFERENCE),
    ],
)
def test_invalid_inputs_are_refused(overrides: dict[str, Any], code: ErrorCode) -> None:
    with pytest.raises(ProcessingError) as err:
        _key(**overrides)
    assert err.value.code is code
