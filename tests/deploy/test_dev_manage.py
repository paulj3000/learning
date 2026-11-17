"""scripts/aws/manage-dev.sh and show-endpoints.sh, run against fake aws/curl (dev_fakes)."""

import json
import re
import shutil

import pytest
from dev_fakes import ACCOUNT, ADMIN, API, CLOUDFRONT, SITE, SM_ARN, DevEnv

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("jq") is None, reason="needs bash and jq"
)


@pytest.fixture
def dev(tmp_path):
    return DevEnv(tmp_path)


def puts(dev):
    return {
        c[c.index("--name") + 1]: c[c.index("--value") + 1]
        for c in dev.calls("aws")
        if c[1:3] == ["ssm", "put-parameter"]
    }


# --- guards ---------------------------------------------------------------------------------------
def test_refuses_another_environment(dev):
    result = dev.run("manage-dev.sh", "status", LAI_ENV="prod")
    assert result.returncode == 4
    assert "dev environment only" in result.stderr
    assert dev.calls("aws") == []


def test_refuses_the_wrong_account(dev):
    result = dev.run("manage-dev.sh", "start", LAI_DEV_ACCOUNT_ID="999999999999")
    assert result.returncode == 4
    assert f"account {ACCOUNT}" in result.stderr
    assert "start-execution" not in " ".join(dev.aws_ops())


def test_refuses_a_platform_stack_tagged_for_another_environment(dev):
    dev.state["stacks"]["us-west-1/LaiDevPlatform-dev"]["Tags"]["Environment"] = "prod"
    result = dev.run("manage-dev.sh", "stop")
    assert result.returncode == 4
    assert "Environment=prod" in result.stderr


def test_refuses_a_prod_named_state_machine(dev):
    outputs = dev.state["stacks"]["us-west-1/LaiDevPlatform-dev"]["Outputs"]
    outputs["PowerStateMachineArn"] = SM_ARN.replace("lai-dev-power", "lai-prod-power")
    dev.state["ec2"] = "stopped"
    result = dev.run("manage-dev.sh", "start")
    assert result.returncode == 4
    assert "start-execution" not in " ".join(dev.aws_ops())


def test_not_provisioned_is_exit_8(dev):
    del dev.state["stacks"]["us-west-1/LaiDevPlatform-dev"]
    result = dev.run("manage-dev.sh", "status")
    assert result.returncode == 8


# --- power ----------------------------------------------------------------------------------------
def test_start_when_already_running_is_a_no_op(dev):
    result = dev.run("manage-dev.sh", "start")
    assert result.returncode == 0, result.stderr
    assert "already running" in result.stderr
    assert "stepfunctions start-execution" not in dev.aws_ops()


def test_stop_when_already_stopped_is_a_no_op(dev):
    dev.state.update(ec2="stopped", rds="stopped")
    dev.state["params"]["/lai/dev/power/state"]["Value"] = "stopped"
    result = dev.run("manage-dev.sh", "stop")
    assert result.returncode == 0, result.stderr
    assert "stepfunctions start-execution" not in dev.aws_ops()


def test_start_runs_the_state_machine_as_manual_and_waits(dev):
    dev.state.update(ec2="stopped", rds="stopped")
    dev.state["params"]["/lai/dev/power/state"]["Value"] = "stopped"
    result = dev.run("manage-dev.sh", "start", "--json")
    assert result.returncode == 0, result.stderr
    starts = [c for c in dev.calls("aws") if c[1:3] == ["stepfunctions", "start-execution"]]
    assert len(starts) == 1
    assert json.loads(starts[0][starts[0].index("--input") + 1]) == {
        "action": "start",
        "source": "manual",
        "force": False,
    }
    assert starts[0][starts[0].index("--state-machine-arn") + 1] == SM_ARN
    out = json.loads(result.stdout)
    assert out["operation"] == "start" and out["result"] == "succeeded"
    assert out["status"]["ec2"]["state"] == "running"


def test_source_is_github_under_actions(dev):
    dev.state.update(ec2="stopped", rds="stopped")
    result = dev.run("manage-dev.sh", "start", "--no-wait", GITHUB_ACTIONS="true")
    assert result.returncode == 0, result.stderr
    start = next(c for c in dev.calls("aws") if c[1:3] == ["stepfunctions", "start-execution"])
    assert json.loads(start[start.index("--input") + 1])["source"] == "github"


def test_conflict_when_another_execution_is_running(dev):
    dev.state["executions"].append(
        {
            "executionArn": "arn:exec:stop-1",
            "status": "RUNNING",
            "input": json.dumps({"action": "stop", "source": "schedule"}),
        }
    )
    dev.state["ec2"] = "stopping"
    result = dev.run("manage-dev.sh", "start", "--json")
    assert result.returncode == 5
    assert json.loads(result.stdout)["result"] == "conflict"
    assert "stepfunctions start-execution" not in dev.aws_ops()


def test_the_same_action_in_progress_is_joined(dev):
    dev.state["executions"].append(
        {
            "executionArn": "arn:exec:start-1",
            "status": "RUNNING",
            "input": json.dumps({"action": "start", "source": "schedule"}),
        }
    )
    dev.state["ec2"] = "pending"
    dev.save()
    result = dev.run("manage-dev.sh", "start", "--no-wait")
    assert result.returncode == 0, result.stderr
    assert "already in progress" in result.stderr
    assert "stepfunctions start-execution" not in dev.aws_ops()


def test_a_failed_execution_is_exit_1(dev):
    dev.state.update(ec2="stopped", rds="stopped", exec_outcome="FAILED")
    result = dev.run("manage-dev.sh", "start")
    assert result.returncode == 1


def test_stop_respects_a_hold_unless_forced(dev):
    dev.state["params"]["/lai/dev/power/hold-until"]["Value"] = "2099-01-01T00:00:00Z"
    result = dev.run("manage-dev.sh", "stop")
    assert result.returncode == 5
    assert "hold" in result.stderr
    result = dev.run("manage-dev.sh", "stop", "--force")
    assert result.returncode == 0, result.stderr
    start = next(c for c in dev.calls("aws") if c[1:3] == ["stepfunctions", "start-execution"])
    assert json.loads(start[start.index("--input") + 1])["force"] is True


# --- schedule parameters --------------------------------------------------------------------------
def test_pause_and_resume_write_schedule_paused(dev):
    assert dev.run("manage-dev.sh", "pause-schedule").returncode == 0
    assert puts(dev) == {"/lai/dev/power/schedule-paused": "true"}
    assert dev.run("manage-dev.sh", "resume-schedule").returncode == 0
    assert dev.state["params"]["/lai/dev/power/schedule-paused"]["Value"] == "false"


def test_hold_hours_writes_an_iso_utc_time(dev):
    result = dev.run("manage-dev.sh", "hold", "--hours", "4")
    assert result.returncode == 0, result.stderr
    value = puts(dev)["/lai/dev/power/hold-until"]
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value)


def test_hold_until_is_validated(dev):
    assert dev.run("manage-dev.sh", "hold", "--until", "tomorrow").returncode == 2
    assert dev.run("manage-dev.sh", "hold", "--until", "2001-01-01T00:00:00Z").returncode == 2
    assert dev.run("manage-dev.sh", "hold").returncode == 2
    assert puts(dev) == {}


def test_release_hold_writes_none(dev):
    dev.state["params"]["/lai/dev/power/hold-until"]["Value"] = "2099-01-01T00:00:00Z"
    assert dev.run("manage-dev.sh", "release-hold").returncode == 0
    assert dev.state["params"]["/lai/dev/power/hold-until"]["Value"] == "none"


# --- urls, status, endpoints ----------------------------------------------------------------------
def test_urls(dev):
    result = dev.run("manage-dev.sh", "urls")
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == [
        f"CloudFront: {CLOUDFRONT}",
        f"Game:       {SITE}/",
        f"API:        {API}",
        f"Admin:      {ADMIN}",
    ]


def test_show_endpoints_block(dev):
    result = dev.run("show-endpoints.sh")
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert lines[0] == "Learning Adventure Island - DEV"
    assert "\u2014" not in result.stdout  # no em dash
    labels = [line.split(":", 1)[0] for line in lines[2:]]
    assert labels == [
        "Environment",
        "Region",
        "EC2",
        "RDS",
        "Django",
        "Nightly shutdown",
        "CloudFront",
        "Game",
        "API",
        "Admin",
        "Shutdown",
        "Startup",
    ]
    body = "\n".join(lines)
    assert "Environment:      dev" in body
    assert "Region:           us-west-1" in body
    assert "EC2:              running (i-0123456789abcdef0, t4g.small)" in body
    assert "RDS:              available (lai-dev)" in body
    assert "Django:           ready" in body
    assert "Nightly shutdown: enabled" in body
    assert f"CloudFront:       {CLOUDFRONT}" in body
    assert f"Admin:            {ADMIN}" in body
    assert re.search(r"^Shutdown: +00:00 America/Los_Angeles", body, re.M)
    assert re.search(r"^Startup: +07:35 America/Los_Angeles, available by 08:00", body, re.M)


def test_show_endpoints_while_stopped_does_not_probe_django(dev):
    dev.state.update(ec2="stopped", rds="stopped")
    dev.state["params"]["/lai/dev/power/schedule-paused"]["Value"] = "true"
    result = dev.run("show-endpoints.sh")
    assert result.returncode == 0, result.stderr
    assert "Django:           stopped (EC2 stopped)" in result.stdout
    assert "Nightly shutdown: paused" in result.stdout
    assert f"API:              {API}" in result.stdout
    assert dev.calls("curl") == []


def test_status_json_has_the_fields_the_workflow_summary_reads(dev):
    result = dev.run("manage-dev.sh", "status", "--json")
    assert result.returncode == 0, result.stderr
    status = json.loads(result.stdout)["status"]
    assert status["schedule"]["shutdown"]["state"] == "ENABLED"
    assert status["schedule"]["startup"]["available_by"] == "08:00"
    assert status["readiness"] == {"status": "ready", "http_code": "200"}
    assert status["urls"]["cloudfront"] == CLOUDFRONT


# --- deploy-pending and cert-check ----------------------------------------------------------------
PENDING = {
    "git_sha": "a" * 40,
    "artifact_sha256": "b" * 64,
    "commit_epoch": 1763251200,
    "run_url": "",
    "recorded_at": "2026-11-16T00:00:00Z",
}


def test_deploy_pending_with_nothing_pending(dev):
    result = dev.run("manage-dev.sh", "deploy-pending")
    assert result.returncode == 0
    assert "nothing pending" in result.stderr
    assert "ssm send-command" not in dev.aws_ops()


def test_deploy_pending_sends_the_deploy_document(dev):
    dev.state["params"]["/lai/dev/deploy/pending"]["Value"] = json.dumps(PENDING)
    result = dev.run("manage-dev.sh", "deploy-pending")
    assert result.returncode == 0, result.stderr
    sent = dev.state["sent"][-1]
    assert sent["document"] == "lai-dev-native-deploy"
    assert sent["parameters"]["GitSha"] == ["a" * 40]
    assert sent["parameters"]["CommitEpoch"] == ["1763251200"]


def test_deploy_pending_while_stopped_is_exit_7(dev):
    dev.state["params"]["/lai/dev/deploy/pending"]["Value"] = json.dumps(PENDING)
    dev.state.update(ec2="stopped", rds="stopped")
    dev.state["params"]["/lai/dev/power/state"]["Value"] = "stopped"
    result = dev.run("manage-dev.sh", "deploy-pending")
    assert result.returncode == 7
    assert "ssm send-command" not in dev.aws_ops()


def test_cert_check_runs_the_status_document(dev):
    dev.state["invocations"]["lai-dev-native-status"] = {
        "Status": "Success",
        "ResponseCode": 0,
        "StandardOutputContent": "== certificate\nnotAfter=Feb 1 00:00:00 2027 GMT\n== disk\n",
    }
    result = dev.run("manage-dev.sh", "cert-check")
    assert result.returncode == 0, result.stderr
    assert dev.state["sent"][-1]["document"] == "lai-dev-native-status"
    assert "notAfter=Feb 1" in result.stderr


def test_db_tunnel_never_prints_a_password(dev):
    result = dev.run("manage-dev.sh", "db-tunnel")
    session = [c for c in dev.calls("aws") if c[1:3] == ["ssm", "start-session"]]
    assert session, result.stderr
    assert "AWS-StartPortForwardingSessionToRemoteHost" in session[0]
    params = json.loads(session[0][session[0].index("--parameters") + 1])
    assert params["localPortNumber"] == ["15432"]
    assert "secretsmanager get-secret-value" in result.stderr  # the command to run, not a value
    assert "secretsmanager" not in " ".join(dev.aws_ops())
