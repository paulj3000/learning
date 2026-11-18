"""ADR-071 release scripts with a fake `aws` (no AWS call): publish-workers.sh (skip absent
functions, upload-only first release, idempotent re-dispatch, rollback by manifest with the
controls-off confirmation) and provision.sh (templates over 51,200 bytes go through a bucket)."""

import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
PUBLISH = REPO / "scripts/release/publish-workers.sh"
PROVISION = REPO / "scripts/aws/provision.sh"
TOOL = REPO / "scripts/release/processing_release.py"
SHA = "c" * 40

pytestmark = pytest.mark.skipif(
    not all(shutil.which(t) for t in ("bash", "jq", "sha256sum")), reason="needs bash, jq"
)

FAKE_AWS = r"""
import base64, hashlib, json, os, shutil, sys
from pathlib import Path
state = Path(os.environ["FAKE_STATE"])
args = sys.argv[1:]
with (state / "calls.log").open("a") as log:
    log.write(" ".join(args) + "\n")
def opt(name):
    return args[args.index(name) + 1] if name in args else None
objects = state / "objects"
objects.mkdir(exist_ok=True)
def obj(key):
    return objects / key.replace("/", "__")
cmd = args[:2]
if cmd == ["sts", "get-caller-identity"]:
    print("123456789012"); sys.exit(0)
if cmd == ["s3api", "head-bucket"]:
    sys.exit(0 if (state / f"bucket_{opt('--bucket')}").exists() else 254)
if cmd == ["s3api", "put-object"]:
    target = obj(opt("--key"))
    if "--if-none-match" in args and target.exists():
        print("An error occurred (PreconditionFailed) when calling the PutObject", file=sys.stderr)
        sys.exit(254)
    shutil.copy(opt("--body"), target); sys.exit(0)
if cmd == ["s3api", "get-object"]:
    source = obj(opt("--key"))
    if not source.exists():
        print("NoSuchKey", file=sys.stderr); sys.exit(254)
    shutil.copy(source, args[-1]); print("{}"); sys.exit(0)
known = state / "functions.json"
functions = json.loads(known.read_text()) if known.exists() else {}
if cmd == ["lambda", "get-function"]:
    if opt("--function-name") not in functions:
        print("An error occurred (ResourceNotFoundException)", file=sys.stderr); sys.exit(254)
    sys.exit(0)
if cmd == ["lambda", "update-function-code"]:
    functions[opt("--function-name")] = opt("--s3-key")
    (state / "functions.json").write_text(json.dumps(functions)); sys.exit(0)
if cmd == ["lambda", "wait"]:
    sys.exit(0)
if cmd == ["lambda", "get-function-configuration"]:
    data = obj(functions[opt("--function-name")]).read_bytes()
    print(base64.b64encode(hashlib.sha256(data).digest()).decode()); sys.exit(0)
if cmd == ["cloudformation", "describe-stacks"]:
    sys.exit(0)
if cmd == ["ssm", "get-parameter"]:
    print("ami-0123456789abcdef0"); sys.exit(0)
if cmd == ["cloudformation", "deploy"]:
    sys.exit(0)
print("fake aws: unhandled " + " ".join(args), file=sys.stderr)
sys.exit(99)
"""


@pytest.fixture
def fake(tmp_path):
    state = tmp_path / "state"
    bin_dir = tmp_path / "bin"
    state.mkdir()
    bin_dir.mkdir()
    script = tmp_path / "fake_aws.py"
    script.write_text(FAKE_AWS)
    aws = bin_dir / "aws"
    aws.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n')
    aws.chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_STATE": str(state),
        "BUCKET": "lai-prod-artifacts-123456789012-us-west-1",
        "AWS_REGION": "us-west-1",
    }

    class Fake:
        def run(self, script, *args, **extra):
            return subprocess.run(
                ["bash", str(script), *args],
                env={**env, **extra},
                capture_output=True,
                text=True,
                timeout=120,
            )

        def calls(self):
            log = state / "calls.log"
            return log.read_text() if log.exists() else ""

        def functions(self, names):
            (state / "functions.json").write_text(json.dumps({n: "" for n in names}))

        def deployed(self):
            return json.loads((state / "functions.json").read_text())

        def put(self, key, path):
            shutil.copy(path, state / "objects" / key.replace("/", "__"))

        state_dir = state

    (state / "objects").mkdir()
    return Fake()


def build_dist(root: Path, image_bytes: bytes = b"image-zip") -> Path:
    dist = root / "dist"
    for name, data in (("jobs-worker", b"jobs-zip"), ("image-worker", image_bytes)):
        (dist / name).mkdir(parents=True)
        with zipfile.ZipFile(dist / name / f"{name}.zip", "w") as archive:
            archive.writestr("x.py", data)
    (dist / "jobs-worker" / "kinds.json").write_text(json.dumps(["asset.validate_model"]))
    (dist / "versions.json").write_text(json.dumps({"asset.validate_model": "1.2.0"}))
    return dist


def manifest(dist: Path, *extra: str) -> Path:
    out = dist / "manifest.json"
    subprocess.run(
        [
            sys.executable,
            "-I",
            str(TOOL),
            "manifest",
            "create",
            "--env",
            "prod",
            "--git-sha",
            SHA,
            "--dist",
            str(dist),
            "--out",
            str(out),
            "--created-at",
            "2026-11-18T00:00:00Z",
            *extra,
        ],
        check=True,
        capture_output=True,
    )
    return out


def test_publish_skips_absent_functions_and_updates_the_rest(fake, tmp_path):
    dist = build_dist(tmp_path)
    fake.functions(["lai-prod-jobs-ai", "lai-prod-jobs-media"])  # image worker disabled
    result = fake.run(PUBLISH, "publish", str(manifest(dist)), str(dist))
    assert result.returncode == 0, result.stderr
    assert "lai-prod-jobs-image does not exist (its worker is disabled); skipped" in result.stdout
    deployed = fake.deployed()
    assert deployed["lai-prod-jobs-ai"].startswith("lambda/jobs-worker-")
    assert deployed["lai-prod-jobs-media"] == deployed["lai-prod-jobs-ai"]
    assert "lai-prod-jobs-image" not in deployed
    assert "functions updated: 2, skipped (absent): 1" in result.stdout
    assert "WorkerCodeKey=lambda/jobs-worker-" in result.stdout  # stack parameters printed


def test_upload_only_first_release_touches_no_function(fake, tmp_path):
    dist = build_dist(tmp_path)
    result = fake.run(PUBLISH, "publish", str(manifest(dist)), str(dist), "--upload-only")
    assert result.returncode == 0, result.stderr
    assert "upload only: no function updated" in result.stdout
    assert "lambda" not in "".join(line.split()[0] for line in fake.calls().splitlines() if line)
    stored = os.listdir(fake.state_dir / "objects")
    assert f"releases__processing__{SHA}.json" in stored
    assert any(name.startswith("lambda__image-worker-") for name in stored)


def test_a_re_dispatch_of_the_same_commit_is_idempotent(fake, tmp_path):
    dist = build_dist(tmp_path)
    first = fake.run(PUBLISH, "publish", str(manifest(dist)), str(dist), "--upload-only")
    assert first.returncode == 0, first.stderr
    again = fake.run(PUBLISH, "publish", str(manifest(dist)), str(dist), "--upload-only")
    assert again.returncode == 0, again.stderr
    assert again.stdout.count("(identical)") == 3  # two zips and the manifest


def test_a_different_artifact_under_an_existing_key_is_refused(fake, tmp_path):
    dist = build_dist(tmp_path)
    path = manifest(dist)
    key = json.loads(path.read_text())["artifacts"][1]["key"]
    other = tmp_path / "other.zip"
    other.write_bytes(b"something else")
    fake.put(key, other)
    result = fake.run(PUBLISH, "publish", str(path), str(dist), "--upload-only")
    assert result.returncode == 1
    assert "exists with other content" in result.stderr


def test_rollback_verifies_the_earlier_manifest_and_points_functions_back(fake, tmp_path):
    dist = build_dist(tmp_path)
    fake.functions(["lai-prod-jobs-ai", "lai-prod-jobs-media", "lai-prod-jobs-image"])
    path = manifest(dist)
    assert fake.run(PUBLISH, "publish", str(path), str(dist)).returncode == 0
    result = fake.run(PUBLISH, "rollback", f"releases/processing/{SHA}.json")
    assert result.returncode == 0, result.stderr
    assert "rollback-plan" not in result.stderr
    assert "functions updated: 3" in result.stdout


def test_rollback_refuses_a_tampered_artifact(fake, tmp_path):
    dist = build_dist(tmp_path)
    path = manifest(dist)
    assert fake.run(PUBLISH, "publish", str(path), str(dist), "--upload-only").returncode == 0
    key = json.loads(path.read_text())["artifacts"][0]["key"]
    bad = tmp_path / "bad.zip"
    bad.write_bytes(b"tampered")
    fake.put(key, bad)
    result = fake.run(PUBLISH, "rollback", f"releases/processing/{SHA}.json")
    assert result.returncode == 1
    assert "differs from the manifest" in result.stderr


# --- provision.sh: large templates (review F7) ----------------------------------------------------
@pytest.fixture
def templates(tmp_path):
    out = tmp_path / "templates"
    out.mkdir()
    small = {"Resources": {}}
    large = {"Resources": {}, "Description": "x" * 60_000}
    for stack in ("LaiAssetStorage-prod", "LaiChildPhotos-prod", "LaiDjangoRelease"):
        (out / f"{stack}.template.json").write_text(json.dumps(small))
    (out / "LaiDjangoEc2-prod.template.json").write_text(json.dumps(large))
    return out


PROVISION_ENV = {
    "LAI_API_DOMAIN": "api.example.test",
    "LAI_ADMIN_DOMAIN": "ladm.example.test",
    "LAI_COGNITO_USER_POOL_ID": "us-west-1_POOL",
    "LAI_COGNITO_CLIENT_IDS": "abc123",
}


def test_provision_sends_large_templates_through_the_bucket_and_small_ones_inline(fake, templates):
    (fake.state_dir / "bucket_lai-prod-artifacts-123456789012-us-west-1").write_text("")
    result = fake.run(PROVISION, "prod", LAI_PROVISION_TEMPLATES=str(templates), **PROVISION_ENV)
    assert result.returncode == 0, result.stderr
    deploys = [c for c in fake.calls().splitlines() if c.startswith("cloudformation deploy")]
    by_stack = {c.split("--stack-name ")[1].split()[0]: c for c in deploys}
    assert "--s3-bucket lai-prod-artifacts-123456789012-us-west-1" in by_stack["LaiDjangoEc2-prod"]
    assert "--s3-prefix tmp/cfn" in by_stack["LaiDjangoEc2-prod"]
    assert "--s3-bucket" not in by_stack["LaiAssetStorage-prod"]
    assert all("--no-execute-changeset" in c for c in deploys)
    assert "infra:synth" not in result.stdout + result.stderr  # used the given templates


def test_provision_refuses_a_large_template_without_a_reachable_bucket(fake, templates):
    result = fake.run(PROVISION, "prod", LAI_PROVISION_TEMPLATES=str(templates), **PROVISION_ENV)
    assert result.returncode == 3
    assert "set LAI_CFN_TEMPLATE_BUCKET" in result.stderr
    assert "deploy --region us-west-1 --stack-name LaiDjangoEc2-prod" not in fake.calls()


def test_provision_takes_an_explicit_template_bucket(fake, templates):
    (fake.state_dir / "bucket_lai-owner-templates").write_text("")
    result = fake.run(
        PROVISION,
        "prod",
        LAI_PROVISION_TEMPLATES=str(templates),
        LAI_CFN_TEMPLATE_BUCKET="lai-owner-templates",
        **PROVISION_ENV,
    )
    assert result.returncode == 0, result.stderr
    assert "--s3-bucket lai-owner-templates" in fake.calls()
