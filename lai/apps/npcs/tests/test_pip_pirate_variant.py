"""The owner's pirate as Pirate Pip's second variant (2026-11-07): `add_pip_pirate_variant` uploads
the GLB through the Asset Library services (validated, published), adds the `pirate` variant
without touching `classic` or the shared `npc-pip` asset, is rerunnable, places the pirate in
Treasure Cove only when asked, and the runtime then serves the pirate's model and clip map."""

from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from apps.assets.models import VersionStatus
from apps.catalog.models import AssetOrigin, ContentAsset
from apps.npcs import pip_content as pip
from apps.npcs.management.commands.add_pip_pirate_variant import repo_root
from apps.npcs.models import NpcModelVariant, NpcPlacement

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def run(command: str, *args) -> str:
    out = StringIO()
    call_command(command, *args, stdout=out)
    return out.getvalue()


def area(child) -> str:
    return f"/api/v1/children/{child.pk}/regions/{pip.AREA_ID}/npcs/"


def test_the_bundled_file_is_in_the_repository():
    path = repo_root() / pip.PIRATE_MODEL_FILE
    assert path.is_file() and path.read_bytes()[:4] == b"glTF"


def test_needs_pip_first(treasure):
    with pytest.raises(CommandError, match="seed_npc_pip"):
        run("add_pip_pirate_variant")


def test_uploads_publishes_and_adds_the_variant_without_touching_classic(treasure):
    run("seed_npc_pip")
    classic_before = NpcModelVariant.objects.get(variant_key=pip.VARIANT_KEY)
    shared_before = ContentAsset.objects.get(asset_id=pip.MODEL_ASSET_ID).versions.count()

    out = run("add_pip_pirate_variant")
    assert "Asset npc-pip-pirate: created." in out
    assert "Model: uploaded; published version 1, clips Idle, Walk, Wave, Point." in out
    assert "Variant pirate: created." in out and "Validation: no problems." in out

    asset = ContentAsset.objects.get(asset_id=pip.PIRATE_ASSET_ID)
    assert asset.origin == AssetOrigin.DJANGO and asset.kind == "character"
    version = asset.default_version
    assert version.status == VersionStatus.PUBLISHED
    assert version.clips == list(pip.PIRATE_CLIPS)
    # No generic Mixamo take names and nothing outside the clip vocabulary.
    codes = {finding["code"] for finding in version.validation_report}
    assert not codes & {"generic_clip_name", "unknown_clip"}

    pirate = NpcModelVariant.objects.get(variant_key=pip.PIRATE_VARIANT_KEY)
    assert pirate.model_asset == asset and not pirate.is_default
    assert pirate.animation_map == pip.PIRATE_ANIMATION_MAP and pirate.scale == pip.PIRATE_SCALE
    classic = NpcModelVariant.objects.get(variant_key=pip.VARIANT_KEY)
    assert classic.is_default and classic.model_asset_id == classic_before.model_asset_id
    assert ContentAsset.objects.get(asset_id=pip.MODEL_ASSET_ID).versions.count() == shared_before
    # Not placed unless asked.
    assert NpcPlacement.objects.get(placement_key=pip.PLACEMENT_KEY).variant == classic


def test_a_rerun_changes_nothing(treasure):
    run("seed_npc_pip")
    run("add_pip_pirate_variant")
    again = run("add_pip_pirate_variant")
    assert "Asset npc-pip-pirate: exists." in again and "Model: unchanged" in again
    assert "Variant pirate: exists." in again
    assert ContentAsset.objects.get(asset_id=pip.PIRATE_ASSET_ID).versions.count() == 1


def test_a_file_that_fails_validation_is_refused(treasure, tmp_path):
    run("seed_npc_pip")
    bad = tmp_path / "pirate.glb"
    bad.write_bytes(b"not a model")
    with pytest.raises(CommandError, match="Model refused: invalid_file"):
        run("add_pip_pirate_variant", "--file", str(bad))
    assert not NpcModelVariant.objects.filter(variant_key=pip.PIRATE_VARIANT_KEY).exists()


def test_in_the_cove_the_runtime_serves_the_pirate(treasure, api):
    run("seed_npc_pip", "--publish")
    out = run("add_pip_pirate_variant", "--use-in-cove", "--publish")
    assert "Treasure Cove placement: now uses the pirate." in out
    assert "Publish: NPC release 2 is ACTIVE." in out

    body = api(treasure.families.a).get(area(treasure.families.a1)).json()
    [placement] = body["placements"]
    assert placement["variant"] == pip.PIRATE_VARIANT_KEY
    variants = {v["variantKey"]: v for v in body["characters"][pip.NPC_ID]["variants"]}
    assert set(variants) == {pip.VARIANT_KEY, pip.PIRATE_VARIANT_KEY}
    pirate = variants[pip.PIRATE_VARIANT_KEY]
    assert pirate["model"]["assetId"] == pip.PIRATE_ASSET_ID
    assert pirate["animationMap"] == pip.PIRATE_ANIMATION_MAP and pirate["scale"] == 1.25

    again = run("add_pip_pirate_variant", "--use-in-cove", "--publish")
    assert "already uses the pirate" in again and "Publish: unchanged" in again
