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
import subprocess  # noqa: S404 - local benchmark, argv lists only
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "processing"))

from lai_native.optimize import ToolPaths  # noqa: E402
from lai_native.optimize.meshopt import OptimizeError, optimize_meshopt  # noqa: E402
from lai_native.optimize.profiles import PROFILES, gltfpack_argv  # noqa: E402

TIME = "/usr/bin/time"


def timed(argv: list[str], cwd: Path, env: dict[str, str]) -> tuple[float, int | None]:
    """Wall seconds and peak RSS (KiB) of the tool process alone, from GNU time."""
    report = cwd / "time.txt"
    started = time.monotonic()
    subprocess.run(  # noqa: S603
        [TIME, "-f", "%M", "-o", str(report), *argv], cwd=cwd, env=env, check=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    wall = time.monotonic() - started
    text = report.read_text().strip().splitlines()
    return wall, int(text[-1]) if text and text[-1].isdigit() else None


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
    if tools.gltfpack is None:
        print("LAI_GLTFPACK is not set (native/gltf/fetch-tools.sh)", file=sys.stderr)
        return 2
    env = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
    print(
        f"Workstation: {platform.machine()} {platform.processor() or ''} "
        f"{os.cpu_count()} CPUs, Python {platform.python_version()}, profile {profile.label}"
    )
    print()
    print(
        "| Model | Source bytes (gzip -9) | Output bytes (gzip -9) | Output / source "
        "| gltfpack s | gltfpack peak RSS MiB | Step s | Preserved | GPU texture MiB (calc.) |"
    )
    print("|---|---:|---:|---:|---:|---:|---:|---|---:|")
    for model in args.models:
        source = model.read_bytes()
        with tempfile.TemporaryDirectory() as work:
            workdir = Path(work)
            (workdir / "source.glb").write_bytes(source)
            wall, rss = timed([str(tools.gltfpack), *gltfpack_argv(profile)], workdir, env)
            try:
                result = optimize_meshopt(source, tools=tools, workdir=workdir / "step")
                output = result.output
                report = result.report
                preserved = "yes"
                step = report["processing_seconds"]
                gpu = report["textures"]["gpu_bytes_estimate"] / 2**20
            except OptimizeError as error:
                output = (workdir / "output.glb").read_bytes()
                preserved = f"no ({error.code})"
                step = float("nan")
                gpu = float("nan")
        name = model.relative_to(ROOT) if model.is_absolute() else model
        print(
            f"| `{name}` | {len(source):,} ({len(gzip.compress(source, 9)):,}) "
            f"| {len(output):,} ({len(gzip.compress(output, 9)):,}) "
            f"| {len(output) / len(source):.1%} | {wall:.3f} | "
            f"{(rss or 0) / 1024:.1f} | {step:.3f} | {preserved} | {gpu:.2f} |"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
