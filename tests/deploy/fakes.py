"""Fake `docker`, `aws` and `curl` for the release script tests (ADR-037).

Each fake is this file run as a script with its command name as argv[1]. Behaviour is driven by
files in $FAKE_STATE, and every call is appended to $FAKE_STATE/calls.log, so tests can assert on
what the scripts did without Docker, AWS or a network.
"""

import json
import os
import re
import shutil
import sys
from pathlib import Path

STATE = Path(os.environ["FAKE_STATE"])
REPO = Path(os.environ["FAKE_REPO"])


def flag(name: str) -> bool:
    return (STATE / name).exists()


def read(name: str, default: str = "") -> str:
    path = STATE / name
    return path.read_text() if path.exists() else default


def digest_of(text: str) -> str:
    match = re.search(r"(?:sha256:|releases/)([a-f0-9]{64})", text)
    return match.group(1) if match else ""


def log(argv: list[str]) -> None:
    with (STATE / "calls.log").open("a") as calls:
        calls.write(" ".join(argv) + "\n")


def docker(args: list[str]) -> int:
    joined = " ".join(args)
    if args[0] == "login":
        sys.stdin.read()
        return 0
    if args[0] == "pull":
        digest = digest_of(args[-1])
        if flag("pull_fail"):
            return 1
        with (STATE / "images").open("a") as images:
            images.write(digest + "\n")
        return 0
    if args[:2] == ["image", "inspect"]:
        digest = digest_of(args[-1])
        if digest not in read("images").split():
            return 1
        if "Config.Labels" in joined:
            labels = json.loads(read(f"labels_{digest}", "{}"))
            print(json.dumps(labels))
        elif ".Id" in joined:
            print(f"sha256:id-{digest}")
        return 0
    if args[:2] == ["image", "rm"] or args[:2] == ["image", "prune"]:
        return 0
    if args[0] == "inspect":
        print(f"sha256:id-{read('running').strip()}")
        return 0
    if args[0] == "create":
        print("fake-container")
        return 0
    if args[0] == "cp":
        destination = Path(args[-1])
        shutil.copytree(REPO / "scripts/aws", destination / "scripts/aws", dirs_exist_ok=True)
        shutil.copytree(REPO / "deploy/ec2", destination / "deploy/ec2", dirs_exist_ok=True)
        return 0
    if args[0] == "rm":
        return 0
    if args[0] == "compose":
        return compose(args)
    print(f"fake docker: unhandled {joined}", file=sys.stderr)
    return 99


def compose(args: list[str]) -> int:
    joined = " ".join(args)
    release = digest_of(args[args.index("-f") + 1])
    if " config " in f" {joined} ":
        return 1 if flag("compose_config_fail") else 0
    if " run " in f" {joined} ":
        if "manage.py check" in joined:
            return 1 if flag("check_fail") else 0
        if "migrate --plan" in joined:
            plan = read("plan").strip()
            print("Planned operations:")
            print(plan or "  No planned migration operations.")
            return 0
        if "migrate --noinput" in joined:
            if flag("migrate_fail"):
                return 1
            (STATE / "plan").write_text("")
            return 0
        return 1 if flag("run_fail") else 0
    if " up " in f" {joined} ":
        if args[-1] == "db":
            return 0
        (STATE / "running").write_text(release)
        return 1 if flag(f"up_fail_{release}") else 0
    if " ps " in f" {joined} ":
        print("fake-cid")
        return 0
    if " logs " in f" {joined} ":
        print("django log line")
        return 0
    return 0


def aws(args: list[str]) -> int:
    joined = " ".join(args)
    if args[:2] == ["ecr", "get-login-password"]:
        print("fake-password")
        return 0
    if args[:2] == ["ssm", "get-parameters-by-path"]:
        if flag("ssm_fail"):
            return 255
        params = json.loads(read("params.json", "{}"))
        print(json.dumps([[f"/lai/test/django/{name}", value] for name, value in params.items()]))
        return 0
    if args[:2] == ["ssm", "get-parameter"]:
        name = args[args.index("--name") + 1]
        values = json.loads(read("single_params.json", "{}"))
        if name not in values:
            return 255
        print(values[name])
        return 0
    if args[:2] == ["ssm", "put-parameter"]:
        return 0
    if args[:2] == ["secretsmanager", "get-secret-value"]:
        print(read("db_secret.json"))
        return 0
    if args[:2] == ["rds", "create-db-snapshot"] or args[:2] == ["rds", "wait"]:
        return 1 if flag("snapshot_fail") else 0
    # ssm-run.sh (workstation / GitHub side)
    if args[:2] == ["cloudformation", "describe-stacks"]:
        print(read("instance_id", "i-0123456789abcdef0"))
        return 0
    if args[:2] == ["ssm", "describe-instance-information"]:
        print(read("ping", "Online"))
        return 0
    if args[:2] == ["ssm", "send-command"]:
        (STATE / "sent_parameters.json").write_text(args[args.index("--parameters") + 1])
        print("cmd-123")
        return 0
    if args[:2] == ["ssm", "get-command-invocation"]:
        print(read("invocation.json"))
        return 0
    print(f"fake aws: unhandled {joined}", file=sys.stderr)
    return 99


def curl(args: list[str]) -> int:
    running = read("running").strip()
    if not running or flag(f"unhealthy_{running}"):
        return 22
    print('{"status": "ok", "service": "learning-adventure-island"}')
    return 0


def main() -> int:
    command, args = sys.argv[1], sys.argv[2:]
    log([command, *args])
    return {"docker": docker, "aws": aws, "curl": curl}[command](args)


if __name__ == "__main__":
    sys.exit(main())
