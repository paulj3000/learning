"""Committed fixtures and JSON Schemas agree with the Python contracts.

- Each schema's top-level `required` and `properties` keys equal the contract's `to_dict()` keys.
- Every valid fixture decodes; every invalid fixture fails with exactly its manifest error code.
- The fixtures are exactly what `processing_samples.build_fixture_files()` generates (no drift).
- Valid fixtures validate against the schemas, and structural violations fail them
  (when `jsonschema` is available; the Python decoder stays the authority).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from processing_samples import (
    FIXTURES,
    INPUT_BYTES,
    INVALID,
    SCHEMAS,
    VALID_BUILDERS,
    VALID_DECODERS,
    asset_request,
    build_fixture_files,
    contract_object_paths,
    event_by_reference,
    event_inline,
    node_at,
    reference_request,
    result_failed_retryable,
    result_succeeded,
)

from lai_processing.contracts import decode, decode_event, decode_request, decode_result
from lai_processing.core.canonical import sha256_hex
from lai_processing.core.errors import ErrorCode, ProcessingError

DECODERS = {
    "request": decode_request,
    "result": decode_result,
    "event": decode_event,
    "any": decode,
}
SCHEMA_FILES = {
    "request": "job_request.v1.schema.json",
    "result": "job_result.v1.schema.json",
    "event": "job_completed.v1.schema.json",
}
MANIFEST: list[dict[str, str]] = json.loads((INVALID / "manifest.json").read_text())


def _schema(kind: str) -> dict[str, Any]:
    return json.loads((SCHEMAS / SCHEMA_FILES[kind]).read_text())


# --- schema shape ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "sample"),
    [
        ("request", reference_request),
        ("result", result_succeeded),
        ("event", event_inline),
        ("event", event_by_reference),
    ],
)
def test_schema_top_level_keys_match_contract(kind: str, sample: Any) -> None:
    schema = _schema(kind)
    keys = set(sample().to_dict())
    assert set(schema["required"]) == keys
    assert set(schema["properties"]) == keys
    assert len(schema["required"]) == len(set(schema["required"]))


def _schema_objects(node: Any, path: str = "") -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    if isinstance(node, dict):
        if "properties" in node and isinstance(node["properties"], dict):
            out.append((path, node))
        for key, value in node.items():
            out.extend(_schema_objects(value, f"{path}/{key}"))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            out.extend(_schema_objects(value, f"{path}/{i}"))
    return out


@pytest.mark.parametrize("kind", sorted(SCHEMA_FILES))
def test_schemas_are_closed_and_documented(kind: str) -> None:
    schema = _schema(kind)
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert schema["$id"].endswith(SCHEMA_FILES[kind])
    assert schema["description"]
    for path, obj in _schema_objects(schema):
        if path.startswith("/oneOf"):
            continue  # the result/result_ref exclusivity branches, not object definitions
        assert obj.get("additionalProperties") is False, path
        assert set(obj["required"]) == set(obj["properties"]), path
        for name, prop in obj["properties"].items():
            assert prop.get("description"), f"{path}/properties/{name}"
    for name, definition in schema.get("$defs", {}).items():
        assert definition.get("description"), name


def test_schema_nested_definitions_match_nested_contracts() -> None:
    request = reference_request().to_dict()
    req_defs = _schema("request")["$defs"]
    assert set(req_defs["subject"]["properties"]) == set(request["subject"])
    assert set(req_defs["profile_ref"]["properties"]) == set(request["profile"])
    assert set(req_defs["input_object"]["properties"]) == set(request["input"])
    assert set(req_defs["object_ref"]["properties"]) == set(request["input"]["ref"])
    assert set(req_defs["limits"]["properties"]) == set(request["limits"])

    assert set(req_defs["asset_context"]["properties"]) == set(asset_request().to_dict()["asset"])
    result = result_succeeded().to_dict()
    res_defs = _schema("result")["$defs"]
    assert set(res_defs["artifact_reference"]["properties"]) == set(result["artifacts"][0])
    assert set(res_defs["finding"]["properties"]) == set(result["findings"][0])
    assert set(res_defs["input_identity"]["properties"]) == set(result["input"])
    assert set(res_defs["processor_identity"]["properties"]) == set(result["processor"])

    error = result_failed_retryable().to_dict()["errors"][0]
    assert set(res_defs["job_error"]["properties"]) == set(error)
    assert set(res_defs["warning"]["properties"]) == {"code", "message"}
    codes = set(res_defs["job_error"]["properties"]["code"]["enum"])
    assert codes == {c.value for c in ErrorCode}


# --- fixtures ----------------------------------------------------------------------------------


def test_fixtures_match_generator() -> None:
    expected = build_fixture_files()
    for path, text in expected.items():
        assert path.read_text() == text, f"{path.name} drifted; regenerate with processing_samples"
    committed = {p for p in FIXTURES.rglob("*") if p.is_file()}
    assert committed == set(expected), "fixture files without a generator entry (or missing)"


@pytest.mark.parametrize("name", sorted(VALID_BUILDERS))
def test_valid_fixtures_decode(name: str) -> None:
    raw = (FIXTURES / name).read_bytes()
    message = DECODERS[VALID_DECODERS[name]](raw)
    assert decode(raw) == message
    assert raw.endswith(b"\n") and b'\n  "' in raw


def test_reference_input_bytes_match_request() -> None:
    data = (FIXTURES / "request.reference.input.txt").read_bytes()
    assert data == INPUT_BYTES == b"Learning makes the island grow.\n"
    request = decode_request((FIXTURES / "request.reference.json").read_bytes())
    assert request.input is not None
    assert (request.input.sha256, request.input.size_bytes) == (sha256_hex(data), len(data))


def test_manifest_is_complete() -> None:
    files = {entry["file"] for entry in MANIFEST}
    on_disk = {p.name for p in INVALID.glob("*.json")} - {"manifest.json"}
    assert files == on_disk
    assert len(MANIFEST) >= 20 and len(files) == len(MANIFEST)
    for entry in MANIFEST:
        assert set(entry) == {"file", "decoder", "error_code"}
        assert entry["decoder"] in DECODERS
        ErrorCode(entry["error_code"])


@pytest.mark.parametrize("entry", MANIFEST, ids=[e["file"] for e in MANIFEST])
def test_invalid_fixture_fails_with_its_code(entry: dict[str, str]) -> None:
    raw = (INVALID / entry["file"]).read_bytes()
    with pytest.raises(ProcessingError) as err:
        DECODERS[entry["decoder"]](raw)
    assert err.value.code.value == entry["error_code"]
    if entry["decoder"] != "any":
        with pytest.raises(ProcessingError) as err:
            decode(raw)
        assert err.value.code.value == entry["error_code"]


def test_invalid_fixtures_cover_the_required_attacks() -> None:
    names = " ".join(entry["file"] for entry in MANIFEST)
    for fragment in (
        "unknown_field",
        "missing_field",
        "wrong_kind",
        "schema_version_2",
        "schema_version_string",
        "key_traversal",
        "key_absolute",
        "key_backslash",
        "key_other_namespace",
        "cross_job_artifact_key",
        "store_bucket_name",
        "key_presigned_url",
        "naive_timestamp",
        "nan",
        "duplicate_key",
        "deep_nesting",
        "bool_as_int",
        "oversized_option",
        "smuggled_error_message",
        "retry_class_inconsistent",
        "succeeded_with_errors",
        "pass_with_error_findings",
        "unknown_job_type",
        "asset_job_without_asset",
        "subject_not_asset_version",
    ):
        assert fragment in names, fragment


# --- JSON Schema validation (optional dependency) ----------------------------------------------


@pytest.fixture(scope="module")
def validators() -> dict[str, Any]:
    jsonschema = pytest.importorskip("jsonschema")
    referencing = pytest.importorskip("referencing")
    schemas = {kind: _schema(kind) for kind in SCHEMA_FILES}
    registry = referencing.Registry().with_resources(
        (s["$id"], referencing.Resource.from_contents(s)) for s in schemas.values()
    )
    out = {}
    for kind, schema in schemas.items():
        jsonschema.Draft202012Validator.check_schema(schema)
        out[kind] = jsonschema.Draft202012Validator(schema, registry=registry)
    return out


@pytest.mark.parametrize("name", sorted(VALID_BUILDERS))
def test_valid_fixtures_satisfy_schema(name: str, validators: dict[str, Any]) -> None:
    data = json.loads((FIXTURES / name).read_text())
    errors = list(validators[VALID_DECODERS[name]].iter_errors(data))
    assert not errors, [e.message for e in errors]


@pytest.mark.parametrize("name", sorted(VALID_BUILDERS))
def test_schema_refuses_unknown_and_missing_keys(name: str, validators: dict[str, Any]) -> None:
    validator = validators[VALID_DECODERS[name]]
    base = json.loads((FIXTURES / name).read_text())
    for path in contract_object_paths(base):
        data = json.loads((FIXTURES / name).read_text())
        node_at(data, path)["zz_unknown"] = None
        assert not validator.is_valid(data), path
        for key in list(node_at(base, path)):
            data = json.loads((FIXTURES / name).read_text())
            del node_at(data, path)[key]
            assert not validator.is_valid(data), (path, key)


@pytest.mark.parametrize(
    "file",
    [
        "request.unknown_field.json",
        "request.unknown_nested_field.json",
        "request.missing_field.json",
        "request.wrong_kind.json",
        "request.schema_version_2.json",
        "request.schema_version_string.json",
        "request.key_absolute.json",
        "request.key_backslash.json",
        "request.key_traversal.json",
        "request.key_url_scheme.json",
        "request.store_bucket_name.json",
        "request.key_presigned_url.json",
        "request.naive_timestamp.json",
        "request.bool_as_int.json",
        "request.oversized_option.json",
        "request.option_control_chars.json",
        "request.bad_idempotency_key.json",
        "request.zero_limit.json",
        "result.unsafe_error_details.json",
        "event.result_and_ref.json",
    ],
)
def test_schema_refuses_structural_invalid_fixtures(file: str, validators: dict[str, Any]) -> None:
    kind = file.split(".", 1)[0]
    data = json.loads((INVALID / file).read_text())
    assert not validators[kind].is_valid(data)


def test_paths_are_relative_to_repo() -> None:
    assert Path(FIXTURES).is_dir() and Path(SCHEMAS).is_dir()
