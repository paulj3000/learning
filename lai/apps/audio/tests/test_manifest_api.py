"""SM-P2-06 and SM-P2-08: the read-only, child-scoped, published-only manifest API."""

import json

import pytest

from apps.assets import services as asset_services
from apps.audio import services
from apps.audio.tests.helpers import asset_upload, assign, audio_asset, cue
from apps.catalog.models import Location, World

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def manifest_url(child, kind, identifier):
    return f"/api/v1/children/{child.pk}/audio/manifests/{kind}/{identifier}/"


@pytest.fixture
def setup(treasure):
    region = treasure.region
    place = region.location
    island = place.world
    ui, _ = audio_asset("menu-click", seconds=1)
    coin, _ = audio_asset("coin-clink", seconds=2)
    chest, chest_v1 = audio_asset("chest-creak", seconds=3)
    ocean, _ = audio_asset("ocean-waves", category="sound", seconds=4)
    theme_island, _ = audio_asset("island-theme", category="music", seconds=5)
    theme_area, _ = audio_asset("cove-theme", category="music", seconds=6)
    cues = {
        "ui": cue("ui.menu.select", ui, shared=True),
        "coin": cue("sfx.coin.collect", coin),
        "chest": cue("sfx.chest.open", chest, volume=0.85, max_concurrent=2, cooldown_ms=150),
        "ocean": cue("ambient.ocean.waves", ocean, loop=True, stream=True, fade_in_ms=800),
        "island_theme": cue("music.island.explore", theme_island, loop=True),
        "area_theme": cue("music.treasure_rush.explore", theme_area, loop=True),
    }
    assign(cues["island_theme"], event="on_enter", world=island)
    assign(cues["area_theme"], event="on_enter", region=region)
    assign(cues["ocean"], event="on_enter", location=place)
    assign(
        cues["chest"],
        target_type="chest",
        target_id=treasure.chest.entity_id,
        event="on_open",
        region=region,
    )
    return {
        "t": treasure,
        "cues": cues,
        "chest_asset": chest,
        "chest_v1": chest_v1,
        "region": region,
        "place": place,
        "island": island,
    }


def get(api, treasure, kind, identifier, **headers):
    f = treasure.families
    return api(f.a).get(manifest_url(f.a1, kind, identifier), **headers)


def ids(body):
    return {sound["id"] for sound in body["sounds"]}


def test_before_any_release_the_manifest_is_empty_not_an_error(api, setup):
    response = get(api, setup["t"], "regions", setup["region"].region_id)
    body = response.json()
    assert response.status_code == 200
    assert body["sounds"] == [] and body["assignments"] == []
    assert body["scope"] == {"type": "region", "id": setup["region"].region_id}


def test_a_published_region_manifest_has_sounds_assignments_and_a_revision(api, setup, cognito):
    services.publish(None)
    response = get(api, setup["t"], "regions", setup["region"].region_id)
    body = response.json()
    assert response.status_code == 200 and body["schemaVersion"] == 1
    assert len(body["revision"]) == 64
    chest = next(s for s in body["sounds"] if s["id"] == "sfx.chest.open")
    assert chest == {
        "id": "sfx.chest.open",
        "assetId": "chest-creak@1",
        "channel": "sfx",
        "volume": 0.85,
        "loop": False,
        "maxConcurrent": 2,
        "cooldownMs": 150,
    }
    ocean = next(s for s in body["sounds"] if s["id"] == "ambient.ocean.waves")
    assert ocean["stream"] is True and ocean["fadeInMs"] == 800 and ocean["loop"] is True
    assert {
        "event": "on_open",
        "targetType": "chest",
        "targetId": setup["t"].chest.entity_id,
        "soundId": "sfx.chest.open",
    } in body["assignments"]


def test_shared_cues_appear_everywhere_and_unassigned_ones_do_not(api, setup):
    services.publish(None)
    for kind, identifier in (
        ("islands", setup["island"].slug),
        ("places", setup["place"].slug),
        ("regions", setup["region"].region_id),
    ):
        assert "ui.menu.select" in ids(get(api, setup["t"], kind, identifier).json())
        assert "sfx.coin.collect" not in ids(get(api, setup["t"], kind, identifier).json())


def test_each_scope_sees_only_its_own_ancestry(api, setup):
    services.publish(None)
    island = ids(get(api, setup["t"], "islands", setup["island"].slug).json())
    place = ids(get(api, setup["t"], "places", setup["place"].slug).json())
    region = ids(get(api, setup["t"], "regions", setup["region"].region_id).json())
    assert "music.island.explore" in island and "ambient.ocean.waves" not in island
    assert "ambient.ocean.waves" in place and "sfx.chest.open" not in place
    assert {"ambient.ocean.waves", "sfx.chest.open"} <= region


def test_the_most_specific_assignment_overrides_a_general_one(api, setup):
    services.publish(None)
    body = get(api, setup["t"], "regions", setup["region"].region_id).json()
    enters = [
        a for a in body["assignments"] if a["event"] == "on_enter" and a["targetType"] == "scope"
    ]
    # Area music replaces island music; the place's ambient bed (another channel) stays.
    assert sorted(a["soundId"] for a in enters) == [
        "ambient.ocean.waves",
        "music.treasure_rush.explore",
    ]
    assert "music.island.explore" not in ids(body)  # replaced, not stacked
    island = get(api, setup["t"], "islands", setup["island"].slug).json()
    assert [a["soundId"] for a in island["assignments"]] == ["music.island.explore"]


def test_a_general_assignment_is_inherited_when_nothing_more_specific_exists(api, setup):
    from apps.audio.models import SoundAssignment

    SoundAssignment.objects.filter(region=setup["region"]).filter(target_type="scope").delete()
    services.publish(None)
    body = get(api, setup["t"], "regions", setup["region"].region_id).json()
    enters = [a["soundId"] for a in body["assignments"] if a["targetType"] == "scope"]
    assert sorted(enters) == ["ambient.ocean.waves", "music.island.explore"]


def test_the_manifest_carries_no_url_and_nothing_administrative(api, setup):
    services.publish(None)
    release = services.live_release()
    text = json.dumps(get(api, setup["t"], "regions", setup["region"].region_id).json())
    for secret in (
        "http",
        "/api/v1/asset-files",
        "storage",
        "sha256",
        "versionId",
        "created",
        "note",
        "published_by",
        "assets/audio/",
    ):
        assert secret not in text, secret
    assert str(release.published_at.year) not in text or "revision" in text


def test_the_assets_in_a_manifest_resolve_through_the_existing_signed_asset_route(api, setup):
    services.publish(None)
    body = get(api, setup["t"], "regions", setup["region"].region_id).json()
    refs = ",".join(sound["assetId"] for sound in body["sounds"])
    f = setup["t"].families
    resolved = api(f.a).get(f"/api/v1/children/{f.a1.pk}/assets/", {"ids": refs}).json()["assets"]
    assert len(resolved) == len(body["sounds"])
    for entry in resolved:
        assert entry["status"] == "resolved" and entry["family"] == "audio"
        assert entry["url"].startswith("/api/v1/asset-files/") and entry["urlExpiresAt"]


# --- draft isolation and revisions ----------------------------


def test_editing_the_working_copy_does_not_change_the_manifest_until_published(api, setup):
    services.publish(None)
    url = (setup["t"], "regions", setup["region"].region_id)
    before = get(api, *url).json()
    setup["cues"]["chest"].volume = 0.1
    setup["cues"]["chest"].save()
    extra, _ = audio_asset("door-creak", seconds=7)
    cue("sfx.door.creak", extra, shared=True)
    assert get(api, *url).json() == before
    services.publish(None)
    after = get(api, *url).json()
    assert after["revision"] != before["revision"] and "sfx.door.creak" in ids(after)


def test_the_revision_is_stable_for_unchanged_content_and_drives_conditional_requests(api, setup):
    services.publish(None)
    first = get(api, setup["t"], "regions", setup["region"].region_id)
    second = get(api, setup["t"], "regions", setup["region"].region_id)
    assert first.json()["revision"] == second.json()["revision"]
    assert first["ETag"] == f'"{first.json()["revision"]}"'
    assert first["Cache-Control"] == "private, no-cache"
    not_modified = get(
        api, setup["t"], "regions", setup["region"].region_id, HTTP_IF_NONE_MATCH=first["ETag"]
    )
    assert not_modified.status_code == 304 and not_modified["ETag"] == first["ETag"]
    services.publish(None)  # identical content: same revision, still not modified
    assert (
        get(
            api, setup["t"], "regions", setup["region"].region_id, HTTP_IF_NONE_MATCH=first["ETag"]
        ).status_code
        == 304
    )


def test_rollback_changes_the_manifest_back(api, setup):
    first = services.publish(None)
    url = (setup["t"], "regions", setup["region"].region_id)
    original = get(api, *url).json()
    setup["cues"]["chest"].volume = 0.2
    setup["cues"]["chest"].save()
    services.publish(None)
    assert get(api, *url).json()["revision"] != original["revision"]
    services.rollback_to(first, None)
    assert get(api, *url).json() == original


def test_a_version_retired_after_publishing_drops_out_of_the_manifest(api, setup):
    services.publish(None)
    url = (setup["t"], "regions", setup["region"].region_id)
    before = get(api, *url).json()
    v2 = asset_services.publish_version(asset_upload(setup["chest_asset"], seconds=8))
    asset_services.set_default_version(v2)
    asset_services.retire_version(setup["chest_v1"])
    after = get(api, *url).json()
    assert "sfx.chest.open" in ids(before) and "sfx.chest.open" not in ids(after)
    assert not [a for a in after["assignments"] if a["soundId"] == "sfx.chest.open"]
    assert after["revision"] != before["revision"]


def test_a_retired_asset_drops_out_of_the_manifest(api, setup):
    services.publish(None)
    asset_services.retire_asset(setup["chest_asset"])
    body = get(api, setup["t"], "regions", setup["region"].region_id).json()
    assert "sfx.chest.open" not in ids(body)


# --- what has a manifest ----------------------------


def test_a_draft_retired_or_unknown_area_has_no_manifest(api, setup):
    from apps.core.content_status import ContentStatus
    from apps.regions.models import WorldRegion

    assert get(api, setup["t"], "regions", "no-such-area").status_code == 404
    WorldRegion.objects.filter(pk=setup["region"].pk).update(status=ContentStatus.DRAFT)
    assert get(api, setup["t"], "regions", setup["region"].region_id).status_code == 404
    WorldRegion.objects.filter(pk=setup["region"].pk).update(status=ContentStatus.RETIRED)
    assert get(api, setup["t"], "regions", setup["region"].region_id).status_code == 404


def test_an_inactive_place_or_island_has_no_manifest(api, setup):
    assert get(api, setup["t"], "places", "no-such-place").status_code == 404
    assert get(api, setup["t"], "islands", "no-such-island").status_code == 404
    Location.objects.filter(pk=setup["place"].pk).update(active=False)
    assert get(api, setup["t"], "places", setup["place"].slug).status_code == 404
    assert get(api, setup["t"], "regions", setup["region"].region_id).status_code == 404
    Location.objects.filter(pk=setup["place"].pk).update(active=True)
    World.objects.filter(pk=setup["island"].pk).update(active=False)
    assert get(api, setup["t"], "islands", setup["island"].slug).status_code == 404
    assert get(api, setup["t"], "places", setup["place"].slug).status_code == 404


# --- authorization ----------------------------


def test_the_manifest_requires_sign_in(api, setup):
    f = setup["t"].families
    response = api().get(manifest_url(f.a1, "regions", setup["region"].region_id))
    assert response.status_code == 401


def test_a_parent_cannot_read_a_manifest_through_another_familys_child(api, setup):
    services.publish(None)
    f = setup["t"].families
    response = api(f.b).get(manifest_url(f.a1, "regions", setup["region"].region_id))
    assert response.status_code in (403, 404)
    assert "Zinnia" not in response.content.decode()


def test_the_manifest_routes_are_read_only(api, setup):
    f = setup["t"].families
    url = manifest_url(f.a1, "regions", setup["region"].region_id)
    for method in ("post", "put", "patch", "delete"):
        assert getattr(api(f.a), method)(url).status_code == 405


def test_there_is_no_manifest_route_that_takes_a_free_form_path(api, setup):
    f = setup["t"].families
    for evil in ("..%2f..%2fetc", "a/b", "x%3Fy%3D1"):
        response = api(f.a).get(f"/api/v1/children/{f.a1.pk}/audio/manifests/regions/{evil}/")
        assert response.status_code == 404
