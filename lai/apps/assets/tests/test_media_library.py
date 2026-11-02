"""AM-13/AM-16 development: images and audio through the whole library, plus rollback,
reactivation, verification, hardened delivery and the admin audit trail."""

import io

import pytest
from django.contrib.admin.models import LogEntry
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import Client

from apps.assets import preview, services
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.storage import MemoryAssetStorage, StorageError, object_key
from apps.assets.tests.helpers import glb_bytes, make_definition
from apps.assets.tests.media_files import jpeg_bytes, mp3_bytes, ogg_bytes, png_bytes, wav_bytes
from apps.catalog.models import AssetStatus
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

UPLOAD = "/admin/assets/assetversion/upload/"
VERSIONS = "/admin/assets/assetversion/"


@pytest.fixture(autouse=True)
def roles():
    call_command("ensure_asset_roles", verbosity=0)
    cache.clear()


def staff(username, *groups):
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}",
        admin_username=username,
        is_staff=True,
    )
    account.groups.set(Group.objects.filter(name__in=groups))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client, account


def put(asset, data, name="file"):
    return services.upload_version(asset, io.BytesIO(data), original_filename=name)


@pytest.fixture
def texture():
    return make_definition("brick-wall", kind="texture", category="texture")


@pytest.fixture
def sound():
    return make_definition("splash", kind="audio", category="sound")


# --- storage keys and types ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fmt", "expected"),
    [
        ("glb", "assets/models/npc-pip/{u}/model.glb"),
        ("png", "assets/images/npc-pip/{u}/image.png"),
        ("jpeg", "assets/images/npc-pip/{u}/image.jpeg"),
        ("webp", "assets/images/npc-pip/{u}/image.webp"),
        ("mp3", "assets/audio/npc-pip/{u}/audio.mp3"),
        ("wav", "assets/audio/npc-pip/{u}/audio.wav"),
        ("ogg", "assets/audio/npc-pip/{u}/audio.ogg"),
    ],
)
def test_every_format_has_a_family_key_directory(fmt, expected):
    import uuid

    version_id = uuid.uuid4()
    assert object_key("npc-pip", version_id, fmt) == expected.format(u=version_id)


def test_the_store_refuses_keys_outside_the_family_directories():
    store = MemoryAssetStorage()
    for key in ("children/x", "assets/other/x", "assets/models/../../x", "/assets/models/x"):
        with pytest.raises(StorageError):
            store.open(key)
        with pytest.raises(StorageError):
            store.delete(key)


# --- upload through the service --------------------------------------------------------------


def test_a_texture_upload_is_stored_validated_and_described(texture, storage):
    version = put(texture, png_bytes(8, 4), "brick.png")
    assert version.status == VersionStatus.VALIDATED and version.family == "image"
    assert version.storage_key == f"assets/images/brick-wall/{version.version_id}/image.png"
    assert version.content_type == "image/png" and version.file_name == "image.png"
    assert version.metadata == {"width": 8, "height": 4} and version.clips == []
    assert storage.exists(version.storage_key)


def test_audio_upload_records_duration(sound):
    version = put(sound, ogg_bytes(seconds=2))
    assert version.family == "audio" and version.content_type == "audio/ogg"
    assert version.metadata["durationSeconds"] == 2.0


def test_a_wrong_family_or_corrupt_file_is_refused_and_leaves_nothing(texture, storage):
    with pytest.raises(AssetActionRefused) as refused:
        put(texture, glb_bytes())
    assert refused.value.code == "invalid_file"
    assert {f.code for f in refused.value.findings} == {"wrong_file_family"}
    with pytest.raises(AssetActionRefused):
        put(texture, png_bytes() + b"<script>alert(1)</script>")
    assert not AssetVersion.objects.exists() and list(storage.list()) == []


def test_a_failed_media_write_leaves_no_row(sound, storage):
    storage.fail_next.add("put")
    with pytest.raises(AssetActionRefused) as refused:
        put(sound, wav_bytes())
    assert refused.value.code == "storage_failed" and not AssetVersion.objects.exists()


def test_publish_reverifies_media_and_rejects_changed_bytes(texture, storage):
    version = put(texture, png_bytes())
    storage.objects[version.storage_key] = (b"\x89PNG tampered", "image/png", None)
    with pytest.raises(AssetActionRefused):
        services.publish_version(version)
    version.refresh_from_db()
    assert version.status == VersionStatus.REJECTED


# --- rollback, republish, reactivate, verify -------------------------------------------------


def publish_two(asset):
    v1 = services.publish_version(put(asset, png_bytes(4, 4)))
    v2 = services.publish_version(put(asset, png_bytes(8, 8)))
    services.set_default_version(v2)
    return v1, v2


def test_rolling_back_makes_an_earlier_published_version_live(texture):
    v1, v2 = publish_two(texture)
    services.rollback_to_version(v1)
    texture.refresh_from_db()
    assert texture.default_version_id == v1.pk
    v2.refresh_from_db()
    assert v2.status == VersionStatus.PUBLISHED  # kept; retiring is its own decision


def test_rolling_back_to_a_retired_version_republishes_it_after_verification(texture):
    v1, v2 = publish_two(texture)
    services.retire_version(v1)
    services.rollback_to_version(v1, user=None)
    v1.refresh_from_db()
    texture.refresh_from_db()
    assert v1.status == VersionStatus.PUBLISHED and v1.retired_at is None
    assert texture.default_version_id == v1.pk


def test_a_retired_version_whose_bytes_are_gone_cannot_be_rolled_back_to(texture, storage):
    v1, v2 = publish_two(texture)
    services.retire_version(v1)
    storage.objects.pop(v1.storage_key)
    with pytest.raises(AssetActionRefused) as refused:
        services.rollback_to_version(v1)
    assert refused.value.code == "verification_failed"
    v1.refresh_from_db()
    texture.refresh_from_db()
    assert v1.status == VersionStatus.RETIRED and texture.default_version_id == v2.pk


def test_unpublished_versions_are_not_rollback_targets(texture):
    draft = put(texture, png_bytes())
    with pytest.raises(AssetActionRefused) as refused:
        services.rollback_to_version(draft)
    assert refused.value.code == "not_rollback_target"


def test_published_bytes_stay_immutable_even_through_a_rollback(texture):
    v1, _v2 = publish_two(texture)
    services.retire_version(v1)
    v1.refresh_from_db()
    v1.sha256 = "0" * 64
    from apps.assets.models import ImmutableVersion

    with pytest.raises(ImmutableVersion):
        v1.save()


def test_a_retired_asset_can_be_reactivated(sound):
    services.retire_asset(sound)
    services.reactivate_asset(sound)
    sound.refresh_from_db()
    assert sound.status == AssetStatus.ACTIVE
    with pytest.raises(AssetActionRefused):
        services.reactivate_asset(sound)


def test_verify_reports_missing_and_changed_files(texture, storage):
    version = put(texture, png_bytes())
    assert services.verify_version(version) is None
    storage.objects[version.storage_key] = (png_bytes(9, 9), "image/png", None)
    assert "checksum" in services.verify_version(version)
    storage.objects.pop(version.storage_key)
    assert "missing" in services.verify_version(version)


def test_only_unpublished_versions_can_be_deleted(
    texture, storage, django_capture_on_commit_callbacks
):
    published = services.publish_version(put(texture, png_bytes()))
    draft = put(texture, png_bytes(8, 8))
    with pytest.raises(AssetActionRefused):
        services.delete_unpublished_version(published)
    with django_capture_on_commit_callbacks(execute=True):
        services.delete_unpublished_version(draft)
    assert not storage.exists(draft.storage_key) and storage.exists(published.storage_key)


# --- Django Admin ----------------------------------------------------------------------------


def admin_upload(client, asset, data, name):
    return client.post(
        UPLOAD, {"asset": asset.pk, "file": SimpleUploadedFile(name, data), "notes": ""}
    )


def test_staff_upload_an_image_and_a_sound_in_admin_and_see_previews(texture, sound):
    editor, _ = staff("editor", "Asset editors", "Asset publishers")
    assert admin_upload(editor, texture, jpeg_bytes(16, 16), "wall.JPG").status_code == 302
    assert admin_upload(editor, sound, mp3_bytes(), "splash.mp3").status_code == 302
    image = AssetVersion.objects.get(asset=texture)
    audio = AssetVersion.objects.get(asset=sound)
    assert image.format == "jpeg" and audio.format == "mp3"

    page = editor.get(f"{VERSIONS}{image.pk}/change/").content.decode()
    assert f"{VERSIONS}{image.pk}/media/" in page and "<img" in page and "16 x 16" in page
    page = editor.get(f"{VERSIONS}{audio.pk}/change/").content.decode()
    assert "<audio controls" in page and "44100 Hz" in page

    preview_page = editor.get(f"{VERSIONS}{image.pk}/preview/").content.decode()
    assert "<img" in preview_page and "asset-preview.js" not in preview_page


def test_admin_rejects_a_script_renamed_as_an_image(texture):
    editor, _ = staff("editor", "Asset editors")
    response = admin_upload(editor, texture, b"<script>alert(1)</script>", "evil.png")
    assert response.status_code == 200 and not AssetVersion.objects.exists()


def test_media_route_serves_verified_bytes_with_locked_down_headers(texture):
    editor, _ = staff("editor", "Asset editors")
    version = put(texture, png_bytes(8, 8))
    response = editor.get(f"{VERSIONS}{version.pk}/media/")
    assert response.status_code == 200 and b"".join(response.streaming_content) == png_bytes(8, 8)
    assert response["Content-Type"] == "image/png"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert "sandbox" in response["Content-Security-Policy"]


def test_media_route_needs_a_staff_session_and_refuses_models(texture):
    version = put(texture, png_bytes())
    assert Client().get(f"{VERSIONS}{version.pk}/media/").status_code == 403
    nobody, _ = staff("nobody")
    assert nobody.get(f"{VERSIONS}{version.pk}/media/").status_code == 403
    viewer, _ = staff("viewer", "Asset editors")
    model = put(make_definition("npc-pip"), glb_bytes())
    assert viewer.get(f"{VERSIONS}{model.pk}/media/").status_code == 404
    assert viewer.get(f"{VERSIONS}{version.pk}/media/").status_code == 200


def test_media_route_refuses_a_tampered_object_and_reports_unavailable(texture, storage):
    viewer, _ = staff("viewer", "Asset editors")
    version = put(texture, png_bytes())
    storage.objects[version.storage_key] = (png_bytes(9, 9), "image/png", None)
    assert viewer.get(f"{VERSIONS}{version.pk}/media/").status_code == 409
    storage.objects.pop(version.storage_key)
    assert viewer.get(f"{VERSIONS}{version.pk}/media/").status_code == 503


def test_lifecycle_actions_are_written_to_the_admin_history(texture):
    publisher, account = staff("publisher", "Asset editors", "Asset publishers")
    v1, v2 = publish_two(texture)
    for version in (v1, v2):
        version.refresh_from_db()
    publisher.post(
        VERSIONS,
        {"action": "rollback_to_versions", "_selected_action": [v1.pk], "index": 0},
        follow=True,
    )
    texture.refresh_from_db()
    assert texture.default_version_id == v1.pk
    entry = LogEntry.objects.filter(object_id=str(v1.pk)).latest("action_time")
    assert "Rolled back to brick-wall@1" in entry.change_message


def test_editors_cannot_roll_back_or_publish(texture):
    editor, _ = staff("editor", "Asset editors")
    v1, v2 = publish_two(texture)
    response = editor.post(
        VERSIONS,
        {"action": "rollback_to_versions", "_selected_action": [v1.pk], "index": 0},
        follow=True,
    )
    texture.refresh_from_db()
    assert texture.default_version_id == v2.pk and response.status_code in (200, 403)


def test_verify_action_flags_a_missing_file(texture, storage):
    viewer, _ = staff("viewer", "Asset editors")
    version = put(texture, png_bytes())
    storage.objects.pop(version.storage_key)
    page = viewer.post(
        VERSIONS,
        {"action": "verify_versions", "_selected_action": [version.pk], "index": 0},
        follow=True,
    )
    assert "missing" in page.content.decode()


# --- delivery and the resolver ---------------------------------------------------------------


def test_resolver_describes_images_and_audio_and_serves_hardened_files(
    api, families, texture, sound
):
    services.publish_version(put(texture, png_bytes(8, 8)))
    services.publish_version(put(sound, wav_bytes(seconds=2)))
    response = api(families.a).get(
        f"/api/v1/children/{families.a1.pk}/assets/", {"ids": "brick-wall,splash"}
    )
    found = {e["id"]: e for e in response.json()["assets"]}
    image, audio = found["brick-wall"], found["splash"]
    assert image["family"] == "image" and image["format"] == "png"
    assert image["media"] == {"width": 8, "height": 8} and image["url"].endswith("/image.png")
    assert audio["family"] == "audio" and audio["contentType"] == "audio/wav"
    assert audio["media"]["durationSeconds"] == 2.0 and audio["url"].endswith("/audio.wav")
    for entry in (image, audio):
        assert "assets/" not in entry["url"] and "storage" not in str(entry)
    served = Client().get(image["url"])
    assert served.status_code == 200 and served["X-Content-Type-Options"] == "nosniff"
    assert "default-src 'none'" in served["Content-Security-Policy"]
    assert Client().get(image["url"].replace("image.png", "model.png")).status_code == 404


def test_models_resolve_with_family_model_and_no_media(api, families):
    pip = make_definition("npc-pip")
    services.publish_version(put(pip, glb_bytes()))
    response = api(families.a).get(f"/api/v1/children/{families.a1.pk}/assets/", {"ids": "npc-pip"})
    entry = response.json()["assets"][0]
    assert entry["family"] == "model" and "media" not in entry


def test_unpublished_media_never_resolves_or_delivers(api, families, texture):
    draft = put(texture, png_bytes())
    entry = (
        api(families.a)
        .get(f"/api/v1/children/{families.a1.pk}/assets/", {"ids": "brick-wall"})
        .json()["assets"][0]
    )
    assert entry["status"] == "unavailable" and "url" not in entry
    assert draft.status == VersionStatus.VALIDATED


def test_a_new_default_changes_the_cache_key_so_clients_refetch(api, families, texture):
    v1, v2 = publish_two(texture)

    def key():
        data = (
            api(families.a)
            .get(f"/api/v1/children/{families.a1.pk}/assets/", {"ids": "brick-wall"})
            .json()
        )
        return data["assets"][0]["cache"]["key"]

    before = key()
    services.rollback_to_version(v1)
    assert key() != before and key().endswith(str(v1.version_id))


def test_catalog_accepts_the_new_kinds_and_rejects_mismatched_categories():
    from django.core.exceptions import ValidationError

    from apps.catalog.models import AssetOrigin, ContentAsset

    ok = ContentAsset(asset_id="bgm", kind="audio", category="music", origin=AssetOrigin.DJANGO)
    ok.clean()
    bad = ContentAsset(asset_id="bgm2", kind="audio", category="npc", origin=AssetOrigin.DJANGO)
    with pytest.raises(ValidationError):
        bad.clean()


def test_summary_and_links_name_the_media_family(texture, sound):
    image = put(texture, png_bytes(8, 4))
    audio = put(sound, wav_bytes())
    assert ("Image size", "8 x 4 pixels") in preview.summary(image)
    assert dict(preview.summary(audio))["Channels"] == "1"
    assert "image" in str(preview.link_for(image)) and "audio" in str(preview.link_for(audio))


def test_reactivating_an_asset_through_the_definition_admin_is_logged(sound):
    publisher, _ = staff("publisher", "Asset editors", "Asset publishers")
    services.retire_asset(sound)
    response = publisher.post(
        "/admin/catalog/contentasset/",
        {"action": "reactivate_assets", "_selected_action": [sound.pk], "index": 0},
        follow=True,
    )
    sound.refresh_from_db()
    assert response.status_code == 200 and sound.status == AssetStatus.ACTIVE
    assert LogEntry.objects.filter(object_id=str(sound.pk), change_message__contains="Reactivated")
