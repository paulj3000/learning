import json
from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from apps.catalog import importer
from apps.catalog.importer import ContentImportError, import_content
from apps.catalog.models import (
    Adventure,
    AdventureStep,
    ContentAsset,
    ContentRelease,
    Location,
    LocationAsset,
    Quest,
    World,
)
from apps.catalog.tests.helpers import base_collections, write_export

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

ALL_MODELS = (World, Location, Adventure, AdventureStep, Quest, ContentAsset, LocationAsset)


def _row_counts():
    return {model.__name__: model.objects.count() for model in (*ALL_MODELS, ContentRelease)}


def test_imports_the_hierarchy_with_stable_identifiers(tmp_path):
    report = import_content(write_export(tmp_path / "v1"))

    assert report.status == "imported"
    world = World.objects.get(slug="home-island")
    bay = Location.objects.get(slug="bay")
    bridge = Adventure.objects.get(slug="fix-bridge")
    assert bay.world == world and bridge.location == bay and bridge.world == world
    assert [s.step_id for s in bridge.steps.order_by("position")] == ["count", "done"]
    quest = Quest.objects.get(slug="repair")
    assert quest.world == world and list(quest.adventures.all()) == [bridge]
    assert report.counts["worlds"] == {"created": 1, "updated": 0, "unchanged": 0, "missing": 0}
    assert report.counts["steps"]["created"] == 3


def test_a_story_only_location_keeps_its_slug_without_a_location_row(tmp_path):
    import_content(write_export(tmp_path / "v1"))
    tale = Adventure.objects.get(slug="tale")
    assert tale.location is None and tale.location_slug == "story-only-place"


def test_step_ids_repeat_across_adventures_but_not_within_one(tmp_path):
    import_content(write_export(tmp_path / "v1"))
    assert AdventureStep.objects.filter(step_id="done").count() == 2


def test_location_asset_associations_keep_export_order_and_skip_regions_without_a_location(tmp_path):
    report = import_content(write_export(tmp_path / "v1"))

    links = LocationAsset.objects.filter(location__slug="bay").order_by("position")
    assert [link.asset.asset_id for link in links] == ["tree", "rock"]
    assert ContentAsset.objects.get(asset_id="tree").low_detail.asset_id == "tree-lod1"
    assert report.skipped == ["location assets 'welcome-harbor': region has no Location record (1 assets)"]


def test_the_same_export_twice_is_skipped_as_unchanged(tmp_path):
    export = write_export(tmp_path / "v1")
    import_content(export)
    before = _row_counts()

    report = import_content(export)

    assert report.status == "unchanged"
    assert report.skipped[0].endswith("is already the latest")
    assert _row_counts() == before


def test_force_reapplies_and_reports_everything_unchanged(tmp_path):
    export = write_export(tmp_path / "v1")
    import_content(export)

    report = import_content(export, force=True)

    assert report.status == "imported"
    assert all(counts["created"] == 0 and counts["updated"] == 0 for counts in report.counts.values())
    assert ContentRelease.objects.count() == 2


def test_reimport_updates_content_but_preserves_catalog_fields(tmp_path):
    import_content(write_export(tmp_path / "v1"))
    Location.objects.filter(slug="bay").update(active=False, sort_order=999)

    changed = base_collections()
    changed["locations.json"]["locations"][0]["title"] = "The Busy Bay"
    report = import_content(write_export(tmp_path / "v2", changed))

    bay = Location.objects.get(slug="bay")
    assert bay.title == "The Busy Bay"
    assert (bay.active, bay.sort_order) == (False, 999)
    assert report.counts["locations"] == {"created": 0, "updated": 1, "unchanged": 0, "missing": 0}


def test_records_missing_from_a_newer_export_are_kept_and_reported(tmp_path):
    first = import_content(write_export(tmp_path / "v1"))
    smaller = base_collections()
    smaller["adventures.json"]["adventures"] = smaller["adventures.json"]["adventures"][:1]
    smaller["islands.json"]["islands"][0]["pack"]["adventureSlugs"] = ["fix-bridge"]

    report = import_content(write_export(tmp_path / "v2", smaller))

    tale = Adventure.objects.get(slug="tale")
    assert tale.last_seen_release_id == first.release_id
    assert report.counts["adventures"]["missing"] == 1
    assert report.counts["steps"]["missing"] == 1


def test_an_invalid_export_is_rejected_with_every_problem_and_writes_nothing(tmp_path):
    broken = base_collections()
    broken["locations.json"]["locations"][0]["worldSlug"] = "nowhere"
    broken["quests.json"]["quests"][0]["stages"][0]["objectives"][0]["adventureSlug"] = "missing"
    broken["assets.json"]["locationAssets"][0]["assetIds"].append("ghost")

    with pytest.raises(ContentImportError) as error:
        import_content(write_export(tmp_path / "bad", broken))

    assert len(error.value.problems) == 3
    assert all(count == 0 for count in _row_counts().values())


def test_a_failure_while_applying_rolls_the_whole_import_back(tmp_path, monkeypatch):
    real_upsert = importer._upsert
    calls = {"n": 0}

    def failing_upsert(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 5:
            raise RuntimeError("database went away")
        return real_upsert(*args, **kwargs)

    monkeypatch.setattr(importer, "_upsert", failing_upsert)
    with pytest.raises(RuntimeError):
        import_content(write_export(tmp_path / "v1"))

    assert all(count == 0 for count in _row_counts().values())


def test_a_dry_run_reports_but_writes_nothing(tmp_path):
    report = import_content(write_export(tmp_path / "v1"), dry_run=True)

    assert report.status == "dry-run"
    assert report.counts["adventures"]["created"] == 2
    assert all(count == 0 for count in _row_counts().values())


def test_the_release_records_digest_schema_and_report(tmp_path):
    export = write_export(tmp_path / "v1")
    report = import_content(export)

    release = ContentRelease.objects.get()
    manifest = json.loads((export / "manifest.json").read_text())
    assert release.content_digest == manifest["contentDigest"] == report.content_digest
    assert release.schema_version == 3
    assert release.report["counts"]["worlds"]["created"] == 1


def test_a_file_that_differs_from_its_manifest_hash_is_rejected(tmp_path):
    export = write_export(tmp_path / "v1")
    path = export / "quests.json"
    path.write_text(path.read_text().replace("Repair it", "Repair it!"))

    with pytest.raises(ContentImportError, match="1 problem"):
        import_content(export)
    assert ContentRelease.objects.count() == 0


def test_a_manifest_whose_digest_does_not_match_its_files_is_rejected(tmp_path):
    export = write_export(tmp_path / "v1")
    manifest = json.loads((export / "manifest.json").read_text())
    manifest["contentDigest"] = "0" * 64
    (export / "manifest.json").write_text(json.dumps(manifest))

    with pytest.raises(ContentImportError) as error:
        import_content(export)
    assert error.value.problems == ["manifest.json: content digest does not match the files"]


def test_an_unsupported_schema_version_is_rejected(tmp_path):
    with pytest.raises(ContentImportError, match="1 problem"):
        import_content(write_export(tmp_path / "v9", schema_version=9))


def test_a_schema_2_export_imports_without_asset_associations(tmp_path):
    older = base_collections()
    del older["assets.json"]["locationAssets"]

    report = import_content(write_export(tmp_path / "v2", older, schema_version=2))

    assert report.schema_version == 2
    assert LocationAsset.objects.count() == 0 and ContentAsset.objects.count() == 3


def test_the_shipped_export_imports_cleanly():
    """The real content/exported tree, as committed: counts match its manifest."""
    report = import_content()

    manifest = json.loads((importer.DEFAULT_EXPORT_DIR / "manifest.json").read_text())
    counts = {name: n for f in manifest["files"] for name, n in f["counts"].items()}
    assert World.objects.count() == counts["islands"]
    assert Location.objects.count() == counts["locations"]
    assert Adventure.objects.count() == counts["adventures"]
    assert Quest.objects.count() == counts["quests"]
    assert ContentAsset.objects.count() == counts["assets"]
    assert report.skipped == [
        "location assets 'welcome-harbor': region has no Location record (11 assets)"
    ]
    assert LocationAsset.objects.values("location").distinct().count() == counts["locationAssets"] - 1


def test_the_command_reports_counts_and_fails_cleanly_on_an_invalid_export(tmp_path):
    out = StringIO()
    call_command("load_content", path=write_export(tmp_path / "v1"), stdout=out)
    assert "imported: release" in out.getvalue()
    assert "worlds: created 1, updated 0, unchanged 0, missing 0" in out.getvalue()

    broken = base_collections()
    broken["locations.json"]["locations"][0]["worldSlug"] = "nowhere"
    err = StringIO()
    with pytest.raises(CommandError, match="nothing was written"):
        call_command("load_content", path=write_export(tmp_path / "bad", broken), stderr=err)
    assert "invalid: location 'bay': unknown world 'nowhere'" in err.getvalue()
