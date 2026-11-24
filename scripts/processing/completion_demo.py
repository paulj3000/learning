# ruff: noqa: E501, B018, F821
"""Local integration demonstration of the processing completion work (ADR-066 to ADR-071).

Run by scripts/processing/local-demo.sh inside `manage.py shell`, after canonical_demo.py, against
the same isolated demo database. Every line of evidence is tagged:

  [REAL]         Django code and PostgreSQL rows (upload, submission, outbox, result application,
                 verification, review, promotion, retention, admin views, publication gate)
  [MOCKED]       the SQS and S3 clients (in memory / the local asset directory; the queue URLs are
                 placeholders and are never contacted) and any result built by hand
  [REAL-NATIVE]  a native tool really executed on this machine (FFmpeg, Pillow, gltfpack, toktx)
  [SKIPPED]      a scenario whose native tool is not available here (never counted as a pass)

The packaged jobs worker (lambda/build.py staged as in the zip) runs the canonical envelope and
redelivery handling; the audio, image and optimize function modules are imported from the
repository layout on top of it (their zips need the Pillow wheel or the FFmpeg layer to build).
Nothing touches AWS: any attempt to build a real AWS client is counted and refused.

Native tools are found from: LAI_FFMPEG_BIN (or ffmpeg on PATH), Pillow importable (optionally from
LAI_DEMO_PILLOW_SITE, a site-packages directory), LAI_GLTFPACK_PATH + LAI_TOKTX_PATH
(+ LAI_KTX_LIBRARY_PATH).
"""

import hashlib
import importlib
import importlib.util
import io
import json
import math
import os
import shutil
import struct
import sys
import tempfile
import wave
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import Client, override_settings
from django.utils.timezone import now

from apps.assets import (
    artifact_promotion,
    artifact_retention,
    artifacts,
    image_conversion,
    optimize,
    services,
)
from apps.assets import processing as asset_processing
from apps.assets.models import (
    ArtifactState,
    AssetVersion,
    DerivedArtifact,
    VersionStatus,
)
from apps.assets.storage import get_storage, reset_storage_cache
from apps.assets.tests.artifact_helpers import (
    deliver,
    make_job,
    real_audio_source,
    user_with,
    write,
)
from apps.assets.tests.helpers import glb_bytes, make_definition
from apps.assets.tests.media_files import ogg_bytes, png_bytes, webp_bytes
from apps.audio import transcoding
from apps.jobs import services as jobs
from apps.jobs import workloads
from apps.jobs.models import ProcessingJob
from apps.npcs.tests.helpers import make_staff

ROOT = Path(os.environ["LAI_DEMO_ROOT"])
ASSET_BUCKET = "lai-demo-assets"
TAGS: dict[str, int] = {"REAL": 0, "MOCKED": 0, "REAL-NATIVE": 0, "SKIPPED": 0}
CHECKS: list[str] = []


def step(text: str) -> None:
    print(f"\n== {text}")


def tag(kind: str, text: str) -> None:
    TAGS[kind] += 1
    print(f"  [{kind}] {text}")


def require(condition: bool, what: str) -> None:
    """Stop the demo (non-zero exit) when an expected outcome did not happen."""
    if not condition:
        raise SystemExit(f"demo check failed: {what}")
    CHECKS.append(what)


# --- no AWS, ever --------------------------------------------------------------------------------

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

settings.LAI_ASSET_LOCAL_ROOT = Path(os.environ["LAI_ASSET_LOCAL_ROOT"])
reset_storage_cache()


# --- the mocked clients --------------------------------------------------------------------------


class ClientError(Exception):
    def __init__(self, code, status):
        super().__init__(code)
        self.response = {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}


class DemoS3:
    """S3 for the workers. The asset bucket is Django's local asset directory, so what a worker
    writes under `processing/artifacts/` is what Django reads. Writes follow the real rules:
    `IfNoneMatch="*"` on an existing key answers 412, and `assets/` is not writable at all."""

    def __init__(self):
        self.results: dict[tuple[str, str], bytes] = {}
        self.writes: list[str] = []
        self.denied_writes: list[str] = []

    def _file(self, key):
        return Path(settings.LAI_ASSET_LOCAL_ROOT) / key

    def _read(self, bucket, key, missing_code):
        if bucket == ASSET_BUCKET:
            path = self._file(key)
            if not path.is_file():
                raise ClientError(missing_code, 404)
            return path.read_bytes()
        if (bucket, key) not in self.results:
            raise ClientError(missing_code, 404)
        return self.results[(bucket, key)]

    def get_object(self, Bucket, Key, Range=None, **kwargs):  # noqa: N803 - boto3 names
        data = self._read(Bucket, Key, "NoSuchKey")
        if Range:
            start, end = (int(x) for x in Range.removeprefix("bytes=").split("-"))
            data = data[start : end + 1]
        return {"Body": io.BytesIO(data)}

    def head_object(self, Bucket, Key, **kwargs):  # noqa: N803
        return {"ContentLength": len(self._read(Bucket, Key, "404"))}

    def put_object(self, Bucket, Key, Body, **kwargs):  # noqa: N803
        body = Body if isinstance(Body, bytes) else Body.encode()
        if Bucket != ASSET_BUCKET:
            self.results[(Bucket, Key)] = body
            return {}
        if not Key.startswith("processing/artifacts/"):
            self.denied_writes.append(Key)
            raise ClientError("AccessDenied", 403)
        path = self._file(Key)
        if kwargs.get("IfNoneMatch") == "*" and path.exists():
            raise ClientError("PreconditionFailed", 412)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        self.writes.append(Key)
        return {}


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


s3, sqs = DemoS3(), DemoSQS()
jobs.set_aws_clients(sqs=sqs, s3=s3)

# --- native tool discovery -----------------------------------------------------------------------

site = os.environ.get("LAI_DEMO_PILLOW_SITE", "")
if site and site not in sys.path:
    sys.path.append(site)  # appended: the Django environment's own packages win
FFMPEG = os.environ.get("LAI_FFMPEG_BIN") or shutil.which("ffmpeg") or ""
HAVE_FFMPEG = bool(FFMPEG) and Path(FFMPEG).is_file()
HAVE_PILLOW = importlib.util.find_spec("PIL") is not None
GLTFPACK = os.environ.get("LAI_GLTFPACK_PATH", "")
TOKTX = os.environ.get("LAI_TOKTX_PATH", "")
KTX_LIB = os.environ.get("LAI_KTX_LIBRARY_PATH", "")
HAVE_GLTFPACK = bool(GLTFPACK) and Path(GLTFPACK).is_file()
HAVE_TOKTX = bool(TOKTX) and Path(TOKTX).is_file()

# --- the packaged jobs worker and the native function modules ------------------------------------


def load_worker():
    spec = importlib.util.spec_from_file_location("lai_lambda_build", ROOT / "lambda/build.py")
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    out = Path(tempfile.mkdtemp(prefix="lai-worker-"))
    archive = build.build(out / "zip")
    staged = build.stage(out / "staged")
    sys.path.insert(0, str(staged))
    return (
        archive,
        importlib.import_module("jobs_worker.handler"),
        importlib.import_module("jobs_worker.aws"),
    )


step("0. setup: the packaged jobs worker, mocked clients, native tools found")
archive, jobs_handler, aws = load_worker()
sys.path.append(str(ROOT / "lambda"))  # audio_worker, image_worker, optimize_worker (after the zip)
tag("REAL", f"jobs worker zip {archive.name}: {archive.stat().st_size} bytes, staged as packaged")
tag("MOCKED", "SQS and S3 clients (the asset bucket is Django's local asset directory)")
print(
    f"  tools: ffmpeg={'yes' if HAVE_FFMPEG else 'no'} pillow={'yes' if HAVE_PILLOW else 'no'} "
    f"gltfpack={'yes' if HAVE_GLTFPACK else 'no'} toktx={'yes' if HAVE_TOKTX else 'no'}"
)

URLS = {
    "media": settings.LAI_JOBS_MEDIA_QUEUE_URL,
    "audio": settings.LAI_JOBS_AUDIO_QUEUE_URL,
    "image": settings.LAI_JOBS_IMAGE_QUEUE_URL,
    "optimize": settings.LAI_JOBS_OPTIMIZE_QUEUE_URL,
}
CONTEXT = SimpleNamespace(
    function_name="lai-demo-worker",
    aws_request_id="demo",
    get_remaining_time_in_millis=lambda: 290_000,
)


def worker_env(queue: str, **extra) -> dict:
    return {
        "LAI_WORKER_QUEUE": queue,
        "LAI_RESULTS_QUEUE_URL": settings.LAI_JOBS_RESULTS_QUEUE_URL,
        "LAI_RESULTS_BUCKET": settings.LAI_JOBS_RESULTS_BUCKET,
        "LAI_SPEECH_BUCKET": "lai-demo-speech",
        "LAI_ASSET_BUCKET": ASSET_BUCKET,
        "LAI_SSM_PREFIX": "/lai/demo/django",
        **extra,
    }


def run_queue(queue: str, runtime) -> list[str]:
    """Deliver queued work of one queue to its worker; the results stay on the results queue."""
    return [jobs_handler.process(body, CONTEXT, runtime) for body in sqs.take(URLS[queue])]


def consume() -> list[str]:
    """Apply queued results in Django, as `jobs_consume_results` does."""
    return [jobs.apply_result(body) for body in sqs.take(settings.LAI_JOBS_RESULTS_QUEUE_URL)]


media_runtime = aws.Runtime(aws.Settings(worker_env("media")), clients={"s3": s3, "sqs": sqs})


def validate_in_background() -> list[str]:
    done = run_queue("media", media_runtime)
    return [f"worker {done}", f"Django {consume()}"]


def staff_client(*codenames, name=None):
    client = Client(SERVER_NAME="localhost")
    client.force_login(
        user_with(*codenames, name=name), backend="apps.users.backends.AdminPasswordBackend"
    )
    return client


def file_sha(version) -> str:
    with get_storage().open(version.storage_key) as stream:
        return hashlib.sha256(stream.read()).hexdigest()


def snapshot(version) -> dict:
    fresh = AssetVersion.objects.get(pk=version.pk)
    return {
        "sha256": fresh.sha256,
        "size": fresh.size_bytes,
        "key": fresh.storage_key,
        "status": fresh.status,
        "metadata": json.dumps(fresh.metadata, sort_keys=True),
        "report": json.dumps(fresh.validation_report, sort_keys=True),
        "bytes": file_sha(fresh),
    }


publisher = make_staff("demo-completion-publisher", superuser=True)

# =================================================================================================
step("1. every new kind is refused while its control is off: nothing recorded, nothing queued")
jobs_before, sent_before = ProcessingJob.objects.count(), len(sqs.history)
with override_settings(LAI_ASSET_ASYNC_VALIDATION="off"):
    refusal_asset = make_definition("demo-refusals-glb", kind="prop", category="prop")
    refusal_glb = services.upload_version(
        refusal_asset, io.BytesIO(glb_bytes()), original_filename="r.glb"
    )
    refusal_sound = real_audio_source("demo-refusals-sound")
    refusal_image_asset = make_definition("demo-refusals-image", kind="image", category="image")
    refusal_image = services.upload_version(
        refusal_image_asset, io.BytesIO(png_bytes(32, 24)), original_filename="r.png"
    )
attempts = {
    "asset.transcode_audio": lambda: transcoding.submit_transcode(
        refusal_sound, normalize=True, user=publisher, channel="music"
    ),
    "asset.convert_image": lambda: image_conversion.submit(
        refusal_image, "convert", user=publisher
    ),
    "asset.optimize (meshopt)": lambda: optimize.submit_optimization(
        refusal_glb, "meshopt", user=publisher
    ),
    "asset.optimize (ktx2)": lambda: optimize.submit_optimization(
        refusal_glb, "ktx2", user=publisher
    ),
    "raw submit_workload": lambda: workloads.submit_workload("asset.convert_image", {}),
}
for name, attempt in attempts.items():
    try:
        attempt()
    except Exception as refused:  # the typed refusals differ per workload on purpose
        code = getattr(refused, "code", type(refused).__name__)
        tag("REAL", f"{name}: refused ({code})")
    else:
        raise SystemExit(f"demo check failed: {name} was not refused")
require(ProcessingJob.objects.count() == jobs_before, "refused kinds created no ProcessingJob row")
require(len(sqs.history) == sent_before, "refused kinds queued no message")
capturer = user_with("view_assetversion", "capture_derivedartifact", "view_derivedartifact")
try:
    artifacts.record_staff_capture(refusal_glb, capturer, png_bytes(64, 64), "image/png")
except artifacts.ArtifactRefused as refused:
    tag("REAL", f"staff thumbnail capture: refused ({refused.code})")
require(not DerivedArtifact.objects.exists(), "no artifact exists while every control is off")

# =================================================================================================
step("2. core regression: GLB upload, DRAFT, background validation, the latest-result gate")
ship_asset = make_definition("demo-ship-model", kind="prop", category="prop")
ship = services.upload_version(ship_asset, io.BytesIO(glb_bytes()), original_filename="ship.glb")
tag("REAL", f"upload with the flag on: {ship.label} is {ship.status}; its job is committed with it")
require(ship.status == VersionStatus.DRAFT, "a staff GLB upload is a DRAFT")
try:
    services.publish_version(ship)
except services.AssetActionRefused as refused:
    tag("REAL", f"publish before validation: refused ({refused.code})")
for line in validate_in_background():
    tag("MOCKED", line)
ship.refresh_from_db()
require(ship.status == VersionStatus.VALIDATED, "the passing result moved the draft to VALIDATED")
tag("REAL", f"packaged worker + validator applied: {ship.label} is {ship.status}")
newer_id = str(__import__("uuid").uuid4())
payload = asset_processing.model_validation_request(ship, job_id=newer_id)
newer = jobs.submit(
    asset_processing.MODEL_VALIDATION_JOB_TYPE,
    payload,
    user=publisher,
    subject=ship,
    job_id=newer_id,
    idempotency_key=payload["idempotency_key"],
)
tag("REAL", f"a newer validation is pending (job {str(newer.pk)[:8]}, {newer.status})")
try:
    services.publish_version(ship)
except services.AssetActionRefused as refused:
    require(refused.code == "processing_required", "a newer pending validation blocks publication")
    tag("REAL", f"publish with a newer pending validation: refused ({refused.code})")
for line in validate_in_background():
    tag("MOCKED", line)
published = services.publish_version(ship)
require(published.status == VersionStatus.PUBLISHED, "explicit publish after the newer pass")
tag("REAL", f"explicit staff publish: {published.label} is {published.status}")
first_job = asset_processing.validation_jobs(ship).last()
work = jobs.envelope.encode(
    jobs.envelope.build_work(str(first_job.pk), first_job.kind, first_job.payload)
)
tag(
    "MOCKED",
    f"redelivered work message: worker {jobs_handler.process(work, CONTEXT, media_runtime)}",
)
duplicate = [jobs.apply_result(b) for b in sqs.take(settings.LAI_JOBS_RESULTS_QUEUE_URL)]
require(duplicate == [jobs.DUPLICATE], "the redelivered result is a duplicate")
tag("REAL", f"duplicate result handling: Django {duplicate}, version stays {published.status}")

# =================================================================================================
step("3. derived artifacts: worker result, verification, private review, promotion, immutability")
source = real_audio_source("demo-derived-sound")
before = snapshot(source)
with override_settings(LAI_AUDIO_TRANSCODING="on"):
    job = make_job(source)  # the request as `submit_derived_job` records it (nothing queued here)
data = ogg_bytes(seconds=2)
tag("MOCKED", "the worker result is built by hand (no native tool in this step)")
deliver(job, [write(job, "opus", data)], metadata={"tool_versions": {"demo": "1.0"}})
job.refresh_from_db()
artifact = DerivedArtifact.objects.get(job_id_text=job.pk)
tag(
    "REAL",
    f"consumer verified (prefix, role, type, size by HEAD, SHA-256 by read): {job.subject_outcome}",
)
require(job.subject_outcome == "artifacts_recorded", "the artifact was verified and recorded")
tag(
    "REAL",
    f"row {str(artifact.pk)[:8]}: {artifact.role}/{artifact.logical_id} state={artifact.state} "
    f"key={artifact.storage_key.split('/')[0]}/{artifact.storage_key.split('/')[1]}/...",
)
media_url = f"/admin/assets/derivedartifact/{artifact.pk}/media/"
for who, client in (
    ("anonymous", Client(SERVER_NAME="localhost")),
    ("staff without view_derivedartifact", staff_client(name="cdemo-nobody")),
    ("staff with view_derivedartifact", staff_client("view_derivedartifact", name="cdemo-viewer")),
):
    response = client.get(media_url)
    tag(
        "REAL",
        f"streamed view as {who}: HTTP {response.status_code}"
        + (
            f", {response['Content-Type']}, nosniff={response['X-Content-Type-Options']}"
            if response.status_code == 200
            else ""
        ),
    )
    require(
        (response.status_code == 200) == (who == "staff with view_derivedartifact"),
        f"private view for {who}",
    )
reviewer = user_with("view_derivedartifact", "review_derivedartifact", name="cdemo-reviewer")
artifacts.accept_artifact(artifact, reviewer)
tag("REAL", "accepted by a reviewer (accepted artifacts are protected from retention)")
try:
    artifact_promotion.promote_artifact(artifact, reviewer)
except artifacts.ArtifactRefused as refused:
    tag("REAL", f"promotion without assets.promote_derivedartifact: refused ({refused.code})")
promoted = artifact_promotion.promote_artifact(
    artifact, user_with("view_derivedartifact", "promote_derivedartifact", name="cdemo-promoter")
)
artifact.refresh_from_db()
require(
    promoted.status == VersionStatus.VALIDATED and promoted.published_at is None,
    "promotion never publishes",
)
tag(
    "REAL",
    f"promoted to {promoted.label}: {promoted.status}, published_at={promoted.published_at}; "
    f"derivedFrom.sourceVersion matches source: "
    f"{promoted.metadata['derivedFrom']['sourceVersion'] == str(source.version_id)}",
)
require(
    snapshot(source) == before,
    "the source version (row and bytes) is unchanged by artifacts and promotion",
)
tag("REAL", "source version row and stored bytes are byte-for-byte unchanged")
buffer = io.StringIO()
call_command("asset_artifact_retention", stdout=buffer)
tag(
    "REAL",
    "retention command (dry run by default): " + " | ".join(buffer.getvalue().split("\n")[:4]),
)
extra_job = make_job(real_audio_source("demo-retention-sound"))
deliver(extra_job, [write(extra_job, "opus", ogg_bytes(seconds=3))])
orphan = f"processing/artifacts/{asset_processing.namespace()}/{__import__('uuid').uuid4()}/{__import__('uuid').uuid4()}/lost.ogg"
get_storage().put(
    orphan, io.BytesIO(data), content_type="audio/ogg", sha256=hashlib.sha256(data).hexdigest()
)
report = artifact_retention.run_retention(at=now() + timedelta(days=100), grace=timedelta(0))
tag(
    "REAL",
    f"dry run 100 days ahead: would expire {len(report['expired'])} unreviewed artifact(s), "
    f"{len(report['orphans'])} orphan object(s); accepted/promoted protected: "
    f"{str(artifact.pk) not in report['expired']}",
)
require(
    len(report["expired"]) >= 1 and orphan in report["orphans"],
    "retention dry run reports expiry and orphans",
)
require(
    DerivedArtifact.objects.get(pk=artifact.pk).state == ArtifactState.PROMOTED,
    "dry run changed nothing",
)

# =================================================================================================
step("4. audio: a WAV through the audio worker to Opus and MP3 with loudness")
if not HAVE_FFMPEG:
    tag("SKIPPED", "audio (no ffmpeg: set LAI_FFMPEG_BIN)")
    print("  SKIPPED (no ffmpeg)")
else:
    os.environ["LAI_FFMPEG_PATH"] = FFMPEG
    audio_handler = importlib.import_module("audio_worker.handler")
    audio_runtime = audio_handler.AudioRuntime(
        aws.Settings(worker_env("audio")), clients={"s3": s3, "sqs": sqs}
    )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(44100)
        out.writeframes(
            b"".join(
                struct.pack("<h", int(6000 * math.sin(2 * math.pi * 440 * i / 44100)))
                for i in range(44100 * 3)
            )
        )
    sound_asset = make_definition("demo-wav-sound", kind="audio", category="sound")
    wav_version = services.upload_version(
        sound_asset, io.BytesIO(buf.getvalue()), original_filename="a.wav"
    )
    wav_before = snapshot(wav_version)
    with override_settings(LAI_AUDIO_TRANSCODING="on"):
        job = transcoding.submit_transcode(
            wav_version, normalize=True, user=publisher, channel="music"
        )
        tag("REAL", f"submitted {job.kind} on the {job.queue} queue ({job.status})")
        done = run_queue("audio", audio_runtime)
        applied = consume()
    job.refresh_from_db()
    tag(
        "REAL-NATIVE",
        f"FFmpeg {FFMPEG}: worker {done}, Django {applied}, outcome {job.subject_outcome}",
    )
    require(job.subject_outcome == "artifacts_recorded", "audio artifacts recorded")
    facts = transcoding.summary(job)
    for output in facts["outputs"]:
        tag(
            "REAL-NATIVE",
            f"{output.label}: {output.content_type}, {output.duration_seconds} s, "
            f"{output.bitrate_kbps} kbps, gain {output.gain_db} dB, "
            f"loudness before {output.before} after {output.after}",
        )
    rows = {a.logical_id: a for a in DerivedArtifact.objects.filter(job=job)}
    require({"opus", "mp3"} <= set(rows), "an Opus and an MP3 artifact exist")
    opus = rows["opus"]
    with get_storage().open(opus.storage_key) as stream:
        require(stream.read(4) == b"OggS", "the Opus artifact is a real Ogg file")
    tag("REAL", f"private artifacts: {sorted(rows)} (pending_review, staff-only streamed view)")
    new_audio = artifact_promotion.promote_artifact(
        opus, user_with("promote_derivedartifact", name="cdemo-promoter2")
    )
    tag(
        "REAL",
        f"Opus promoted to {new_audio.label}: {new_audio.status}, unpublished: {new_audio.published_at is None}",
    )
    require(snapshot(wav_version) == wav_before, "the source WAV is unchanged")

# =================================================================================================
step("5. images: convert PNG and JPEG, thumbnails, metadata sanitization")
if not HAVE_PILLOW:
    tag("SKIPPED", "images (no Pillow)")
    print("  SKIPPED (no Pillow)")
else:
    from PIL import Image

    sys.path.insert(0, str(ROOT / "tests" / "native_image"))
    from builders import jpeg_with_gps, png_with_text

    image_handler = importlib.import_module("image_worker.handler")
    image_runtime = image_handler.ImageRuntime(
        aws.Settings(worker_env("image")), clients={"s3": s3, "sqs": sqs}
    )
    photo_asset = make_definition("demo-photo", kind="image", category="image")
    jpeg = services.upload_version(
        photo_asset, io.BytesIO(jpeg_with_gps(width=96, height=72)), original_filename="p.jpg"
    )
    art_asset = make_definition("demo-art", kind="image", category="image")
    png = services.upload_version(
        art_asset, io.BytesIO(png_with_text(64, 64)), original_filename="a.png"
    )
    secret = b"SecretMaker"
    require(
        secret in get_storage().open(jpeg.storage_key).read(),
        "the source JPEG carries EXIF (fixture check)",
    )
    jpeg_before, png_before = snapshot(jpeg), snapshot(png)
    with override_settings(LAI_IMAGE_CONVERSION="on"):
        jobs_made = [
            image_conversion.submit(jpeg, "convert", {"target_format": "webp"}, user=publisher),
            image_conversion.submit(png, "convert", {"target_format": "webp"}, user=publisher),
            image_conversion.submit(jpeg, "thumbnail", user=publisher),
        ]
        done = run_queue("image", image_runtime)
        applied = consume()
    tag("REAL-NATIVE", f"Pillow {Image.__version__}: worker {done}, Django {applied}")
    for made in jobs_made:
        made.refresh_from_db()
        require(made.subject_outcome == "artifacts_recorded", f"{made.pk} recorded its artifacts")
    rows = list(
        DerivedArtifact.objects.filter(source_version__in=[jpeg, png]).order_by(
            "role", "logical_id"
        )
    )
    for row in rows:
        data = get_storage().open(row.storage_key).read()
        picture = Image.open(io.BytesIO(data))
        clean = secret not in data and b"SecretAuthor" not in data and b"SecretXMP" not in data
        tag(
            "REAL-NATIVE",
            f"{row.role}/{row.logical_id}: {row.content_type} {picture.size[0]}x{picture.size[1]}, "
            f"exif tags={len(picture.getexif())}, secret strings absent={clean}",
        )
        require(
            clean and len(picture.getexif()) == 0, f"{row.logical_id} has no EXIF, GPS, text or XMP"
        )
    require(
        snapshot(jpeg) == jpeg_before and snapshot(png) == png_before,
        "source images are unchanged (originals keep their metadata)",
    )
    converted = next(
        r for r in rows if r.role == "image.converted" and r.source_version_id == jpeg.pk
    )
    new_image = artifact_promotion.promote_artifact(
        converted, user_with("promote_derivedartifact", name="cdemo-promoter3")
    )
    tag(
        "REAL",
        f"converted WebP promoted to {new_image.label}: {new_image.status}, unpublished: {new_image.published_at is None}",
    )
    thumbs = [r for r in rows if r.role == "image.thumbnail"]
    try:
        artifact_promotion.promote_artifact(
            thumbs[0], user_with("promote_derivedartifact", name="cdemo-promoter4")
        )
    except Exception as refused:
        tag("REAL", f"thumbnail promotion: refused ({getattr(refused, 'code', refused)})")

# =================================================================================================
step("6. staff thumbnail capture: server-side validation (the browser step is manual QA)")
glb = AssetVersion.objects.get(pk=ship.pk)
glb_before = snapshot(glb)
upload_url = f"/admin/assets/assetversion/{glb.pk}/capture/upload/"
allowed = staff_client(
    "view_assetversion", "capture_derivedartifact", "view_derivedartifact", name="cdemo-capturer"
)
denied = staff_client("view_assetversion", name="cdemo-no-capture")


def post(client, image, *, sha=None, version_id=None, name="c.png", content_type="image/png"):
    return client.post(
        upload_url,
        {
            "version_id": str(version_id or glb.pk),
            "source_sha256": sha or glb.sha256,
            "image": SimpleUploadedFile(name, image, content_type=content_type),
        },
    )


with override_settings(LAI_THUMBNAIL_CAPTURE="off"):
    response = post(allowed, png_bytes(64, 64))
    tag(
        "REAL",
        f"capture control off: HTTP {response.status_code} {response.json()['error']['code']}",
    )
    require(response.status_code == 403, "capture refused while the control is off")
with override_settings(LAI_THUMBNAIL_CAPTURE="on"):
    response = post(denied, png_bytes(64, 64))
    tag("REAL", f"staff without assets.capture_derivedartifact: HTTP {response.status_code}")
    require(response.status_code == 403, "capture permission refusal")
    response = post(allowed, png_bytes(64, 64))
    created = response.json()
    require(
        response.status_code == 201,
        f"a valid PNG capture is stored (got {response.status_code} {created})",
    )
    tag(
        "REAL",
        f"valid PNG: HTTP {response.status_code}, state {created['state']}, {created['width']}x{created['height']}",
    )
    require(response.status_code == 201, "a valid PNG capture is stored")
    response = post(allowed, webp_bytes(64, 64), name="c.webp", content_type="image/webp")
    tag("REAL", f"valid WebP: HTTP {response.status_code}")
    require(response.status_code == 201, "a valid WebP capture is stored")
    response = post(allowed, png_bytes(64, 64), sha="0" * 64)
    tag(
        "REAL",
        f"source binding (wrong source SHA-256): HTTP {response.status_code} {response.json()['error']['code']}",
    )
    require(response.status_code == 409, "a capture bound to other bytes is refused")
    response = post(allowed, b"<script>alert(1)</script>", name="x.png")
    tag("REAL", f"not an image: HTTP {response.status_code} {response.json()['error']['code']}")
    require(response.status_code == 415, "non-image bytes are refused by sniffing")
capture = DerivedArtifact.objects.filter(role="model.thumbnail").latest("created_at")
tag(
    "REAL",
    f"private record: {capture.role} producer={capture.producer} state={capture.state} "
    f"key=.../{capture.storage_key.split('/')[-2]}/<id>",
)
require(
    Client(SERVER_NAME="localhost")
    .get(f"/admin/assets/derivedartifact/{capture.pk}/media/")
    .status_code
    == 403,
    "captures are private",
)
require(snapshot(glb) == glb_before, "the model version is unchanged by captures")
tag(
    "REAL",
    "the GLB version row and bytes are unchanged; the capture is never published or promoted",
)

# =================================================================================================
step("7. optimization: Meshopt and KTX2 on repository models")
if not (HAVE_GLTFPACK and HAVE_TOKTX):
    tag(
        "SKIPPED",
        "optimization (no gltfpack/toktx: set LAI_GLTFPACK_PATH, LAI_TOKTX_PATH, LAI_KTX_LIBRARY_PATH)",
    )
    print("  SKIPPED (no gltfpack or toktx)")
else:
    optimize_handler = importlib.import_module("optimize_worker.handler")
    env = worker_env(
        "optimize", LAI_GLTFPACK_PATH=GLTFPACK, LAI_TOKTX_PATH=TOKTX, LAI_KTX_LIBRARY_PATH=KTX_LIB
    )
    optimize_settings = optimize_handler.OptimizeSettings(env)
    optimize_handler.set_registry(optimize_handler.engine_registry(optimize_settings))
    optimize_runtime = optimize_handler.OptimizeRuntime(
        optimize_settings, clients={"s3": s3, "sqs": sqs}
    )
    promoter = user_with("view_derivedartifact", "promote_derivedartifact", name="cdemo-optimizer")
    plan = (
        ("meshopt", "LAI_GLB_MESHOPT", "content/models/npc-pip-pirate.glb", "demo-pip-pirate"),
        ("ktx2", "LAI_GLB_KTX2", "react/public/models/kenney-tree-large.glb", "demo-kenney-tree"),
    )
    for variant, control, model_path, asset_id in plan:
        raw = (ROOT / model_path).read_bytes()
        asset = make_definition(asset_id, kind="prop", category="prop")
        model = services.upload_version(
            asset, io.BytesIO(raw), original_filename=Path(model_path).name
        )
        for line in validate_in_background():
            tag("MOCKED", line)
        model.refresh_from_db()
        require(model.status == VersionStatus.VALIDATED, f"{asset_id} validated before optimizing")
        model_before = snapshot(model)
        with override_settings(**{control: "on"}):
            job = optimize.submit_optimization(model, variant, user=publisher)
            tag("REAL", f"{variant}: submitted {job.kind} on the {job.queue} queue")
            done = run_queue("optimize", optimize_runtime)
            applied = consume()
        job.refresh_from_db()
        tag(
            "REAL-NATIVE",
            f"{variant}: gltfpack/toktx ran; worker {done}, Django {applied}, outcome {job.subject_outcome}",
        )
        require(job.subject_outcome == "artifacts_recorded", f"{variant} artifacts recorded")
        rows = {a.role: a for a in DerivedArtifact.objects.filter(job=job)}
        optimized = rows["model.optimized"]
        for label, value in optimize.facts_rows(optimized)[:8]:
            tag("REAL-NATIVE", f"  {label}: {value}")
        tag(
            "REAL",
            f"private artifacts: {sorted(rows)}; {model.size_bytes} -> {optimized.size_bytes} bytes",
        )
        try:
            artifact_promotion.promote_artifact(optimized, promoter)
        except Exception as refused:
            tag(
                "REAL",
                f"{variant} promotion with the control off: refused ({getattr(refused, 'code', refused)})",
            )
        else:
            raise SystemExit("demo check failed: promotion succeeded with the control off")
        with override_settings(**{control: "on"}):
            version = artifact_promotion.promote_artifact(optimized, promoter)
            for line in validate_in_background():
                tag("MOCKED", line)
            version.refresh_from_db()
            require(
                version.status == VersionStatus.VALIDATED,
                f"the {variant} model passed validation with the control on",
            )
            old = (model.metadata or {}).get("model_validation") or {}
            new = (version.metadata or {}).get("model_validation") or {}
            tag(
                "REAL",
                f"{variant} promoted to {version.label}: {version.status}, unpublished: {version.published_at is None}",
            )
            tag(
                "REAL",
                f"  validated with the control on; required extensions "
                f"{old.get('extensions_required')} -> {new.get('extensions_required')}",
            )
            tag(
                "REAL",
                f"  triangles {old.get('triangle_count')} -> {new.get('triangle_count')}, "
                f"vertices {old.get('vertex_count')} -> {new.get('vertex_count')}, "
                f"clips {len(old.get('animations') or [])} -> {len(new.get('animations') or [])}, "
                f"verdict {new.get('verdict')}",
            )
            require(
                old.get("triangle_count") == new.get("triangle_count"),
                f"{variant} preserved the triangle count",
            )
        require(snapshot(model) == model_before, f"the {variant} source model is unchanged")
        require(version.published_at is None, f"the {variant} output is not published")

# =================================================================================================
step("8. what never happened")
explicit = {ship.pk}
published_now = set(
    AssetVersion.objects.filter(published_at__isnull=False).values_list("pk", flat=True)
)
unexpected = sorted(
    v.label
    for v in AssetVersion.objects.filter(pk__in=published_now - explicit)
    if v.asset.asset_id.startswith("demo-")
)
promoted_versions = list(
    DerivedArtifact.objects.filter(state="promoted").values_list(
        "promoted_version__published_at", flat=True
    )
)
summary = {
    "aws_client_attempts": len(AWS_CLIENT_ATTEMPTS),
    "published_by_a_job_or_promotion": unexpected,
    "promoted_versions_published": sum(1 for p in promoted_versions if p is not None),
    "worker_writes_outside_artifacts": s3.denied_writes,
    "worker_artifact_objects": len(s3.writes),
    "messages_by_queue": {q: sqs.history.count(q) for q in sorted(set(sqs.history))},
    "checks_passed": len(CHECKS),
    "evidence_lines": TAGS,
}
print(json.dumps(summary, sort_keys=True))
require(
    not unexpected and summary["promoted_versions_published"] == 0,
    "nothing was published except the explicit staff publish",
)
require(not s3.denied_writes, "workers wrote nowhere outside processing/artifacts/")
require(not AWS_CLIENT_ATTEMPTS, "zero AWS client attempts")
print("\nCompletion demo: " + ", ".join(f"{n} {k}" for k, n in TAGS.items()))
