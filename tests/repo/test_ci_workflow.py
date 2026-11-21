"""Guards on .github/workflows/aws-integration-tests.yml: OIDC only, exact-SHA inputs, cleanup on
every outcome, no deferred checks, and the smoke test left alone."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
WORKFLOW = REPO / ".github/workflows/aws-integration-tests.yml"
SMOKE = REPO / ".github/workflows/aws-ec2-smoke-test.yml"
TEXT = WORKFLOW.read_text()


# --------------------------------------------------------------------------- text-level (always)


def test_no_stored_credentials_or_secrets():
    assert "secrets." not in TEXT
    assert not re.search(r"AKIA[0-9A-Z]{16}", TEXT)
    assert "aws_access_key_id" not in TEXT.lower()
    assert "role-to-assume: ${{ vars.LAI_CI_ROLE_ARN }}" in TEXT


def test_inputs_never_reach_a_shell_script_directly():
    """Inputs reach scripts only through validated env: values (run: interpolation injects)."""
    for block in re.findall(r"run: \|\n((?:\s{10,}.*\n)+)", TEXT):
        assert "${{" not in block, block


def test_no_deferred_merge_readiness_checks():
    """No step runs Playwright, end-to-end, lint, format or build (the planner's suites are checked
    in test_ci_plan_tests.py and test_ci_remote_runner.py)."""
    code = "\n".join(re.findall(r"run: (?:\|\n)?((?:\s{10,}.*\n)+|.*\n)", TEXT)).lower()
    assert "ec2_ci.sh" in code
    for banned in (
        "playwright",
        "test:e2e",
        "test:acceptance",
        "ruff",
        "prettier",
        "oxlint",
        "npm run build",
        "npm run lint",
    ):
        assert banned not in code, banned


def test_the_smoke_test_is_left_alone():
    assert SMOKE.is_file()
    smoke = SMOKE.read_text()
    assert "group: lai-ec2-smoke-test" in smoke
    assert "Never stop an instance that was already running" in smoke


def test_only_github_hosted_runners():
    assert "self-hosted" not in TEXT
    assert "runs-on: ubuntu-24.04" in TEXT


def test_the_ssm_command_does_not_open_ssh_or_postgres():
    script = (REPO / "scripts/ci/ec2_ci.sh").read_text() + (
        REPO / "scripts/ci/remote_runner.py"
    ).read_text()
    for banned in ("authorize-security-group-ingress", "listen_addresses", "0.0.0.0/0", "ssh "):
        assert banned not in script


# --------------------------------------------------------------------------- structure (PyYAML)


@pytest.fixture(scope="module")
def workflow():
    yaml = pytest.importorskip("yaml")
    data = yaml.safe_load(TEXT)
    data["on"] = data.pop(True, data.get("on"))  # PyYAML reads `on` as True
    return data


@pytest.fixture(scope="module")
def job(workflow):
    return workflow["jobs"]["unit-tests"]


def steps(job):
    return {step["name"]: step for step in job["steps"]}


def test_dispatch_inputs(workflow):
    inputs = workflow["on"]["workflow_dispatch"]["inputs"]
    assert set(inputs) == {"commit_sha", "test_scope", "request_id"}
    assert inputs["commit_sha"]["required"] is True
    assert inputs["test_scope"]["options"] == ["affected", "full-unit"]
    assert inputs["request_id"]["required"] is False
    assert set(workflow["on"]) == {"workflow_dispatch"}


def test_least_privilege_oidc(workflow, job):
    assert workflow["permissions"] == {"id-token": "write", "contents": "read"}
    assert job["environment"] == "lai-ci"
    auth = next(s for s in job["steps"] if s.get("id") == "aws-auth")
    assert auth["uses"].startswith("aws-actions/configure-aws-credentials@v")


def test_one_run_at_a_time_without_cancelling_a_running_one(workflow):
    assert workflow["concurrency"] == {"group": "lai-ci-ec2-instance", "cancel-in-progress": False}


def test_job_timeout_stays_below_the_four_hour_guard(job):
    assert job["timeout-minutes"] < 240
    run = next(s for s in job["steps"] if s.get("id") == "run")
    assert run["timeout-minutes"] < job["timeout-minutes"] - 30  # leaves time for cleanup


def test_the_commit_is_validated_against_its_branch(job):
    validate = steps(job)["Validate the request"]["run"]
    assert "merge-base --is-ancestor" in validate
    assert "^[0-9a-f]{40}$" in validate
    assert "integration/" in validate


@pytest.mark.parametrize(
    "name",
    [
        "Copy the results back (checksum-verified)",
        "Cancel the remote command if it is still running",
        "Release the instance lock",
        "Stop EC2 if this job started it and no other job owns it",
        "Check the results against the request (fail closed)",
        "Upload the results artifact",
        "Enforce the verdict (merge gate)",
    ],
)
def test_cleanup_and_reporting_run_on_every_outcome(job, name):
    assert steps(job)[name]["if"].startswith("always()")


def test_stop_only_an_instance_this_job_started(job):
    stop = steps(job)["Stop EC2 if this job started it and no other job owns it"]
    assert "steps.start.outputs.started_by_job == 'true'" in stop["if"]
    assert stop["env"]["LOCK_STATUS"] == "${{ steps.lock.outputs.lock_status }}"


def test_the_verdict_is_the_last_step_and_requires_pass(job):
    last = job["steps"][-1]
    assert last["name"] == "Enforce the verdict (merge gate)"
    assert "= pass ]" in last["run"]
    names = [s["name"] for s in job["steps"]]
    assert names.index("Stop EC2 if this job started it and no other job owns it") < names.index(
        "Enforce the verdict (merge gate)"
    )


def test_actionlint_when_installed():
    if shutil.which("actionlint") is None:
        pytest.skip("actionlint is not installed")
    result = subprocess.run(["actionlint", str(WORKFLOW)], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout


def test_cleanup_gets_fresh_credentials_after_a_long_run(job):
    """Run 44877024597: the one-hour OIDC session expired before collect, unlock and stop."""
    names = [s["name"] for s in job["steps"]]
    reauth = steps(job)["Refresh AWS credentials for cleanup (OIDC)"]
    assert reauth["if"] == "always() && steps.aws-auth.outcome == 'success'"
    assert reauth["uses"] == next(s for s in job["steps"] if s.get("id") == "aws-auth")["uses"]
    assert reauth["with"]["role-to-assume"] == "${{ vars.LAI_CI_ROLE_ARN }}"
    run_at = names.index("Run the unit tests on EC2 over SSM")
    assert names.index(reauth["name"]) == run_at + 1
    run = next(s for s in job["steps"] if s.get("id") == "run")
    assert run["env"]["LAI_CI_ROLE_ARN"] == "${{ vars.LAI_CI_ROLE_ARN }}"
