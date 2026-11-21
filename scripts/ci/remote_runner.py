#!/usr/bin/env python3
"""Run the planned unit suites for one commit on the LAI CI EC2 instance (runs as root via SSM).

Started by `.github/workflows/aws-integration-tests.yml` through `scripts/ci/ec2_ci.sh run`, after
the instance lock is held. It never decides pass or fail from exit codes alone: every suite writes
a JUnit report, and `ci_results.py` recomputes the verdict. Whatever happens, it writes
`results.json` (a crash becomes `harness_error`, a missing tool or service becomes a `blocked`
suite), so the workflow always has something to fail closed on.

Isolation: tests run as the unprivileged `lai-ci` user with a clean environment, a per-run database
password on the loopback-only PostgreSQL 16, no AWS configuration, and the instance metadata
service rejected for that user, so a test can never use the instance's AWS role.

Layout under /var/lib/lai-ci: repo.git (bare cache), harness/<sha>, cache/{venv-*,npm}, home,
runs/<run key>/{src,logs,junit,results.json,collect.json}.

Exit codes: 0 results written (any verdict); 3 the results could not be written.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import platform
import pwd
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tarfile
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ci_results  # noqa: E402
import plan_tests  # noqa: E402

ROOT = Path(os.environ.get("LAI_CI_ROOT", "/var/lib/lai-ci"))
LOCK_DIR = Path(os.environ.get("LAI_CI_LOCK_DIR", "/run/lai-ci/lock"))
CI_USER = "lai-ci"
DB_ROLE = "lai_ci"
DB_NAME = "lai_ci"
PG_PORT = "5432"
NODE_VERSION = "v22.23.5"
NODE_SHA256 = {
    "x64": "cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8",
    "arm64": "2babb9eb5264860d540849f4b064a6fbdebcdc323657d9d382ce23d313fd5e09",
}
IMDS_V4 = "169.254.169.254"
MIN_FREE_GB = 5
KEEP_RUNS = 10
LOG_TAIL_LINES = 300
MIN_SUITE_SECONDS = 60  # a suite is not started with less time than this left
SHA_RE = re.compile(r"^[0-9a-f]{40}$")

_log_file: Path | None = None


def now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(message: str) -> None:
    line = f"{now()} {message}"
    print(line, flush=True)
    if _log_file:
        with _log_file.open("a", encoding="utf-8") as out:
            out.write(line + "\n")


def sh(
    cmd: list[str], *, cwd: Path | None = None, timeout: float = 600, check: bool = True, **kw: Any
) -> subprocess.CompletedProcess:
    result = subprocess.run(  # noqa: S603 - fixed argument lists, no shell
        cmd, cwd=cwd, timeout=timeout, capture_output=True, text=True, **kw
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"{' '.join(cmd[:4])} exited {result.returncode}: {result.stderr.strip()[-800:]}"
        )
    return result


# --------------------------------------------------------------------------- preflight


class Preflight:
    def __init__(self) -> None:
        self.checks: list[dict[str, Any]] = []

    def record(self, name: str, ok: bool, detail: str = "", required: bool = True) -> bool:
        self.checks.append({"name": name, "ok": ok, "detail": detail, "required": required})
        log(f"preflight {name}: {'ok' if ok else 'FAILED'} {detail}")
        return ok

    def failed(self, *names: str) -> list[str]:
        return [c["name"] for c in self.checks if c["name"] in names and not c["ok"]]

    @property
    def ok(self) -> bool:
        return all(c["ok"] for c in self.checks if c["required"])


def ensure_user() -> pwd.struct_passwd:
    try:
        return pwd.getpwnam(CI_USER)
    except KeyError:
        sh(
            [
                "useradd",
                "--system",
                "--home-dir",
                str(ROOT / "home"),
                "--shell",
                "/bin/bash",
                CI_USER,
            ]
        )
        return pwd.getpwnam(CI_USER)


def check_os(pre: Preflight) -> None:
    info = {}
    try:
        for line in Path("/etc/os-release").read_text().splitlines():
            key, _, value = line.partition("=")
            info[key] = value.strip('"')
    except OSError:
        pass
    pretty = info.get("PRETTY_NAME", "unknown")
    pre.record("os", info.get("VERSION_ID") == "24.04", pretty, required=False)


def check_python(pre: Preflight) -> bool:
    version = sys.version_info
    if version < (3, 12):
        return pre.record("python", False, f"python3 is {platform.python_version()}, need 3.12+")
    probe = sh([sys.executable, "-c", "import ensurepip, venv"], check=False)
    if probe.returncode != 0:
        apt_install(["python3-venv", f"python3.{version.minor}-venv"])
        probe = sh([sys.executable, "-c", "import ensurepip, venv"], check=False)
    return pre.record(
        "python",
        probe.returncode == 0,
        f"{platform.python_version()} with venv" if probe.returncode == 0 else "venv unavailable",
    )


def apt_install(packages: list[str]) -> None:
    log(f"installing {' '.join(packages)}")
    env = {**os.environ, "DEBIAN_FRONTEND": "noninteractive"}
    sh(["apt-get", "update", "-q"], timeout=600, check=False, env=env)
    sh(["apt-get", "install", "-yq", *packages], timeout=900, check=False, env=env)


def node_arch() -> str | None:
    return {"x86_64": "x64", "aarch64": "arm64"}.get(platform.machine())


def ensure_node(pre: Preflight) -> Path | None:
    """The pinned Node 22 under /opt/lai-ci, downloaded once and checked against its SHA-256."""
    arch = node_arch()
    if arch is None:
        pre.record("node", False, f"unsupported CPU {platform.machine()}")
        return None
    name = f"node-{NODE_VERSION}-linux-{arch}"
    home = Path("/opt/lai-ci") / name
    node = home / "bin" / "node"
    if not node.exists():
        home.parent.mkdir(parents=True, exist_ok=True)
        tarball = home.parent / f"{name}.tar.xz"
        url = f"https://nodejs.org/dist/{NODE_VERSION}/{name}.tar.xz"
        try:
            sh(["curl", "-fsSL", "--retry", "3", "-o", str(tarball), url], timeout=600)
            digest = hashlib.sha256(tarball.read_bytes()).hexdigest()
            if digest != NODE_SHA256[arch]:
                raise RuntimeError(f"Node tarball checksum mismatch ({digest})")
            sh(["tar", "-xJf", str(tarball), "-C", str(home.parent)], timeout=600)
        except (RuntimeError, subprocess.TimeoutExpired) as exc:
            pre.record("node", False, f"could not install {name}: {exc}")
            return None
        finally:
            tarball.unlink(missing_ok=True)
    version = sh([str(node), "--version"], check=False).stdout.strip()
    pre.record("node", version == NODE_VERSION, version or "node did not run")
    return home / "bin" if version == NODE_VERSION else None


def check_postgres(pre: Preflight) -> bool:
    ready = sh(["pg_isready", "-h", "127.0.0.1", "-p", PG_PORT], check=False)
    if not pre.record("postgres-running", ready.returncode == 0, ready.stdout.strip()):
        return False
    version = psql("SHOW server_version_num", check=False)
    major = version.stdout.strip()[:2]
    if not pre.record("postgres-16", major == "16", f"server_version_num {version.stdout.strip()}"):
        return False
    listeners = sh(["ss", "-Hltn", f"sport = :{PG_PORT}"], check=False).stdout.split()
    addresses = [a.rsplit(":", 1)[0].strip("[]") for a in listeners if a.endswith(f":{PG_PORT}")]
    loopback = bool(addresses) and all(a in ("127.0.0.1", "::1") for a in addresses)
    return pre.record(
        "postgres-loopback-only", loopback, f"listening on {', '.join(addresses) or 'nothing'}"
    )


def psql(sql: str, *, check: bool = True) -> subprocess.CompletedProcess:
    return sh(
        [
            "runuser",
            "-u",
            "postgres",
            "--",
            "psql",
            "-p",
            PG_PORT,
            "-v",
            "ON_ERROR_STOP=1",
            "-tAX",
            "-c",
            sql,
        ],
        cwd=Path("/"),
        check=check,
    )


def check_disk(pre: Preflight) -> bool:
    free_gb = shutil.disk_usage(ROOT).free / 1e9
    return pre.record("disk", free_gb >= MIN_FREE_GB, f"{free_gb:.1f} GB free")


def block_metadata_service(pre: Preflight, uid: int) -> bool:
    """Reject the instance metadata service for the test user (its AWS role is not for tests)."""
    rule = ["OUTPUT", "-m", "owner", "--uid-owner", str(uid), "-d", IMDS_V4, "-j", "REJECT"]
    if shutil.which("iptables") is None:
        return pre.record("imds-blocked", False, "iptables is not installed")
    present = sh(["iptables", "-C", *rule], check=False).returncode == 0
    if not present:
        added = sh(["iptables", "-I", *rule], check=False)
        if added.returncode != 0:
            return pre.record("imds-blocked", False, added.stderr.strip())
    return pre.record("imds-blocked", True, f"metadata service rejected for uid {uid}")


def verify_lock(pre: Preflight, owner: str) -> bool:
    try:
        held_by = (LOCK_DIR / "owner").read_text().strip()
    except OSError:
        held_by = ""
    return pre.record("instance-lock", held_by == owner, f"held by {held_by or 'nobody'}")


# --------------------------------------------------------------------------- source


def git(repo: Path, *args: str, timeout: float = 600) -> str:
    return sh(["git", "--git-dir", str(repo), *args], timeout=timeout).stdout.strip()


def extract_source(repo: Path, commit: str, dest: Path, uid: int, gid: int) -> str:
    resolved = git(repo, "rev-parse", "--verify", f"{commit}^{{commit}}")
    if resolved != commit:
        raise RuntimeError(f"commit {commit} resolved to {resolved}")
    tree = git(repo, "rev-parse", f"{commit}^{{tree}}")
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    archive = subprocess.Popen(  # noqa: S603 - fixed arguments
        ["git", "--git-dir", str(repo), "archive", "--format=tar", commit],  # noqa: S607
        stdout=subprocess.PIPE,
    )
    with tarfile.open(fileobj=archive.stdout, mode="r|") as tar:
        tar.extractall(dest, filter="data")
    if archive.wait() != 0:
        raise RuntimeError("git archive failed")
    chown_tree(dest, uid, gid)
    return tree


def changed_files(repo: Path, base: str, commit: str) -> list[str]:
    ancestor = sh(
        ["git", "--git-dir", str(repo), "merge-base", "--is-ancestor", base, commit], check=False
    )
    if ancestor.returncode != 0:
        raise RuntimeError(f"base {base} is not an ancestor of {commit}")
    out = git(repo, "diff", "--name-only", "--no-renames", base, commit)
    return [line for line in out.splitlines() if line]


def chown_tree(path: Path, uid: int, gid: int) -> None:
    os.chown(path, uid, gid)
    for dirpath, dirnames, filenames in os.walk(path):
        for name in dirnames + filenames:
            os.lchown(os.path.join(dirpath, name), uid, gid)


# --------------------------------------------------------------------------- dependencies


def as_ci_user(cmd: list[str], env: dict[str, str]) -> list[str]:
    return [
        "runuser",
        "-u",
        CI_USER,
        "--",
        "env",
        "-i",
        *[f"{k}={v}" for k, v in env.items()],
        *cmd,
    ]


def base_env(node_bin: Path | None, venv: Path | None) -> dict[str, str]:
    path = [str(venv / "bin")] if venv else []
    path += [str(node_bin)] if node_bin else []
    path += ["/usr/local/bin", "/usr/bin", "/bin"]
    return {
        "PATH": ":".join(path),
        "HOME": str(ROOT / "home"),
        "LANG": "C.UTF-8",
        "TZ": "UTC",
        "CI": "true",
        "NO_COLOR": "1",
        "npm_config_cache": str(ROOT / "cache" / "npm"),
        "npm_config_update_notifier": "false",
        "PIP_DISABLE_PIP_VERSION_CHECK": "1",
        # Tests never see AWS configuration or the instance role (P1, GE-090).
        "AWS_CONFIG_FILE": "/dev/null",
        "AWS_SHARED_CREDENTIALS_FILE": "/dev/null",
        "AWS_EC2_METADATA_DISABLED": "true",
    }


def ensure_venv(src: Path, env: dict[str, str], logs: Path) -> Path:
    req = (src / "requirements-dev.txt").read_bytes() + (src / "requirements.txt").read_bytes()
    key = hashlib.sha256(req + platform.python_version().encode()).hexdigest()[:16]
    venv = ROOT / "cache" / f"venv-{key}"
    if (venv / ".complete").exists():
        log(f"python dependencies: cached {venv.name}")
        return venv
    tmp = ROOT / "cache" / f"venv-{key}.tmp"
    if tmp.exists():
        shutil.rmtree(tmp)
    with (logs / "install-python.log").open("w") as out:
        for cmd in (
            [sys.executable, "-m", "venv", str(tmp)],
            [str(tmp / "bin" / "pip"), "install", "-q", "-r", str(src / "requirements-dev.txt")],
        ):
            result = subprocess.run(  # noqa: S603
                as_ci_user(cmd, env), stdout=out, stderr=subprocess.STDOUT, timeout=1200
            )
            if result.returncode != 0:
                raise RuntimeError(f"python dependency install failed (exit {result.returncode})")
    (tmp / ".complete").touch()
    tmp.rename(venv)
    log(f"python dependencies: installed {venv.name}")
    return venv


def npm_ci(src: Path, env: dict[str, str], logs: Path) -> None:
    with (logs / "install-node.log").open("w") as out:
        result = subprocess.run(  # noqa: S603
            as_ci_user(["npm", "ci", "--no-audit", "--no-fund"], env),
            cwd=src,
            stdout=out,
            stderr=subprocess.STDOUT,
            timeout=1800,
        )
    if result.returncode != 0:
        raise RuntimeError(f"npm ci failed (exit {result.returncode})")


def prepare_database() -> dict[str, str]:
    """A login role with a fresh random password for this run, and its database."""
    password = secrets.token_hex(24)
    # Every interpolated value is a module constant or the hex token above: no external input.
    exists = psql(f"SELECT 1 FROM pg_roles WHERE rolname = '{DB_ROLE}'").stdout.strip()  # noqa: S608
    verb = "ALTER" if exists == "1" else "CREATE"
    psql(f"{verb} ROLE {DB_ROLE} LOGIN CREATEDB PASSWORD '{password}'")
    found = psql(f"SELECT 1 FROM pg_database WHERE datname = '{DB_NAME}'")  # noqa: S608
    if found.stdout.strip() != "1":
        psql(f"CREATE DATABASE {DB_NAME} OWNER {DB_ROLE}")
    psql(f"DROP DATABASE IF EXISTS test_{DB_NAME} WITH (FORCE)")
    return {
        "POSTGRES_USER": DB_ROLE,
        "POSTGRES_PASSWORD": password,
        "POSTGRES_DB": DB_NAME,
        "POSTGRES_PORT": PG_PORT,
        "POSTGRES_HOST": "127.0.0.1",
        "LAI_REQUIRE_POSTGRES": "1",
    }


def release_database() -> None:
    psql(f"DROP DATABASE IF EXISTS test_{DB_NAME} WITH (FORCE)", check=False)
    psql(f"ALTER ROLE {DB_ROLE} PASSWORD NULL", check=False)


# --------------------------------------------------------------------------- suites


def suite_command(suite: dict[str, Any], src: Path, venv: Path | None, junit: Path) -> list[str]:
    kind = suite["kind"]
    if kind in ("pytest", "check") and venv is None:
        raise ValueError(f"{kind} suites need the Python environment")
    if kind == "pytest":
        return [
            str(venv / "bin" / "python"),
            "-m",
            "pytest",
            "-q",
            "-o",
            "junit_family=xunit2",
            f"--junitxml={junit}",
            *suite["args"],
        ]
    if kind == "vitest":
        args = list(suite["args"])
        cmd = [str(src / "node_modules" / ".bin" / "vitest"), *args[:1]]
        if args[0] == "related":
            cmd.append("--run")
        if suite.get("allow_empty"):
            cmd.append("--passWithNoTests")
        return cmd + [
            "--reporter=default",
            "--reporter=junit",
            f"--outputFile.junit={junit}",
            *args[1:],
        ]
    if kind == "check":
        return [str(venv / "bin" / "python"), "manage.py", "makemigrations", "--check", "--dry-run"]
    raise ValueError(f"unknown suite kind {kind}")


def needs(suite: dict[str, Any]) -> set[str]:
    return {"pytest": {"python", "db"}, "check": {"python", "db"}, "vitest": {"node"}}[
        suite["kind"]
    ]


def run_suite(
    suite: dict[str, Any],
    *,
    src: Path,
    venv: Path | None,
    env: dict[str, str],
    out_dir: Path,
    deadline: float,
) -> dict[str, Any]:
    name = suite["name"]
    log_path = out_dir / "logs" / f"{name}.log"
    junit = out_dir / "junit" / f"{name}.xml"
    junit.unlink(missing_ok=True)
    cmd = suite_command(suite, src, venv, junit)
    budget = deadline - time.monotonic()
    record: dict[str, Any] = {
        "name": name,
        "kind": suite["kind"],
        "command": " ".join(Path(c).name if i == 0 else c for i, c in enumerate(cmd))[:2000],
        "cwd": suite["cwd"],
        "log": f"logs/{name}.log",
        "junit": f"junit/{name}.xml" if suite["kind"] != "check" else None,
    }
    if budget < MIN_SUITE_SECONDS:
        record.update(status="timed_out", reason="no time left in the run budget", exit_code=None)
        return record
    log(f"suite {name}: starting ({suite.get('why', '')})")
    started = time.monotonic()
    timed_out = False
    with log_path.open("w") as out:
        proc = subprocess.Popen(  # noqa: S603
            as_ci_user(cmd, env),
            cwd=src / suite["cwd"],
            stdout=out,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            exit_code = proc.wait(timeout=budget)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(proc.pid, signal.SIGKILL)
            exit_code = proc.wait()
    record["duration_s"] = round(time.monotonic() - started, 1)
    record["exit_code"] = exit_code

    parsed = None
    if suite["kind"] == "check":
        tail = log_tail(log_path, 40)
        failed = exit_code != 0
        parsed = {
            "counts": {
                "total": 1,
                "passed": 0 if failed else 1,
                "failed": int(failed),
                "errors": 0,
                "skipped": 0,
            },
            "failures": [
                {
                    "id": "makemigrations --check",
                    "file": "lai/apps",
                    "kind": "failure",
                    "message": "model changes without migrations",
                    "excerpt": tail,
                }
            ]
            if failed
            else [],
        }
    else:
        try:
            parsed = ci_results.parse_junit(junit)
        except ci_results.ResultsError as exc:
            record["junit_error"] = str(exc)
    status, reason = ci_results.suite_status(
        exit_code=exit_code,
        junit=parsed,
        allow_empty=bool(suite.get("allow_empty")),
        timed_out=timed_out,
    )
    record.update(status=status, reason=reason)
    if parsed:
        record["counts"] = parsed["counts"]
        record["failures"] = parsed["failures"]
    if status != "passed":
        record["log_tail"] = log_tail(log_path, 60)
    log(f"suite {name}: {status} {reason} in {record['duration_s']}s")
    return record


def log_tail(path: Path, lines: int) -> str:
    try:
        return "\n".join(path.read_text(errors="replace").splitlines()[-lines:])
    except OSError:
        return ""


# --------------------------------------------------------------------------- packaging


def package(run_dir: Path) -> dict[str, Any]:
    """Two archives for the workflow to fetch over SSM: lite (always) and full (logs, JUnit)."""
    collect: dict[str, Any] = {}
    lite_dir = run_dir / "lite"
    if lite_dir.exists():
        shutil.rmtree(lite_dir)
    (lite_dir / "logs").mkdir(parents=True)
    for log_path in sorted((run_dir / "logs").glob("*.log")):
        (lite_dir / "logs" / log_path.name).write_text(log_tail(log_path, LOG_TAIL_LINES))
    contents = {
        "lite": {"results.json": run_dir / "results.json", "logs": lite_dir / "logs"},
        "full": {
            member: run_dir / member
            for member in ("results.json", "plan.json", "changed-files.txt", "logs", "junit")
        },
    }
    for name, members in contents.items():
        archive = run_dir / f"{name}.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            for arcname, source in members.items():
                if source.exists():
                    tar.add(source, arcname=arcname)
        data = archive.read_bytes()
        encoded = base64.b64encode(data)
        (run_dir / f"{name}.b64").write_bytes(encoded)
        collect[name] = {
            "b64_path": str(run_dir / f"{name}.b64"),
            "b64_bytes": len(encoded),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
    (run_dir / "collect.json").write_text(json.dumps(collect))
    return collect


def prune_runs(current: Path) -> None:
    runs = sorted(
        (p for p in current.parent.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime
    )
    for old in runs[:-KEEP_RUNS]:
        if old != current:
            shutil.rmtree(old, ignore_errors=True)
    if not (ROOT / "harness").is_dir():
        return
    harnesses = sorted((ROOT / "harness").iterdir(), key=lambda p: p.stat().st_mtime)
    for old in harnesses[:-KEEP_RUNS]:
        shutil.rmtree(old, ignore_errors=True)


# --------------------------------------------------------------------------- main


def run(args: argparse.Namespace) -> dict[str, Any]:
    global _log_file
    request = json.loads(base64.b64decode(args.request_b64))
    for key in ("commit_sha", "base_sha", "harness_sha"):
        if not SHA_RE.match(request.get(key, "")):
            raise SystemExit(f"invalid {key}")
    if request["scope"] not in ci_results.SCOPES or request["commit_sha"] != args.commit:
        raise SystemExit("invalid request")
    run_dir = ROOT / "runs" / args.run_key
    run_dir.mkdir(parents=True, exist_ok=True)
    _log_file = run_dir / "logs" / "harness.log"
    for sub in ("logs", "junit"):
        (run_dir / sub).mkdir(exist_ok=True)
    doc = ci_results.new_results(request)
    doc["started_at"] = now()
    doc["host"] = {"machine": platform.machine(), "python": platform.python_version()}
    results_path = run_dir / "results.json"
    deadline = time.monotonic() + args.budget_minutes * 60
    pre = Preflight()
    db_ready = False
    try:
        if not verify_lock(pre, args.lock_owner):
            raise RuntimeError("this run does not hold the instance lock")
        user = ensure_user()
        for sub in ("cache", "home"):
            (ROOT / sub).mkdir(parents=True, exist_ok=True)
            os.chown(ROOT / sub, user.pw_uid, user.pw_gid)
        for sub in ("logs", "junit"):
            os.chown(run_dir / sub, user.pw_uid, user.pw_gid)
        check_os(pre)
        check_disk(pre)
        python_ok = check_python(pre)
        node_bin = ensure_node(pre)
        pg_ok = check_postgres(pre)
        block_metadata_service(pre, user.pw_uid)

        src = run_dir / "src"
        doc["tree_sha"] = extract_source(args.repo_git, args.commit, src, user.pw_uid, user.pw_gid)
        changed = changed_files(args.repo_git, request["base_sha"], args.commit)
        (run_dir / "changed-files.txt").write_text("\n".join(changed) + "\n")
        doc["plan"] = plan_tests.plan(src, request["scope"], changed, request["base_sha"])
        (run_dir / "plan.json").write_text(json.dumps(doc["plan"], indent=2))
        suites = doc["plan"]["suites"]
        kinds = set().union(*(needs(s) for s in suites)) if suites else set()

        env = base_env(node_bin, None)
        blocked: dict[str, str] = {}
        venv = None
        if "python" in kinds:
            if python_ok:
                try:
                    venv = ensure_venv(src, env, run_dir / "logs")
                    pre.record("python-dependencies", True, venv.name)
                except (RuntimeError, subprocess.TimeoutExpired) as exc:
                    pre.record("python-dependencies", False, str(exc))
            if venv is None:
                blocked["python"] = "Python or its pinned dependencies are unavailable"
        if "db" in kinds:
            if pg_ok and not pre.failed("postgres-loopback-only"):
                try:
                    env.update(prepare_database())
                    db_ready = True
                    pre.record("database", True, f"role {DB_ROLE}, fresh password")
                except RuntimeError as exc:
                    pre.record("database", False, str(exc))
            if not db_ready:
                blocked["db"] = "PostgreSQL 16 on loopback is unavailable"
        if "node" in kinds:
            if node_bin:
                try:
                    npm_ci(src, base_env(node_bin, None), run_dir / "logs")
                    pre.record("node-dependencies", True, "npm ci")
                except (RuntimeError, subprocess.TimeoutExpired) as exc:
                    pre.record("node-dependencies", False, str(exc))
                    blocked["node"] = "npm ci failed"
            else:
                blocked["node"] = f"Node {NODE_VERSION} is unavailable"
        if pre.failed("imds-blocked", "instance-lock", "disk"):
            blocked["isolation"] = "required isolation checks failed: " + ", ".join(
                pre.failed("imds-blocked", "instance-lock", "disk")
            )

        test_env = {**env, "PATH": base_env(node_bin, venv)["PATH"]}
        for suite in suites:
            reasons = [blocked[k] for k in sorted(needs(suite) | {"isolation"}) if k in blocked]
            if reasons:
                doc["suites"].append(
                    {
                        "name": suite["name"],
                        "kind": suite["kind"],
                        "status": "blocked",
                        "reason": "; ".join(reasons),
                        "exit_code": None,
                    }
                )
                log(f"suite {suite['name']}: blocked: {'; '.join(reasons)}")
                continue
            doc["suites"].append(
                run_suite(
                    suite, src=src, venv=venv, env=test_env, out_dir=run_dir, deadline=deadline
                )
            )
    except Exception as exc:  # noqa: BLE001 - every failure must still produce results
        doc["harness_error"] = f"{type(exc).__name__}: {exc}"
        log(f"HARNESS ERROR {doc['harness_error']}")
    finally:
        if db_ready:
            release_database()
        doc["preflight"] = {"ok": pre.ok, "checks": pre.checks}
        doc["finished_at"] = now()
        ci_results.finish_results(doc)
        results_path.write_text(json.dumps(doc, indent=2))
        log(f"verdict {doc['verdict']} complete={doc['complete']}")
        shutil.rmtree(run_dir / "src", ignore_errors=True)
        package(run_dir)
        prune_runs(run_dir)
    return doc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo-git", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--run-key", required=True)
    parser.add_argument("--lock-owner", required=True)
    parser.add_argument("--request-b64", required=True)
    parser.add_argument("--budget-minutes", type=int, default=150)
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[0-9]+-[0-9]+", args.run_key):
        raise SystemExit("invalid run key")
    try:
        doc = run(args)
    except OSError as exc:
        print(f"LAI_CI_HARNESS_FAILED {exc}", flush=True)
        return 3
    print(f"LAI_CI_DONE verdict={doc['verdict']} complete={doc['complete']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
