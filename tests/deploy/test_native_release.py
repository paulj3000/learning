"""The native dev release scripts (scripts/aws/native), run for real against fakes.

Each test gets a temporary /opt/lai, /etc/lai/native.conf, systemd and nginx directories, and a
small source tree packaged with package-release.sh --skip-wheels into a fake artifacts bucket.
tests/deploy/native_fakes.py stands in for the AWS CLI, systemctl, nginx, curl and Python; files
in its state directory decide what each fake answers. Nothing here needs root, AWS or a network.
Needs bash, jq, flock, envsubst, tar, gzip and sha256sum.
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
NATIVE = REPO / "scripts/aws/native"
FAKES = Path(__file__).with_name("native_fakes.py")
SECRET_KEY = "s3cret-key-value-that-must-never-be-logged-0123456789"
DB_PASSWORD = "db/pass:w@rd&more"
API = "api.example.test"
ADMIN = "ladm.example.test"

pytestmark = pytest.mark.skipif(
    not all(
        shutil.which(tool)
        for tool in ("bash", "jq", "flock", "envsubst", "tar", "gzip", "sha256sum")
    ),
    reason="needs bash, jq, flock, envsubst, tar, gzip and sha256sum",
)


def sha(n: int) -> str:
    return f"{n:040x}"


def epoch(n: int) -> int:
    return 1_700_000_000 + n


GOOD_PARAMS = {
    "DJANGO_SECRET_KEY": SECRET_KEY,
    "DJANGO_ALLOWED_HOSTS": f"{API},{ADMIN}",
    "DJANGO_CSRF_TRUSTED_ORIGINS": f"https://{ADMIN}",
    "COGNITO_REGION": "us-west-1",
    "COGNITO_USER_POOL_ID": "us-west-1_POOL",
    "COGNITO_ALLOWED_CLIENT_IDS": "abc123",
    "LAI_ASSET_STORAGE": "s3",
    "LAI_ASSET_BUCKET": "lai-assets-test",
    "LAI_ASSET_REGION": "us-west-1",
    "LAI_JOBS_BACKEND": "sqs",
}

# Management commands present in the small source tree (ensure_speech_roles and jobs_sweep are
# deliberately absent, to prove the scripts skip commands a release does not have).
COMMANDS = [
    "ensure_asset_roles",
    "ensure_content_roles",
    "ensure_npc_roles",
    "ensure_sound_roles",
    "ensure_studio_roles",
    "seed_treasure_rush",
    "seed_speech_voices",
    "seed_npc_pip",
    "seed_npc_quill",
    "publish_treasure_rush",
    "import_assets",
    "load_content",
    "speech_cleanup",
    "ai_retention",
]


def make_source(path: Path) -> Path:
    """A minimal repository the packager can build a release from."""
    for rel in ("scripts/aws/native", "deploy/native"):
        shutil.copytree(REPO / rel, path / rel)
    (path / "lai/apps/demo/management/commands").mkdir(parents=True)
    (path / "lai/manage.py").write_text("# fake\n")
    for command in COMMANDS:
        (path / f"lai/apps/demo/management/commands/{command}.py").write_text("# fake\n")
    (path / "lai/apps/demo/__pycache__").mkdir()
    (path / "lai/apps/demo/__pycache__/x.cpython-312.pyc").write_bytes(b"\0")
    (path / "content").mkdir()
    (path / "content/places.json").write_text("{}\n")
    (path / "react/public/models").mkdir(parents=True)
    (path / "react/public/models/npc-pip.glb").write_bytes(b"glTF")
    (path / "requirements.txt").write_text("Django==6.1.2\n")
    return path


class Box:
    """A fake instance plus a fake artifacts bucket."""

    def __init__(self, tmp: Path):
        self.tmp = tmp
        self.root = tmp / "opt-lai"
        self.state = tmp / "fake"
        self.logs = tmp / "log"
        self.etc = tmp / "etc-lai"
        self.systemd = tmp / "systemd"
        self.nginx_conf = tmp / "nginx/lai.conf"
        self.ca = tmp / "certs/rds-global-bundle.pem"
        self.conf = tmp / "native.conf"
        self.bin = tmp / "bin"
        self.bucket = self.state / "bucket/releases/django"
        for directory in (
            self.root,
            self.state,
            self.logs,
            self.etc,
            self.systemd,
            self.nginx_conf.parent,
            self.ca.parent,
            self.bin,
            self.bucket,
        ):
            directory.mkdir(parents=True, exist_ok=True)
        self.ca.write_text("-----BEGIN CERTIFICATE-----\n")
        (self.root / "state").mkdir(parents=True, exist_ok=True)
        (self.root / "state/setup-complete").touch()
        self.source = make_source(tmp / "src")
        for command in ("aws", "systemctl", "nginx", "curl", "python"):
            name = "python3.12" if command == "python" else command
            fake = self.bin / name
            fake.write_text(
                f'#!/bin/sh\nFAKE_STATE="{self.state}" FAKE_ROOT="{self.root}" '
                f'exec "{sys.executable}" "{FAKES}" {command} "$@"\n'
            )
            fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        self.conf.write_text(
            "\n".join(
                [
                    "LAI_ENV=dev",
                    "AWS_REGION=us-west-1",
                    f"LAI_API_HOST={API}",
                    f"LAI_ADMIN_HOST={ADMIN}",
                    "LAI_SITE_HOST=lai.example.test",
                    "LAI_DB_SECRET_ARN=arn:aws:secretsmanager:us-west-1:123456789012:secret:db",
                    "LAI_DB_INSTANCE_ID=lai-dev",
                    "LAI_ARTIFACT_BUCKET=lai-dev-artifacts-test",
                    "LAI_PARAM_PREFIX=/lai/dev/django",
                    "LAI_POWER_PREFIX=/lai/dev/power",
                    "LAI_DEPLOY_PREFIX=/lai/dev/deploy",
                    "LAI_ACME_MODE=http",
                    "LAI_HOSTED_ZONE_ID=",
                    "LAI_CERT_EMAIL=",
                ]
            )
            + "\n"
        )
        self.params(GOOD_PARAMS)
        self.single({"/lai/dev/power/state": "running"})
        self.write(
            "db_secret.json",
            json.dumps(
                {
                    "username": "lai_admin",
                    "password": DB_PASSWORD,
                    "host": "lai-dev.rds.test",
                    "port": 5432,
                    "dbname": "lai",
                }
            ),
        )
        self.artifacts: dict[int, str] = {}

    # --- fake state ---
    def write(self, name: str, text: str = "") -> None:
        (self.state / name).write_text(text)

    def params(self, values: dict) -> None:
        self.write("params.json", json.dumps(values))

    def single(self, values: dict) -> None:
        path = self.state / "single_params.json"
        current = json.loads(path.read_text()) if path.exists() else {}
        path.write_text(json.dumps({**current, **values}))

    def single_value(self, name: str):
        return json.loads((self.state / "single_params.json").read_text()).get(name)

    def calls(self) -> str:
        path = self.state / "calls.log"
        return path.read_text() if path.exists() else ""

    def env(self, **extra: str) -> dict:
        return {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "LAI_ROOT": str(self.root),
            "LAI_CONF": str(self.conf),
            "LAI_LOG_DIR": str(self.logs),
            "LAI_LOCK_FILE": str(self.root / "deploy.lock"),
            "LAI_LOCK_WAIT_SECONDS": "1",
            "LAI_HEALTH_ATTEMPTS": "2",
            "LAI_HEALTH_INTERVAL": "0",
            "LAI_ETC_DIR": str(self.etc),
            "LAI_SYSTEMD_DIR": str(self.systemd),
            "LAI_NGINX_CONF": str(self.nginx_conf),
            "LAI_RDS_CA": str(self.ca),
            "LAI_PYTHON": str(self.bin / "python3.12"),
            "LAI_RUN_AS": "",
            "LAI_ENV_GROUP": "",
            "LAI_VERIFY_ATTEMPTS": "2",
            "LAI_VERIFY_INTERVAL": "0",
            "LAI_QUIESCE_LOCK_WAIT": "1",
            **extra,
        }

    def run(self, script: Path, *args: str, **extra: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["bash", str(script), *args],
            env=self.env(**extra),
            capture_output=True,
            text=True,
            timeout=120,
        )

    def package(self, n: int) -> str:
        """Build release n into the fake bucket; returns its artifact SHA-256."""
        if n not in self.artifacts:
            result = subprocess.run(
                [
                    "bash",
                    str(NATIVE / "package-release.sh"),
                    "--git-sha",
                    sha(n),
                    "--commit-epoch",
                    str(epoch(n)),
                    "--run-url",
                    "https://github.com/o/r/actions/runs/1",
                    "--out",
                    str(self.bucket),
                    "--source",
                    str(self.source),
                    "--skip-wheels",
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )
            assert result.returncode == 0, result.stderr
            manifest = json.loads((self.bucket / f"{sha(n)}.json").read_text())
            self.artifacts[n] = manifest["artifact_sha256"]
        return self.artifacts[n]

    def request(self, n: int, *flags: str, artifact: str | None = None, when: int | None = None):
        return {
            "LAI_REQ_GIT_SHA": sha(n),
            "LAI_REQ_ARTIFACT_SHA256": artifact or self.package(n),
            "LAI_REQ_COMMIT_EPOCH": str(when if when is not None else epoch(n)),
            "LAI_REQ_RUN_URL": "https://github.com/o/r/actions/runs/1",
            "LAI_REQ_ALLOW_OLDER": "true" if "--allow-older" in flags else "false",
            "LAI_REQ_ALLOW_DESTRUCTIVE": "true"
            if "--allow-destructive-migrations" in flags
            else "false",
        }

    def deploy(self, n: int, *flags: str, **kwargs) -> subprocess.CompletedProcess:
        return self.run(NATIVE / "ssm-native-entry.sh", **self.request(n, *flags, **kwargs))

    def current(self) -> dict:
        path = self.root / "state/current.json"
        return json.loads(path.read_text()) if path.exists() else {}

    def current_link(self) -> str:
        link = self.root / "current"
        return Path(os.readlink(link)).name if link.is_symlink() else ""

    def history(self) -> list[dict]:
        path = self.root / "state/releases.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def release_dir(self, n: int) -> Path:
        return self.root / "releases" / sha(n)

    def output(self, result: subprocess.CompletedProcess) -> str:
        log = self.logs / "deploy.log"
        return result.stdout + result.stderr + (log.read_text() if log.exists() else "")


@pytest.fixture
def box(tmp_path):
    return Box(tmp_path)


# --- deploy ---------------------------------------------------------------------------------------


def test_first_release_is_downloaded_installed_switched_checked_and_recorded(box):
    result = box.deploy(1)
    assert result.returncode == 0, box.output(result)
    current = box.current()
    assert current["git_sha"] == sha(1)
    assert current["artifact_sha256"] == box.package(1)
    assert current["status"] == "healthy" and current["health"] == "pass"
    assert box.current_link() == sha(1)
    release = box.release_dir(1)
    assert (release / "venv/.lai-complete").exists()
    assert (release / "lai/staticfiles").is_dir()
    assert os.readlink(release / "static") == "lai/staticfiles"
    assert (release / "release.env").read_text() == f"LAI_RELEASE_SHA={sha(1)}\n"
    assert (box.state / "collectstatic_settings").read_text() == "config.settings.static_build"
    # Units, gunicorn config and the rendered nginx config are installed from the release.
    for unit in ("lai-gunicorn.service", "lai-jobs-consumer.service"):
        assert (box.systemd / unit).read_text() == (
            REPO / "deploy/native/systemd" / unit
        ).read_text()
    assert (box.etc / "gunicorn.conf.py").exists()
    nginx = box.nginx_conf.read_text()
    assert f"server_name {API};" in nginx and f"server_name {ADMIN};" in nginx
    assert "${" not in nginx
    calls = box.calls()
    assert "s3 cp --only-show-errors s3://lai-dev-artifacts-test/releases/django/" in calls
    assert "-m pip install --quiet --no-index" in calls
    assert "manage.py check --deploy --fail-level ERROR" in calls
    assert "migrate --noinput" not in calls.replace("migrate --plan --noinput", "")
    assert "nginx -t -q" in calls
    assert "systemctl restart lai-gunicorn.service" in calls
    assert "systemctl restart lai-jobs-consumer.service" in calls
    assert "systemctl reload nginx.service" in calls
    last = json.loads(box.single_value("/lai/dev/deploy/last-release"))
    assert (last["git_sha"], last["status"]) == (sha(1), "healthy")


def test_django_commands_get_the_runtime_settings_but_never_on_a_command_line(box):
    result = box.deploy(1)
    assert result.returncode == 0, box.output(result)
    env_file = box.root / "runtime/django.env"
    assert stat.S_IMODE(env_file.stat().st_mode) == 0o640
    lines = dict(line.split("=", 1) for line in env_file.read_text().splitlines())
    assert lines["DJANGO_SECRET_KEY"] == SECRET_KEY
    assert lines["DATABASE_URL"] == (
        "postgresql://lai_admin:db%2Fpass%3Aw%40rd%26more@lai-dev.rds.test:5432/lai"
        f"?sslmode=verify-full&sslrootcert={box.ca}"
    )
    env_log = (box.state / "env.log").read_text()
    check_line = next(line for line in env_log.splitlines() if line.startswith("manage.py check"))
    for name in ("DJANGO_SECRET_KEY", "DATABASE_URL", "LAI_RELEASE_SHA", "DJANGO_SETTINGS_MODULE"):
        assert name in check_line
    assert "LAI_ROOT" not in check_line and "LAI_REQ_GIT_SHA" not in check_line  # scrubbed
    output = box.output(result) + box.calls()
    assert SECRET_KEY not in output
    assert DB_PASSWORD not in output and "db%2Fpass" not in output


def test_a_later_release_migrates_and_keeps_the_previous_one(box):
    assert box.deploy(1).returncode == 0
    box.write("plan", "users.0009_add_thing\n    Add field thing to parentaccount")
    result = box.deploy(2)
    assert result.returncode == 0, box.output(result)
    current = box.current()
    assert current["git_sha"] == sha(2) and current["previous_git_sha"] == sha(1)
    assert current["migrations_applied"] == ["users.0009_add_thing"]
    assert box.release_dir(1).is_dir() and box.release_dir(2).is_dir()


def test_redeploying_the_running_release_reuses_it(box):
    assert box.deploy(1).returncode == 0
    downloads = box.calls().count("s3 cp")
    result = box.deploy(1)
    assert result.returncode == 0, box.output(result)
    assert box.calls().count("s3 cp") == downloads
    assert [h["status"] for h in box.history()] == ["healthy", "healthy"]


def test_a_checksum_mismatch_is_refused_before_anything_is_installed(box):
    box.package(1)
    result = box.deploy(1, artifact="0" * 64)
    assert result.returncode == 20, box.output(result)
    assert "checksum mismatch" in box.output(result)
    assert not box.release_dir(1).exists()
    assert not any(p.name.startswith(".staging") for p in (box.root / "releases").iterdir())
    assert "systemctl" not in box.calls()


def test_a_missing_artifact_fails_the_download(box):
    result = box.deploy(9, artifact="a" * 64)
    assert result.returncode == 20, box.output(result)


def test_deploys_wait_for_instance_setup_to_finish(box):
    (box.root / "state/setup-complete").unlink()
    result = box.deploy(1)
    assert result.returncode == 30, box.output(result)
    assert "s3 cp" not in box.calls()


@pytest.mark.parametrize("state", ["stopping", "stopped"])
def test_deploys_are_refused_while_the_environment_is_stopping_or_stopped(box, state):
    box.single({"/lai/dev/power/state": state})
    result = box.deploy(1)
    assert result.returncode == 75, box.output(result)
    assert "s3 cp" not in box.calls()


@pytest.mark.parametrize(
    "change, code",
    [
        ({"LAI_REQ_GIT_SHA": "abc"}, 10),
        ({"LAI_REQ_ARTIFACT_SHA256": "xyz"}, 10),
        ({"LAI_REQ_COMMIT_EPOCH": "yesterday"}, 10),
        ({"LAI_REQ_RUN_URL": "https://evil.example/run"}, 10),
        ({"LAI_REQ_ALLOW_OLDER": "maybe"}, 10),
    ],
)
def test_the_entry_point_validates_every_parameter(box, change, code):
    result = box.run(NATIVE / "ssm-native-entry.sh", **{**box.request(1), **change})
    assert result.returncode == code, box.output(result)
    assert "s3 cp" not in box.calls()


def test_an_older_commit_is_refused_unless_allowed(box):
    assert box.deploy(2).returncode == 0
    result = box.deploy(1)
    assert result.returncode == 10, box.output(result)
    assert "older than the running release" in box.output(result)
    assert box.current()["git_sha"] == sha(2)
    assert box.deploy(1, "--allow-older").returncode == 0
    assert box.current()["git_sha"] == sha(1)


def test_destructive_migrations_need_an_explicit_flag(box):
    assert box.deploy(1).returncode == 0
    box.write("plan", "users.0011_drop\n    Remove field legacy from parentaccount")
    refused = box.deploy(2)
    assert refused.returncode == 45, box.output(refused)
    assert "Remove field legacy" in box.output(refused)
    assert "manage.py migrate --noinput" not in box.calls()
    assert box.current_link() == sha(1)
    allowed = box.deploy(2, "--allow-destructive-migrations")
    assert allowed.returncode == 0, box.output(allowed)


def test_a_new_database_takes_the_full_history_including_djangos_own_removals(box):
    box.write(
        "plan",
        "contenttypes.0001_initial\n    Create model ContentType\n"
        "contenttypes.0002_remove_content_type_name\n    Remove field name from contenttype",
    )
    result = box.deploy(1)
    assert result.returncode == 0, box.output(result)
    assert "manage.py migrate --noinput" in box.calls()
    assert "new database" in box.output(result)


def test_a_failed_migration_keeps_the_previous_release_serving(box):
    assert box.deploy(1).returncode == 0
    restarts = box.calls().count("restart lai-gunicorn")
    box.write("plan", "users.0010_x\n    Add field y to z")
    box.write("migrate_fail")
    result = box.deploy(2)
    assert result.returncode == 50, box.output(result)
    assert box.current_link() == sha(1)
    assert box.current()["git_sha"] == sha(1)
    assert box.calls().count("restart lai-gunicorn") == restarts
    last = box.history()[-1]
    assert last["failed_stage"] == "migrate" and last["manual_db_review_required"] is True


@pytest.mark.parametrize(
    "fault, code",
    [("db_fail", 40), ("check_fail", 40), ("pip_fail", 40), ("nginx_t_fail", 30)],
)
def test_preflight_failures_stop_before_the_switch(box, fault, code):
    assert box.deploy(1).returncode == 0
    box.write(fault)
    result = box.deploy(2)
    assert result.returncode == code, box.output(result)
    assert box.current_link() == sha(1)
    assert "manage.py migrate --noinput" not in box.calls()


def test_an_unhealthy_release_rolls_back_to_the_previous_one(box):
    assert box.deploy(1).returncode == 0
    box.write("plan", "quests.0004_new_column\n    Add field x to quest")
    box.write(f"unhealthy_{sha(2)}")
    result = box.deploy(2)
    assert result.returncode == 60, box.output(result)
    assert box.current_link() == sha(1)
    assert box.current()["git_sha"] == sha(1)
    assert (box.state / "running").read_text() == sha(1)
    events = [(h["event"], h["status"], h["git_sha"]) for h in box.history()]
    assert events == [
        ("deploy", "healthy", sha(1)),
        ("deploy", "failed", sha(2)),
        ("rollback", "healthy", sha(1)),
    ]
    rollback = box.history()[-1]
    assert rollback["trigger"] == "automatic"
    assert rollback["migrations_not_reversed"] == ["quests.0004_new_column"]
    assert rollback["manual_db_review_required"] is True
    assert "MANUAL DATABASE REVIEW REQUIRED" in box.output(result)
    assert "manage.py migrate --noinput" in box.calls()  # never reversed: no backwards migrate


def test_an_unhealthy_first_release_has_nothing_to_roll_back_to(box):
    box.write(f"unhealthy_{sha(1)}")
    result = box.deploy(1)
    assert result.returncode == 61, box.output(result)
    assert box.current() == {}
    assert box.history()[-1]["exit_code"] == 61


def test_a_failed_automatic_rollback_is_reported(box):
    assert box.deploy(1).returncode == 0
    box.write(f"unhealthy_{sha(2)}")
    box.write(f"unhealthy_{sha(1)}")
    result = box.deploy(2)
    assert result.returncode == 62, box.output(result)
    assert box.history()[-1]["status"] == "rollback_failed"


def test_concurrent_releases_wait_for_the_lock_then_give_up(box):
    box.package(1)
    lock = box.root / "deploy.lock"
    holder = subprocess.Popen(["flock", str(lock), "sleep", "5"])
    try:
        subprocess.run(["sleep", "0.3"], check=True)
        result = box.deploy(1)
    finally:
        holder.kill()
        holder.wait()
    assert result.returncode == 70, box.output(result)
    assert "another release is still running" in box.output(result)


# --- runtime configuration ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "change, message",
    [
        ({"DJANGO_SECRET_KEY": None}, "DJANGO_SECRET_KEY"),
        ({"LAI_ASSET_STORAGE": "local"}, "LAI_ASSET_STORAGE must be s3"),
        ({"DJANGO_SETTINGS_MODULE": "config.settings.local"}, "never takes from SSM"),
        ({"DEBUG": "true"}, "never takes from SSM"),
        ({"AWS_SECRET_ACCESS_KEY": "x"}, "never takes from SSM"),
        ({"LAI_RELEASE_SHA": "x"}, "never takes from SSM"),
        ({"DATABASE_URL": "postgresql://x"}, "built by the release"),
        ({"SOMETHING_ELSE": "x"}, "not a recognised setting"),
        ({"LAI_AI_MODEL_ID": 'say "hi"'}, "quote or backslash"),
    ],
)
def test_missing_or_unsafe_settings_stop_the_release_before_anything_starts(box, change, message):
    params = {**GOOD_PARAMS, **change}
    box.params({k: v for k, v in params.items() if v is not None})
    result = box.deploy(1)
    assert result.returncode == 30, box.output(result)
    assert message in box.output(result)
    assert not (box.root / "runtime/django.env").exists()
    assert "systemctl" not in box.calls()
    assert SECRET_KEY not in box.output(result)


def test_render_env_alone_prints_only_names(box):
    result = box.run(NATIVE / "render-env-native.sh")
    assert result.returncode == 0, box.output(result)
    assert "DJANGO_SECRET_KEY" in result.stderr
    assert SECRET_KEY not in result.stdout + result.stderr
    assert DB_PASSWORD not in result.stdout + result.stderr


# --- rollback and pruning -------------------------------------------------------------------------


def test_manual_rollback_returns_to_the_previous_release(box):
    assert box.deploy(1).returncode == 0
    box.write("plan", "users.0013_add\n    Add field q to r")
    assert box.deploy(2).returncode == 0
    result = box.run(box.root / "current/scripts/aws/native/rollback-native.sh")
    assert result.returncode == 0, box.output(result)
    assert box.current()["git_sha"] == sha(1)
    assert box.current_link() == sha(1)
    assert (box.state / "running").read_text() == sha(1)
    last = box.history()[-1]
    assert (last["event"], last["trigger"], last["status"]) == ("rollback", "manual", "healthy")
    assert last["previous_git_sha"] == sha(2)
    assert last["migrations_not_reversed"] == ["users.0013_add"]


def test_rollback_to_a_named_release_and_nothing_to_roll_back(box):
    assert box.run(NATIVE / "rollback-native.sh").returncode == 63
    for n in (1, 2, 3):
        assert box.deploy(n).returncode == 0
    result = box.run(NATIVE / "rollback-native.sh", "--to", sha(1))
    assert result.returncode == 0, box.output(result)
    assert box.current_link() == sha(1)
    assert box.history()[-1]["manual_db_review_required"] is False
    assert box.run(NATIVE / "rollback-native.sh", "--to", sha(7)).returncode == 63
    assert box.run(NATIVE / "rollback-native.sh", "--to", "not-a-sha").returncode == 10
    # A new deploy after a rollback is not refused as older than the rolled-back release.
    assert box.deploy(4).returncode == 0


def test_pruning_keeps_the_newest_releases_plus_current_and_previous(box):
    for n in range(1, 7):
        assert box.deploy(n).returncode == 0
    kept = sorted(p.name for p in (box.root / "releases").iterdir() if not p.name.startswith("."))
    assert kept == [sha(n) for n in (4, 5, 6)]


def test_pruning_never_removes_the_previous_release(box):
    for n in range(1, 5):
        assert box.deploy(n).returncode == 0, n
    result = box.run(NATIVE / "ssm-native-entry.sh", **box.request(5), LAI_KEEP_RELEASES="1")
    assert result.returncode == 0, box.output(result)
    kept = sorted(p.name for p in (box.root / "releases").iterdir() if not p.name.startswith("."))
    assert kept == [sha(4), sha(5)]


# --- status, bootstrap and maintenance ------------------------------------------------------------


def test_status_prints_the_release_without_secrets(box):
    assert box.deploy(1).returncode == 0
    result = box.run(NATIVE / "status-native.sh")
    assert result.returncode == 0, box.output(result)
    assert sha(1) in result.stdout and "health=pass" in result.stdout
    assert SECRET_KEY not in result.stdout + result.stderr


def test_bootstrap_create_admin_passes_the_password_by_environment_only(box):
    assert box.deploy(1).returncode == 0
    password = "Admin-Passw0rd-that-is-long"
    box.single({"/lai/dev/bootstrap/DJANGO_ADMIN_PASSWORD": password})
    result = box.run(
        box.root / "current/scripts/aws/native/bootstrap-native.sh", "create-admin", "owner"
    )
    assert result.returncode == 0, box.output(result)
    assert "manage.py create_admin_account owner --superuser --no-input" in box.calls()
    assert (box.state / "admin_password_env").read_text() == password
    assert password not in box.calls() + box.output(result)
    assert password not in (box.root / "runtime/django.env").read_text()


@pytest.mark.parametrize(
    "args, expected, absent",
    [
        (
            ["import-assets", "--dry-run"],
            ["import_assets --from-bundled --ids npc-pip,treasure-chest,ground-tile --dry-run"],
            [],
        ),
        (["load-content"], ["manage.py load_content"], []),
        (
            ["ensure-roles"],
            [f"manage.py {c}" for c in COMMANDS if c.startswith("ensure_")],
            ["ensure_speech_roles"],
        ),
        (
            ["seed-content"],
            [
                "manage.py seed_treasure_rush\n",
                "manage.py seed_speech_voices\n",
                "manage.py seed_npc_pip\n",
                "manage.py seed_npc_quill\n",
            ],
            ["--publish"],
        ),
        (["publish-seed-content"], ["manage.py publish_treasure_rush"], []),
    ],
)
def test_bootstrap_tasks_run_fixed_management_commands(box, args, expected, absent):
    assert box.deploy(1).returncode == 0
    result = box.run(NATIVE / "bootstrap-native.sh", *args)
    assert result.returncode == 0, box.output(result)
    calls = box.calls()
    positions = [calls.index(e) for e in expected]
    assert positions == sorted(positions)
    for text in absent:
        assert text not in calls


def test_bootstrap_refuses_unknown_tasks_and_bad_arguments(box):
    assert box.deploy(1).returncode == 0
    for args in (
        ["shell"],
        ["create-admin", "Bad Name;"],
        ["load-content", "x"],
        ["import-assets", "--all"],
    ):
        assert box.run(NATIVE / "bootstrap-native.sh", *args).returncode == 2, args


def test_maintenance_runs_each_task_and_survives_failures(box):
    assert box.run(NATIVE / "maintenance-native.sh").returncode == 0  # no release: no-op
    assert box.deploy(1).returncode == 0
    box.write("fail_speech_cleanup")
    result = box.run(NATIVE / "maintenance-native.sh")
    assert result.returncode == 0, box.output(result)
    calls = box.calls()
    assert "manage.py speech_cleanup" in calls and "manage.py ai_retention" in calls
    assert "ai_retention --apply" not in calls
    log = (box.logs / "maintenance.log").read_text()
    assert "speech_cleanup failed" in log and "skipping jobs_sweep" in log


# --- power ----------------------------------------------------------------------------------------


def pending_record(box: Box, n: int) -> str:
    return json.dumps(
        {
            "git_sha": sha(n),
            "artifact_sha256": box.package(n),
            "commit_epoch": epoch(n),
            "run_url": "https://github.com/o/r/actions/runs/2",
            "recorded_at": "2026-11-16T00:00:00Z",
        }
    )


def test_power_quiesce_stops_the_consumer_then_gunicorn(box):
    assert box.deploy(1).returncode == 0
    result = box.run(NATIVE / "power-native.sh", LAI_REQ_ACTION="quiesce")
    assert result.returncode == 0, box.output(result)
    calls = box.calls()
    consumer = calls.index("systemctl stop lai-jobs-consumer.service")
    gunicorn = calls.index("systemctl stop lai-gunicorn.service")
    assert consumer < gunicorn


def test_power_verify_starts_services_and_applies_a_pending_release(box):
    assert box.deploy(1).returncode == 0
    box.run(NATIVE / "power-native.sh", LAI_REQ_ACTION="quiesce")
    box.single(
        {
            "/lai/dev/power/state": "starting",
            "/lai/dev/deploy/apply-pending-on-start": "true",
            "/lai/dev/deploy/pending": pending_record(box, 2),
        }
    )
    result = box.run(NATIVE / "power-native.sh", LAI_REQ_ACTION="verify")
    assert result.returncode == 0, box.output(result)
    assert box.current_link() == sha(2)
    assert box.single_value("/lai/dev/deploy/pending") == "none"
    calls = box.calls()
    assert "systemctl start lai-gunicorn.service" in calls
    assert "systemctl start lai-jobs-consumer.service" in calls


def test_power_verify_keeps_a_pending_release_that_failed(box):
    assert box.deploy(1).returncode == 0
    box.write(f"unhealthy_{sha(2)}")
    record = pending_record(box, 2)
    box.single(
        {"/lai/dev/deploy/apply-pending-on-start": "true", "/lai/dev/deploy/pending": record}
    )
    result = box.run(NATIVE / "power-native.sh", LAI_REQ_ACTION="verify")
    assert result.returncode == 0, box.output(result)  # rolled back, healthy on release 1
    assert box.current_link() == sha(1)
    assert box.single_value("/lai/dev/deploy/pending") == record


def test_power_verify_clears_a_pending_release_that_is_already_superseded(box):
    pending = pending_record(box, 1)
    assert box.deploy(2).returncode == 0
    box.single(
        {"/lai/dev/deploy/apply-pending-on-start": "true", "/lai/dev/deploy/pending": pending}
    )
    result = box.run(NATIVE / "power-native.sh", LAI_REQ_ACTION="verify")
    assert result.returncode == 0, box.output(result)
    assert box.current_link() == sha(2)  # never redeployed the older release
    assert box.single_value("/lai/dev/deploy/pending") == "none"
    assert "superseded" in box.output(result)


def test_power_verify_ignores_pending_when_not_configured_and_fails_when_unhealthy(box):
    assert box.deploy(1).returncode == 0
    box.single(
        {
            "/lai/dev/deploy/apply-pending-on-start": "false",
            "/lai/dev/deploy/pending": pending_record(box, 2),
        }
    )
    assert box.run(NATIVE / "power-native.sh", LAI_REQ_ACTION="verify").returncode == 0
    assert box.current_link() == sha(1)
    box.write(f"unhealthy_{sha(1)}")
    assert box.run(NATIVE / "power-native.sh", LAI_REQ_ACTION="verify").returncode == 1
    assert box.run(NATIVE / "power-native.sh", LAI_REQ_ACTION="reboot").returncode == 2
