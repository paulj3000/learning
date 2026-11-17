"""Workspace: private, name-checked, size-bounded, and always removable."""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.core.workspace import Workspace


@pytest.fixture
def ws(tmp_path: Path) -> Workspace:
    workspace = Workspace.create(max_bytes=100, root=tmp_path)
    yield workspace
    workspace.cleanup()


def test_created_private_inside_root(tmp_path: Path, ws: Workspace) -> None:
    assert ws.root.parent == Path(os.path.realpath(tmp_path))
    assert ws.root.name.startswith("lai-proc-")
    assert stat.S_IMODE(ws.root.stat().st_mode) == 0o700


@pytest.mark.parametrize(
    "name",
    [
        "",
        ".",
        "..",
        "../x",
        "a/b",
        "/etc/passwd",
        "a\\b",
        ".hidden",
        "-dash",
        "a..b",
        "x" * 101,
        "nul\x00byte",
        "new\nline",
        "ünicode",
        " space",
    ],
)
def test_unsafe_names_refused(ws: Workspace, name: str) -> None:
    with pytest.raises(ProcessingError) as info:
        ws.path(name)
    assert info.value.code is ErrorCode.INVALID_OBJECT_REFERENCE


def test_non_string_name_refused(ws: Workspace) -> None:
    with pytest.raises(ProcessingError):
        ws.path(123)  # type: ignore[arg-type]


@pytest.mark.parametrize("name", ["input.bin", "a", "report-1.json", "A_b.c-d", "x" * 100])
def test_safe_names_accepted(ws: Workspace, name: str) -> None:
    assert ws.path(name) == ws.root / name


def test_write_counts_bytes_and_enforces_budget(ws: Workspace) -> None:
    path = ws.write("a.bin", b"x" * 60)
    assert path.read_bytes() == b"x" * 60
    assert ws.used_bytes == 60
    with pytest.raises(ProcessingError) as info:
        ws.write("b.bin", b"y" * 41)
    assert info.value.code is ErrorCode.RESOURCE_LIMIT_EXCEEDED
    assert info.value.details["limit"] == "max_temp_bytes"
    assert not (ws.root / "b.bin").exists()
    ws.write("b.bin", b"y" * 40)
    assert ws.used_bytes == 100


def test_overwrite_does_not_credit_budget(ws: Workspace) -> None:
    ws.write("a.bin", b"x" * 60)
    with pytest.raises(ProcessingError):
        ws.write("a.bin", b"x" * 60)


def test_reserve(ws: Workspace) -> None:
    ws.reserve(0)
    ws.reserve(100)
    with pytest.raises(ProcessingError):
        ws.reserve(1)
    with pytest.raises(ValueError):
        ws.reserve(-1)


def test_open_new_is_exclusive(ws: Workspace) -> None:
    with ws.open_new("s.bin") as handle:
        handle.write(b"abc")
    with pytest.raises(FileExistsError):
        ws.open_new("s.bin")


def test_symlink_out_of_root_is_never_followed(tmp_path: Path, ws: Workspace) -> None:
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"secret")
    os.symlink(outside, ws.root / "link")
    with pytest.raises(ProcessingError) as info:
        ws.path("link")
    assert info.value.details["reason"] == "outside_root"
    with pytest.raises(ProcessingError):
        ws.write("link", b"overwrite")
    assert outside.read_bytes() == b"secret"
    ws.cleanup()
    assert outside.read_bytes() == b"secret"


def test_dangling_symlink_inside_root_not_written_through(tmp_path: Path, ws: Workspace) -> None:
    target = tmp_path / "planted.txt"
    os.symlink(target, ws.root / "dangling")
    with pytest.raises((ProcessingError, OSError)):
        ws.write("dangling", b"data")
    assert not target.exists()


def test_cleanup_is_idempotent_and_blocks_use(ws: Workspace) -> None:
    ws.write("a.bin", b"1")
    root = ws.root
    ws.cleanup()
    assert ws.cleaned and not root.exists()
    ws.cleanup()
    with pytest.raises(ProcessingError):
        ws.path("a.bin")


def test_context_manager_cleans_up_after_exception(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError):
        with Workspace.create(max_bytes=10, root=tmp_path) as workspace:
            workspace.write("a", b"1")
            root = workspace.root
            raise RuntimeError("boom")
    assert not root.exists()
    assert workspace.cleaned


def test_cleanup_when_root_already_removed(tmp_path: Path) -> None:
    workspace = Workspace.create(max_bytes=10, root=tmp_path)
    os.rmdir(workspace.root)
    workspace.cleanup()
    assert workspace.cleaned


@pytest.mark.parametrize("bad", [0, -1, 1.5, True])
def test_invalid_budget_refused(tmp_path: Path, bad: object) -> None:
    with pytest.raises(ValueError):
        Workspace.create(max_bytes=bad, root=tmp_path)  # type: ignore[arg-type]
    assert list(tmp_path.iterdir()) == []
