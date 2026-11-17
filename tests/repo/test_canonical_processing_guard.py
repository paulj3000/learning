"""ADR-064 guard: background processing has one canonical path (docs/processing/CANONICAL_PATH.md).

The superseded serverless-processing plan (PR #40 and #41) must not come back by accident: no
`LaiProcessing-<env>` or `LaiProcessingImages-<env>` stack, no ECR worker image
(`Dockerfile.lambda`), no `deploy-processing.yml`, no `lai_processing_runtime`, no
`jobs_dispatch` or `jobs_consume_completions` command and no `lai-jobs-dispatch` or
`lai-jobs-completions` unit. `jobs_consume_results` is the only results consumer. Changing any
of this needs a new ADR, not an edit to this test.
"""

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "cdk.out", "dist", "build"}
FORBIDDEN_NAMES = re.compile(
    r"^(Dockerfile\.lambda|deploy-processing\.ya?ml|lai_processing_runtime(\.py)?"
    r"|jobs_dispatch\.py|jobs_consume_completions\.py"
    r"|lai-jobs-(dispatch|completions)\.(service|timer))$"
)
FORBIDDEN_TEXT = re.compile(
    r"LaiProcessing|Dockerfile\.lambda|deploy-processing\.ya?ml|lai_processing_runtime"
    r"|jobs_dispatch|jobs_consume_completions|lai-jobs-dispatch|lai-jobs-completions"
)
#: Deployable code and configuration (docs and this test describe the superseded plan by name).
CODE_ROOTS = ("infra", "lambda", "scripts", "deploy", ".github", "lai", "processing", "Makefile")


def repo_files() -> list[Path]:
    try:
        done = subprocess.run(
            [
                "git",
                "-C",
                str(ROOT),
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
            ],
            capture_output=True,
            check=True,
        )
        files = [ROOT / name for name in done.stdout.decode().split("\0") if name]
    except (OSError, subprocess.CalledProcessError):
        files = [p for p in ROOT.rglob("*") if p.is_file()]
    return [
        p for p in files if p.is_file() and not SKIP_DIRS.intersection(p.relative_to(ROOT).parts)
    ]


FILES = repo_files()


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def test_no_competing_processing_files_exist():
    found = [
        relative(p)
        for p in FILES
        if FORBIDDEN_NAMES.match(p.name)
        or any(part == "lai_processing_runtime" for part in p.relative_to(ROOT).parts)
    ]
    assert found == []


def test_no_deployable_code_names_the_superseded_infrastructure():
    found = []
    for path in FILES:
        rel = relative(path)
        if not rel.startswith(CODE_ROOTS) or path.suffix in {".png", ".glb", ".jpg", ".mp3"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        found += [f"{rel}: {m.group(0)}" for m in FORBIDDEN_TEXT.finditer(text)]
    assert found == []


def test_the_jobs_commands_are_the_results_consumer_and_the_sweep():
    commands = sorted(
        p.stem
        for p in FILES
        if p.parent.as_posix().endswith("management/commands") and p.stem.startswith("jobs_")
    )
    assert commands == ["jobs_consume_results", "jobs_sweep"]


def test_one_systemd_unit_consumes_job_results():
    units = [p for p in FILES if p.suffix in {".service", ".timer"}]
    jobs_units = sorted(p.name for p in units if p.name.startswith("lai-jobs"))
    assert jobs_units == ["lai-jobs-consumer.service"]
    consumers = {
        p.name: re.findall(r"manage\.py (jobs_\w+)", p.read_text())
        for p in units
        if "manage.py jobs_" in p.read_text()
    }
    assert consumers == {"lai-jobs-consumer.service": ["jobs_consume_results"]}


def test_the_dev_platform_has_no_container_registry():
    stack = (ROOT / "infra/lib/devPlatformStack.ts").read_text()
    assert "aws-ecr" not in stack and "ecr." not in stack
    assert "PackageType" not in stack and "ImageUri" not in stack
