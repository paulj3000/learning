"""SM-P8-LIVE: the S3 speech store against botocore's Stubber, and scope-prefixed keys."""

import io

import boto3
import pytest
from botocore.response import StreamingBody
from botocore.stub import Stubber

from apps.speech.storage import (
    MemorySpeechStorage,
    S3SpeechStorage,
    SpeechStorageError,
    get_speech_storage,
    reset_speech_storage_cache,
    storage_key,
)

HASH = "ab" + "0" * 62
SHARED = f"speech/shared/ab/{HASH}.mp3"
CHILD = f"speech/child/ab/{HASH}.mp3"
LEGACY = f"speech/ab/{HASH}.mp3"


def _s3():
    return boto3.client(
        "s3",
        region_name="eu-west-2",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",  # noqa: S106 - stubbed, never sent
    )


class TestKeys:
    def test_keys_are_scoped_and_hash_only(self):
        assert storage_key(HASH) == SHARED
        assert storage_key(HASH, "authored") == SHARED
        assert storage_key(HASH, "child") == CHILD

    @pytest.mark.parametrize("bad", ["not-a-hash", "AB" + "0" * 62, "0" * 63])
    def test_a_key_is_made_only_from_a_hash(self, bad):
        with pytest.raises(ValueError):
            storage_key(bad)

    def test_an_unknown_scope_is_refused(self):
        with pytest.raises(ValueError):
            storage_key(HASH, "public")

    @pytest.mark.parametrize("key", [SHARED, CHILD, LEGACY])
    def test_new_and_legacy_keys_are_readable(self, key):
        store = MemorySpeechStorage()
        store.put(key, b"ID3")
        assert store.read(key) == b"ID3"

    @pytest.mark.parametrize(
        "key", ["speech/other/ab/x.mp3", "../etc/passwd", f"speech/public/ab/{HASH}.mp3"]
    )
    def test_anything_else_is_refused(self, key):
        with pytest.raises(SpeechStorageError):
            MemorySpeechStorage().put(key, b"x")


class TestS3:
    def test_put_is_private_encrypted_and_typed(self):
        raw = _s3()
        with Stubber(raw) as stub:
            stub.add_response(
                "put_object",
                {},
                {
                    "Bucket": "speech-bucket",
                    "Key": SHARED,
                    "Body": b"ID3data",
                    "ContentType": "audio/mpeg",
                    "ServerSideEncryption": "AES256",
                },
            )
            S3SpeechStorage("speech-bucket", raw).put(SHARED, b"ID3data")
            stub.assert_no_pending_responses()

    def test_reads_back_and_deletes(self):
        raw = _s3()
        with Stubber(raw) as stub:
            stub.add_response(
                "get_object",
                {"Body": StreamingBody(io.BytesIO(b"ID3data"), 7)},
                {"Bucket": "speech-bucket", "Key": CHILD},
            )
            stub.add_response("delete_object", {}, {"Bucket": "speech-bucket", "Key": CHILD})
            store = S3SpeechStorage("speech-bucket", raw)
            assert store.read(CHILD) == b"ID3data"
            store.delete(CHILD)

    @pytest.mark.parametrize("operation", ["put_object", "get_object", "delete_object"])
    def test_failures_are_storage_errors_that_carry_nothing(self, operation):
        raw = _s3()
        store = S3SpeechStorage("speech-bucket", raw)
        with Stubber(raw) as stub:
            stub.add_client_error(operation, "AccessDenied", "arn:aws:iam::1:role/secret")
            with pytest.raises(SpeechStorageError) as err:
                {
                    "put_object": lambda: store.put(SHARED, b"x"),
                    "get_object": lambda: store.read(SHARED),
                    "delete_object": lambda: store.delete(SHARED),
                }[operation]()
        assert "arn" not in str(err.value) and SHARED not in str(err.value)

    def test_presigned_urls_are_https_sigv4_in_the_region_and_uncached(self):
        url = S3SpeechStorage("speech-bucket", _s3()).presigned_url(SHARED, expires_in=300)
        assert url.startswith("https://") and "eu-west-2" in url
        assert "X-Amz-Expires=300" in url and "audio%2Fmpeg" in url and "no-store" in url

    def test_a_signing_failure_is_a_storage_error(self):
        class Broken:
            def generate_presigned_url(self, *args, **kwargs):
                raise RuntimeError("no credentials")

        with pytest.raises(SpeechStorageError):
            S3SpeechStorage("speech-bucket", Broken()).presigned_url(SHARED, expires_in=60)

    def test_the_real_client_uses_the_speech_region_and_sigv4(self, settings):
        settings.LAI_SPEECH_STORAGE = "s3"
        settings.LAI_SPEECH_BUCKET = "speech-bucket"
        settings.LAI_SPEECH_S3_REGION = "ap-southeast-2"
        reset_speech_storage_cache()
        store = get_speech_storage()
        assert isinstance(store, S3SpeechStorage)
        client = store._s3()  # noqa: SLF001
        assert client.meta.region_name == "ap-southeast-2"
        assert client.meta.config.signature_version == "s3v4"
        reset_speech_storage_cache()
