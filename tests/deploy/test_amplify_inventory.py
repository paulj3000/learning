"""scripts/aws/amplify-inventory.sh (AMP-08 stage 0), run for real against a fake `aws`.

A static check proves the script only calls read-only AWS operations. The run tests use a fake
`aws` on PATH that answers from a table, so nothing here touches AWS or the network.
"""

import json
import os
import re
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/aws/amplify-inventory.sh"
API = "abc123api"
POOL = "us-west-1_AbCdEf123"

pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")

READ_ONLY = re.compile(r"^(describe|get|list)-[a-z0-9-]+$")


def test_the_script_only_calls_read_only_aws_operations():
    text = SCRIPT.read_text()
    code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    calls = re.findall(r"\b(?:aws|q)\s+([a-z0-9-]+)\s+([a-z0-9-]+)", code)
    services = {
        "sts",
        "amplify",
        "cloudformation",
        "cognito-idp",
        "cognito-identity",
        "appsync",
        "dynamodb",
        "s3api",
        "lambda",
        "cloudwatch",
        "sns",
        "budgets",
    }
    found = [(service, verb) for service, verb in calls if service in services]
    assert len(found) >= 25
    for service, verb in found:
        assert READ_ONLY.match(verb), f"aws {service} {verb} is not read-only"
    assert "aws s3 " not in code  # the high-level s3 commands include writes
    assert "list-users" not in code  # never user attributes or e-mail addresses
    assert "get-item" not in code and " scan" not in code  # never table contents


def fake_aws(tmp_path: Path, answers: list[list]) -> dict:
    """A fake `aws` that prints the first answer whose substring is in its arguments."""
    table = tmp_path / "answers.json"
    table.write_text(json.dumps(answers))
    log = tmp_path / "calls.log"
    script = tmp_path / "bin" / "aws"
    script.parent.mkdir()
    script.write_text(
        "#!/usr/bin/env python3\n"
        "import json, sys\n"
        f"open({str(log)!r}, 'a').write(' '.join(sys.argv[1:]) + '\\n')\n"
        "args = ' '.join(sys.argv[1:])\n"
        f"for needle, out, code in json.load(open({str(table)!r})):\n"
        "    if needle in args:\n"
        "        print(out)\n"
        "        sys.exit(code)\n"
        "sys.exit(255)\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    env = {**os.environ, "PATH": f"{script.parent}:{os.environ['PATH']}"}
    return {"env": env, "log": log}


def run(fake: dict, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(  # noqa: S603
        ["bash", str(SCRIPT), *args],
        env=fake["env"],
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_without_credentials_it_stops_with_exit_1(tmp_path):
    result = run(fake_aws(tmp_path, []))
    assert result.returncode == 1
    assert "credentials do not work" in result.stdout


def test_it_reports_counts_and_names_but_no_keys(tmp_path):
    answers = [
        ["sts get-caller-identity --query Account", "123456789012", 0],
        ["sts get-caller-identity --query Arn", "arn:aws:sts::123456789012:assumed-role/o/x", 0],
        ["amplify list-apps --query apps[0].appId", "d1abcdef", 0],
        ["amplify list-apps", "d1abcdef\tlearning\tmain.d1abcdef.amplifyapp.com", 0],
        ["amplify list-branches", "main\tPRODUCTION\tTrue", 0],
        ["LAI_SKIP_BACKEND_DEPLOY", "None", 0],
        ["cloudformation list-stacks", "amplify-d1abcdef-main-branch-123", 0],
        ["cloudformation list-stack-resources", "AWS::Cognito::UserPool\tPool\t" + POOL, 0],
        ["cognito-idp list-user-pools", POOL, 0],
        ["UserPool.Name", "amplifyAuthUserPool", 0],
        ["EstimatedNumberOfUsers", "42", 0],
        ["UserPool.DeletionProtection", "INACTIVE", 0],
        ["cognito-idp list-groups", "Admins\tSuperusers", 0],
        ["list-user-pool-clients", "webclient1", 0],
        ["appsync list-graphql-apis", f"{API}\tamplifyData", 0],
        ["SampleCount", "17", 0],
        ["dynamodb list-tables", f"ChildProfile-{API}-NONE", 0],
        ["Table.ItemCount", "5", 0],
        ["Table.DeletionProtectionEnabled", "False", 0],
        ["describe-continuous-backups", "DISABLED", 0],
        ["s3api list-buckets", "amplify-d1abcdef-main-media", 0],
        ["get-bucket-versioning", "None", 0],
        ["--prefix child-photos/ --query length", "3", 0],
        ["--prefix child-photos/ --query sum", "123456", 0],
        ["lambda list-functions", "amplify-d1abcdef-main-claimCoopSlot", 0],
        ["Invocations", "0", 0],
    ]
    result = run(fake_aws(tmp_path, answers), "--days", "7")
    out = result.stdout
    assert result.returncode == 0, result.stderr
    assert "account 123456789012" in out
    assert "branch  main\tPRODUCTION\tTrue" in out
    assert f"user-pool {POOL} name=amplifyAuthUserPool estimated-users=42" in out
    assert "groups=Admins,Superusers clients=webclient1" in out
    assert f"api {API} requests in the last 7 days: 17" in out
    assert f"table ChildProfile-{API}-NONE items=5 deletion-protection=False pitr=DISABLED" in out
    assert "child-photos/ objects=3 bytes=123456" in out
    assert "function amplify-d1abcdef-main-claimCoopSlot invocations=0" in out
    assert "nothing was changed" in out
    log = (tmp_path / "calls.log").read_text()
    verbs = {line.split()[1] for line in log.splitlines() if len(line.split()) > 1}
    assert all(READ_ONLY.match(verb) for verb in verbs), verbs


def test_it_rejects_a_bad_days_value(tmp_path):
    result = run(fake_aws(tmp_path, []), "--days", "seven")
    assert result.returncode == 2
