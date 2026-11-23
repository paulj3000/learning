"""GE-247: shipped scenes that use an asset are listed, never block retirement, and survive import.

docs/engineering/game-engine/bundled-asset-references.md.
"""

import pytest
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import Client

from apps.assets.admin import CollisionProfileAdmin
from apps.assets.models import CollisionProfile
from apps.assets.tests.helpers import make_definition
from apps.catalog import importer, scene_usage
from apps.catalog.importer import ContentImportError, import_content
from apps.catalog.models import AssetStatus, ContentAsset, ContentRelease, LocationAsset
from apps.catalog.tests.helpers import base_collections, write_export
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

DEFINITIONS = "/admin/catalog/contentasset/"


def usages(asset_id: str):
    return scene_usage.shipped_scene_usages(ContentAsset.objects.get(asset_id=asset_id))


def superuser_client() -> Client:
    call_command("ensure_asset_roles", verbosity=0)
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}root",
        admin_username="root",
        is_staff=True,
        is_superuser=True,
    )
    account.groups.set(Group.objects.none())
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


# --- import and export keep the references --------------------------------------------------


def test_the_hub_scene_assets_are_kept_in_the_release_report(tmp_path):
    report = import_content(write_export(tmp_path / "v1"))

    release = ContentRelease.objects.get(pk=report.release_id)
    assert release.report[importer.SCENE_ASSETS_WITHOUT_PLACE] == {"welcome-harbor": ["rock"]}
    assert importer.SCENE_ASSETS_WITHOUT_PLACE == "scene_assets_without_place"
    assert report.scene_assets_without_place == {"welcome-harbor": ["rock"]}
    # The skip is still reported, and no LocationAsset row is invented for the hub.
    assert report.skipped == [
        "location assets 'welcome-harbor': region has no Location record (1 assets)"
    ]
    assert not LocationAsset.objects.filter(location__slug="welcome-harbor").exists()


def test_the_shipped_export_lists_all_eleven_welcome_harbor_assets():
    report = import_content(importer.DEFAULT_EXPORT_DIR)

    hub = report.scene_assets_without_place["welcome-harbor"]
    assert hub == [
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
        assert [u.scene for u in usages(asset_id) if not u.has_place] == ["welcome-harbor"]


def test_an_unknown_scene_asset_id_fails_the_import(tmp_path):
    collections = base_collections()
    collections["assets.json"]["locationAssets"][1]["assetIds"] = ["no-such-model"]
    with pytest.raises(ContentImportError) as error:
        import_content(write_export(tmp_path / "v1", collections))
    assert "location assets 'welcome-harbor': unknown asset 'no-such-model'" in error.value.problems
    assert not ContentRelease.objects.exists()


# --- which scenes use an asset --------------------------------------------------------------


def test_lists_places_and_the_hub_current_first(tmp_path):
    import_content(write_export(tmp_path / "v1"))

    rock = usages("rock")
    assert [(u.scene, u.has_place, u.current) for u in rock] == [
        ("bay", True, True),
        ("welcome-harbor", False, True),
    ]
    assert [u.label for u in rock] == [
        "Shipped scene bay (bundled model)",
        "Shipped scene welcome-harbor (bundled model)",
    ]
    assert usages("tree-lod1") == []


def test_a_reference_a_newer_release_dropped_is_reported_as_stale(tmp_path):
    first = import_content(write_export(tmp_path / "v1"))
    smaller = base_collections()
    smaller["assets.json"]["locationAssets"] = [
        {"regionSlug": "bay", "assetIds": ["rock"]},
        {"regionSlug": "welcome-harbor", "assetIds": []},
    ]
    import_content(write_export(tmp_path / "v2", smaller))

    (tree,) = usages("tree")
    assert (tree.scene, tree.current, tree.release_id) == ("bay", False, first.release_id)
    assert tree.label == (
        f"Shipped scene bay (bundled model, last seen in release {first.release_id})"
    )
    # The hub entry comes from the latest release only.
    assert [u.scene for u in usages("rock")] == ["bay"]


def test_nothing_is_listed_before_any_import():
    asset = make_definition("lone", kind="prop", category="prop")
    assert scene_usage.shipped_scene_usages(asset) == []


def test_an_older_report_without_the_hub_field_still_works(tmp_path):
    import_content(write_export(tmp_path / "v1"))
    release = ContentRelease.objects.first()
    release.report.pop(importer.SCENE_ASSETS_WITHOUT_PLACE)
    release.save(update_fields=["report"])
    assert [u.scene for u in usages("rock")] == ["bay"]


@pytest.mark.parametrize(
    "malformed",
    [None, "welcome-harbor", ["rock"], {"welcome-harbor": "rock"}, {"welcome-harbor": None}],
)
def test_a_malformed_hub_entry_lists_nothing_and_never_raises(tmp_path, malformed):
    import_content(write_export(tmp_path / "v1"))
    release = ContentRelease.objects.first()
    release.report[importer.SCENE_ASSETS_WITHOUT_PLACE] = malformed
    release.save(update_fields=["report"])
    assert [u.scene for u in usages("rock")] == ["bay"]


def test_a_report_that_is_not_an_object_lists_only_places(tmp_path):
    import_content(write_export(tmp_path / "v1"))
    ContentRelease.objects.update(report=[])
    assert [u.scene for u in usages("rock")] == ["bay"]


# --- retirement: listed, never blocking -----------------------------------------------------


def test_retiring_an_asset_a_shipped_scene_uses_succeeds_with_a_warning(tmp_path):
    import_content(write_export(tmp_path / "v1"))
    rock = ContentAsset.objects.get(asset_id="rock")

    page = superuser_client().post(
        DEFINITIONS,
        {"action": "retire_assets", "_selected_action": [rock.pk], "index": 0},
        follow=True,
    )

    rock.refresh_from_db()
    assert rock.status == AssetStatus.RETIRED
    shown = [(m.level_tag, str(m)) for m in page.context["messages"]]
    (warning,) = [text for level, text in shown if level == "warning"]
    assert warning.startswith(
        "rock is still used by shipped scene(s) bay, welcome-harbor (no Place record). "
    )
    assert "these scenes keep drawing the bundled model" in warning
    assert "collision profile" not in warning  # it has none, so nothing changes there
    assert ("success", "Retired 1 asset(s).") in shown
    assert not [text for level, text in shown if level == "error"]


def test_the_retirement_note_names_the_collision_change_only_when_there_is_a_profile(tmp_path):
    import_content(write_export(tmp_path / "v1"))
    rock = ContentAsset.objects.get(asset_id="rock")
    assert "collision" not in scene_usage.retirement_note(rock)

    CollisionProfile.objects.create(asset=rock)
    note = scene_usage.retirement_note(rock)
    assert "keep drawing the bundled model" in note
    assert "collision profile stops applying there" in note


def test_the_definition_page_lists_the_hub_and_stale_scenes(tmp_path):
    from django.contrib import admin

    import_content(write_export(tmp_path / "v1"))
    asset_admin = admin.site._registry[ContentAsset]
    assert asset_admin.used_by(ContentAsset.objects.get(asset_id="rock")) == (
        "bay; welcome-harbor (no Place record)"
    )


def test_the_asset_list_asks_for_the_latest_release_once_per_page(
    tmp_path, django_assert_max_num_queries
):
    from django.contrib import admin
    from django.test import RequestFactory

    import_content(write_export(tmp_path / "v1"))
    asset_admin = admin.site._registry[ContentAsset]
    request = RequestFactory().get("/admin/catalog/contentasset/")
    request.user = ParentAccount(is_staff=True, is_superuser=True)
    rows = list(asset_admin.get_queryset(request).order_by("asset_id"))
    assert {"rock", "tree", "tree-lod1"} <= {row.asset_id for row in rows}
    # One query per row for its links, none for the release: the list query brought it.
    with django_assert_max_num_queries(len(rows)):
        shown = {row.asset_id: asset_admin.used_by(row) for row in rows}
    assert shown["rock"] == "bay; welcome-harbor (no Place record)"
    assert shown["tree-lod1"] == "No shipped scene"


# --- collision profiles: changes apply to shipped scenes ------------------------------------


def test_the_collision_profile_page_says_shipped_scenes_change_with_it(tmp_path):
    from django.contrib import admin

    import_content(write_export(tmp_path / "v1"))
    profile_admin: CollisionProfileAdmin = admin.site._registry[CollisionProfile]
    rock = ContentAsset.objects.get(asset_id="rock")

    shown = str(profile_admin.shipped_scenes(CollisionProfile.objects.create(asset=rock)))
    assert "bay; welcome-harbor (no Place record)" in shown
    assert "changes collision there on the child's next visit" in shown

    tree_lod = ContentAsset.objects.get(asset_id="tree-lod1")
    unused = CollisionProfile.objects.create(asset=tree_lod)
    assert profile_admin.shipped_scenes(unused) == "No shipped scene uses this asset."


def test_the_latest_release_ordering_matches_the_model():
    assert list(scene_usage.NEWEST_FIRST) == list(ContentRelease._meta.ordering)


# --- engine-reserved ids --------------------------------------------------------------------


def test_the_engine_default_avatar_id_cannot_become_a_library_asset():
    """`avatar.default` (game/src/engine/standardEngine.ts) is a placeholder, not an asset."""
    asset = ContentAsset(asset_id="avatar.default", kind="character", source={}, clips=[])
    with pytest.raises(ValidationError) as error:
        asset.full_clean()
    assert "asset_id" in error.value.message_dict
    # The dot is what makes it invalid: a slug-shaped id is accepted for that field.
    try:
        ContentAsset(asset_id="avatar-default", kind="character", source={}, clips=[]).full_clean()
    except ValidationError as other:
        assert "asset_id" not in other.message_dict
