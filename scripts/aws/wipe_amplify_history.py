#!/usr/bin/env python3
"""Wipe the play history from one Amplify Data backend's DynamoDB tables (AMP-08, decision D4).

Owner decision 2026-11-11: the children's play history in the Amplify sandbox is not carried into
Django, and is wiped. Profiles are kept (they are what `import_amplify_profiles` imports), and so
are companion choices and the AI audit and safety records (their retention is a separate
decision). Runbook: docs/platform/AMPLIFY_DECOMMISSION.md, section 4, D4.

    scripts/aws/wipe_amplify_history.py <appsync api id>                      # dry run: counts only
    scripts/aws/wipe_amplify_history.py <api id> --confirm-delete <api id>    # backup, then delete

Guards:
- only tables named `<Model>-<api id>-NONE` for the models in HISTORY_MODELS are touched;
- the dry run is the default; deleting needs the api id typed a second time;
- before deleting, every table gets an on-demand backup (`amp08-wipe-<model>-<UTC time>`), and
  the run stops if a backup fails; restore one with `aws dynamodb restore-table-from-backup`;
- it prints counts only, never item contents.

Uses the AWS CLI on PATH with your current credentials and AWS_REGION (default us-west-1).
"""

import json
import os
import re
import subprocess  # noqa: S404 - runs the AWS CLI only, with fixed arguments
import sys
from datetime import UTC, datetime

HISTORY_MODELS = (
    "AdventureSession",
    "AdventureAction",
    "SkillEvidence",
    "SkillProgress",
    "WorldChange",
    "ChildQuestState",
    "ChildWorldState",
    "ChildInventory",
    "ChildNpcState",
    "ChildStoryProgress",
    "StoryArtifact",
    "CoopSession",
)
KEPT_MODELS = (
    "ParentProfile",
    "ChildProfile",
    "CompanionProfile",
    "AIInteractionAudit",
    "SafetyEvent",
)
API_ID = re.compile(r"^[a-z0-9]{26}$")
BATCH = 25


class AwsError(RuntimeError):
    pass


def aws(*args: str) -> dict:
    region = os.environ.get("AWS_REGION", "us-west-1")
    result = subprocess.run(  # noqa: S603
        ["aws", *args, "--region", region, "--output", "json"],  # noqa: S607
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AwsError(result.stderr.strip() or f"aws {args[0]} {args[1]} failed")
    return json.loads(result.stdout) if result.stdout.strip() else {}


def table_name(model: str, api_id: str) -> str:
    return f"{model}-{api_id}-NONE"


def key_names(table: str) -> list[str]:
    schema = aws("dynamodb", "describe-table", "--table-name", table)["Table"]["KeySchema"]
    return [entry["AttributeName"] for entry in schema]


def all_keys(table: str, keys: list[str]) -> list[dict]:
    """Every item's key attributes only (a projection), across pages."""
    names = {f"#k{i}": name for i, name in enumerate(keys)}
    found: list[dict] = []
    start: dict | None = None
    while True:
        args = [
            "dynamodb",
            "scan",
            "--table-name",
            table,
            "--projection-expression",
            ", ".join(names),
            "--expression-attribute-names",
            json.dumps(names),
        ]
        if start:
            args += ["--exclusive-start-key", json.dumps(start)]
        page = aws(*args)
        found.extend(page.get("Items", []))
        start = page.get("LastEvaluatedKey")
        if not start:
            return found


def count(table: str) -> int:
    total, start = 0, None
    while True:
        args = ["dynamodb", "scan", "--table-name", table, "--select", "COUNT"]
        if start:
            args += ["--exclusive-start-key", json.dumps(start)]
        page = aws(*args)
        total += int(page.get("Count", 0))
        start = page.get("LastEvaluatedKey")
        if not start:
            return total


def delete_all(table: str, items: list[dict]) -> int:
    deleted = 0
    for offset in range(0, len(items), BATCH):
        pending = [{"DeleteRequest": {"Key": key}} for key in items[offset : offset + BATCH]]
        for _attempt in range(8):
            reply = aws(
                "dynamodb",
                "batch-write-item",
                "--request-items",
                json.dumps({table: pending}),
            )
            left = reply.get("UnprocessedItems", {}).get(table, [])
            deleted += len(pending) - len(left)
            if not left:
                break
            pending = left
        else:
            raise AwsError(f"{table}: {len(pending)} deletes still unprocessed after retries")
    return deleted


def main(argv: list[str]) -> int:
    if not argv or not API_ID.match(argv[0]):
        print("usage: wipe_amplify_history.py <appsync api id> [--confirm-delete <api id>]")
        return 2
    api_id = argv[0]
    confirm = argv[2] if len(argv) == 3 and argv[1] == "--confirm-delete" else None
    if len(argv) not in (1, 3) or (len(argv) == 3 and confirm is None):
        print("usage: wipe_amplify_history.py <appsync api id> [--confirm-delete <api id>]")
        return 2
    if confirm is not None and confirm != api_id:
        print("--confirm-delete must repeat the same api id; nothing was changed.")
        return 2

    existing = set(aws("dynamodb", "list-tables").get("TableNames", []))
    tables = [(m, table_name(m, api_id)) for m in HISTORY_MODELS]
    missing = [t for _, t in tables if t not in existing]
    present = [(m, t) for m, t in tables if t in existing]
    if not present:
        print(f"No history tables for api {api_id} in this region; nothing to do.")
        return 1

    mode = "DELETE" if confirm else "dry run"
    print(f"== Amplify play history wipe ({mode}), api {api_id}")
    print("Kept, never touched: " + ", ".join(table_name(m, api_id) for m in KEPT_MODELS))
    for table in missing:
        print(f"skip  {table}: not found")

    counts = {table: count(table) for _, table in present}
    for _, table in present:
        print(f"items {table}: {counts[table]}")
    if not confirm:
        print(f"== dry run: {sum(counts.values())} items would be deleted; nothing was changed.")
        print(f"   To delete: {sys.argv[0]} {api_id} --confirm-delete {api_id}")
        return 0

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    for model, table in present:
        backup = aws(
            "dynamodb",
            "create-backup",
            "--table-name",
            table,
            "--backup-name",
            f"amp08-wipe-{model}-{stamp}",
        )
        print(f"backup {table}: {backup['BackupDetails']['BackupArn']}")

    total = 0
    for _, table in present:
        if counts[table] == 0:
            print(f"deleted {table}: 0 (already empty)")
            continue
        deleted = delete_all(table, all_keys(table, key_names(table)))
        total += deleted
        print(f"deleted {table}: {deleted}")
    remaining = {table: count(table) for _, table in present}
    left = {t: n for t, n in remaining.items() if n}
    print(f"== deleted {total} items; tables still holding items: {left or 'none'}")
    return 0 if not left else 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except AwsError as error:
        print(f"Stopped: {error}")
        sys.exit(1)
