"""The `asset.optimize` task (ADR-070): read a staff GLB, optimize it, write derived artifacts.

    run_optimize(payload, ports, *, environ=None, tools=None, workdir_root=None) -> dict

Payload (schema 1, strict keys): `storage_key` (the asset version's object key), `format`
(`glb`), `profile` (`meshopt-conservative`; KTX2 profiles join after the KTX2 phase), and
optional `max_bytes`. The task:

1. refuses when the profile's control is off (`LAI_GLB_MESHOPT` / `LAI_GLB_KTX2`, default off):
   defence in depth, submission is refused upstream first (COMPLETION_INTEGRATION.md section 3);
2. reads the object through the existing read-only asset ports (`asset_object_size`,
   `read_asset`), bounded by `max_bytes` and the 50 MiB GLB ceiling;
3. runs `lai_native.optimize` in a private directory under `/tmp`, removed afterwards;
4. writes two derived artifacts through the create-only artifact port: `model.optimized`
   (`model/gltf-binary`) and `model.optimize_report` (`application/json`). It never writes the
   original key or a published key; the port builds keys under `processing/artifacts/`.

Errors: `OptimizeTaskError(code, retryable)`, shaped like `jobs_core.tasks.TaskError`, so the
handler maps them the same way (retryable raises for SQS; others become a `failed` result).
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Protocol

from lai_native.optimize import MESHOPT_CONSERVATIVE, OptimizeError, ToolPaths, optimize_meshopt
from lai_native.optimize.profiles import OptimizeProfile
from lai_processing.processors.gltf.compression.policy import (
    KTX2_CONTROL,
    MESHOPT_CONTROL,
    enabled_controls,
)

__all__ = ["MAX_GLB_BYTES", "OptimizeTaskError", "run_optimize"]

MAX_GLB_BYTES = 50 * 1024 * 1024
_KEYS = frozenset({"storage_key", "format", "profile"})
_PROFILES: dict[str, OptimizeProfile] = {MESHOPT_CONSERVATIVE.name: MESHOPT_CONSERVATIVE}
_CONTROL_FOR_KIND = {"meshopt": MESHOPT_CONTROL, "ktx2": KTX2_CONTROL}
#: Failures caused by the input or the tool are deterministic: retrying cannot help.
_RETRYABLE = frozenset()


class OptimizeTaskError(Exception):
    def __init__(self, code: str, retryable: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class OptimizePorts(Protocol):
    def asset_object_size(self, key: str) -> int | None: ...

    def read_asset(self, key: str, start: int, length: int) -> bytes: ...

    def put_artifact(self, *, role: str, content_type: str, data: bytes, logical_id: str) -> str:
        """Create-only write of a derived artifact; returns its object key (Workstream A)."""
        ...


def _payload(payload: object) -> tuple[str, OptimizeProfile, int]:
    if not isinstance(payload, dict) or set(payload) not in (_KEYS, _KEYS | {"max_bytes"}):
        raise OptimizeTaskError("invalid_payload")
    key, file_format, profile_name = payload["storage_key"], payload["format"], payload["profile"]
    if not isinstance(key, str) or not key or ".." in key or key.startswith("/"):
        raise OptimizeTaskError("invalid_asset_key")
    if file_format != "glb" or not key.endswith(".glb"):
        raise OptimizeTaskError("unsupported_format")
    if not isinstance(profile_name, str) or profile_name not in _PROFILES:
        raise OptimizeTaskError("unknown_profile")
    limit = MAX_GLB_BYTES
    if "max_bytes" in payload:
        value = payload["max_bytes"]
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise OptimizeTaskError("invalid_payload")
        limit = min(value, MAX_GLB_BYTES)
    return key, _PROFILES[profile_name], limit


def run_optimize(
    payload: object,
    ports: OptimizePorts,
    *,
    environ: Mapping[str, str] | None = None,
    tools: ToolPaths | None = None,
    workdir_root: str | None = None,
) -> dict[str, Any]:
    env = os.environ if environ is None else environ
    key, profile, limit = _payload(payload)
    if _CONTROL_FOR_KIND[profile.kind] not in enabled_controls(env):
        raise OptimizeTaskError("optimization_disabled")
    size = ports.asset_object_size(key)
    if size is None:
        raise OptimizeTaskError("object_missing")
    if size > limit:
        raise OptimizeTaskError("object_too_large")
    source = ports.read_asset(key, 0, size)
    if len(source) != size:
        raise OptimizeTaskError("object_changed", retryable=True)
    tools = tools or ToolPaths.from_environment(dict(env))
    workdir = Path(tempfile.mkdtemp(prefix="lai-optimize-", dir=workdir_root))
    try:
        if profile.kind != "meshopt":
            raise OptimizeTaskError("unknown_profile")
        result = optimize_meshopt(source, tools=tools, workdir=workdir, profile=profile)
    except OptimizeError as error:
        raise OptimizeTaskError(error.code, error.code in _RETRYABLE) from None
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    report = dict(result.report)
    model_key = ports.put_artifact(
        role="model.optimized",
        content_type="model/gltf-binary",
        data=result.output,
        logical_id="optimized",
    )
    report_bytes = json.dumps(report, sort_keys=True, separators=(",", ":")).encode()
    report_key = ports.put_artifact(
        role="model.optimize_report",
        content_type="application/json",
        data=report_bytes,
        logical_id="optimize-report",
    )
    return {
        "storage_key": key,
        "profile": profile.label,
        "artifacts": [
            {
                "role": "model.optimized",
                "key": model_key,
                "content_type": "model/gltf-binary",
                "bytes": report["output"]["bytes"],
                "sha256": report["output"]["sha256"],
            },
            {
                "role": "model.optimize_report",
                "key": report_key,
                "content_type": "application/json",
                "bytes": len(report_bytes),
            },
        ],
        "summary": {
            "source_bytes": report["source"]["bytes"],
            "output_bytes": report["output"]["bytes"],
            "size_ratio": report["size_ratio"],
            "processing_seconds": report["processing_seconds"],
            "animation_compatible": report["animation"]["compatible"],
        },
    }
