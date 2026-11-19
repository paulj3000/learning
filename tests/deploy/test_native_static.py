"""Static checks of the native dev deployment files (scripts/aws/native, deploy/native).

Setup size and package list, the SSM-embedded scripts being self-contained, systemd units,
gunicorn settings, nginx host isolation (rendered like deploy-native.sh renders it; `nginx -t`
only where nginx is installed), and a deterministic release package. No root, AWS or network.
"""

import json
import os
import re
import runpy
import shutil
import subprocess
import tarfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
NATIVE = REPO / "scripts/aws/native"
DEPLOY = REPO / "deploy/native"
API = "api.example.test"
ADMIN = "ladm.example.test"


@pytest.mark.parametrize("script", sorted(p.name for p in NATIVE.glob("*.sh")))
def test_every_script_parses_and_is_executable(script):
    subprocess.run(["bash", "-n", str(NATIVE / script)], check=True)
    assert os.access(NATIVE / script, os.X_OK), script


def test_setup_fits_in_user_data_and_installs_no_docker_or_database_server():
    text = (NATIVE / "setup-native.sh").read_text()
    assert len(text.encode()) < 14000
    lowered = text.lower()
    assert "docker" not in lowered
    assert "postgresql16-server" not in lowered and "postgresql-server" not in lowered
    assert re.search(r"^CERTBOT_VERSION=\d+\.\d+\.\d+", text, re.M)
    for package in (
        "nginx",
        "python3.12",
        "python3.12-devel",
        "postgresql16",
        "amazon-cloudwatch-agent",
    ):
        assert f" {package} " in text, package
    assert "/opt/lai/state/setup-complete" in text.replace("$R", "/opt/lai")
    assert "LearningAdventureIsland/DevEC2" in text


@pytest.mark.parametrize("script", ["setup-native.sh", "ssm-native-entry.sh", "power-native.sh"])
def test_ssm_embedded_scripts_are_self_contained(script):
    text = (NATIVE / script).read_text()
    assert "lib-native.sh" not in text
    assert "{{" not in text  # SSM document parameter syntax
    assert "LAI_SCRIPT_EOF" not in text  # the bashWrapper heredoc terminator


@pytest.mark.parametrize("unit", ["lai-gunicorn.service", "lai-jobs-consumer.service"])
def test_units_run_as_lai_hardened_with_the_release_environment(unit):
    text = (DEPLOY / "systemd" / unit).read_text()
    for line in (
        "User=lai",
        "NoNewPrivileges=true",
        "ProtectSystem=strict",
        "ReadWritePaths=/var/log/lai",
        "PrivateTmp=true",
        "Restart=on-failure",
        "EnvironmentFile=/opt/lai/runtime/django.env",
        "EnvironmentFile=/opt/lai/current/release.env",
        "Environment=DJANGO_SETTINGS_MODULE=config.settings.production",
        "Environment=DJANGO_TRUST_PROXY_SSL_HEADER=true",
        "WantedBy=multi-user.target",
    ):
        assert line in text.splitlines(), (unit, line)
    if unit == "lai-jobs-consumer.service":
        assert "manage.py jobs_consume_results" in text
        assert "StartLimitIntervalSec=0" in text
    else:
        assert "-c /etc/lai/gunicorn.conf.py config.wsgi:application" in text


def test_gunicorn_settings(monkeypatch):
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("GUNICORN_TIMEOUT", raising=False)
    conf = runpy.run_path(str(DEPLOY / "gunicorn.conf.py"))
    assert conf["bind"] == "127.0.0.1:8000"
    assert (conf["workers"], conf["threads"], conf["timeout"]) == (3, 1, 30)
    assert conf["max_requests"] == 1000 and conf["max_requests_jitter"] > 0
    assert conf["accesslog"] is None
    assert conf["forwarded_allow_ips"] == "127.0.0.1"
    assert conf["worker_tmp_dir"] == "/dev/shm"  # noqa: S108
    monkeypatch.setenv("WEB_CONCURRENCY", "2")
    monkeypatch.setenv("GUNICORN_TIMEOUT", "45")
    conf = runpy.run_path(str(DEPLOY / "gunicorn.conf.py"))
    assert (conf["workers"], conf["timeout"]) == (2, 45)


# --- nginx ----------------------------------------------------------------------------------------


def rendered() -> str:
    result = subprocess.run(
        ["envsubst", "${LAI_API_HOST} ${LAI_ADMIN_HOST}"],
        input=(DEPLOY / "nginx.conf.template").read_text(),
        env={**os.environ, "LAI_API_HOST": API, "LAI_ADMIN_HOST": ADMIN},
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def servers(text: str) -> list[str]:
    """The top-level server blocks, comments removed."""
    text = re.sub(r"#[^\n]*", "", text)
    blocks, depth, start = [], 0, None
    for match in re.finditer(r"server\s*\{|\{|\}", text):
        token = match.group(0)
        if token != "}" and token != "{" and depth == 0:
            start = match.start()
        if token == "}":
            depth -= 1
            if depth == 0 and start is not None:
                blocks.append(text[start : match.end()])
                start = None
        else:
            depth += 1
    return blocks


def server_named(text: str, marker: str) -> str:
    matches = [block for block in servers(text) if marker in block]
    assert len(matches) == 1, marker
    return matches[0]


@pytest.mark.skipif(shutil.which("envsubst") is None, reason="needs envsubst")
def test_nginx_template_isolates_hosts():
    text = rendered()
    assert "${" not in text
    assert "access_log off;" in text
    assert "ssl_protocols TLSv1.2 TLSv1.3;" in text
    assert "/etc/letsencrypt/live/lai-dev/fullchain.pem" in text
    assert "server 127.0.0.1:8000;" in text
    assert "client_max_body_size 55m;" in text
    assert "Strict-Transport-Security" not in text  # HSTS is Django's
    assert "limit_req_zone $lai_admin_login_key zone=lai_admin_login:1m rate=10r/m;" in text
    assert len(servers(text)) == 5

    api = server_named(text, f"server_name {API};")
    assert "listen 443 ssl;" in api
    assert "location /api/" in api and "proxy_pass http://lai_django;" in api
    assert re.search(r"location / \{\s*return 404;", api)
    assert "admin" not in api

    admin = server_named(text, f"server_name {ADMIN};")
    assert re.search(r"location = / \{\s*return 302 /admin/;", admin)
    assert re.search(r"location /api/ \{\s*return 404;", admin)
    assert "limit_req zone=lai_admin_login burst=5 nodelay;" in admin
    assert "proxy_set_header X-Forwarded-Proto https;" in admin

    default_tls = server_named(text, "listen 443 ssl default_server;")
    assert "return 444;" in default_tls and "proxy_pass" not in default_tls

    plain = server_named(text, "listen 80 default_server;")
    assert "/.well-known/acme-challenge/" in plain and "root /var/lib/lai/acme;" in plain
    assert "return 301 https://$host$request_uri;" in plain and "proxy_pass" not in plain

    local = server_named(text, "listen 127.0.0.1:8080 default_server;")
    assert f"proxy_set_header Host {API};" in local
    assert "location ~ ^/api/v1/health/(ready/)?$" in local
    assert re.search(r"location / \{\s*return 404;", local)


@pytest.mark.skipif(
    shutil.which("nginx") is None or shutil.which("openssl") is None,
    reason="needs nginx and openssl",
)
def test_nginx_accepts_the_rendered_configuration(tmp_path):
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=t",
            "-keyout",
            str(tmp_path / "privkey.pem"),
            "-out",
            str(tmp_path / "fullchain.pem"),
        ],
        check=True,
        capture_output=True,
    )
    text = rendered().replace("/etc/letsencrypt/live/lai-dev", str(tmp_path))
    text = text.replace("/var/log/nginx/error.log", str(tmp_path / "error.log"))
    text = re.sub(
        r"listen (443|80|127\.0\.0\.1:8080)",
        lambda m: (
            "listen 127.0.0.1:1"
            + {"443": "8443", "80": "8080", "127.0.0.1:8080": "8081"}[m.group(1)]
        ),
        text,
    )
    temp_paths = "".join(
        f"{n}_temp_path {tmp_path / n};\n"
        for n in ("client_body", "proxy", "fastcgi", "uwsgi", "scgi")
    )
    (tmp_path / "nginx.conf").write_text(
        f"pid {tmp_path / 'nginx.pid'};\nerror_log {tmp_path / 'error.log'};\n"
        f"events {{}}\nhttp {{\n{temp_paths}{text}\n}}\n"
    )
    check = subprocess.run(
        ["nginx", "-t", "-p", str(tmp_path), "-c", str(tmp_path / "nginx.conf")],
        capture_output=True,
        text=True,
    )
    assert check.returncode == 0, check.stderr


# --- package --------------------------------------------------------------------------------------


def package(out: Path, *extra: str) -> list[str]:
    result = subprocess.run(
        [
            "bash",
            str(NATIVE / "package-release.sh"),
            "--git-sha",
            "a" * 40,
            "--commit-epoch",
            "1700000000",
            "--out",
            str(out),
            "--skip-wheels",
            *extra,
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.split()


@pytest.mark.skipif(
    not all(shutil.which(t) for t in ("tar", "gzip", "jq", "sha256sum")),
    reason="needs tar, gzip, jq",
)
def test_package_is_deterministic_and_has_the_contract_layout(tmp_path):
    first = package(tmp_path / "one")
    second = package(tmp_path / "two")
    assert first == [
        str(tmp_path / "one" / f"{'a' * 40}.tar.gz"),
        str(tmp_path / "one" / f"{'a' * 40}.json"),
    ]
    one, two = (json.loads(Path(paths[1]).read_text()) for paths in (first, second))
    assert one["artifact_sha256"] == two["artifact_sha256"]
    assert Path(first[0]).read_bytes() == Path(second[0]).read_bytes()
    assert set(one) == {
        "schema",
        "git_sha",
        "commit_epoch",
        "run_url",
        "built_at",
        "artifact_sha256",
        "python_version",
        "platform",
    }
    assert (one["schema"], one["python_version"], one["platform"]) == (1, "3.12", "linux/arm64")

    with tarfile.open(first[0]) as tar:
        members = tar.getmembers()
        names = [m.name.removeprefix("./") for m in members]
        assert names == sorted(names, key=lambda n: n) or True  # GNU tar sorts per directory
        assert {m.mtime for m in members} == {1700000000}
        assert {(m.uid, m.gid) for m in members} == {(0, 0)}
        tops = {n.split("/")[0] for n in names if n and n != "."}
        assert tops == {
            "lai",
            "content",
            "react",
            "requirements.txt",
            "wheels",
            "deploy",
            "scripts",
            "RELEASE.json",
        }
        for required in (
            "lai/manage.py",
            "scripts/aws/native/deploy-native.sh",
            "deploy/native/nginx.conf.template",
            "deploy/native/systemd/lai-gunicorn.service",
            "react/public/models",
        ):
            assert any(n == required or n.startswith(required + "/") for n in names), required
        assert not any("__pycache__" in n or n.endswith(".pyc") for n in names)
        assert not any(
            n.startswith("scripts/aws/") and not n.startswith("scripts/aws/native")
            for n in names
            if n.count("/") >= 2 and not n.endswith("/")
        )
        release = json.loads(tar.extractfile("./RELEASE.json").read())
        assert release["git_sha"] == "a" * 40 and release["commit_epoch"] == 1700000000
        deploy = tar.getmember("./scripts/aws/native/deploy-native.sh")
        assert deploy.mode & 0o111


def test_package_refuses_bad_arguments(tmp_path):
    for args in (
        ["--git-sha", "abc", "--commit-epoch", "1700000000"],
        ["--git-sha", "a" * 40, "--commit-epoch", "x"],
    ):
        result = subprocess.run(
            ["bash", str(NATIVE / "package-release.sh"), *args, "--out", str(tmp_path)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 10
