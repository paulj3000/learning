"""AM-6: the child-facing resolver and secure delivery (LAI-2200, ADR-035)."""

import io
import json

import pytest
from django.core.cache import cache
from django.test import Client

from apps.assets import delivery, services
from apps.assets.models import AssetVersion
from apps.assets.storage import MemoryAssetStorage
from apps.assets.tests.helpers import glb_bytes, make_definition

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def url_for(child):
    return f"/api/v1/children/{child.pk}/assets/"


def publish(asset, **options):
    data = glb_bytes(**options)
    version = services.upload_version(asset, io.BytesIO(data), original_filename="m.glb")
    return services.publish_version(version), data


@pytest.fixture
def world(families, cognito):
    cache.clear()
    pip = make_definition("npc-pip")
    v1, v1_bytes = publish(pip, clips=("Idle",))
    v2, v2_bytes = publish(pip, clips=("Idle", "Talk"))
    services.set_default_version(v2)
    chest = make_definition("treasure-chest", kind="prop", category="prop")
    services.upload_version(chest, io.BytesIO(glb_bytes()), original_filename="c.glb")  # draft
    return {
        "pip": pip,
        "v1": v1,
        "v2": v2,
        "v1_bytes": v1_bytes,
        "v2_bytes": v2_bytes,
        "chest": chest,
        "families": families,
    }


def resolve(api, parent, child, ids):
    response = api(parent).get(url_for(child), {"ids": ids})
    return response


def entries(response):
    return {entry["ref"]: entry for entry in response.json()["assets"]}


def test_a_child_scene_resolves_the_default_published_version(api, world):
    f = world["families"]
    response = resolve(api, f.a, f.a1, "npc-pip")
    assert response.status_code == 200 and response["Cache-Control"] == "private, no-cache"
    entry = entries(response)["npc-pip"]
    v2 = world["v2"]
    assert entry["status"] == "resolved" and entry["version"] == 2
    assert entry["versionId"] == str(v2.version_id) and entry["sha256"] == v2.sha256
    assert entry["kind"] == "character" and entry["format"] == "glb"
    assert entry["clips"] == ["Idle", "Talk"] and entry["dimensions"] == v2.dimensions
    assert entry["contentType"] == "model/gltf-binary"
    assert entry["url"].startswith("/api/v1/asset-files/")
    assert entry["cache"] == {"key": f"npc-pip@{v2.version_id}", "immutable": True, "ttl": 3600}


def test_nothing_admin_only_or_storage_related_leaks(api, world):
    f = world["families"]
    body = json.dumps(resolve(api, f.a, f.a1, "npc-pip,treasure-chest").json())
    leaks = ("assets/models/", "storage", "validation", "uploaded", "notes")
    leaks += (world["v2"].storage_key,)
    for secret in leaks:
        assert secret not in body


def test_pins_resolve_older_published_versions(api, world):
    f = world["families"]
    found = entries(resolve(api, f.a, f.a1, "npc-pip@1,npc-pip@2,npc-pip@9"))
    assert found["npc-pip@1"]["version"] == 1 and found["npc-pip@1"]["clips"] == ["Idle"]
    assert found["npc-pip@2"]["version"] == 2
    assert found["npc-pip@9"] == {"ref": "npc-pip@9", "id": "npc-pip", "status": "unavailable"}


def test_drafts_unknown_ids_and_unpublished_pins_are_indistinguishable(api, world):
    f = world["families"]
    found = entries(resolve(api, f.a, f.a1, "treasure-chest,no-such-asset,treasure-chest@1"))
    for ref, entry in found.items():
        assert set(entry) == {"ref", "id", "status"} and entry["status"] == "unavailable", ref


def test_retired_versions_and_assets_resolve_as_retired(api, world):
    f = world["families"]
    services.retire_version(world["v1"])
    assert entries(resolve(api, f.a, f.a1, "npc-pip@1"))["npc-pip@1"]["status"] == "retired"
    assert entries(resolve(api, f.a, f.a1, "npc-pip"))["npc-pip"]["status"] == "resolved"
    services.retire_asset(world["pip"])
    found = entries(resolve(api, f.a, f.a1, "npc-pip,npc-pip@2"))
    assert {e["status"] for e in found.values()} == {"retired"}


def test_one_published_asset_serves_every_family_and_region(api, world):
    f = world["families"]
    a = entries(resolve(api, f.a, f.a1, "npc-pip"))["npc-pip"]
    b = entries(resolve(api, f.b, f.b2, "npc-pip"))["npc-pip"]
    assert (a["versionId"], a["sha256"], a["url"]) == (b["versionId"], b["sha256"], b["url"])
    assert AssetVersion.objects.filter(asset=world["pip"]).count() == 2  # no copy per region


def test_another_family_child_is_a_404_and_auth_is_required(api, world):
    f = world["families"]
    assert resolve(api, f.a, f.b1, "npc-pip").status_code == 404
    assert Client().get(url_for(f.a1), {"ids": "npc-pip"}).status_code == 401
    assert api("sub-never-provisioned").get(url_for(f.a1), {"ids": "npc-pip"}).status_code == 403


@pytest.mark.parametrize(
    "ids",
    ["", "NPC-Pip", "npc-pip@0", "npc-pip@x", "../etc", ",".join(f"a{i}" for i in range(101))],
)
def test_malformed_requests_are_400_in_the_envelope(api, world, ids):
    f = world["families"]
    response = resolve(api, f.a, f.a1, ids)
    assert response.status_code == 400 and "ids" in response.json()["error"]["details"]


def test_the_query_count_does_not_grow_with_the_number_of_ids(
    api, world, django_assert_max_num_queries
):
    f = world["families"]
    for i in range(40):
        make_definition(f"prop-{i}", kind="prop", category="prop")
    many = ",".join([f"prop-{i}" for i in range(40)] + ["npc-pip", "npc-pip@1"])
    client = api(f.a)
    client.get(url_for(f.a1), {"ids": "npc-pip"})  # warm the JWKS cache
    with django_assert_max_num_queries(6):
        assert client.get(url_for(f.a1), {"ids": many}).status_code == 200


# --- delivery ----------------------------------------------------------------------------------


def test_the_delivery_url_serves_the_immutable_bytes(api, world):
    f = world["families"]
    entry = entries(resolve(api, f.a, f.a1, "npc-pip"))["npc-pip"]
    response = Client().get(entry["url"])  # no bearer token: the URL authorizes itself
    assert response.status_code == 200
    assert b"".join(response.streaming_content) == world["v2_bytes"]
    assert response["Content-Type"] == "model/gltf-binary"
    assert response["ETag"] == f'"{world["v2"].sha256}"'
    assert response["Cache-Control"].startswith("private")
    assert "immutable" in response["Cache-Control"]
    again = Client().get(entry["url"], HTTP_IF_NONE_MATCH=response["ETag"])
    assert again.status_code == 304


def test_retiring_revokes_django_delivery_immediately(api, world):
    f = world["families"]
    url = entries(resolve(api, f.a, f.a1, "npc-pip@1"))["npc-pip@1"]["url"]
    assert Client().get(url).status_code == 200
    services.retire_version(world["v1"])
    assert Client().get(url).status_code == 404


def test_a_draft_cannot_be_fetched_even_with_a_forged_token(world):
    from django.core import signing
    from django.urls import reverse

    draft = AssetVersion.objects.get(asset=world["chest"])
    forged = signing.dumps({"v": str(draft.version_id), "e": 2_000_000_000}, salt="wrong-salt")
    signed = signing.dumps({"v": str(draft.version_id), "e": 2_000_000_000}, salt=delivery.SALT)
    for token in (forged, signed, "not-a-token"):
        assert Client().get(reverse("asset-file", args=[token, "model.glb"])).status_code == 404


def test_expired_tampered_and_misnamed_urls_are_404(api, world, monkeypatch):
    f = world["families"]
    url = entries(resolve(api, f.a, f.a1, "npc-pip"))["npc-pip"]["url"]
    assert Client().get(url.replace("model.glb", "model.gltf")).status_code == 404
    assert Client().get(url[:-15] + "x" + url[-14:]).status_code == 404
    monkeypatch.setattr(delivery.time, "time", lambda: 10**10)
    assert Client().get(url).status_code == 404


def test_urls_are_stable_within_a_window_for_browser_caching(world):
    v2 = world["v2"]
    start, expires = delivery.window(1_800_000_000)
    assert expires - 1_800_000_000 >= delivery.ttl() // 2
    first = delivery.deliver(v2, now=start + 1)
    assert delivery.deliver(v2, now=start + 1700).url == first.url
    assert delivery.deliver(v2, now=start + 1800 + 1).url != first.url


def test_s3_delivery_presigns_the_private_object_and_reuses_it(settings, world, monkeypatch):
    calls = []

    class Presigning(MemoryAssetStorage):
        def presigned_url(self, key, *, expires_in, content_type):
            calls.append((key, expires_in, content_type))
            return f"https://bucket.example/{key}?sig={len(calls)}"

    monkeypatch.setattr(delivery, "get_storage", lambda: Presigning())
    settings.LAI_ASSET_DELIVERY = "s3"
    v2 = world["v2"]
    first = delivery.deliver(v2, now=1_800_000_001)
    assert first.url.startswith("https://bucket.example/assets/models/npc-pip/")
    assert delivery.deliver(v2, now=1_800_000_500).url == first.url and len(calls) == 1
    assert calls[0][1] >= delivery.ttl() // 2 and calls[0][2] == "model/gltf-binary"
