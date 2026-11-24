"""GE-247 S1: the catalog's usage provider lists shipped scenes in Asset Library usage.

Listed, never blocking (owner, 2026-11-23). Uses the real registry as the apps register it.
docs/engineering/game-engine/bundled-asset-references.md; docs/ASSET_LIBRARY.md section 25.3.
"""

import json
from io import StringIO

import pytest
from django.core.management import call_command

from apps.assets import dependencies, services
from apps.assets.models import CollisionProfile, VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog import dependencies as catalog_dependencies
from apps.catalog.importer import DEFAULT_EXPORT_DIR, import_content
from apps.catalog.models import AssetStatus, ContentAsset
from apps.catalog.tests.helpers import base_collections, write_export

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def catalog_usages(asset_id: str):
    asset = ContentAsset.objects.get(asset_id=asset_id)
    return [u for u in dependencies.usages_for(asset) if u.source == "catalog"]


def test_the_catalog_app_registers_its_provider():
    assert "catalog" in dependencies.registered_sources()
    registration = dependencies._PROVIDERS["catalog"]
    assert registration.provider is catalog_dependencies.catalog_usages
    assert registration.refusal is None


def test_shipped_scenes_are_listed_and_never_block(tmp_path):
    release = import_content(write_export(tmp_path / "v1")).release_id

    usages = catalog_usages("rock")
    note = "Shipped with the app: these scenes keep drawing the bundled model."
    assert [(u.source, u.code, u.label, u.blocks_retirement, u.admin_url) for u in usages] == [
        ("catalog", "shipped_scene", "Shipped scene bay (bundled model)", False, ""),
        ("catalog", "shipped_scene", "Shipped scene welcome-harbor (bundled model)", False, ""),
    ]
    assert [dict(u.details) for u in usages] == [
        {"scene": "bay", "release": release, "current": True, "note": note},
        {"scene": "welcome-harbor", "release": release, "current": True, "note": note},
    ]


def test_all_eleven_welcome_harbor_assets_are_listed_from_the_shipped_export():
    import_content(DEFAULT_EXPORT_DIR)
    hub = [
        "wall",
        "roof",
        "door",
        "ground-tile",
        "rock",
        "foliage-tree",
        "foliage-tree-lod1",
        "foliage-bush",
        "fence",
        "npc-pip",
        "collectible-gem",
    ]
    for asset_id in hub:
        scenes = [u.details["scene"] for u in catalog_usages(asset_id)]
        assert "welcome-harbor" in scenes, asset_id


def test_a_stale_reference_is_listed_with_its_release(tmp_path):
    first = import_content(write_export(tmp_path / "v1")).release_id
    smaller = base_collections()
    smaller["assets.json"]["locationAssets"] = [
        {"regionSlug": "bay", "assetIds": ["rock"]},
        {"regionSlug": "welcome-harbor", "assetIds": []},
    ]
    import_content(write_export(tmp_path / "v2", smaller))

    (tree,) = catalog_usages("tree")
    assert tree.label == f"Shipped scene bay (bundled model, last seen in release {first})"
    assert (tree.details["current"], tree.details["release"]) == (False, first)
    assert tree.blocks_retirement is False


def test_the_note_names_the_collision_change_when_the_asset_has_a_profile(tmp_path):
    import_content(write_export(tmp_path / "v1"))
    CollisionProfile.objects.create(asset=ContentAsset.objects.get(asset_id="rock"))
    notes = {u.details["note"] for u in catalog_usages("rock")}
    (note,) = notes
    assert "keep drawing the bundled model" in note
    assert "collision profile" in note


def test_a_version_question_and_an_unused_asset_list_nothing(tmp_path):
    import_content(write_export(tmp_path / "v1"))
    rock = ContentAsset.objects.get(asset_id="rock")
    version = make_version(rock, 1, status=VersionStatus.PUBLISHED)
    assert catalog_dependencies.catalog_usages(rock, version) == []
    assert [u for u in dependencies.usages_for(rock, version) if u.source == "catalog"] == []
    assert catalog_usages("tree-lod1") == []
    assert catalog_dependencies.catalog_usages(make_definition("lone"), None) == []


def test_retiring_an_asset_shipped_scenes_use_succeeds_through_every_guard(tmp_path):
    import_content(write_export(tmp_path / "v1"))
    rock = ContentAsset.objects.get(asset_id="rock")
    assert dependencies.retirement_guard in services.RETIREMENT_GUARDS

    services.retire_asset(rock)

    rock.refresh_from_db()
    assert rock.status == AssetStatus.RETIRED
    # Still listed after retirement: the scenes keep drawing the bundled model.
    assert [u.details["scene"] for u in catalog_usages("rock")] == ["bay", "welcome-harbor"]


def test_a_failing_catalog_check_refuses_retirement(tmp_path, monkeypatch):
    """Fail closed (ASSET_LIBRARY.md 25.2 rule 4): an error is never read as 'no usages'."""
    import_content(write_export(tmp_path / "v1"))
    rock = ContentAsset.objects.get(asset_id="rock")

    def broken(asset):
        raise RuntimeError("index unreadable")

    monkeypatch.setattr(catalog_dependencies, "shipped_scene_usages", broken)
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(rock)
    assert refused.value.code == "dependency_check_failed"
    assert refused.value.details == {"source": "catalog"}
    rock.refresh_from_db()
    assert rock.status == AssetStatus.ACTIVE


def test_the_asset_usage_command_lists_shipped_scenes(tmp_path):
    import_content(write_export(tmp_path / "v1"))

    out = StringIO()
    call_command("asset_usage", "rock", stdout=out)
    text = out.getvalue()
    assert "rock: 2 usage(s), 0 blocking retirement (checked: " in text
    assert "  [listed] catalog: Shipped scene bay (bundled model)\n" in text
    assert "  [listed] catalog: Shipped scene welcome-harbor (bundled model)\n" in text

    out = StringIO()
    call_command("asset_usage", "rock", "--json", stdout=out)
    report = json.loads(out.getvalue())
    assert report["blocksRetirement"] is False
    assert {u["details"]["scene"] for u in report["usages"] if u["source"] == "catalog"} == {
        "bay",
        "welcome-harbor",
    }
