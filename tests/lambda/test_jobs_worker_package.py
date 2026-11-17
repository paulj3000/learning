"""scripts/aws/package-lambda.sh: a deterministic zip, vendored providers, no Django."""

import hashlib
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "aws" / "package-lambda.sh"


def run_script(out: Path) -> Path:
    done = subprocess.run(
        ["bash", str(SCRIPT), "--out", str(out)],
        check=True,
        capture_output=True,
        text=True,
        env={"PATH": f"{Path(sys.executable).parent}:/usr/bin:/bin"},
    )
    return Path(done.stdout.strip())


def test_the_zip_is_deterministic_and_named_by_its_hash(tmp_path):
    first = run_script(tmp_path / "a")
    second = run_script(tmp_path / "b")
    assert first.name == second.name
    assert first.read_bytes() == second.read_bytes()
    digest = hashlib.sha256(first.read_bytes()).hexdigest()[:16]
    assert first.name == f"jobs-worker-{digest}.zip"
    with zipfile.ZipFile(first) as archive:
        names = archive.namelist()
        assert names == sorted(names)
        assert {info.date_time for info in archive.infolist()} == {(1980, 1, 1, 0, 0, 0)}
        assert "jobs_worker/handler.py" in names
        assert "jobs_worker/vendor/ai_providers/bedrock.py" in names
        assert "jobs_worker/vendor/jobs_core/tasks.py" in names
        assert not [n for n in names if "__pycache__" in n or n.endswith(".pyc")]
        vendored = archive.read("jobs_worker/vendor/ai_providers/bedrock.py")
    assert vendored == (ROOT / "lai/apps/ai/providers/bedrock.py").read_bytes()


def test_the_worker_imports_from_the_zip_without_django(tmp_path):
    archive = run_script(tmp_path)
    probe = (
        "import sys; sys.path.insert(0, sys.argv[1]); import jobs_worker.handler; "
        "bad = [m for m in sys.modules if m == 'django' or m.startswith(('django.', 'apps.'))]; "
        "assert not bad, bad; print('ok')"
    )
    done = subprocess.run(
        [sys.executable, "-I", "-c", probe, str(archive)],
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == "ok"


def test_usage_errors_exit_2(tmp_path):
    done = subprocess.run(["bash", str(SCRIPT), "--bogus"], capture_output=True, text=True)
    assert done.returncode == 2


def test_a_vendored_file_that_imports_django_is_refused(build_module, monkeypatch, tmp_path):
    bad = tmp_path / "bad.py"
    bad.write_text("from django.conf import settings\n")
    monkeypatch.setitem(build_module.VENDORED, "jobs_worker/vendor/jobs_core/bad.py", bad)
    try:
        build_module.entries()
    except build_module.BuildError:
        return
    raise AssertionError("a Django import was vendored")


# --- the processing library in the zip (ADR-064) ------------------------------------------------

ZIP_BUDGET_BYTES = 2 * 1024 * 1024


def test_the_zip_carries_the_processing_library_without_its_tooling(build_module):
    names = set(build_module.entries())
    for required in (
        "lai_processing/__init__.py",
        "lai_processing/version.py",
        "lai_processing/core/execution.py",
        "lai_processing/core/registry.py",
        "lai_processing/contracts/jobs.py",
        "lai_processing/contracts/results.py",
        "lai_processing/ports/storage.py",
        "lai_processing/processors/reference.py",
        "lai_processing/processors/gltf/processor.py",
        "lai_processing/processors/gltf/document.py",
        "lai_processing/processors/animation/__init__.py",
        "lai_processing/processors/animation/inspect.py",
        "lai_processing/processors/animation/processor.py",
        "lai_processing/processors/audio/processor.py",
        "lai_processing/processors/audio/wav.py",
        "lai_processing/processors/audio/mp3.py",
        "lai_processing/processors/audio/ogg.py",
        "jobs_worker/vendor/jobs_core/contract.py",
    ):
        assert required in names, required
    assert not [
        n
        for n in names
        if n.startswith(("lai_processing/testing/", "lai_processing/cli/"))
        or n == "lai_processing/__main__.py"
    ]
    # Only Python source: no fixtures, schemas or caches.
    assert all(n.endswith(".py") for n in names)
    contract = (ROOT / "lai/apps/jobs/core/contract.py").read_bytes()
    assert build_module.entries()["jobs_worker/vendor/jobs_core/contract.py"] == contract


def test_two_builds_give_the_same_bytes_and_name(build_module, tmp_path):
    first = build_module.build(tmp_path / "a")
    second = build_module.build(tmp_path / "b")
    assert first.name == second.name
    assert first.read_bytes() == second.read_bytes()


def test_the_zip_stays_under_its_size_budget(build_module):
    assert len(build_module.zip_bytes()) < ZIP_BUDGET_BYTES


def test_a_processing_module_that_imports_django_is_refused(build_module, monkeypatch, tmp_path):
    copy = tmp_path / "lai_processing"
    shutil.copytree(build_module.PROCESSING, copy, ignore=shutil.ignore_patterns("__pycache__"))
    (copy / "core" / "sneaky.py").write_text("import django\n")
    monkeypatch.setattr(build_module, "PROCESSING", copy)
    with pytest.raises(build_module.BuildError, match="lai_processing/core/sneaky.py"):
        build_module.entries()


def test_an_excluded_processing_module_is_not_checked_or_shipped(
    build_module, monkeypatch, tmp_path
):
    copy = tmp_path / "lai_processing"
    shutil.copytree(build_module.PROCESSING, copy, ignore=shutil.ignore_patterns("__pycache__"))
    (copy / "testing" / "extra.py").write_text("x = 1\n")
    monkeypatch.setattr(build_module, "PROCESSING", copy)
    assert "lai_processing/testing/extra.py" not in build_module.entries()


def test_the_contract_kinds_run_from_the_staged_zip_alone(build_module, tmp_path):
    """Isolated interpreter, only the stage on sys.path: the worker and the processors import
    and run without Django, boto3 or the repository's processing/ directory."""
    staged = build_module.stage(tmp_path / "stage")
    probe = """
import sys
sys.path[:] = [sys.argv[1]] + [p for p in sys.path if "site-packages" not in p]
import jobs_worker.handler
from jobs_worker.vendor.jobs_core import contract, tasks
import lai_processing
from lai_processing.core.registry import default_registry
assert lai_processing.__file__.startswith(sys.argv[1]), lai_processing.__file__
registry = default_registry()
for kind, profile in (("asset.validate_model", "glb-default"),
                      ("reference.checksum", "reference-default"),
                      ("asset.analyze_animation", "animation-default"),
                      ("asset.process_audio", "audio-inspect")):
    from lai_processing.contracts.common import ProfileRef
    registry.resolve(kind, ProfileRef(profile, 1))
assert contract.CONTRACT_KINDS == {
    "asset.validate_model", "reference.checksum", "asset.analyze_animation",
    "asset.process_audio",
}
bad = sorted(m for m in sys.modules
             if m.split(".")[0] in {"django", "apps", "rest_framework", "boto3", "botocore"})
assert not bad, bad
print("ok")
"""
    done = subprocess.run(
        [sys.executable, "-I", "-c", probe, str(staged)],
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == "ok"
