"""scripts/aws/provision.sh keeps LaiProcessing-<env>'s deploy-time settings (LAI-LAMBDA-005).

The worker digest, reserved concurrency, alarm overrides and DLQ redrive roles are CDK context, not
CloudFormation parameters, so a deploy that does not pass them would silently reset them. The
script reads them back from the stack's outputs when the variable is unset; '' or 'none' returns a
setting to its default. Runs offline against fake `aws` and `npm` commands: no AWS call is made.
"""

import json
import os
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
PROVISION = REPO / "scripts/aws/provision.sh"
DIGEST = "sha256:" + "ab" * 32
WORK_ROLE = "arn:aws:iam::123456789012:role/ops/lai-processing-work-redrive"
DONE_ROLE = "arn:aws:iam::123456789012:role/lai-processing-completion-redrive"
KEPT = (
    "LAI_PROCESSING_WORKER_IMAGE_DIGEST",
    "LAI_PROCESSING_RESERVED_CONCURRENCY",
    "LAI_PROCESSING_ALARMS",
    "LAI_PROCESSING_WORK_REDRIVE_ROLE_ARNS",
    "LAI_PROCESSING_COMPLETION_REDRIVE_ROLE_ARNS",
)

FAKE_AWS = r"""#!/usr/bin/env python3
import json, os, re, sys
state = json.load(open(os.environ["FAKE_PROVISION_STATE"]))
args = sys.argv[1:]
with open(os.environ["FAKE_PROVISION_CALLS"], "a") as calls:
    calls.write(" ".join(args) + "\n")
if args[:2] == ["sts", "get-caller-identity"]:
    print("123456789012")
    sys.exit(0)
if args[:2] == ["cloudformation", "describe-stacks"]:
    name = args[args.index("--stack-name") + 1]
    stack = state.get("stacks", {}).get(name)
    if stack is None:
        print(f"Stack with id {name} does not exist", file=sys.stderr)
        sys.exit(254)
    query = args[args.index("--query") + 1]
    match = re.search(r"Stacks\[0\]\.(Outputs|Parameters)\[\?\w+=='(\w+)'\]", query)
    print(stack.get(match.group(1), {}).get(match.group(2), "None"))
    sys.exit(0)
if args[:2] == ["cloudformation", "deploy"]:
    sys.exit(0)
print(f"fake aws: unhandled {args}", file=sys.stderr)
sys.exit(99)
"""

FAKE_NPM = r"""#!/usr/bin/env python3
import json, os
names = os.environ["FAKE_PROVISION_KEPT"].split()
with open(os.environ["FAKE_PROVISION_SYNTH"], "w") as out:
    json.dump({name: os.environ.get(name) for name in names}, out)
"""


@pytest.fixture
def provision(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in (("aws", FAKE_AWS), ("npm", FAKE_NPM)):
        (bin_dir / name).write_text(body)
        (bin_dir / name).chmod(0o755)
    state_file = tmp_path / "state.json"
    synth_file = tmp_path / "synth.json"
    calls_file = tmp_path / "calls.log"

    def run(outputs: dict | None, **overrides: str) -> dict:
        state = {"stacks": {}}
        if outputs is not None:
            state["stacks"]["LaiProcessing-prod"] = {"Outputs": outputs}
        state_file.write_text(json.dumps(state))
        env = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("LAI_", "AWS_", "CDK_"))
        }
        env.update(
            PATH=f"{bin_dir}:{env['PATH']}",
            AWS_REGION="us-west-1",
            FAKE_PROVISION_STATE=str(state_file),
            FAKE_PROVISION_SYNTH=str(synth_file),
            FAKE_PROVISION_CALLS=str(calls_file),
            FAKE_PROVISION_KEPT=" ".join(KEPT),
            **overrides,
        )
        result = subprocess.run(
            ["bash", str(PROVISION), "prod", "--only", "LaiProcessing-prod"],
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, result.stderr
        deploys = [line for line in calls_file.read_text().splitlines() if "deploy " in line]
        assert all("--no-execute-changeset" in line for line in deploys)
        return json.loads(synth_file.read_text())

    return run


DEPLOYED = {
    "WorkerImageDigest": DIGEST,
    "ReservedConcurrency": "5",
    "AlarmOverrides": '{"workOldestMessageSeconds":900}',
    "WorkRedriveRoleArns": WORK_ROLE,
    "CompletionRedriveRoleArns": "none",
}


def test_a_first_deploy_uses_the_defaults(provision):
    synth = provision(None)
    assert synth == {name: "" for name in KEPT}


def test_an_unset_setting_keeps_the_deployed_value(provision):
    synth = provision(DEPLOYED)
    assert synth == {
        "LAI_PROCESSING_WORKER_IMAGE_DIGEST": DIGEST,
        "LAI_PROCESSING_RESERVED_CONCURRENCY": "5",
        "LAI_PROCESSING_ALARMS": '{"workOldestMessageSeconds":900}',
        "LAI_PROCESSING_WORK_REDRIVE_ROLE_ARNS": WORK_ROLE,
        "LAI_PROCESSING_COMPLETION_REDRIVE_ROLE_ARNS": "",
    }


def test_a_stack_from_before_the_outputs_existed_keeps_only_the_digest(provision):
    synth = provision({"WorkerImageDigest": DIGEST})
    assert synth["LAI_PROCESSING_WORKER_IMAGE_DIGEST"] == DIGEST
    assert synth["LAI_PROCESSING_RESERVED_CONCURRENCY"] == ""
    assert synth["LAI_PROCESSING_ALARMS"] == ""


def test_empty_alarm_overrides_are_no_overrides(provision):
    synth = provision({**DEPLOYED, "AlarmOverrides": "{}"})
    assert synth["LAI_PROCESSING_ALARMS"] == ""


def test_a_given_setting_wins_and_none_or_empty_resets_it(provision):
    other = "sha256:" + "cd" * 32
    synth = provision(
        DEPLOYED,
        LAI_PROCESSING_WORKER_IMAGE_DIGEST=other,
        LAI_PROCESSING_RESERVED_CONCURRENCY="8",
        LAI_PROCESSING_ALARMS='{"workerErrors":3}',
        LAI_PROCESSING_COMPLETION_REDRIVE_ROLE_ARNS=DONE_ROLE,
    )
    assert synth == {
        "LAI_PROCESSING_WORKER_IMAGE_DIGEST": other,
        "LAI_PROCESSING_RESERVED_CONCURRENCY": "8",
        "LAI_PROCESSING_ALARMS": '{"workerErrors":3}',
        "LAI_PROCESSING_WORK_REDRIVE_ROLE_ARNS": WORK_ROLE,
        "LAI_PROCESSING_COMPLETION_REDRIVE_ROLE_ARNS": DONE_ROLE,
    }
    reset = provision(
        DEPLOYED,
        LAI_PROCESSING_WORKER_IMAGE_DIGEST="none",
        LAI_PROCESSING_RESERVED_CONCURRENCY="",
        LAI_PROCESSING_ALARMS="none",
        LAI_PROCESSING_WORK_REDRIVE_ROLE_ARNS="none",
    )
    assert reset == {name: "" for name in KEPT}
