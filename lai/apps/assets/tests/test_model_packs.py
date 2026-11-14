"""Importing environment packs: palms, barrels, logs (TR-PALM-03/04/07, TR-ENV-03/04/05/08).

Synthetic packs (`pack_files.py`) in temporary directories; memory, local and stubbed-S3 storage.
No real model binary, no network, no AWS credentials.
"""

import dataclasses
import json
import re
import zipfile
from io import StringIO

import pytest
from botocore.stub import ANY, Stubber
from django.core.management import CommandError, call_command
from django.utils.text import slugify

from apps.assets import model_packs
from apps.assets.model_packs import (
    PACKS,
    QUATERNIUS_BARRELS,
    QUATERNIUS_LOGS,
    QUATERNIUS_PALM_TREES,
    ModelPack,
    PackModel,
    PackRefused,
    import_pack,
)
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.storage import S3AssetStorage, get_storage
from apps.catalog.models import AssetStatus, ContentAsset

from .pack_files import pack_glb, rgba_png

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

TREES = ModelPack(
    pack_id="test-trees",
    group="palms",
    title="Test Trees",
    author="Test Author",
    licence="CC0 1.0 Universal",
    licence_url="https://creativecommons.org/publicdomain/zero/1.0/",
    licence_evidence="Made for the tests.",
    licence_confirmed=True,
    kind="kit-piece",
    category="scenery",
    tags=("nature", "trees"),
    models=(
        PackModel(
            "test-tree-tall",
            "Tall",
            "Tall tree",
            "A tall one.",
            source_url="https://example.invalid/trees",
            known_source_sha256="0" * 64,
            fit=("y", 6.0),
        ),
        PackModel(
            "test-tree-short",
            "Short",
            "Short tree",
            "A short one.",
            source_url="https://example.invalid/trees",
            known_source_sha256="0" * 64,
            fit=("y", 2.5),
            center_footprint=True,
        ),
    ),
    max_texture_size=8,
)
LOGS = dataclasses.replace(
    TREES,
    pack_id="test-logs",
    group="logs",
    licence_confirmed=False,
    kind="prop",
    category="prop",
    models=(
        PackModel(
            "test-log",
            "Log",
            "Log",
            "A log.",
            source_url="https://example.invalid/log",
            known_source_sha256="0" * 64,
            fit=("x", 2.0),
            yaw_degrees=90.0,
            center_footprint=True,
        ),
    ),
)


@pytest.fixture
def source(tmp_path):
    directory = tmp_path / "downloads"
    directory.mkdir()
    (directory / "trees.glb").write_bytes(
        pack_glb({"Tall": (1.0, 1.0, 5.0), "Short": (2.0, 2.0, 1.0)}, texture=rgba_png(16, 16))
    )
    (directory / "log.glb").write_bytes(pack_glb({"Log": (0.5, 3.0, 0.5)}))
    (directory / "Barrel.fbx").write_bytes(b"Kaydara FBX Binary  \x00")
    (directory / "readme.txt").write_text("not a model")
    return directory


@pytest.fixture
def local_dev(settings):
    """A confirmed local development environment: DEBUG on, memory storage, loopback database."""
    settings.DEBUG = True
    settings.LAI_ASSET_STORAGE = "memory"
    return settings


def versions(asset_id):
    return list(AssetVersion.objects.filter(asset__asset_id=asset_id).order_by("number"))


# --- the import ---------------------------------------------------------------------------------


def test_imports_each_model_as_a_validated_version_with_its_provenance(source):
    report = import_pack(TREES, source)
    assert sorted(item["asset"] for item in report.imported) == [
        "test-tree-short",
        "test-tree-tall",
    ]
    assert report.unresolved == [] and report.created_definitions
    tall = ContentAsset.objects.get(asset_id="test-tree-tall")
    assert (tall.kind, tall.category, tall.origin) == ("kit-piece", "scenery", "DJANGO")
    assert tall.tags == ["nature", "trees", "test-author"]
    assert tall.source["provenance"]["licence"] == "CC0 1.0 Universal"
    assert tall.source["provenance"]["licenceStatus"] == "confirmed"
    (version,) = versions("test-tree-tall")
    assert version.status == VersionStatus.VALIDATED
    assert re.fullmatch(r"assets/models/test-tree-tall/[0-9a-f-]{36}/model\.glb", version.storage_key)
    assert get_storage().exists(version.storage_key)
    assert version.dimensions["y"] == pytest.approx(6.0, abs=1e-3)
    provenance = version.metadata["provenance"]
    assert provenance["author"] == "Test Author"
    assert provenance["sourceUrl"] == "https://example.invalid/trees"
    assert provenance["sourceSha256"] == report.source["sha256"]
    preparation = version.metadata["preparation"]
    assert preparation["sourceNode"] == "Tall" and preparation["triangles"] == 12
    assert any("Z-up to Y-up" in note for note in preparation["modifications"])
    assert preparation["textures"][0]["to"] == [8, 8]
    assert "CC0" in version.notes
    assert version.metadata["counts"]  # validation's own metadata is kept beside it


def test_reports_what_it_found_and_what_it_ignored(source):
    report = import_pack(TREES, source)
    (described,) = report.sources
    assert described["file"] == "trees.glb" and described["cameras"] == 1
    assert described["matchesKnownDownload"] is False
    ignored = {item["file"]: item["reason"] for item in report.ignored_files}
    assert ignored["Barrel.fbx"] == "unsupported_format"
    assert all(item["selected"] for item in report.discovered)


def test_a_rerun_creates_nothing_new(source):
    import_pack(TREES, source)
    again = import_pack(TREES, source)
    assert again.imported == [] and again.created_definitions == []
    assert sorted(item["asset"] for item in again.skipped) == ["test-tree-short", "test-tree-tall"]
    assert AssetVersion.objects.count() == 2


def test_a_rerun_with_different_bytes_from_the_same_source_and_pipeline_is_still_skipped(source):
    import_pack(TREES, source)
    sharper = dataclasses.replace(TREES, max_texture_size=16)  # other bytes, same source
    again = import_pack(sharper, source)
    assert again.imported == [] and len(again.skipped) == 2


def test_a_dry_run_validates_but_writes_nothing(source):
    report = import_pack(TREES, source, dry_run=True)
    assert len(report.imported) == 2 and all(item["version"] is None for item in report.imported)
    assert not ContentAsset.objects.filter(asset_id__startswith="test-").exists()
    assert list(get_storage().list("assets/")) == []


def test_an_existing_definition_keeps_what_an_administrator_set(source):
    import_pack(TREES, source, dry_run=False)
    ContentAsset.objects.filter(asset_id="test-tree-tall").update(
        display_name="Renamed", tags=["mine"]
    )
    AssetVersion.objects.all().delete()  # never published, so deletable
    import_pack(TREES, source)
    tall = ContentAsset.objects.get(asset_id="test-tree-tall")
    assert (tall.display_name, tall.tags) == ("Renamed", ["mine"])


def test_retired_or_conflicting_definitions_are_reported_not_overwritten(source):
    ContentAsset.objects.create(asset_id="test-tree-tall", kind="kit-piece", category="scenery",
                                origin="DJANGO", status=AssetStatus.RETIRED)
    ContentAsset.objects.create(asset_id="test-tree-short", kind="character", category="npc",
                                origin="DJANGO")
    report = import_pack(TREES, source)
    reasons = {item["asset"]: item["reason"] for item in report.unresolved}
    assert reasons == {"test-tree-tall": "asset_retired", "test-tree-short": "asset_kind_conflict"}
    assert AssetVersion.objects.count() == 0


def test_a_model_that_fails_validation_is_not_stored(source, settings):
    settings.LAI_ASSET_MAX_UPLOAD_BYTES = 100
    report = import_pack(TREES, source)
    assert {item["reason"] for item in report.unresolved} == {"invalid_file"}
    assert AssetVersion.objects.count() == 0 and list(get_storage().list("assets/")) == []


def test_a_missing_node_is_unresolved_and_a_missing_pack_is_refused(source, tmp_path):
    partial = dataclasses.replace(
        TREES, models=(*TREES.models, dataclasses.replace(TREES.models[0], asset_id="test-x",
                                                          node="Nowhere"))
    )
    report = import_pack(partial, source)
    assert {"asset": "test-x", "node": "Nowhere", "reason": "source_missing"} in report.unresolved
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(PackRefused, match="No GLB"):
        import_pack(TREES, empty)
    with pytest.raises(PackRefused, match="does not exist"):
        import_pack(TREES, tmp_path / "nowhere")


def test_reads_a_zip_in_memory_and_reports_its_unsupported_members(tmp_path):
    archive = tmp_path / "pack.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("pack/trees.glb", pack_glb({"Tall": (1, 1, 5), "Short": (2, 2, 1)}))
        bundle.writestr("pack/source.blend", b"BLENDER")
    report = import_pack(TREES, archive)
    assert len(report.imported) == 2
    assert {"file": "pack.zip:pack/source.blend", "reason": "unsupported_format"} in (
        report.ignored_files
    )
    assert sorted(p.name for p in tmp_path.iterdir()) == ["pack.zip"]  # nothing extracted


def test_upload_version_merges_extra_metadata_beneath_validations_own(source):
    import_pack(TREES, source)
    version = versions("test-tree-tall")[0]
    assert set(version.metadata) >= {"provenance", "preparation", "counts"}


# --- publication --------------------------------------------------------------------------------


def test_local_development_publishes_and_the_first_version_becomes_the_default(source, local_dev):
    report = import_pack(TREES, source, publish=True)
    assert sorted(item["asset"] for item in report.published) == [
        "test-tree-short",
        "test-tree-tall",
    ]
    tall = ContentAsset.objects.get(asset_id="test-tree-tall")
    assert tall.default_version.status == VersionStatus.PUBLISHED
    again = import_pack(TREES, source, publish=True)
    assert again.published == [] and len(again.skipped) == 2  # already published


def test_an_unconfirmed_licence_is_imported_but_never_published(source, local_dev):
    report = import_pack(LOGS, source, publish=True)
    assert report.published == []
    assert report.unpublished == [
        {"asset": "test-log", "node": "Log", "version": 1, "reason": "licence_unconfirmed"}
    ]
    (version,) = versions("test-log")
    assert version.status == VersionStatus.VALIDATED
    assert version.metadata["provenance"]["licenceStatus"] == "unconfirmed"
    confirmed = import_pack(LOGS, source, publish=True, licence_confirmed=True)
    assert confirmed.published == [{"asset": "test-log", "node": "Log", "version": 1}]


@pytest.mark.parametrize(
    ("change", "problem"),
    [({"DEBUG": False}, "DEBUG is off"), ({"LAI_ASSET_STORAGE": "s3"}, "publish shared")],
)
def test_publishing_is_refused_outside_local_development(source, local_dev, change, problem):
    for name, value in change.items():
        setattr(local_dev, name, value)
    with pytest.raises(PackRefused, match=problem):
        import_pack(TREES, source, publish=True)
    assert AssetVersion.objects.count() == 0


# --- storage backends ---------------------------------------------------------------------------


def test_local_storage_writes_under_the_configured_root(source, settings, tmp_path):
    settings.LAI_ASSET_STORAGE = "local"
    settings.LAI_ASSET_LOCAL_ROOT = tmp_path / "store"
    import_pack(TREES, source)
    for version in AssetVersion.objects.all():
        assert (tmp_path / "store" / version.storage_key).is_file()


@pytest.fixture
def s3_storage(settings, monkeypatch):
    import boto3

    settings.LAI_ASSET_STORAGE = "s3"
    settings.LAI_ASSET_BUCKET = "lai-assets-test"
    settings.LAI_ASSET_REGION = "us-test-1"
    client = boto3.client(
        "s3", region_name="us-test-1", aws_access_key_id="test", aws_secret_access_key="test"
    )
    stubber = Stubber(client)
    stubber.activate()
    store = S3AssetStorage("lai-assets-test", "us-test-1", client=client)
    monkeypatch.setattr("apps.assets.services.get_storage", lambda: store)
    yield stubber
    stubber.deactivate()


def test_s3_needs_explicit_permission_before_anything_is_uploaded(source, s3_storage):
    with pytest.raises(PackRefused, match="allow-shared-storage"):
        import_pack(TREES, source)
    dry = import_pack(TREES, source, dry_run=True)  # a dry run is always allowed
    assert len(dry.imported) == 2
    s3_storage.assert_no_pending_responses()


def test_s3_uploads_through_the_configured_bucket_with_server_made_keys(source, s3_storage):
    for _ in range(2):
        s3_storage.add_response(
            "put_object",
            {},
            {
                "Bucket": "lai-assets-test",
                "Key": ANY,
                "Body": ANY,
                "ContentType": "model/gltf-binary",
                "ChecksumSHA256": ANY,
                "IfNoneMatch": "*",
                "CacheControl": "private, max-age=31536000, immutable",
            },
        )
    report = import_pack(TREES, source, allow_shared_storage=True)
    assert len(report.imported) == 2
    s3_storage.assert_no_pending_responses()
    assert all(v.storage_key.startswith("assets/models/test-tree-") for v in AssetVersion.objects.all())
    with pytest.raises(PackRefused, match="Django Admin"):
        import_pack(TREES, source, publish=True, allow_shared_storage=True)


# --- the commands -------------------------------------------------------------------------------


@pytest.fixture
def real_source(tmp_path):
    """Synthetic files carrying the real packs' node names."""
    directory = tmp_path / "environment"
    directory.mkdir()
    (directory / "palms.glb").write_bytes(
        pack_glb({f"PalmTree_{i}": (2, 2, 4 + i * 0.3) for i in range(1, 6)},
                 texture=rgba_png(16, 16))
    )
    (directory / "Barrel.glb").write_bytes(pack_glb({"Barrel": (0.15, 0.15, 0.2)}))
    (directory / "Barrel.fbx").write_bytes(b"Kaydara FBX Binary  \x00")
    (directory / "logs.glb").write_bytes(
        pack_glb({"WoodLog": (3, 0.8, 0.8), "WoodLog_Moss": (0.9, 3, 0.7)})
    )
    (directory / "wood.glb").write_bytes(pack_glb({"UI_Wood": (1, 1, 1.2)}, scale=1.0))
    return directory


def run(command, *args):
    out = StringIO()
    call_command(command, *args, stdout=out)
    return out.getvalue()


def test_the_environment_command_imports_every_group_and_says_what_it_did(real_source):
    text = run("import_treasure_rush_environment", "--source", str(real_source))
    for asset_id in (
        "nature-palm-tree-tall",
        "prop-wooden-barrel",
        "nature-wood-log",
        "nature-wood-log-moss",
        "prop-wood-pile",
    ):
        assert asset_id in text
    assert "ignored Barrel.fbx: unsupported_format" in text
    assert AssetVersion.objects.count() == 8


def test_category_limits_the_run(real_source):
    run("import_treasure_rush_environment", "--source", str(real_source), "--category", "barrels")
    assert set(AssetVersion.objects.values_list("asset__asset_id", flat=True)) == {
        "prop-wooden-barrel"
    }


def test_the_palm_command_is_the_palm_category(real_source):
    data = json.loads(
        run("import_treasure_rush_palm_trees", "--source", str(real_source), "--json")
    )
    assert [report["pack"] for report in data] == ["quaternius-palm-trees"]
    assert AssetVersion.objects.filter(asset__asset_id__startswith="nature-palm-tree-").count() == 4


def test_publish_through_the_command_holds_back_unconfirmed_licences(real_source, local_dev):
    text = run("import_treasure_rush_environment", "--source", str(real_source), "--publish")
    published = set(
        AssetVersion.objects.filter(status=VersionStatus.PUBLISHED).values_list(
            "asset__asset_id", flat=True
        )
    )
    assert published == {model.asset_id for model in QUATERNIUS_PALM_TREES.models}
    assert "not published: prop-wooden-barrel v1 (licence_unconfirmed" in text
    run(
        "import_treasure_rush_environment",
        "--source",
        str(real_source),
        "--publish",
        "--licence-confirmed",
    )
    assert AssetVersion.objects.filter(status=VersionStatus.PUBLISHED).count() == 8


def test_command_refusals(real_source, tmp_path):
    with pytest.raises(CommandError, match="cannot be combined"):
        run("import_treasure_rush_environment", "--source", str(real_source), "--dry-run",
            "--publish")
    with pytest.raises(CommandError, match="DEBUG is off"):
        run("import_treasure_rush_environment", "--source", str(real_source), "--publish")
    with pytest.raises(CommandError, match="does not exist"):
        run("import_treasure_rush_environment", "--source", str(tmp_path / "missing"),
            "--category", "logs")


# --- the real declarations ----------------------------------------------------------------------


def test_the_declared_packs_are_well_formed_and_reusable():
    ids = [model.asset_id for pack in PACKS.values() for model in pack.models]
    assert len(ids) == len(set(ids)) == 8
    assert set(model_packs.GROUPS) == {"palms", "barrels", "logs"}
    for pack in PACKS.values():
        for model in pack.models:
            definition = ContentAsset(
                asset_id=model.asset_id,
                kind=model.kind or pack.kind,
                category=model.category or pack.category,
                origin="DJANGO",
                display_name=model.display_name,
                description=model.description,
                tags=list(dict.fromkeys((*pack.tags, *model.tags, slugify(pack.author)))),
            )
            definition.full_clean()
            assert re.fullmatch(r"[0-9a-f]{64}", model.known_source_sha256)
            assert model.source_url.startswith("https://poly.pizza/m/")
    assert QUATERNIUS_PALM_TREES.licence_confirmed is True
    assert QUATERNIUS_BARRELS.licence_confirmed is False
    assert QUATERNIUS_LOGS.licence_confirmed is False


def test_the_declared_sizes_match_the_treasure_rush_scale():
    fits = {m.asset_id: m.fit for p in PACKS.values() for m in p.models}
    assert fits["prop-wooden-barrel"] == ("y", 1.0)  # 0.8 to 1.2 m tall
    for log in ("nature-wood-log", "nature-wood-log-moss"):
        axis, length = fits[log]
        assert axis == "x" and 1.5 <= length <= 3.5
    assert fits["nature-palm-tree-small"] == ("y", 2.8)
    assert 6.0 <= fits["nature-palm-tree-tall"][1] <= 7.0
