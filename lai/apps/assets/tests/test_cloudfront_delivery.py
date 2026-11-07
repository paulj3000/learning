"""AM-11: signed CloudFront delivery (docs/ASSET_LIBRARY.md section 8.1).

No AWS call: the key pair is generated per run and each signature is checked against the
public key using CloudFront's documented canned-policy format, so the test does not merely trust
the signer that produced it.
"""

import base64
import io
import json
from urllib.parse import parse_qs, urlsplit

import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured

from apps.assets import delivery, services
from apps.assets.tests.helpers import glb_bytes, make_definition

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

DOMAIN = "d111111abcdef8.cloudfront.net"
KEY_ID = "K2JCJMDEHXQW5F"


def _b64_pem(key) -> str:
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return base64.b64encode(pem).decode()


@pytest.fixture(scope="module")
def key_pair():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def cloudfront(settings, key_pair):
    delivery._cloudfront_signer.cache_clear()
    settings.LAI_ASSET_DELIVERY = "cloudfront"
    settings.LAI_ASSET_CLOUDFRONT_DOMAIN = DOMAIN
    settings.LAI_ASSET_CLOUDFRONT_KEY_PAIR_ID = KEY_ID
    settings.LAI_ASSET_CLOUDFRONT_PRIVATE_KEY_B64 = _b64_pem(key_pair)
    yield settings
    delivery._cloudfront_signer.cache_clear()


@pytest.fixture
def published():
    cache.clear()
    pip = make_definition("npc-pip")
    version = services.upload_version(
        pip, io.BytesIO(glb_bytes(clips=("Idle",))), original_filename="m.glb"
    )
    return services.publish_version(version)


def _cloudfront_b64decode(value: str) -> bytes:
    return base64.b64decode(value.replace("-", "+").replace("_", "=").replace("~", "/"))


def assert_valid_canned_signature(url: str, public_key, *, expires: int) -> None:
    parts = urlsplit(url)
    query = parse_qs(parts.query, strict_parsing=True)
    assert set(query) == {"Expires", "Signature", "Key-Pair-Id"}
    assert query["Key-Pair-Id"] == [KEY_ID] and query["Expires"] == [str(expires)]
    resource = f"{parts.scheme}://{parts.netloc}{parts.path}"
    policy = json.dumps(
        {
            "Statement": [
                {"Resource": resource, "Condition": {"DateLessThan": {"AWS:EpochTime": expires}}}
            ]
        },
        separators=(",", ":"),
    ).encode()
    public_key.verify(
        _cloudfront_b64decode(query["Signature"][0]),
        policy,
        padding.PKCS1v15(),
        hashes.SHA1(),  # noqa: S303 (CloudFront canned policies)
    )


def test_cloudfront_urls_point_at_the_object_and_carry_a_valid_signature(
    cloudfront, published, key_pair
):
    result = delivery.deliver(published, now=1_800_000_001)
    parts = urlsplit(result.url)
    assert parts.scheme == "https" and parts.netloc == DOMAIN
    assert parts.path == "/" + published.storage_key
    assert published.storage_key.startswith("assets/models/npc-pip/")
    assert_valid_canned_signature(result.url, key_pair.public_key(), expires=result.expires_at)


def test_a_signature_for_one_object_does_not_cover_another(cloudfront, published, key_pair):
    url = delivery.deliver(published, now=1_800_000_001).url
    other = url.replace(published.storage_key, "assets/models/npc-pip/other.glb")
    with pytest.raises(InvalidSignature):
        assert_valid_canned_signature(
            other, key_pair.public_key(), expires=int(parse_qs(urlsplit(url).query)["Expires"][0])
        )


def test_urls_are_stable_within_a_window_and_change_after_it(cloudfront, published):
    first = delivery.deliver(published, now=1_800_000_001)
    assert delivery.deliver(published, now=1_800_000_900) == first
    assert first.expires_at - 1_800_000_900 >= delivery.ttl() // 2
    later = delivery.deliver(published, now=1_800_000_001 + delivery.ttl())
    assert later.url != first.url and later.expires_at > first.expires_at


def test_the_resolver_returns_signed_cloudfront_urls(cloudfront, published, api, families, cognito):
    response = api(families.a).get(f"/api/v1/children/{families.a1.pk}/assets/", {"ids": "npc-pip"})
    assert response.status_code == 200
    (entry,) = response.json()["assets"]
    assert entry["status"] == "resolved"
    assert entry["url"].startswith(f"https://{DOMAIN}/assets/models/npc-pip/")
    assert "Signature=" in entry["url"] and f"Key-Pair-Id={KEY_ID}" in entry["url"]
    # Nothing about the key itself reaches the child.
    assert cloudfront.LAI_ASSET_CLOUDFRONT_PRIVATE_KEY_B64 not in response.content.decode()


@pytest.mark.parametrize(
    "value",
    [
        "not base64!",
        base64.b64encode(
            b"-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----\n"
        ).decode(),
    ],
)
def test_an_unreadable_key_fails_without_echoing_it(cloudfront, published, value):
    cloudfront.LAI_ASSET_CLOUDFRONT_PRIVATE_KEY_B64 = value
    with pytest.raises(ImproperlyConfigured) as error:
        delivery.deliver(published)
    assert value not in str(error.value)


def test_only_rsa_keys_of_2048_bits_or_more_are_accepted(cloudfront, published):
    cloudfront.LAI_ASSET_CLOUDFRONT_PRIVATE_KEY_B64 = _b64_pem(
        ec.generate_private_key(ec.SECP256R1())
    )
    with pytest.raises(ImproperlyConfigured, match="RSA"):
        delivery.deliver(published)
    delivery._cloudfront_signer.cache_clear()
    small = rsa.generate_private_key(public_exponent=65537, key_size=1024)  # noqa: S505 (refused below)
    cloudfront.LAI_ASSET_CLOUDFRONT_PRIVATE_KEY_B64 = _b64_pem(small)
    with pytest.raises(ImproperlyConfigured, match="2048"):
        delivery.deliver(published)
