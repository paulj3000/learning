"""The gameplay prop packs (2026-11-15): the Kenney campfire, and what the importer gained for it.

Synthetic files only, built in memory like `pack_files.py`: no downloaded model, texture or ZIP is
a fixture, so these run without the owner's files.
"""

import dataclasses
import json
import zipfile
from io import StringIO

import pytest
from django.core.management import call_command

from apps.assets import gltf_prep, model_packs
from apps.assets.collision import profile_for, runtime_collision
from apps.assets.model_packs import KENNEY_CAMPFIRE, import_pack
from apps.assets.models import AssetVersion, CollisionProfile, VersionStatus
from apps.assets.storage import get_storage
from apps.catalog.models import ContentAsset

from .pack_files import pack_glb, rgba_png

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def kenney_style_glb() -> bytes:
    """Like Kenney's `campfire-pit.glb`: a stone ring whose logs are a child node offset a
    little, both under no rotation or scale, and a texture named by file, not embedded."""
    built = pack_glb(
        {"campfire-pit": (0.28, 0.27, 0.07), "wood": (0.19, 0.17, 0.09)},
        texture=rgba_png(8, 8, alpha_hole=False),
        scale=1.0,
        rotation=[0.0, 0.0, 0.0, 1.0],
    )
    document, binary = gltf_prep.read_glb(built)
    nodes = document["nodes"]
    pit = next(i for i, node in enumerate(nodes) if node.get("name") == "campfire-pit")
    wood = next(i for i, node in enumerate(nodes) if node.get("name") == "wood")
    nodes[0]["children"] = [pit]
    nodes[pit]["children"] = [wood]
    nodes[pit]["translation"] = [0.0, 0.0, 0.0]
    nodes[wood]["translation"] = [0.0, 0.02, 0.01]
    # Kenney names its colour map by path; Y-up boxes here (pack_glb builds Z-up ones).
    image = document["images"][0]
    del image["bufferView"]
    image["uri"] = "Textures/colormap.png"
    return gltf_prep.write_glb(document, binary)


@pytest.fixture
def kenney_zip(tmp_path):
    archive = tmp_path / "kenney_survival-kit.zip"
    with zipfile.ZipFile(archive, "w") as out:
        out.writestr("Models/GLB format/campfire-pit.glb", kenney_style_glb())
        out.writestr("Models/GLB format/Textures/colormap.png", rgba_png(8, 8, alpha_hole=False))
        out.writestr("Models/FBX format/campfire-pit.fbx", b"Kaydara FBX Binary  \x00")
        out.writestr("License.txt", "License: (Creative Commons Zero, CC0)")
    return archive


@pytest.fixture
def local_dev(settings):
    settings.DEBUG = True
    settings.LAI_ASSET_STORAGE = "memory"
    return settings


def test_the_campfire_pack_is_cc0_confirmed_and_sized_for_the_cove():
    pack = KENNEY_CAMPFIRE
    assert pack.group == "campfire" and pack.author == "Kenney"
    assert pack.licence == model_packs.CC0["licenceName"] and pack.licence_confirmed
    assert pack.source_pages == ("https://kenney.nl/assets/survival-kit",)
    (model,) = pack.models
    assert model.asset_id == "campfire" and model.node == "campfire-pit"
    assert model.include_children and model.center_footprint
    assert model.fit == ("x", 1.1)  # a ring a child walks round, not a bonfire
    collision = dict(model.collision)
    assert collision == {
        "shape": "CYLINDER",
        "behavior": "SOLID",
        "axis": "Y",
        "radius": 0.55,
        "height": 0.45,
    }


def test_imports_the_ring_with_its_logs_and_its_texture_from_the_same_zip(kenney_zip):
    report = import_pack(KENNEY_CAMPFIRE, kenney_zip)
    assert report.unresolved == []
    (imported,) = report.imported
    assert imported["asset"] == "campfire"
    assert imported["triangles"] == 24  # both boxes: the child was baked in
    assert imported["sourceTriangles"] == 24
    assert imported["dimensions"]["x"] == pytest.approx(1.1)
    version = AssetVersion.objects.get(asset__asset_id="campfire")
    assert version.status == VersionStatus.VALIDATED
    preparation = version.metadata["preparation"]
    assert any("child mesh" in change for change in preparation["modifications"])
    assert {f["file"] for f in preparation["sourceFiles"]} >= {"colormap.png"}
    provenance = version.metadata["provenance"]
    assert provenance["licenceStatus"] == "confirmed"
    assert provenance["licenceId"] == "CC0-1.0"
    assert provenance["sourcePages"] == ["https://kenney.nl/assets/survival-kit"]
    assert "usage" in provenance
    assert {"file": "Models/FBX format/campfire-pit.fbx", "reason": "unsupported_format"} in [
        {"file": item["file"].split(":", 1)[1], "reason": item["reason"]}
        for item in report.ignored_files
    ]


def test_gives_the_campfire_a_solid_cylinder_profile_and_keeps_an_administrators(kenney_zip):
    import_pack(KENNEY_CAMPFIRE, kenney_zip)
    asset = ContentAsset.objects.get(asset_id="campfire")
    profile = CollisionProfile.objects.get(asset=asset, version__isnull=True)
    assert (profile.shape, profile.behavior, profile.radius, profile.height) == (
        "CYLINDER",
        "SOLID",
        0.55,
        0.45,
    )
    version = asset.versions.get()
    sent = runtime_collision(profile_for(asset, version), version)
    assert sent["behavior"] == "SOLID"
    assert max(box["maxY"] for box in sent["boxes"]) == pytest.approx(0.45)  # flames add nothing
    # An administrator widens it in Django Admin; a re-import leaves their profile alone.
    profile.radius = 0.7
    profile.save()
    again = import_pack(KENNEY_CAMPFIRE, kenney_zip)
    assert again.collision == [{"asset": "campfire", "status": "kept"}]
    assert CollisionProfile.objects.get(asset=asset, version__isnull=True).radius == 0.7


def test_is_idempotent_and_publishes_as_the_default_in_local_development(kenney_zip, local_dev):
    first = import_pack(KENNEY_CAMPFIRE, kenney_zip, publish=True)
    assert [item["asset"] for item in first.published] == ["campfire"]
    second = import_pack(KENNEY_CAMPFIRE, kenney_zip, publish=True)
    assert second.imported == [] and second.published == []
    assert [item["status"] for item in second.skipped] == ["PUBLISHED"]
    asset = ContentAsset.objects.get(asset_id="campfire")
    assert asset.versions.count() == 1
    assert asset.default_version.status == VersionStatus.PUBLISHED
    assert CollisionProfile.objects.filter(asset=asset).count() == 1


def test_a_dry_run_reports_the_profile_but_writes_nothing(kenney_zip):
    report = import_pack(KENNEY_CAMPFIRE, kenney_zip, dry_run=True)
    assert report.collision[0]["status"] == "created"
    assert not ContentAsset.objects.filter(asset_id="campfire").exists()
    assert not CollisionProfile.objects.exists()


def test_a_missing_texture_is_reported_not_imported(tmp_path):
    archive = tmp_path / "only-the-glb.zip"
    with zipfile.ZipFile(archive, "w") as out:
        out.writestr("campfire-pit.glb", kenney_style_glb())
    report = import_pack(KENNEY_CAMPFIRE, archive)
    assert report.imported == []
    assert report.unresolved[0]["reason"] == "prep_failed"
    assert "colormap.png" in report.unresolved[0]["detail"]


def test_a_texture_path_that_leaves_the_source_is_refused(tmp_path):
    document, binary = gltf_prep.read_glb(kenney_style_glb())
    document["images"][0]["uri"] = "../../etc/colormap.png"
    with pytest.raises(gltf_prep.PrepError):
        gltf_prep.embed_external_images(document, binary, lambda name: b"never read")


def test_the_command_imports_the_campfire_category(kenney_zip):
    out = StringIO()
    call_command(
        "import_treasure_rush_environment",
        "--source",
        str(kenney_zip),
        "--category",
        "campfire",
        stdout=out,
    )
    text = out.getvalue()
    assert "campfire-pit -> campfire" in text
    assert "Collision profile for campfire: created" in text


def test_children_are_left_out_unless_asked_for(kenney_zip):
    single = dataclasses.replace(
        KENNEY_CAMPFIRE,
        models=(dataclasses.replace(KENNEY_CAMPFIRE.models[0], include_children=False),),
    )
    report = import_pack(single, kenney_zip, dry_run=True)
    assert report.imported[0]["triangles"] == 12


# --- the Pirate's Leap feather (CC-BY-4.0: held back until the owner accepts it) ----------------


def sketchfab_style_zip(tmp_path):
    """Like the supplied feather: a .gltf + .bin whose mesh node sits under a matrix-turned root,
    with no texture, in a ZIP with its licence."""
    built = pack_glb({"Object_2": (0.19, 0.17, 6.8)}, scale=1.0)
    document, binary = gltf_prep.read_glb(built)
    document["buffers"] = [{"byteLength": len(binary), "uri": "scene.bin"}]
    document["nodes"][0] = {"name": "Sketchfab_model", "children": [1], "matrix": [
        1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1
    ]}  # fmt: skip
    document["nodes"][1].pop("translation")
    document["asset"]["extras"] = {"license": "CC-BY-4.0", "author": "dudecon"}
    archive = tmp_path / "light_princess_feather_lowpoly.zip"
    with zipfile.ZipFile(archive, "w") as out:
        out.writestr("scene.gltf", json.dumps(document))
        out.writestr("scene.bin", binary)
        out.writestr("license.txt", "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)")
    return archive


def test_the_feather_pack_records_cc_by_and_is_not_confirmed():
    pack = model_packs.DUDECON_FEATHER
    assert pack.group == "feather" and pack.author == "dudecon"
    assert pack.licence_id == "CC-BY-4.0" and not pack.licence_confirmed
    assert pack.licence_url == "https://creativecommons.org/licenses/by/4.0/"
    assert 'by dudecon (https://sketchfab.com/dudecon) licensed under CC-BY-4.0' in pack.attribution
    (model,) = pack.models
    assert model.asset_id == "feather" and model.fit == ("y", 0.55)
    assert dict(model.collision) == {"shape": "NONE", "behavior": "DECORATIVE"}


def test_the_feather_is_imported_and_validated_but_not_published_by_default(tmp_path, local_dev):
    report = import_pack(model_packs.DUDECON_FEATHER, sketchfab_style_zip(tmp_path), publish=True)
    assert report.unresolved == []
    assert report.published == []
    assert report.unpublished == [
        {"asset": "feather", "node": "Object_2", "version": 1, "reason": "licence_unconfirmed"}
    ]
    version = AssetVersion.objects.get(asset__asset_id="feather")
    assert version.status == VersionStatus.VALIDATED
    assert version.dimensions["y"] == pytest.approx(0.55)
    provenance = version.metadata["provenance"]
    assert provenance["licenceStatus"] == "unconfirmed"
    assert provenance["licenceId"] == "CC-BY-4.0"
    assert "dudecon" in provenance["attribution"]
    assert provenance["author"] == "dudecon"
    asset = ContentAsset.objects.get(asset_id="feather")
    profile = CollisionProfile.objects.get(asset=asset, version__isnull=True)
    assert (profile.shape, profile.behavior) == ("NONE", "DECORATIVE")
    assert runtime_collision(profile_for(asset, version), version)["boxes"] == []


def test_the_feather_publishes_once_the_owner_accepts_cc_by(tmp_path, local_dev):
    archive = sketchfab_style_zip(tmp_path)
    import_pack(model_packs.DUDECON_FEATHER, archive, publish=True)
    report = import_pack(
        model_packs.DUDECON_FEATHER, archive, publish=True, licence_confirmed=True
    )
    assert [item["asset"] for item in report.published] == ["feather"]
    asset = ContentAsset.objects.get(asset_id="feather")
    assert asset.versions.count() == 1  # the same version, not a second one
    assert asset.default_version.status == VersionStatus.PUBLISHED


def test_the_prepared_feather_carries_its_attribution(tmp_path):
    report = import_pack(model_packs.DUDECON_FEATHER, sketchfab_style_zip(tmp_path))
    assert report.imported[0]["triangles"] == 12
    version = AssetVersion.objects.get(asset__asset_id="feather")
    with get_storage().open(version.storage_key) as stored:
        document, _binary = gltf_prep.read_glb(stored.read())
    assert document["asset"]["copyright"] == model_packs.DUDECON_FEATHER_ATTRIBUTION
