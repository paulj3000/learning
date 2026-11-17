"""scripts/aws/install-debug.sh, run for real against fake aws/gh/curl (dev_fakes)."""

import shutil

import pytest
from dev_fakes import CLOUDFRONT, SITE, DevEnv

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("jq") is None, reason="needs bash and jq"
)

SECRET = "/lai/dev/django/DJANGO_SECRET_KEY"
ADMIN_PARAM = "/lai/dev/bootstrap/DJANGO_ADMIN_PASSWORD"
SKIP = ("--skip-release", "--skip-bootstrap", "--skip-lambda", "--skip-frontend")


@pytest.fixture
def dev(tmp_path):
    env = DevEnv(tmp_path)
    env.state["http"].update(
        {
            f"{CLOUDFRONT}/": 200,
            f"{SITE}/home": 200,
            "https://lai-web-dev-x.s3.us-east-1.amazonaws.com/index.html": 403,
            "https://lai-assets-dev-x.s3.us-west-1.amazonaws.com/index.html": 403,
            "https://lai-child-photos-dev-x.s3.us-west-1.amazonaws.com/index.html": 403,
        }
    )
    return env


def secret_puts(dev):
    return [c for c in dev.calls("aws") if c[1:3] == ["ssm", "put-parameter"]]


def test_dry_run_changes_nothing(dev):
    result = dev.run("install-debug.sh", "--dry-run")
    assert result.returncode == 0
    assert "nothing was changed" in result.stdout
    assert dev.calls() == []


def test_creates_the_secret_key_once_and_never_prints_it(dev):
    result = dev.run("install-debug.sh", "--skip-github", *SKIP)
    assert result.returncode == 0, result.stderr
    secret = dev.state["params"][SECRET]
    assert secret["Type"] == "SecureString"
    assert len(secret["Value"]) >= 50
    assert secret["Value"] not in result.stdout + result.stderr
    assert dev.state["params"]["/lai/dev/django/WEB_CONCURRENCY"]["Value"] == "3"
    # The value never appears on a command line.
    assert not any(secret["Value"] in " ".join(c) for c in dev.calls())


def test_never_overwrites_an_existing_secret(dev):
    dev.state["params"][SECRET] = {"Value": "the-existing-secret", "Type": "SecureString"}
    dev.state["params"]["/lai/dev/django/WEB_CONCURRENCY"] = {"Value": "2", "Type": "String"}
    result = dev.run("install-debug.sh", "--skip-github", *SKIP)
    assert result.returncode == 0, result.stderr
    assert dev.state["params"][SECRET]["Value"] == "the-existing-secret"
    assert dev.state["params"]["/lai/dev/django/WEB_CONCURRENCY"]["Value"] == "2"
    assert secret_puts(dev) == []
    assert "left unchanged" in result.stderr


def test_admin_password_parameter_is_deleted_even_when_create_admin_fails(dev):
    dev.state["invocations"]["lai-dev-native-bootstrap"] = {
        "Status": "Failed",
        "ResponseCode": 30,
        "StandardOutputContent": "create-admin failed",
    }
    result = dev.run(
        "install-debug.sh",
        "--skip-github",
        "--create-admin",
        "owner",
        *SKIP,
        stdin="a-long-test-password\na-long-test-password\n",
    )
    assert result.returncode != 0
    bootstrap = [s for s in dev.state["sent"] if s["document"] == "lai-dev-native-bootstrap"]
    assert {"Task": ["create-admin"], "Argument": ["owner"]} in [s["parameters"] for s in bootstrap]
    deletes = [c for c in dev.calls("aws") if c[1:3] == ["ssm", "delete-parameter"]]
    assert any(ADMIN_PARAM in c for c in deletes)
    assert ADMIN_PARAM not in dev.state["params"]
    assert "a-long-test-password" not in result.stdout + result.stderr
    assert not any("a-long-test-password" in " ".join(c) for c in dev.calls())


def test_admin_passwords_must_match(dev):
    result = dev.run(
        "install-debug.sh",
        "--skip-github",
        "--create-admin",
        "owner",
        *SKIP,
        stdin="a-long-test-password\nsomething-else-entirely\n",
    )
    assert result.returncode == 2
    assert ADMIN_PARAM not in dev.state["params"]


def test_bootstrap_tasks_and_publish_only_when_asked(dev):
    result = dev.run(
        "install-debug.sh", "--skip-github", "--skip-release", "--skip-lambda", "--skip-frontend"
    )
    assert result.returncode == 0, result.stderr
    tasks = [
        s["parameters"]["Task"][0]
        for s in dev.state["sent"]
        if s["document"] == "lai-dev-native-bootstrap"
    ]
    assert tasks == ["check", "ensure-roles", "load-content", "seed-content", "import-assets"]


def test_stopped_environment_needs_start(dev):
    dev.state.update(ec2="stopped", rds="stopped")
    dev.state["params"]["/lai/dev/power/state"]["Value"] = "stopped"
    result = dev.run("install-debug.sh", "--skip-github", *SKIP)
    assert result.returncode == 7
    assert "stepfunctions start-execution" not in dev.aws_ops()
    result = dev.run("install-debug.sh", "--skip-github", "--start", *SKIP)
    assert result.returncode == 0, result.stderr
    assert "stepfunctions start-execution" in dev.aws_ops()


def test_github_environments_and_variables(dev):
    result = dev.run("install-debug.sh", *SKIP)
    assert result.returncode == 0, result.stderr
    gh = dev.calls("gh")
    environments = [c[4].rsplit("/", 1)[1] for c in gh if c[1:4] == ["api", "-X", "PUT"]]
    assert environments == ["dev-backend", "dev-infrastructure", "site-dev"]
    sets = {
        (c[3], c[c.index("--env") + 1] if "--env" in c else "repo"): c[c.index("--body") + 1]
        for c in gh
        if c[1:3] == ["variable", "set"]
    }
    assert sets[("LAI_DEV_NATIVE_ENABLED", "repo")] == "true"
    assert sets[("LAI_AWS_REGION", "repo")] == "us-west-1"
    assert sets[("LAI_DEV_STOPPED_DEPLOY", "repo")] == "defer"
    assert sets[("LAI_DEV_BACKEND_ROLE_ARN", "dev-backend")].endswith("role/lai-dev-backend")
    assert sets[("LAI_DEV_ARTIFACT_BUCKET", "dev-backend")].startswith("lai-dev-artifacts-")
    assert sets[("LAI_API_BASE_URL", "dev-backend")] == "https://api.example.test"
    assert sets[("LAI_DEV_INFRA_ROLE_ARN", "dev-infrastructure")].endswith("role/lai-dev-infra")
    for name in (
        "LAI_SITE_DEPLOY_ROLE_ARN",
        "LAI_COGNITO_USER_POOL_ID",
        "LAI_COGNITO_CLIENT_ID",
        "LAI_SITE_BUCKET",
        "LAI_SITE_DISTRIBUTION_ID",
        "LAI_SITE_URL",
    ):
        assert (name, "site-dev") in sets, name
    assert not any(c[3] == "LAI_SITE_DEPLOY_ENABLED" for c in gh if c[1:3] == ["variable", "set"])


def test_an_existing_stopped_deploy_policy_is_kept(dev):
    dev.state["gh_variables"] = ["LAI_DEV_STOPPED_DEPLOY"]
    assert dev.run("install-debug.sh", *SKIP).returncode == 0
    assert not any(c[1:4] == ["variable", "set", "LAI_DEV_STOPPED_DEPLOY"] for c in dev.calls("gh"))


def test_a_public_bucket_fails_acceptance(dev):
    dev.state["http"]["https://lai-child-photos-dev-x.s3.us-west-1.amazonaws.com/index.html"] = 200
    result = dev.run("install-debug.sh", "--skip-github", *SKIP)
    assert result.returncode == 1
    assert "lai-child-photos-dev-x" in result.stderr


def test_ai_and_speech_settings_are_opt_in_and_never_overwritten(dev):
    from dev_fakes import stack

    result = dev.run("install-debug.sh", "--skip-github", *SKIP)
    assert result.returncode == 0, result.stderr
    assert "/lai/dev/django/LAI_AI_PROVIDER" not in dev.state["params"]
    assert "/lai/dev/django/LAI_SPEECH_PROVIDER" not in dev.state["params"]

    dev.state["stacks"]["us-west-1/LaiAiGuardrail-dev"] = stack(
        {"ModelId": "us.model-x", "GuardrailId": "gr123", "GuardrailVersion": "1"}
    )
    dev.state["params"]["/lai/dev/django/LAI_AI_GUARDRAIL_VERSION"] = {
        "Value": "2",
        "Type": "String",
    }
    result = dev.run("install-debug.sh", "--skip-github", "--enable-ai", "--enable-speech", *SKIP)
    assert result.returncode == 0, result.stderr
    params = {k: v["Value"] for k, v in dev.state["params"].items()}
    assert params["/lai/dev/django/LAI_AI_PROVIDER"] == "bedrock"
    assert params["/lai/dev/django/LAI_AI_BEDROCK_REGION"] == "us-west-1"
    assert params["/lai/dev/django/LAI_AI_GUARDRAIL_ID"] == "gr123"
    assert params["/lai/dev/django/LAI_AI_GUARDRAIL_VERSION"] == "2"  # existing value kept
    assert params["/lai/dev/django/LAI_STUDIO_APPROVED_MODEL_IDS"] == "us.model-x"
    assert params["/lai/dev/django/LAI_SPEECH_PROVIDER"] == "polly"
    assert params["/lai/dev/django/LAI_SPEECH_AWS_REGION"] == "us-west-1"
