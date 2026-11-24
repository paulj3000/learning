"""`native/gltf/fetch-tools.sh` fails closed on a bad pin (F14). Offline: `file://` URLs only."""

from __future__ import annotations

import hashlib
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "native" / "gltf" / "fetch-tools.sh"


def _copy(tmp_path: Path, lock: str) -> Path:
    home = tmp_path / "native" / "gltf"
    home.mkdir(parents=True)
    shutil.copy(SCRIPT, home / "fetch-tools.sh")
    (home / "tools.lock").write_text(lock)
    return home / "fetch-tools.sh"


@pytest.mark.skipif(not shutil.which("curl") or not shutil.which("sha256sum"), reason="needs curl")
def test_a_sha256_mismatch_exits_non_zero_with_a_clear_message(tmp_path: Path) -> None:
    archive = tmp_path / "gltfpack-ubuntu.zip"
    archive.write_bytes(b"not the pinned archive")
    wrong = "0" * 64
    assert hashlib.sha256(archive.read_bytes()).hexdigest() != wrong
    script = _copy(tmp_path, f"gltfpack x86_64 file://{archive} {wrong}\n")
    done = subprocess.run(
        ["bash", str(script), "--arch", "x86_64", "--out", str(tmp_path / "out")],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert done.returncode == 3
    assert "SHA-256 mismatch for gltfpack" in done.stderr
    assert not (tmp_path / "out" / "x86_64" / "gltfpack").exists()  # nothing extracted


def test_the_lock_pins_every_archive_with_sha256() -> None:
    rows = [
        line.split()
        for line in (SCRIPT.parent / "tools.lock").read_text().splitlines()
        if line.strip() and not line.startswith("#")
    ]
    assert rows
    for name, _arch, url, sha in rows:
        assert url.startswith("https://github.com/"), name
        assert len(sha) == 64 and all(c in "0123456789abcdef" for c in sha), name
    assert ("gltfpack", "arm64") not in {(r[0], r[1]) for r in rows}  # none is published
