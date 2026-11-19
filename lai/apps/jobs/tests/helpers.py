"""Fakes for the jobs tests: SQS and S3 clients that never touch the network."""

import io
import json
import struct
import uuid

from apps.jobs.core import envelope

AI_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-jobs-ai"
MEDIA_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-jobs-media"
RESULTS_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-job-results"
BUCKET = "lai-dev-artifacts-123456789012-us-west-1"


def use_sqs(settings):
    settings.LAI_JOBS_BACKEND = "sqs"
    settings.LAI_JOBS_AI_QUEUE_URL = AI_URL
    settings.LAI_JOBS_MEDIA_QUEUE_URL = MEDIA_URL
    settings.LAI_JOBS_RESULTS_QUEUE_URL = RESULTS_URL
    settings.LAI_JOBS_RESULTS_BUCKET = BUCKET


class FakeSQS:
    def __init__(self):
        self.sent: list[dict] = []
        self.inbox: list[dict] = []  # messages receive_message hands out
        self.deleted: list[str] = []
        self.fail_send = False
        self.receives = 0
        self.released: list[str] = []
        self.backlog = 0  # ApproximateNumberOfMessages reported for the results queue
        self.fail_attributes = False

    def send_message(self, QueueUrl, MessageBody):
        if self.fail_send:
            raise RuntimeError("unreachable")
        self.sent.append({"QueueUrl": QueueUrl, "Body": json.loads(MessageBody)})
        return {"MessageId": str(uuid.uuid4())}

    def receive_message(self, QueueUrl, MaxNumberOfMessages, WaitTimeSeconds, **kwargs):
        self.receives += 1
        batch, self.inbox = self.inbox[:MaxNumberOfMessages], self.inbox[MaxNumberOfMessages:]
        return {"Messages": batch}

    def delete_message(self, QueueUrl, ReceiptHandle):
        self.deleted.append(ReceiptHandle)

    def change_message_visibility(self, QueueUrl, ReceiptHandle, VisibilityTimeout):
        self.released.append(ReceiptHandle)

    def get_queue_attributes(self, QueueUrl, AttributeNames):
        if self.fail_attributes:
            raise RuntimeError("unreachable")
        return {
            "Attributes": {
                "ApproximateNumberOfMessages": str(self.backlog),
                "ApproximateNumberOfMessagesNotVisible": "0",
            }
        }

    def queue(self, body, handle=None):
        text = body if isinstance(body, str) else json.dumps(body)
        handle = handle or f"rh-{len(self.inbox)}-{uuid.uuid4().hex[:6]}"
        self.inbox.append({"MessageId": handle, "ReceiptHandle": handle, "Body": text})
        return handle


class FakeS3:
    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}
        self.fail = False

    def get_object(self, Bucket, Key):
        if self.fail or (Bucket, Key) not in self.objects:
            raise RuntimeError("missing")
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}


def result(job, status, *, result=None, code=None, request_id="req-1"):
    return envelope.build_result(
        str(job.pk),
        job.kind,
        status,
        result=result,
        error_code=code,
        function="lai-dev-jobs-media",
        request_id=request_id,
    )


def tiny_glb() -> bytes:
    document = {
        "asset": {"version": "2.0", "generator": "test"},
        "nodes": [{}, {}, {}],
        "meshes": [{"primitives": []}],
        "materials": [{}, {}],
        "animations": [{"channels": [], "samplers": []}],
        "buffers": [{"byteLength": 4}],
        "extensionsRequired": ["KHR_draco_mesh_compression"],
        "extensionsUsed": ["KHR_draco_mesh_compression"],
    }
    raw = json.dumps(document).encode()
    raw += b" " * (-len(raw) % 4)
    body = b"\x00" * 4
    total = 12 + 8 + len(raw) + 8 + len(body)
    return (
        b"glTF"
        + struct.pack("<II", 2, total)
        + struct.pack("<II", len(raw), 0x4E4F534A)
        + raw
        + struct.pack("<II", len(body), 0x004E4942)
        + body
    )
