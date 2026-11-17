#!/usr/bin/env python3
"""GLB baseline for LAI-LAMBDA-010 (GLB and texture optimization feasibility).

Runs the EXISTING GLB validator (`processing/lai_processing/processors/gltf`, processor
`asset.glb_validator`, profile `glb-default` defaults) over local files and prints one row per
file: verdict, error codes, the validator's metadata (vertices, triangles, meshes, primitives,
materials, textures, images with dimensions, animations, skins, joints, extensions), the file
size, the bytes of embedded images (from the image buffer views, so texture weight can be told
apart from geometry), and an estimated transfer size with stdlib gzip (level 9 and level 6) and
brotli (quality 11) only when the `brotli` module happens to be importable.

It is a measurement script, not part of the product:
- standard library only (brotli is optional and never installed by this script);
- reads local files only, never fetches anything, never writes anything;
- does not change the validator or its limits; `.gltf` inputs are reported with sizes only
  because the processor validates GLB only (`gltf_not_supported`).

Usage (from the repository root):

    /Coding/ENV/bin/python scripts/processing/bench/glb_baseline.py --format csv
    /Coding/ENV/bin/python scripts/processing/bench/glb_baseline.py --format json path/a.glb ...

With no paths it scans the repository for `*.glb` (skipping `node_modules`, `.git` and
`.claude`). `--include-gltf` also lists `*.gltf` files (sizes and compression only).
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "processing"))

from lai_processing.processors.gltf.container import read_at, read_layout  # noqa: E402
from lai_processing.processors.gltf.document import GlbSettings, validate_glb  # noqa: E402
from lai_processing.processors.gltf.jsonparse import parse_document  # noqa: E402
from lai_processing.processors.gltf.metadata import build_metadata  # noqa: E402
from lai_processing.processors.gltf.report import Report  # noqa: E402

try:  # optional; never installed by this script
    import brotli  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - depends on the environment
    brotli = None

SKIP_DIRS = {"node_modules", ".git", ".claude", "dist", "build", "__pycache__"}
METADATA_BUDGET = 1 << 20  # large enough that lists are never truncated for a baseline


def _no_check() -> None:
    """The validator's cancellation hook; a baseline run is never cancelled."""


def discover(root: Path, include_gltf: bool) -> list[Path]:
    suffixes = {".glb", ".gltf"} if include_gltf else {".glb"}
    found: list[Path] = []
    for path in root.rglob("*"):
        if any(part in SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        if path.is_file() and path.suffix.lower() in suffixes:
            found.append(path)
    return sorted(found)


COMPONENT_BYTES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}
BREAKDOWN_KEYS = ("image_bytes", "vertex_bytes", "index_bytes", "animation_bytes", "skin_bytes")


def byte_breakdown(data: bytes) -> dict[str, int] | None:
    """Payload bytes by role, read with the validator's own container and JSON parser.

    Images: the byteLength of their buffer views. Accessors: count x element size (tightly
    packed estimate, ignoring stride padding), attributed to vertex attributes and morph
    targets, primitive indices, animation samplers, or skin inverse bind matrices.
    """
    report = Report()
    try:
        with io.BytesIO(data) as handle:
            layout = read_layout(handle, len(data), report, 16 * 1024 * 1024)
            raw = read_at(handle, layout.json_offset, layout.json_length, len(data))
    except Exception:  # noqa: BLE001 - the validator already reports the reason
        return None
    document = parse_document(raw, report, 64, _no_check)
    if not isinstance(document, dict):
        return None

    def items(name: str) -> list[Any]:
        value = document.get(name)
        return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []

    views = document.get("bufferViews") if isinstance(document.get("bufferViews"), list) else []
    accessors = document.get("accessors") if isinstance(document.get("accessors"), list) else []
    totals = dict.fromkeys(BREAKDOWN_KEYS, 0)
    for image in items("images"):
        index = image.get("bufferView")
        if isinstance(index, int) and 0 <= index < len(views) and isinstance(views[index], dict):
            length = views[index].get("byteLength")
            totals["image_bytes"] += length if isinstance(length, int) else 0
    roles: dict[int, str] = {}
    for mesh in items("meshes"):
        for primitive in mesh.get("primitives") or []:
            if not isinstance(primitive, dict):
                continue
            for index in (primitive.get("attributes") or {}).values():
                roles.setdefault(index, "vertex_bytes")
            for target in primitive.get("targets") or []:
                for index in (target or {}).values():
                    roles.setdefault(index, "vertex_bytes")
            if isinstance(primitive.get("indices"), int):
                roles.setdefault(primitive["indices"], "index_bytes")
    for animation in items("animations"):
        for sampler in animation.get("samplers") or []:
            if isinstance(sampler, dict):
                for key in ("input", "output"):
                    roles.setdefault(sampler.get(key), "animation_bytes")
    for skin in items("skins"):
        roles.setdefault(skin.get("inverseBindMatrices"), "skin_bytes")
    for index, role in roles.items():
        if not (isinstance(index, int) and 0 <= index < len(accessors)):
            continue
        accessor = accessors[index]
        if not isinstance(accessor, dict):
            continue
        size = COMPONENT_BYTES.get(accessor.get("componentType"), 0)
        size *= TYPE_COMPONENTS.get(accessor.get("type"), 0)
        count = accessor.get("count")
        totals[role] += size * count if isinstance(count, int) else 0
    return totals


def compressed_sizes(data: bytes) -> dict[str, int | None]:
    sizes: dict[str, int | None] = {
        "gzip6_bytes": len(gzip.compress(data, compresslevel=6, mtime=0)),
        "gzip9_bytes": len(gzip.compress(data, compresslevel=9, mtime=0)),
        "brotli11_bytes": None,
    }
    if brotli is not None:
        sizes["brotli11_bytes"] = len(brotli.compress(data, quality=11))
    return sizes


def measure(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    try:
        shown = str(path.resolve().relative_to(REPO))
    except ValueError:
        shown = str(path)
    row: dict[str, Any] = {"file": shown, "file_bytes": len(data)}
    row.update(compressed_sizes(data))
    is_glb = data[:4] == b"glTF"
    row["format"] = "glb" if is_glb else ("gltf" if data.lstrip()[:1] == b"{" else "unknown")
    if not is_glb:
        row["verdict"] = "not_run (GLB validator validates GLB only)"
        return row

    with io.BytesIO(data) as handle:
        outcome = validate_glb(handle, len(data), GlbSettings(), _no_check)
    metadata = build_metadata(outcome, METADATA_BUDGET)
    report = outcome.report
    counts = metadata.get("counts") or {}
    images = metadata.get("images") or []
    dims = [
        f"{i.get('width')}x{i.get('height')} {str(i.get('mime_type') or '?').split('/')[-1]}"
        for i in images
    ]
    texels = sum((i.get("width") or 0) * (i.get("height") or 0) for i in images)
    breakdown = byte_breakdown(data) or {}
    img_bytes = breakdown.get("image_bytes")
    row.update(
        {
            "verdict": "fail" if report.has_errors else "pass",
            "error_codes": " ".join(sorted(set(report.codes("error")))),
            "warning_codes": " ".join(sorted(set(report.codes("warning")))),
            "generator": metadata.get("generator"),
            "json_chunk_bytes": metadata.get("json_chunk_bytes"),
            "bin_chunk_bytes": metadata.get("bin_chunk_bytes"),
            **{key: breakdown.get(key) for key in BREAKDOWN_KEYS},
            "image_share": (
                round(img_bytes / len(data), 3) if img_bytes is not None and data else None
            ),
            "vertex_count": metadata.get("vertex_count"),
            "triangle_count": metadata.get("triangle_count"),
            "nodes": counts.get("nodes"),
            "meshes": counts.get("meshes"),
            "primitives": counts.get("primitives"),
            "accessors": counts.get("accessors"),
            "materials": counts.get("materials"),
            "textures": counts.get("textures"),
            "images": counts.get("images"),
            "image_dimensions": "; ".join(dims),
            "texels": texels,
            "animations": counts.get("animations"),
            "skins": counts.get("skins"),
            "joints": counts.get("joints"),
            "extensions_used": " ".join(metadata.get("extensions_used") or []),
            "extensions_required": " ".join(metadata.get("extensions_required") or []),
        }
    )
    return row


COLUMNS = [
    "file",
    "format",
    "verdict",
    "error_codes",
    "warning_codes",
    "file_bytes",
    "gzip6_bytes",
    "gzip9_bytes",
    "brotli11_bytes",
    "json_chunk_bytes",
    "bin_chunk_bytes",
    "image_bytes",
    "image_share",
    "vertex_bytes",
    "index_bytes",
    "animation_bytes",
    "skin_bytes",
    "vertex_count",
    "triangle_count",
    "nodes",
    "meshes",
    "primitives",
    "accessors",
    "materials",
    "textures",
    "images",
    "image_dimensions",
    "texels",
    "animations",
    "skins",
    "joints",
    "extensions_used",
    "extensions_required",
    "generator",
]


def emit(rows: Iterable[dict[str, Any]], fmt: str) -> None:
    rows = list(rows)
    if fmt == "json":
        payload = {"brotli_available": brotli is not None, "rows": rows}
        json.dump(payload, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return
    writer = csv.DictWriter(sys.stdout, fieldnames=COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in COLUMNS})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("paths", nargs="*", type=Path, help="files (default: scan the repository)")
    parser.add_argument("--format", choices=("csv", "json"), default="csv")
    parser.add_argument("--include-gltf", action="store_true", help="also list .gltf files")
    args = parser.parse_args(argv)
    paths = args.paths or discover(REPO, args.include_gltf)
    if not paths:
        print("no model files found", file=sys.stderr)
        return 1
    if brotli is None:
        print("note: brotli module not available; brotli11_bytes left empty", file=sys.stderr)
    emit((measure(p) for p in paths), args.format)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
