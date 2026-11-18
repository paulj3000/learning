"""AM-8: importing existing models (LAI-2200). Temporary files only; no AWS, nothing deleted."""

import json
from io import StringIO

import pytest
from django.core.management import call_command

from apps.assets.importer import import_bundled
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.tests.helpers import glb_bytes, gltf_json_bytes
from apps.catalog.models import AssetOrigin, ContentAsset, ContentRelease

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def release():
    return ContentRelease.objects.create(
        content_digest="d" * 64, schema_version=3, export_tool="test", files=[], report={}
    )


def exported(release, asset_id, path, *, kind="prop", clips=()):
    return ContentAsset.objects.create(
        asset_id=asset_id,
        kind=kind,
        category="prop" if kind != "character" else "npc",
        bundled_path=path,
        clips=list(clips),
        origin=AssetOrigin.EXPORT,
        last_seen_release=release,
    )


@pytest.fixture
def public(tmp_path):
    root = tmp_path / "public"
    (root / "models").mkdir(parents=True)
    (root / "models" / "npc-pip.gltf").write_bytes(gltf_json_bytes(clips=("Idle", "Talk")))
    (root / "models" / "rock.glb").write_bytes(glb_bytes(clips=()))
    (root / "models" / "broken.glb").write_bytes(b"glTF\x02\x00\x00\x00 broken")
    return root


def test_a_dry_run_reports_and_writes_nothing(release, public, storage):
    exported(release, "npc-pip", "/models/npc-pip.gltf", kind="character", clips=["Idle", "Talk"])
    exported(release, "rock", "/models/rock.glb")
    report = import_bundled(root=public, dry_run=True)
    assert {item["asset"] for item in report.imported} == {"npc-pip", "rock"}
    assert not AssetVersion.objects.exists() and not list(storage.list())


def test_bundled_models_become_validated_versions_and_a_rerun_imports_nothing(release, public):
    pip = exported(release, "npc-pip", "/models/npc-pip.gltf", kind="character", clips=["Idle"])
    exported(release, "rock", "/models/rock.glb")
    first = import_bundled(root=public)
    assert {(i["asset"], i["version"]) for i in first.imported} == {("npc-pip", 1), ("rock", 1)}
    version = AssetVersion.objects.get(asset=pip)
    assert version.status == VersionStatus.VALIDATED and version.format == "gltf"
    assert version.clips == ["Idle", "Talk"]  # known animation names come from the file
    pip.refresh_from_db()
    assert pip.default_version is None and pip.bundled_path == "/models/npc-pip.gltf"  # unchanged
    again = import_bundled(root=public)
    assert again.imported == [] and len(again.skipped) == 2
    assert AssetVersion.objects.count() == 2


def test_missing_invalid_unsafe_and_clip_breaking_files_are_unresolved(release, public):
    exported(release, "gone", "/models/gone.glb")
    exported(release, "broken", "/models/broken.glb")
    exported(release, "escape", "/../../../etc/passwd")
    exported(release, "npc-pip", "/models/npc-pip.gltf", kind="character", clips=["Wave"])
    report = import_bundled(root=public)
    reasons = {item.get("asset", item["path"]): item for item in report.unresolved}
    assert reasons["gone"]["reason"] == "file_missing"
    assert reasons["escape"]["reason"] == "unsafe_path"
    unresolved_paths = {item["path"]: item for item in report.unresolved}
    assert unresolved_paths["/models/broken.glb"]["reason"] == "invalid_file"
    assert "missing_clip" in unresolved_paths["/models/npc-pip.gltf"]["codes"]
    assert not AssetVersion.objects.exists()


def test_the_command_prints_a_summary_and_json(release, public):
    exported(release, "rock", "/models/rock.glb")
    out = StringIO()
    call_command("import_assets", "--from-bundled", "--root", str(public), "--dry-run", stdout=out)
    assert "Dry run: would import 1 file(s)." in out.getvalue()
    out = StringIO()
    call_command("import_assets", "--from-bundled", "--root", str(public), "--json", stdout=out)
    assert json.loads(out.getvalue())["imported"][0]["asset"] == "rock"
