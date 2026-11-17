"""scripts/aws/deploy-debug.sh, run for real against fake aws/npm (dev_fakes); no AWS."""

import json
import shutil

import pytest
from dev_fakes import ACCOUNT, ARTIFACTS, DevEnv, stack

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("jq") is None, reason="needs bash and jq"
)

PLATFORM_KEYS = [
    "Environment",
    "AmiId",
    "InstanceType",
    "EC2VolumeSize",
    "DatabaseInstanceClass",
    "DatabaseStorageSize",
    "DatabaseBackupRetention",
    "DatabaseDeletionProtection",
    "EnableLambdaProcessing",
    "WorkerCodeKey",
    "LambdaMemorySize",
    "LambdaConcurrencyLimit",
    "EnableScheduledShutdown",
    "ShutdownHour",
    "ShutdownMinute",
    "StartupHour",
    "StartupMinute",
    "StartupWarmupMinutes",
    "ScheduleTimezone",
    "SiteDomainName",
    "ApiDomainName",
    "AdminDomainName",
    "CognitoUserPoolId",
    "CognitoClientId",
    "HostedZoneId",
    "HostedZoneName",
    "CertificateEmail",
    "CloudFrontOriginPrefixListId",
    "AdminAllowedCidr",
    "OpenHttpPort",
    "CreateGithubOidcProvider",
    "GitHubRepository",
    "AlarmEmail",
    "MonthlyBudgetUsd",
    "SwapSizeMb",
]
STACKS = [
    "LaiDevArtifacts-dev",
    "LaiAssetStorage-dev",
    "LaiChildPhotos-dev",
    "LaiProcessing-dev",
    "LaiDevPlatform-dev",
    "LaiProcessingImages-dev",
    "LaiAiGuardrail-dev",
    "LaiFrontend-dev",
]


def template(keys, padding=0):
    return {
        "Description": "x" * padding,
        "Parameters": {k: {"Type": "String", "Default": ""} for k in keys},
        "Resources": {},
    }


@pytest.fixture
def dev(tmp_path):
    env = DevEnv(tmp_path)
    env.state["templates"] = {
        "LaiDevArtifacts-dev": template(["ReleaseRetentionDays"]),
        "LaiDevPlatform-dev": template(PLATFORM_KEYS),
        "LaiFrontend-dev": template(["SiteDomainName", "ApiDomainName"]),
    }
    env.script(
        "package-lambda.sh",
        'mkdir -p "$2"; printf zip >"$2/jobs-worker-0123456789abcdef.zip"\n'
        'echo "$2/jobs-worker-0123456789abcdef.zip"\n',
    )
    env.cdk_out = str(tmp_path / "cdk.out")
    return env


def run(dev, *args, **env):
    return dev.run("deploy-debug.sh", *args, LAI_CDK_OUT=dev.cdk_out, **env)


def change_sets(dev):
    return dev.state["changesets"]


def created(dev):
    return [c for c in dev.calls("aws") if c[1:3] == ["cloudformation", "create-change-set"]]


def test_plan_creates_change_sets_and_never_executes(dev):
    result = run(dev, "--plan")
    assert result.returncode == 0, result.stderr
    assert "cloudformation execute-change-set" not in dev.aws_ops()
    stacks = sorted(k.split("/")[1] for k in change_sets(dev))
    assert stacks == sorted(STACKS)
    assert all(not cs["executed"] for cs in change_sets(dev).values())
    assert "us-east-1/LaiFrontend-dev" in "".join(change_sets(dev))
    for call in created(dev):
        assert "CAPABILITY_NAMED_IAM" in call
        tags = json.loads(call[call.index("--tags") + 1])
        assert {"Key": "Environment", "Value": "dev"} in tags
    assert "Nothing was applied" in result.stderr
    # The plan synthesized for dev in this account.
    npm = dev.calls("npm")
    assert npm and "infra:synth" in npm[0]


def test_plan_parameters(dev):
    assert run(dev, "--plan").returncode == 0
    platform = next(v for k, v in change_sets(dev).items() if "/LaiDevPlatform-dev/" in k)
    params = {p["ParameterKey"]: p["ParameterValue"] for p in platform["parameters"]}
    assert platform["type"] == "UPDATE"
    assert params["Environment"] == "dev"
    assert params["AmiId"] == "ami-0123456789abcdef0"  # pinned: the deployed AMI is reused
    # Unpadded hour and minute fields (cron(35 7 * * ? *)), from the deployed values.
    assert (params["StartupHour"], params["StartupMinute"]) == ("7", "35")
    assert (params["ShutdownHour"], params["ShutdownMinute"]) == ("0", "0")
    assert "StartupTime" not in params and "ShutdownTime" not in params
    assert params["OpenHttpPort"] == "true"  # no Route 53 zone
    assert params["CloudFrontOriginPrefixListId"] == "pl-82a045eb"
    assert params["WorkerCodeKey"] == "lambda/jobs-worker-0123456789abcdef.zip"
    assert params["SiteDomainName"] == "lai.pauldimitriu.com"
    assert params["ApiDomainName"] == "api.pauldimitriu.com"
    assert params["AdminDomainName"] == "ladm.pauldimitriu.com"
    assert params["CreateGithubOidcProvider"] == "true"  # what the stack was created with
    assert "SwapSizeMb" not in params  # not ours to set: the template default applies


def test_refresh_ami_and_settings_override_the_deployed_values(dev):
    result = run(
        dev,
        "--plan",
        "--refresh-ami",
        LAI_AVAILABLE_BY="09:00",
        LAI_STARTUP_WARMUP_MINUTES="30",
        LAI_INSTANCE_TYPE="t4g.medium",
        LAI_SHUTDOWN_TIME="23:05",
    )
    assert result.returncode == 0, result.stderr
    platform = next(v for k, v in change_sets(dev).items() if "/LaiDevPlatform-dev/" in k)
    params = {p["ParameterKey"]: p["ParameterValue"] for p in platform["parameters"]}
    assert params["AmiId"] == "ami-0fedcba9876543210"
    assert (params["StartupHour"], params["StartupMinute"]) == ("8", "30")
    assert (params["ShutdownHour"], params["ShutdownMinute"]) == ("23", "5")
    assert params["InstanceType"] == "t4g.medium"


def test_an_x86_instance_type_is_refused(dev):
    assert run(dev, "--plan", LAI_INSTANCE_TYPE="t3.small").returncode == 2
    assert created(dev) == []


def test_execute_requires_the_dev_account_id(dev):
    result = run(dev, "--execute")
    assert result.returncode == 4
    assert "LAI_DEV_ACCOUNT_ID" in result.stderr
    assert created(dev) == []
    result = run(dev, "--execute", LAI_DEV_ACCOUNT_ID="999999999999")
    assert result.returncode == 4
    assert created(dev) == []


def test_execute_applies_the_stacks_in_order(dev):
    result = run(dev, "--execute", LAI_DEV_ACCOUNT_ID=ACCOUNT)
    assert result.returncode == 0, result.stderr
    executed = [
        c[c.index("--stack-name") + 1]
        for c in dev.calls("aws")
        if c[1:3] == ["cloudformation", "execute-change-set"]
    ]
    assert executed == STACKS
    frontend = next(
        c
        for c in dev.calls("aws")
        if c[1:3] == ["cloudformation", "execute-change-set"] and "LaiFrontend-dev" in c
    )
    assert frontend[frontend.index("--region") + 1] == "us-east-1"
    assert f"{ARTIFACTS}/lambda/jobs-worker-0123456789abcdef.zip" in dev.state["s3"]
    assert "install-debug.sh" in result.stderr


def test_a_legacy_dev_stack_is_refused_and_never_touched(dev):
    dev.state["stacks"]["us-west-1/LaiDjangoEc2-dev"] = {
        "StackStatus": "CREATE_COMPLETE",
        "Tags": {"Environment": "dev"},
    }
    result = run(dev, "--plan")
    assert result.returncode == 5
    assert "LaiDjangoEc2-dev" in result.stderr
    assert created(dev) == []
    assert not any("LaiDjangoEc2-dev" in c and c[2] != "describe-stacks" for c in dev.calls("aws"))
    result = run(dev, "--plan", LAI_ALLOW_LEGACY_DEV_STACK="true")
    assert result.returncode == 0, result.stderr
    assert not any("LaiDjangoEc2-dev" in c and c[2] != "describe-stacks" for c in dev.calls("aws"))


def test_first_plan_defers_the_large_platform_template(dev):
    for name in ("LaiDevArtifacts-dev", "LaiDevPlatform-dev", "LaiFrontend-dev"):
        del dev.state["stacks"][
            f"{'us-east-1' if name == 'LaiFrontend-dev' else 'us-west-1'}/{name}"
        ]
    dev.state["templates"]["LaiDevPlatform-dev"] = template(PLATFORM_KEYS, padding=60000)
    result = run(
        dev,
        "--plan",
        LAI_COGNITO_USER_POOL_ID="us-west-1_AbCdEf123",
        LAI_COGNITO_CLIENT_IDS="abc123client",
    )
    assert result.returncode == 0, result.stderr
    stacks = {k.split("/")[1]: v for k, v in change_sets(dev).items()}
    assert "LaiDevPlatform-dev" not in stacks
    assert stacks["LaiDevArtifacts-dev"]["type"] == "CREATE"
    assert "deferred" in result.stderr
    assert "--execute --only LaiDevArtifacts-dev" in result.stderr


def test_a_fresh_account_needs_the_cognito_ids(dev):
    del dev.state["stacks"]["us-west-1/LaiDevPlatform-dev"]
    result = run(dev, "--plan")
    assert result.returncode == 8
    assert "LAI_COGNITO_USER_POOL_ID" in result.stderr


def test_an_existing_github_oidc_provider_is_detected(dev):
    del dev.state["stacks"]["us-west-1/LaiDevPlatform-dev"]
    dev.state["oidc_providers"] = [
        f"arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
    ]
    result = run(
        dev,
        "--plan",
        LAI_COGNITO_USER_POOL_ID="us-west-1_AbCdEf123",
        LAI_COGNITO_CLIENT_IDS="abc123client",
    )
    assert result.returncode == 0, result.stderr
    platform = next(v for k, v in change_sets(dev).items() if "/LaiDevPlatform-dev/" in k)
    params = {p["ParameterKey"]: p["ParameterValue"] for p in platform["parameters"]}
    assert params["CreateGithubOidcProvider"] == "false"
    assert platform["type"] == "CREATE"


def test_status_is_read_only(dev):
    result = run(dev, "--status")
    assert result.returncode == 0, result.stderr
    assert "LaiDevPlatform-dev" in result.stdout
    for op in dev.aws_ops():
        assert op.split()[1].startswith(("describe", "get", "list")), op


def test_execute_refuses_to_update_the_platform_while_stopped(dev):
    dev.state.update(ec2="stopped", rds="stopped")
    result = run(dev, "--execute", LAI_DEV_ACCOUNT_ID=ACCOUNT)
    assert result.returncode == 7
    assert "manage-dev.sh start" in result.stderr
    assert created(dev) == []


DIGEST = "sha256:" + "ab" * 32


def test_the_processing_worker_digest_is_kept_given_or_refused(dev):
    # Phase 1: nothing deployed and nothing given, so the synth has no worker.
    assert run(dev, "--plan").returncode == 0
    assert dev.state["synth_digest"] == ""
    # A deployed worker keeps its digest when the setting is unset.
    dev.state["stacks"]["us-west-1/LaiProcessing-dev"] = stack({"WorkerImageDigest": DIGEST})
    assert run(dev, "--plan").returncode == 0
    assert dev.state["synth_digest"] == DIGEST
    other = "sha256:" + "cd" * 32
    assert run(dev, "--plan", LAI_PROCESSING_WORKER_IMAGE_DIGEST=other).returncode == 0
    assert dev.state["synth_digest"] == other
    assert run(dev, "--plan", LAI_PROCESSING_WORKER_IMAGE_DIGEST="none").returncode == 0
    assert dev.state["synth_digest"] == ""
    result = run(dev, "--plan", LAI_PROCESSING_WORKER_IMAGE_DIGEST="latest")
    assert result.returncode == 2
    assert "sha256" in result.stderr
