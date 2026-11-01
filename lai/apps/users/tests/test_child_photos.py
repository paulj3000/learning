"""Child profile photos (LAI-0904, ADR-042; docs/platform/CHILD_PHOTO_STORAGE.md).

Validation and storage-adapter tests need no database. API tests use the tenant-isolation harness
(`families`, `api` in lai/conftest.py) and the in-memory photo store; nothing contacts AWS. The
JPEG fixtures were made once with an image tool and carry EXIF (camera make, GPS), XMP and a
comment, so the tests can prove none of it is stored.
"""

import hashlib
import io
import logging
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from django.core.management import call_command
from django.db import IntegrityError

from apps.users import photos
from apps.users.models import ChildPhoto, ChildPhotoStatus
from apps.users.photo_storage import (
    KEY_PREFIX,
    LocalPhotoStorage,
    MemoryPhotoStorage,
    PhotoObjectExists,
    PhotoObjectMissing,
    PhotoStorageError,
    PhotoStorageUnavailable,
    S3PhotoStorage,
    get_photo_storage,
    parse_key,
    photo_key,
    reset_photo_storage_cache,
)
from apps.users.photo_validation import PhotoRejected, check_content_type, clean_jpeg

FIXTURES = Path(__file__).parent / "fixtures"
EXIF_JPEG = (FIXTURES / "photo_exif.jpg").read_bytes()
PROGRESSIVE_JPEG = (FIXTURES / "photo_progressive.jpg").read_bytes()
GRAY_JPEG = (FIXTURES / "photo_gray.jpg").read_bytes()
PNG = (FIXTURES / "photo.png").read_bytes()
METADATA_MARKERS = [b"Exif", b"SecretCam", b"SECRET-COMMENT", b"xmpmeta", b"SecretTown"]


@pytest.fixture(autouse=True)
def fresh_photo_store():
    reset_photo_storage_cache()
    yield
    reset_photo_storage_cache()


def store() -> MemoryPhotoStorage:
    storage = get_photo_storage()
    assert isinstance(storage, MemoryPhotoStorage)
    return storage


# --- validation: the bytes, not the label -------------------------------------------------------


def test_metadata_is_removed_and_the_image_is_kept():
    assert all(marker in EXIF_JPEG for marker in METADATA_MARKERS)
    clean = clean_jpeg(EXIF_JPEG, max_dimension=1024)
    assert (clean.width, clean.height) == (24, 16)
    assert not any(marker in clean.data for marker in METADATA_MARKERS)
    assert clean.data.startswith(b"\xff\xd8") and clean.data.endswith(b"\xff\xd9")
    assert clean_jpeg(clean.data, max_dimension=1024).data == clean.data  # idempotent


@pytest.mark.parametrize("jpeg", [PROGRESSIVE_JPEG, GRAY_JPEG], ids=["progressive", "gray"])
def test_progressive_restart_marked_and_grayscale_jpegs_are_accepted(jpeg):
    assert clean_jpeg(jpeg, max_dimension=1024).data == jpeg  # nothing to strip


def _with_frame_byte(offset: int, value: int) -> bytes:
    data = bytearray(EXIF_JPEG)
    sof = data.index(b"\xff\xc0")
    data[sof + offset] = value
    return bytes(data)


@pytest.mark.parametrize(
    "data, code",
    [
        (PNG, "photo_type_unsupported"),
        (b"GIF89a" + b"\0" * 40, "photo_type_unsupported"),
        (b"\xff\xd8\xff\xd9", "photo_invalid"),  # no image data
        (EXIF_JPEG[:-40], "photo_invalid"),  # truncated
        (EXIF_JPEG + b"<?php evil();", "photo_invalid"),  # payload after the image
        (EXIF_JPEG[:2] + b"\x00" * 64, "photo_invalid"),
        (_with_frame_byte(4, 12), "photo_invalid"),  # 12-bit precision
        (_with_frame_byte(1, 0xC3), "photo_type_unsupported"),  # lossless frame
    ],
    ids=["png", "gif", "empty-scan", "truncated", "trailing", "garbage", "12-bit", "lossless"],
)
def test_anything_but_a_complete_8_bit_jpeg_is_rejected(data, code):
    with pytest.raises(PhotoRejected) as raised:
        clean_jpeg(data, max_dimension=1024)
    assert raised.value.code == code


def test_dimensions_are_capped():
    with pytest.raises(PhotoRejected) as raised:
        clean_jpeg(EXIF_JPEG, max_dimension=20)  # the fixture is 24 x 16
    assert raised.value.code == "photo_dimensions"


@pytest.mark.parametrize("declared", ["image/png", "text/html", "", "application/octet-stream"])
def test_the_declared_type_must_be_jpeg(declared):
    with pytest.raises(PhotoRejected):
        check_content_type(declared)
    check_content_type("image/jpeg")
    check_content_type("IMAGE/JPEG; charset=binary")


# --- storage keys and adapters ------------------------------------------------------------------


def test_keys_are_two_uuids_under_children_and_nothing_else():
    child, photo = uuid.uuid4(), uuid.uuid4()
    key = photo_key(child, photo)
    assert key == f"children/{child}/{photo}"
    assert parse_key(key) == (child, photo)
    with pytest.raises(ValueError):
        photo_key("Zinnia", photo)  # type: ignore[arg-type]
    for bad in [
        f"children/{child}/../{photo}",
        f"assets/models/{child}/{photo}",
        f"children/{child}/{photo}.jpg",
        f"/children/{child}/{photo}",
        "children/zinnia/photo",
    ]:
        assert parse_key(bad) is None
        with pytest.raises(PhotoStorageError):
            MemoryPhotoStorage().put(bad, b"x", sha256=hashlib.sha256(b"x").hexdigest())


def test_memory_and_local_stores_never_overwrite_and_check_the_checksum(tmp_path):
    key = photo_key(uuid.uuid4(), uuid.uuid4())
    digest = hashlib.sha256(b"photo").hexdigest()
    for storage in (MemoryPhotoStorage(), LocalPhotoStorage(tmp_path)):
        storage.put(key, b"photo", sha256=digest)
        with pytest.raises(PhotoObjectExists):
            storage.put(key, b"other", sha256=hashlib.sha256(b"other").hexdigest())
        with pytest.raises(PhotoStorageError, match="Checksum"):
            storage.put(photo_key(uuid.uuid4(), uuid.uuid4()), b"photo", sha256="0" * 64)
        assert storage.read(key) == b"photo"
        assert [item.key for item in storage.list()] == [key]
        assert storage.presigned_url(key, expires_in=60) is None
        storage.delete(key)
        storage.delete(key)  # idempotent
        with pytest.raises(PhotoObjectMissing):
            storage.read(key)


class StubS3:
    """Records boto3 calls; `errors` maps an operation to the ClientError code it raises."""

    def __init__(self, errors=None):
        self.calls: list[tuple[str, dict]] = []
        self.errors = errors or {}

    def _call(self, name, params):
        from botocore.exceptions import ClientError

        self.calls.append((name, params))
        if name in self.errors:
            raise ClientError({"Error": {"Code": self.errors[name]}}, name)

    def put_object(self, **params):
        self._call("put_object", params)

    def get_object(self, **params):
        self._call("get_object", params)
        return {"Body": io.BytesIO(b"bytes")}

    def delete_object(self, **params):
        self._call("delete_object", params)

    def list_objects_v2(self, **params):
        self._call("list_objects_v2", params)
        return {"Contents": [], "IsTruncated": False}

    def generate_presigned_url(self, operation, Params, ExpiresIn):  # noqa: N803
        self.calls.append((operation, {**Params, "ExpiresIn": ExpiresIn}))
        return f"https://bucket.s3.example/{Params['Key']}?X-Amz-Expires={ExpiresIn}"


def test_s3_writes_are_checksummed_conditional_private_and_jpeg_only():
    client = StubS3()
    storage = S3PhotoStorage("lai-child-photos-test", "us-test-1", client=client)
    key = photo_key(uuid.uuid4(), uuid.uuid4())
    storage.put(key, b"photo", sha256=hashlib.sha256(b"photo").hexdigest())
    name, params = client.calls[-1]
    assert name == "put_object"
    assert params["Bucket"] == "lai-child-photos-test" and params["Key"] == key
    assert params["IfNoneMatch"] == "*"
    assert params["ContentType"] == "image/jpeg"
    assert params["CacheControl"] == "private, no-store"
    assert params["ChecksumSHA256"]
    assert "ACL" not in params  # the bucket enforces owner-only ownership
    storage.list()
    assert all(
        call[1]["Prefix"] == KEY_PREFIX for call in client.calls if call[0] == "list_objects_v2"
    )


def test_s3_presigned_urls_are_short_lived_get_only():
    client = StubS3()
    storage = S3PhotoStorage("lai-child-photos-test", "us-test-1", client=client)
    key = photo_key(uuid.uuid4(), uuid.uuid4())
    url = storage.presigned_url(key, expires_in=300)
    operation, params = client.calls[-1]
    assert operation == "get_object" and params["ExpiresIn"] == 300
    assert params["ResponseCacheControl"] == "private, max-age=300"
    assert params["ResponseContentType"] == "image/jpeg"
    assert key in url
    with pytest.raises(PhotoStorageError):
        storage.presigned_url("assets/models/x/y/model.glb", expires_in=300)


@pytest.mark.parametrize(
    "code, error",
    [
        ("PreconditionFailed", PhotoObjectExists),
        ("NoSuchKey", PhotoObjectMissing),
        ("AccessDenied", PhotoStorageError),
    ],
)
def test_s3_errors_are_mapped_and_never_name_the_key(code, error):
    key = photo_key(uuid.uuid4(), uuid.uuid4())
    operation = "get_object" if error is PhotoObjectMissing else "put_object"
    storage = S3PhotoStorage("b", "r", client=StubS3({operation: code}))
    with pytest.raises(error) as raised:
        if operation == "get_object":
            storage.read(key)
        else:
            storage.put(key, b"x", sha256=hashlib.sha256(b"x").hexdigest())
    assert key not in str(raised.value) and str(parse_key(key)[0]) not in str(raised.value)


def test_disabled_storage_refuses_everything(settings):
    settings.LAI_CHILD_PHOTO_STORAGE = "disabled"
    storage = get_photo_storage()
    with pytest.raises(PhotoStorageUnavailable):
        storage.put(photo_key(uuid.uuid4(), uuid.uuid4()), b"x", sha256="0" * 64)
    assert list(storage.list()) == []


# --- the API ------------------------------------------------------------------------------------


def photo_url(child, suffix=""):
    return f"/api/v1/children/{child.pk}/photo/{suffix}"


def upload(client, child, data=EXIF_JPEG, content_type="image/jpeg"):
    return client.put(photo_url(child), data=data, content_type=content_type)


@pytest.fixture
def committed(django_capture_on_commit_callbacks):
    """`with committed(): ...` runs the after-commit object deletes as a real request does.

    Tests run inside a transaction that never commits, so after-commit work must be released.
    """
    return lambda: django_capture_on_commit_callbacks(execute=True)


@pytest.mark.postgres
@pytest.mark.django_db
class TestPhotoApi:
    def test_a_parent_uploads_and_reads_a_photo_for_their_own_child(self, families, api):
        client = api(families.a)
        response = upload(client, families.a1)
        assert response.status_code == 200, response.content
        body = response.json()["photo"]
        assert (body["width"], body["height"], body["contentType"]) == (24, 16, "image/jpeg")
        assert body["delivery"] == "api" and body["urlExpiresAt"] is None
        assert body["url"].endswith(f"/api/v1/children/{families.a1.pk}/photo/content/")
        # The storage key never leaves the server.
        assert "children/" not in response.content.decode().replace("/api/v1/children/", "")

        photo = ChildPhoto.objects.get(child=families.a1)
        assert str(photo.pk) == body["id"] and photo.status == ChildPhotoStatus.CURRENT
        assert photo.storage_key == f"children/{families.a1.pk}/{photo.pk}"
        stored = store().read(photo.storage_key)
        assert not any(marker in stored for marker in METADATA_MARKERS)
        assert photo.sha256 == hashlib.sha256(stored).hexdigest()
        assert photo.byte_size == len(stored)

        assert response["Cache-Control"] == "private, no-store"  # it carries a fresh URL
        fetched = client.get(photo_url(families.a1))
        assert fetched.json()["photo"]["id"] == body["id"]
        assert fetched["Cache-Control"] == "private, no-store"
        content = client.get(photo_url(families.a1, "content/"), HTTP_ACCEPT="image/*")
        assert content.status_code == 200 and content.content == stored
        assert content["Content-Type"] == "image/jpeg"
        assert content["Cache-Control"] == "private, no-store"
        assert content["X-Content-Type-Options"] == "nosniff"

    def test_has_photo_reflects_the_current_photo(self, families, api):
        client = api(families.a)

        def listed():
            children = client.get("/api/v1/children/").json()["children"]
            return {child["id"]: child["hasPhoto"] for child in children}

        assert listed() == {str(families.a1.pk): False, str(families.a2.pk): False}
        upload(client, families.a1)
        assert listed() == {str(families.a1.pk): True, str(families.a2.pk): False}
        assert client.get(f"/api/v1/children/{families.a1.pk}/").json()["hasPhoto"] is True

    @pytest.mark.parametrize("method", ["get", "put", "delete", "content"])
    def test_another_familys_child_is_indistinguishable_from_an_unknown_one(
        self, families, api, method
    ):
        upload(api(families.b), families.b1)
        before = dict(store().objects)
        client = api(families.a)

        def call(child_path):
            if method == "put":
                return client.put(child_path, data=EXIF_JPEG, content_type="image/jpeg")
            if method == "content":
                return client.get(child_path + "content/")
            return getattr(client, method)(child_path)

        foreign = call(f"/api/v1/children/{families.b1.pk}/photo/")
        unknown = call(f"/api/v1/children/{uuid.uuid4()}/photo/")
        assert foreign.status_code == unknown.status_code == 404
        assert foreign.json()["error"]["code"] == unknown.json()["error"]["code"] == "not_found"
        assert dict(store().objects) == before  # nothing written, nothing deleted
        assert ChildPhoto.objects.get(child=families.b1).status == ChildPhotoStatus.CURRENT

    def test_unauthenticated_callers_get_nothing(self, families, api):
        upload(api(families.a), families.a1)
        for response in (
            api().get(photo_url(families.a1)),
            api().get(photo_url(families.a1, "content/")),
            upload(api(), families.a1),
            api().delete(photo_url(families.a1)),
        ):
            assert response.status_code == 401
        assert ChildPhoto.objects.filter(child=families.a1).count() == 1

    @pytest.mark.parametrize(
        "data, content_type, status, code",
        [
            (PNG, "image/png", 415, "photo_type_unsupported"),
            (PNG, "image/jpeg", 415, "photo_type_unsupported"),  # mislabelled
            (EXIF_JPEG, "text/plain", 415, "photo_type_unsupported"),
            (EXIF_JPEG[:-40], "image/jpeg", 400, "photo_invalid"),
            (EXIF_JPEG + b"payload", "image/jpeg", 400, "photo_invalid"),
            (b"", "image/jpeg", 400, "photo_invalid"),
        ],
        ids=["png", "mislabelled-png", "text", "truncated", "trailing", "empty"],
    )
    def test_unsupported_and_invalid_uploads_are_rejected_and_nothing_is_stored(
        self, families, api, data, content_type, status, code
    ):
        response = upload(api(families.a), families.a1, data, content_type)
        assert response.status_code == status
        assert response.json()["error"]["code"] == code
        assert store().objects == {} and not ChildPhoto.objects.exists()

    def test_size_and_dimension_limits_are_configurable(self, families, api, settings):
        client = api(families.a)
        settings.LAI_CHILD_PHOTO_MAX_BYTES = len(EXIF_JPEG) - 1
        response = upload(client, families.a1)
        assert response.status_code == 413
        assert response.json()["error"]["code"] == "photo_too_large"
        settings.LAI_CHILD_PHOTO_MAX_BYTES = 1024 * 1024
        settings.LAI_CHILD_PHOTO_MAX_DIMENSION = 16
        response = upload(client, families.a1)
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "photo_dimensions"
        assert store().objects == {} and not ChildPhoto.objects.exists()

    def test_replacing_a_photo_deletes_the_old_object(self, families, api, committed):
        client = api(families.a)
        first = upload(client, families.a1).json()["photo"]["id"]
        old_key = ChildPhoto.objects.get(pk=first).storage_key
        with committed():
            second = upload(client, families.a1, PROGRESSIVE_JPEG).json()["photo"]["id"]
        assert first != second
        assert list(ChildPhoto.objects.filter(child=families.a1).values_list("id", "status")) == [
            (uuid.UUID(second), ChildPhotoStatus.CURRENT)
        ]
        assert old_key not in store().objects
        assert list(store().objects) == [ChildPhoto.objects.get(pk=second).storage_key]

    def test_deleting_a_photo_removes_row_and_object(self, families, api, committed):
        client = api(families.a)
        upload(client, families.a1)
        with committed():
            assert client.delete(photo_url(families.a1)).status_code == 204
        assert client.get(photo_url(families.a1)).json() == {"photo": None}
        assert client.get(photo_url(families.a1, "content/")).status_code == 404
        assert store().objects == {} and not ChildPhoto.objects.exists()
        assert client.delete(photo_url(families.a1)).status_code == 204  # idempotent

    def test_an_s3_write_failure_changes_nothing(self, families, api):
        client = api(families.a)
        original = upload(client, families.a1).json()["photo"]["id"]
        before = dict(store().objects)
        store().fail_next.add("put")
        response = upload(client, families.a1, PROGRESSIVE_JPEG)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "photo_storage_unavailable"
        assert dict(store().objects) == before
        assert client.get(photo_url(families.a1)).json()["photo"]["id"] == original

    def test_a_database_failure_after_the_write_removes_the_new_object(self, families, monkeypatch):
        def fail(*args, **kwargs):
            raise IntegrityError("simulated")

        monkeypatch.setattr(ChildPhoto.objects, "create", fail)
        with pytest.raises(IntegrityError):
            photos.replace_photo(families.a, families.a1.pk, EXIF_JPEG, "image/jpeg")
        assert store().objects == {} and not ChildPhoto.objects.exists()

    def test_a_failed_object_delete_is_never_served_and_is_retried(
        self, families, api, committed, caplog
    ):
        client = api(families.a)
        upload(client, families.a1)
        store().fail_next.add("delete")
        with caplog.at_level(logging.WARNING), committed():
            assert client.delete(photo_url(families.a1)).status_code == 204
        assert client.get(photo_url(families.a1)).json() == {"photo": None}
        row = ChildPhoto.objects.get(child=families.a1)
        assert row.status == ChildPhotoStatus.DELETING and row.storage_key in store().objects
        photo_logs = [r for r in caplog.records if r.name == "apps.users.photos"]
        assert [r.getMessage() for r in photo_logs] == ["child photo delete deferred"]
        logged = " ".join(f"{r.getMessage()} {r.__dict__}" for r in photo_logs)
        assert str(families.a1.pk) not in logged and row.storage_key not in logged

        out = io.StringIO()
        call_command("child_photo_storage_audit", "--delete", stdout=out)
        assert "deleting rows purged: 1" in out.getvalue()
        assert store().objects == {} and not ChildPhoto.objects.exists()

    def test_presigned_urls_for_s3(self, families, api, monkeypatch, settings):
        client = api(families.a)
        upload(client, families.a1)
        memory = store()
        stub = StubS3()
        s3 = S3PhotoStorage("lai-child-photos-test", "us-test-1", client=stub)
        monkeypatch.setattr(photos, "get_photo_storage", lambda: s3)
        settings.LAI_CHILD_PHOTO_URL_TTL_SECONDS = 120
        body = client.get(photo_url(families.a1)).json()["photo"]
        assert body["delivery"] == "presigned"
        assert body["url"].startswith("https://bucket.s3.example/children/")
        expires = datetime.fromisoformat(body["urlExpiresAt"])
        assert timedelta(seconds=100) < expires - datetime.now(UTC) <= timedelta(seconds=120)
        assert stub.calls[-1][1]["ExpiresIn"] == 120
        assert memory.objects  # untouched

    def test_disabled_storage_answers_503_but_still_lets_a_parent_remove_a_photo(
        self, families, api, settings
    ):
        client = api(families.a)
        upload(client, families.a1)
        settings.LAI_CHILD_PHOTO_STORAGE = "disabled"
        assert upload(client, families.a1).status_code == 503
        assert client.get(photo_url(families.a1)).status_code == 503
        assert client.get(photo_url(families.a2)).json() == {"photo": None}
        assert client.delete(photo_url(families.a1)).status_code == 204
        assert client.get(photo_url(families.a1)).json() == {"photo": None}

    def test_old_orphans_are_removed_only_with_delete(self, families, api):
        upload(api(families.a), families.a1)
        old = photo_key(uuid.uuid4(), uuid.uuid4())
        young = photo_key(uuid.uuid4(), uuid.uuid4())
        store().objects[old] = (b"x", datetime.now(UTC) - timedelta(days=1))
        store().objects[young] = (b"x", datetime.now(UTC))

        out = io.StringIO()
        call_command("child_photo_storage_audit", stdout=out)
        report = out.getvalue()
        assert "orphan objects: 1" in report and "orphans too recent to judge: 1" in report
        assert old in store().objects
        assert old not in report and "children/" not in report  # counts only

        call_command("child_photo_storage_audit", "--delete", stdout=io.StringIO())
        assert old not in store().objects and young in store().objects
        assert ChildPhoto.objects.get(child=families.a1).storage_key in store().objects

    def test_child_deletion_hook_removes_every_object(self, families, api, committed):
        upload(api(families.a), families.a1)
        with committed():
            assert photos.delete_all_child_photos(families.a1) is True
        assert store().objects == {} and not ChildPhoto.objects.exists()

    def test_one_current_photo_per_child_is_a_database_rule(self, families):
        def row():
            return ChildPhoto(
                child=families.a1,
                storage_key=photo_key(families.a1.pk, uuid.uuid4()),
                byte_size=1,
                sha256="0" * 64,
                width=1,
                height=1,
            )

        row().save()
        with pytest.raises(IntegrityError):
            row().save()
