"""How `contract.PortStorage` turns asset-port `TaskError`s into the `lai_processing` storage
errors (docs/processing/CANONICAL_PATH.md, "Asset read errors"): a missing object is
`ObjectMissing` (permanent `input_missing`), a denial is `StoragePermissionDenied`, throttling is
`THROTTLED`, other retryable faults are `StorageUnavailable`. No database, no AWS."""

import hashlib
import io
import uuid

import pytest

from apps.assets.jobs import InlinePorts
from apps.assets.storage import get_storage, reset_storage_cache
from apps.jobs.core import contract
from apps.jobs.core.tasks import TaskError

KEY = f"assets/models/pip-boat/{uuid.uuid4()}/model.glb"


class Ports:
    def __init__(self, *, size=None, head_error=None, read_error=None):
        self.size, self.head_error, self.read_error = size, head_error, read_error

    def asset_object_size(self, key):
        if self.head_error:
            raise self.head_error
        return self.size

    def read_asset(self, key, start, length):
        if self.read_error:
            raise self.read_error
        return b"\x00" * length


def ref():
    from lai_processing.contracts.common import ObjectRef

    return ObjectRef("assets", KEY, None, "local")


def classified(exc):
    from lai_processing.core.errors import error_from_exception

    error = error_from_exception(exc)
    return error.code.value, error.retry_class.value


CASES = [
    (TaskError("object_missing"), "ObjectMissing", ("input_missing", "manual")),
    (TaskError("access_denied"), "StoragePermissionDenied", ("permission_denied", "manual")),
    (TaskError("throttled", retryable=True), "ProcessingError", ("throttled", "retryable")),
    (TaskError("storage", retryable=True), "StorageUnavailable", ("storage_failure", "retryable")),
    (TaskError("timeout", retryable=True), "StorageUnavailable", ("storage_failure", "retryable")),
    (TaskError("other"), "ProcessingError", ("unexpected_failure", "manual")),
]


@pytest.mark.parametrize(("error", "kind", "expected"), CASES)
def test_head_errors_keep_their_class(error, kind, expected):
    with pytest.raises(Exception) as raised:
        contract.PortStorage(Ports(head_error=error)).head(ref())
    assert type(raised.value).__name__ == kind
    assert classified(raised.value) == expected


@pytest.mark.parametrize(("error", "kind", "expected"), CASES)
def test_ranged_read_errors_keep_their_class(error, kind, expected):
    stream = contract.PortStorage(Ports(size=8, read_error=error)).open(ref())
    with pytest.raises(Exception) as raised:
        stream.read()
    assert type(raised.value).__name__ == kind
    assert classified(raised.value) == expected


def test_a_missing_object_is_object_missing_not_storage_unavailable():
    from lai_processing.ports.storage import ObjectMissing

    with pytest.raises(ObjectMissing):
        contract.PortStorage(Ports(size=None)).head(ref())


def test_inline_ports_report_an_object_gone_before_the_read_as_missing(settings):
    settings.LAI_ASSET_STORAGE = "memory"
    reset_storage_cache()
    try:
        ports = InlinePorts()
        assert ports.asset_object_size(KEY) is None
        with pytest.raises(TaskError) as raised:
            ports.read_asset(KEY, 0, 4)
        assert (raised.value.code, raised.value.retryable) == ("object_missing", False)
        data = b"glTF0000"
        get_storage().put(
            KEY,
            io.BytesIO(data),
            content_type="model/gltf-binary",
            sha256=hashlib.sha256(data).hexdigest(),
        )
        assert ports.asset_object_size(KEY) == len(data)
        assert ports.read_asset(KEY, 0, 4) == b"glTF"
    finally:
        reset_storage_cache()
