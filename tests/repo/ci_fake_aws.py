"""A fake `aws` CLI for scripts/ci/ec2_ci.sh tests: EC2 state, SSM commands, the instance lock.

State lives in $FAKE_STATE/state.json; every call is appended to $FAKE_STATE/calls.log. SSM
commands are interpreted by what they do (lock, unlock, cat, chunk read, test run), and files the
instance would hold are served from state["files"].
"""

import json
import os
import re
import sys
from pathlib import Path

STATE_DIR = Path(os.environ["FAKE_STATE"])
STATE = STATE_DIR / "state.json"


def load() -> dict:
    return json.loads(STATE.read_text())


def save(state: dict) -> None:
    STATE.write_text(json.dumps(state))


def arg(args: list[str], name: str) -> str:
    return args[args.index(name) + 1]


def ssm_command(state: dict, script: str) -> dict:
    if "mkdir /run/lai-ci/lock" in script:
        owner = re.search(r"printf '%s\\n' '([^']+)'", script).group(1)
        if state.get("lock_owner"):
            return {"Status": "Success", "StandardOutputContent": f"HELD\n{state['lock_owner']}\n"}
        state["lock_owner"] = owner
        return {"Status": "Success", "StandardOutputContent": "ACQUIRED\n"}
    if "rm -rf /run/lai-ci/lock" in script:
        owner = re.search(r"= '([^']+)' \]", script).group(1)
        if state.get("lock_owner") == owner:
            state["lock_owner"] = None
            return {"Status": "Success", "StandardOutputContent": "RELEASED\n"}
        return {"Status": "Success", "StandardOutputContent": "NOT-OURS\n"}
    match = re.fullmatch(r"tail -c \+(\d+) (\S+) \| head -c (\d+)", script.strip())
    if match:
        start, path, length = int(match.group(1)) - 1, match.group(2), int(match.group(3))
        return {
            "Status": "Success",
            "StandardOutputContent": state["files"][path][start : start + length],
        }
    match = re.fullmatch(r"cat (\S+)", script.strip())
    if match:
        if match.group(1) not in state["files"]:
            return {"Status": "Failed", "StandardErrorContent": "No such file", "ResponseCode": 1}
        return {"Status": "Success", "StandardOutputContent": state["files"][match.group(1)]}
    if "remote_runner.py" in script:
        state["run_script"] = script
        return {
            "Status": state.get("run_status", "Success"),
            "StandardOutputContent": "LAI_CI_DONE verdict=pass complete=True\n",
            "ResponseCode": state.get("run_code", 0),
        }
    raise SystemExit(f"fake aws: unexpected SSM script: {script[:200]}")


def main(argv: list[str]) -> int:
    with (STATE_DIR / "calls.log").open("a") as calls:
        calls.write(" ".join(argv) + "\n")
    state = load()
    service, op = argv[0], argv[1]
    rest = argv[2:]
    try:
        if (service, op) == ("ec2", "describe-instances"):
            print(state["ec2"])
        elif (service, op) == ("ec2", "start-instances"):
            state["ec2"] = "running"
        elif (service, op) == ("ec2", "stop-instances"):
            if state.get("stop_fails"):
                return 254
            state["ec2"] = "stopped"
        elif (service, op) == ("ec2", "wait"):
            if rest[0] == "instance-stopped" and state.get("stop_wait_fails"):
                return 255
            if rest[0] == "instance-stopped" and state["ec2"] == "stopping":
                state["ec2"] = "stopped"
        elif (service, op) == ("ssm", "describe-instance-information"):
            print(state.get("ping", "Online"))
        elif (service, op) == ("ssm", "send-command"):
            params = json.loads(arg(rest, "--parameters"))
            script = "\n".join(params["commands"])
            state.setdefault("sent", []).append(
                {"script": script, "timeout": params["executionTimeout"]}
            )
            command_id = f"cmd-{len(state['sent'])}"
            state.setdefault("commands", {})[command_id] = ssm_command(state, script)
            print(command_id)
        elif (service, op) == ("ssm", "get-command-invocation"):
            record = state["commands"][arg(rest, "--command-id")]
            print(record.get(arg(rest, "--query"), "" if "Content" in arg(rest, "--query") else 0))
        elif (service, op) == ("ssm", "cancel-command"):
            state["cancelled"] = arg(rest, "--command-id")
        else:
            raise SystemExit(f"fake aws: unexpected call {argv}")
    finally:
        save(state)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
