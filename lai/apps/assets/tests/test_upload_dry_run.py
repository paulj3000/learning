"""LAI-07 W4: one dry-run mode, `services.upload_version(dry_run=True)`, used by both importers."""

import io

import pytest

from apps.assets import services
from apps.assets.importer import import_bundled
from apps.assets.models import AssetVersion
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import glb_bytes, make_definition
from apps.assets.tests.test_import import exported, public, release  # noqa: F401 (fixtures)
from apps.catalog.models import ContentAsset

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

BROKEN = b"PK\x03\x04 not a model"


def upload(asset, data=None, **kwargs):
    data = data if data is not None else glb_bytes()
    return services.upload_version(asset, io.BytesIO(data), original_filename="m.glb", **kwargs)


def refusal(asset, data=None, **kwargs):
    with pytest.raises(AssetActionRefused) as refused:
        upload(asset, data, **kwargs)
    return refused.value.code, refused.value.message, refused.value.details


def test_a_passing_dry_run_returns_none_and_writes_nothing(storage):
    pip = make_definition("npc-pip")
    assert upload(pip, dry_run=True) is None
    assert not AssetVersion.objects.exists() and not list(storage.list())


def test_a_dry_run_refuses_exactly_what_a_real_upload_refuses(storage):
    pip = make_definition("npc-pip")
    assert refusal(pip, BROKEN, dry_run=True)[0] == refusal(pip, BROKEN)[0] == "invalid_file"
    with pytest.raises(AssetActionRefused) as dry:
        upload(pip, BROKEN, dry_run=True)
    assert {f.code for f in dry.value.findings} == {"not_a_model"}

    upload(pip)
    assert refusal(pip, dry_run=True) == refusal(pip)  # duplicate_version, same message
    assert refusal(pip, dry_run=True)[0] == "duplicate_version"

    services.retire_asset(pip)
    other = glb_bytes(clips=("Wave",))
    assert refusal(pip, other, dry_run=True) == refusal(pip, other)
    assert refusal(pip, other, dry_run=True)[0] == "asset_retired"
    assert AssetVersion.objects.count() == 1 and len(list(storage.list())) == 1


def test_a_dry_run_accepts_an_asset_that_is_not_saved_yet(storage):
    unsaved = ContentAsset(asset_id="lost-boat", kind="prop", category="prop")
    assert upload(unsaved, dry_run=True) is None
    assert not ContentAsset.objects.exists() and not list(storage.list())


def test_an_import_dry_run_reports_a_bad_file_as_the_real_import_does(release, public, storage):  # noqa: F811
    exported(release, "rock", "/models/broken.glb")
    dry = import_bundled(root=public, dry_run=True).unresolved
    assert not AssetVersion.objects.exists() and not list(storage.list())
    real = import_bundled(root=public).unresolved
    assert dry == real
    assert [(item["reason"], item["codes"]) for item in dry] == [("invalid_file", ["glb_length"])]
