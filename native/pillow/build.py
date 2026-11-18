"""Build the image function zip deterministically (ADR-068).

    python3 native/pillow/build.py --arch aarch64            # downloads, verifies, builds
    python3 native/pillow/build.py --arch x86_64 --wheel DIR # offline: wheel already in DIR

Output (default `build/image/`, gitignored): `image-worker-<arch>-<hash16>.zip` and
`image-worker-<arch>-<hash16>.json` (sizes, hashes, retained and removed libraries). Nothing is
uploaded or deployed.

What goes in the zip: the canonical jobs worker tree (`jobs_worker`, its vendored core, the
standard-library `lai_processing`; exactly the entries `lambda/build.py` lists, imported, not
forked), `image_worker/`, `lai_native/` (package root and `image/`), Pillow and its wheel libraries
after pruning, and `licenses/` (Pillow licence, third party notices). Entries are sorted,
timestamps fixed, permissions normalised and nothing compressed, so the same inputs give the same
bytes and name. The wheel is fetched with `pip download --only-binary=:all: --require-hashes`,
and its sha256 is checked again here against the requirements file.

Pruning removes what the function can never reach (type stubs, Tk, Qt, screen grab, AVIF, font
rendering) and refuses to build if a kept library would lose a dependency (ELF `DT_NEEDED`).
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
FIXED_TIME = (1980, 1, 1, 0, 0, 0)
#: Documented budget for the image function zip (stored), ADR-068. The shared worker stays at 2 MiB.
BUDGET_STORED_BYTES = 24 * 1024 * 1024
ARCHES = {
    "aarch64": {
        "requirements": HERE / "requirements-aarch64.txt",
        "platforms": ["manylinux2014_aarch64", "manylinux_2_28_aarch64"],
        "so_tag": "aarch64-linux-gnu",
    },
    "x86_64": {
        "requirements": HERE / "requirements-x86_64.txt",
        "platforms": ["manylinux_2_28_x86_64", "manylinux2014_x86_64"],
        "so_tag": "x86_64-linux-gnu",
    },
}
#: Removed from the wheel. Each is unreachable from `lai_native.image` (formats are restricted to
#: PNG, JPEG and WebP; no text or font rendering; no GUI toolkit). Matched by file name prefix.
PRUNE_PREFIXES = (
    "PIL/ImageTk.py",
    "PIL/_imagingtk",
    "PIL/ImageQt.py",
    "PIL/ImageGrab.py",
    "PIL/_avif",
    "PIL/_imagingft",
    "PIL/AvifImagePlugin.py",
    "pillow.libs/libavif",
    "pillow.libs/libfreetype",
    "pillow.libs/libharfbuzz",
    "pillow.libs/libbrotlicommon",
    "pillow.libs/libbrotlidec",
    "pillow.libs/libpng16",
)
PRUNE_SUFFIXES = (".pyi", "/py.typed")
#: Libraries the Lambda python3.12 (Amazon Linux 2023) runtime provides.
SYSTEM_LIBS = re.compile(
    r"^(libc|libm|libdl|libpthread|librt|ld-linux[\w.-]*|libz|libgcc_s|libstdc\+\+)\.so"
)
NOTICES = HERE / "THIRD_PARTY_NOTICES.md"


class BuildError(RuntimeError):
    pass


def _lambda_build():
    spec = importlib.util.spec_from_file_location("lai_lambda_build", ROOT / "lambda" / "build.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def requirement_hashes(path: Path) -> list[str]:
    return re.findall(r"--hash=sha256:([0-9a-f]{64})", path.read_text())


def download_wheel(arch: str, destination: Path) -> Path:
    """`pip download` with `--require-hashes`; the only network step, and only when no wheel
    directory is given."""
    spec = ARCHES[arch]
    destination.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable, "-m", "pip", "download", "--no-deps", "--only-binary=:all:",
        "--require-hashes", "--python-version", "3.12", "--implementation", "cp", "--abi", "cp312",
        "-r", str(spec["requirements"]), "-d", str(destination),
    ]  # fmt: skip
    for platform in spec["platforms"]:
        command += ["--platform", platform]
    subprocess.run(command, check=True)  # noqa: S603
    return find_wheel(destination)


def find_wheel(directory: Path) -> Path:
    wheels = sorted(directory.glob("pillow-*.whl"))
    if len(wheels) != 1:
        raise BuildError(f"expected exactly one Pillow wheel in {directory}, found {len(wheels)}")
    return wheels[0]


def verify_wheel(wheel: Path, arch: str) -> str:
    digest = hashlib.sha256(wheel.read_bytes()).hexdigest()
    if digest not in requirement_hashes(ARCHES[arch]["requirements"]):
        raise BuildError("the wheel's sha256 is not the one pinned in the requirements file")
    return digest


def _safe(name: str) -> bool:
    return not name.startswith("/") and ".." not in name.split("/") and "\\" not in name


def wheel_entries(wheel: Path, arch: str) -> tuple[dict[str, bytes], list[str]]:
    """The wheel's files after pruning, and the removed paths."""
    kept: dict[str, bytes] = {}
    removed: list[str] = []
    with zipfile.ZipFile(wheel) as archive:
        for info in sorted(archive.infolist(), key=lambda item: item.filename):
            name = info.filename
            if info.is_dir():
                continue
            if not _safe(name):
                raise BuildError("unsafe path in wheel")
            if (
                "__pycache__" in name
                or name.startswith(PRUNE_PREFIXES)
                or name.endswith(PRUNE_SUFFIXES)
            ):
                removed.append(name)
                continue
            kept[name] = archive.read(info)
    tag = ARCHES[arch]["so_tag"]
    wrong = [n for n in kept if n.startswith("PIL/") and n.endswith(".so") and tag not in n]
    if wrong:
        raise BuildError("the wheel does not match the target architecture")
    return kept, removed


def elf_needed(data: bytes) -> list[str]:
    """`DT_NEEDED` names of a little-endian ELF64 shared object."""
    if data[:4] != b"\x7fELF" or data[4] != 2 or data[5] != 1:
        raise BuildError("not a little-endian ELF64 object")
    (phoff,) = struct.unpack_from("<Q", data, 0x20)
    phentsize, phnum = struct.unpack_from("<HH", data, 0x36)
    loads, dynamic = [], None
    for index in range(phnum):
        base = phoff + index * phentsize
        kind, _flags, offset, vaddr, _paddr, filesz = struct.unpack_from("<IIQQQQ", data, base)
        if kind == 1:
            loads.append((vaddr, offset, filesz))
        elif kind == 2:
            dynamic = (offset, filesz)
    if dynamic is None:
        return []

    def file_offset(address: int) -> int:
        for vaddr, offset, size in loads:
            if vaddr <= address < vaddr + size:
                return offset + address - vaddr
        raise BuildError("bad ELF address")

    needed, strtab = [], None
    for position in range(dynamic[0], dynamic[0] + dynamic[1], 16):
        tag, value = struct.unpack_from("<qQ", data, position)
        if tag == 0:
            break
        if tag == 1:
            needed.append(value)
        elif tag == 5:
            strtab = file_offset(value)
    names = []
    for value in needed:
        start = strtab + value
        names.append(data[start : data.index(b"\x00", start)].decode())
    return names


def check_dependencies(files: dict[str, bytes]) -> None:
    """Every kept shared object finds its libraries in the zip or in the Lambda runtime."""
    present = {name.rsplit("/", 1)[-1] for name in files}
    for name, data in files.items():
        if not name.endswith(".so") and ".so." not in name:
            continue
        for needed in elf_needed(data):
            if needed not in present and not SYSTEM_LIBS.match(needed):
                raise BuildError(
                    f"{name} needs {needed}, which is neither kept nor a system library"
                )


def collect(arch: str, wheel: Path) -> tuple[dict[str, tuple[bytes, int]], dict]:
    """Archive path -> (bytes, mode), and the manifest facts."""
    build = _lambda_build()
    digest = verify_wheel(wheel, arch)
    kept, removed = wheel_entries(wheel, arch)
    check_dependencies(kept)
    files: dict[str, tuple[bytes, int]] = {}
    for path, data in build.entries().items():
        files[path] = (data, 0o644)
    for path in sorted((ROOT / "lambda" / "image_worker").glob("*.py")):
        files[f"image_worker/{path.name}"] = (path.read_bytes(), 0o644)
    native = ROOT / "processing" / "lai_native"
    for path in sorted(native.rglob("*.py")):
        relative = path.relative_to(native.parent).as_posix()
        if "__pycache__" in relative or relative.startswith("lai_native/audio/"):
            continue
        if relative.startswith(("lai_native/optimize/", "lai_native/runtime/")):
            continue
        files[relative] = (path.read_bytes(), 0o644)
    if "lai_native/image/__init__.py" not in files:
        raise BuildError("lai_native.image is missing")
    shipped = [ROOT / "processing" / name for name in files if name.startswith("lai_native/")]
    shipped += [ROOT / "lambda" / name for name in files if name.startswith("image_worker/")]
    violations = build.audit_imports(shipped)  # the import policies of lambda/build.py
    if violations:
        raise BuildError(f"import policy: {violations[0]}")
    for name, data in kept.items():
        executable = name.endswith(".so") or ".so." in name
        files[name] = (data, 0o755 if executable else 0o644)
    files["licenses/THIRD_PARTY_NOTICES.md"] = (NOTICES.read_bytes(), 0o644)
    stored = sum(len(data) for data, _ in files.values())
    facts = {
        "arch": arch,
        "wheelSha256": digest,
        "wheelBytes": wheel.stat().st_size,
        "wheelName": wheel.name,
        "unpackedBytes": stored,
        "removed": removed,
        "kept": sorted(name for name in kept if name.startswith("pillow.libs/")),
    }
    return files, facts


#: Bundled library file prefix -> (component, upstream version, SPDX licences), from the wheel's
#: own SBOM (`pillow-13.0.0.cdx.json`) and the upstream projects (zstd, xz, libXau are not in it).
LIBRARIES = {
    "libjpeg": ("libjpeg-turbo", "3.2.0", ["IJG", "BSD-3-Clause"]),
    "libtiff": ("libtiff", "4.7.2", ["libtiff"]),
    "libwebp": ("libwebp", "1.6.0", ["BSD-3-Clause"]),
    "libsharpyuv": ("libwebp (sharpyuv)", "1.6.0", ["BSD-3-Clause"]),
    "libopenjp2": ("OpenJPEG", "2.5.4", ["BSD-2-Clause"]),
    "liblcms2": ("Little CMS 2", "2.19.1", ["MIT"]),
    "libxcb": ("libxcb", "1.17.0", ["X11"]),
    "libXau": ("libXau", "1.0.9", ["X11"]),
    "libzstd": ("zstd", "1.5.7", ["BSD-3-Clause"]),
    "liblzma": ("xz (liblzma)", "5.8.4", ["0BSD"]),
}


def sbom(files: dict[str, tuple[bytes, int]], facts: dict) -> dict:
    """A CycloneDX 1.5 bill of materials of the function zip. No timestamp or serial number, so
    the same zip gives the same document."""
    components = [
        {
            "type": "library",
            "name": "Pillow",
            "version": "13.0.0",
            "purl": "pkg:pypi/pillow@13.0.0",
            "licenses": [{"license": {"id": "MIT-CMU"}}],
            "hashes": [{"alg": "SHA-256", "content": facts["wheelSha256"]}],
            "properties": [{"name": "wheel", "value": facts["wheelName"]}],
        }
    ]
    for name in sorted(files):
        if not name.startswith("pillow.libs/"):
            continue
        base = name.split("/", 1)[1]
        prefix = next(
            (key for key in sorted(LIBRARIES, key=len, reverse=True) if base.startswith(key)), None
        )
        if prefix is None:
            raise BuildError(f"{base} is not in the library table")
        title, version, licences = LIBRARIES[prefix]
        components.append(
            {
                "type": "library",
                "name": title,
                "version": version,
                "licenses": [{"license": {"id": spdx}} for spdx in licences],
                "hashes": [
                    {"alg": "SHA-256", "content": hashlib.sha256(files[name][0]).hexdigest()}
                ],
                "properties": [{"name": "file", "value": name}],
            }
        )
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "name": "lai-image-worker",
                "version": "0.1.0",
                "properties": [
                    {"name": "arch", "value": facts["arch"]},
                    {"name": "python", "value": "3.12"},
                    {"name": "zlib", "value": "provided by the Lambda runtime (libz.so.1)"},
                ],
            }
        },
        "components": components,
        "properties": [
            {
                "name": "removed",
                "value": ", ".join(
                    sorted(
                        set(facts["removed"])
                        - {n for n in facts["removed"] if n.endswith((".pyi", "py.typed"))}
                    )
                ),
            }
        ],
    }


def zip_bytes(files: dict[str, tuple[bytes, int]], *, deflate: bool = False) -> bytes:
    import io

    buffer = io.BytesIO()
    method = zipfile.ZIP_DEFLATED if deflate else zipfile.ZIP_STORED
    with zipfile.ZipFile(buffer, "w", method, compresslevel=9 if deflate else None) as archive:
        for path in sorted(files):
            data, mode = files[path]
            info = zipfile.ZipInfo(path, date_time=FIXED_TIME)
            info.compress_type = method
            info.external_attr = (0o100000 | mode) << 16
            info.create_system = 3
            archive.writestr(info, data, compresslevel=9 if deflate else None)
    return buffer.getvalue()


def build(arch: str, out_dir: Path, wheel_dir: Path | None, cache_dir: Path) -> tuple[Path, dict]:
    wheel = find_wheel(wheel_dir) if wheel_dir else download_wheel(arch, cache_dir / arch)
    files, facts = collect(arch, wheel)
    data = zip_bytes(files)
    if len(data) > BUDGET_STORED_BYTES:
        raise BuildError(f"the zip is {len(data)} bytes; the budget is {BUDGET_STORED_BYTES}")
    facts["zipStoredBytes"] = len(data)
    facts["zipDeflatedBytesInformational"] = len(zip_bytes(files, deflate=True))
    facts["budgetBytes"] = BUDGET_STORED_BYTES
    facts["zipSha256"] = hashlib.sha256(data).hexdigest()
    facts["sbom"] = sbom(files, facts)
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"image-worker-{arch}-{facts['zipSha256'][:16]}.zip"
    target.write_bytes(data)
    manifest = {key: value for key, value in facts.items() if key != "sbom"}
    target.with_suffix(".json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return target, facts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--arch", choices=sorted(ARCHES), default="aarch64")
    parser.add_argument("--out", default=str(ROOT / "build" / "image"))
    parser.add_argument("--wheel", help="directory holding the already downloaded wheel (offline)")
    parser.add_argument("--sbom", help="also write the CycloneDX bill of materials to this path")
    parser.add_argument("--cache", default=str(ROOT / "build" / "image" / "wheels"))
    args = parser.parse_args(argv)
    try:
        path, facts = build(
            args.arch, Path(args.out), Path(args.wheel) if args.wheel else None, Path(args.cache)
        )
    except (BuildError, subprocess.CalledProcessError) as error:
        print(f"build-image-worker: {error}", file=sys.stderr)
        return 10
    if args.sbom:
        Path(args.sbom).write_text(json.dumps(facts["sbom"], indent=2, sort_keys=True) + "\n")
    print(path)
    print(
        f"stored {facts['zipStoredBytes']} B, unpacked {facts['unpackedBytes']} B, "
        f"deflated {facts['zipDeflatedBytesInformational']} B (informational)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
