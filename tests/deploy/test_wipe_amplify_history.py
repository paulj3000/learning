"""scripts/aws/wipe_amplify_history.py (AMP-08 D4), run against a fake `aws` with fake tables.

The fake keeps DynamoDB tables in a JSON file, so the tests check what was deleted, what was kept,
and that a backup came first. Nothing here touches AWS.
"""

import json
import os
import stat
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/aws/wipe_amplify_history.py"
API = "msc2dcivzjeklbumcf5de5pfyy"
OTHER = "vhinkkredfavbb5jfzypzkry6e"

FAKE = r"""
import json, sys
state_path, log_path = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
state = json.load(open(state_path))
open(log_path, "a").write(" ".join(args[:2]) + "\n")
def arg(name):
    return args[args.index(name) + 1] if name in args else None
def out(value):
    print(json.dumps(value)); json.dump(state, open(state_path, "w")); sys.exit(0)
service, op = args[0], args[1]
tables = state["tables"]
if op == "list-tables":
    out({"TableNames": sorted(tables)})
table = arg("--table-name")
if op == "describe-table":
    out({"Table": {"KeySchema": [{"AttributeName": "id", "KeyType": "HASH"}]}})
if op == "scan":
    items = tables[table]
    if arg("--select") == "COUNT":
        out({"Count": len(items)})
    out({"Items": [{"id": {"S": i}} for i in items]})
if op == "create-backup":
    if state.get("fail_backup"):
        sys.stderr.write("AccessDenied"); sys.exit(255)
    state["backups"].append(table)
    out({"BackupDetails": {"BackupArn": "arn:backup/" + arg("--backup-name")}})
if op == "batch-write-item":
    request = json.loads(arg("--request-items"))
    for name, reqs in request.items():
        for r in reqs:
            tables[name].remove(r["DeleteRequest"]["Key"]["id"]["S"])
    out({"UnprocessedItems": {}})
sys.exit(255)
"""


def setup(tmp_path: Path, *, fail_backup: bool = False) -> dict:
    tables = {
        f"AdventureSession-{API}-NONE": [f"s{i}" for i in range(30)],
        f"WorldChange-{API}-NONE": ["w1", "w2"],
        f"SkillProgress-{API}-NONE": [],
        f"ParentProfile-{API}-NONE": ["p1", "p2"],
        f"ChildProfile-{API}-NONE": ["c1"],
        f"AIInteractionAudit-{API}-NONE": ["a1"],
        f"SafetyEvent-{API}-NONE": ["e1"],
        f"AdventureSession-{OTHER}-NONE": ["x1"],
    }
    state = tmp_path / "state.json"
    state.write_text(json.dumps({"tables": tables, "backups": [], "fail_backup": fail_backup}))
    log = tmp_path / "calls.log"
    fake = tmp_path / "fake_aws.py"
    fake.write_text(FAKE)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    wrapper = bin_dir / "aws"
    wrapper.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{fake}" "{state}" "{log}" "$@"\n')
    wrapper.chmod(wrapper.stat().st_mode | stat.S_IEXEC)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    return {"env": env, "state": state, "log": log}


def run(ctx: dict, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(  # noqa: S603
        [sys.executable, str(SCRIPT), *args],
        env=ctx["env"],
        capture_output=True,
        text=True,
        timeout=60,
    )


def state(ctx: dict) -> dict:
    return json.loads(ctx["state"].read_text())


def test_dry_run_counts_and_changes_nothing(tmp_path):
    ctx = setup(tmp_path)
    result = run(ctx, API)
    assert result.returncode == 0, result.stdout
    assert f"items AdventureSession-{API}-NONE: 30" in result.stdout
    assert "33 items would be deleted; nothing was changed" in result.stdout
    after = state(ctx)
    assert len(after["tables"][f"AdventureSession-{API}-NONE"]) == 30
    assert after["backups"] == []
    ops = {line.split()[1] for line in ctx["log"].read_text().splitlines()}
    assert ops <= {"list-tables", "scan"}


def test_confirmed_run_backs_up_then_deletes_history_only(tmp_path):
    ctx = setup(tmp_path)
    result = run(ctx, API, "--confirm-delete", API)
    assert result.returncode == 0, result.stdout
    after = state(ctx)["tables"]
    assert after[f"AdventureSession-{API}-NONE"] == []  # 30 items, two batches of 25
    assert after[f"WorldChange-{API}-NONE"] == []
    assert after[f"ParentProfile-{API}-NONE"] == ["p1", "p2"]
    assert after[f"ChildProfile-{API}-NONE"] == ["c1"]
    assert after[f"AIInteractionAudit-{API}-NONE"] == []  # owner decision: wiped too
    assert after[f"SafetyEvent-{API}-NONE"] == ["e1"]
    assert after[f"AdventureSession-{OTHER}-NONE"] == ["x1"]  # another backend is untouched
    assert set(state(ctx)["backups"]) == {
        f"AdventureSession-{API}-NONE",
        f"WorldChange-{API}-NONE",
        f"SkillProgress-{API}-NONE",
        f"AIInteractionAudit-{API}-NONE",
    }
    calls = [line.split()[1] for line in ctx["log"].read_text().splitlines()]
    assert calls.index("batch-write-item") > max(
        i for i, op in enumerate(calls) if op == "create-backup"
    )
    assert "deleted 33 items; tables still holding items: none" in result.stdout


def test_a_failed_backup_stops_before_any_delete(tmp_path):
    ctx = setup(tmp_path, fail_backup=True)
    result = run(ctx, API, "--confirm-delete", API)
    assert result.returncode == 1
    assert "Stopped: AccessDenied" in result.stdout
    assert len(state(ctx)["tables"][f"AdventureSession-{API}-NONE"]) == 30


def test_the_confirmation_must_repeat_the_api_id(tmp_path):
    ctx = setup(tmp_path)
    result = run(ctx, API, "--confirm-delete", OTHER)
    assert result.returncode == 2
    assert len(state(ctx)["tables"][f"AdventureSession-{API}-NONE"]) == 30
    assert run(ctx, "not-an-api").returncode == 2
