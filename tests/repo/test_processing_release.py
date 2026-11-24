"""ADR-071 guards: the production processing release is dispatch-only and gated, the deploy
workflows' push path filters are not widened, and the release tooling (manifest, SHA-256
verification, pre-enable compatibility check, rollback plan) refuses what it must.
No AWS call, no workflow is triggered."""

import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github/workflows"
TOOL = ROOT / "scripts/release/processing_release.py"
sys.path.insert(0, str(TOOL.parent))
import processing_release as release  # noqa: E402

GATE = "vars.LAI_PROD_PROCESSING_DEPLOY_ENABLED == 'true'"
SHA = "a" * 40
OLD = "b" * 40


def load(name: str) -> dict:
    data = yaml.safe_load((WORKFLOWS / name).read_text())
    data["on"] = data.pop(True, data.get("on"))
    return data


RELEASE = load("release-prod-workers.yml")


# --- workflow gates ------------------------------------------------------------------------------
def test_the_prod_worker_release_runs_only_by_manual_dispatch():
    assert set(RELEASE["on"]) == {"workflow_dispatch"}
    inputs = RELEASE["on"]["workflow_dispatch"]["inputs"]
    assert inputs["action"]["options"] == ["release", "rollback"]
    assert inputs["confirm"]["required"] is True
    assert RELEASE["permissions"] == {"contents": "read"}
    assert "${{ secrets." not in (WORKFLOWS / "release-prod-workers.yml").read_text()


def test_every_job_requires_the_repository_gate_and_a_dispatch():
    for name, job in RELEASE["jobs"].items():
        condition = job["if"]
        assert GATE in condition, name
        assert "github.event_name == 'workflow_dispatch'" in condition, name
    assert "github.ref == 'refs/heads/main'" in RELEASE["jobs"]["gate"]["if"]
    for name in ("ffmpeg-layer-arm64", "rollback"):
        assert RELEASE["jobs"][name]["needs"] == "gate"
    assert RELEASE["jobs"]["package"]["needs"] == ["gate", "ffmpeg-layer-arm64"]
    layer = RELEASE["jobs"]["ffmpeg-layer-arm64"]
    assert layer["runs-on"] == "ubuntu-24.04-arm"
    assert "test_audio_ffmpeg_integration" in str(layer["steps"])
    assert RELEASE["jobs"]["publish"]["needs"] == "package"
    confirm = str(RELEASE["jobs"]["gate"]["steps"])
    assert "lai-prod workers" in confirm


def test_aws_access_only_in_the_protected_environment_with_the_worker_release_role():
    oidc = {n: j for n, j in RELEASE["jobs"].items() if j.get("permissions", {}).get("id-token")}
    assert set(oidc) == {"publish", "rollback"}
    for name, job in oidc.items():
        assert job["environment"]["name"] == "django-prod", name
        roles = {
            s["with"]["role-to-assume"]
            for s in job["steps"]
            if str(s.get("uses", "")).startswith("aws-actions/configure-aws-credentials")
        }
        assert roles == {"${{ vars.LAI_PROD_WORKER_RELEASE_ROLE_ARN }}"}, name
    for name in ("gate", "ffmpeg-layer-arm64", "package"):
        assert "permissions" not in RELEASE["jobs"][name]
        assert "aws-actions" not in str(RELEASE["jobs"][name]["steps"])
    publish = str(RELEASE["jobs"]["publish"]["steps"])
    assert publish.index("manifest verify") < publish.index("configure-aws-credentials")


def test_no_push_triggered_workflow_deploys_production_processing():
    for path in WORKFLOWS.glob("*.yml"):
        workflow = load(path.name)
        if not (
            {"push", "schedule", "pull_request", "pull_request_target"} & set(workflow["on"] or {})
        ):
            continue
        text = path.read_text()
        for marker in (
            "lai-prod-jobs",
            "LAI_PROD_WORKER_RELEASE_ROLE_ARN",
            "publish-workers.sh",
            "LAI_PROD_PROCESSING_DEPLOY_ENABLED",
            "lai-github-workers-prod",
        ):
            assert marker not in text, f"{path.name}: {marker}"


#: The push path filters as of c9d722be: ADR-071 adds no path to a push-triggered deploy.
PUSH_PATHS = {
    "deploy-dev-lambda.yml": [
        "lambda/**",
        "lai/apps/ai/providers/**",
        "lai/apps/jobs/core/**",
        "processing/lai_processing/**",
        "scripts/aws/package-lambda.sh",
        "tests/lambda/**",
        ".github/workflows/deploy-dev-lambda.yml",
    ],
    "deploy-django-ec2.yml": [
        "lai/**",
        "processing/lai_processing/**",
        "content/**",
        "react/public/models/**",
        "requirements.txt",
        "requirements-dev.txt",
        "pyproject.toml",
        "scripts/aws/**",
        "deploy/ec2/**",
        "tests/deploy/**",
        ".dockerignore",
        ".github/workflows/deploy-django-ec2.yml",
    ],
}


@pytest.mark.parametrize("name", sorted(PUSH_PATHS))
def test_push_path_filters_are_not_widened(name):
    assert load(name)["on"]["push"]["paths"] == PUSH_PATHS[name]


def test_the_release_tooling_lives_outside_every_push_deploy_path():
    for path in WORKFLOWS.glob("*.yml"):
        push = (load(path.name)["on"] or {}).get("push") or {}
        for pattern in push.get("paths", []):
            assert not pattern.startswith("scripts/release"), path.name
            assert pattern not in ("scripts/**", "**"), path.name


def test_rollback_needs_controls_off_and_releases_are_idempotent_and_first_run_capable():
    inputs = RELEASE["on"]["workflow_dispatch"]["inputs"]
    assert inputs["upload_only"]["type"] == "boolean" and inputs["upload_only"]["default"] is False
    gate = str(RELEASE["jobs"]["gate"]["steps"])
    assert "all processing controls are off" in gate
    package = str(RELEASE["jobs"]["package"]["steps"])
    assert "--created-at" in package and "--previous" in package  # deterministic manifest (F9)
    publish = str(RELEASE["jobs"]["publish"]["steps"])
    assert "--upload-only" in publish
    script = (TOOL.parent / "publish-workers.sh").read_text()
    assert "rollback-plan --target" in script and "--controls-off" in script
    assert "ResourceNotFoundException" in script  # absent functions are skipped (F2)
    header = (WORKFLOWS / "release-prod-workers.yml").read_text().split("name:")[0]
    assert "1.2.0" in header and "MUST ship" in header  # per-kind ordering (F5)


# --- manifest ------------------------------------------------------------------------------------
FFMPEG_PIN = "f" * 64


def write_zip(path: Path, member: str, data: bytes, extra: dict | None = None) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(member, data)
        for name, content in (extra or {}).items():
            archive.writestr(name, content)


@pytest.fixture
def dist(tmp_path):
    root = tmp_path / "dist"
    record = json.dumps({"files_sha256": {"bin/ffmpeg": FFMPEG_PIN}})
    for name, extra in (
        ("jobs-worker", None),
        ("audio-worker", None),
        ("ffmpeg-layer", {"share/lai-ffmpeg/build-record.json": record}),
        ("image-worker", None),
    ):
        (root / name).mkdir(parents=True)
        write_zip(root / name / f"{name}.zip", "x", name.encode(), extra)
    (root / "jobs-worker" / "kinds.json").write_text(
        json.dumps(["asset.inspect", "asset.validate_model", "studio.generate_chunk"])
    )
    (root / "versions.json").write_text(json.dumps(release.processor_versions(ROOT)))
    return root


def manifest_for(dist, sha=SHA, previous=None):
    return release.create_manifest("prod", sha, dist, previous, "2026-11-18T00:00:00Z")


def report(**overrides):
    data = {
        "schema_version": 1,
        "environment": "prod",
        "git_sha": SHA,
        "jobs_backend": "sqs",
        "result_kinds": ["asset.validate_model", "asset.transcode_audio", "asset.convert_image"],
        "submittable_kinds": [
            "asset.validate_model",
            "asset.transcode_audio",
            "asset.convert_image",
        ],
        "controls": {"LAI_AUDIO_TRANSCODING": "off", "LAI_IMAGE_CONVERSION": "off"},
        "queue_urls_configured": {
            "LAI_JOBS_AUDIO_QUEUE_URL": True,
            "LAI_JOBS_IMAGE_QUEUE_URL": True,
            "LAI_JOBS_MEDIA_QUEUE_URL": True,
            "LAI_JOBS_OPTIMIZE_QUEUE_URL": True,
        },
        "pending_migrations": [],
    }
    data.update(overrides)
    return data


def with_versions(manifest, name, versions):
    out = json.loads(json.dumps(manifest))
    for artifact in out["artifacts"]:
        if artifact["name"] == name:
            artifact["kind_versions"].update(versions)
    return out


def test_processor_versions_are_read_from_the_sources():
    versions = release.processor_versions(ROOT)
    assert set(versions) == set(release.PROCESSOR_VERSIONS)
    assert release.version_tuple(versions["asset.validate_model"]) >= (1, 2, 0)


def test_manifest_records_keys_hashes_functions_kinds_versions_and_pins(dist):
    manifest = manifest_for(dist)
    by_name = {a["name"]: a for a in manifest["artifacts"]}
    assert set(by_name) == {"jobs-worker", "audio-worker", "ffmpeg-layer", "image-worker"}
    audio = by_name["audio-worker"]
    assert audio["functions"] == ["lai-prod-jobs-audio"]
    assert audio["supported_kinds"] == ["asset.transcode_audio"]
    assert audio["key"].startswith("lambda/audio-worker-") and audio["key"].endswith(".zip")
    assert by_name["ffmpeg-layer"]["key"].startswith("lambda/layers/ffmpeg-layer-")
    assert by_name["ffmpeg-layer"]["pins"] == {"LAI_FFMPEG_SHA256": FFMPEG_PIN}
    jobs = by_name["jobs-worker"]
    assert jobs["functions"] == ["lai-prod-jobs-ai", "lai-prod-jobs-media"]
    assert (
        jobs["kind_versions"]["asset.validate_model"]
        == release.processor_versions(ROOT)["asset.validate_model"]
    )
    assert jobs["kind_versions"]["asset.inspect"] == "1"
    assert manifest["manifest_key"] == f"releases/processing/{SHA}.json"
    release.verify_manifest(manifest, dist)


def test_the_manifest_is_deterministic(dist):
    previous = f"releases/processing/{OLD}.json"
    one = release.dumps(manifest_for(dist, previous=previous))
    two = release.dumps(manifest_for(dist, previous=previous))
    assert one == two
    assert json.loads(one)["previous_manifest_key"] == previous
    unpinned = release.create_manifest("prod", SHA, dist, None, None)
    assert unpinned["created_at"] == release.FIXED_TIME


def test_stack_parameters_carry_code_keys_layer_and_pins(dist):
    params = release.stack_parameters(manifest_for(dist))
    names = {p.split("=")[0] for p in params}
    assert names == {
        "WorkerCodeKey",
        "AudioWorkerCodeKey",
        "AudioLayerKey",
        "ImageWorkerCodeKey",
        "AudioFfmpegSha256",
    }
    assert f"AudioFfmpegSha256={FFMPEG_PIN}" in params


def test_pin_and_parameter_names_match_the_stacks():
    text = (ROOT / "infra/lib/processingWorkers.ts").read_text()
    for variable, (parameter, _file) in release.PINS.items():
        assert f"{variable}: {{ parameter: '{parameter}'" in text


def test_manifest_matches_its_json_schema_fields(dist):
    schema = json.loads((TOOL.parent / "processing-release-manifest.schema.json").read_text())
    manifest = manifest_for(dist)
    assert set(schema["required"]) == set(manifest)
    item = schema["properties"]["artifacts"]["items"]
    assert set(item["required"]) == set(manifest["artifacts"][0])
    assert set(item["properties"]["name"]["enum"]) == set(release.ARTIFACTS)


def test_verification_refuses_a_changed_or_missing_artifact(dist):
    manifest = manifest_for(dist)
    write_zip(dist / "image-worker" / "image-worker.zip", "x", b"changed")
    with pytest.raises(release.Refused, match="(SHA-256|size)"):
        release.verify_manifest(manifest, dist)
    (dist / "image-worker" / "image-worker.zip").unlink()
    with pytest.raises(release.Refused, match="missing"):
        release.verify_manifest(manifest, dist)


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda m: m.update(git_sha="XYZ"), "git_sha"),
        (lambda m: m["artifacts"][0].update(key="lambda/other.zip"), "content-addressed"),
        (lambda m: m["artifacts"][0].update(functions=["lai-dev-jobs-ai"]), "functions"),
        (lambda m: m.update(extra=1), "unexpected"),
        (lambda m: m.update(previous_manifest_key="releases/x.json"), "previous_manifest_key"),
        (lambda m: m.update(created_at="yesterday"), "created_at"),
        (lambda m: m["artifacts"][0].update(kind_versions={}), "kind_versions"),
        (lambda m: m["artifacts"][0].update(pins={"LAI_TOKTX_SHA256": "a" * 64}), "pins"),
    ],
)
def test_manifest_validation_refuses_tampering(dist, mutate, message):
    manifest = manifest_for(dist)
    mutate(manifest)
    with pytest.raises(release.Refused, match=message):
        release.validate_manifest(manifest)


def test_audio_needs_its_layer_in_the_same_release(dist):
    shutil.rmtree(dist / "ffmpeg-layer")
    with pytest.raises(release.Refused, match="ffmpeg-layer"):
        manifest_for(dist)


# --- pre-enable check (RELEASE invariant) ---------------------------------------------------------
def test_a_control_may_turn_on_only_when_django_and_the_workers_support_it(dist):
    manifest = manifest_for(dist)
    assert release.check_enable(manifest, report(), "LAI_AUDIO_TRANSCODING", "prod") == []
    assert release.check_enable(manifest, report(), "LAI_ASSET_ASYNC_VALIDATION", "prod") == []
    assert release.check_enable(manifest, report(), "LAI_THUMBNAIL_CAPTURE", "prod") == []


@pytest.mark.parametrize(
    "overrides, reason",
    [
        ({"result_kinds": ["asset.validate_model"]}, "cannot apply results"),
        ({"submittable_kinds": []}, "does not register"),
        ({"jobs_backend": "disabled"}, "not sqs"),
        ({"pending_migrations": ["assets.0003_x"]}, "unapplied migrations"),
        ({"git_sha": OLD}, "same commit"),
        ({"queue_urls_configured": {}}, "not configured"),
        ({"required_processor_versions": {"asset.transcode_audio": "2"}}, "needs processor 2"),
    ],
)
def test_the_check_refuses_every_incompatibility(dist, overrides, reason):
    reasons = release.check_enable(
        manifest_for(dist), report(**overrides), "LAI_AUDIO_TRANSCODING", "prod"
    )
    assert any(reason in r for r in reasons), reasons


def test_the_check_refuses_a_kind_no_released_worker_accepts(dist):
    shutil.rmtree(dist / "image-worker")
    reasons = release.check_enable(manifest_for(dist), report(), "LAI_IMAGE_CONVERSION", "prod")
    assert any("does not accept asset.convert_image" in r for r in reasons)
    reasons = release.check_enable(manifest_for(dist), report(), "LAI_GLB_MESHOPT", "prod")
    assert any("lai-prod-jobs-optimize" in r for r in reasons)


def test_meshopt_and_ktx2_need_the_1_2_0_media_worker_first(dist):
    """Review F5: Django may ship first with both controls off (it omits the options); the
    validator 1.2.0 media worker must be released before either control is switched on."""
    old = with_versions(manifest_for(dist), "jobs-worker", {"asset.validate_model": "1.1.0"})
    for control in ("LAI_GLB_MESHOPT", "LAI_GLB_KTX2"):
        reasons = release.check_enable(old, report(), control, "prod")
        assert any("asset.validate_model needs processor 1.2.0" in r for r in reasons), control
    current = manifest_for(dist)
    for control in ("LAI_GLB_MESHOPT", "LAI_GLB_KTX2"):
        reasons = release.check_enable(current, report(), control, "prod")
        assert not any("needs processor" in r for r in reasons), reasons


def test_the_check_requires_the_prod_namespace(dist):
    with pytest.raises(release.Refused, match="LAI_ENVIRONMENT"):
        release.check_enable(
            manifest_for(dist), report(environment="local"), "LAI_AUDIO_TRANSCODING", "prod"
        )


# --- rollback ------------------------------------------------------------------------------------
def older(manifest, *, keep=None, versions=None):
    out = json.loads(json.dumps(manifest))
    out["git_sha"] = OLD
    out["manifest_key"] = f"releases/processing/{OLD}.json"
    if keep is not None:
        out["artifacts"] = [a for a in out["artifacts"] if a["name"] in keep]
    for artifact in out["artifacts"]:
        for kind in artifact["kind_versions"]:
            if versions and kind in versions:
                artifact["kind_versions"][kind] = versions[kind]
    return out


def test_rollback_plan_points_functions_at_the_earlier_artifacts(dist):
    current = manifest_for(dist)
    steps = release.rollback_plan(current, report=report())
    functions = {s.get("function") for s in steps}
    assert {"lai-prod-jobs-ai", "lai-prod-jobs-media", "lai-prod-jobs-audio"} <= functions
    layer = next(s for s in steps if "stack_parameter" in s)
    assert layer["stack_parameter"] == "AudioLayerKey"


def test_rollback_needs_a_report_or_the_controls_off_confirmation(dist):
    target = manifest_for(dist)
    with pytest.raises(release.Refused, match="controls are off"):
        release.rollback_plan(target)
    assert release.rollback_plan(target, controls_off=True)


def test_rollback_is_refused_while_a_control_routes_to_a_worker_the_target_lacks(dist):
    current = manifest_for(dist)
    old = older(current, keep={"jobs-worker"})
    on = report(controls={"LAI_AUDIO_TRANSCODING": "on"})
    with pytest.raises(release.Refused, match="turn it off first"):
        release.rollback_plan(old, current=current, report=on)
    assert release.rollback_plan(old, current=current, report=report())


def test_rollback_compares_processor_versions(dist):
    current = manifest_for(dist)
    old = older(current, versions={"asset.validate_model": "1.1.0"})
    on = report(controls={"LAI_GLB_MESHOPT": "on"})
    with pytest.raises(release.Refused, match="needs processor 1.2.0"):
        release.rollback_plan(old, current=current, report=on)
    steps = release.rollback_plan(old, current=current, controls_off=True)
    assert any("goes back from" in s.get("notice", "") for s in steps)


def test_the_cli_exit_codes(dist, tmp_path):
    out = tmp_path / "manifest.json"

    def run(*args):
        return subprocess.run(
            [sys.executable, "-I", str(TOOL), *args], capture_output=True, text=True
        )

    created = run(
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
    )
    assert created.returncode == 0, created.stderr
    assert run("manifest", "verify", str(out), "--dist", str(dist)).returncode == 0
    report_file = tmp_path / "report.json"
    report_file.write_text(json.dumps(report(jobs_backend="disabled")))
    refused = run(
        "check-enable",
        "--manifest",
        str(out),
        "--django-report",
        str(report_file),
        "--control",
        "LAI_AUDIO_TRANSCODING",
        "--env",
        "prod",
    )
    assert refused.returncode == 1 and "must stay off" in refused.stderr
    assert run("manifest", "validate", str(tmp_path / "nope.json")).returncode == 1
    assert run("rollback-plan", "--target", str(out)).returncode == 2  # needs a source
    assert run("rollback-plan", "--target", str(out), "--controls-off").returncode == 0
    params = run("stack-parameters", str(out))
    assert params.returncode == 0 and "AudioFfmpegSha256=" in params.stdout
    versions = run("versions", "--repo", str(ROOT))
    assert "asset.validate_model" in json.loads(versions.stdout)


def test_release_scripts_parse():
    for name in ("build-workers.sh", "publish-workers.sh"):
        subprocess.run(["bash", "-n", str(TOOL.parent / name)], check=True)


# --- production consumer and sweep (Compose, profile `jobs`) -------------------------------------
def test_the_prod_consumer_and_sweep_are_hardened_compose_services_behind_the_jobs_profile():
    compose = yaml.safe_load((ROOT / "deploy/ec2/docker-compose.yml").read_text())["services"]
    consumer, sweep = compose["jobs-consumer"], compose["jobs-sweep"]
    assert consumer["command"] == ["python", "manage.py", "jobs_consume_results"]
    assert consumer["restart"] == "on-failure"  # exit 0 (backend not sqs) is never restarted
    assert "manage.py jobs_sweep" in sweep["command"][0]
    for service in (consumer, sweep):
        assert service["profiles"] == ["jobs"]
        assert service["read_only"] is True
        assert service["cap_drop"] == ["ALL"]
        assert service["depends_on"]["django"]["condition"] == "service_healthy"
        assert service["logging"]["driver"] == "awslogs"
        assert "ports" not in service
    assert sweep["init"] is True
    # Only these two run a jobs command, and only the django service is unprofiled.
    jobs = sorted(n for n, s in compose.items() if "jobs_" in str(s.get("command", "")))
    assert jobs == ["jobs-consumer", "jobs-sweep"]


@pytest.mark.parametrize("backend, expected", [("sqs", 0), ("disabled", 1), (None, 1)])
def test_the_jobs_profile_follows_the_rendered_backend(tmp_path, backend, expected):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    if backend:
        (runtime / "django.env").write_text(f"DJANGO_DEBUG=false\nLAI_JOBS_BACKEND={backend}\n")
    lib = ROOT / "scripts/aws/lib.sh"
    script = f'LAI_ROOT={tmp_path}; . "{lib}"; LAI_RUNTIME_DIR={runtime}; jobs_enabled'
    assert subprocess.run(["bash", "-c", script]).returncode == expected
