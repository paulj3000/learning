#!/usr/bin/env python3
"""GLB optimization benchmark (LAI-LAMBDA-010, ADR-070). LOCAL WORKSTATION USE ONLY.

Runs the pinned profiles of `lai_native.optimize` on copies of repository models and prints a
Markdown table: sizes, gzip -9 sizes, tool wall time and peak RSS (GNU time, the tool process
alone), whole-step time, preservation result and calculated texture GPU memory.

    source <(native/gltf/fetch-tools.sh)          # exports LAI_GLTFPACK, LAI_TOKTX, ...
    python3 native/gltf/bench.py --profile meshopt-conservative MODEL.glb ...

Never runs in CI (exit 3 when CI or GITHUB_ACTIONS is set), never downloads, never writes into
the repository (work happens in a temporary directory). Numbers are workstation measurements;
label them so wherever they are copied.
"""

from __future__ import annotations

import argparse
import gzip
import os
import platform
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "processing"))

from lai_native.optimize import ToolPaths  # noqa: E402
from lai_native.optimize.ktx2 import optimize_ktx2  # noqa: E402
from lai_native.optimize.meshopt import OptimizeError, optimize_meshopt  # noqa: E402
from lai_native.optimize.profiles import PROFILES  # noqa: E402
from lai_native.runtime import ToolResult, ToolSpec, Workspace, run_tool  # noqa: E402

TIME = "/usr/bin/time"


def timed_run():  # type: ignore[no-untyped-def]
    """A `run=` for the optimizer that measures the tool process alone with GNU time, through
    the same `lai_native.runtime.run_tool` (limits, scrubbed environment) the job uses."""
    samples: list[tuple[float, int | None]] = []

    def run(spec, argv, workspace, limits, **kwargs):  # type: ignore[no-untyped-def]
        report = workspace.safe_path("time.txt")
        wrapper = ToolSpec("time", TIME, None, dict(spec.extra_env))
        result = run_tool(
            wrapper, ["-f", "%M", "-o", str(report), spec.path, *argv], workspace, limits, **kwargs
        )
        lines = report.read_text().strip().splitlines() if report.exists() else []
        rss = int(lines[-1]) if lines and lines[-1].isdigit() else None
        report.unlink(missing_ok=True)
        samples.append((result.elapsed_seconds, rss))
        return ToolResult(
            result.returncode,
            result.stdout,
            result.stderr,
            result.stderr_truncated,
            result.elapsed_seconds,
            rss if rss is not None else result.peak_rss_kb,
        )

    return run, samples


def main() -> int:
    if os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS"):
        print("benchmark refused in CI", file=sys.stderr)
        return 3
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default="meshopt-conservative", choices=sorted(PROFILES))
    parser.add_argument("models", nargs="+", type=Path)
    args = parser.parse_args()
    profile = PROFILES[args.profile]
    tools = ToolPaths.from_environment()
    tool = tools.gltfpack if profile.kind == "meshopt" else tools.toktx
    if tool is None:
        print("tool path not set (native/gltf/fetch-tools.sh)", file=sys.stderr)
        return 2
    step = optimize_meshopt if profile.kind == "meshopt" else optimize_ktx2
    print(
        f"Workstation: {platform.machine()}, {os.cpu_count()} CPUs visible, "
        f"Python {platform.python_version()}, profile {profile.label}, {tool.name}"
    )
    print()
    print(
        "| Model | Source bytes (gzip -9) | Output bytes (gzip -9) | Output / source "
        "| Tool s (sum) | Tool peak RSS MiB (max) | Step s | Result "
        "| GPU texture MiB before (calc.) | after (calc.) |"
    )
    print("|---|---:|---:|---:|---:|---:|---:|---|---:|---:|")
    for model in args.models:
        source = model.read_bytes()
        run, samples = timed_run()
        with tempfile.TemporaryDirectory() as work, Workspace(base=work) as workspace:
            try:
                result = step(source, tools=tools, workspace=workspace, profile=profile, run=run)
                output = result.output
                report = result.report
                outcome = "preserved"
                step_s = f"{report['processing_seconds']:.3f}"
                textures = report["textures"]
                before = textures.get(
                    "gpu_bytes_estimate_before", textures.get("gpu_bytes_estimate")
                )
                after = textures.get("gpu_bytes_estimate_after", textures.get("gpu_bytes_estimate"))
                gpu = f"{before / 2**20:.2f} | {after / 2**20:.2f}"
                packed = len(gzip.compress(output, 9))
                out = f"{len(output):,} ({packed:,}) | {len(output) / len(source):.1%}"
            except OptimizeError as error:
                outcome = f"failed: {error.code}"
                step_s, gpu, out = "n/a", "n/a | n/a", "n/a | n/a"
        wall = sum(s[0] for s in samples)
        rss = max((s[1] or 0 for s in samples), default=0)
        name = model.resolve().relative_to(ROOT)
        print(
            f"| `{name}` | {len(source):,} ({len(gzip.compress(source, 9)):,}) | {out} "
            f"| {wall:.3f} | {rss / 1024:.1f} | {step_s} | {outcome} | {gpu} |"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
