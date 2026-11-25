"""Stable delivery identities (ASSET_LIBRARY.md s. 8.1).

A delivery URL is a pure function of the version's canonical identity and the half-TTL window:
the same version in the same window always gets the same URL, a different version never does, and
expiry, publication, retirement and private-object rules are unchanged. Legacy (timestamped)
tokens keep working until their own expiry.
"""

import io
import time
from types import SimpleNamespace

import pytest
from django.core import signing
from django.core.cache import cache
from django.test import Client
from django.urls import reverse

from apps.assets import delivery, preview, services
from apps.assets.storage import MemoryAssetStorage
from apps.assets.tests.helpers import glb_bytes, make_definition, make_version

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

NOW = 1_800_000_000


def publish(asset, **options):
    data = glb_bytes(**options)
    version = services.upload_version(asset, io.BytesIO(data), original_filename="m.glb")
    return services.publish_version(version), data


@pytest.fixture
def pip():
    cache.clear()
    asset = make_definition("npc-pip")
    v1, v1_bytes = publish(asset, clips=("Idle",))
    v2, v2_bytes = publish(asset, clips=("Idle", "Talk"))
    services.set_default_version(v2)
    asset.refresh_from_db()
    return {"asset": asset, "v1": v1, "v2": v2, "v1_bytes": v1_bytes, "v2_bytes": v2_bytes}


def freeze(monkeypatch, at: float) -> None:
    """Fix delivery's clock only; the global clock (JWT checks, the file view) keeps running."""
    monkeypatch.setattr(delivery, "time", SimpleNamespace(time=lambda: at))


def token_of(url: str) -> str:
    return url.rstrip("/").split("/")[-2]


def legacy_token(version, expires: int) -> str:
    """A token as issued before stable URLs (`signing.dumps`, timestamped, the v1 salt)."""
    return signing.dumps({"v": str(version.version_id), "e": expires}, salt=delivery.SALT)


# --- stability ---------------------------------------------------------------------------------


def test_the_same_version_in_the_same_window_always_gets_the_same_url(pip):
    start, _expires = delivery.window(NOW)
    urls = {delivery.deliver(pip["v2"], now=start + offset).url for offset in (0, 1, 2, 899, 1799)}
    assert len(urls) == 1


def test_the_signing_clock_never_reaches_the_url(pip, monkeypatch):
    from django.core.signing import TimestampSigner

    first = delivery.deliver(pip["v2"], now=NOW).url
    monkeypatch.setattr(TimestampSigner, "timestamp", lambda self: "zzzzzz")
    assert delivery.deliver(pip["v2"], now=NOW).url == first


def test_a_new_window_gets_a_new_url_with_a_later_expiry(pip):
    start, expires = delivery.window(NOW)
    here = delivery.deliver(pip["v2"], now=start)
    later = delivery.deliver(pip["v2"], now=start + delivery.ttl() // 2)
    assert later.url != here.url and later.expires_at > here.expires_at == expires


def test_the_url_names_only_the_version_and_the_expiry(pip):
    """No child, family, user or storage key in a URL a browser cache keeps."""
    url = delivery.deliver(pip["v2"], now=NOW).url
    payload = signing.Signer(salt=delivery.STABLE_SALT).unsign_object(token_of(url))
    assert set(payload) == {"v", "e"} and payload["v"] == str(pip["v2"].version_id)
    assert pip["v2"].storage_key not in url
    assert url.endswith("/" + pip["v2"].file_name)


def test_every_child_of_every_family_gets_the_same_url(api, families, pip, monkeypatch):
    freeze(monkeypatch, time.time())
    urls = set()
    for parent, child in ((families.a, families.a1), (families.b, families.b2)):
        response = api(parent).get(f"/api/v1/children/{child.pk}/assets/", {"ids": "npc-pip"})
        assert response.status_code == 200
        urls.add(response.json()["assets"][0]["url"])
    assert len(urls) == 1


# --- identity and invalidation -----------------------------------------------------------------


def test_two_versions_never_share_a_url_or_a_cache_key(pip, api, families):
    one = delivery.deliver(pip["v1"], now=NOW + 5).url
    two = delivery.deliver(pip["v2"], now=NOW + 5).url
    assert one != two
    found = api(families.a).get(
        f"/api/v1/children/{families.a1.pk}/assets/", {"ids": "npc-pip@1,npc-pip@2"}
    )
    keys = {entry["cache"]["key"] for entry in found.json()["assets"]}
    assert keys == {f"npc-pip@{pip['v1'].version_id}", f"npc-pip@{pip['v2'].version_id}"}


def test_replacing_the_default_changes_the_url_and_cache_key_at_once(pip, api, families):
    def current():
        response = api(families.a).get(
            f"/api/v1/children/{families.a1.pk}/assets/", {"ids": "npc-pip"}
        )
        return response.json()["assets"][0]

    before = current()
    v3, v3_bytes = publish(pip["asset"], clips=("Idle", "Wave"))
    services.set_default_version(v3)
    after = current()
    assert after["versionId"] == str(v3.version_id) != before["versionId"]
    assert after["cache"]["key"] != before["cache"]["key"] and after["url"] != before["url"]
    served = Client().get(after["url"])
    assert b"".join(served.streaming_content) == v3_bytes
    # The old URL still names the old, unchanged version: immutable bytes, never the new file.
    old = Client().get(before["url"])
    assert b"".join(old.streaming_content) == pip["v2_bytes"]


def test_rollback_returns_the_earlier_versions_own_url(pip):
    start, _ = delivery.window(NOW)
    v1_url = delivery.deliver(pip["v1"], now=start).url
    services.set_default_version(pip["v1"])
    pip["asset"].refresh_from_db()
    assert delivery.deliver(pip["asset"].default_version, now=start).url == v1_url


def test_a_version_record_alone_cannot_change_what_its_url_serves(pip):
    """The token carries the version id, and the file view checks the name against the version."""
    url = delivery.deliver(pip["v2"], now=int(time.time())).url
    other = url.replace(pip["v2"].file_name, "image.png")
    assert Client().get(other).status_code == 404


# --- security boundaries kept ------------------------------------------------------------------


def test_retiring_the_version_or_the_asset_stops_a_stable_url_at_once(pip):
    url = delivery.deliver(pip["v1"]).url
    assert Client().get(url).status_code == 200
    services.retire_version(pip["v1"])
    assert Client().get(url).status_code == 404
    url2 = delivery.deliver(pip["v2"]).url
    assert Client().get(url2).status_code == 200
    services.retire_asset(pip["asset"])
    assert Client().get(url2).status_code == 404


def test_a_stable_url_expires(pip, monkeypatch):
    issued = delivery.deliver(pip["v2"])
    assert Client().get(issued.url).status_code == 200
    freeze(monkeypatch, issued.expires_at)
    with pytest.raises(delivery.InvalidToken):
        delivery.read_token(token_of(issued.url))
    assert Client().get(issued.url).status_code == 404


def test_a_draft_is_never_served_whatever_the_token(pip):
    draft = make_version(pip["asset"])  # validated, never published
    payload = {"v": str(draft.version_id), "e": 2_000_000_000}
    for token in (
        signing.Signer(salt=delivery.STABLE_SALT).sign_object(payload, compress=False),
        signing.Signer(salt="wrong-salt").sign_object(payload, compress=False),
        signing.dumps(payload, salt=delivery.SALT),
    ):
        assert Client().get(reverse("asset-file", args=[token, "model.glb"])).status_code == 404


@pytest.mark.parametrize(
    "token",
    ["", "x", "a:b", "e30:" + "A" * 27, "!!!!:sig", "eyJ2IjoxfQ:bad", "a" * 400],
)
def test_malformed_tokens_are_invalid_not_errors(token):
    with pytest.raises(delivery.InvalidToken):
        delivery.read_token(token)


def test_a_tampered_stable_token_is_refused(pip):
    token = token_of(delivery.deliver(pip["v2"]).url)
    flipped = token[:-3] + ("A" if token[-3] != "A" else "B") + token[-2:]
    with pytest.raises(delivery.InvalidToken):
        delivery.read_token(flipped)


def test_a_payload_without_an_integer_expiry_is_refused(pip):
    signer = signing.Signer(salt=delivery.STABLE_SALT)
    for payload in ({"v": str(pip["v2"].version_id)}, {"v": "x", "e": "2000000000"}, ["v", 1]):
        with pytest.raises(delivery.InvalidToken):
            delivery.read_token(signer.sign_object(payload, compress=False))


def test_delivery_and_preview_tokens_never_stand_in_for_each_other(pip):
    from apps.catalog.tests.helpers import staff_user

    staff = staff_user()
    stable = token_of(delivery.deliver(pip["v2"]).url)
    with pytest.raises(preview.PreviewRefused):
        preview.check_token(stable, pip["v2"], staff)
    issued = preview.issue_token(pip["v2"], staff)
    with pytest.raises(delivery.InvalidToken):
        delivery.read_token(issued.value)


# --- legacy tokens -----------------------------------------------------------------------------


def test_a_legacy_token_still_serves_until_its_own_expiry(pip, monkeypatch):
    expires = int(time.time()) + 600
    token = legacy_token(pip["v2"], expires)
    assert delivery.read_token(token) == (str(pip["v2"].version_id), expires)
    url = reverse("asset-file", args=[token, pip["v2"].file_name])
    assert Client().get(url).status_code == 200
    freeze(monkeypatch, expires)
    assert Client().get(url).status_code == 404


def test_a_legacy_token_for_a_retired_version_is_refused(pip):
    token = legacy_token(pip["v1"], int(time.time()) + 600)
    services.retire_version(pip["v1"])
    url = reverse("asset-file", args=[token, pip["v1"].file_name])
    assert Client().get(url).status_code == 404


def test_new_urls_are_never_issued_in_the_legacy_format(pip):
    token = token_of(delivery.deliver(pip["v2"]).url)
    with pytest.raises(signing.BadSignature):
        signing.loads(token, salt=delivery.SALT)


# --- s3 ----------------------------------------------------------------------------------------


@pytest.fixture
def presigning(settings, monkeypatch):
    calls = []

    class Presigning(MemoryAssetStorage):
        def presigned_url(self, key, *, expires_in, content_type):
            calls.append(key)
            return f"https://bucket.example/{key}?sig={len(calls)}"

    monkeypatch.setattr(delivery, "get_storage", lambda: Presigning())
    settings.LAI_ASSET_DELIVERY = "s3"
    return calls


def test_s3_urls_are_keyed_by_version_identity(pip, presigning):
    start, _ = delivery.window(NOW)
    one = delivery.deliver(pip["v1"], now=start + 1).url
    two = delivery.deliver(pip["v2"], now=start + 1).url
    assert one != two and len(presigning) == 2
    assert delivery.deliver(pip["v1"], now=start + 100).url == one
    assert delivery.deliver(pip["v2"], now=start + 100).url == two
    assert len(presigning) == 2  # no second presign for either version inside the window


def test_s3_presigns_again_for_a_new_version_and_a_new_window(pip, presigning):
    start, _ = delivery.window(NOW)
    first = delivery.deliver(pip["v2"], now=start + 1).url
    v3, _ = publish(pip["asset"], clips=("Idle", "Jump"))
    assert delivery.deliver(v3, now=start + 1).url != first
    assert delivery.deliver(pip["v2"], now=start + delivery.ttl() // 2).url != first
    assert len(presigning) == 3
