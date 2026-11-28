"""LAI-ENV-02/03: image profiles, materials and their delivery and dependencies.

Contract `env-assets/1`, `docs/ENVIRONMENT_ASSETS.md`. PostgreSQL 18, unit level; no AWS, no
browser. Images are tiny synthetic files built here (no third-party bytes).
"""

import io
import struct
import zlib

import pytest
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import Client

from apps.assets import dependencies, image_profiles, material_usage, materials, services
from apps.assets.admin_image import _initial_settings
from apps.assets.models import ImageProfile, MaterialDefinition, VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import make_definition, make_version
from apps.assets.tests.media_files import jpeg_bytes, png_bytes, webp_bytes
from apps.catalog import authoring
from apps.catalog.models import AssetStatus, ContentRelease, Location, RevisionStatus, World
from apps.core.content_status import ContentStatus
from apps.regions.models import WorldRegion
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


# --- synthetic images ---------------------------------------------------------------------------


def _chunk(kind: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)


def png(width=4, height=4, colour_type=2, trns=False) -> bytes:
    """A valid PNG of any colour type (2 RGB, 6 RGBA, 3 palette, 0 grey, 4 grey + alpha)."""
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colour_type]
    header = struct.pack(">IIBBBBB", width, height, 8, colour_type, 0, 0, 0)
    rows = b"".join(b"\x00" + b"\x10" * (width * channels) for _ in range(height))
    extra = _chunk(b"PLTE", b"\x00\x00\x00\xff\xff\xff") if colour_type == 3 else b""
    if trns:
        extra += _chunk(b"tRNS", b"\x00" if colour_type == 3 else b"\x00\x00")
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + extra
        + _chunk(b"IDAT", zlib.compress(rows))
        + _chunk(b"IEND", b"")
    )


def jpeg(width=8, height=8, components=3) -> bytes:
    frame = struct.pack(">BHHB", 8, height, width, components) + b"\x01\x11\x00" * components
    scan = b"\x01\x01\x00\x00\x3f\x00"
    return (
        b"\xff\xd8\xff\xc0"
        + struct.pack(">H", 2 + len(frame))
        + frame
        + b"\xff\xda"
        + struct.pack(">H", 2 + len(scan))
        + scan
        + b"\x12\x34\xff\xd9"
    )


def webp_lossless(width=16, height=16, alpha=False) -> bytes:
    bits = (width - 1) | ((height - 1) << 14) | ((1 if alpha else 0) << 28)
    payload = b"\x2f" + struct.pack("<I", bits) + b"\x00" * 7
    chunk = b"VP8L" + struct.pack("<I", len(payload)) + payload
    return b"RIFF" + struct.pack("<I", 4 + len(chunk)) + b"WEBP" + chunk


def webp_extended(width=16, height=16, alpha=True) -> bytes:
    flags = 0x10 if alpha else 0
    vp8x = (
        bytes([flags, 0, 0, 0])
        + (width - 1).to_bytes(3, "little")
        + (height - 1).to_bytes(3, "little")
    )
    chunk = b"VP8X" + struct.pack("<I", len(vp8x)) + vp8x
    return b"RIFF" + struct.pack("<I", 4 + len(chunk)) + b"WEBP" + chunk


#: A confirmed, permitted licence (D-3). Environmental images need one to publish.
CC0 = {
    "provenance": {
        "licenceId": "CC0-1.0",
        "licenceStatus": "confirmed",
        "author": "LAI tests",
        "ownerConfirmation": "synthetic test image",
    }
}


def put(asset, data, name="file.png", **options):
    options.setdefault("extra_metadata", CC0)
    return services.upload_version(asset, io.BytesIO(data), original_filename=name, **options)


def published(asset, data, name="file.png"):
    version = services.publish_version(put(asset, data, name))
    asset.refresh_from_db()
    return version


def texture(asset_id="tr-beach-sand", data=None):
    asset = make_definition(asset_id, kind="texture", category="texture")
    published(asset, data or png(8, 8))
    return asset


def sprite(asset_id="tr-starfish", data=None):
    asset = make_definition(asset_id, kind="sprite", category="image")
    published(asset, data or png(8, 8, colour_type=6))
    return asset


def profile(asset, role, **fields):
    defaults = {"colour_space": image_profiles.default_colour_space(role)}
    row = ImageProfile(asset=asset, role=role, **{**defaults, **fields})
    row.full_clean()
    row.save()
    return row


# --- upload facts (section 3.4) -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "alpha", "model"),
    [
        (png(colour_type=2), False, "rgb"),
        (png(colour_type=6), True, "rgb"),
        (png(colour_type=4), True, "grey"),
        (png(colour_type=0), False, "grey"),
        (png(colour_type=3), False, "palette"),
        (png(colour_type=3, trns=True), True, "palette"),
        (png(colour_type=2, trns=True), True, "rgb"),
        (jpeg(), False, "rgb"),
        (jpeg(components=1), False, "grey"),
        (webp_lossless(alpha=False), False, "rgb"),
        (webp_lossless(alpha=True), True, "rgb"),
        (webp_extended(alpha=True), True, "rgb"),
        (webp_extended(alpha=False), False, "rgb"),
    ],
)
def test_upload_records_transparency_and_colour_model(storage, data, alpha, model):
    asset = make_definition("env-image", kind="texture", category="texture")
    version = put(asset, data)
    assert version.metadata["hasAlpha"] is alpha
    assert version.metadata["colourModel"] == model


def test_a_cmyk_jpeg_passes_with_a_warning(storage):
    asset = make_definition("cmyk-photo", kind="texture", category="texture")
    version = put(asset, jpeg(components=4), "photo.jpg")
    assert version.metadata["colourModel"] == "cmyk"
    assert "image_cmyk" in {finding["code"] for finding in version.validation_report}


def test_the_existing_fixtures_still_validate(storage):
    """Backward compatibility: the shared fixtures keep passing with the extra facts."""
    asset = make_definition("old-texture", kind="texture", category="texture")
    for data in (png_bytes(8, 4), jpeg_bytes(), webp_bytes()):
        version = put(asset, data)
        assert version.status == VersionStatus.VALIDATED
        assert {"width", "height", "hasAlpha", "colourModel"} <= set(version.metadata)


def test_malformed_and_oversized_images_are_still_refused(storage):
    asset = make_definition("bad-image", kind="texture", category="texture")
    for data in (png()[:-6], png() + b"extra", png(5000, 10)):
        with pytest.raises(AssetActionRefused):
            put(asset, data)
    assert not asset.versions.exists()


# --- the material kind holds no file ------------------------------------------------------------


def test_a_material_definition_refuses_every_upload(storage):
    material = make_definition("tr-wooden-dock", kind="material", category="texture")
    with pytest.raises(AssetActionRefused) as refused:
        put(material, png())
    assert {f.code for f in refused.value.findings} == {"no_files_for_kind"}
    assert not material.versions.exists() and list(storage.list()) == []


def test_material_is_a_valid_django_kind_with_its_categories():
    asset = make_definition("tr-mat", kind="material", category="texture")
    asset.full_clean()
    asset.category = "npc"
    with pytest.raises(ValidationError):
        asset.full_clean()


# --- image profile rules (section 3.3) ----------------------------------------------------------


def test_a_role_must_suit_the_kind(storage):
    shell = sprite()
    with pytest.raises(ValidationError) as error:
        profile(shell, image_profiles.SURFACE)
    assert "role" in error.value.message_dict


def test_a_material_map_is_linear_and_names_its_channel(storage):
    normal = texture("tr-rock-normal")
    with pytest.raises(ValidationError) as error:
        profile(normal, image_profiles.MATERIAL_MAP, colour_space="SRGB", data_channel="NORMAL")
    assert "colour_space" in error.value.message_dict
    with pytest.raises(ValidationError) as error:
        profile(normal, image_profiles.MATERIAL_MAP)
    assert "data_channel" in error.value.message_dict
    profile(normal, image_profiles.MATERIAL_MAP, data_channel="NORMAL")


def test_the_database_refuses_an_srgb_material_map(storage):
    asset = texture("tr-orm")
    with pytest.raises(IntegrityError), transaction.atomic():
        ImageProfile.objects.create(asset=asset, role="MATERIAL_MAP", colour_space="SRGB")


def test_colour_roles_are_srgb(storage):
    with pytest.raises(ValidationError) as error:
        profile(texture(), image_profiles.SURFACE, colour_space="LINEAR")
    assert "colour_space" in error.value.message_dict


def test_transparency_needs_an_alpha_channel(storage):
    opaque = make_definition("tr-flat-sprite", kind="sprite", category="image")
    published(opaque, png(8, 8, colour_type=2))
    with pytest.raises(ValidationError) as error:
        profile(
            opaque, image_profiles.SPRITE, alpha_mode="BLEND", world_width_m=0.3, placement="GROUND"
        )
    assert "alpha_mode" in error.value.message_dict
    shell = sprite()
    profile(shell, image_profiles.SPRITE, alpha_mode="BLEND", world_width_m=0.3, placement="GROUND")


def test_an_older_version_without_alpha_facts_only_warns(storage):
    legacy = make_definition("legacy-sprite", kind="sprite", category="image")
    version = make_version(
        legacy, 1, status=VersionStatus.PUBLISHED, format="png", metadata={"width": 8, "height": 8}
    )
    legacy.default_version = version
    legacy.save()
    row = ImageProfile(
        asset=legacy, role="SPRITE", alpha_mode="MASK", world_width_m=1, placement="BILLBOARD"
    )
    errors, warnings = image_profiles.profile_problems(row)
    assert errors == {} and len(warnings) == 1


@pytest.mark.parametrize(
    ("layout", "size", "ok"),
    [
        ("EQUIRECTANGULAR", (64, 32), True),
        ("EQUIRECTANGULAR", (64, 40), False),
        ("CUBE_STRIP", (96, 16), True),
        ("CUBE_STRIP", (100, 16), False),
        ("CUBE_GRID", (48, 32), True),
        ("CUBE_GRID", (48, 30), False),
    ],
)
def test_sky_layouts_check_the_image_shape(storage, layout, size, ok):
    sky = make_definition("tr-sky", kind="texture", category="texture")
    published(sky, png(*size))
    row = ImageProfile(asset=sky, role="SKY", sky_layout=layout)
    errors, _ = image_profiles.profile_problems(row)
    assert ("sky_layout" not in errors) is ok


def test_sprite_sheets_divide_into_whole_frames(storage):
    flame = make_definition("tr-campfire-flame", kind="sprite", category="image")
    published(flame, png(64, 32, colour_type=6))
    good = ImageProfile(
        asset=flame,
        role="PARTICLE",
        blending="ADDITIVE",
        world_width_m=0.5,
        sheet_columns=4,
        sheet_rows=2,
        frame_count=7,
        frames_per_second=12,
    )
    assert image_profiles.profile_problems(good)[0] == {}
    uneven = ImageProfile(
        asset=flame,
        role="PARTICLE",
        blending="ADDITIVE",
        world_width_m=0.5,
        sheet_columns=5,
        sheet_rows=2,
    )
    assert "sheet_columns" in image_profiles.profile_problems(uneven)[0]
    too_many = ImageProfile(
        asset=flame,
        role="PARTICLE",
        blending="ADDITIVE",
        world_width_m=0.5,
        sheet_columns=4,
        sheet_rows=2,
        frame_count=9,
    )
    assert "frame_count" in image_profiles.profile_problems(too_many)[0]


def test_role_specific_fields_are_refused_elsewhere(storage):
    sand = texture()
    row = ImageProfile(
        asset=sand,
        role="SURFACE",
        placement="GROUND",
        blending="ADDITIVE",
        sky_layout="EQUIRECTANGULAR",
        repeat_u=0,
    )
    errors, _ = image_profiles.profile_problems(row)
    assert {"placement", "blending", "sky_layout", "repeat_u"} <= set(errors)


def test_sized_roles_need_a_world_size_and_a_placement(storage):
    row = ImageProfile(asset=sprite(), role="SPRITE")
    errors, _ = image_profiles.profile_problems(row)
    assert {"world_width_m", "placement"} <= set(errors)


def test_one_default_and_one_per_version(storage):
    sand = texture()
    profile(sand, "SURFACE")
    with pytest.raises(IntegrityError), transaction.atomic():
        ImageProfile.objects.create(asset=sand, role="SURFACE")
    version = sand.default_version
    ImageProfile.objects.create(asset=sand, version=version, role="SURFACE", seamless=True)
    assert image_profiles.profile_for(sand, version).seamless is True


# --- render block (section 5) -------------------------------------------------------------------


def test_a_surface_render_block_carries_sampling(storage):
    sand = texture()
    row = profile(sand, "SURFACE", seamless=True, metres_per_repeat=2.0, rotation_degrees=90)
    block = image_profiles.render_block(row, sand.default_version)
    assert block["schema"] == "env-assets/1" and block["colourSpace"] == "srgb"
    assert block["sampling"] == {
        "wrap": "REPEAT",
        "seamless": True,
        "metresPerRepeat": 2.0,
        "repeat": [1.0, 1.0],
        "rotationDegrees": 90,
    }
    assert block["sprite"] is None and block["sky"] is None


def test_a_sprite_sheet_block_derives_height_from_the_frame(storage):
    flame = make_definition("tr-flame", kind="sprite", category="image")
    published(flame, png(64, 32, colour_type=6))
    row = profile(
        flame,
        "SPRITE",
        world_width_m=0.5,
        placement="BILLBOARD",
        alpha_mode="BLEND",
        sheet_columns=4,
        sheet_rows=2,
        frames_per_second=10,
    )
    block = image_profiles.render_block(row, flame.default_version)
    # 16 x 16 frames: square, so 0.5 m wide is 0.5 m high
    assert block["sprite"] == {
        "widthM": 0.5,
        "heightM": 0.5,
        "anchor": [0.5, 0.0],
        "placement": "BILLBOARD",
    }
    assert block["sheet"]["frameWidth"] == 16 and block["sheet"]["frameCount"] == 8


def test_a_cube_sky_block_has_its_face_size(storage):
    sky = make_definition("tr-cube-sky", kind="texture", category="texture")
    published(sky, png(96, 16))
    row = profile(sky, "SKY", sky_layout="CUBE_STRIP")
    assert image_profiles.render_block(row, sky.default_version)["sky"] == {
        "layout": "CUBE_STRIP",
        "faceSize": 16,
    }


def test_a_material_map_render_block_is_linear_data(storage):
    normal = texture("tr-normal")
    row = profile(normal, "MATERIAL_MAP", data_channel="NORMAL")
    block = image_profiles.render_block(row, normal.default_version)
    assert block["colourSpace"] == "linear" and block["dataChannel"] == "NORMAL"


# --- materials: content rules (section 4) -------------------------------------------------------


def staff_user(
    username="author", *, perms=("catalog.edit_content_draft", "catalog.publish_content")
):
    from django.contrib.auth.models import Permission

    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}", admin_username=username, is_staff=True
    )
    for name in perms:
        app, codename = name.split(".")
        account.user_permissions.add(
            Permission.objects.get(content_type__app_label=app, codename=codename)
        )
    return ParentAccount.objects.get(pk=account.pk)


def make_material(asset_id="tr-wooden-dock"):
    asset = make_definition(asset_id, kind="material", category="texture")
    return MaterialDefinition.objects.create(asset=asset)


def body_with(material_id="tr-wooden-dock", **maps):
    body = materials.empty_body(material_id)
    for slot, asset_id in maps.items():
        body["maps"][slot] = {"assetId": asset_id}
    return body


def publish_material(row, body, user):
    draft = authoring.create_draft(row, body, user=user)
    return authoring.publish(draft, user=user)


@pytest.fixture
def dock_textures(storage):
    albedo = texture("tr-dock-albedo")
    profile(albedo, "SURFACE", seamless=True)
    normal = texture("tr-dock-normal")
    profile(normal, "MATERIAL_MAP", data_channel="NORMAL")
    orm = texture("tr-dock-orm")
    profile(orm, "MATERIAL_MAP", data_channel="ORM")
    return {"albedo": albedo, "normal": normal, "orm": orm}


def test_the_empty_body_is_valid_and_every_map_is_optional():
    assert materials.body_problems(materials.empty_body("m"), check_assets=False) == []


def test_body_rules_name_every_problem(dock_textures):
    shell = sprite()
    body = body_with(
        baseColor="tr-dock-normal",
        normal="tr-dock-albedo",
        emissive=shell.asset_id,
        orm="tr-dock-orm",
        roughness="tr-dock-orm",
        height="nope",
    )
    body["maps"]["glow"] = {"assetId": "x"}
    body["factors"].update(roughness=2, baseColor=-1)
    body["uv"]["repeat"] = [0, 1]
    problems = "\n".join(materials.body_problems(body))
    for expected in (
        "$.maps.baseColor.assetId: 'tr-dock-normal' is a material_map image",
        "$.maps.normal.assetId: 'tr-dock-albedo' is not a normal material map",
        "$.maps.emissive.assetId: 'tr-starfish' is a sprite, not a texture",
        "$.maps.height.assetId: unknown asset 'nope'",
        "$.maps.glow: unknown slot",
        "$.maps.orm: a packed ORM map replaces",
        "$.factors.roughness: must be a number from 0 to 1",
        "$.factors.baseColor: must be a colour",
        "$.uv.repeat",
    ):
        assert expected in problems


def test_a_data_slot_needs_a_material_map_profile(storage):
    texture("tr-bare")
    problems = materials.body_problems(body_with(normal="tr-bare"))
    assert "has no image profile" in problems[0]
    assert materials.body_problems(body_with(baseColor="tr-bare")) == []


def test_a_retired_texture_cannot_be_chosen(dock_textures):
    albedo = dock_textures["albedo"]
    services.retire_asset(albedo)
    assert "is retired" in materials.body_problems(body_with(baseColor="tr-dock-albedo"))[0]


def test_publishing_copies_the_body_and_records_history(dock_textures):
    user = staff_user()
    row = make_material()
    body = body_with(baseColor="tr-dock-albedo", normal="tr-dock-normal", orm="tr-dock-orm")
    body["factors"]["roughness"] = 0.8
    revision = publish_material(row, body, user)
    row.refresh_from_db()
    assert revision.status == RevisionStatus.PUBLISHED and row.published_revision == revision
    assert row.texture_asset_ids == ["tr-dock-albedo", "tr-dock-normal", "tr-dock-orm"]
    assert set(row.definition["maps"]) == {"baseColor", "normal", "orm"}  # empty slots dropped
    assert row.definition["factors"]["roughness"] == 0.8
    # A second version without the normal map; then roll back to the first.
    second = publish_material(row, body_with(baseColor="tr-dock-albedo"), user)
    row.refresh_from_db()
    assert row.texture_asset_ids == ["tr-dock-albedo"] and second.number == 2
    authoring.rollback(revision, user=user)
    row.refresh_from_db()
    assert row.texture_asset_ids == ["tr-dock-albedo", "tr-dock-normal", "tr-dock-orm"]


def test_an_invalid_body_is_never_published(dock_textures):
    user = staff_user()
    row = make_material()
    draft = authoring.create_draft(row, body_with(normal="tr-dock-albedo"), user=user)
    assert draft.validation_report
    with pytest.raises(authoring.PublishRefused):
        authoring.publish(draft, user=user)
    row.refresh_from_db()
    assert row.published_revision is None and row.definition == {}


def test_publishing_a_material_needs_the_content_permission(dock_textures):
    row = make_material()
    reader = staff_user("reader", perms=())
    with pytest.raises(authoring.NotPermitted):
        authoring.create_draft(row, body_with(baseColor="tr-dock-albedo"), user=reader)


def test_a_material_row_is_never_deleted():
    row = make_material()
    with pytest.raises(ValueError):
        row.delete()


# --- resolver (section 5) -----------------------------------------------------------------------


def url_for(child):
    return f"/api/v1/children/{child.pk}/assets/"


def resolve(api, families, ids):
    response = api(families.a).get(url_for(families.a1), {"ids": ids})
    assert response.status_code == 200
    return {entry["ref"]: entry for entry in response.json()["assets"]}


@pytest.fixture
def env(families, cognito, dock_textures):
    cache.clear()
    user = staff_user()
    row = make_material()
    publish_material(row, body_with(baseColor="tr-dock-albedo", normal="tr-dock-normal"), user)
    row.refresh_from_db()
    return {"families": families, "material": row, "user": user, **dock_textures}


def test_an_image_with_a_profile_carries_render_and_alpha(api, env):
    entry = resolve(api, env["families"], "tr-dock-albedo")["tr-dock-albedo"]
    assert entry["status"] == "resolved" and entry["family"] == "image"
    assert entry["media"] == {"width": 8, "height": 8, "hasAlpha": False, "colourModel": "rgb"}
    assert entry["render"]["role"] == "SURFACE" and entry["render"]["sampling"]["seamless"]
    assert "collision" not in entry  # images never collide


def test_an_image_without_a_profile_is_unchanged(api, families, cognito, storage):
    cache.clear()
    texture("tr-plain")
    entry = resolve(api, families, "tr-plain")["tr-plain"]
    assert "render" not in entry and entry["media"]["width"] == 8


def test_an_older_image_reports_unknown_alpha(api, families, cognito, storage):
    cache.clear()
    legacy = make_definition("legacy-art", kind="image", category="image")
    put_version = put(legacy, png())
    # Simulate a version uploaded before the facts existed (metadata frozen at publish).
    put_version.metadata = {"width": 4, "height": 4}
    put_version.save(update_fields=["metadata"])
    services.publish_version(put_version)
    entry = resolve(api, families, "legacy-art")["legacy-art"]
    assert entry["media"] == {"width": 4, "height": 4, "hasAlpha": None, "colourModel": None}


def test_a_material_resolves_with_its_maps_inlined(api, env):
    entry = resolve(api, env["families"], "tr-wooden-dock")["tr-wooden-dock"]
    revision = env["material"].published_revision
    assert entry["status"] == "resolved" and entry["kind"] == "material"
    assert entry["family"] == "material" and "url" not in entry
    assert entry["version"] == revision.number
    assert entry["cache"]["key"] == f"tr-wooden-dock@{revision.pk}"
    maps = entry["material"]["maps"]
    assert set(maps) == {"baseColor", "normal"}
    assert maps["baseColor"]["status"] == "resolved" and maps["baseColor"]["url"]
    assert maps["normal"]["render"]["colourSpace"] == "linear"
    assert entry["material"]["schema"] == "env-assets/1"


def test_an_unavailable_map_is_sent_without_a_url(api, env):
    bare = make_definition("tr-unpublished", kind="texture", category="texture")
    put(bare, png())  # validated, never published
    publish_material(env["material"], body_with(baseColor="tr-unpublished"), env["user"])
    entry = resolve(api, env["families"], "tr-wooden-dock")["tr-wooden-dock"]
    assert entry["material"]["maps"]["baseColor"] == {
        "id": "tr-unpublished",
        "status": "unavailable",
    }


def test_unpublished_and_retired_materials_have_no_content(api, env):
    make_material("tr-draft-only")
    services.retire_asset(env["material"].asset)
    answer = resolve(api, env["families"], "tr-draft-only,tr-wooden-dock")
    assert answer["tr-draft-only"] == {
        "ref": "tr-draft-only",
        "id": "tr-draft-only",
        "status": "unavailable",
    }
    assert answer["tr-wooden-dock"]["status"] == "retired"
    assert "material" not in answer["tr-wooden-dock"]


def test_material_resolution_query_count_is_bounded(api, env, django_assert_max_num_queries):
    for i in range(5):
        publish_material(
            make_material(f"mat-{i}"),
            body_with(f"mat-{i}", baseColor="tr-dock-albedo"),
            env["user"],
        )
    ids = ",".join(["tr-wooden-dock", *[f"mat-{i}" for i in range(5)]])
    client = api(env["families"].a)
    client.get(url_for(env["families"].a1), {"ids": "tr-dock-albedo"})  # warm caches
    with django_assert_max_num_queries(12):
        assert client.get(url_for(env["families"].a1), {"ids": ids}).status_code == 200


# --- dependencies and retirement (section 9 of the task; ASSET_LIBRARY.md s.25) ---------------


def _area(region_id, scene, status=ContentStatus.PUBLISHED):
    release = ContentRelease.objects.first() or ContentRelease.objects.create(
        content_digest="0" * 64, schema_version=1, export_tool="tests", files=[], report={}
    )
    world, _ = World.objects.get_or_create(
        slug="env-island",
        defaults={
            "title": "Env",
            "supported_age_bands": ["SPROUT"],
            "pack_version": 1,
            "source": {},
            "last_seen_release": release,
        },
    )
    place = Location.objects.create(
        slug=f"{region_id}-place", world=world, title="P", source={}, last_seen_release=release
    )
    return WorldRegion.objects.create(
        region_id=region_id, location=place, title="A", status=status, scene=scene
    )


def test_the_materials_source_is_registered_and_authoritative():
    assert "materials" in dependencies.registered_sources()
    assert dependencies.check_class("materials") == dependencies.CheckClass.AUTHORITATIVE


def test_a_texture_in_a_published_material_cannot_be_retired(env):
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(env["normal"])
    assert refused.value.code == material_usage.REFUSAL_CODE
    assert "tr-wooden-dock" in refused.value.message
    env["normal"].refresh_from_db()
    assert env["normal"].status == AssetStatus.ACTIVE


def test_the_refusal_follows_the_material_to_the_3d_areas_using_it(env):
    _area("treasure-cove-env", {"surfaces": [{"materialAssetId": "tr-wooden-dock"}]})
    usage = [u for u in dependencies.usages_for(env["normal"]) if u.source == "materials"][0]
    assert usage.blocks_retirement
    assert "3D Area treasure-cove-env (published)" in usage.label
    assert usage.details["usedBy"][0]["region"] == "treasure-cove-env"


def test_a_material_used_by_a_published_area_cannot_be_retired(env):
    _area("dock-area", {"dock": {"materialAssetId": "tr-wooden-dock"}})
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(env["material"].asset)
    assert refused.value.code == "region_placement_dependency"


def test_a_sprite_skybox_or_decal_id_in_a_scene_blocks_like_a_model(storage):
    shell = sprite("tr-shell")
    _area("shell-beach", {"decor": {"spriteAssetIds": ["tr-shell"], "skyAssetId": "x"}})
    with pytest.raises(AssetActionRefused):
        services.retire_asset(shell)


def test_retired_materials_and_drafts_never_block(env):
    services.retire_asset(env["material"].asset)
    other = make_material("tr-draft-mat")
    authoring.create_draft(
        other, body_with("tr-draft-mat", baseColor="tr-dock-albedo"), user=env["user"]
    )
    found = [u for u in dependencies.usages_for(env["albedo"]) if u.source == "materials"]
    assert {u.blocks_retirement for u in found} == {False}
    assert any(u.historical for u in found) and any("draft version" in u.label for u in found)
    services.retire_asset(env["albedo"])  # nothing blocks


def test_replacing_a_texture_version_is_unchanged(env):
    albedo = env["albedo"]
    old = albedo.default_version
    new = published(albedo, png(16, 16))
    services.set_default_version(new)
    albedo.refresh_from_db()
    services.retire_version(old)  # not the default: materials never pin a version
    assert dependencies.usages_for(albedo, albedo.default_version)  # reported, not blocking
    assert not any(u.blocks_retirement for u in dependencies.usages_for(albedo, new))


def test_a_failing_material_check_fails_closed(env, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("database gone")

    monkeypatch.setattr(material_usage, "_material_uses", broken)
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(env["normal"])
    assert refused.value.code == "dependency_check_failed"


def test_models_npcs_and_audio_are_untouched_by_the_materials_source(storage):
    prop = make_definition("crate", kind="prop", category="prop")
    assert material_usage.usages(prop) == []


# --- Django Admin ------------------------------------------------------------------------------


@pytest.fixture
def roles():
    call_command("ensure_asset_roles", verbosity=0)
    call_command("ensure_content_roles", verbosity=0)
    cache.clear()


def staff_client(username, *groups):
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}", admin_username=username, is_staff=True
    )
    account.groups.set(Group.objects.filter(name__in=groups))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


PROFILES = "/admin/assets/imageprofile/"
MATERIALS = "/admin/assets/materialdefinition/"


def test_editors_read_profiles_and_publishers_write_them(roles, storage):
    sand = texture()
    editor = staff_client("ed", "Asset editors")
    publisher = staff_client("pub", "Asset publishers")
    assert editor.get(PROFILES).status_code == 200
    assert editor.get(f"{PROFILES}add/").status_code == 403
    response = publisher.post(
        f"{PROFILES}add/",
        {
            "asset": sand.pk,
            "role": "SURFACE",
            "colour_space": "SRGB",
            "alpha_mode": "OPAQUE",
            "seamless": "on",
            "wrap": "REPEAT",
            "metres_per_repeat": "2",
            "loop": "on",
        },
    )
    assert response.status_code == 302, response.content[:2000]
    row = ImageProfile.objects.get(asset=sand)
    assert row.seamless and row.metres_per_repeat == 2
    page = publisher.get(f"{PROFILES}{row.pk}/change/")
    assert page.status_code == 200
    html = page.content.decode()
    assert "background-repeat:repeat" in html and "env-assets/1" in html


def test_the_admin_form_shows_rule_problems(roles, storage):
    shell = sprite()
    publisher = staff_client("pub", "Asset publishers")
    response = publisher.post(
        f"{PROFILES}add/",
        {
            "asset": shell.pk,
            "role": "SURFACE",
            "colour_space": "SRGB",
            "alpha_mode": "OPAQUE",
            "wrap": "REPEAT",
        },
    )
    assert response.status_code == 200 and not ImageProfile.objects.exists()
    assert "cannot have the role" in response.content.decode()


def test_a_material_is_created_in_admin_and_edited_through_content_versions(roles, storage):
    material = make_definition("tr-admin-mat", kind="material", category="texture")
    publisher = staff_client("pub", "Asset publishers")
    assert publisher.post(f"{MATERIALS}add/", {"asset": material.pk}).status_code == 302
    row = MaterialDefinition.objects.get(asset=material)
    page = publisher.get(f"{MATERIALS}{row.pk}/change/").content.decode()
    assert "Edit content (start a draft)" in page
    assert publisher.post(f"{MATERIALS}{row.pk}/delete/").status_code == 403


def test_a_material_maps_conversion_defaults_to_data(storage):
    normal = texture("tr-conv-normal")
    profile(normal, "MATERIAL_MAP", data_channel="NORMAL")
    assert _initial_settings(normal.default_version) == {"purpose": "data", "lossless": True}
    sand = texture("tr-conv-sand")
    assert _initial_settings(sand.default_version) == {}


def test_provenance_is_kept_in_the_version_metadata(storage):
    asset = make_definition("tr-cc0-sand", kind="texture", category="texture")
    provenance = {
        "sourceUrl": "https://example.org/sand",
        "author": "Example",
        "licenceId": "CC0-1.0",
        "licenceStatus": "confirmed",
    }
    version = put(asset, png(), extra_metadata={"provenance": provenance})
    assert version.metadata["provenance"] == provenance


def test_the_admin_upload_records_provenance_and_warns_without_a_licence(roles, storage):
    from django.core.files.uploadedfile import SimpleUploadedFile

    asset = make_definition("tr-upload-sand", kind="texture", category="texture")
    editor = staff_client("ed", "Asset editors")
    response = editor.post(
        "/admin/assets/assetversion/upload/",
        {
            "asset": asset.pk,
            "file": SimpleUploadedFile("sand.png", png(), "image/png"),
            "source_url": "https://example.org/sand",
            "author": "Example Studio",
            "licence_id": "CC0-1.0",
            "licence_confirmed_by": "owner, 2026-11-27",
        },
        follow=True,
    )
    assert response.status_code == 200
    version = asset.versions.get()
    assert version.metadata["provenance"]["licenceId"] == "CC0-1.0"
    assert version.metadata["provenance"]["licenceStatus"] == "confirmed"
    assert "licence_unknown" not in response.content.decode()
    response = editor.post(
        "/admin/assets/assetversion/upload/",
        {
            "asset": asset.pk,
            "file": SimpleUploadedFile("sand2.png", png(8, 8), "image/png"),
        },
        follow=True,
    )
    shown = [str(m) for m in response.context["messages"]] if response.context else []
    assert any("licence_unknown" in m for m in shown), (shown, response.redirect_chain)
    assert "provenance" not in asset.versions.get(number=2).metadata


def test_the_shared_content_editor_drafts_and_publishes_a_material(roles, dock_textures):
    """ADR-047's generic structured editor handles the material kind end to end."""
    from django.contrib.contenttypes.models import ContentType
    from django.urls import reverse

    row = make_material("tr-editor-mat")
    author = staff_client("author", "Asset publishers", "Content publishers")
    content_type = ContentType.objects.get_for_model(MaterialDefinition)
    start = reverse("admin:catalog_contentrevision_new_draft", args=[content_type.pk, row.pk])
    assert author.get(start).status_code == 200
    editor_page = author.post(start, follow=True)
    assert editor_page.status_code == 200
    assert "baseColor" in editor_page.content.decode()
    draft = authoring.revisions_for(row).get(status=RevisionStatus.DRAFT)
    assert draft.body == materials.empty_body("tr-editor-mat")
    body = body_with("tr-editor-mat", baseColor="tr-dock-albedo")
    authoring.update_draft(draft, body, user=draft.created_by)
    authoring.publish(draft, user=draft.created_by)
    row.refresh_from_db()
    assert row.texture_asset_ids == ["tr-dock-albedo"]
    asset_editor = staff_client("plain", "Asset editors")
    assert asset_editor.get(start).status_code == 403  # content drafting is a content role


# --- scene discovery and the region catalog (owner follow-up 3, 2026-11-28) -------------------

ENV_SCENE = {
    "groundAssetId": "tr-beach-sand",
    "surfaces": [
        {"id": "dock", "materialAssetId": "tr-wooden-dock", "uv": {"repeat": [2, 2]}},
        {"id": "path", "layers": [{"materialAssetId": "tr-path-mat"}]},
    ],
    "decor": {
        "scatter": [{"spriteAssetIds": ["tr-shell-a", "tr-starfish"], "count": 12}],
        "decals": [{"decalAssetId": "tr-footprint", "at": [1, 2]}],
    },
    "sky": {"skyAssetId": "tr-sky", "backdrops": {"islandAssetIds": ["tr-island-far"]}},
    # Not asset references: ids of other things, and names that do not end in AssetId(s).
    "materialId": "not-an-asset",
    "spriteNames": ["also-not"],
}


def test_every_asset_id_key_is_found_at_any_depth_and_in_lists():
    from apps.regions.dependencies import scene_asset_ids

    found = scene_asset_ids(ENV_SCENE)
    assert set(found) == {
        "tr-beach-sand",
        "tr-wooden-dock",
        "tr-path-mat",
        "tr-shell-a",
        "tr-starfish",
        "tr-footprint",
        "tr-sky",
        "tr-island-far",
    }
    assert found["tr-path-mat"] == ["surfaces[1].layers[0].materialAssetId"]
    assert found["tr-starfish"] == ["decor.scatter[0].spriteAssetIds[1]"]
    assert found["tr-island-far"] == ["sky.backdrops.islandAssetIds[0]"]


def test_a_nested_material_reference_protects_the_material_and_its_textures(env):
    _area("nested-cove", {"a": [{"b": {"layers": [{"materialAssetId": "tr-wooden-dock"}]}}]})
    with pytest.raises(AssetActionRefused) as material_refusal:
        services.retire_asset(env["material"].asset)
    assert material_refusal.value.code == "region_placement_dependency"
    with pytest.raises(AssetActionRefused) as texture_refusal:
        services.retire_asset(env["normal"])
    assert texture_refusal.value.code == material_usage.REFUSAL_CODE
    assert "3D Area nested-cove (published)" in texture_refusal.value.message


def test_a_draft_area_using_a_material_is_reported_not_blocking(env):
    _area(
        "draft-cove",
        {"surfaces": [{"materialAssetId": "tr-wooden-dock"}]},
        status=ContentStatus.DRAFT,
    )
    usages = dependencies.usages_for(env["material"].asset)
    assert usages and not any(u.blocks_retirement for u in usages)


def test_the_region_catalog_delivers_a_material_only_once_published(env):
    from apps.game_sessions.play_state import region_catalog

    texture("tr-beach-sand")
    make_material("tr-path-mat")  # created, never published
    region = _area("catalog-cove", ENV_SCENE)
    listed = {row["assetId"]: row for row in region_catalog(region)["assets"]}
    assert listed["tr-wooden-dock"]["kind"] == "material"
    assert listed["tr-wooden-dock"]["deliverable"] is True
    assert listed["tr-path-mat"]["deliverable"] is False
    assert listed["tr-beach-sand"]["deliverable"] is True  # a published texture, as before


def test_a_material_asset_with_no_definition_row_is_not_deliverable(storage):
    from apps.game_sessions.play_state import region_catalog

    make_definition("tr-bare-mat", kind="material", category="texture")
    region = _area("bare-cove", {"surfaces": [{"materialAssetId": "tr-bare-mat"}]})
    (row,) = region_catalog(region)["assets"]
    assert row == {"assetId": "tr-bare-mat", "kind": "material", "clips": [], "deliverable": False}


# --- D-3 licence conditions (owner, 2026-11-28) -------------------------------------------------

UNLICENSED = {"provenance": {}}


def test_an_existing_image_without_a_licence_still_publishes(storage):
    """Backward compatible: no image profile, so no new rule applies."""
    art = make_definition("legacy-island-art", kind="image", category="image")
    version = services.publish_version(put(art, png(), extra_metadata=None))
    assert version.status == VersionStatus.PUBLISHED


@pytest.mark.parametrize(
    ("provenance", "problem"),
    [
        ({}, "not confirmed"),
        ({"licenceId": "CC0-1.0", "licenceStatus": "unconfirmed"}, "not confirmed"),
        ({"licenceStatus": "confirmed"}, "no licence id"),
        ({"licenceId": "CC-BY-4.0", "licenceStatus": "confirmed"}, "ADR-028"),
        ({"licenceId": "MIT", "licenceStatus": "confirmed"}, "not a permitted licence"),
    ],
)
def test_an_environmental_image_needs_a_verified_permitted_licence(storage, provenance, problem):
    sand = texture("tr-env-sand")  # v1 licensed
    profile(sand, "SURFACE")
    candidate = put(sand, png(16, 16), extra_metadata={"provenance": provenance})
    with pytest.raises(AssetActionRefused) as refused:
        services.publish_version(candidate)
    assert refused.value.code == "licence_required" and problem in refused.value.message
    candidate.refresh_from_db()
    assert candidate.status == VersionStatus.VALIDATED  # refused, not rejected
    assert services.publish_refusal(candidate).code == "licence_required"  # shown in Admin


@pytest.mark.parametrize("licence", ["CC0-1.0", "original", "proprietary"])
def test_a_permitted_confirmed_licence_publishes(storage, licence):
    sand = texture("tr-env-ok")
    profile(sand, "SURFACE")
    provenance = {"licenceId": licence, "licenceStatus": "confirmed"}
    version = put(sand, png(16, 16), extra_metadata={"provenance": provenance})
    assert services.publish_version(version).status == VersionStatus.PUBLISHED


def test_a_material_cannot_use_an_unlicensed_texture(storage):
    legacy = make_definition("tr-legacy-planks", kind="texture", category="texture")
    services.publish_version(put(legacy, png(), extra_metadata=UNLICENSED))
    problems = materials.body_problems(body_with(baseColor="tr-legacy-planks"))
    assert problems and "cannot be used yet: its licence is not confirmed" in problems[0]


def test_the_profile_admin_warns_about_an_unlicensed_default(roles, storage):
    legacy = make_definition("tr-legacy-rock", kind="texture", category="texture")
    services.publish_version(put(legacy, png(), extra_metadata=UNLICENSED))
    publisher = staff_client("pub", "Asset publishers")
    response = publisher.post(
        f"{PROFILES}add/",
        {
            "asset": legacy.pk,
            "role": "SURFACE",
            "colour_space": "SRGB",
            "alpha_mode": "OPAQUE",
            "wrap": "REPEAT",
            "loop": "on",
        },
        follow=True,
    )
    shown = [str(m) for m in response.context["messages"]]
    assert any(m.startswith("licence_required") for m in shown), shown
    legacy.refresh_from_db()
    assert legacy.default_version.status == VersionStatus.PUBLISHED  # nothing is unpublished
