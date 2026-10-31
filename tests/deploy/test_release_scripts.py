"""The EC2 release scripts (scripts/aws, ADR-037), run for real against fake docker, aws and curl.

Each test gets a temporary /opt/lai, /etc/lai/deploy.conf and log directory. tests/deploy/fakes.py
stands in for Docker, the AWS CLI and the health endpoint; files in its state directory decide
what each fake answers. Nothing here touches Docker, AWS or the network. Needs bash, jq and flock.
"""

import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "scripts/aws"
FAKES = Path(__file__).with_name("fakes.py")
ACCOUNT_REPO = "123456789012.dkr.ecr.us-west-1.amazonaws.com/lai/django"
SECRET_KEY = "s3cret-key-value-that-must-never-be-logged-0123456789"
DB_PASSWORD = "db/pass:w@rd&more"

pytestmark = pytest.mark.skipif(
    not all(shutil.which(tool) for tool in ("bash", "jq", "flock")),
    reason="needs bash, jq and flock",
)


def sha(n: int) -> str:
    return f"{n:040x}"


def digest(n: int) -> str:
    return f"{n:064x}"


def image(n: int) -> str:
    return f"{ACCOUNT_REPO}@sha256:{digest(n)}"


GOOD_PARAMS = {
    "DJANGO_SECRET_KEY": SECRET_KEY,
    "DJANGO_ALLOWED_HOSTS": "api.example.test",
    "DJANGO_CSRF_TRUSTED_ORIGINS": "https://api.example.test",
    "COGNITO_REGION": "us-west-1",
    "COGNITO_USER_POOL_ID": "us-west-1_POOL",
    "COGNITO_ALLOWED_CLIENT_IDS": "abc123",
    "LAI_ASSET_STORAGE": "s3",
    "LAI_ASSET_BUCKET": "lai-assets-test",
    "LAI_ASSET_REGION": "us-west-1",
}


class Box:
    """A fake instance: directories, config, fakes on PATH, and helpers to run the scripts."""

    def __init__(
        self, tmp: Path, env_name: str = "dev", db_mode: str = "rds", snapshot: bool = False
    ):
        self.root = tmp / "opt-lai"
        self.state = tmp / "fake"
        self.logs = tmp / "log"
        self.conf = tmp / "deploy.conf"
        self.bin = tmp / "bin"
        for directory in (self.root / "certs", self.state, self.logs, self.bin):
            directory.mkdir(parents=True)
        (self.root / "certs/rds-global-bundle.pem").write_text("-----BEGIN CERTIFICATE-----\n")
        for command in ("docker", "aws", "curl"):
            fake = self.bin / command
            fake.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{FAKES}" {command} "$@"\n')
            fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        self.conf.write_text(
            "\n".join(
                [
                    f"LAI_ENV={env_name}",
                    "AWS_REGION=us-west-1",
                    f"LAI_ECR_REPOSITORY_URI={ACCOUNT_REPO}",
                    "LAI_PARAM_PREFIX=/lai/test/django",
                    "LAI_RELEASE_PARAM=/lai/test/deploy/last-release",
                    "LAI_API_HOST=api.example.test",
                    f"LAI_DB_MODE={db_mode}",
                    "LAI_DB_SECRET_ARN=arn:aws:secretsmanager:us-west-1:123456789012:secret:db",
                    "LAI_DB_INSTANCE_ID=lai-django-test",
                    f"LAI_PREMIGRATION_SNAPSHOT={'true' if snapshot else 'false'}",
                    "LAI_APP_LOG_GROUP=/lai/test/django",
                    f"LAI_DATA_DIR={tmp / 'data'}",
                ]
            )
            + "\n"
        )
        self.params(GOOD_PARAMS)
        self.write(
            "db_secret.json",
            json.dumps(
                {
                    "username": "lai_admin",
                    "password": DB_PASSWORD,
                    "host": "db.rds.test",
                    "port": 5432,
                    "dbname": "lai",
                }
            ),
        )

    # --- fake state ---
    def write(self, name: str, text: str = "") -> None:
        (self.state / name).write_text(text)

    def params(self, values: dict) -> None:
        self.write("params.json", json.dumps(values))

    def build(self, n: int, revision: str | None = None, channel: str = "release") -> None:
        """An image in the fake registry with the pipeline's labels."""
        labels = {"org.opencontainers.image.revision": revision or sha(n)}
        if channel:
            labels["org.learning-adventure-island.release-channel"] = channel
        self.write(f"labels_{digest(n)}", json.dumps(labels))

    def calls(self) -> str:
        path = self.state / "calls.log"
        return path.read_text() if path.exists() else ""

    def env(self, **extra: str) -> dict:
        return {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "FAKE_STATE": str(self.state),
            "FAKE_REPO": str(REPO),
            "LAI_ROOT": str(self.root),
            "LAI_CONF": str(self.conf),
            "LAI_LOG_DIR": str(self.logs),
            "LAI_LOCK_FILE": str(self.root / "deploy.lock"),
            "LAI_LOCK_WAIT_SECONDS": "1",
            "LAI_HEALTH_ATTEMPTS": "2",
            "LAI_HEALTH_INTERVAL": "0",
            "LAI_SSM_POLL_SECONDS": "0",
            **extra,
        }

    def run(self, script: Path, *args: str, **extra: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["bash", str(script), *args],
            env=self.env(**extra),
            capture_output=True,
            text=True,
            timeout=60,
        )

    # --- the release flow, as the SSM document runs it ---
    def deploy(
        self, n: int, *flags: str, epoch: int | None = None, build: bool = True
    ) -> subprocess.CompletedProcess:
        if build:
            self.build(n)
        entry_env = {
            "LAI_REQ_IMAGE": image(n),
            "LAI_REQ_GIT_SHA": sha(n),
            "LAI_REQ_COMMIT_EPOCH": str(epoch if epoch is not None else 1_700_000_000 + n),
            "LAI_REQ_RUN_URL": "https://github.com/o/r/actions/runs/1",
            "LAI_REQ_ALLOW_OLDER": "true" if "--allow-older" in flags else "false",
            "LAI_REQ_ALLOW_DESTRUCTIVE": "true"
            if "--allow-destructive-migrations" in flags
            else "false",
        }
        return self.run(SCRIPTS / "ssm-release-entry.sh", **entry_env)

    def current(self) -> dict:
        path = self.root / "state/current.json"
        return json.loads(path.read_text()) if path.exists() else {}

    def history(self) -> list[dict]:
        path = self.root / "state/releases.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def release_dir(self, n: int) -> Path:
        return self.root / "releases" / digest(n)

    def output(self, result: subprocess.CompletedProcess) -> str:
        log = self.logs / "deploy.log"
        return result.stdout + result.stderr + (log.read_text() if log.exists() else "")


@pytest.fixture
def box(tmp_path):
    return Box(tmp_path)


# --- shell syntax ---------------------------------------------------------------------------------


@pytest.mark.parametrize("script", sorted(p.name for p in SCRIPTS.glob("*.sh")))
def test_every_script_parses(script):
    subprocess.run(["bash", "-n", str(SCRIPTS / script)], check=True)


# --- deploy ---------------------------------------------------------------------------------------


def test_first_release_is_pulled_configured_started_checked_and_recorded(box):
    result = box.deploy(1)
    assert result.returncode == 0, box.output(result)
    current = box.current()
    assert current["git_sha"] == sha(1)
    assert current["image_digest"] == f"sha256:{digest(1)}"
    assert current["status"] == "healthy" and current["health"] == "pass"
    assert current["run_url"] == "https://github.com/o/r/actions/runs/1"
    assert os.readlink(box.root / "current") == str(box.release_dir(1))
    assert [h["status"] for h in box.history()] == ["healthy"]
    calls = box.calls()
    assert f"docker pull --quiet {image(1)}" in calls
    assert "migrate --noinput" not in calls  # nothing pending
    assert "manage.py check --deploy --fail-level ERROR" in calls
    assert "ssm put-parameter --name /lai/test/deploy/last-release" in calls
    # The release.env compose interpolates from carries the digest-pinned image.
    assert f"LAI_IMAGE={image(1)}" in (box.release_dir(1) / "release.env").read_text()


def test_runtime_configuration_is_private_complete_and_never_logged(box):
    result = box.deploy(1)
    assert result.returncode == 0, box.output(result)
    env_file = box.root / "runtime/django.env"
    assert stat.S_IMODE(env_file.stat().st_mode) == 0o600
    lines = dict(line.split("=", 1) for line in env_file.read_text().splitlines())
    assert lines["DJANGO_SECRET_KEY"] == SECRET_KEY
    assert lines["DATABASE_URL"] == (
        "postgresql://lai_admin:db%2Fpass%3Aw%40rd%26more@db.rds.test:5432/lai"
        "?sslmode=verify-full&sslrootcert=/etc/lai/certs/rds-global-bundle.pem"
    )
    assert lines["AWS_DEFAULT_REGION"] == "us-west-1"
    output = box.output(result) + box.calls()
    assert SECRET_KEY not in output
    assert DB_PASSWORD not in output and "db%2Fpass" not in output


def test_a_later_release_runs_pending_migrations_and_keeps_both_bundles(box):
    assert box.deploy(1).returncode == 0
    box.write("plan", "users.0009_add_thing\n    Add field thing to parentaccount")
    result = box.deploy(2)
    assert result.returncode == 0, box.output(result)
    current = box.current()
    assert current["git_sha"] == sha(2)
    assert current["previous_git_sha"] == sha(1)
    assert current["migrations_applied"] == ["users.0009_add_thing"]
    assert "migrate --noinput" in box.calls()
    assert box.release_dir(1).is_dir() and box.release_dir(2).is_dir()


def test_an_unhealthy_release_rolls_back_and_flags_its_migrations(box):
    assert box.deploy(1).returncode == 0
    box.write("plan", "quests.0004_new_column\n    Add field x to quest")
    box.write(f"unhealthy_{digest(2)}")
    result = box.deploy(2)
    assert result.returncode == 60, box.output(result)
    assert box.current()["git_sha"] == sha(1)
    events = [(h["event"], h["status"], h["git_sha"]) for h in box.history()]
    assert events == [
        ("deploy", "healthy", sha(1)),
        ("deploy", "failed", sha(2)),
        ("rollback", "healthy", sha(1)),
    ]
    failed, rollback = box.history()[1:]
    assert failed["failed_stage"] == "health" and failed["manual_db_review_required"] is True
    assert rollback["trigger"] == "automatic"
    assert rollback["migrations_not_reversed"] == ["quests.0004_new_column"]
    assert rollback["manual_db_review_required"] is True
    assert "MANUAL DATABASE REVIEW REQUIRED" in box.output(result)
    assert (box.state / "running").read_text() == digest(1)


def test_an_unhealthy_first_release_has_nothing_to_roll_back_to(box):
    box.write(f"unhealthy_{digest(1)}")
    result = box.deploy(1)
    assert result.returncode == 61, box.output(result)
    assert box.current() == {}


def test_a_failed_rollback_is_reported_as_such(box):
    assert box.deploy(1).returncode == 0
    box.write(f"unhealthy_{digest(2)}")
    box.write(f"unhealthy_{digest(1)}")  # the old release no longer starts either
    result = box.deploy(2)
    assert result.returncode == 62, box.output(result)
    assert box.history()[-1]["status"] == "rollback_failed"


def test_a_failed_migration_leaves_the_running_release_alone(box):
    assert box.deploy(1).returncode == 0
    box.write("plan", "users.0010_x\n    Add field y to z")
    box.write("migrate_fail")
    calls_before = box.calls().count(" up ")
    result = box.deploy(2)
    assert result.returncode == 50, box.output(result)
    assert box.current()["git_sha"] == sha(1)
    assert box.calls().count(" up ") == calls_before  # the new release never started
    last = box.history()[-1]
    assert last["failed_stage"] == "migrate" and last["manual_db_review_required"] is True


def test_destructive_migrations_need_an_explicit_flag(box):
    assert box.deploy(1).returncode == 0
    box.write("plan", "users.0011_drop\n    Remove field legacy from parentaccount")
    refused = box.deploy(2)
    assert refused.returncode == 45, box.output(refused)
    assert "Remove field legacy" in box.output(refused)
    assert "migrate --noinput" not in box.calls()
    allowed = box.deploy(2, "--allow-destructive-migrations")
    assert allowed.returncode == 0, box.output(allowed)


def test_a_new_database_takes_the_full_history_including_djangos_own_removals(box):
    # Django's contenttypes.0002 removes a field; that must not block the first release.
    box.write(
        "plan",
        "contenttypes.0001_initial\n    Create model ContentType\n"
        "contenttypes.0002_remove_content_type_name\n    Remove field name from contenttype",
    )
    result = box.deploy(1)
    assert result.returncode == 0, box.output(result)
    assert "migrate --noinput" in box.calls()
    assert "new database" in box.output(result)


def test_prod_snapshots_rds_before_migrating(tmp_path):
    box = Box(tmp_path, env_name="prod", snapshot=True)
    box.write("plan", "users.0012_x\n    Add field a to b")
    result = box.deploy(1)
    assert result.returncode == 0, box.output(result)
    calls = box.calls()
    assert "rds create-db-snapshot --db-instance-identifier lai-django-test" in calls
    assert calls.index("rds create-db-snapshot") < calls.index("migrate --noinput")


def test_a_failed_snapshot_stops_before_migrating(tmp_path):
    box = Box(tmp_path, env_name="prod", snapshot=True)
    box.write("plan", "users.0012_x\n    Add field a to b")
    box.write("snapshot_fail")
    result = box.deploy(1)
    assert result.returncode == 48, box.output(result)
    assert "migrate --noinput" not in box.calls()


def test_an_older_commit_is_refused_unless_allowed(box):
    assert box.deploy(2).returncode == 0
    result = box.deploy(1)
    assert result.returncode == 15, box.output(result)
    assert box.current()["git_sha"] == sha(2)
    assert box.deploy(1, "--allow-older").returncode == 0
    assert box.current()["git_sha"] == sha(1)


def test_redeploying_the_running_release_is_idempotent(box):
    assert box.deploy(1).returncode == 0
    assert box.deploy(1).returncode == 0
    assert box.current()["git_sha"] == sha(1)
    assert [h["status"] for h in box.history()] == ["healthy", "healthy"]


@pytest.mark.parametrize(
    "requested, code",
    [
        (f"999999999999.dkr.ecr.us-west-1.amazonaws.com/other@sha256:{digest(1)}", 11),
        (f"{ACCOUNT_REPO}:latest", 10),
        (f"{ACCOUNT_REPO}@sha256:{digest(1)}; touch /tmp/pwned", 10),
    ],
)
def test_the_entry_point_only_accepts_this_repository_pinned_by_digest(box, requested, code):
    box.build(1)
    result = box.run(
        SCRIPTS / "ssm-release-entry.sh",
        LAI_REQ_IMAGE=requested,
        LAI_REQ_GIT_SHA=sha(1),
        LAI_REQ_COMMIT_EPOCH="1700000001",
    )
    assert result.returncode == code, box.output(result)
    assert "docker pull" not in box.calls()


@pytest.mark.parametrize(
    "labels, why",
    [
        ({"revision": sha(9), "channel": "release"}, "revision"),
        ({"revision": sha(1), "channel": "local"}, "release pipeline"),
        ({"revision": sha(1), "channel": ""}, "release pipeline"),
    ],
)
def test_images_not_built_by_the_pipeline_for_this_commit_are_refused(box, labels, why):
    box.build(1, revision=labels["revision"], channel=labels["channel"])
    result = box.deploy(1, build=False)
    assert result.returncode == 12, box.output(result)
    assert why in box.output(result)
    assert " up " not in box.calls()


def test_a_failed_pull_fails_the_release(box):
    box.build(1)
    box.write("pull_fail")
    result = box.deploy(1, build=False)
    assert result.returncode == 20


@pytest.mark.parametrize(
    "change, message",
    [
        ({"DJANGO_SECRET_KEY": None}, "DJANGO_SECRET_KEY"),
        ({"LAI_ASSET_BUCKET": None}, "LAI_ASSET_BUCKET"),
        ({"LAI_ASSET_STORAGE": "local"}, "LAI_ASSET_STORAGE must be s3"),
        ({"DJANGO_SETTINGS_MODULE": "config.settings.local"}, "never takes from SSM"),
        ({"AWS_SECRET_ACCESS_KEY": "x"}, "never takes from SSM"),
        ({"DATABASE_URL": "postgresql://x"}, "built by the release"),
        ({"SOMETHING_ELSE": "x"}, "not a recognised setting"),
    ],
)
def test_missing_or_unsafe_runtime_settings_stop_the_release_before_anything_starts(
    box, change, message
):
    params = {**GOOD_PARAMS, **change}
    box.params({k: v for k, v in params.items() if v is not None})
    result = box.deploy(1)
    assert result.returncode == 30, box.output(result)
    assert message in box.output(result)
    assert " up " not in box.calls()
    assert not (box.root / "runtime/django.env").exists()


def test_preflight_failures_stop_the_release(box):
    box.write("check_fail")
    result = box.deploy(1)
    assert result.returncode == 40
    assert " up " not in box.calls()


def test_concurrent_releases_wait_for_the_lock_then_give_up(box):
    lock = box.root / "deploy.lock"
    holder = subprocess.Popen(["flock", str(lock), "sleep", "5"])
    try:
        for _ in range(50):
            if lock.exists():
                break
        subprocess.run(["sleep", "0.3"], check=True)
        result = box.deploy(1)
    finally:
        holder.kill()
        holder.wait()
    assert result.returncode == 70, box.output(result)
    assert "another release is still running" in box.output(result)


def test_container_database_mode_is_dev_only_and_builds_its_own_url(tmp_path):
    box = Box(tmp_path, db_mode="container")
    box.write("single_params.json", json.dumps({"/lai/dev/db/POSTGRES_PASSWORD": "pg pass"}))
    result = box.deploy(1)
    assert result.returncode == 0, box.output(result)
    env_file = (box.root / "runtime/django.env").read_text()
    assert "DATABASE_URL=postgresql://lai:pg%20pass@db:5432/lai?sslmode=disable" in env_file
    assert "POSTGRES_PASSWORD=pg pass" in (box.root / "runtime/postgres.env").read_text()
    assert "--profile container-db" in box.calls()

    prod = Box(tmp_path / "prod", env_name="prod", db_mode="container")
    assert prod.deploy(1).returncode == 30


# --- rollback -------------------------------------------------------------------------------------


def test_manual_rollback_returns_to_the_previous_healthy_release(box):
    assert box.deploy(1).returncode == 0
    box.write("plan", "users.0013_add\n    Add field q to r")
    assert box.deploy(2).returncode == 0
    result = box.run(SCRIPTS / "rollback-django.sh")
    assert result.returncode == 0, box.output(result)
    assert box.current()["git_sha"] == sha(1)
    assert (box.state / "running").read_text() == digest(1)
    last = box.history()[-1]
    assert (last["event"], last["trigger"], last["status"]) == ("rollback", "manual", "healthy")
    assert last["previous_git_sha"] == sha(2)
    assert last["migrations_not_reversed"] == ["users.0013_add"]
    assert "MANUAL DATABASE REVIEW REQUIRED" in box.output(result)


def test_rollback_without_migrations_needs_no_database_review(box):
    assert box.deploy(1).returncode == 0
    assert box.deploy(2).returncode == 0
    result = box.run(SCRIPTS / "rollback-django.sh")
    assert result.returncode == 0
    assert box.history()[-1]["manual_db_review_required"] is False
    assert "MANUAL DATABASE REVIEW" not in box.output(result)


def test_rollback_to_a_named_release(box):
    for n in (1, 2, 3):
        assert box.deploy(n).returncode == 0
    result = box.run(SCRIPTS / "rollback-django.sh", "--to", sha(1))
    assert result.returncode == 0, box.output(result)
    assert box.current()["git_sha"] == sha(1)


def test_rollback_with_nothing_to_return_to(box):
    assert box.run(SCRIPTS / "rollback-django.sh").returncode == 63
    assert box.deploy(1).returncode == 0
    assert box.run(SCRIPTS / "rollback-django.sh").returncode == 63
    assert box.run(SCRIPTS / "rollback-django.sh", "--to", sha(7)).returncode == 63
    assert box.run(SCRIPTS / "rollback-django.sh", "--to", "not-a-sha").returncode == 10


def test_a_new_deploy_after_a_rollback_is_not_refused_as_older(box):
    assert box.deploy(1).returncode == 0
    assert box.deploy(2).returncode == 0
    assert box.run(SCRIPTS / "rollback-django.sh").returncode == 0
    assert box.deploy(3).returncode == 0
    assert box.current()["git_sha"] == sha(3)


# --- pruning --------------------------------------------------------------------------------------


def test_pruning_keeps_the_newest_healthy_releases_and_never_volumes(box):
    for n in range(1, 8):
        assert box.deploy(n).returncode == 0
    kept = sorted(p.name for p in (box.root / "releases").iterdir())
    assert kept == sorted(digest(n) for n in range(3, 8))
    assert "volume" not in box.calls()
    assert " down" not in box.calls()


# --- status and bootstrap -------------------------------------------------------------------------


def test_status_prints_the_release_and_history_without_secrets(box):
    assert box.deploy(1).returncode == 0
    result = box.run(SCRIPTS / "status.sh")
    assert result.returncode == 0, box.output(result)
    assert sha(1) in result.stdout
    assert "health=pass" in result.stdout
    assert SECRET_KEY not in result.stdout + result.stderr


def test_bootstrap_create_admin_passes_the_password_by_environment_only(box):
    assert box.deploy(1).returncode == 0
    password = "Admin-Passw0rd-that-is-long"
    box.write(
        "single_params.json", json.dumps({"/lai/dev/bootstrap/DJANGO_ADMIN_PASSWORD": password})
    )
    result = box.run(SCRIPTS / "bootstrap-django.sh", "create-admin", "owner")
    assert result.returncode == 0, box.output(result)
    calls = box.calls()
    command = "python manage.py create_admin_account owner --superuser --no-input"
    assert f"-e DJANGO_ADMIN_PASSWORD django {command}" in calls
    assert password not in calls + box.output(result)


@pytest.mark.parametrize(
    "args, expected",
    [
        (
            ["import-assets", "--dry-run"],
            "import_assets --from-bundled --ids npc-pip,treasure-chest,ground-tile --dry-run",
        ),
        (
            ["import-assets"],
            "import_assets --from-bundled --ids npc-pip,treasure-chest,ground-tile",
        ),
        (["ensure-asset-roles"], "manage.py ensure_asset_roles"),
        (["load-content"], "manage.py load_content"),
    ],
)
def test_bootstrap_tasks_run_fixed_management_commands(box, args, expected):
    assert box.deploy(1).returncode == 0
    result = box.run(SCRIPTS / "bootstrap-django.sh", *args)
    assert result.returncode == 0, box.output(result)
    assert expected in box.calls()


def test_bootstrap_refuses_unknown_tasks_and_bad_usernames(box):
    assert box.deploy(1).returncode == 0
    assert box.run(SCRIPTS / "bootstrap-django.sh", "shell").returncode == 2
    assert box.run(SCRIPTS / "bootstrap-django.sh", "create-admin", "Bad Name;").returncode == 2


# --- ssm-run.sh (GitHub / workstation side) -------------------------------------------------------


def invocation(status: str, code: int = 0, detail: str = "") -> str:
    return json.dumps(
        {
            "Status": status,
            "StatusDetails": detail or status,
            "ResponseCode": code,
            "StandardOutputContent": "release output",
            "StandardErrorContent": "",
        }
    )


DEPLOY_ARGS = [
    "dev",
    "deploy",
    "--image",
    image(1),
    "--git-sha",
    sha(1),
    "--commit-epoch",
    "1700000001",
]


def test_ssm_run_reports_success_and_sends_only_document_parameters(box):
    box.write("invocation.json", invocation("Success"))
    result = box.run(
        SCRIPTS / "ssm-run.sh", *DEPLOY_ARGS, "--run-url", "https://github.com/o/r/actions/runs/5"
    )
    assert result.returncode == 0, result.stderr
    assert "release output" in result.stdout
    sent = json.loads((box.state / "sent_parameters.json").read_text())
    assert sent == {
        "AllowOlder": ["false"],
        "AllowDestructiveMigrations": ["false"],
        "RunUrl": ["https://github.com/o/r/actions/runs/5"],
        "Image": [image(1)],
        "GitSha": [sha(1)],
        "CommitEpoch": ["1700000001"],
    }
    assert "--document-name lai-django-deploy-dev" in box.calls()


def test_ssm_run_separates_application_failures_from_transport_failures(box):
    box.write("invocation.json", invocation("Failed", 60))
    app = box.run(SCRIPTS / "ssm-run.sh", *DEPLOY_ARGS)
    assert app.returncode == 1
    assert "APPLICATION DEPLOYMENT FAILURE" in app.stderr and "ROLLED BACK" in app.stderr

    box.write("invocation.json", invocation("TimedOut", -1, "ExecutionTimedOut"))
    timed_out = box.run(SCRIPTS / "ssm-run.sh", *DEPLOY_ARGS)
    assert timed_out.returncode == 3 and "SSM TRANSPORT FAILURE" in timed_out.stderr

    box.write("invocation.json", invocation("Failed", -1, "Undeliverable"))
    assert box.run(SCRIPTS / "ssm-run.sh", *DEPLOY_ARGS).returncode == 3

    box.write("ping", "ConnectionLost")
    offline = box.run(SCRIPTS / "ssm-run.sh", *DEPLOY_ARGS)
    assert offline.returncode == 3 and "not online" in offline.stderr


def test_ssm_run_writes_a_github_step_summary(box, tmp_path):
    summary = tmp_path / "summary.md"
    box.write("invocation.json", invocation("Failed", 50))
    result = box.run(SCRIPTS / "ssm-run.sh", *DEPLOY_ARGS, GITHUB_STEP_SUMMARY=str(summary))
    assert result.returncode == 1
    assert "MANUAL DATABASE REVIEW" in summary.read_text()


@pytest.mark.parametrize(
    "args",
    [
        ["staging", "deploy"],
        ["dev", "shell"],
        ["dev", "deploy", "--image", image(1)],  # missing sha and epoch
        ["dev", "deploy", "--command", "rm -rf /"],
    ],
)
def test_ssm_run_refuses_bad_usage(box, args):
    assert box.run(SCRIPTS / "ssm-run.sh", *args).returncode == 2
    assert "send-command" not in box.calls()
