"""FilesystemObjectStorage: containment, symlink refusal, create-only atomic puts, versions."""

from __future__ import annotations

import hashlib
import io
import os
import threading
from pathlib import Path

import pytest

from lai_processing.contracts.common import ObjectRef
from lai_processing.contracts.identifiers import StoreName
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.ports.storage import (
    ObjectExists,
    ObjectMissing,
    ObjectStorage,
    StoragePermissionDenied,
)
from lai_processing_runtime.filesystem import FilesystemObjectStorage, content_version_id

NS = "local"
JOB = "6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f"
ATTEMPT = "0b9a8c7d-6e5f-4a3b-9c2d-1e0f2a3b4c5d"
Q_KEY = f"processing/quarantine/{NS}/{JOB}/input.bin"
A_KEY = f"processing/artifacts/{NS}/{JOB}/{ATTEMPT}/report.json"
ASSET_KEY = "assets/models/npc-pip/v1/model.glb"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def storage(tmp_path: Path, **kwargs: object) -> FilesystemObjectStorage:
    roots = {
        StoreName.ASSETS: tmp_path / "assets-root",
        StoreName.QUARANTINE: tmp_path / "proc",
        StoreName.ARTIFACTS: tmp_path / "proc",
    }
    return FilesystemObjectStorage(roots, **kwargs)  # type: ignore[arg-type]


def place(root: Path, key: str, data: bytes) -> Path:
    path = root / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def qref(version: str | None = None) -> ObjectRef:
    return ObjectRef(StoreName.QUARANTINE, Q_KEY, version, NS)


def aref() -> ObjectRef:
    return ObjectRef(StoreName.ARTIFACTS, A_KEY, None, NS)


def put(s: FilesystemObjectStorage, ref: ObjectRef, data: bytes) -> object:
    return s.put(
        ref,
        io.BytesIO(data),
        content_type="application/json",
        sha256=sha(data),
        size_bytes=len(data),
    )


def test_implements_the_port(tmp_path: Path) -> None:
    assert isinstance(storage(tmp_path), ObjectStorage)


def test_head_open_read_of_an_input(tmp_path: Path) -> None:
    s = storage(tmp_path)
    place(tmp_path / "proc", Q_KEY, b"hello")
    info = s.head(qref())
    assert info.size_bytes == 5
    assert info.sha256 == sha(b"hello")
    assert info.version_id == content_version_id(sha(b"hello")) == f"sha256-{sha(b'hello')}"
    assert info.ref.version_id == info.version_id
    assert info.content_type is None
    with s.open(qref()) as stream:
        assert stream.read() == b"hello"
    assert s.read(qref(), max_bytes=5) == b"hello"


def test_version_ids_are_deterministic_and_accepted_by_object_ref(tmp_path: Path) -> None:
    place(tmp_path / "proc", Q_KEY, b"same")
    first = storage(tmp_path).head(qref()).version_id
    second = storage(tmp_path).head(qref()).version_id
    assert first == second
    assert first is not None
    ObjectRef(StoreName.QUARANTINE, Q_KEY, first, NS)  # matches the contract alphabet


def test_version_pinned_reads(tmp_path: Path) -> None:
    s = storage(tmp_path)
    path = place(tmp_path / "proc", Q_KEY, b"one")
    pinned = s.head(qref()).version_id
    assert s.head(qref(pinned)).sha256 == sha(b"one")
    with s.open(qref(pinned)) as stream:
        assert stream.read() == b"one"
    path.write_bytes(b"two")  # the key now holds different bytes
    with pytest.raises(ObjectMissing):
        s.head(qref(pinned))
    with pytest.raises(ObjectMissing):
        s.open(qref(pinned))
    with pytest.raises(ObjectMissing):
        s.head(qref("sha256-" + "0" * 64))


def test_read_refuses_oversize(tmp_path: Path) -> None:
    place(tmp_path / "proc", Q_KEY, b"x" * 10)
    with pytest.raises(ProcessingError) as caught:
        storage(tmp_path).read(qref(), max_bytes=9)
    assert caught.value.code is ErrorCode.RESOURCE_LIMIT_EXCEEDED


def test_missing_objects_and_directories(tmp_path: Path) -> None:
    s = storage(tmp_path)
    with pytest.raises(ObjectMissing):
        s.head(qref())
    (tmp_path / "proc" / Q_KEY).mkdir(parents=True)  # a directory at the key is not an object
    with pytest.raises(ObjectMissing):
        s.head(qref())


def test_assets_store_maps_to_assets_root_key_layout(tmp_path: Path) -> None:
    s = storage(tmp_path)
    place(tmp_path / "assets-root", ASSET_KEY, b"glb")
    ref = ObjectRef(StoreName.ASSETS, ASSET_KEY, None, NS)
    assert s.read(ref, max_bytes=10) == b"glb"
    with pytest.raises(StoragePermissionDenied):
        put(s, ref, b"x")
    with pytest.raises(StoragePermissionDenied):
        s.delete(ref)


# Traversal and symlinks -------------------------------------------------------------------


@pytest.mark.parametrize(
    "key",
    [
        f"processing/quarantine/{NS}/../../../etc/passwd",
        "/etc/passwd",
        f"processing/quarantine/{NS}/./x",
        f"processing/quarantine/{NS}//x",
        f"processing/quarantine/{NS}/a\\b",
        "processing/quarantine/other/x",
        "assets/x",
    ],
)
def test_traversal_and_foreign_keys_are_refused(tmp_path: Path, key: str) -> None:
    s = storage(tmp_path)
    bad = object.__new__(ObjectRef)  # bypass ObjectRef's own check: the adapter re-validates
    object.__setattr__(bad, "store", StoreName.QUARANTINE)
    object.__setattr__(bad, "key", key)
    object.__setattr__(bad, "version_id", None)
    object.__setattr__(bad, "namespace", NS)
    for call in (s.head, s.open):
        with pytest.raises(ProcessingError) as caught:
            call(bad)
        assert caught.value.code is ErrorCode.INVALID_OBJECT_REFERENCE


def test_symlink_in_a_parent_directory_is_refused(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    place(outside, f"{JOB}/input.bin", b"secret")
    parent = tmp_path / "proc" / "processing" / "quarantine"
    parent.mkdir(parents=True)
    os.symlink(outside, parent / NS)
    s = storage(tmp_path)
    with pytest.raises(StoragePermissionDenied) as caught:
        s.head(qref())
    assert caught.value.details["reason"] == "symlink"
    with pytest.raises(StoragePermissionDenied):
        s.open(qref())


def test_symlink_as_the_final_file_is_refused(tmp_path: Path) -> None:
    target = tmp_path / "secret.txt"
    target.write_bytes(b"secret")
    link = tmp_path / "proc" / Q_KEY
    link.parent.mkdir(parents=True)
    os.symlink(target, link)
    s = storage(tmp_path)
    for call in (s.head, s.open):
        with pytest.raises(StoragePermissionDenied) as caught:
            call(qref())
        assert caught.value.details["reason"] == "symlink"


def test_symlinked_artifact_directory_is_refused_on_put(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    base = tmp_path / "proc" / "processing" / "artifacts" / NS
    base.mkdir(parents=True)
    os.symlink(outside, base / JOB)
    with pytest.raises(StoragePermissionDenied):
        put(storage(tmp_path), aref(), b"{}")
    assert list(outside.iterdir()) == []


def test_symlink_at_the_artifact_key_is_never_followed_or_overwritten(tmp_path: Path) -> None:
    target = tmp_path / "victim.txt"
    target.write_bytes(b"victim")
    link = tmp_path / "proc" / A_KEY
    link.parent.mkdir(parents=True)
    os.symlink(target, link)
    s = storage(tmp_path)
    with pytest.raises(StoragePermissionDenied):
        put(s, aref(), b"{}")
    assert target.read_bytes() == b"victim"
    with pytest.raises(StoragePermissionDenied):
        s.delete(aref())
    assert link.is_symlink()


def test_configured_root_behind_a_symlink_is_allowed(tmp_path: Path) -> None:
    real = tmp_path / "real"
    place(real, Q_KEY, b"ok")
    os.symlink(real, tmp_path / "alias")
    s = FilesystemObjectStorage({StoreName.QUARANTINE: tmp_path / "alias"}, writable=frozenset())
    assert s.read(qref(), max_bytes=2) == b"ok"


def test_fifo_at_a_key_does_not_block(tmp_path: Path) -> None:
    fifo = tmp_path / "proc" / Q_KEY
    fifo.parent.mkdir(parents=True)
    os.mkfifo(fifo)
    with pytest.raises(ObjectMissing):
        storage(tmp_path).head(qref())


# Writes ------------------------------------------------------------------------------------


def test_put_is_create_only_and_idempotent(tmp_path: Path) -> None:
    s = storage(tmp_path)
    first = put(s, aref(), b'{"a":1}')
    again = put(s, aref(), b'{"a":1}')
    assert first == again
    with pytest.raises(ObjectExists):
        put(s, aref(), b'{"a":2}')
    assert (tmp_path / "proc" / A_KEY).read_bytes() == b'{"a":1}'
    leftovers = [p.name for p in (tmp_path / "proc" / A_KEY).parent.iterdir()]
    assert leftovers == ["report.json"], "temporary files left behind"
    mode = (tmp_path / "proc" / A_KEY).stat().st_mode & 0o777
    assert mode == 0o600


def test_put_verifies_size_and_checksum_and_leaves_nothing(tmp_path: Path) -> None:
    s = storage(tmp_path)
    data = b"payload"
    for digest, size in (
        (sha(b"other"), len(data)),
        (sha(data), len(data) - 1),
        (sha(data), len(data) + 1),
    ):
        with pytest.raises(ProcessingError) as caught:
            s.put(
                aref(),
                io.BytesIO(data),
                content_type="text/plain",
                sha256=digest,
                size_bytes=size,
            )
        assert caught.value.code is ErrorCode.CHECKSUM_MISMATCH
    assert list((tmp_path / "proc" / A_KEY).parent.iterdir()) == []


def test_put_refuses_read_only_stores(tmp_path: Path) -> None:
    with pytest.raises(StoragePermissionDenied):
        put(storage(tmp_path), qref(), b"x")
    s = storage(tmp_path, writable=frozenset({StoreName.QUARANTINE, StoreName.ARTIFACTS}))
    put(s, qref(), b"x")


def test_concurrent_writers_never_both_win(tmp_path: Path) -> None:
    s = storage(tmp_path)
    barrier = threading.Barrier(2)
    results: dict[str, object] = {}

    def writer(name: str, data: bytes) -> None:
        barrier.wait()
        try:
            results[name] = put(s, aref(), data)
        except ObjectExists as exc:
            results[name] = exc

    threads = [
        threading.Thread(target=writer, args=("a", b'{"w":"a"}')),
        threading.Thread(target=writer, args=("b", b'{"w":"b"}')),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    errors = [r for r in results.values() if isinstance(r, ObjectExists)]
    assert len(errors) == 1
    stored = (tmp_path / "proc" / A_KEY).read_bytes()
    assert stored in (b'{"w":"a"}', b'{"w":"b"}')


def test_concurrent_identical_writers_both_succeed(tmp_path: Path) -> None:
    s = storage(tmp_path)
    barrier = threading.Barrier(4)
    outcomes: list[object] = []

    def writer() -> None:
        barrier.wait()
        outcomes.append(put(s, aref(), b"same"))

    threads = [threading.Thread(target=writer) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(outcomes) == 4 and len(set(map(repr, outcomes))) == 1


def test_delete_rules(tmp_path: Path) -> None:
    s = storage(tmp_path)
    s.delete(aref())  # missing is not an error
    put(s, aref(), b"x")
    s.delete(aref())
    assert not (tmp_path / "proc" / A_KEY).exists()
    with pytest.raises(StoragePermissionDenied):
        s.delete(qref())  # not writable


def test_unreadable_object_is_permission_denied(tmp_path: Path) -> None:
    if os.geteuid() == 0:
        pytest.skip("root ignores file modes")
    path = place(tmp_path / "proc", Q_KEY, b"x")
    path.chmod(0)
    try:
        with pytest.raises(StoragePermissionDenied):
            storage(tmp_path).head(qref())
    finally:
        path.chmod(0o600)


def test_unconfigured_store_is_refused(tmp_path: Path) -> None:
    s = FilesystemObjectStorage({StoreName.QUARANTINE: tmp_path}, writable=frozenset())
    with pytest.raises(StoragePermissionDenied):
        s.head(aref())
    with pytest.raises(ValueError):
        FilesystemObjectStorage({StoreName.QUARANTINE: tmp_path})  # artifacts writable, no root
