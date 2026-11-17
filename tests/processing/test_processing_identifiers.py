"""Identifier patterns and object-key safety rules (contracts/identifiers.py)."""

from __future__ import annotations

import pytest
from lai_processing.contracts.common import ObjectRef
from lai_processing.contracts.identifiers import (
    CORRELATION_ID,
    IDEMPOTENCY_KEY,
    MAX_KEY_LENGTH,
    NAMESPACE,
    SEMVER,
    StoreName,
    artifact_key,
    artifact_prefix,
    check_object_key,
    check_pattern,
    is_uuid,
)
from lai_processing.core.errors import ErrorCode, ProcessingError

JOB = "6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f"
ATT = "0b9a8c7d-6e5f-4a3b-9c2d-1e0f2a3b4c5d"
Q = "processing/quarantine/local"
A = "processing/artifacts/local"

VALID_KEYS = [
    (StoreName.QUARANTINE, "local", f"{Q}/{JOB}/input.bin"),
    (StoreName.QUARANTINE, "local", f"{Q}/x"),
    (StoreName.ARTIFACTS, "local", f"{A}/{JOB}/{ATT}/report.json"),
    (StoreName.ASSETS, None, "assets/models/npc-pip/v1/model.glb"),
    (StoreName.ASSETS, "local", "assets/audio/x=y/clip_1.ogg"),
    (StoreName.QUARANTINE, "staging-eu", "processing/quarantine/staging-eu/a/b.c"),
]

# (store, namespace, key, reason)
INVALID_KEYS = [
    (StoreName.QUARANTINE, "local", "", "empty"),
    (StoreName.QUARANTINE, "local", None, "empty"),
    (StoreName.QUARANTINE, "local", 42, "empty"),
    (StoreName.QUARANTINE, "local", f"{Q}/" + "a" * MAX_KEY_LENGTH, "too_long"),
    (StoreName.QUARANTINE, "local", f"{Q}/{JOB}/../../prod/x", "segment"),
    (StoreName.QUARANTINE, "local", f"{Q}/./x", "segment"),
    (StoreName.QUARANTINE, "local", f"{Q}//x", "segment"),
    (StoreName.QUARANTINE, "local", f"/{Q}/x", "slash"),
    (StoreName.QUARANTINE, "local", f"{Q}/x/", "slash"),
    (StoreName.QUARANTINE, "local", f"{Q}\\x", "characters"),
    (StoreName.QUARANTINE, "local", f"{Q}/x?X-Amz-Signature=abc", "characters"),
    (StoreName.QUARANTINE, "local", f"s3://bucket/{Q}/x", "characters"),
    (StoreName.QUARANTINE, "local", f"{Q}/x y", "characters"),
    (StoreName.QUARANTINE, "local", f"{Q}/x\n", "characters"),
    (StoreName.QUARANTINE, "local", f"{Q}/x\x00", "characters"),
    (StoreName.QUARANTINE, "local", f"{Q}/café", "characters"),
    (StoreName.QUARANTINE, "local", f"{Q}/%2e%2e/x", "characters"),
    (StoreName.QUARANTINE, "local", f"{Q}/x#frag", "characters"),
    (StoreName.QUARANTINE, "local", "assets/models/x.glb", "prefix"),
    (StoreName.ASSETS, None, f"{Q}/x", "prefix"),
    (StoreName.ASSETS, None, "Assets/x", "prefix"),
    (StoreName.ARTIFACTS, "local", f"{Q}/x", "prefix"),
    (StoreName.QUARANTINE, "local", "processing/quarantine/prod/x", "namespace"),
    (StoreName.QUARANTINE, "local", "processing/quarantine/local-2/x", "namespace"),
    (StoreName.QUARANTINE, "local", "processing/quarantine/localx", "namespace"),
    (StoreName.QUARANTINE, None, f"{Q}/x", "namespace"),
    (StoreName.ARTIFACTS, "prod", f"{A}/{JOB}/{ATT}/r.json", "namespace"),
]


@pytest.mark.parametrize(("store", "namespace", "key"), VALID_KEYS)
def test_valid_keys(store: StoreName, namespace: str | None, key: str) -> None:
    assert check_object_key(key, store, namespace, "k") == key


@pytest.mark.parametrize(("store", "namespace", "key", "reason"), INVALID_KEYS)
def test_invalid_keys(store: StoreName, namespace: str | None, key: object, reason: str) -> None:
    with pytest.raises(ProcessingError) as err:
        check_object_key(key, store, namespace, "input.ref.key")
    assert err.value.code is ErrorCode.INVALID_OBJECT_REFERENCE
    assert err.value.details == {"field": "input.ref.key", "reason": reason}


def test_key_errors_never_echo_the_key() -> None:
    hostile = f"{Q}/secret-child-name?token=abc"
    with pytest.raises(ProcessingError) as err:
        check_object_key(hostile, StoreName.QUARANTINE, "local", "k")
    assert "secret" not in repr(err.value) and "secret" not in str(err.value)


def test_artifact_prefix_and_key() -> None:
    assert artifact_prefix("local", JOB, ATT) == f"{A}/{JOB}/{ATT}/"
    key = artifact_key("local", JOB, ATT, "job-result", "json")
    assert key == f"{A}/{JOB}/{ATT}/job-result.json"
    assert check_object_key(key, StoreName.ARTIFACTS, "local", "k") == key


@pytest.mark.parametrize(
    ("args", "field"),
    [
        (("Local", JOB, ATT), "namespace"),
        (("local", JOB.upper(), ATT), "job_id"),
        (("local", JOB, "not-a-uuid"), "attempt_id"),
        (("local", "../" + JOB, ATT), "job_id"),
    ],
)
def test_artifact_prefix_refuses_bad_parts(args: tuple[str, str, str], field: str) -> None:
    with pytest.raises(ProcessingError) as err:
        artifact_prefix(*args)
    assert err.value.details["field"] == field


@pytest.mark.parametrize(
    ("logical_id", "extension"),
    [("../x", "json"), ("Report", "json"), ("r", "JSON"), ("r", "j/s"), ("r", "a" * 11), ("", "j")],
)
def test_artifact_key_refuses_bad_names(logical_id: str, extension: str) -> None:
    with pytest.raises(ProcessingError):
        artifact_key("local", JOB, ATT, logical_id, extension)


@pytest.mark.parametrize(
    ("value", "ok"),
    [(JOB, True), (JOB.upper(), False), (JOB[:-1], False), (JOB + "0", False), (None, False),
     ("6f1c2d3e4b5a4c6d8e7f0a1b2c3d4e5f", False)],
)
def test_is_uuid(value: object, ok: bool) -> None:
    assert is_uuid(value) is ok


@pytest.mark.parametrize(
    ("pattern", "good", "bad"),
    [
        (NAMESPACE, ["local", "prod", "staging-eu", "a1"], ["Local", "-a", "a-", "a--b", "1a", ""]),
        (SEMVER, ["1.0.0", "0.10.2"], ["01.0.0", "1.0", "1.0.0-rc1", "v1.0.0"]),
        (CORRELATION_ID, ["corr-0001", "A.b_c-12"], ["short", "has space1", "x" * 65]),
        (IDEMPOTENCY_KEY, ["ik1:" + "a" * 64], ["ik2:" + "a" * 64, "ik1:" + "A" * 64]),
    ],
)
def test_patterns(pattern: object, good: list[str], bad: list[str]) -> None:
    for value in good:
        assert check_pattern(value, pattern, "f", max_length=100) == value  # type: ignore[arg-type]
    for value in bad:
        with pytest.raises(ProcessingError):
            check_pattern(value, pattern, "f", max_length=100)  # type: ignore[arg-type]


def test_check_pattern_length_and_type() -> None:
    with pytest.raises(ProcessingError):
        check_pattern("a" * 65, NAMESPACE, "f")
    with pytest.raises(ProcessingError):
        check_pattern(5, NAMESPACE, "f")


@pytest.mark.parametrize("store", ["s3://bucket", "lai-assets-prod", "ASSETS", "", None, 1])
def test_object_ref_refuses_unknown_stores(store: object) -> None:
    with pytest.raises(ProcessingError) as err:
        ObjectRef(store, "assets/x", None, None)  # type: ignore[arg-type]
    assert err.value.code is ErrorCode.INVALID_OBJECT_REFERENCE
    with pytest.raises(ProcessingError) as err:
        ObjectRef.from_dict({"store": store, "key": "assets/x", "version_id": None}, "r", None)
    assert err.value.code is ErrorCode.INVALID_OBJECT_REFERENCE


@pytest.mark.parametrize("version", ["", "a b", "x" * 1025, 5, "v/1"])
def test_object_ref_refuses_bad_version_ids(version: object) -> None:
    with pytest.raises(ProcessingError) as err:
        ObjectRef(StoreName.ASSETS, "assets/x", version, None)  # type: ignore[arg-type]
    assert err.value.code is ErrorCode.INVALID_OBJECT_REFERENCE


def test_object_ref_round_trip_does_not_serialise_namespace() -> None:
    ref = ObjectRef(StoreName.QUARANTINE, f"{Q}/x", "v1", "local")
    assert ref.to_dict() == {"store": "quarantine", "key": f"{Q}/x", "version_id": "v1"}
    assert ObjectRef.from_dict(ref.to_dict(), "r", "local") == ref
