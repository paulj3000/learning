"""Guards on the native DEV GitHub workflows, the dev gates in deploy-django-ec2.yml and
deploy-site.yml, and lint of the DEV scripts (shellcheck, bash -n, actionlint when installed)."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

# A hard import, not importorskip: PyYAML is pinned in requirements-dev.txt, so a missing module
# is a broken environment and must fail, never silently skip these guards (GE-090).
import yaml

REPO = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO / ".github/workflows"
DEV_SCRIPTS = [
    "lib-dev.sh",
    "manage-dev.sh",
    "show-endpoints.sh",
    "dev-release.sh",
    "deploy-debug.sh",
    "install-debug.sh",
]


def load(name: str) -> dict:
    data = yaml.safe_load((WORKFLOWS / name).read_text())
    data["on"] = data.pop(True, data.get("on"))  # PyYAML reads the `on` key as True
    return data


NATIVE = load("deploy-dev-native.yml")
LAMBDA = load("deploy-dev-lambda.yml")
MANAGE = load("manage-dev-infrastructure.yml")
DJANGO = load("deploy-django-ec2.yml")
SITE = load("deploy-site.yml")


def oidc_jobs(workflow: dict) -> dict:
    return {
        name: job
        for name, job in workflow["jobs"].items()
        if job.get("permissions", {}).get("id-token") == "write"
    }


def role_vars(job: dict) -> set[str]:
    return {
        step["with"]["role-to-assume"]
        for step in job.get("steps", [])
        if str(step.get("uses", "")).startswith("aws-actions/configure-aws-credentials")
    }


def test_names():
    assert NATIVE["name"] == "Deploy DEV backend (native)"
    assert LAMBDA["name"] == "Deploy DEV Lambda workers"
    assert MANAGE["name"] == "Manage DEV Infrastructure"


def test_no_secrets_and_minimal_default_permissions():
    for workflow in (NATIVE, LAMBDA, MANAGE):
        assert workflow["permissions"] == {"contents": "read"}
    for name in ("deploy-dev-native.yml", "deploy-dev-lambda.yml", "manage-dev-infrastructure.yml"):
        assert "${{ secrets." not in (WORKFLOWS / name).read_text()


def test_native_inputs_and_gating():
    inputs = NATIVE["on"]["workflow_dispatch"]["inputs"]
    assert inputs["action"]["options"] == ["deploy", "rollback", "deploy-pending"]
    assert inputs["start_if_stopped"]["type"] == "boolean"
    assert NATIVE["on"]["push"]["branches"] == ["main"]
    jobs = NATIVE["jobs"]
    for name in ("test", "start", "deploy-pending", "rollback"):
        assert "vars.LAI_DEV_NATIVE_ENABLED == 'true'" in jobs[name]["if"], name
    assert jobs["package"]["needs"] == "test"
    assert set(jobs["deploy"]["needs"]) == {"package", "start"}
    assert jobs["package"]["runs-on"] == "ubuntu-latest"
    assert "aarch64|none-any" in str(jobs["package"]["steps"])


def test_native_environments_roles_and_concurrency():
    jobs = oidc_jobs(NATIVE)
    assert set(jobs) == {"start", "deploy", "deploy-pending", "rollback"}
    assert jobs["start"]["environment"]["name"] == "dev-infrastructure"
    assert role_vars(jobs["start"]) == {"${{ vars.LAI_DEV_INFRA_ROLE_ARN }}"}
    for name in ("deploy", "deploy-pending", "rollback"):
        assert jobs[name]["environment"]["name"] == "dev-backend"
        assert role_vars(jobs[name]) == {"${{ vars.LAI_DEV_BACKEND_ROLE_ARN }}"}
        assert jobs[name]["concurrency"] == {
            "group": "deploy-dev-native",
            "cancel-in-progress": False,
        }
    # Jobs without OIDC never get a token.
    for name in ("test", "package"):
        assert "permissions" not in NATIVE["jobs"][name]


def test_native_test_job_matches_the_django_workflow():
    native = [s.get("run") for s in NATIVE["jobs"]["test"]["steps"]]
    django = [s.get("run") for s in DJANGO["jobs"]["test"]["steps"]]
    assert native == django


def test_lambda_workflow():
    paths = LAMBDA["on"]["push"]["paths"]
    for path in (
        "lambda/**",
        "lai/apps/ai/providers/**",
        "lai/apps/jobs/core/**",
        "processing/lai_processing/**",
        "scripts/aws/package-lambda.sh",
    ):
        assert path in paths
    assert "vars.LAI_DEV_NATIVE_ENABLED == 'true'" in LAMBDA["jobs"]["test"]["if"]
    deploy = LAMBDA["jobs"]["deploy"]
    assert deploy["needs"] == "test"
    assert deploy["environment"]["name"] == "dev-backend"
    assert role_vars(deploy) == {"${{ vars.LAI_DEV_BACKEND_ROLE_ARN }}"}
    assert "lambda-deploy" in str(deploy["steps"])
    assert "tests/lambda" in str(LAMBDA["jobs"]["test"]["steps"])


def test_manage_workflow():
    inputs = MANAGE["on"]["workflow_dispatch"]["inputs"]
    assert set(MANAGE["on"]) == {"workflow_dispatch"}
    assert inputs["operation"]["type"] == "choice"
    assert inputs["operation"]["options"] == [
        "start",
        "stop",
        "restart",
        "status",
        "pause-schedule",
        "resume-schedule",
        "hold",
        "release-hold",
        "urls",
        "deploy-pending",
        "start-and-deploy",
    ]
    assert inputs["hold_hours"]["default"] == 4
    assert MANAGE["concurrency"] == {
        "group": "manage-dev-infrastructure",
        "cancel-in-progress": False,
    }
    job = MANAGE["jobs"]["manage"]
    assert job["environment"]["name"] == "dev-infrastructure"
    assert role_vars(job) == {"${{ vars.LAI_DEV_INFRA_ROLE_ARN }}"}
    steps = str(job["steps"])
    assert "manage-dev.sh" in steps and "--json" in steps
    for column in ("EC2", "RDS", "Scheduler", "Readiness", "CloudFront", "Game", "API", "Admin"):
        assert f"| {column} |" in steps, column


def test_django_workflow_skips_docker_dev_when_native_is_on():
    jobs = DJANGO["jobs"]
    assert "vars.LAI_DEV_NATIVE_ENABLED != 'true'" in jobs["deploy-dev"]["if"]
    assert "vars.LAI_DEV_NATIVE_ENABLED != 'true'" in jobs["build"]["if"]
    assert "inputs.environment == 'prod'" in jobs["build"]["if"]
    assert "LAI_DEV_NATIVE_ENABLED" not in jobs["deploy-prod"]["if"]  # prod logic unchanged
    assert jobs["deploy-prod"]["environment"]["name"] == "django-prod"
    assert (
        "LAI_PROD_AUTO_DEPLOY"
        in (WORKFLOWS / "deploy-django-ec2.yml").read_text().split("name:")[0]
    )


def test_the_processing_library_releases_every_component_that_ships_it():
    """lambda/build.py zips it, package-release.sh and lai/Dockerfile ship it (ADR-064)."""
    for workflow in (LAMBDA, NATIVE, DJANGO):
        assert "processing/lai_processing/**" in workflow["on"]["push"]["paths"]
    text = (WORKFLOWS / "deploy-site.yml").read_text()
    for pattern in re.findall(r"grep -qE '([^']+)'", text):
        assert re.search(pattern, "processing/lai_processing/core/execution.py"), pattern


def test_site_waits_for_the_native_release_with_the_native_paths():
    text = (WORKFLOWS / "deploy-site.yml").read_text()
    assert "deploy-dev-native.yml" in text
    patterns = re.findall(r"grep -qE '([^']+)'", text)
    assert len(patterns) == 2
    native = re.compile(patterns[1])
    for path_glob in NATIVE["on"]["push"]["paths"]:
        example = path_glob.replace("/**", "/example.txt")
        assert native.search(example), path_glob
    for path in ("react/src/app/App.tsx", "package-lock.json", "README.md", "deploy/ec2/x.yml"):
        assert not native.search(path), path


# --- lint -----------------------------------------------------------------------------------------
def tool(name: str) -> str | None:
    venv = REPO / ".venv/bin" / name
    return str(venv) if venv.exists() else shutil.which(name)


@pytest.mark.parametrize("script", DEV_SCRIPTS)
def test_bash_syntax(script):
    subprocess.run(["bash", "-n", str(REPO / "scripts/aws" / script)], check=True)


def test_shellcheck():
    shellcheck = tool("shellcheck")
    if not shellcheck:
        pytest.skip("shellcheck not installed")
    result = subprocess.run(
        [shellcheck, "-x", "-P", "scripts/aws", *(f"scripts/aws/{s}" for s in DEV_SCRIPTS)],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout


def test_actionlint():
    actionlint = tool("actionlint")
    if not actionlint:
        pytest.skip("actionlint not installed")
    result = subprocess.run(
        [actionlint, *sorted(str(p) for p in WORKFLOWS.glob("*.yml"))],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout
