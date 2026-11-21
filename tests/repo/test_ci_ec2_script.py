"""scripts/ci/ec2_ci.sh, run for real against a fake aws CLI (ci_fake_aws.py): instance ownership,
the lock, input validation and the checksum-verified result copy."""

import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/ci/ec2_ci.sh"
FAKE = Path(__file__).with_name("ci_fake_aws.py")
SHA, BASE, HARNESS = "a" * 40, "b" * 40, "c" * 40
RUN_KEY = "123-1"
OWNER = "o/r/123-1"

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("jq") is None, reason="needs bash and jq"
)


class Env:
    def __init__(self, tmp_path: Path):
        self.state_dir = tmp_path / "state"
        self.state_dir.mkdir()
        self.out = tmp_path / "out"
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        aws = self.bin / "aws"
        aws.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{FAKE}" "$@"\n')
        aws.chmod(0o755)
        self.github_output = tmp_path / "github_output"
        self.github_output.write_text("")
        self.write({"ec2": "stopped", "ping": "Online", "lock_owner": None, "files": {}})

    def write(self, state: dict) -> None:
        (self.state_dir / "state.json").write_text(json.dumps(state))

    def state(self) -> dict:
        return json.loads((self.state_dir / "state.json").read_text())

    def update(self, **changes) -> None:
        state = self.state()
        state.update(changes)
        self.write(state)

    def calls(self) -> list[str]:
        path = self.state_dir / "calls.log"
        return path.read_text().splitlines() if path.exists() else []

    def outputs(self) -> dict:
        pairs = [line.split("=", 1) for line in self.github_output.read_text().splitlines()]
        return dict(pairs)  # the last value of a key wins, as in GitHub

    def run(self, command: str, **env: str) -> subprocess.CompletedProcess:
        full = {
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "FAKE_STATE": str(self.state_dir),
            "GITHUB_OUTPUT": str(self.github_output),
            "AWS_REGION": "us-west-1",
            "INSTANCE_ID": "i-0123",
            "OUT_DIR": str(self.out),
            "LAI_CI_POLL_SECONDS": "0",
            "LAI_CI_SHORT_POLL_SECONDS": "0",
            **env,
        }
        return subprocess.run(
            ["bash", str(SCRIPT), command], env=full, capture_output=True, text=True, timeout=60
        )


@pytest.fixture
def env(tmp_path):
    return Env(tmp_path)


RUN_ENV = {
    "REPO_URL": "https://github.com/o/r.git",
    "COMMIT_SHA": SHA,
    "BASE_SHA": BASE,
    "HARNESS_SHA": HARNESS,
    "TEST_SCOPE": "affected",
    "RUN_KEY": RUN_KEY,
    "LOCK_OWNER": OWNER,
    "REQUEST_B64": base64.b64encode(b'{"commit_sha":"x"}').decode(),
}


# --------------------------------------------------------------------------- start and stop


def test_start_starts_a_stopped_instance(env):
    result = env.run("start")
    assert result.returncode == 0, result.stderr
    assert env.state()["ec2"] == "running"
    assert env.outputs()["started_by_job"] == "true"


@pytest.mark.parametrize("state", ["running", "pending", "shutting-down"])
def test_start_never_adopts_an_instance_another_job_may_own(env, state):
    env.update(ec2=state)
    result = env.run("start")
    assert result.returncode == 4
    assert "another job may own it" in result.stderr
    assert not any("start-instances" in c for c in env.calls())
    assert env.outputs()["started_by_job"] == "false"


def test_start_waits_out_a_previous_stop(env):
    env.update(ec2="stopping")
    assert env.run("start").returncode == 0
    assert env.state()["ec2"] == "running"


def test_stop_only_when_this_job_started_the_instance(env):
    env.update(ec2="running")
    result = env.run("stop", STARTED_BY_JOB="false", LOCK_STATUS="acquired")
    assert result.returncode == 0
    assert env.state()["ec2"] == "running"


def test_stop_leaves_an_instance_whose_lock_another_job_holds(env):
    env.update(ec2="running")
    result = env.run("stop", STARTED_BY_JOB="true", LOCK_STATUS="held-by-other")
    assert result.returncode == 0
    assert env.state()["ec2"] == "running"
    assert not any("stop-instances" in c for c in env.calls())


@pytest.mark.parametrize("lock", ["acquired", "unknown", ""])
def test_stop_stops_an_instance_this_job_started(env, lock):
    env.update(ec2="running")
    assert env.run("stop", STARTED_BY_JOB="true", LOCK_STATUS=lock).returncode == 0
    assert env.state()["ec2"] == "stopped"
    assert json.loads((env.out / "infra.json").read_text())["stop"] == "stopped"


def test_a_failed_stop_fails_the_step(env):
    env.update(ec2="running", stop_wait_fails=True)
    result = env.run("stop", STARTED_BY_JOB="true", LOCK_STATUS="acquired")
    assert result.returncode == 5
    assert "did not reach stopped" in result.stderr


def test_ssm_offline_is_a_transport_failure(env):
    env.update(ping="ConnectionLost")
    result = env.run("wait-ssm", LAI_CI_SSM_ONLINE_ATTEMPTS="1")
    assert result.returncode == 3


# --------------------------------------------------------------------------- lock


def test_lock_is_exclusive(env):
    first = env.run("lock", LOCK_OWNER=OWNER)
    assert first.returncode == 0 and env.outputs()["lock_status"] == "acquired"
    second = env.run("lock", LOCK_OWNER="other/repo/9-1")
    assert second.returncode == 4
    assert env.outputs()["lock_status"] == "held-by-other"
    assert OWNER in second.stderr


def test_unlock_releases_only_our_own_lock(env):
    env.update(lock_owner="other/repo/9-1")
    assert "NOT-OURS" in env.run("unlock", LOCK_OWNER=OWNER).stdout
    assert env.state()["lock_owner"] == "other/repo/9-1"
    env.update(lock_owner=OWNER)
    assert "RELEASED" in env.run("unlock", LOCK_OWNER=OWNER).stdout
    assert env.state()["lock_owner"] is None


def test_lock_owner_cannot_inject_shell(env):
    result = env.run("lock", LOCK_OWNER="x'; reboot; '")
    assert result.returncode == 2
    assert not any("send-command" in c for c in env.calls())


# --------------------------------------------------------------------------- run


def test_run_sends_the_exact_commit_and_records_the_command(env):
    result = env.run("run", **RUN_ENV)
    assert result.returncode == 0, result.stderr
    script = env.state()["run_script"]
    assert f"+{SHA}:refs/lai-ci/commit/{SHA}" in script
    assert f"--commit {SHA}" in script
    assert f"archive {HARNESS} scripts/ci" in script
    assert env.state()["sent"][0]["timeout"] == ["9600"]
    assert env.outputs()["command_id"] == "cmd-1"
    assert (env.out / "command_id").read_text().strip() == "cmd-1"


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("COMMIT_SHA", "abc123"),
        ("COMMIT_SHA", SHA.upper()),
        ("BASE_SHA", "$(reboot)"),
        ("TEST_SCOPE", "everything"),
        ("RUN_KEY", "1; rm -rf /"),
        ("REPO_URL", "https://evil.example/o/r.git"),
        ("REQUEST_B64", "a b"),
    ],
)
def test_run_rejects_invalid_input_before_contacting_the_instance(env, name, value):
    result = env.run("run", **{**RUN_ENV, name: value})
    assert result.returncode == 2
    assert not any("send-command" in c for c in env.calls())


def test_a_failed_remote_run_is_a_transport_failure(env):
    env.update(run_status="Failed", run_code=3)
    result = env.run("run", **RUN_ENV)
    assert result.returncode == 3
    assert "ended Failed" in result.stderr


# --------------------------------------------------------------------------- credentials


def oidc_env(env) -> dict:
    """A fake GitHub OIDC endpoint (curl) and the variables Actions sets for id-token: write."""
    curl = env.bin / "curl"
    log = env.state_dir / "curl.log"
    curl.write_text(f'#!/bin/sh\nprintf "%s\\n" "$*" >>"{log}"\necho \'{{"value":"oidc-jwt"}}\'\n')
    curl.chmod(0o755)
    return {
        "ACTIONS_ID_TOKEN_REQUEST_URL": "https://token.example/id?api-version=2.0",
        "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "request-token",
        "LAI_CI_ROLE_ARN": "arn:aws:iam::123456789012:role/lai-ci",
        "AWS_SESSION_TOKEN": "old",
    }


def test_expired_credentials_are_refreshed_from_a_new_oidc_token(env):
    """Run 44877024597: the one-hour session expired mid-wait and every poll failed after it."""
    env.update(expire_old_token=True)
    result = env.run("run", **RUN_ENV, **oidc_env(env))
    assert result.returncode == 0, result.stderr
    assumed = env.state()["assumed"]
    assert assumed[0]["role"] == "arn:aws:iam::123456789012:role/lai-ci"
    assert assumed[0]["token"] == "oidc-jwt"
    assert assumed[0]["signed_with"] is None  # the expired keys are not passed along
    assert "audience=sts.amazonaws.com" in (env.state_dir / "curl.log").read_text()
    assert "::add-mask::fresh" in result.stderr
    assert "ASIAFRESH" not in result.stderr and "oidc-jwt" not in result.stderr


def test_credentials_are_refreshed_before_the_session_ends(env):
    result = env.run("run", **RUN_ENV, **oidc_env(env), LAI_CI_CREDENTIAL_REFRESH_SECONDS="0")
    assert result.returncode == 0, result.stderr
    assert env.state()["assumed"]


def test_expired_credentials_without_a_refresh_fail_closed_quickly(env):
    """Without OIDC the wait must not spin as 'Pending' until RUN_MAX_SECONDS."""
    env.update(expire_old_token=True)
    result = env.run(
        "run",
        **RUN_ENV,
        AWS_SESSION_TOKEN="old",  # noqa: S106 - a fake token, never sent
        LAI_CI_RUN_MAX_SECONDS="100000",
    )
    assert result.returncode == 3
    assert "ended PollFailed" in result.stderr
    polls = [c for c in env.calls() if "get-command-invocation" in c and "Status" in c]
    assert len(polls) == 8


def test_persistent_poll_errors_are_not_read_as_still_running(env):
    env.update(poll_error="An error occurred (AccessDeniedException)")
    result = env.run("run", **RUN_ENV, LAI_CI_RUN_MAX_SECONDS="100000")
    assert result.returncode == 3
    assert "PollFailed" in result.stderr
    assert "AccessDeniedException" in result.stderr


def test_a_missing_invocation_just_after_send_is_still_waited_for(env):
    env.update(poll_error="An error occurred (InvocationDoesNotExist)")
    result = env.run("run", **RUN_ENV, LAI_CI_RUN_MAX_SECONDS="0")
    assert result.returncode == 3
    assert "ended WaitTimedOut" in result.stderr


# --------------------------------------------------------------------------- collect


def archive(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, text in files.items():
            data = text.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def stage(env, *, lite: bytes, full: bytes, corrupt: bool = False) -> None:
    base = f"/var/lib/lai-ci/runs/{RUN_KEY}"
    files, index = {}, {}
    for name, data in (("lite", lite), ("full", full)):
        encoded = base64.b64encode(data).decode()
        files[f"{base}/{name}.b64"] = encoded
        digest = hashlib.sha256(b"x" if corrupt else data).hexdigest()
        index[name] = {
            "b64_path": f"{base}/{name}.b64",
            "b64_bytes": len(encoded),
            "sha256": digest,
        }
    files[f"{base}/collect.json"] = json.dumps(index)
    env.update(files=files)


def test_collect_reassembles_chunks_and_verifies_the_checksum(env):
    noise = os.urandom(6000).hex()  # random text does not compress: several 1,000-byte chunks
    lite = archive({"results.json": '{"verdict":"pass"}', "logs/react.log": "tail"})
    full = archive({"results.json": '{"verdict":"pass"}', "junit/react.xml": noise})
    stage(env, lite=lite, full=full)
    result = env.run("collect", RUN_KEY=RUN_KEY, LAI_CI_CHUNK_BYTES="1000")
    assert result.returncode == 0, result.stderr
    assert (env.out / "results/results.json").read_text() == '{"verdict":"pass"}'
    assert (env.out / "results/junit/react.xml").exists()
    reads = [c for c in env.calls() if "send-command" in c]
    assert len(reads) > 8


def test_collect_fails_closed_on_a_checksum_mismatch(env):
    data = archive({"results.json": "{}"})
    stage(env, lite=data, full=data, corrupt=True)
    result = env.run("collect", RUN_KEY=RUN_KEY)
    assert result.returncode == 3
    assert not (env.out / "results/results.json").exists()


def test_collect_without_results_on_the_instance_fails(env):
    result = env.run("collect", RUN_KEY=RUN_KEY)
    assert result.returncode == 3


def test_oversized_full_logs_fall_back_to_the_lite_archive(env):
    lite = archive({"results.json": "{}", "logs/a.log": "tail"})
    full = archive({"results.json": "{}", "junit/a.xml": os.urandom(4000).hex()})
    stage(env, lite=lite, full=full)
    result = env.run("collect", RUN_KEY=RUN_KEY, LAI_CI_FULL_MAX_B64="100")
    assert result.returncode == 0
    assert "log tails" in result.stderr
    assert not (env.out / "results/junit").exists()


# --------------------------------------------------------------------------- cancel and lint


def test_cancel_stops_a_running_remote_command(env):
    env.out.mkdir()
    (env.out / "command_id").write_text("cmd-1\n")
    env.update(commands={"cmd-1": {"Status": "InProgress"}})
    assert env.run("cancel").returncode == 0
    assert env.state()["cancelled"] == "cmd-1"


def test_script_syntax_and_shellcheck():
    assert subprocess.run(["bash", "-n", str(SCRIPT)]).returncode == 0
    if shutil.which("shellcheck"):
        result = subprocess.run(["shellcheck", "-x", str(SCRIPT)], capture_output=True, text=True)
        assert result.returncode == 0, result.stdout
