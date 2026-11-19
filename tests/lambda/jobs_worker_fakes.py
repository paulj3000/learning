"""Fake AWS clients and sample files for the jobs worker tests (no network)."""

import io
import json
import struct


class FakeClientError(Exception):
    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.response = {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}


class FakeS3:
    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}
        self.puts: list[dict] = []
        self.fail_get = False
        self.fail_put = False

    def get_object(self, Bucket, Key, Range=None):
        if self.fail_get:
            raise FakeClientError("InternalError", 500)
        if (Bucket, Key) not in self.objects:
            raise FakeClientError("NoSuchKey", 404)
        data = self.objects[(Bucket, Key)]
        if Range:
            start, end = (int(x) for x in Range.removeprefix("bytes=").split("-"))
            data = data[start : end + 1]
        return {"Body": io.BytesIO(data)}

    def head_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise FakeClientError("404", 404)
        return {"ContentLength": len(self.objects[(Bucket, Key)])}

    def put_object(self, Bucket, Key, Body, **kwargs):
        if self.fail_put:
            raise FakeClientError("InternalError", 500)
        self.puts.append({"Bucket": Bucket, "Key": Key, **kwargs})
        self.objects[(Bucket, Key)] = Body if isinstance(Body, bytes) else Body.encode()


class FakeSQS:
    def __init__(self):
        self.sent: list[dict] = []
        self.fail = False

    def send_message(self, QueueUrl, MessageBody):
        if self.fail:
            raise FakeClientError("ServiceUnavailable", 503)
        self.sent.append({"QueueUrl": QueueUrl, "Body": json.loads(MessageBody)})
        return {"MessageId": f"m{len(self.sent)}"}


class FakeSSM:
    def __init__(self, values: dict[str, str]):
        self.values = values
        self.calls = 0
        self.fail = False

    def get_parameters(self, Names, WithDecryption):
        self.calls += 1
        if self.fail:
            raise FakeClientError("ThrottlingException")
        found = [
            {"Name": name, "Value": self.values[name.rsplit("/", 1)[-1]]}
            for name in Names
            if name.rsplit("/", 1)[-1] in self.values
        ]
        return {"Parameters": found, "InvalidParameters": []}


class FakePolly:
    def __init__(self):
        self.calls: list[dict] = []
        self.error: Exception | None = None

    def synthesize_speech(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return {
            "AudioStream": io.BytesIO(b"ID3\x04\x00\x00\x00\x00\x00\x00FAKE"),
            "ContentType": "audio/mpeg",
        }


class FakeModel:
    """Stands in for the vendored BedrockModelClient (`invoke(ModelRequest)`)."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def invoke(self, request):
        self.requests.append(request)
        item = self.responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
SSM_VALUES = {
    "LAI_AI_MODEL_ID": MODEL,
    "LAI_AI_GUARDRAIL_ID": "gr-123",
    "LAI_AI_GUARDRAIL_VERSION": "3",
    "LAI_AI_BEDROCK_REGION": "us-west-2",
    "LAI_AI_MAX_ATTEMPTS": "2",
}
RESULTS_BUCKET = "lai-dev-artifacts-123456789012-us-west-1"
SPEECH_BUCKET = "lai-speech"
ASSET_BUCKET = "lai-assets"


def environ(queue: str) -> dict[str, str]:
    return {
        "LAI_WORKER_QUEUE": queue,
        "LAI_RESULTS_QUEUE_URL": "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-job-results",
        "LAI_RESULTS_BUCKET": RESULTS_BUCKET,
        "LAI_SPEECH_BUCKET": SPEECH_BUCKET,
        "LAI_ASSET_BUCKET": ASSET_BUCKET,
        "LAI_SSM_PREFIX": "/lai/dev/django",
    }


def tiny_glb(document: dict | None = None, bin_bytes: bytes = b"\x00" * 8) -> bytes:
    document = document or {
        "asset": {"version": "2.0", "generator": "test"},
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}, {}],
        "meshes": [{"primitives": []}],
        "materials": [{}],
        "buffers": [{"byteLength": len(bin_bytes)}],
        "extensionsUsed": ["KHR_materials_unlit"],
    }
    raw = json.dumps(document).encode()
    raw += b" " * (-len(raw) % 4)
    total = 12 + 8 + len(raw) + 8 + len(bin_bytes)
    return (
        b"glTF"
        + struct.pack("<II", 2, total)
        + struct.pack("<II", len(raw), 0x4E4F534A)
        + raw
        + struct.pack("<II", len(bin_bytes), 0x004E4942)
        + bin_bytes
    )
