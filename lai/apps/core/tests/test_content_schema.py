"""The content schema subset validator and asset references (LAI-0304, TR-2). No database."""

import copy
import json

import pytest
from django.conf import settings
from django.core.exceptions import ValidationError

from apps.catalog.asset_refs import AssetKind, AssetRefValidator, validate_asset_ref
from apps.core.content_schema import (
    ContentSchemaError,
    UnsupportedKeyword,
    schema_path,
    validate_file,
)

EXPORTED = settings.CONTENT_DIR / "exported"


def exported(name: str) -> dict:
    return json.loads((EXPORTED / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", sorted(path.name for path in EXPORTED.glob("*.json")))
def test_every_exported_file_is_valid(name):
    validate_file(name, exported(name))


def first_errors(name: str, data: dict) -> list[str]:
    with pytest.raises(ContentSchemaError) as raised:
        validate_file(name, data)
    return raised.value.errors


def test_a_missing_required_field_is_rejected():
    data = exported("quests.json")
    del data["quests"][0]["title"]
    assert "$.quests[0]: missing title" in first_errors("quests.json", data)


def test_an_unknown_field_is_rejected():
    data = exported("rewards.json")
    data["items"][0]["price"] = 3
    assert "$.items[0]: unknown field price" in first_errors("rewards.json", data)


def test_a_value_outside_an_enum_is_rejected():
    data = exported("rewards.json")
    data["items"][0]["category"] = "CURRENCY"
    assert any("$.items[0].category: not one of" in e for e in first_errors("rewards.json", data))


def test_a_boolean_is_not_an_integer():
    data = exported("adventures.json")
    data["adventures"][0]["version"] = True
    assert "$.adventures[0].version: expected integer" in first_errors("adventures.json", data)


def test_an_empty_string_breaks_min_length():
    data = exported("islands.json")
    data["islands"][0]["slug"] = ""
    assert "$.islands[0].slug: shorter than 1" in first_errors("islands.json", data)


def test_a_trigger_matching_no_one_of_option_is_rejected():
    data = exported("rewards.json")
    data["rewardRules"][0]["trigger"] = {"type": "CHEST_OPENED", "chestId": "cove-chest"}
    errors = first_errors("rewards.json", data)
    assert "$.rewardRules[0].trigger: matches 0 oneOf options, expected exactly 1" in errors


def test_an_unsupported_keyword_fails_loudly():
    schema = json.loads(schema_path().read_text(encoding="utf-8"))
    schema = copy.deepcopy(schema)
    schema["$defs"]["island"]["patternProperties"] = {}
    with pytest.raises(UnsupportedKeyword):
        validate_file("islands.json", exported("islands.json"), schema)


@pytest.fixture
def asset_catalog(db):
    """Asset references are checked against the canonical asset catalog (`ContentAsset`)."""
    from apps.catalog.importer import import_content

    import_content()


@pytest.mark.postgres
def test_known_asset_ids_of_the_right_kind_pass(asset_catalog):
    validate_asset_ref("treasure-chest", AssetKind.PROP)
    validate_asset_ref("")  # empty means placeholder


@pytest.mark.postgres
def test_unknown_or_wrong_kind_asset_ids_are_rejected(asset_catalog):
    with pytest.raises(ValidationError) as unknown:
        validate_asset_ref("https://bucket.s3.amazonaws.com/chest.glb", AssetKind.PROP)
    assert unknown.value.code == "asset_unknown"
    with pytest.raises(ValidationError) as wrong_kind:
        AssetRefValidator(AssetKind.CHARACTER)("treasure-chest")
    assert wrong_kind.value.code == "asset_wrong_kind"
