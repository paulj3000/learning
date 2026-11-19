"""scripts/aws/dev-release.sh, run for real against fake aws (dev_fakes)."""

import hashlib
import json
import shutil

import pytest
from dev_fakes import ARTIFACTS, DevEnv

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("jq") is None, reason="needs bash and jq"
)

SHA = "c" * 40
EPOCH = 1763300000


@pytest.fixture
def dev(tmp_path):
    env = DevEnv(tmp_path)
    manifest = {
        "schema": 1,
        "git_sha": SHA,
        "commit_epoch": EPOCH,
        "run_url": "",
        "built_at": "2026-11-16T00:00:00Z",
        "artifact_sha256": "d" * 64,
        "python_version": "3.12",
        "platform": "linux/arm64",
    }
    env.state["s3"][f"{ARTIFACTS}/releases/django/{SHA}.json"] = {
        "Metadata": {"artifact-sha256": "d" * 64},
        "Body": json.dumps(manifest),
    }
    return env


def stop(dev):
    dev.state.update(ec2="stopped", rds="stopped")
    dev.state["params"]["/lai/dev/power/state"]["Value"] = "stopped"


def pending(dev):
    value = dev.state["params"]["/lai/dev/deploy/pending"]["Value"]
    return None if value == "none" else json.loads(value)


def test_deploy_while_running_sends_the_native_document(dev):
    result = dev.run("dev-release.sh", "deploy", "--git-sha", SHA)
    assert result.returncode == 0, result.stderr
    sent = dev.state["sent"][-1]
    assert sent["document"] == "lai-dev-native-deploy"
    assert sent["parameters"] == {
        "GitSha": [SHA],
        "ArtifactSha256": ["d" * 64],
        "CommitEpoch": [str(EPOCH)],
        "RunUrl": [""],
        "AllowOlder": ["false"],
        "AllowDestructiveMigrations": ["false"],
    }


def test_deploy_while_stopped_records_pending_and_succeeds(dev, tmp_path):
    stop(dev)
    output = tmp_path / "gh_output"
    summary = tmp_path / "summary"
    result = dev.run(
        "dev-release.sh",
        "deploy",
        "--git-sha",
        SHA,
        GITHUB_OUTPUT=str(output),
        GITHUB_STEP_SUMMARY=str(summary),
    )
    assert result.returncode == 0, result.stderr
    assert "deployment pending" in result.stderr
    record = pending(dev)
    assert record["git_sha"] == SHA and record["artifact_sha256"] == "d" * 64
    assert record["commit_epoch"] == EPOCH
    assert "recorded_at" in record
    assert "ssm send-command" not in dev.aws_ops()
    assert "result=pending" in output.read_text()
    assert "deployment pending" in summary.read_text()


def test_deploy_while_stopped_never_replaces_a_newer_pending_release(dev):
    stop(dev)
    newer = {
        "git_sha": "e" * 40,
        "artifact_sha256": "f" * 64,
        "commit_epoch": EPOCH + 100,
        "run_url": "",
        "recorded_at": "2026-11-16T01:00:00Z",
    }
    dev.state["params"]["/lai/dev/deploy/pending"]["Value"] = json.dumps(newer)
    result = dev.run("dev-release.sh", "deploy", "--git-sha", SHA)
    assert result.returncode == 0, result.stderr
    assert "newer release" in result.stderr
    assert pending(dev) == newer


def test_deploy_while_stopped_replaces_an_older_pending_release(dev):
    stop(dev)
    older = {
        "git_sha": "e" * 40,
        "artifact_sha256": "f" * 64,
        "commit_epoch": EPOCH - 100,
        "run_url": "",
        "recorded_at": "2026-11-16T01:00:00Z",
    }
    dev.state["params"]["/lai/dev/deploy/pending"]["Value"] = json.dumps(older)
    assert dev.run("dev-release.sh", "deploy", "--git-sha", SHA).returncode == 0
    assert pending(dev)["git_sha"] == SHA


def test_start_policy_starts_the_state_machine_then_deploys(dev):
    stop(dev)
    result = dev.run("dev-release.sh", "deploy", "--git-sha", SHA, LAI_DEV_STOPPED_DEPLOY="start")
    assert result.returncode == 0, result.stderr
    ops = dev.aws_ops()
    assert "stepfunctions start-execution" in ops
    assert ops.index("stepfunctions start-execution") < ops.index("ssm send-command")
    assert pending(dev) is None


@pytest.mark.parametrize(
    ("code", "message"),
    [
        (20, "artifact download or checksum verification failed"),
        (40, "preflight failed"),
        (45, "destructive migrations refused"),
        (50, "MANUAL DATABASE REVIEW"),
        (60, "ROLLED BACK"),
        (70, "deployment lock"),
    ],
)
def test_native_exit_codes_are_explained(dev, code, message):
    dev.state["invocations"]["lai-dev-native-deploy"] = {
        "Status": "Failed",
        "ResponseCode": code,
        "StandardOutputContent": "",
    }
    result = dev.run("dev-release.sh", "deploy", "--git-sha", SHA)
    assert result.returncode == 1
    assert f"exit {code}, " in result.stderr
    assert message in result.stderr


def test_a_power_refusal_from_the_instance_is_deferred(dev):
    dev.state["invocations"]["lai-dev-native-deploy"] = {
        "Status": "Failed",
        "ResponseCode": 75,
        "StandardOutputContent": "",
    }
    result = dev.run("dev-release.sh", "deploy", "--git-sha", SHA)
    assert result.returncode == 0, result.stderr
    assert pending(dev)["git_sha"] == SHA


def test_a_transport_failure_is_exit_3(dev):
    dev.state["ping"] = "ConnectionLost"
    result = dev.run("dev-release.sh", "deploy", "--git-sha", SHA)
    assert result.returncode == 3


def test_deploy_of_an_unuploaded_release_is_exit_8(dev):
    result = dev.run("dev-release.sh", "deploy", "--git-sha", "1" * 40)
    assert result.returncode == 8


def test_success_clears_an_older_pending_record(dev):
    older = {"git_sha": "e" * 40, "artifact_sha256": "f" * 64, "commit_epoch": EPOCH - 1}
    dev.state["params"]["/lai/dev/deploy/pending"]["Value"] = json.dumps(older)
    assert dev.run("dev-release.sh", "deploy", "--git-sha", SHA).returncode == 0
    assert pending(dev) is None


def write_package(dev, sha=SHA, content=b"tarball"):
    out = dev.tmp / "pkg"
    out.mkdir(exist_ok=True)
    (out / f"{sha}.tar.gz").write_bytes(content)
    digest = hashlib.sha256(content).hexdigest()
    (out / f"{sha}.json").write_text(
        json.dumps({"schema": 1, "git_sha": sha, "commit_epoch": EPOCH, "artifact_sha256": digest})
    )
    return out, digest


def test_upload_is_immutable_and_idempotent(dev):
    sha = "2" * 40
    out, digest = write_package(dev, sha)
    assert dev.run("dev-release.sh", "upload", "--git-sha", sha, "--dir", str(out)).returncode == 0
    key = f"{ARTIFACTS}/releases/django/{sha}.tar.gz"
    assert dev.state["s3"][key]["Metadata"] == {"artifact-sha256": digest}
    puts = [c for c in dev.calls("aws") if c[1:3] == ["s3api", "put-object"]]
    assert len(puts) == 2 and all("--if-none-match" in c for c in puts)
    # The same upload again: success, nothing written.
    result = dev.run("dev-release.sh", "upload", "--git-sha", sha, "--dir", str(out))
    assert result.returncode == 0
    assert len([c for c in dev.calls("aws") if c[1:3] == ["s3api", "put-object"]]) == 2
    # A different build of the same commit: refused, unless --reuse-existing.
    write_package(dev, sha, b"another build")
    assert dev.run("dev-release.sh", "upload", "--git-sha", sha, "--dir", str(out)).returncode == 5
    assert (
        dev.run(
            "dev-release.sh", "upload", "--git-sha", sha, "--dir", str(out), "--reuse-existing"
        ).returncode
        == 0
    )


def test_lambda_deploy_updates_both_workers(dev):
    zip_path = dev.tmp / "jobs-worker-0123456789abcdef.zip"
    zip_path.write_bytes(b"zip")
    result = dev.run("dev-release.sh", "lambda-deploy", "--zip", str(zip_path))
    assert result.returncode == 0, result.stderr
    assert dev.state["lambda_updates"] == [
        {"function": "lai-dev-jobs-ai", "key": "lambda/jobs-worker-0123456789abcdef.zip"},
        {"function": "lai-dev-jobs-media", "key": "lambda/jobs-worker-0123456789abcdef.zip"},
    ]
    assert f"{ARTIFACTS}/lambda/jobs-worker-0123456789abcdef.zip" in dev.state["s3"]


def test_lambda_deploy_reports_a_failed_update(dev):
    dev.state["lambda_status"] = "Failed"
    zip_path = dev.tmp / "jobs-worker-0123456789abcdef.zip"
    zip_path.write_bytes(b"zip")
    assert dev.run("dev-release.sh", "lambda-deploy", "--zip", str(zip_path)).returncode == 1


def test_bad_arguments_are_usage_errors(dev):
    assert dev.run("dev-release.sh", "deploy", "--git-sha", "abc").returncode == 2
    assert dev.run("dev-release.sh", "deploy").returncode == 2
    assert dev.run("dev-release.sh", "nonsense").returncode == 2
    assert dev.calls("aws") == []


def test_lambda_deploy_skips_when_processing_is_disabled(dev):
    outputs = dev.state["stacks"]["us-west-1/LaiDevPlatform-dev"]["Outputs"]
    outputs["AiWorkerFunctionName"] = outputs["MediaWorkerFunctionName"] = "none"
    result = dev.run("dev-release.sh", "lambda-deploy")
    assert result.returncode == 0, result.stderr
    assert "lambda update-function-code" not in dev.aws_ops()
