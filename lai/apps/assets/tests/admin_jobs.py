"""Model validation jobs attached to asset versions, for the admin tests (LAI-LAMBDA-007).

Jobs are submitted for real with `submit_model_validation` on the SQS backend with fake clients
(inside a test transaction the on-commit send never runs, so the row stays PENDING and
undispatched), then moved to the state under test by writing the row. A completed job's result
is the real contract result: `apps.jobs.core.contract.run` over the GLB bytes in the in-memory
asset store, exactly what the worker would report. No AWS, no network.
"""

import hashlib
import importlib.util
import io
import sys
from pathlib import Path

from django.utils import timezone

from apps.assets.jobs import InlinePorts
from apps.assets.models import VersionStatus
from apps.assets.processing import submit_model_validation
from apps.assets.storage import get_storage
from apps.assets.tests.helpers import make_definition, make_version
from apps.jobs import services as jobs
from apps.jobs.core import contract
from apps.jobs.models import JobStatus
from apps.jobs.tests.helpers import FakeSQS, use_sqs

MIXAMO = "Armature|mixamo.com|Layer0"
_BUILDER = Path(__file__).resolve().parents[4] / "tests/processing/glb_builder.py"


def _builder():
    name = "lai_glb_builder"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, _BUILDER)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module  # dataclasses resolve annotations through sys.modules
        spec.loader.exec_module(module)
    return sys.modules[name]


def model_glb(
    clips=(MIXAMO, "Idle"),
    *,
    material="Body",
    skin="Armature",
    generator="Blender 4.2",
    texture=(64, 32),
) -> bytes:
    """A valid skinned, textured, animated GLB: one quad (2 triangles, 4 vertices), a skin with
    two joints, one PNG texture of `texture` pixels, and one clip per name (clip `i` lasts
    `1.25 * (i + 1)` seconds)."""
    builder = _builder()
    document, binary = builder.skinned_model(tuple(clips))
    data = bytearray(binary)
    image = builder.png(*texture)
    offset = len(data)
    data += image
    while len(data) % 4:
        data.append(0)
    document["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(image)})
    document["buffers"][0]["byteLength"] = len(data)
    document["images"] = [{"bufferView": len(document["bufferViews"]) - 1, "mimeType": "image/png"}]
    document["textures"] = [{"source": 0}]
    document["materials"] = [
        {"name": material, "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}
    ]
    document["meshes"][0]["primitives"][0]["material"] = 0
    document["skins"][0]["name"] = skin
    document["asset"]["generator"] = generator
    return builder.glb(document, bytes(data))


def stored_version(data=None, *, asset_id="npc-pip", status=VersionStatus.VALIDATED, **fields):
    """A version row whose file is in the asset store, so the validator can read it."""
    data = model_glb() if data is None else data
    asset = make_definition(asset_id)
    version = make_version(
        asset,
        status=status,
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
        **fields,
    )
    get_storage().put(
        version.storage_key,
        io.BytesIO(data),
        content_type=version.content_type,
        sha256=version.sha256,
    )
    return version


def use_fake_sqs(settings) -> FakeSQS:
    """The SQS backend with a fake client (call `jobs.set_aws_clients()` afterwards)."""
    use_sqs(settings)
    sqs = FakeSQS()
    jobs.set_aws_clients(sqs=sqs)
    return sqs


def submit(version, user=None):
    """A PENDING, undispatched validation job for `version` (needs `use_fake_sqs`)."""
    job = submit_model_validation(version, user=user)
    assert job.status == JobStatus.PENDING
    return job


def set_status(job, status, **fields):
    job.status = status
    for name, value in fields.items():
        setattr(job, name, value)
    job.save()
    return job


def real_result(job) -> dict:
    """The worker's contract result for `job`, computed over the stored bytes."""
    return contract.run(job.kind, job.payload, InlinePorts())


def dispatched(job):
    return set_status(job, JobStatus.PENDING, dispatched_at=timezone.now())


def running(job):
    stamp = timezone.now()
    return set_status(job, JobStatus.RUNNING, dispatched_at=stamp, started_at=stamp, attempts=1)


def completed(job, *, result=None, outcome="result_recorded", deliveries=2):
    stamp = timezone.now()
    return set_status(
        job,
        JobStatus.COMPLETED,
        dispatched_at=stamp,
        started_at=stamp,
        finished_at=stamp,
        attempts=1,
        deliveries=deliveries,
        result=real_result(job) if result is None else result,
        subject_outcome=outcome,
    )


def failed(job, code="processor_error", *, outcome="processing_failed"):
    stamp = timezone.now()
    return set_status(
        job,
        JobStatus.FAILED,
        finished_at=stamp,
        started_at=stamp,
        error_code=code,
        subject_outcome=outcome,
    )
