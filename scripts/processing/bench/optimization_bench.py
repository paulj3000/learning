#!/usr/bin/env python3
"""GLB optimization benchmark harness for LAI-LAMBDA-010. LOCAL USE ONLY.

Runs locally installed optimization tools on COPIES of GLB files in a temporary directory and
records output size, gzip size, wall time, child peak RSS, and the existing GLB validator's
verdict on each output. See `optimization_bench.md` beside this file.

Rules this script enforces:
- It never runs in CI: it exits with status 3 when `CI` or `GITHUB_ACTIONS` is set.
- It never downloads anything. Tools are found with `shutil.which` only; `npx`, `pip`, package
  managers and URLs are never used. A tool that is not installed is reported as skipped.
- Tools run as argv lists, never through a shell, with a timeout, in a fresh temporary
  directory, with a minimal environment; originals are never modified.
- Nothing is written into the repository. Results go to stdout (CSV or JSON).

This is benchmark scaffolding, not product code: it is not imported by `lai_processing`, the
Lambda zip, Django or React, and adds no dependency to any of them.

Usage:

    /Coding/ENV/bin/python scripts/processing/bench/optimization_bench.py --list-tools
    /Coding/ENV/bin/python scripts/processing/bench/optimization_bench.py \
        --format csv content/models/npc-pip-pirate.glb react/public/models/kenney-tree-large.glb
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import os
import shutil
import subprocess  # noqa: S404 - local benchmark only, argv lists, no shell
import sys
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "processing"))

from lai_processing.processors.gltf.document import GlbSettings, validate_glb  # noqa: E402
from lai_processing.processors.gltf.metadata import build_metadata  # noqa: E402

DEFAULT_TIMEOUT_SECONDS = 300


@dataclass(frozen=True)
class Variant:
    """One tool configuration. `argv(src, dst)` builds the command; `{tool}` is resolved."""

    name: str
    tool: str
    argv: Callable[[str, str, str], list[str]]
    note: str = ""
    output_suffix: str = ".glb"


# Each variant states what it emits, so a reader can match it to the loader requirements in
# docs/processing/feasibility/LAI-LAMBDA-010-glb-optimization.md section 4.
VARIANTS: tuple[Variant, ...] = (
    Variant(
        "gltfpack-default",
        "gltfpack",
        lambda t, s, d: [t, "-i", s, "-o", d],
        "quantization (KHR_mesh_quantization, KHR_texture_transform); no compression extension",
    ),
    Variant(
        "gltfpack-noq",
        "gltfpack",
        lambda t, s, d: [t, "-i", s, "-o", d, "-noq"],
        "re-pack only, no quantization (should stay loadable without decoders)",
    ),
    Variant(
        "gltfpack-meshopt",
        "gltfpack",
        lambda t, s, d: [t, "-i", s, "-o", d, "-c"],
        "EXT_meshopt_compression + quantization; needs MeshoptDecoder",
    ),
    Variant(
        "gltfpack-meshopt-cc",
        "gltfpack",
        lambda t, s, d: [t, "-i", s, "-o", d, "-cc"],
        "EXT_meshopt_compression with extra compression; needs MeshoptDecoder",
    ),
    Variant(
        "gltfpack-simplify-50",
        "gltfpack",
        lambda t, s, d: [t, "-i", s, "-o", d, "-si", "0.5"],
        "mesh simplification to 50% triangles + quantization; visual review required",
    ),
    Variant(
        "gltfpack-ktx2",
        "gltfpack",
        lambda t, s, d: [t, "-i", s, "-o", d, "-tc"],
        "KHR_texture_basisu (KTX2/Basis); needs KTX2Loader; only if this gltfpack build "
        "has texture compression",
    ),
    Variant(
        "gltfpack-meshopt-ktx2",
        "gltfpack",
        lambda t, s, d: [t, "-i", s, "-o", d, "-c", "-tc"],
        "meshopt + KTX2; needs MeshoptDecoder and KTX2Loader",
    ),
    Variant(
        "gltf-transform-draco",
        "gltf-transform",
        lambda t, s, d: [t, "draco", s, d],
        "KHR_draco_mesh_compression; needs DRACOLoader (global install only, never npx)",
    ),
    Variant(
        "gltf-transform-meshopt",
        "gltf-transform",
        lambda t, s, d: [t, "meshopt", s, d],
        "EXT_meshopt_compression via glTF-Transform (global install only, never npx)",
    ),
    Variant(
        "gltf-transform-resize-1024",
        "gltf-transform",
        lambda t, s, d: [t, "resize", s, d, "--width", "1024", "--height", "1024"],
        "texture downscale to at most 1024 px, no extension (loadable today); 013 owns resize "
        "in product code, this only measures the effect",
    ),
    Variant(
        "gltf-transform-etc1s",
        "gltf-transform",
        lambda t, s, d: [t, "etc1s", s, d],
        "KHR_texture_basisu ETC1S; needs KTX2Loader; requires toktx on PATH",
    ),
    Variant(
        "gltf-transform-uastc",
        "gltf-transform",
        lambda t, s, d: [t, "uastc", s, d],
        "KHR_texture_basisu UASTC; needs KTX2Loader; requires toktx on PATH",
    ),
)

# Texture-only tools (toktx, basisu) operate on images, not GLBs. Image extraction, resizing and
# re-encoding belong to LAI-LAMBDA-013 ("013 owns image resize"); this harness only times the
# texture compressors on images that already exist as files, passed with --image.
IMAGE_VARIANTS: tuple[Variant, ...] = (
    Variant(
        "toktx-etc1s",
        "toktx",
        lambda t, s, d: [t, "--t2", "--encode", "etc1s", d, s],
        "KTX2 ETC1S (Basis) from KTX-Software",
        ".ktx2",
    ),
    Variant(
        "toktx-uastc",
        "toktx",
        lambda t, s, d: [t, "--t2", "--encode", "uastc", "--zcmp", "18", d, s],
        "KTX2 UASTC + Zstandard from KTX-Software",
        ".ktx2",
    ),
    Variant(
        "basisu-ktx2",
        "basisu",
        lambda t, s, d: [t, "-ktx2", "-output_file", d, s],
        "KTX2 ETC1S from the Basis Universal encoder",
        ".ktx2",
    ),
)


@dataclass
class Result:
    input: str
    variant: str
    tool: str
    status: str
    note: str = ""
    input_bytes: int | None = None
    output_bytes: int | None = None
    output_gzip9_bytes: int | None = None
    ratio: float | None = None
    wall_seconds: float | None = None
    child_max_rss_kib: int | None = None
    validator_verdict: str | None = None
    validator_errors: str | None = None
    extensions_used: str | None = None
    extensions_required: str | None = None
    vertex_count: int | None = None
    triangle_count: int | None = None
    animation_count: int | None = None
    clip_names: str | None = None
    texture_count: int | None = None
    texture_gpu_mib: float | None = None
    texture_gpu_basis: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def in_ci() -> bool:
    return any(os.environ.get(name) for name in ("CI", "GITHUB_ACTIONS", "CODEBUILD_BUILD_ID"))


def tool_versions() -> dict[str, str | None]:
    tools = sorted({v.tool for v in (*VARIANTS, *IMAGE_VARIANTS)} | {"draco_encoder"})
    return {name: shutil.which(name) for name in tools}


def minimal_env(tmp: Path) -> dict[str, str]:
    return {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(tmp), "LC_ALL": "C"}


def run_tool(argv: list[str], cwd: Path, timeout: int) -> tuple[int, float, int | None, str]:
    """Run argv with no shell; return (exit code, wall seconds, child max RSS KiB, stderr tail)."""
    timer = shutil.which("time") or ("/usr/bin/time" if Path("/usr/bin/time").exists() else None)
    if timer:
        # GNU time reports this one command's peak RSS (KiB), children included.
        argv = [timer, "-f", "PEAKKIB=%M", *argv]
    start = time.perf_counter()
    process = subprocess.Popen(  # noqa: S603 - argv list from a fixed table, no shell
        argv,
        cwd=cwd,
        env=minimal_env(cwd),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        _out, err = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        _out, err = process.communicate()
        return -1, time.perf_counter() - start, None, "timeout"
    wall = time.perf_counter() - start
    rss = None
    lines = err.decode("utf-8", "replace").strip().splitlines() if err else []
    if timer and lines and lines[-1].startswith("PEAKKIB="):
        rss = int(lines[-1].split("=", 1)[1])
        err = "\n".join(lines[:-1]).encode()
    try:
        if rss is not None:
            raise ImportError  # exact per-command figure already known
        import resource

        # RUSAGE_CHILDREN is the max over all waited-for children so far; runs are sequential,
        # so this is an upper bound for this run (KiB on Linux).
        rss = int(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)
    except (ImportError, OSError):
        pass
    tail = err.decode("utf-8", "replace").strip().splitlines()[-1:] if err else []
    return process.returncode, wall, rss, (tail[0][:200] if tail else "")


def validate(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    with io.BytesIO(data) as handle:
        outcome = validate_glb(handle, len(data), GlbSettings(), lambda: None)
    metadata = build_metadata(outcome, 1 << 20)
    return {
        "validator_verdict": "fail" if outcome.report.has_errors else "pass",
        "validator_errors": " ".join(sorted(set(outcome.report.codes("error")))),
        "extensions_used": " ".join(metadata.get("extensions_used") or []),
        "extensions_required": " ".join(metadata.get("extensions_required") or []),
        "vertex_count": metadata.get("vertex_count"),
        "triangle_count": metadata.get("triangle_count"),
    }


def _glb_parts(data: bytes) -> tuple[dict[str, Any], bytes]:
    """JSON document and BIN chunk of a GLB (b"" when absent)."""
    import struct

    if data[:4] != b"glTF":
        return json.loads(data.decode("utf-8")), b""
    offset, document, binary = 12, {}, b""
    while offset + 8 <= len(data):
        length, kind = struct.unpack_from("<I4s", data, offset)
        chunk = data[offset + 8 : offset + 8 + length]
        if kind == b"JSON":
            document = json.loads(chunk.decode("utf-8").rstrip("\x00 "))
        elif kind == b"BIN\x00":
            binary = chunk
        offset += 8 + length + (-length % 4)
    return document, binary


def _image_size(blob: bytes) -> tuple[int, int, str] | None:
    """Pixel size and kind (png, jpeg, ktx2) from the header bytes; None when unknown."""
    import struct

    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", blob[16:24])
        return w, h, "png"
    if blob[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(blob):
            if blob[i] != 0xFF:
                i += 1
                continue
            marker = blob[i + 1]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", blob[i + 5 : i + 9])
                return w, h, "jpeg"
            i += 2 + struct.unpack(">H", blob[i + 2 : i + 4])[0]
    if blob[:12] == b"\xabKTX 20\xbb\r\n\x1a\n":
        w, h = struct.unpack("<II", blob[20:28])
        return w, h, "ktx2"
    return None


def scene_metrics(path: Path) -> dict[str, Any]:
    """Animations and estimated GPU texture memory, from the file itself (stdlib only).

    GPU memory is a formula, not a measurement: RGBA8 with a full mip chain is w*h*4*4/3 bytes;
    a KTX2 image is assumed to be transcoded to an 8 bits per pixel block format (ASTC 4x4, BC7
    or ETC2 RGBA), w*h*1*4/3, which is what a tablet GPU gets when `detectSupport` finds ASTC
    or ETC2. Devices without a block format get RGBA8 and the larger figure."""
    import base64

    document, binary = _glb_parts(path.read_bytes())
    views = document.get("bufferViews", [])
    total, kinds = 0.0, set()
    for image in document.get("images", []):
        blob = b""
        if "bufferView" in image:
            view = views[image["bufferView"]]
            blob = binary[view.get("byteOffset", 0) :][: view["byteLength"]]
        elif str(image.get("uri", "")).startswith("data:"):
            blob = base64.b64decode(image["uri"].split(",", 1)[1])
        info = _image_size(blob[:65536]) if blob else None
        if info is None:
            continue
        w, h, kind = info
        kinds.add(kind)
        total += w * h * (1 if kind == "ktx2" else 4) * 4 / 3
    clips = [a.get("name", "") for a in document.get("animations", [])]
    return {
        "animation_count": len(clips),
        "clip_names": " ".join(clips),
        "texture_count": len(document.get("images", [])),
        "texture_gpu_mib": round(total / (1 << 20), 2) if kinds else None,
        "texture_gpu_basis": "+".join(sorted(kinds)) or None,
    }


def baseline_row(source: Path) -> Result:
    """The unmodified input, measured the same way (a .gltf is read, not converted)."""
    data = source.read_bytes()
    result = Result(str(source), "original", "-", "ok", "input as found", input_bytes=len(data))
    result.output_bytes = len(data)
    result.output_gzip9_bytes = len(gzip.compress(data, compresslevel=9, mtime=0))
    result.ratio = 1.0
    for key, value in scene_metrics(source).items():
        setattr(result, key, value)
    return result


def bench_one(source: Path, variant: Variant, timeout: int) -> Result:
    tool_path = shutil.which(variant.tool)
    shown = str(source)
    if tool_path is None:
        return Result(
            shown, variant.name, variant.tool, "skipped: tool not installed", variant.note
        )
    with tempfile.TemporaryDirectory(prefix="lai-bench-") as tmp_name:
        tmp = Path(tmp_name)
        src = tmp / ("input" + source.suffix.lower())
        shutil.copyfile(source, src)  # the original is never touched
        dst = tmp / ("output" + variant.output_suffix)
        code, wall, rss, err = run_tool(variant.argv(tool_path, str(src), str(dst)), tmp, timeout)
        result = Result(
            shown,
            variant.name,
            variant.tool,
            "ok" if code == 0 and dst.exists() else f"failed (exit {code}): {err}",
            variant.note,
            input_bytes=src.stat().st_size,
            wall_seconds=round(wall, 3),
            child_max_rss_kib=rss,
        )
        if code == 0 and dst.exists():
            out = dst.read_bytes()
            result.output_bytes = len(out)
            result.output_gzip9_bytes = len(gzip.compress(out, compresslevel=9, mtime=0))
            result.ratio = round(len(out) / result.input_bytes, 4) if result.input_bytes else None
            if variant.output_suffix == ".glb":
                for key, value in validate(dst).items():
                    setattr(result, key, value)
                for key, value in scene_metrics(dst).items():
                    setattr(result, key, value)
        return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="LAI-LAMBDA-010 local optimization benchmark")
    parser.add_argument("glbs", nargs="*", type=Path, help="GLB files to benchmark (copied)")
    parser.add_argument(
        "--image",
        action="append",
        type=Path,
        default=[],
        help="PNG/JPEG files for the texture compressors (013 owns extraction)",
    )
    parser.add_argument("--format", choices=("csv", "json"), default="csv")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--list-tools", action="store_true", help="show which tools are found")
    args = parser.parse_args(argv)

    if in_ci():
        print("optimization_bench: refusing to run in CI (local benchmark only)", file=sys.stderr)
        return 3
    tools = tool_versions()
    if args.list_tools or not (args.glbs or args.image):
        for name, path in tools.items():
            print(f"{name}: {path or 'not installed (skipped)'}")
        return 0

    results: list[Result] = []
    for source in args.glbs:
        results.append(baseline_row(source))
        for variant in VARIANTS:
            results.append(bench_one(source, variant, args.timeout))
    for source in args.image:
        for variant in IMAGE_VARIANTS:
            results.append(bench_one(source, variant, args.timeout))

    rows = [{k: v for k, v in vars(r).items() if k != "extra"} for r in results]
    if args.format == "json":
        json.dump({"tools": tools, "results": rows}, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
    else:
        writer = csv.DictWriter(sys.stdout, fieldnames=list(rows[0]) if rows else ["input"])
        writer.writeheader()
        writer.writerows(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
