"""The Meshopt optimization step: gltfpack, then structural validation and preservation checks.

`optimize_meshopt(source, tools=..., workdir=...)` runs the pinned `meshopt-conservative`
profile on a GLB and returns the optimized bytes with a `model.optimize_report` dictionary, or
raises `OptimizeError` with a stable code. It fails the job, rather than returning a degraded
output, when:

- the source is not a readable GLB, or already uses a compression extension (`source_*`);
- gltfpack is missing, times out or exits non-zero (`tool_*`);
- the output is not smaller than the source (`no_size_gain`);
- the output's `EXT_meshopt_compression` use is structurally invalid (`output_invalid`, the
  same `validate_meshopt` the validators will call);
- anything the game relies on changed (`preservation_failed`: hierarchy, names, materials,
  skins, animation names and durations, image bytes; `signature.compare_signatures`).

It never writes outside `workdir` and never touches the original object: storage and artifact
recording belong to the worker (`lambda/optimize_worker`) and the derived-artifact port.
"""

from __future__ import annotations

import hashlib
import io
import os
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

from lai_processing.processors.gltf.compression.meshopt import validate_meshopt
from lai_processing.processors.gltf.container import read_layout
from lai_processing.processors.gltf.jsonparse import parse_document
from lai_processing.processors.gltf.report import Report, Stop

from .profiles import MESHOPT_CONSERVATIVE, OUTPUT_NAME, SOURCE_NAME, OptimizeProfile, gltfpack_argv
from .runner import ToolError, ToolResult, run_tool
from .signature import ModelSignature, SignatureError, compare_signatures, model_signature
from .textures import texture_memory

__all__ = [
    "COMPRESSION_EXTENSIONS",
    "REPORT_SCHEMA",
    "OptimizeError",
    "OptimizeResult",
    "ToolPaths",
    "optimize_meshopt",
]

REPORT_SCHEMA: Final = "lai.optimize_report/1"
COMPRESSION_EXTENSIONS: Final = frozenset(
    {
        "EXT_meshopt_compression",
        "KHR_meshopt_compression",
        "KHR_draco_mesh_compression",
        "KHR_texture_basisu",
    }
)
_MAX_STDERR_CHARS: Final = 500

RunTool = Callable[..., ToolResult]


class OptimizeError(RuntimeError):
    """A failed optimization. `code` is stable; `details` is bounded and code-authored."""

    def __init__(self, code: str, message: str, details: list[dict[str, str]] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or []


@dataclass(frozen=True, slots=True)
class ToolPaths:
    gltfpack: Path | None = None
    toktx: Path | None = None
    ktx: Path | None = None
    #: Extra `LD_LIBRARY_PATH` for the KTX-Software tools (its `lib/` directory).
    library_path: str | None = None

    @classmethod
    def from_environment(cls, environ: dict[str, str] | None = None) -> ToolPaths:
        env = os.environ if environ is None else environ

        def path(name: str) -> Path | None:
            value = env.get(name, "").strip()
            return Path(value) if value else None

        return cls(
            gltfpack=path("LAI_GLTFPACK"),
            toktx=path("LAI_TOKTX"),
            ktx=path("LAI_KTX"),
            library_path=env.get("LAI_KTX_LIBRARY_PATH") or None,
        )


@dataclass
class OptimizeResult:
    output: bytes
    report: dict[str, Any] = field(default_factory=dict)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _signature(data: bytes, code: str) -> ModelSignature:
    try:
        return model_signature(data)
    except SignatureError as error:
        raise OptimizeError(
            code,
            "The model could not be inspected.",
            [{"code": c, "path": ""} for c in error.codes[:20]],
        ) from None


def _tool_report(result: ToolResult, executable: str, argv: list[str]) -> dict[str, Any]:
    return {
        "executable": Path(executable).name,
        "argv": argv,
        "returncode": result.returncode,
        "wall_seconds": round(result.wall_seconds, 4),
        "peak_rss_kib": result.peak_rss_kib,
    }


def check_meshopt_output(data: bytes) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Structural `EXT_meshopt_compression` validation of an output GLB.

    Returns the meshopt facts and the error findings (empty when valid)."""
    report = Report()
    handle = io.BytesIO(data)
    try:
        layout = read_layout(handle, len(data), report, 64 * 1024 * 1024)
        raw = data[layout.json_offset : layout.json_offset + layout.json_length]
        document = parse_document(raw, report, 128, 4_000_000, lambda: None)
    except Stop:
        return {}, [{"code": c, "path": ""} for c in report.codes()]
    bin_offset = layout.bin_offset
    bin_length = layout.bin_length

    def read(buffer: int, offset: int, length: int) -> bytes | None:
        if buffer != 0 or bin_offset is None or bin_length is None:
            return None
        end = min(offset + length, bin_length)
        if offset < 0 or offset >= end:
            return None
        return data[bin_offset + offset : bin_offset + end]

    lengths: list[int | None] = [bin_length]
    facts = validate_meshopt(document, report, buffer_lengths=lengths, read=read)
    errors = [
        {"code": f.code, "path": f.path} for f in report.findings() if f.severity.value == "error"
    ]
    return facts.as_metadata(), errors


def optimize_meshopt(
    source: bytes,
    *,
    tools: ToolPaths,
    workdir: Path,
    profile: OptimizeProfile = MESHOPT_CONSERVATIVE,
    run: RunTool = run_tool,
    clock: Callable[[], float] = time.monotonic,
) -> OptimizeResult:
    started = clock()
    if profile.kind != "meshopt":
        raise OptimizeError("profile_mismatch", "This step runs Meshopt profiles only.")
    before = _signature(source, "source_unreadable")
    already = sorted(set(before.extensions_used) & COMPRESSION_EXTENSIONS)
    if already:
        raise OptimizeError(
            "source_already_compressed",
            "The source model already uses a compression extension.",
            [{"code": "extension", "path": name} for name in already],
        )
    if tools.gltfpack is None:
        raise OptimizeError("tool_not_found", "gltfpack is not configured.")
    workdir.mkdir(parents=True, exist_ok=True)
    (workdir / SOURCE_NAME).write_bytes(source)
    output_path = workdir / OUTPUT_NAME
    output_path.unlink(missing_ok=True)
    argv = gltfpack_argv(profile)
    try:
        result = run(
            tools.gltfpack,
            argv,
            timeout_s=profile.timeout_s,
            max_output_bytes=profile.max_output_bytes,
            workdir=workdir,
        )
    except ToolError as error:
        raise OptimizeError(error.code, str(error)) from None
    if result.returncode != 0 or not output_path.is_file():
        tail = result.stderr.decode("utf-8", "replace")[-_MAX_STDERR_CHARS:]
        raise OptimizeError(
            "tool_failed",
            "gltfpack did not produce an output.",
            [{"code": "stderr_tail", "path": tail}],
        )
    output = output_path.read_bytes()
    if len(output) >= len(source):
        raise OptimizeError(
            "no_size_gain",
            "The optimized model is not smaller than the source.",
            [{"code": "bytes", "path": f"{len(source)}->{len(output)}"}],
        )
    meshopt_facts, invalid = check_meshopt_output(output)
    if invalid:
        raise OptimizeError("output_invalid", "The optimized model is not valid.", invalid[:20])
    after = _signature(output, "output_unreadable")
    differences = compare_signatures(before, after, textures=profile.textures)
    if differences:
        raise OptimizeError(
            "preservation_failed",
            "The optimized model changed something the game relies on.",
            [{"code": d.code, "path": d.path} for d in differences],
        )
    report: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "profile": profile.label,
        "tool": {"name": "gltfpack", **_tool_report(result, str(tools.gltfpack), argv)},
        "source": {"bytes": len(source), "sha256": _sha256(source)},
        "output": {"bytes": len(output), "sha256": _sha256(output)},
        "size_ratio": round(len(output) / len(source), 4),
        "geometry": {"source": before.summary(), "output": after.summary()},
        "meshopt": meshopt_facts,
        "textures": texture_memory(after),
        "animation": {
            "clips": [
                {"name": c["name"], "duration_seconds": c["duration_seconds"]} for c in after.clips
            ],
            "compatible": True,
        },
        "preservation": {"differences": [], "textures": profile.textures},
        "processing_seconds": round(clock() - started, 4),
        "measurement": "measured on the machine that ran the job",
    }
    return OptimizeResult(output=output, report=report)
