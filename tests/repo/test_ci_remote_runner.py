"""scripts/ci/remote_runner.py: suite execution, fail-closed results and packaging, with the
privileged steps (runuser, chown, PostgreSQL, iptables, downloads) replaced by fakes."""

import base64
import hashlib
import importlib.util
import json
import os
import pwd
import shutil
import subprocess
import sys
import tarfile
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ci"))
_SPEC = importlib.util.spec_from_file_location(
    "remote_runner", ROOT / "scripts/ci/remote_runner.py"
)
assert _SPEC and _SPEC.loader
runner = importlib.util.module_from_spec(_SPEC)
sys.modules["remote_runner"] = runner
_SPEC.loader.exec_module(runner)

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="needs git")

FAKE_VITEST = textwrap.dedent(
    """\
    #!{python}
    import os, sys, time
    out = next(a.split("=", 1)[1] for a in sys.argv if a.startswith("--outputFile.junit="))
    mode = os.environ.get("FAKE_MODE", "pass")
    if mode == "sleep":
        time.sleep(30)
    if mode != "nojunit":
        failure = '<failure message="expected 1">AssertionError</failure>' if mode == "fail" else ""
        open(out, "w").write(
            '<testsuites><testsuite><testcase classname="src/a.test.ts" name="a">'
            + failure + "</testcase></testsuite></testsuites>"
        )
    sys.exit(1 if mode == "fail" else 0)
    """
)


@pytest.fixture
def plain(monkeypatch):
    """Run commands as the current user with the given clean environment."""
    monkeypatch.setattr(
        runner,
        "as_ci_user",
        lambda cmd, env: ["env", "-i", *[f"{k}={v}" for k, v in env.items()], *cmd],
    )


def make_src(tmp_path: Path) -> Path:
    src = tmp_path / "src"
    vitest = src / "node_modules/.bin/vitest"
    vitest.parent.mkdir(parents=True)
    vitest.write_text(FAKE_VITEST.format(python=sys.executable))
    vitest.chmod(0o755)
    (src / "react").mkdir()
    return src


def out_dir(tmp_path: Path) -> Path:
    out = tmp_path / "run"
    for sub in ("logs", "junit"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    return out


VITEST_SUITE = {"name": "react", "kind": "vitest", "cwd": "react", "args": ["run"], "why": "t"}


# --------------------------------------------------------------------------- commands


def test_suite_commands_write_junit_and_never_lint_or_build(tmp_path):
    venv = tmp_path / "venv"
    junit = tmp_path / "j.xml"
    pytest_cmd = runner.suite_command(
        {"kind": "pytest", "args": ["lai/apps/regions"]}, tmp_path, venv, junit
    )
    assert pytest_cmd[:3] == [str(venv / "bin/python"), "-m", "pytest"]
    assert f"--junitxml={junit}" in pytest_cmd and pytest_cmd[-1] == "lai/apps/regions"
    related = runner.suite_command(
        {"kind": "vitest", "args": ["related", "src/a.ts"], "allow_empty": True},
        tmp_path,
        None,
        junit,
    )
    assert related[1:4] == ["related", "--run", "--passWithNoTests"]
    assert f"--outputFile.junit={junit}" in related and related[-1] == "src/a.ts"
    check = runner.suite_command({"kind": "check", "args": []}, tmp_path, venv, junit)
    assert check[1:] == ["manage.py", "makemigrations", "--check", "--dry-run"]
    every = " ".join(pytest_cmd + related + check)
    for banned in ("playwright", "ruff", "prettier", "oxlint", "build"):
        assert banned not in every


def test_tests_never_see_aws_configuration():
    env = runner.base_env(None, None)
    assert env["AWS_CONFIG_FILE"] == "/dev/null"
    assert env["AWS_SHARED_CREDENTIALS_FILE"] == "/dev/null"
    assert env["AWS_EC2_METADATA_DISABLED"] == "true"


# --------------------------------------------------------------------------- run_suite


@pytest.mark.parametrize(
    ("mode", "status"), [("pass", "passed"), ("fail", "failed"), ("nojunit", "error")]
)
def test_run_suite_status_comes_from_the_report(tmp_path, plain, mode, status):
    src = make_src(tmp_path)
    env = {"PATH": "/usr/bin:/bin", "FAKE_MODE": mode}
    record = runner.run_suite(
        VITEST_SUITE,
        src=src,
        venv=None,
        env=env,
        out_dir=out_dir(tmp_path),
        deadline=runner.time.monotonic() + 600,
    )
    assert record["status"] == status
    if mode == "fail":
        assert record["failures"][0]["message"] == "expected 1"
        assert record["counts"]["failed"] == 1


def test_run_suite_kills_a_suite_that_overruns(tmp_path, plain, monkeypatch):
    monkeypatch.setattr(runner, "MIN_SUITE_SECONDS", 0)
    src = make_src(tmp_path)
    started = runner.time.monotonic()
    record = runner.run_suite(
        VITEST_SUITE,
        src=src,
        venv=None,
        env={"PATH": "/usr/bin:/bin", "FAKE_MODE": "sleep"},
        out_dir=out_dir(tmp_path),
        deadline=started + 2,
    )
    assert record["status"] == "timed_out"
    assert runner.time.monotonic() - started < 20  # killed, not waited out


def test_run_suite_with_no_time_left_does_not_start(tmp_path, plain):
    record = runner.run_suite(
        VITEST_SUITE,
        src=make_src(tmp_path),
        venv=None,
        env={},
        out_dir=out_dir(tmp_path),
        deadline=runner.time.monotonic() + 5,
    )
    assert record["status"] == "timed_out" and record["exit_code"] is None


# --------------------------------------------------------------------------- packaging


def test_package_writes_verifiable_archives(tmp_path):
    run_dir = out_dir(tmp_path)
    (run_dir / "results.json").write_text('{"verdict": "pass"}')
    (run_dir / "logs/react.log").write_text("\n".join(f"line {i}" for i in range(1000)))
    (run_dir / "junit/react.xml").write_text("<testsuites/>")
    collect = runner.package(run_dir)
    assert json.loads((run_dir / "collect.json").read_text()) == collect
    for name in ("lite", "full"):
        data = base64.b64decode((run_dir / f"{name}.b64").read_bytes())
        assert hashlib.sha256(data).hexdigest() == collect[name]["sha256"]
    with tarfile.open(run_dir / "lite.tar.gz") as tar:
        names = tar.getnames()
        tail = tar.extractfile("logs/react.log").read().decode().splitlines()
    assert "results.json" in names and "junit" not in names
    assert len(tail) == runner.LOG_TAIL_LINES and tail[-1] == "line 999"
    with tarfile.open(run_dir / "full.tar.gz") as tar:
        assert "junit/react.xml" in tar.getnames()


# --------------------------------------------------------------------------- whole run


def git(*args, cwd):
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


@pytest.fixture
def repo(tmp_path):
    """A bare repository with a base commit and a commit that changes React code."""
    work = tmp_path / "work"
    work.mkdir()
    git("init", "-q", "-b", "main", cwd=work)
    git("config", "user.email", "ci@example.invalid", cwd=work)
    git("config", "user.name", "CI", cwd=work)
    (work / "lai/apps/core").mkdir(parents=True)
    (work / "lai/apps/core/__init__.py").write_text("")
    (work / "react/src").mkdir(parents=True)
    (work / "react/src/a.ts").write_text("export const a = 1\n")
    git("add", ".", cwd=work)
    git("commit", "-q", "-m", "base", cwd=work)
    base = git("rev-parse", "HEAD", cwd=work)
    (work / "react/src/a.ts").write_text("export const a = 2\n")
    git("commit", "-qam", "change", cwd=work)
    commit = git("rev-parse", "HEAD", cwd=work)
    bare = tmp_path / "repo.git"
    git("clone", "-q", "--bare", str(work), str(bare), cwd=tmp_path)
    return bare, base, commit


@pytest.fixture
def instance(tmp_path, monkeypatch, plain):
    """The instance's privileged pieces, faked; what each returns is set per test."""
    root = tmp_path / "lai-ci"
    lock = tmp_path / "lock"
    lock.mkdir()
    monkeypatch.setattr(runner, "ROOT", root)
    monkeypatch.setattr(runner, "LOCK_DIR", lock)
    me = pwd.getpwuid(os.getuid())
    monkeypatch.setattr(runner, "ensure_user", lambda: me)
    monkeypatch.setattr(runner.os, "chown", lambda *a: None)
    monkeypatch.setattr(runner, "chown_tree", lambda *a: None)
    monkeypatch.setattr(runner, "check_postgres", lambda pre: pre.record("postgres-running", True))
    monkeypatch.setattr(
        runner, "block_metadata_service", lambda pre, uid: pre.record("imds-blocked", True)
    )
    monkeypatch.setattr(runner, "check_python", lambda pre: pre.record("python", True))
    monkeypatch.setattr(runner, "release_database", lambda: None)
    state = {"node": True}

    def ensure_node(pre):
        pre.record("node", state["node"], "fake")
        return Path("/usr/bin") if state["node"] else None

    def npm_ci(src, env, logs):
        vitest = src / "node_modules/.bin/vitest"
        vitest.parent.mkdir(parents=True, exist_ok=True)
        vitest.write_text(FAKE_VITEST.format(python=sys.executable))
        vitest.chmod(0o755)

    monkeypatch.setattr(runner, "ensure_node", ensure_node)
    monkeypatch.setattr(runner, "npm_ci", npm_ci)
    return root, lock, state


def run_args(repo, commit, base, lock_owner="o/r/1-1"):
    bare, _, _ = repo
    request = {
        "commit_sha": commit,
        "base_sha": base,
        "harness_sha": commit,
        "scope": "affected",
        "request_id": "r1",
    }
    return runner.argparse.Namespace(
        repo_git=bare,
        commit=commit,
        run_key="1-1",
        lock_owner=lock_owner,
        budget_minutes=10,
        request_b64=base64.b64encode(json.dumps(request).encode()).decode(),
    )


def test_a_whole_run_passes_and_records_the_tested_tree(repo, instance):
    root, lock, _ = instance
    (lock / "owner").write_text("o/r/1-1\n")
    bare, base, commit = repo
    doc = runner.run(run_args(repo, commit, base))
    assert doc["verdict"] == "pass", doc["verdict_reasons"]
    assert doc["tree_sha"] == git("rev-parse", f"{commit}^{{tree}}", cwd=bare)
    assert [s["name"] for s in doc["suites"]] == ["react"]
    run_dir = root / "runs/1-1"
    assert json.loads((run_dir / "results.json").read_text())["commit_sha"] == commit
    assert (run_dir / "collect.json").exists()
    assert not (run_dir / "src").exists()  # the source is removed after the run


def test_missing_node_blocks_the_suite_and_the_run_is_incomplete(repo, instance):
    _, lock, state = instance
    (lock / "owner").write_text("o/r/1-1\n")
    state["node"] = False
    _, base, commit = repo
    doc = runner.run(run_args(repo, commit, base))
    assert doc["verdict"] == "incomplete"
    assert doc["suites"][0]["status"] == "blocked"
    assert doc["complete"] is False


def test_a_run_without_the_lock_does_nothing_and_is_incomplete(repo, instance):
    _, lock, _ = instance
    (lock / "owner").write_text("someone/else/9-1\n")
    _, base, commit = repo
    doc = runner.run(run_args(repo, commit, base))
    assert doc["verdict"] == "incomplete"
    assert "instance lock" in doc["harness_error"]
    assert doc["suites"] == []


def test_an_unknown_commit_is_a_harness_error_with_results_still_written(repo, instance):
    root, lock, _ = instance
    (lock / "owner").write_text("o/r/1-1\n")
    _, base, _ = repo
    missing = "d" * 40
    doc = runner.run(run_args(repo, missing, base))
    assert doc["verdict"] == "incomplete" and doc["harness_error"]
    assert (root / "runs/1-1/results.json").exists()
