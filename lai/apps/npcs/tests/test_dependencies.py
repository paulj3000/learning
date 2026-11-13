"""LAI-NPC-036: assets a live NPC release uses cannot be retired or deleted; the report says why."""

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.db.models import ProtectedError
from django.test import Client

from apps.assets import services
from apps.assets.models import VersionStatus
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog.models import AssetStatus, ContentAsset
from apps.npcs import dependencies
from apps.npcs.publishing import publish, retire
from apps.npcs.vocabulary import ReleaseStatus

from .helpers import make_asset, make_character, make_dialogue, make_staff, make_variant

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REPORT = "/admin/npcs/npcrelease/dependencies/"


@pytest.fixture
def staff():
    return make_staff()


def _versioned_character(npc_id="versioned"):
    asset = make_definition(f"{npc_id}-glb")
    version = make_version(asset, 1, status=VersionStatus.PUBLISHED, clips=["Idle"])
    spare = make_version(asset, 2, status=VersionStatus.PUBLISHED, clips=["Idle"])
    asset.default_version = version
    asset.save()
    character = make_character(npc_id, with_variant=False)
    make_variant(character, model_asset=asset, animation_map={"idle": "Idle"})
    return character, asset, version, spare


def _client(*groups, superuser=False):
    call_command("ensure_npc_roles", verbosity=0)
    call_command("ensure_asset_roles", verbosity=0)
    account = make_staff(
        f"dep-{'-'.join(groups) or 'super'}".replace(" ", "-"), superuser=superuser
    )
    account.groups.set(Group.objects.filter(name__in=groups))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


def test_the_npc_guard_is_registered_with_the_asset_library():
    assert dependencies.retirement_guard in services.RETIREMENT_GUARDS


def test_retiring_a_version_the_active_release_uses_is_refused(staff):
    character, asset, version, spare = _versioned_character()
    release = publish(staff)
    assert dependencies.release_dependents(asset, version) == [release]
    assert dependencies.release_dependents(asset, spare) == []

    with pytest.raises(services.AssetActionRefused) as error:
        services.retire_version(version, replacement=spare)
    assert error.value.code == "npc_release_dependency"
    assert f"versioned-glb v1 is used by NPC release(s) {release.number} (active)" in (
        error.value.message
    )
    assert error.value.details == {"releases": [release.number]}
    version.refresh_from_db()
    asset.refresh_from_db()
    assert version.status == VersionStatus.PUBLISHED and asset.default_version_id == version.pk

    services.retire_version(spare)  # a version no release uses retires normally
    spare.refresh_from_db()
    assert spare.status == VersionStatus.RETIRED


def test_a_superseded_release_still_protects_its_assets_until_it_is_retired(staff):
    character, asset, version, spare = _versioned_character()
    first = publish(staff)
    variant = character.variants.get()
    variant.pinned_version = spare
    variant.save()
    second = publish(staff)
    first.refresh_from_db()
    assert first.status == ReleaseStatus.SUPERSEDED

    asset.default_version = spare
    asset.save()
    with pytest.raises(services.AssetActionRefused) as error:
        services.retire_version(version)
    assert error.value.code == "npc_release_dependency" and "(superseded)" in error.value.message

    retire(first, staff)
    services.retire_version(version)  # nothing live uses v1 any more
    with pytest.raises(services.AssetActionRefused):
        services.retire_asset(asset)  # the active release still uses v2
    assert dependencies.release_dependents(asset) == [second]


def test_retiring_a_bundled_asset_a_release_uses_is_refused(staff):
    make_character("bundled")
    release = publish(staff)
    asset = ContentAsset.objects.get(asset_id="bundled-model")
    with pytest.raises(services.AssetActionRefused) as error:
        services.retire_asset(asset)
    assert error.value.code == "npc_release_dependency"
    asset.refresh_from_db()
    assert asset.status == AssetStatus.ACTIVE
    retire(release, staff)
    services.retire_asset(asset)
    asset.refresh_from_db()
    assert asset.status == AssetStatus.RETIRED


def test_draft_rows_are_reported_but_do_not_block_retirement():
    character = make_character("drafty")
    variant = character.variants.get()
    portrait = make_asset("drafty-face", kind="image")
    variant.portrait_asset = portrait
    variant.save()
    dialogue = make_dialogue(character)
    line = make_asset("drafty-line", kind="audio")
    node = dialogue.nodes.get(node_key="greet")
    node.audio_asset = line
    node.save()

    drafts = dependencies.draft_dependents(portrait)
    assert drafts.describe() == ["drafty variant classic (portrait)"]
    assert dependencies.draft_dependents(line).describe() == [
        "drafty dialogue hello node greet (recorded line)"
    ]
    assert dependencies.draft_dependents(variant.model_asset).describe() == [
        "drafty variant classic (model)"
    ]
    services.retire_asset(line)  # drafts do not block; the next publish reports it


def test_assets_npc_rows_use_cannot_be_deleted(staff):
    character, asset, version, _spare = _versioned_character()
    publish(staff)
    with pytest.raises(ProtectedError):
        ContentAsset.objects.filter(pk=asset.pk).delete()
    character.variants.all().delete()  # drafts gone; the release still protects the asset
    with pytest.raises(ProtectedError):
        ContentAsset.objects.filter(pk=asset.pk).delete()
    from apps.assets.models import AssetVersion

    with pytest.raises(ProtectedError):
        AssetVersion.objects.filter(pk=version.pk).delete()


def test_asset_admin_actions_show_the_refusal_instead_of_failing(staff):
    character, asset, version, spare = _versioned_character()
    publish(staff)
    client = _client("Asset publishers")
    response = client.post(
        "/admin/catalog/contentasset/",
        {"action": "retire_assets", "_selected_action": [asset.pk], "index": 0},
        follow=True,
    )
    assert response.status_code == 200
    text = response.content.decode()
    assert "is used by NPC release(s) 1 (active)" in text
    asset.refresh_from_db()
    assert asset.status == AssetStatus.ACTIVE

    response = client.post(
        "/admin/assets/assetversion/",
        {"action": "retire_versions", "_selected_action": [version.pk], "index": 0},
        follow=True,
    )
    assert "is used by NPC release(s) 1 (active)" in response.content.decode()


def test_dependency_report_lists_releases_and_drafts(staff):
    _versioned_character()
    publish(staff)
    client = _client("NPC editors")
    response = client.get(REPORT)
    assert response.status_code == 200
    text = response.content.decode()
    assert "versioned-glb" in text and "cannot be retired" in text
    assert "versioned variant classic model" in text
    assert "versioned variant classic (model)" in text

    focused = client.get(REPORT, {"asset": "versioned-glb"}).content.decode()
    assert "versioned-glb" in focused
    assert (
        "No NPC release or draft uses nothing-here"
        in client.get(REPORT, {"asset": "nothing-here"}).content.decode()
    )


def test_dependency_report_needs_release_view_permission():
    assert _client().get(REPORT).status_code == 403
    assert Client().get(REPORT).status_code == 302  # anonymous: the admin login


def test_dependency_command_prints_the_same_report(staff):
    from io import StringIO

    _versioned_character()
    publish(staff)
    out = StringIO()
    call_command("npc_asset_dependencies", "versioned-glb", stdout=out)
    text = out.getvalue()
    assert "versioned-glb (character): cannot be retired" in text
    assert "release 1 (active) v1: versioned variant classic model" in text
    assert "draft: versioned variant classic (model)" in text

    out = StringIO()
    call_command("npc_asset_dependencies", "nothing-here", stdout=out)
    assert "No NPC release or draft uses nothing-here." in out.getvalue()
