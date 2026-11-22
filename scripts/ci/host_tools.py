"""Host tools the repository tests need, so those tests run instead of skipping (GE-090).

The tests in tests/repo and tests/deploy skip when a tool is missing. With
LAI_REQUIRE_HOST_TOOLS=1 (GitHub CI and the EC2 runner) tests/conftest.py stops the session
instead, so a missing tool can never pass as a skip.

- make, nginx, openssl and envsubst come from the OS (APT_PACKAGES on Ubuntu).
- actionlint and shellcheck are pinned release binaries, checked against SHA-256 before use.
  actionlint's sums are from its published checksums file; shellcheck publishes none, so its sums
  were taken from the v0.10.0 release assets on 2026-11-22.

Usage:
    python3 scripts/ci/host_tools.py install --dest DIR   # the pinned binaries into DIR
    python3 scripts/ci/host_tools.py check [--path DIR]   # exit 1 naming any missing tool
"""

from __future__ import annotations

import argparse
import hashlib
import io
import os
import platform
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

REQUIRED = ("make", "nginx", "openssl", "envsubst", "shellcheck", "actionlint")
APT_PACKAGES = ("make", "nginx", "openssl", "gettext-base")

_ACTIONLINT = (
    "https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_linux_{}.tar.gz"
)
_SHELLCHECK = "https://github.com/koalaman/shellcheck/releases/download/v0.10.0/shellcheck-v0.10.0.linux.{}.tar.xz"

PINNED = {
    "actionlint": {
        "version": "1.7.7",
        "member": "actionlint",
        "assets": {
            "x86_64": (
                _ACTIONLINT.format("amd64"),
                "023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757",
            ),
            "aarch64": (
                _ACTIONLINT.format("arm64"),
                "401942f9c24ed71e4fe71b76c7d638f66d8633575c4016efd2977ce7c28317d0",
            ),
        },
    },
    "shellcheck": {
        "version": "0.10.0",
        "member": "shellcheck-v0.10.0/shellcheck",
        "assets": {
            "x86_64": (
                _SHELLCHECK.format("x86_64"),
                "6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87",
            ),
            "aarch64": (
                _SHELLCHECK.format("aarch64"),
                "324a7e89de8fa2aed0d0c28f3dab59cf84c6d74264022c00c22af665ed1a09bb",
            ),
        },
    },
}


def missing(path: str | None = None) -> list[str]:
    """The REQUIRED tools not found on `path` (default: this process's PATH)."""
    return [name for name in REQUIRED if shutil.which(name, path=path) is None]


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:  # noqa: S310 (fixed https URLs)
        return response.read()


def extract(archive: bytes, member: str, sha256: str) -> bytes:
    digest = hashlib.sha256(archive).hexdigest()
    if digest != sha256:
        raise RuntimeError(f"checksum mismatch: got {digest}, expected {sha256}")
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        info = tar.getmember(member)
        handle = tar.extractfile(info) if info.isfile() else None
        if handle is None:
            raise RuntimeError(f"{member} is not a regular file in the archive")
        return handle.read()


def install(dest: Path, machine: str | None = None, fetcher=fetch) -> list[str]:
    """Install each pinned binary into dest once per version; return the names installed now."""
    machine = machine or platform.machine()
    dest.mkdir(parents=True, exist_ok=True)
    installed = []
    for name, spec in PINNED.items():
        stamp = dest / f".{name}-{spec['version']}"
        if stamp.exists() and (dest / name).exists():
            continue
        if machine not in spec["assets"]:
            raise RuntimeError(f"no pinned {name} for CPU {machine}")
        url, sha256 = spec["assets"][machine]
        binary = extract(fetcher(url), spec["member"], sha256)
        tmp = dest / f".{name}.tmp"
        tmp.write_bytes(binary)
        tmp.chmod(0o755)
        os.replace(tmp, dest / name)
        stamp.write_text(sha256 + "\n")
        installed.append(name)
    return installed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("install").add_argument("--dest", type=Path, required=True)
    sub.add_parser("check").add_argument("--path", default=None)
    args = parser.parse_args(argv)
    if args.command == "install":
        done = install(args.dest)
        print(f"installed: {', '.join(done) or 'already current'} in {args.dest}")
        return 0
    absent = missing(args.path)
    if absent:
        print(f"missing host tools: {', '.join(absent)}", file=sys.stderr)
        return 1
    print("host tools: all present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
