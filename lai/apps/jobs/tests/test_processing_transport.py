"""The transport factory (every backend) and the LAI_PROCESSING_* settings."""

import sys
import types
from pathlib import Path

import pytest
from django.core.exceptions import ImproperlyConfigured

from apps.jobs import processing_transport as transport
from lai_processing.contracts.identifiers import StoreName
from lai_processing.testing import MemoryQueue

from .test_jobs_admin_settings import _load

WORK_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-processing-work"
DONE_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-processing-completions"
BUCKET = "lai-processing-dev-123456789012-us-west-1"


@pytest.fixture
def runtime(monkeypatch):
    """A stand-in `lai_processing_runtime` (Workstream B) recording constructor arguments."""
    module = types.ModuleType("lai_processing_runtime")

    def recorder(name):
        class Adapter:
            def __init__(self, *args, **kwargs):
                self.kind, self.args, self.kwargs = name, args, kwargs

        return Adapter

    for name in ("SqsMessageQueue", "S3ObjectStorage", "LocalDirectoryQueue"):
        setattr(module, name, recorder(name))
    module.FilesystemObjectStorage = recorder("FilesystemObjectStorage")
    monkeypatch.setitem(sys.modules, "lai_processing_runtime", module)
    clients = []
    monkeypatch.setattr(
        transport,
        "_aws_client",
        lambda service, region: clients.append((service, region)) or f"{service}-client",
    )
    transport.reset_transport()
    yield clients
    transport.reset_transport()


def test_sqs_builds_runtime_adapters_lazily(settings, runtime):
    settings.LAI_PROCESSING_BACKEND = "sqs"
    settings.LAI_PROCESSING_WORK_QUEUE_URL = WORK_URL
    settings.LAI_PROCESSING_COMPLETION_QUEUE_URL = DONE_URL
    settings.LAI_PROCESSING_BUCKET = BUCKET
    settings.LAI_ASSET_BUCKET = "lai-assets-dev"
    work = transport.work_queue()
    assert (work.kind, work.args) == ("SqsMessageQueue", ("sqs-client", WORK_URL))
    assert work.kwargs == {"max_message_bytes": 240 * 1024}
    assert transport.completion_queue().args[1] == DONE_URL
    storage = transport.object_storage()
    assert storage.kind == "S3ObjectStorage" and storage.kwargs == {"writable": frozenset()}
    assert storage.args[1] == {
        StoreName.ASSETS: "lai-assets-dev",
        StoreName.QUARANTINE: BUCKET,
        StoreName.ARTIFACTS: BUCKET,
    }
    assert ("sqs", "us-west-1") in runtime and ("s3", "us-west-1") in runtime
    assert transport.work_queue() is work  # built once per process


def test_local_maps_stores_and_queues_to_directories(settings, runtime, tmp_path):
    settings.LAI_PROCESSING_BACKEND = "local"
    settings.LAI_PROCESSING_LOCAL_ROOT = tmp_path / "proc"
    settings.LAI_ASSET_LOCAL_ROOT = tmp_path / "assets"
    assert transport.work_queue().args == (tmp_path / "proc" / "queues" / "work",)
    assert transport.completion_queue().args == (tmp_path / "proc" / "queues" / "completions",)
    storage = transport.object_storage()
    assert storage.args[0] == {
        StoreName.ASSETS: Path(tmp_path / "assets"),
        StoreName.QUARANTINE: tmp_path / "proc",
        StoreName.ARTIFACTS: tmp_path / "proc",
    }
    assert runtime == []  # no AWS client for the local backend


def test_inline_and_disabled_and_the_test_seam(settings):
    transport.reset_transport()
    settings.LAI_PROCESSING_BACKEND = "inline"
    assert isinstance(transport.work_queue(), MemoryQueue)
    assert transport.work_queue() is not transport.completion_queue()
    assert isinstance(transport.object_storage(), transport.DjangoAssetObjectStorage)
    settings.LAI_PROCESSING_BACKEND = "disabled"
    with pytest.raises(transport.ProcessingTransportDisabled):
        transport.work_queue()
    fake = MemoryQueue()
    transport.set_transport_for_tests(work=fake)
    assert transport.work_queue() is fake
    with pytest.raises(transport.ProcessingTransportDisabled):
        transport.completion_queue()
    transport.reset_transport()


def test_inline_asset_store_is_read_only():
    import io

    from lai_processing.contracts.common import ObjectRef
    from lai_processing.ports.storage import ObjectMissing, StoragePermissionDenied

    store = transport.DjangoAssetObjectStorage()
    ref = ObjectRef(StoreName.ASSETS, "assets/models/a/b/model.glb")
    with pytest.raises(StoragePermissionDenied):
        store.put(ref, io.BytesIO(b""), content_type="x/y", sha256="0" * 64, size_bytes=0)
    with pytest.raises(StoragePermissionDenied):
        store.delete(ref)
    with pytest.raises(ObjectMissing):
        store.head(ObjectRef(StoreName.ASSETS, ref.key, "v1"))


# --- settings ----------------------------------------------------------------------------------

PROCESSING_ENV = (
    "LAI_PROCESSING_BACKEND",
    "LAI_PROCESSING_NAMESPACE",
    "LAI_PROCESSING_WORK_QUEUE_URL",
    "LAI_PROCESSING_COMPLETION_QUEUE_URL",
    "LAI_PROCESSING_BUCKET",
    "LAI_PROCESSING_DISPATCH",
    "LAI_PROCESSING_MAX_ATTEMPTS",
    "LAI_PROCESSING_JOB_TTL_HOURS",
    "LAI_PROCESSING_LOCAL_ROOT",
)


@pytest.fixture
def clean_env(monkeypatch):
    for name in PROCESSING_ENV:
        monkeypatch.delenv(name, raising=False)
    yield monkeypatch
    sys.modules.pop("config.settings.base", None)
    sys.modules.pop("config.settings.production", None)


def sqs_env(monkeypatch):
    monkeypatch.setenv("LAI_PROCESSING_BACKEND", "sqs")
    monkeypatch.setenv("LAI_PROCESSING_WORK_QUEUE_URL", WORK_URL)
    monkeypatch.setenv("LAI_PROCESSING_COMPLETION_QUEUE_URL", DONE_URL)
    monkeypatch.setenv("LAI_PROCESSING_BUCKET", BUCKET)


def test_base_defaults(clean_env):
    base = _load("config.settings.base")
    assert (base.LAI_PROCESSING_BACKEND, base.LAI_PROCESSING_NAMESPACE) == ("inline", "local")
    assert base.LAI_PROCESSING_DISPATCH == "enabled"
    assert (base.LAI_PROCESSING_MAX_ATTEMPTS, base.LAI_PROCESSING_JOB_TTL_HOURS) == (3, 72)
    assert base.LAI_PROCESSING_LOCAL_ROOT == base.BASE_DIR / ".processing-local"


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("LAI_PROCESSING_BACKEND", "lambda"),
        ("LAI_PROCESSING_NAMESPACE", "Dev"),
        ("LAI_PROCESSING_NAMESPACE", "dev_1"),
        ("LAI_PROCESSING_NAMESPACE", "a" * 33),
        ("LAI_PROCESSING_NAMESPACE", "-dev"),
        ("LAI_PROCESSING_DISPATCH", "stopped"),
        ("LAI_PROCESSING_MAX_ATTEMPTS", "0"),
        ("LAI_PROCESSING_MAX_ATTEMPTS", "11"),
        ("LAI_PROCESSING_JOB_TTL_HOURS", "0"),
        ("LAI_PROCESSING_JOB_TTL_HOURS", "337"),
    ],
)
def test_base_refuses_invalid_values(clean_env, name, value):
    clean_env.setenv(name, value)
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.base")


def test_base_validates_sqs(clean_env):
    sqs_env(clean_env)
    clean_env.setenv("LAI_PROCESSING_NAMESPACE", "dev")
    assert _load("config.settings.base").LAI_PROCESSING_BUCKET == BUCKET
    for name, bad in (
        ("LAI_PROCESSING_WORK_QUEUE_URL", "http://example.com/q"),
        ("LAI_PROCESSING_COMPLETION_QUEUE_URL", ""),
        ("LAI_PROCESSING_BUCKET", ""),
        ("LAI_PROCESSING_BUCKET", "Not_A_Bucket"),
    ):
        sqs_env(clean_env)
        clean_env.setenv(name, bad)
        with pytest.raises(ImproperlyConfigured):
            _load("config.settings.base")


def test_production_processing_settings(clean_env):
    from apps.core.tests.test_settings import _prod_env

    _prod_env(clean_env)
    assert _load("config.settings.production").LAI_PROCESSING_BACKEND == "disabled"
    for mode in ("inline", "local"):
        clean_env.setenv("LAI_PROCESSING_BACKEND", mode)
        with pytest.raises(ImproperlyConfigured):
            _load("config.settings.production")
    sqs_env(clean_env)
    with pytest.raises(ImproperlyConfigured):  # the namespace must be explicit
        _load("config.settings.production")
    clean_env.setenv("LAI_PROCESSING_NAMESPACE", "dev")
    prod = _load("config.settings.production")
    assert (prod.LAI_PROCESSING_BACKEND, prod.LAI_PROCESSING_NAMESPACE) == ("sqs", "dev")


def test_test_settings_use_inline_and_the_test_namespace(settings):
    assert settings.LAI_PROCESSING_BACKEND in {"inline", "local", "sqs", "disabled"}
    from config.settings import test as test_settings

    assert (test_settings.LAI_PROCESSING_BACKEND, test_settings.LAI_PROCESSING_NAMESPACE) == (
        "inline",
        "test",
    )
