"""scripts/aws/verify-dev.sh (LAI-1002/1004), run for real against a fake `aws` and `curl`.

The fakes answer from tables (a healthy dev environment by default), so each test changes one
answer and checks the PASS / FAIL / WARN / SKIP line it produces. A static check proves the
script only ever calls read-only AWS operations. Nothing here touches AWS or the network.
"""

import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/aws/verify-dev.sh"
API = "api.example.test"
ADMIN = "ladm.example.test"
POOL = "us-west-1_AbCdEf123"
ASSETS = "lai-assets-dev-123456789012-us-west-1"
PHOTOS = "lai-child-photos-dev-123456789012-us-west-1"
TOKEN = "eyJ-secret-test-token"

pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")

SETTINGS = [
    "DJANGO_ALLOWED_HOSTS",
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    "COGNITO_REGION",
    "COGNITO_USER_POOL_ID",
    "COGNITO_ALLOWED_CLIENT_IDS",
    "LAI_ASSET_STORAGE",
    "LAI_ASSET_BUCKET",
    "LAI_ASSET_REGION",
    "LAI_CHILD_PHOTO_STORAGE",
    "LAI_CHILD_PHOTOS_BUCKET",
    "LAI_CHILD_PHOTOS_REGION",
    "DJANGO_SECRET_KEY",
]


def healthy_aws() -> list[list]:
    """[substring of the aws command line, stdout, exit code], first match wins."""
    complete = "CREATE_COMPLETE"
    return [
        ["sts get-caller-identity --query Account", "123456789012", 0],
        [
            "sts get-caller-identity --query Arn",
            "arn:aws:sts::123456789012:assumed-role/owner/x",
            0,
        ],
        ["--stack-name LaiAiGuardrailOnly-dev", "", 255],
        ["--stack-name LaiFrontend-dev", "", 255],
        ["Stacks[0].StackStatus", complete, 0],
        ["ParameterKey=='ApiDomainName'", API, 0],
        ["ParameterKey=='AdminDomainName'", ADMIN, 0],
        ["OutputKey=='InstanceId'", "i-0abc", 0],
        ["OutputKey=='DatabaseEndpoint'", "lai-django-dev.x.us-west-1.rds.amazonaws.com", 0],
        ["ec2 describe-instances", "running\trequired", 0],
        ["ssm describe-instance-information", "Online", 0],
        ["TargetGroup", "arn:aws:elasticloadbalancing:tg/abc", 0],
        ["elbv2 describe-target-health", "healthy", 0],
        ["::LoadBalancer", "arn:aws:elasticloadbalancing:lb/abc", 0],
        ["elbv2 describe-listeners", "fixed-response", 0],
        ["rds describe-db-instances", "available\tFalse\tFalse\tTrue\tTrue\t16.4", 0],
        ["ssm get-parameters-by-path", "\t".join(f"/lai/dev/django/{n}" for n in SETTINGS), 0],
        ["/lai/dev/deploy/last-release", '{"status":"healthy","git_sha":"abc"}', 0],
        ["/lai/dev/django/LAI_ASSET_BUCKET", ASSETS, 0],
        ["/lai/dev/django/LAI_CHILD_PHOTOS_BUCKET", PHOTOS, 0],
        ["/lai/dev/django/COGNITO_USER_POOL_ID", POOL, 0],
        ["s3api head-bucket", "", 0],
        ["s3api get-public-access-block", "True\tTrue\tTrue\tTrue", 0],
        ["s3api get-bucket-versioning", "Enabled", 0],
        ["s3api get-bucket-encryption", "AES256", 0],
        ["cognito-idp describe-user-pool", POOL, 0],
    ]


def healthy_http() -> dict[str, list]:
    """'METHOD url' -> [status, redirect, body]."""
    return {
        f"GET https://cognito-idp.us-west-1.amazonaws.com/{POOL}/.well-known/jwks.json": [
            200,
            "",
            "{}",
        ],
        f"GET https://{API}/api/v1/health/ready/": [200, "", "{}"],
        f"GET https://{API}/admin/": [404, "", ""],
        f"GET https://{ADMIN}/": [302, f"https://{ADMIN}/admin/", ""],
        f"GET https://{ADMIN}/admin/login/": [200, "", "<form>"],
        f"GET https://{ADMIN}/api/v1/health/": [404, "", ""],
        f"POST https://{API}/api/v1/me/": [200, "", "{}"],
        f"GET https://{API}/api/v1/children/": [200, "", "[]"],
        f"GET https://{API}/api/v1/children/c-1/home/": [200, "", "{}"],
    }


FAKE_AWS = r"""
import json, os, sys
line = " ".join(sys.argv[1:])
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(["aws", *sys.argv[1:]]) + "\n")
for pattern, out, code in json.load(open(os.environ["FAKE_AWS"])):
    if pattern in line:
        if out:
            print(out)
        sys.exit(code)
sys.exit(255)
"""

FAKE_CURL = r"""
import json, os, sys
args = sys.argv[1:]
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(["curl", *args]) + "\n")
method, out, fmt, url = "GET", None, "", args[-1]
i = 0
while i < len(args) - 1:
    if args[i] == "-X": method = args[i + 1]; i += 1
    elif args[i] == "-o": out = args[i + 1]; i += 1
    elif args[i] == "-w": fmt = args[i + 1]; i += 1
    elif args[i] in ("-H", "--max-time"): i += 1
    i += 1
table = json.load(open(os.environ["FAKE_HTTP"]))
status, location, body = table.get(f"{method} {url}", [404, "", ""])
if out:
    open(out, "w").write(body)
sys.stdout.write(fmt.replace("%{http_code}", str(status)).replace("%{redirect_url}", location))
"""


@pytest.fixture
def verify(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, source in (("aws", FAKE_AWS), ("curl", FAKE_CURL)):
        (tmp_path / f"{name}.py").write_text(source)
        fake = bin_dir / name
        fake.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{tmp_path / name}.py" "$@"\n')
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    log = tmp_path / "calls.log"

    def run(aws=None, http=None, **env):
        (tmp_path / "aws.json").write_text(json.dumps(aws or healthy_aws()))
        (tmp_path / "http.json").write_text(json.dumps(http or healthy_http()))
        full_env = {
            **{k: v for k, v in os.environ.items() if not k.startswith("LAI_")},
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "FAKE_AWS": str(tmp_path / "aws.json"),
            "FAKE_HTTP": str(tmp_path / "http.json"),
            "FAKE_LOG": str(log),
            **env,
        }
        result = subprocess.run(
            ["bash", str(SCRIPT), "dev"], env=full_env, capture_output=True, text=True
        )
        calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return result, calls

    return run


def lines(result, status):
    return [line for line in result.stdout.splitlines() if line.startswith(status)]


def replace(table, pattern, out, code=0):
    return [[p, out, code] if p == pattern else [p, o, c] for p, o, c in table]


def test_a_healthy_environment_passes_every_check(verify):
    result, _ = verify(LAI_TEST_ACCESS_TOKEN=TOKEN, LAI_TEST_CHILD_ID="c-1")
    assert result.returncode == 0, result.stdout + result.stderr
    assert lines(result, "FAIL") == []
    assert lines(result, "WARN") == []
    out = result.stdout
    for expected in (
        "PASS  stack LaiDjangoEc2-dev: CREATE_COMPLETE",
        "PASS  instance i-0abc: running, IMDSv2 required",
        "PASS  RDS lai-django-dev: available, PostgreSQL 16.4, private, encrypted",
        "PASS  SSM /lai/dev/django: all 12 required settings present",
        f"PASS  bucket {ASSETS}: private, versioned, AES256",
        f"PASS  bucket {PHOTOS}: private, versioned, AES256",
        f"PASS  Cognito pool {POOL} exists",
        "PASS  API host hides the admin",
        "PASS  admin host hides the API",
        "PASS  signed in: POST /api/v1/me/ -> 200",
        "PASS  progress: GET child home -> 200",
    ):
        assert expected in out, expected
    assert "SKIP  React site on CloudFront" in out


def test_the_token_is_never_printed(verify):
    result, _ = verify(LAI_TEST_ACCESS_TOKEN=TOKEN)
    assert TOKEN not in result.stdout + result.stderr


def test_without_a_token_the_signed_in_checks_are_skipped_and_nothing_is_posted(verify):
    result, calls = verify()
    assert "SKIP  signed-in API, Cognito token and progress checks" in result.stdout
    assert not any(call[0] == "curl" and "POST" in call for call in calls)


def test_a_missing_stack_fails_and_stops_before_host_checks(verify):
    aws = [["--stack-name LaiDjangoEc2-dev", "", 255], *healthy_aws()]
    result, calls = verify(aws=aws)
    assert result.returncode == 1
    assert "FAIL  stack LaiDjangoEc2-dev: missing" in result.stdout
    assert "stopped: no LaiDjangoEc2-dev" in result.stdout
    assert not any(call[0] == "curl" for call in calls)


def test_the_out_of_band_guardrail_stack_is_flagged(verify):
    aws = replace(healthy_aws(), "--stack-name LaiAiGuardrailOnly-dev", "CREATE_COMPLETE")
    result, _ = verify(aws=aws)
    assert any("LaiAiGuardrailOnly-dev still exists" in line for line in lines(result, "WARN"))
    assert result.returncode == 0


def test_a_public_database_or_open_bucket_fails(verify):
    aws = replace(
        healthy_aws(), "rds describe-db-instances", "available\tFalse\tTrue\tTrue\tTrue\t16.4"
    )
    aws = replace(aws, "s3api get-public-access-block", "True\tTrue\tFalse\tTrue")
    result, _ = verify(aws=aws)
    assert result.returncode == 1
    assert any(
        "RDS lai-django-dev" in line and "public True" in line for line in lines(result, "FAIL")
    )
    assert any(f"bucket {ASSETS}" in line for line in lines(result, "FAIL"))


def test_a_missing_setting_and_broken_host_isolation_fail(verify):
    names = "\t".join(f"/lai/dev/django/{n}" for n in SETTINGS if n != "DJANGO_SECRET_KEY")
    aws = replace(healthy_aws(), "ssm get-parameters-by-path", names)
    http = healthy_http()
    http[f"GET https://{API}/admin/"] = [200, "", "<html>admin</html>"]
    result, _ = verify(aws=aws, http=http)
    assert result.returncode == 1
    failures = "\n".join(lines(result, "FAIL"))
    assert "missing DJANGO_SECRET_KEY" in failures
    assert f"GET https://{API}/admin/ -> 200 (expected 404)" in failures


def test_no_credentials_fails_fast(verify):
    result, calls = verify(aws=[["sts get-caller-identity", "", 255]])
    assert result.returncode == 1
    assert "FAIL  AWS credentials" in result.stdout
    assert len([call for call in calls if call[0] == "aws"]) <= 2


READ_ONLY = re.compile(r"^(describe|get|list|head)-[a-z-]+$")


def test_the_script_only_calls_read_only_aws_operations():
    text = SCRIPT.read_text()
    code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    calls = re.findall(r"\b(?:aws|q)\s+([a-z0-9-]+)\s+([a-z-]+)", code)
    services = {"sts", "cloudformation", "ec2", "ssm", "elbv2", "rds", "s3api", "cognito-idp"}
    found = [(service, verb) for service, verb in calls if service in services]
    assert len(found) >= 15
    for service, verb in found:
        assert READ_ONLY.match(verb), f"aws {service} {verb} is not read-only"
    assert "--with-decryption" not in code
    assert "aws s3 " not in code  # the high-level s3 commands include writes
