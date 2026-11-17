"""Guards on the processing worker workflows (LAI-LAMBDA-005): deploy-processing.yml is manual,
gated and OIDC-only; ci.yml's processing-image job never pushes or talks to AWS; the native dev
release ships processing/ (docs/infrastructure/processing-infrastructure.md, section 8)."""

import re
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

REPO = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO / ".github/workflows"


def load(name: str) -> dict:
    data = yaml.safe_load((WORKFLOWS / name).read_text())
    data["on"] = data.pop(True, data.get("on"))  # PyYAML reads the `on` key as True
    return data


PROCESSING = load("deploy-processing.yml")
CI = load("ci.yml")
NATIVE = load("deploy-dev-native.yml")


def roles(job: dict) -> set[str]:
    return {
        step["with"]["role-to-assume"]
        for step in job.get("steps", [])
        if str(step.get("uses", "")).startswith("aws-actions/configure-aws-credentials")
    }


def test_deploy_processing_is_manual_only():
    assert set(PROCESSING["on"]) == {"workflow_dispatch"}
    inputs = PROCESSING["on"]["workflow_dispatch"]["inputs"]
    assert inputs["environment"]["options"] == ["dev", "prod"]
    assert inputs["action"]["options"] == ["build-push", "deploy", "rollback"]
    assert inputs["image_digest"]["type"] == "string"
    assert inputs["execute_change_set"] == {
        "description": inputs["execute_change_set"]["description"],
        "type": "boolean",
        "default": False,
    }
    assert PROCESSING["permissions"] == {"contents": "read"}
    assert PROCESSING["concurrency"]["cancel-in-progress"] is False
    assert "${{ secrets." not in (WORKFLOWS / "deploy-processing.yml").read_text()


def test_every_processing_job_is_gated_by_the_variable_main_and_the_environment():
    jobs = PROCESSING["jobs"]
    assert set(jobs) == {"build-push", "deploy"}
    for name, job in jobs.items():
        assert "vars.LAI_PROCESSING_DEPLOY_ENABLED == 'true'" in job["if"], name
        assert "github.ref == 'refs/heads/main'" in job["if"], name
        assert job["environment"]["name"] == "processing-${{ inputs.environment }}", name
        assert job["permissions"] == {"contents": "read", "id-token": "write"}, name
    assert "inputs.action == 'build-push'" in jobs["build-push"]["if"]
    assert "inputs.action == 'deploy' || inputs.action == 'rollback'" in jobs["deploy"]["if"]
    assert roles(jobs["build-push"]) == {"${{ vars.LAI_PROCESSING_PUBLISHER_ROLE_ARN }}"}
    assert roles(jobs["deploy"]) == {"${{ vars.LAI_PROCESSING_DEPLOY_ROLE_ARN }}"}


def test_build_push_makes_one_arm64_manifest_tagged_by_commit_and_reports_the_digest():
    steps = str(PROCESSING["jobs"]["build-push"]["steps"])
    assert "docker/setup-qemu-action" in steps and "docker/setup-buildx-action" in steps
    assert "--platform linux/arm64 --provenance=false --sbom=false" in steps
    assert "--file processing/Dockerfile.lambda" in steps
    push = next(s for s in PROCESSING["jobs"]["build-push"]["steps"] if s.get("id") == "push")
    assert push["env"]["TAG"] == "${{ github.sha }}"
    assert "imageDigest" in steps and "digest=$digest" in steps
    assert "already exists (tags are immutable)" in steps


def test_deploy_checks_the_digest_and_uses_change_sets():
    steps = str(PROCESSING["jobs"]["deploy"]["steps"])
    assert "^sha256:[a-f0-9]{64}$" in steps
    assert "describe-images" in steps and "imageDigest=$DIGEST" in steps
    assert 'scripts/aws/provision.sh "$TARGET" "${flags[@]}"' in steps
    assert '--only "LaiProcessing-$TARGET"' in steps
    assert "flags+=(--execute)" in steps
    assert "LAI_PROCESSING_WORKER_IMAGE_DIGEST" in steps


def test_ci_builds_and_scans_the_image_without_pushing_or_aws():
    assert set(CI["on"]) == {"push", "pull_request"}
    assert CI["permissions"] == {"contents": "read"}
    job = CI["jobs"]["processing-image"]
    assert "permissions" not in job  # the workflow default: contents read only
    text = str(job["steps"])
    assert "--platform linux/arm64" in text and "--load" in text
    assert "--push" not in text
    assert "aws-actions/" not in text and "secrets." not in text
    assert "--entrypoint python" in text
    assert "import lai_processing_runtime.lambda_handler" in text
    scan = next(s for s in job["steps"] if str(s.get("uses", "")).startswith("aquasecurity/"))
    # Pinned to a full commit SHA: a re-published or withdrawn tag can neither move nor break it.
    assert re.fullmatch(r"[0-9a-f]{40}", scan["uses"].split("@")[1])
    assert scan["with"]["severity"] == "CRITICAL"
    assert scan["with"]["exit-code"] == "1"


def test_the_native_dev_release_ships_processing():
    assert "processing/**" in NATIVE["on"]["push"]["paths"]
    assert "lai_processing-" in str(NATIVE["jobs"]["package"]["steps"])
