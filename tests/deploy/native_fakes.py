"""Fake `aws`, `systemctl`, `nginx`, `curl` and Python for the native release script tests.

Each fake is this file run as a script with its command name as argv[1]; the wrapper scripts the
tests put on PATH bake in FAKE_STATE (the fake's state directory) and FAKE_ROOT (the fake
/opt/lai), because the release scripts run Django commands with a scrubbed environment. Files in
FAKE_STATE decide what each fake answers, and every call is appended to FAKE_STATE/calls.log.
Nothing here touches AWS, systemd, nginx, a database or the network.
"""

import json
import os
import shutil
import stat
import sys
from pathlib import Path

STATE = Path(os.environ["FAKE_STATE"])
ROOT = Path(os.environ["FAKE_ROOT"])
HERE = Path(__file__).resolve()


def flag(name: str) -> bool:
    return (STATE / name).exists()


def read(name: str, default: str = "") -> str:
    path = STATE / name
    return path.read_text() if path.exists() else default


def log(argv: list[str]) -> None:
    with (STATE / "calls.log").open("a") as calls:
        calls.write(" ".join(argv) + "\n")


def single_params() -> dict:
    return json.loads(read("single_params.json", "{}"))


def opt(args: list[str], name: str) -> str:
    return args[args.index(name) + 1]


def wrapper(command: str) -> str:
    return (
        f'#!/bin/sh\nFAKE_STATE="{STATE}" FAKE_ROOT="{ROOT}" '
        f'exec "{sys.executable}" "{HERE}" {command} "$@"\n'
    )


def aws(args: list[str]) -> int:
    if args[:2] == ["ssm", "get-parameter"]:
        values = single_params()
        name = opt(args, "--name")
        if name not in values:
            return 255
        print(values[name])
        return 0
    if args[:2] == ["ssm", "put-parameter"]:
        values = single_params()
        values[opt(args, "--name")] = opt(args, "--value")
        (STATE / "single_params.json").write_text(json.dumps(values))
        return 1 if flag("put_fail") else 0
    if args[:2] == ["ssm", "get-parameters-by-path"]:
        if flag("ssm_fail"):
            return 255
        params = json.loads(read("params.json", "{}"))
        prefix = opt(args, "--path")
        print(json.dumps([[f"{prefix}{name}", value] for name, value in params.items()]))
        return 0
    if args[:2] == ["secretsmanager", "get-secret-value"]:
        print(read("db_secret.json"))
        return 0
    if args[:2] == ["s3", "cp"]:
        source, destination = [a for a in args[2:] if not a.startswith("--")]
        key = source.split("/", 3)[3]
        path = STATE / "bucket" / key
        if not path.exists():
            return 1
        shutil.copyfile(path, destination)
        return 0
    print(f"fake aws: unhandled {' '.join(args)}", file=sys.stderr)
    return 99


def current_release() -> str:
    link = ROOT / "current"
    return Path(os.readlink(link)).name if link.is_symlink() else ""


def systemctl(args: list[str]) -> int:
    args = [a for a in args if a != "--quiet"]
    verb, units = args[0], args[1:]
    if verb in ("start", "restart"):
        for unit in units:
            if flag(f"start_fail_{unit}"):
                return 1
            (STATE / f"stopped_{unit}").unlink(missing_ok=True)
            if unit == "lai-gunicorn.service":
                (STATE / "running").write_text(current_release())
        return 0
    if verb == "stop":
        for unit in units:
            (STATE / f"stopped_{unit}").write_text("")
            if unit == "lai-gunicorn.service":
                (STATE / "running").write_text("")
        return 0
    if verb == "is-active":
        unit = units[0]
        if flag(f"stopped_{unit}") or flag(f"inactive_{unit}"):
            print("inactive")
            return 3
        if unit == "lai-gunicorn.service" and not read("running"):
            print("inactive")
            return 3
        print("active")
        return 0
    return 0


def nginx(args: list[str]) -> int:
    return 1 if "-t" in args and flag("nginx_t_fail") else 0


def curl(args: list[str]) -> int:
    running = read("running").strip()
    if not running or flag(f"unhealthy_{running}"):
        return 22
    print('{"status": "ok", "service": "learning-adventure-island"}')
    return 0


def python(args: list[str]) -> int:
    """The system interpreter: only `-m venv DIR` is used."""
    if args[:2] == ["-m", "venv"]:
        if flag("venv_fail"):
            return 1
        bin_dir = Path(args[2]) / "bin"
        bin_dir.mkdir(parents=True, exist_ok=True)
        fake = bin_dir / "python"
        fake.write_text(wrapper("venvpython"))
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        return 0
    return 99


def venvpython(args: list[str]) -> int:
    """A release venv's interpreter: pip, the database check, and manage.py."""
    env_names = sorted(k for k in os.environ if k not in ("PWD", "SHLVL", "_", "OLDPWD"))
    with (STATE / "env.log").open("a") as env_log:
        env_log.write(" ".join(args[:2]) + " :: " + " ".join(env_names) + "\n")
    if args[:2] == ["-m", "pip"]:
        return 1 if flag("pip_fail") else 0
    if args[0] == "-c":
        return 1 if flag("db_fail") or "DATABASE_URL" not in os.environ else 0
    if args[0] != "manage.py":
        return 99
    command = args[1]
    joined = " ".join(args[1:])
    if command == "check":
        return 1 if flag("check_fail") else 0
    if joined.startswith("migrate --plan"):
        print("Planned operations:")
        print(read("plan").strip() or "  No planned migration operations.")
        return 0
    if command == "migrate":
        if flag("migrate_fail"):
            return 1
        (STATE / "plan").write_text("")
        return 0
    if command == "collectstatic":
        (STATE / "collectstatic_settings").write_text(os.environ.get("DJANGO_SETTINGS_MODULE", ""))
        if "DJANGO_SECRET_KEY" in os.environ:
            return 98  # static files never need a secret
        Path("staticfiles").mkdir(exist_ok=True)
        return 0
    if command == "create_admin_account":
        (STATE / "admin_password_env").write_text(os.environ.get("DJANGO_ADMIN_PASSWORD", ""))
        return 0
    return 1 if flag(f"fail_{command}") else 0


def main() -> int:
    command, args = sys.argv[1], sys.argv[2:]
    log([command, *args])
    handlers = {
        "aws": aws,
        "systemctl": systemctl,
        "nginx": nginx,
        "curl": curl,
        "python": python,
        "venvpython": venvpython,
    }
    return handlers[command](args)


if __name__ == "__main__":
    sys.exit(main())
