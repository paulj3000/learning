"""The GLB processing and inspection limit (`LAI_ASSET_MAX_GLB_BYTES`; owner decision 2026-11-17).

One configurable number, default 50 MiB = 52,428,800 bytes, applied to the Admin upload of a GLB,
the `asset.validate_model` request's `max_input_bytes` and the `asset.inspect` payload's
`max_bytes`, which the worker enforces. No large buffers: sizes are passed through the size
parameter, version rows or fake ports; real uploads use a 1 MiB limit and a zero-padded GLB.
No AWS.
"""

import importlib
import io
import json
import struct
import sys

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command

from apps.assets import jobs as asset_jobs
from apps.assets import services
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.processing import model_validation_request, submit_model_validation
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import (
    glb_bytes,
    gltf_document,
    gltf_json_bytes,
    make_definition,
    make_version,
)
from apps.assets.tests.media_files import png_bytes
from apps.assets.tests.test_admin import EDITORS, run_action, staff, upload_through_admin
from apps.assets.validation import max_glb_bytes, validate_model, validate_upload
from apps.jobs import services as jobs
from apps.jobs.core import tasks
from apps.jobs.models import ProcessingJob
from apps.jobs.tests.helpers import FakeS3, FakeSQS, use_sqs

MIB = 1024 * 1024
DEFAULT = 52_428_800  # 50 MiB


def codes(result) -> set[str]:
    return {finding.code for finding in result.findings}


def padded_glb(total: int) -> bytes:
    """A valid GLB of exactly `total` bytes (a multiple of 4): the test model with its binary
    buffer padded with zeros. Used for the 1 MiB limit only."""
    assert total % 4 == 0
    document, binary = gltf_document()
    for _ in range(4):  # the byteLength digits change the JSON length; settle it
        json_chunk = json.dumps(document).encode()
        json_chunk += b" " * (-len(json_chunk) % 4)
        length = total - 12 - 8 - len(json_chunk) - 8
        document["buffers"][0]["byteLength"] = length
    data = glb_bytes(document, binary + b"\x00" * (length - len(binary)))
    assert len(data) == total
    return data


@pytest.fixture(autouse=True)
def fresh_clients():
    jobs.set_aws_clients()
    yield
    jobs.set_aws_clients()


@pytest.fixture
def sqs(settings):
    fake = FakeSQS()
    use_sqs(settings)
    jobs.set_aws_clients(sqs=fake, s3=FakeS3())
    return fake


# --- settings -----------------------------------------------------------------------------------


def _load_base():
    sys.modules.pop("config.settings.base", None)  # re-read the environment
    return importlib.import_module("config.settings.base")


@pytest.fixture
def restore_base():
    yield
    sys.modules.pop("config.settings.base", None)


def test_the_default_is_50_mib(monkeypatch, restore_base):
    monkeypatch.delenv("LAI_ASSET_MAX_GLB_BYTES", raising=False)
    base = _load_base()
    assert base.LAI_ASSET_MAX_GLB_BYTES == DEFAULT == 50 * MIB
    assert base.LAI_ASSET_GLB_CEILING_BYTES == DEFAULT


@pytest.mark.parametrize("value", [str(MIB), str(10 * MIB), str(DEFAULT), " 20971520 "])
def test_allowed_values_load(monkeypatch, restore_base, value):
    monkeypatch.setenv("LAI_ASSET_MAX_GLB_BYTES", value)
    assert _load_base().LAI_ASSET_MAX_GLB_BYTES == int(value)


@pytest.mark.parametrize(
    "value", ["0", "-1", "-52428800", "abc", "1.5", "50MiB", "", str(MIB - 1), str(DEFAULT + 1)]
)
def test_invalid_values_refuse_to_start(monkeypatch, restore_base, value):
    monkeypatch.setenv("LAI_ASSET_MAX_GLB_BYTES", value)
    with pytest.raises(ImproperlyConfigured):
        _load_base()


def test_the_ceiling_is_the_glb_profile_limit_and_below_the_inspect_ceiling(settings):
    from apps.assets.processing import (
        MODEL_VALIDATION_JOB_TYPE,
        MODEL_VALIDATION_PROFILE,
        _registry,
    )
    from lai_processing.contracts.common import ProfileRef

    _processor, profile = _registry().resolve(
        MODEL_VALIDATION_JOB_TYPE, ProfileRef(*MODEL_VALIDATION_PROFILE)
    )
    assert settings.LAI_ASSET_GLB_CEILING_BYTES == profile.limits.max_input_bytes == DEFAULT
    assert settings.LAI_ASSET_GLB_CEILING_BYTES <= tasks.MAX_ASSET_BYTES == 64 * MIB


def test_the_effective_limit_never_exceeds_the_model_upload_limit(settings):
    assert max_glb_bytes() == DEFAULT
    settings.LAI_ASSET_MAX_GLB_BYTES = 10 * MIB
    assert max_glb_bytes() == 10 * MIB
    settings.LAI_ASSET_MAX_UPLOAD_BYTES = 2 * MIB
    assert max_glb_bytes() == 2 * MIB


# --- synchronous validation (sizes through the size parameter) ----------------------------------


@pytest.mark.parametrize("limit", [DEFAULT, 10 * MIB])
@pytest.mark.parametrize(("offset", "refused"), [(-1, False), (0, False), (1, True)])
def test_a_glb_one_byte_below_at_and_above_the_limit(settings, limit, offset, refused):
    settings.LAI_ASSET_MAX_GLB_BYTES = limit
    result = validate_model(io.BytesIO(glb_bytes()), size=limit + offset)
    # The tiny stream does not match the claimed size, so a file inside the limit fails later
    # (glb_length); only one above it is too_large.
    assert ("too_large" in codes(result)) is refused, result.report()
    if refused:
        assert codes(result) == {"too_large"}
        assert f"{limit:,} bytes" in result.findings[0].message


def test_an_oversized_glb_is_refused_from_its_header_without_reading_on(settings):
    settings.LAI_ASSET_MAX_GLB_BYTES = MIB

    class HeaderOnly(io.BytesIO):
        def read(self, size=-1):
            assert self.tell() == 0 and 0 <= size <= 12, "must not read past the header"
            return super().read(size)

    result = validate_model(HeaderOnly(glb_bytes()), size=MIB + 1)
    assert codes(result) == {"too_large"}


def test_other_asset_types_keep_their_own_limits(settings):
    settings.LAI_ASSET_MAX_GLB_BYTES = MIB
    gltf = validate_model(io.BytesIO(gltf_json_bytes()), size=2 * MIB)
    assert "too_large" not in codes(gltf)
    image = validate_upload(io.BytesIO(png_bytes()), size=2 * MIB)
    assert "too_large" not in codes(image)
    # The model upload limit still applies to .gltf, unchanged.
    gltf = validate_model(io.BytesIO(gltf_json_bytes()), size=DEFAULT + 1)
    assert codes(gltf) == {"too_large"}


# --- upload (service and Admin) -----------------------------------------------------------------


def nothing_left(storage):
    return (
        not AssetVersion.objects.exists()
        and not ProcessingJob.objects.exists()
        and not list(storage.list())
    )


@pytest.mark.postgres
@pytest.mark.django_db
@pytest.mark.parametrize("flag", ["off", "on"])
@pytest.mark.parametrize(("size", "stored"), [(MIB - 4, True), (MIB, True), (MIB + 4, False)])
def test_upload_at_a_1_mib_limit(settings, storage, monkeypatch, flag, size, stored):
    settings.LAI_ASSET_MAX_GLB_BYTES = MIB
    settings.LAI_ASSET_ASYNC_VALIDATION = flag
    asset = make_definition("npc-pip")
    data = padded_glb(size)
    if stored:
        version = services.upload_version(asset, io.BytesIO(data), original_filename="pip.glb")
        assert version.size_bytes == size
        return

    def no_hashing(stream):
        raise AssertionError("an oversized upload must be refused before it is hashed")

    monkeypatch.setattr(services, "sha256_of", no_hashing)
    with pytest.raises(AssetActionRefused) as refused:
        services.upload_version(asset, io.BytesIO(data), original_filename="pip.glb")
    assert refused.value.code == "invalid_file"
    assert [f.code for f in refused.value.findings] == ["too_large"]
    assert nothing_left(storage)


@pytest.mark.postgres
@pytest.mark.django_db
def test_upload_one_byte_above_the_limit_is_too_large(settings, storage):
    settings.LAI_ASSET_MAX_GLB_BYTES = MIB
    data = padded_glb(MIB) + b"\x00"  # header says MIB; the size check runs first
    with pytest.raises(AssetActionRefused) as refused:
        services.upload_version(
            make_definition("npc-pip"), io.BytesIO(data), original_filename="pip.glb"
        )
    assert [f.code for f in refused.value.findings] == ["too_large"]
    assert nothing_left(storage)


@pytest.mark.postgres
@pytest.mark.django_db
@pytest.mark.parametrize("flag", ["off", "on"])
def test_an_oversized_admin_upload_shows_the_safe_finding_and_stores_nothing(
    settings, storage, flag
):
    call_command("ensure_asset_roles", verbosity=0)
    settings.LAI_ASSET_MAX_GLB_BYTES = MIB
    settings.LAI_ASSET_ASYNC_VALIDATION = flag
    editor = staff("editor", EDITORS)
    response = upload_through_admin(editor, make_definition("npc-pip"), padded_glb(MIB + 4))
    assert response.status_code == 200
    body = response.content.decode()
    assert "The file did not pass validation." in body
    assert f"the limit for GLB models is {MIB:,} bytes" in body
    assert nothing_left(storage)


# --- background validation ----------------------------------------------------------------------


@pytest.mark.postgres
@pytest.mark.django_db
@pytest.mark.parametrize("limit", [DEFAULT, 10 * MIB])
@pytest.mark.parametrize(("offset", "refused"), [(-1, False), (0, False), (1, True)])
def test_the_validation_request_carries_the_limit(settings, limit, offset, refused):
    settings.LAI_ASSET_MAX_GLB_BYTES = limit
    version = make_version(make_definition("npc-pip"), size_bytes=limit + offset)
    if not refused:
        request = model_validation_request(version, job_id="0" * 8 + "-0000-4000-8000-" + "0" * 12)
        assert request["limits"]["max_input_bytes"] == limit
        assert request["limits"]["max_execution_seconds"] == 90
        return
    from lai_processing.core.errors import ProcessingError

    with pytest.raises(ProcessingError) as error:
        model_validation_request(version, job_id="0" * 8 + "-0000-4000-8000-" + "0" * 12)
    assert error.value.code.value == "resource_limit_exceeded"


@pytest.mark.postgres
@pytest.mark.django_db
def test_an_oversized_background_validation_is_a_safe_jobs_error_and_leaves_no_job(settings, sqs):
    version = make_version(
        make_definition("npc-pip"), status=VersionStatus.DRAFT, size_bytes=DEFAULT + 1
    )
    with pytest.raises(jobs.JobsError) as error:
        submit_model_validation(version, user=None)
    assert error.value.code == "resource_limit_exceeded"
    assert not ProcessingJob.objects.exists() and not sqs.sent
    version.refresh_from_db()
    assert version.status == VersionStatus.DRAFT


@pytest.mark.postgres
@pytest.mark.django_db
def test_validate_in_background_reports_an_oversized_published_model_and_changes_nothing(
    settings, sqs
):
    """A GLB published before the limit was lowered is never invalidated: revalidating it is
    refused with a safe code, and it stays published and delivered."""
    call_command("ensure_asset_roles", verbosity=0)
    settings.LAI_ASSET_MAX_GLB_BYTES = 10 * MIB
    asset = make_definition("npc-pip")
    big = make_version(asset, status=VersionStatus.PUBLISHED, size_bytes=10 * MIB + 1)
    fits = make_version(asset, status=VersionStatus.VALIDATED, size_bytes=10 * MIB)
    editor = staff("editor", EDITORS)
    response = run_action(editor, "validate_in_background", big, fits)
    body = response.content.decode()
    assert "limit for GLB models, so it was not validated (resource_limit_exceeded)." in body
    assert f"{10 * MIB:,} byte" in body
    jobs_left = ProcessingJob.objects.all()
    assert [job.subject_id for job in jobs_left] == [str(fits.pk)]
    assert jobs_left[0].payload["limits"]["max_input_bytes"] == 10 * MIB
    big.refresh_from_db()
    assert big.status == VersionStatus.PUBLISHED and big.published_at is not None


# --- inspection ---------------------------------------------------------------------------------


@pytest.mark.postgres
@pytest.mark.django_db
@pytest.mark.parametrize("limit", [DEFAULT, 10 * MIB])
@pytest.mark.parametrize(("offset", "refused"), [(-1, False), (0, False), (1, True)])
def test_inspection_submission_carries_and_enforces_the_limit(
    settings, sqs, limit, offset, refused
):
    settings.LAI_ASSET_MAX_GLB_BYTES = limit
    version = make_version(make_definition("npc-pip"), size_bytes=limit + offset)
    if refused:
        with pytest.raises(jobs.JobsError) as error:
            asset_jobs.submit_inspection(version, None)
        assert error.value.code == "object_too_large"
        assert not ProcessingJob.objects.exists() and not sqs.sent
        return
    job = asset_jobs.submit_inspection(version, None)
    assert job.payload == {
        "storage_key": version.storage_key,
        "format": "glb",
        "max_bytes": limit,
    }


@pytest.mark.postgres
@pytest.mark.django_db
def test_other_formats_are_inspected_without_a_glb_limit(settings, sqs):
    settings.LAI_ASSET_MAX_GLB_BYTES = MIB
    asset = make_definition("npc-pip")
    gltf = make_version(
        asset,
        format="gltf",
        content_type="model/gltf+json",
        storage_key="assets/models/npc-pip/0b0b0b0b-0000-4000-8000-000000000000/model.gltf",
        size_bytes=2 * MIB,
    )
    job = asset_jobs.submit_inspection(gltf, None)
    assert job.payload == {"storage_key": gltf.storage_key, "format": "gltf"}


@pytest.mark.postgres
@pytest.mark.django_db
def test_inspect_in_background_reports_an_oversized_glb_and_inspects_the_rest(settings, sqs):
    call_command("ensure_asset_roles", verbosity=0)
    settings.LAI_ASSET_MAX_GLB_BYTES = 10 * MIB
    asset = make_definition("npc-pip")
    big = make_version(asset, status=VersionStatus.PUBLISHED, size_bytes=10 * MIB + 1)
    fits = make_version(asset, size_bytes=10 * MIB)
    editor = staff("editor", EDITORS)
    response = run_action(editor, "inspect_in_background", big, fits)
    body = response.content.decode()
    assert "limit for GLB models, so it was not inspected." in body
    assert "Inspection submitted for 1 version(s)" in body
    assert [job.subject_id for job in ProcessingJob.objects.all()] == [str(fits.pk)]
    big.refresh_from_db()
    assert big.status == VersionStatus.PUBLISHED


class SizedPorts:
    """`asset.inspect` ports with a faked object size; reading past the size check is recorded."""

    def __init__(self, size: int):
        self.size = size
        self.read = False

    def asset_object_size(self, key):
        return self.size

    def read_asset(self, key, start, length):
        self.read = True
        data = glb_bytes()
        return data[start : start + length]


KEY = "assets/models/npc-pip/0a0a0a0a-0000-4000-8000-000000000000/model.glb"


@pytest.mark.parametrize("limit", [DEFAULT, 10 * MIB])
@pytest.mark.parametrize(("offset", "refused"), [(-1, False), (0, False), (1, True)])
def test_the_worker_enforces_the_payload_limit(limit, offset, refused):
    ports = SizedPorts(limit + offset)
    payload = {"storage_key": KEY, "format": "glb", "max_bytes": limit}
    if refused:
        with pytest.raises(tasks.TaskError) as error:
            tasks.asset_inspect(payload, ports)
        assert error.value.code == "object_too_large" and not error.value.retryable
        assert not ports.read
    else:
        assert tasks.asset_inspect(payload, ports)["size_bytes"] == limit + offset
        assert ports.read


@pytest.mark.parametrize(
    ("size", "refused"), [(64 * MIB - 1, False), (64 * MIB, False), (64 * MIB + 1, True)]
)
def test_an_old_payload_without_the_field_keeps_the_64_mib_ceiling(size, refused):
    ports = SizedPorts(size)
    payload = {"storage_key": KEY, "format": "glb"}
    if refused:
        with pytest.raises(tasks.TaskError, match="object_too_large"):
            tasks.asset_inspect(payload, ports)
    else:
        assert tasks.asset_inspect(payload, ports)["size_bytes"] == size


def test_a_payload_limit_above_the_hard_ceiling_is_clamped():
    payload = {"storage_key": KEY, "format": "glb", "max_bytes": 128 * MIB}
    with pytest.raises(tasks.TaskError, match="object_too_large"):
        tasks.asset_inspect(payload, SizedPorts(64 * MIB + 1))


@pytest.mark.parametrize("value", [0, -1, "52428800", 1.5, True, None, 2**60])
def test_an_invalid_payload_limit_is_invalid_payload(value):
    payload = {"storage_key": KEY, "format": "glb", "max_bytes": value}
    with pytest.raises(tasks.TaskError, match="invalid_payload"):
        tasks.asset_inspect(payload, SizedPorts(10))


def test_unknown_payload_fields_are_still_refused():
    payload = {"storage_key": KEY, "format": "glb", "max_bytes": MIB, "extra": 1}
    with pytest.raises(tasks.TaskError, match="invalid_payload"):
        tasks.asset_inspect(payload, SizedPorts(10))


def test_padded_glb_helper_is_a_valid_model():
    data = padded_glb(MIB)
    assert struct.unpack_from("<I", data, 8)[0] == MIB
    assert validate_model(io.BytesIO(data), size=len(data)).passed
