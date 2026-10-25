"""Validation of `content/exported/*.json` against `content/schema/content.schema.json`.

The schema uses a small subset of JSON Schema 2020-12, so this implements exactly that subset
instead of adding a dependency: type, const, enum, minLength, maxLength, minimum, maximum,
properties, required, additionalProperties (false only), items, oneOf, and local `$ref`. Any
other keyword raises `UnsupportedKeyword`, so a schema change that needs more fails loudly
rather than validating less.
"""

import json
from functools import lru_cache
from pathlib import Path

from django.conf import settings

ANNOTATIONS = frozenset({"$id", "$schema", "title", "description", "$defs"})
SUPPORTED = frozenset(
    {
        "type",
        "const",
        "enum",
        "minLength",
        "maxLength",
        "minimum",
        "maximum",
        "properties",
        "required",
        "additionalProperties",
        "items",
        "oneOf",
        "$ref",
    }
)
_TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
    "null": type(None),
}


class UnsupportedKeyword(ValueError):
    pass


class ContentSchemaError(ValueError):
    """The exported content does not match the schema. `errors` lists `path: message`."""

    def __init__(self, file_name: str, errors: list[str]):
        super().__init__(f"{file_name}: {len(errors)} schema error(s); first: {errors[0]}")
        self.file_name = file_name
        self.errors = errors


def schema_path() -> Path:
    return settings.CONTENT_DIR / "schema" / "content.schema.json"


@lru_cache(maxsize=4)
def _load_schema(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def validate_file(file_name: str, data: object, schema: dict | None = None) -> None:
    """Validate one exported file's parsed JSON. Raises `ContentSchemaError`."""
    root = schema if schema is not None else _load_schema(str(schema_path()))
    ref = root.get("x-files", {}).get(file_name)
    if ref is None:
        raise ContentSchemaError(file_name, ["$: no schema entry for this file"])
    errors: list[str] = []
    _validate(data, {"$ref": ref}, root, "$", errors)
    if errors:
        raise ContentSchemaError(file_name, errors)


def _resolve(ref: str, root: dict) -> dict:
    if not ref.startswith("#/"):
        raise UnsupportedKeyword(f"non-local $ref {ref}")
    node: object = root
    for part in ref[2:].split("/"):
        node = node[part]  # type: ignore[index]
    return node  # type: ignore[return-value]


def _is_type(value: object, name: str) -> bool:
    if name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if name == "number":
        return isinstance(value, int | float) and not isinstance(value, bool)
    return isinstance(value, _TYPES[name])


def _validate(value: object, schema: dict, root: dict, path: str, errors: list[str]) -> None:
    unknown = set(schema) - SUPPORTED - ANNOTATIONS
    if unknown:
        raise UnsupportedKeyword(", ".join(sorted(unknown)))
    if "$ref" in schema:
        _validate(value, _resolve(schema["$ref"], root), root, path, errors)
    if "oneOf" in schema:
        matches = 0
        for option in schema["oneOf"]:
            option_errors: list[str] = []
            _validate(value, option, root, path, option_errors)
            matches += not option_errors
        if matches != 1:
            errors.append(f"{path}: matches {matches} oneOf options, expected exactly 1")
    if "type" in schema and not _is_type(value, schema["type"]):
        errors.append(f"{path}: expected {schema['type']}")
        return
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: expected {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: not one of {schema['enum']}")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            errors.append(f"{path}: shorter than {schema['minLength']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(f"{path}: longer than {schema['maxLength']}")
    if isinstance(value, int | float) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: below {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path}: above {schema['maximum']}")
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for key in schema.get("required", ()):
            if key not in value:
                errors.append(f"{path}: missing {key}")
        for key, item in value.items():
            if key in properties:
                _validate(item, properties[key], root, f"{path}.{key}", errors)
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}: unknown field {key}")
    if isinstance(value, list) and "items" in schema:
        for index, item in enumerate(value):
            _validate(item, schema["items"], root, f"{path}[{index}]", errors)
