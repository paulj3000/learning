"""Local demonstration of asynchronous model validation on the canonical jobs path (ADR-064).

Run by scripts/processing/local-demo.sh inside `manage.py shell` (Django settings already set:
LAI_JOBS_BACKEND=sqs with placeholder queue URLs, local asset storage, the flag on). Real
components throughout: Django's upload, submission (transactional outbox), result application
and publication gate, and the jobs worker exactly as packaged in its zip (`lambda/build.py`
staged to a directory), running the real GLB validator. Simulated: the SQS and S3 clients (an
in-memory queue and object store; asset objects are read from Django's local asset storage) and
the synthetic GLBs. Nothing touches AWS.
"""

import importlib
import importlib.util
import io
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

from django.conf import settings
from django.contrib.admin.sites import site
from django.test import override_settings

from apps.assets import resolver, services
from apps.assets.models import AssetVersion
from apps.assets.processing import validation_jobs
from apps.assets.tests.helpers import glb_bytes, gltf_document, make_definition
from apps.jobs import services as jobs
from apps.jobs.models import ProcessingJob

ROOT = Path(os.environ["LAI_DEMO_ROOT"])
ASSET_BUCKET = "lai-demo-assets"
MIXAMO = "Armature|mixamo.com|Layer0"


def step(text: str) -> None:
    print(f"\n== {text}")


class Missing(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": 404}}


class DemoS3:
    """Results in memory; asset objects read from Django's local asset storage."""

    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}

    def _asset(self, key):
        path = Path(settings.LAI_ASSET_LOCAL_ROOT) / key
        if not path.is_file():
            raise Missing("NoSuchKey")
        return path.read_bytes()

    def get_object(self, Bucket, Key, Range=None):  # noqa: N803 - boto3 names
        data = self._asset(Key) if Bucket == ASSET_BUCKET else self.objects.get((Bucket, Key))
        if data is None:
            raise Missing("NoSuchKey")
        if Range:
            start, end = (int(x) for x in Range.removeprefix("bytes=").split("-"))
            data = data[start : end + 1]
        return {"Body": io.BytesIO(data)}

    def head_object(self, Bucket, Key):  # noqa: N803
        data = self._asset(Key) if Bucket == ASSET_BUCKET else self.objects.get((Bucket, Key))
        if data is None:
            raise Missing("404")
        return {"ContentLength": len(data)}

    def put_object(self, Bucket, Key, Body, **kwargs):  # noqa: N803
        self.objects[(Bucket, Key)] = Body if isinstance(Body, bytes) else Body.encode()


class DemoSQS:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    def send_message(self, QueueUrl, MessageBody, **kwargs):  # noqa: N803
        self.sent.append((QueueUrl, MessageBody))
        return {"MessageId": f"m{len(self.sent)}"}

    def take(self, url):
        mine = [body for queue, body in self.sent if queue == url]
        self.sent = [(queue, body) for queue, body in self.sent if queue != url]
        return mine


def load_worker():
    spec = importlib.util.spec_from_file_location("lai_lambda_build", ROOT / "lambda/build.py")
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    out = Path(tempfile.mkdtemp(prefix="lai-worker-"))
    archive = build.build(out / "zip")
    staged = build.stage(out / "staged")
    sys.path.insert(0, str(staged))
    handler = importlib.import_module("jobs_worker.handler")
    aws = importlib.import_module("jobs_worker.aws")
    return archive, handler, aws


s3, sqs = DemoS3(), DemoSQS()
jobs.set_aws_clients(sqs=sqs, s3=s3)

step("1. the jobs worker zip, built deterministically (lambda/build.py) and staged as packaged")
archive, handler, aws = load_worker()
print(
    f"{archive.name}: {archive.stat().st_size} bytes, includes lai_processing and the GLB validator"
)
runtime = aws.Runtime(
    aws.Settings(
        {
            "LAI_WORKER_QUEUE": "media",
            "LAI_RESULTS_QUEUE_URL": settings.LAI_JOBS_RESULTS_QUEUE_URL,
            "LAI_RESULTS_BUCKET": settings.LAI_JOBS_RESULTS_BUCKET,
            "LAI_SPEECH_BUCKET": "lai-demo-speech",
            "LAI_ASSET_BUCKET": ASSET_BUCKET,
            "LAI_SSM_PREFIX": "/lai/demo/django",
        }
    ),
    clients={"s3": s3, "sqs": sqs},
)
context = SimpleNamespace(
    function_name="lai-demo-jobs-media",
    aws_request_id="demo",
    get_remaining_time_in_millis=lambda: 290_000,
)


def run_worker_and_consume() -> list[str]:
    """Deliver queued work to the packaged worker, then apply its results in Django."""
    bodies = sqs.take(settings.LAI_JOBS_MEDIA_QUEUE_URL)
    outcomes = [handler.process(body, context, runtime) for body in bodies]
    applied = [jobs.apply_result(body) for body in sqs.take(settings.LAI_JOBS_RESULTS_QUEUE_URL)]
    print(f"worker: {outcomes}; Django apply_result: {applied}")
    return applied


step("2. flag OFF for comparison: the existing synchronous upload (VALIDATED, no job)")
with override_settings(LAI_ASSET_ASYNC_VALIDATION="off"):
    barrel = make_definition("demo-barrel", kind="prop", category="prop")
    old = services.upload_version(barrel, io.BytesIO(glb_bytes()), original_filename="barrel.glb")
print(
    json.dumps({"version": old.label, "status": old.status, "jobs": ProcessingJob.objects.count()})
)

step("3. flag ON: a staff upload of a Treasure Rush chest is a DRAFT; its job is committed with it")
chest = make_definition("treasure-chest", kind="prop", category="prop")
document, binary = gltf_document(clips=("Idle", MIXAMO))
draft = services.upload_version(
    chest, io.BytesIO(glb_bytes(document, binary)), original_filename="chest.glb"
)
job = validation_jobs(draft).get()
queued = [b for q, b in sqs.sent if q == settings.LAI_JOBS_MEDIA_QUEUE_URL]
print(
    json.dumps(
        {
            "version": draft.label,
            "status": draft.status,
            "job": str(job.pk),
            "kind": job.kind,
            "queue": job.queue,
            "job_status": job.status,
            "dispatched": job.dispatched_at is not None,
            "media_messages": len(queued),
        }
    )
)

step("4. publication is refused before a passing background result")
for version in (draft, old):
    try:
        services.publish_version(version)
    except services.AssetActionRefused as refused:
        print(f"{version.label} ({version.status}) refused: {refused.code}")

step("5. the packaged worker validates the GLB; jobs_consume_results applies the result")
run_worker_and_consume()
draft.refresh_from_db()
job.refresh_from_db()
summary = draft.metadata["model_validation"]
print(
    json.dumps(
        {
            "status": draft.status,
            "job_status": job.status,
            "outcome": job.subject_outcome,
            "verdict": summary["verdict"],
            "clips": [a["name"] for a in summary["animations"]],
            "triangles": summary["triangle_count"],
        }
    )
)

step("6. a redelivered work message: the worker resends its stored result, Django ignores it")
work = jobs.envelope.encode(jobs.envelope.build_work(str(job.pk), job.kind, job.payload))
print("worker:", handler.process(work, context, runtime))
print("Django:", [jobs.apply_result(b) for b in sqs.take(settings.LAI_JOBS_RESULTS_QUEUE_URL)])
before = draft.validated_at
draft.refresh_from_db()
print("version unchanged:", draft.validated_at == before, draft.status)

step("7. the result as staff see it in Django Admin (Background validation section)")
admin = site._registry[AssetVersion]
html = "".join(
    str(getattr(admin, name)(draft))
    for name in ("background_status", "background_result", "background_model")
    if hasattr(admin, name)
)
print(
    re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()[:500] or "(admin section not built)"
)

step("8. explicit staff publication passes the gate; the existing resolver serves the version")
print("published:", services.publish_version(draft).status)
[entry] = resolver.resolve(resolver.parse_references("treasure-chest"))
print(json.dumps({k: entry[k] for k in ("status", "version", "format", "clips")}))

step("9. a model the background validator refuses: DRAFT -> REJECTED, never publishable")
document, binary = gltf_document()
document["nodes"][0]["translation"] = [10**400, 0, 0]
broken = services.upload_version(
    chest, io.BytesIO(glb_bytes(document, binary)), original_filename="broken.glb"
)
run_worker_and_consume()
broken.refresh_from_db()
codes = sorted({f["code"] for f in broken.validation_report if f.get("source") == "processing"})
print(json.dumps({"version": broken.label, "status": broken.status, "processing_findings": codes}))
try:
    services.publish_version(broken)
except services.AssetActionRefused as refused:
    print(f"publish refused: {refused.code}")

step("10. what never happened")
print(
    json.dumps(
        {"published_by_a_job": False, "aws_calls": 0, "queues": sorted({q for q, _ in sqs.sent})}
    )
)
