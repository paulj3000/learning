"""scripts/ci/host_tools.py and the LAI_REQUIRE_HOST_TOOLS session gate (GE-090).

No network: downloads are replaced by an in-memory archive.
"""

import hashlib
import importlib.util
import io
import os
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location("host_tools_t", ROOT / "scripts/ci/host_tools.py")
assert _SPEC and _SPEC.loader
host_tools = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(host_tools)


def archive(members: dict[str, bytes], mode: str = "w:gz") -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode=mode) as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def test_every_required_tool_is_provided_by_apt_or_a_pin():
    assert set(host_tools.REQUIRED) == {"make", "nginx", "openssl", "envsubst"} | set(
        host_tools.PINNED
    )
    for spec in host_tools.PINNED.values():
        assert set(spec["assets"]) == {"x86_64", "aarch64"}
        for url, sha256 in spec["assets"].values():
            assert url.startswith("https://github.com/") and spec["version"] in url
            assert len(sha256) == 64 and int(sha256, 16) >= 0


def test_extract_checks_the_checksum_before_opening():
    data = archive({"actionlint": b"bin"})
    with pytest.raises(RuntimeError, match="checksum mismatch"):
        host_tools.extract(data, "actionlint", "0" * 64)
    assert host_tools.extract(data, "actionlint", hashlib.sha256(data).hexdigest()) == b"bin"


def test_extract_reads_only_the_named_member():
    data = archive({"shellcheck-v0.10.0/README.txt": b"x", "shellcheck-v0.10.0/shellcheck": b"sc"})
    sha = hashlib.sha256(data).hexdigest()
    assert host_tools.extract(data, "shellcheck-v0.10.0/shellcheck", sha) == b"sc"
    with pytest.raises(KeyError):
        host_tools.extract(data, "../../etc/passwd", sha)


def fake_pins(monkeypatch):
    blobs = {}
    pins = {}
    for name in ("actionlint", "shellcheck"):
        data = archive({name: f"#!/bin/sh\necho {name}\n".encode()})
        url = f"https://github.com/example/{name}.tar.gz"
        blobs[url] = data
        pins[name] = {
            "version": "1",
            "member": name,
            "assets": {"x86_64": (url, hashlib.sha256(data).hexdigest())},
        }
    monkeypatch.setattr(host_tools, "PINNED", pins)
    fetched = []

    def fetcher(url):
        fetched.append(url)
        return blobs[url]

    return fetcher, fetched


def test_install_writes_executables_once_per_version(tmp_path, monkeypatch):
    fetcher, fetched = fake_pins(monkeypatch)
    assert host_tools.install(tmp_path, "x86_64", fetcher) == ["actionlint", "shellcheck"]
    for name in ("actionlint", "shellcheck"):
        assert os.access(tmp_path / name, os.X_OK)
    assert host_tools.install(tmp_path, "x86_64", fetcher) == []
    assert len(fetched) == 2


def test_install_refuses_an_unknown_cpu(tmp_path, monkeypatch):
    fetcher, _ = fake_pins(monkeypatch)
    with pytest.raises(RuntimeError, match="no pinned actionlint for CPU riscv64"):
        host_tools.install(tmp_path, "riscv64", fetcher)


def test_missing_names_each_absent_tool(tmp_path):
    for name in ("make", "nginx", "openssl"):
        (tmp_path / name).write_text("")
        (tmp_path / name).chmod(0o755)
    assert host_tools.missing(str(tmp_path)) == ["envsubst", "shellcheck", "actionlint"]


def test_the_session_stops_when_a_required_tool_is_missing(tmp_path):
    """tests/conftest.py turns a missing tool into a failed session, not a skip."""
    probe = ROOT / "tests" / "repo" / "test_host_tools.py"
    env = {
        **os.environ,
        "LAI_REQUIRE_HOST_TOOLS": "1",
        "PATH": str(Path(sys.executable).parent),
    }
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", f"{probe}::test_missing_names_each_absent_tool"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 3, result.stdout + result.stderr
    assert "these host tools are missing" in result.stdout + result.stderr
