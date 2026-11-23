"""Local demonstration of asynchronous model validation on the canonical jobs path (ADR-064).

Run by scripts/processing/local-demo.sh inside `manage.py shell` (Django settings already set:
LAI_JOBS_BACKEND=sqs with placeholder queue URLs, local asset storage, the flag on). Real
components throughout: Django's upload, submission (transactional outbox), result application
and publication gate, and the jobs worker exactly as packaged in its zip (`lambda/build.py`
staged to a directory), running the real GLB validator. Simulated: the SQS and S3 clients (an
in-memory queue and object store; asset objects are read from Django's local asset storage) and
the synthetic GLBs. Nothing touches AWS.

Wave 4 (steps 10 to 16): the same packaged worker runs `asset.analyze_animation` (LAI-LAMBDA-009,
NPC animation inspection) and `asset.process_audio` (LAI-LAMBDA-008 phase 1, audio header
inspection), each submitted through its real Django helper and applied by `apply_result`; then
the failure paths: invalid media, a duplicate result, a stale version, an unauthorized admin
action, and a transient S3 503 on a ranged read (retryable, then redelivered).
"""

import hashlib
import importlib
import importlib.util
import io
import json
import os
import re
import sys
import tempfile
import wave
from pathlib import Path
from types import SimpleNamespace

from django.conf import settings
from django.contrib.admin.sites import site
from django.contrib.auth.models import Permission
from django.contrib.messages.storage.cookie import CookieStorage
from django.test import RequestFactory, override_settings

from apps.assets import resolver, services
from apps.assets.models import AssetVersion
from apps.assets.processing import validation_jobs
from apps.assets.storage import get_storage, reset_storage_cache
from apps.assets.tests.helpers import glb_bytes, gltf_document, make_definition, make_version
from apps.audio import inspection as audio_inspection
from apps.audio.models import AudioFile
from apps.jobs import services as jobs
from apps.jobs.models import ProcessingJob
from apps.npcs import animation_inspection
from apps.npcs.models import NpcModelVariant
from apps.npcs.tests.helpers import make_character, make_staff, make_variant

ROOT = Path(os.environ["LAI_DEMO_ROOT"])
ASSET_BUCKET = "lai-demo-assets"
MIXAMO = "Armature|mixamo.com|Layer0"


def step(text: str) -> None:
    print(f"\n== {text}")


def require(condition: bool, what: str) -> None:
    """Stop the demo (non-zero exit) when an expected outcome did not happen."""
    if not condition:
        raise SystemExit(f"demo check failed: {what}")


class Missing(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": 404}}


class SlowDown(Exception):
    """What botocore raises for an S3 503 (the shape the worker classifies)."""

    def __init__(self):
        super().__init__("SlowDown")
        self.response = {"Error": {"Code": "SlowDown"}, "ResponseMetadata": {"HTTPStatusCode": 503}}


class DemoS3:
    """Results in memory; asset objects read from Django's local asset storage."""

    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}
        self.fail_next_ranged_read = 0  # step 16: S3 answers 503 to this many ranged reads

    def _asset(self, key):
        path = Path(settings.LAI_ASSET_LOCAL_ROOT) / key
        if not path.is_file():
            raise Missing("NoSuchKey")
        return path.read_bytes()

    def get_object(self, Bucket, Key, Range=None):  # noqa: N803 - boto3 names
        data = self._asset(Key) if Bucket == ASSET_BUCKET else self.objects.get((Bucket, Key))
        if data is None:
            raise Missing("NoSuchKey")
        if Range and self.fail_next_ranged_read:
            self.fail_next_ranged_read -= 1
            raise SlowDown()
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
        self.history: list[str] = []

    def send_message(self, QueueUrl, MessageBody, **kwargs):  # noqa: N803
        self.sent.append((QueueUrl, MessageBody))
        self.history.append(QueueUrl.rsplit("/", 1)[-1])
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


# Any attempt to build a real AWS client is counted and refused (step 17 reports the count).
AWS_CLIENT_ATTEMPTS: list[str] = []


def _no_aws(*args, **kwargs):
    AWS_CLIENT_ATTEMPTS.append(repr(args[-1] if args else kwargs)[:40])
    raise RuntimeError("the demo never calls AWS")


try:
    import boto3
    import boto3.session

    boto3.client = boto3.resource = _no_aws
    boto3.session.Session.client = boto3.session.Session.resource = _no_aws
except ImportError:  # boto3 absent: nothing could call AWS anyway
    pass

# The settings fix the local asset root (lai/.asset-storage); the demo's files go to the
# temporary directory local-demo.sh made instead, so nothing is left in the checkout.
settings.LAI_ASSET_LOCAL_ROOT = Path(os.environ["LAI_ASSET_LOCAL_ROOT"])
reset_storage_cache()

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


def run_worker() -> list[str]:
    """Deliver queued media work to the packaged worker (results stay on the results queue)."""
    return [
        handler.process(b, context, runtime) for b in sqs.take(settings.LAI_JOBS_MEDIA_QUEUE_URL)
    ]


def consume() -> list[str]:
    """Apply the queued results in Django, as `jobs_consume_results` does."""
    return [jobs.apply_result(body) for body in sqs.take(settings.LAI_JOBS_RESULTS_QUEUE_URL)]


def run_worker_and_consume() -> list[str]:
    """Deliver queued work to the packaged worker, then apply its results in Django."""
    outcomes = run_worker()
    applied = consume()
    print(f"worker: {outcomes}; Django apply_result: {applied}")
    return applied


def text(html) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(html))).strip()


def wav(seconds_frames: int, rate: int = 8000, channels: int = 1) -> bytes:
    """A small synthetic PCM WAV, built in memory with the stdlib `wave` module."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(b"\x00\x00" * channels * seconds_frames)
    return buffer.getvalue()


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

step("10. NPC animation inspection: an animated GLB through asset.analyze_animation")
staff_user = make_staff("demo-npc-editor", superuser=True)
npc_model = make_definition("pip-parrot-model", kind="character", category="character")
document, binary = gltf_document(clips=(MIXAMO, "Idle"))
npc_version = services.upload_version(
    npc_model, io.BytesIO(glb_bytes(document, binary)), original_filename="pip.glb"
)
run_worker_and_consume()  # the model validation job uploaded with it (DRAFT -> VALIDATED)
npc_version.refresh_from_db()
npc_version = services.publish_version(npc_version)  # explicit staff publication, as in step 8
variant = make_variant(
    make_character("pip-the-parrot", with_variant=False),
    model_asset=npc_model,
    pinned_version=npc_version,
    animation_map={"idle": "Idle"},
)
map_before = dict(variant.animation_map)
inspect_job = animation_inspection.submit_animation_inspection(npc_version, user=staff_user)
print(
    json.dumps(
        {
            "job": str(inspect_job.pk),
            "kind": inspect_job.kind,
            "queue": inspect_job.queue,
            "status": inspect_job.status,
            "version": npc_version.label,
        }
    )
)
print("worker:", run_worker())
npc_results = sqs.take(settings.LAI_JOBS_RESULTS_QUEUE_URL)  # kept for step 13
print("Django apply_result:", [jobs.apply_result(body) for body in npc_results])
inspect_job.refresh_from_db()
_job, npc_summary = animation_inspection.latest_inspection(npc_version)
print(
    json.dumps(
        {
            "job_status": inspect_job.status,
            "outcome": inspect_job.subject_outcome,
            "verdict": npc_summary["verdict"],
            "clip_count": npc_summary["clip_count"],
            "generic_clip_count": npc_summary["generic_clip_count"],
        }
    )
)
print("exact clip names:", json.dumps([c["name"] for c in npc_summary["clips"]]))
npc_admin = site._registry[NpcModelVariant]
section = text(npc_admin.animation_inspection(variant))
print("NPC Admin, Animation inspection:", section[:900])
require(MIXAMO in section and "Suggestion only." in section, "NPC Admin section rendered")
variant.refresh_from_db()
npc_version.refresh_from_db()
print(
    json.dumps(
        {
            "animation_map_before": map_before,
            "animation_map_after": variant.animation_map,
            "unchanged": variant.animation_map == map_before,
            "version_status": npc_version.status,
        }
    )
)
require(variant.animation_map == map_before, "variant.animation_map == map_before")

step("11. audio inspection: a synthetic WAV through asset.process_audio")
coin = make_definition("coin-clink", kind="audio", category="sound")
wav_data = wav(4000)  # 4,000 frames at 8,000 Hz mono 16-bit: exactly 0.5 s
audio_version = services.upload_version(coin, io.BytesIO(wav_data), original_filename="coin.wav")
status_before = audio_version.status
print(
    json.dumps(
        {
            "version": audio_version.label,
            "status": audio_version.status,
            "bytes": len(wav_data),
            "jobs_on_upload": audio_inspection.inspection_jobs(audio_version).count(),
        }
    )
)
audio_job = audio_inspection.submit_audio_inspection(audio_version, user=staff_user)
print(
    json.dumps(
        {
            "job": str(audio_job.pk),
            "kind": audio_job.kind,
            "queue": audio_job.queue,
            "status": audio_job.status,
        }
    )
)
run_worker_and_consume()
audio_job.refresh_from_db()
audio_summary = audio_inspection.inspection_summary(audio_job)
print(
    json.dumps(
        {
            "job_status": audio_job.status,
            "outcome": audio_job.subject_outcome,
            **{
                k: audio_summary.get(k)
                for k in (
                    "verdict",
                    "detected_format",
                    "container",
                    "codec",
                    "sample_rate_hz",
                    "channels",
                    "sample_width_bits",
                    "duration_seconds",
                    "duration_kind",
                )
            },
        }
    )
)
audio_admin = site._registry[AudioFile]
audio_file = AudioFile.objects.get(pk=audio_version.pk)
panel = (
    text(audio_admin.inspection_status(audio_file))
    + " | "
    + text(audio_admin.inspection_result(audio_file))
)
print("Sound Manager Admin, Audio file:", panel[:900])
require("Inspected: the headers are consistent" in panel, "Sound Manager panel rendered")
audio_version.refresh_from_db()
print(
    json.dumps(
        {
            "status_before": status_before,
            "status_after": audio_version.status,
            "published": audio_version.published_at is not None,
        }
    )
)
require(
    audio_version.status == status_before and audio_version.published_at is None,
    "audio_version.status == status_before and audio_version.published_at is None",
)

step("12. failure: invalid media (refused before a job; a non-audio file is verdict fail)")
try:
    audio_inspection.submit_audio_inspection(draft, user=staff_user)  # the GLB chest
except jobs.JobsError as refused:
    print(f"a GLB version for audio inspection: refused before a job ({refused.code})")
junk = b"this is not audio at all, only text " * 8
odd = make_definition("odd-sound", kind="audio", category="sound")
odd_version = make_version(  # an upload would refuse it; written straight to the row and store
    odd,
    storage_key="assets/audio/odd-sound/v1/audio.wav",
    content_type="audio/wav",
    format="wav",
    clips=[],
    sha256=hashlib.sha256(junk).hexdigest(),
    size_bytes=len(junk),
)
get_storage().put(
    odd_version.storage_key, io.BytesIO(junk), content_type="audio/wav", sha256=odd_version.sha256
)
odd_job = audio_inspection.submit_audio_inspection(odd_version, user=staff_user)
run_worker_and_consume()
odd_job.refresh_from_db()
odd_summary = audio_inspection.inspection_summary(odd_job)
print(
    json.dumps(
        {
            "job_status": odd_job.status,
            "outcome": odd_job.subject_outcome,
            "verdict": odd_summary["verdict"],
            "findings": sorted({f["code"] for f in odd_summary["findings"]}),
        }
    )
)
require(odd_summary["verdict"] == "fail", 'odd_summary["verdict"] == "fail"')

step("13. failure: a duplicate result (the same message applied again is ignored)")
again = animation_inspection.submit_animation_inspection(npc_version, user=staff_user)
print("resubmitting the same logical work returns the same job:", again.pk == inspect_job.pk)
work = jobs.envelope.encode(
    jobs.envelope.build_work(str(inspect_job.pk), inspect_job.kind, inspect_job.payload)
)
print("worker (redelivered work):", handler.process(work, context, runtime))
print("Django, the worker's resent result:", consume())
print("Django, the step 10 result message applied again:", jobs.apply_result(npc_results[-1]))
inspect_job.refresh_from_db()
print("job outcome unchanged:", inspect_job.subject_outcome)
require(
    inspect_job.subject_outcome == "result_recorded",
    'inspect_job.subject_outcome == "result_recorded"',
)

step("14. failure: a stale version (the file changed after the worker read it)")
bell = make_definition("bell-ring", kind="audio", category="sound")
bell_data = wav(8000)
bell_version = make_version(  # an unpublished audio version, stored as an upload stores it
    bell,
    storage_key="assets/audio/bell-ring/v1/audio.wav",
    content_type="audio/wav",
    format="wav",
    clips=[],
    sha256=hashlib.sha256(bell_data).hexdigest(),
    size_bytes=len(bell_data),
)
get_storage().put(
    bell_version.storage_key,
    io.BytesIO(bell_data),
    content_type="audio/wav",
    sha256=bell_version.sha256,
)
stale_job = audio_inspection.submit_audio_inspection(bell_version, user=staff_user)
print("worker:", run_worker())
# Simulated: the row now describes different bytes than the request the worker inspected.
AssetVersion.objects.filter(pk=bell_version.pk).update(sha256="f" * 64)
print("Django apply_result:", consume())
stale_job.refresh_from_db()
print(
    json.dumps(
        {
            "outcome": stale_job.subject_outcome,
            "summary_shown": audio_inspection.inspection_summary(stale_job) is not None
            and audio_inspection.identity_mismatch(
                stale_job, AssetVersion.objects.get(pk=bell_version.pk)
            )
            is None,
        }
    )
)
require(
    audio_inspection.is_mismatch(stale_job.subject_outcome),
    "audio_inspection.is_mismatch(stale_job.subject_outcome)",
)

step("15. failure: an unauthorized admin action (staff without the permission)")
plain = make_staff("demo-viewer")  # staff who may view variants and audio files, nothing more
for perm in ("view_npcmodelvariant", "view_audiofile"):
    plain.user_permissions.add(Permission.objects.get(codename=perm))
plain = type(plain).objects.get(pk=plain.pk)  # drop the cached permissions
factory = RequestFactory()
for label, user in (("superuser", staff_user), ("staff, view only", plain)):
    request = factory.get("/admin/")
    request.user = user
    print(
        json.dumps(
            {
                "user": label,
                "npc has_inspect_animations_permission": (
                    npc_admin.has_inspect_animations_permission(request)
                ),
                "npc action offered": "inspect_animations_in_background"
                in npc_admin.get_actions(request),
                "audio has_inspect_permission": audio_admin.has_inspect_permission(request),
                "audio action offered": "inspect_audio" in audio_admin.get_actions(request),
            }
        )
    )


def post_action(model_admin, url, action, pk):
    """The admin changelist's action POST, as the browser sends it (RequestFactory)."""
    request = factory.post(url, {"action": action, "index": 0, "_selected_action": [str(pk)]})
    request.user = plain
    request.session = {}
    request._messages = CookieStorage(request)
    request._dont_enforce_csrf_checks = True
    response = model_admin.changelist_view(request)
    notes = [str(m) for m in request._messages]
    return response.status_code, notes


jobs_before = ProcessingJob.objects.count()
for model_admin, url, action, pk in (
    (npc_admin, "/admin/npcs/npcmodelvariant/", "inspect_animations_in_background", variant.pk),
    (audio_admin, "/admin/audio/audiofile/", "inspect_audio", audio_version.pk),
):
    status, notes = post_action(model_admin, url, action, pk)
    print(
        f"POST {action} as view-only staff: HTTP {status}, the changelist again; the action is "
        f"not among this user's choices, so Django ran nothing (messages: {notes or 'none'})"
    )
created = ProcessingJob.objects.count() - jobs_before
print("jobs created by the refused user:", created)
require(created == 0, "created == 0")

step("16. failure: a transient S3 503 on a ranged read (retryable; succeeds on redelivery)")
drum = make_definition("drum-hit", kind="audio", category="sound")
drum_version = services.upload_version(drum, io.BytesIO(wav(16000)), original_filename="drum.wav")
drum_job = audio_inspection.submit_audio_inspection(drum_version, user=staff_user)
[drum_work] = sqs.take(settings.LAI_JOBS_MEDIA_QUEUE_URL)
s3.fail_next_ranged_read = 1
try:
    handler.process(drum_work, context, runtime)
    raise SystemExit("the worker did not raise for a 503")
except Exception as error:  # the Lambda handler reports it as a batch item failure
    print(
        f"first delivery: {type(error).__name__} code={getattr(error, 'code', None)} "
        f"retryable={getattr(error, 'retryable', None)}"
    )
print("Django apply_result (RUNNING only):", consume())
drum_job.refresh_from_db()
print("job after the 503:", drum_job.status)
print("redelivery:", handler.process(drum_work, context, runtime))
print("Django apply_result:", consume())
drum_job.refresh_from_db()
print(
    json.dumps(
        {
            "job_status": drum_job.status,
            "outcome": drum_job.subject_outcome,
            "duration_seconds": audio_inspection.inspection_summary(drum_job)["duration_seconds"],
        }
    )
)
require(
    drum_job.subject_outcome == audio_inspection.RECORDED,
    "drum_job.subject_outcome == audio_inspection.RECORDED",
)

step("17. what never happened")
variant.refresh_from_db()
explicit = {draft.pk, npc_version.pk}  # published by staff in steps 8 and 10
published = set(
    AssetVersion.objects.filter(published_at__isnull=False).values_list("pk", flat=True)
)
never_published = [
    v.label
    for v in AssetVersion.objects.filter(
        pk__in=[audio_version.pk, odd_version.pk, bell_version.pk, drum_version.pk, broken.pk]
    )
    if v.published_at is None
]
summary = {
    "aws_client_attempts": len(AWS_CLIENT_ATTEMPTS),
    "aws_clients": sorted({type(c).__name__ for c in (s3, sqs)}),
    "published_by_a_job": bool(published - explicit),
    "published_only_by_staff": sorted(
        v.label for v in AssetVersion.objects.filter(pk__in=published)
    ),
    "still_unpublished": never_published,
    "animation_map_unchanged": variant.animation_map == map_before,
    "messages_by_queue": {q: sqs.history.count(q) for q in sorted(set(sqs.history))},
}
print(json.dumps(summary))
require(
    not summary["published_by_a_job"] and summary["animation_map_unchanged"],
    'not summary["published_by_a_job"] and summary["animation_map_unchanged"]',
)
require(not AWS_CLIENT_ATTEMPTS, "not AWS_CLIENT_ATTEMPTS")
