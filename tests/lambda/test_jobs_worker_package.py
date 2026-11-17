"""scripts/aws/package-lambda.sh: a deterministic zip, vendored providers, no Django."""

import hashlib
import subprocess
import sys
import zipfile
from pathlib import Path

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
