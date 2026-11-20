#!/usr/bin/env python3
"""The integration agent's EC2 unit-test command (docs/infrastructure/aws-ec2-unit-tests.md).

    python3 scripts/ci/aws_ci.py run    [--scope affected|full-unit] [--push]   # all of the below
    python3 scripts/ci/aws_ci.py submit [--scope ...] [--push] [--request-id ID]
    python3 scripts/ci/aws_ci.py watch  [REQUEST_ID]
    python3 scripts/ci/aws_ci.py fetch  [REQUEST_ID]
    python3 scripts/ci/aws_ci.py gate   [REQUEST_ID]
    python3 scripts/ci/aws_ci.py list

`submit` tests the committed HEAD of the current branch, never the working tree: it refuses
uncommitted changes, pushes with --push (otherwise refuses an unpushed HEAD), records the exact
SHA, dispatches `aws-integration-tests.yml` with `gh workflow run`, and finds the run by the
request id the workflow puts in its run name. `gate` is the merge decision; it is MERGE-OK only
when the run succeeded, the results verify for that SHA, and the branch still points at the
tested source (a later commit with a different tree invalidates the result).

Records live in <git common dir>/lai-ci/<request id>/ (shared by all worktrees, never committed).
REQUEST_ID defaults to the newest record for the current branch.

Exit codes (gate and run): 0 MERGE-OK; 1 BLOCKED, tests failed; 2 BLOCKED, incomplete (missing,
blocked, cancelled, timed out or infrastructure failure); 3 BLOCKED, stale (source changed after
the test); 4 usage or tool error.
"""

from __future__ import annotations

import argparse
import json
import re
import secrets
import shutil
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ci_results  # noqa: E402

WORKFLOW = "aws-integration-tests.yml"
DEFAULT_REPO = "paulj3000/learning"
ALLOWED_BRANCH = re.compile(r"^(main|integration/[A-Za-z0-9._/-]+|ci/[A-Za-z0-9._/-]+)$")
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
EXIT = {"MERGE-OK": 0, "FAIL": 1, "INCOMPLETE": 2, "STALE": 3, "ERROR": 4}
FIND_TIMEOUT = 180
WATCH_TIMEOUT = 4 * 3600


class ToolError(RuntimeError):
    """gh or git is missing or failed; the decision cannot be made."""


class Runner(Protocol):
    def __call__(self, cmd: list[str], cwd: Path | None = None) -> tuple[int, str, str]: ...


def default_runner(cmd: list[str], cwd: Path | None = None) -> tuple[int, str, str]:
    if shutil.which(cmd[0]) is None:
        raise ToolError(f"{cmd[0]} is not installed (see the runbook: install and `gh auth login`)")
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)  # noqa: S603
    return proc.returncode, proc.stdout, proc.stderr


@dataclass
class Ctx:
    repo: str
    remote: str
    cwd: Path
    run: Runner
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic
    out: Callable[[str], None] = print

    def sh(self, *cmd: str, ok: tuple[int, ...] = (0,)) -> str:
        code, stdout, stderr = self.run(list(cmd), self.cwd)
        if code not in ok:
            raise ToolError(f"{' '.join(cmd[:4])} failed ({code}): {stderr.strip()[-600:]}")
        return stdout.strip()

    def gh_json(self, *args: str) -> Any:
        text = self.sh("gh", *args)
        try:
            return json.loads(text or "null")
        except json.JSONDecodeError as exc:
            raise ToolError(f"gh returned invalid JSON for {args[:2]}") from exc

    def state_root(self) -> Path:
        common = Path(self.sh("git", "rev-parse", "--path-format=absolute", "--git-common-dir"))
        return common / "lai-ci"


# --------------------------------------------------------------------------- records


def now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def record_dir(ctx: Ctx, request_id: str) -> Path:
    if not REQUEST_ID_RE.match(request_id):
        raise ToolError(f"invalid request id {request_id!r}")
    return ctx.state_root() / request_id


def save(ctx: Ctx, record: dict[str, Any]) -> None:
    path = record_dir(ctx, record["request_id"])
    path.mkdir(parents=True, exist_ok=True)
    (path / "record.json").write_text(json.dumps(record, indent=2) + "\n")


def load(ctx: Ctx, request_id: str | None) -> dict[str, Any]:
    if request_id is None:
        branch = current_branch(ctx)
        records = [r for r in all_records(ctx) if r.get("branch") == branch]
        if not records:
            raise ToolError(f"no EC2 test record for branch {branch}; run `submit` first")
        return records[-1]
    path = record_dir(ctx, request_id) / "record.json"
    if not path.is_file():
        raise ToolError(f"no record for request {request_id}")
    return json.loads(path.read_text())


def all_records(ctx: Ctx) -> list[dict[str, Any]]:
    root = ctx.state_root()
    records = []
    for path in root.glob("*/record.json") if root.is_dir() else []:
        try:
            records.append(json.loads(path.read_text()))
        except json.JSONDecodeError:
            continue
    return sorted(records, key=lambda r: r.get("dispatched_at", ""))


# --------------------------------------------------------------------------- git


def current_branch(ctx: Ctx) -> str:
    branch = ctx.sh("git", "rev-parse", "--abbrev-ref", "HEAD")
    if branch == "HEAD":
        raise ToolError("detached HEAD: check out the integration branch")
    return branch


def remote_head(ctx: Ctx, branch: str) -> str:
    out = ctx.sh("git", "ls-remote", ctx.remote, f"refs/heads/{branch}")
    sha = out.split()[0] if out else ""
    if not ci_results.SHA_RE.match(sha):
        raise ToolError(f"branch {branch} is not on {ctx.remote}")
    return sha


def tree_of(ctx: Ctx, sha: str) -> str | None:
    code, out, _ = ctx.run(["git", "rev-parse", f"{sha}^{{tree}}"], ctx.cwd)
    return out.strip() if code == 0 else None


def prepare_commit(ctx: Ctx, push: bool) -> tuple[str, str]:
    """(branch, sha) of a committed, pushed HEAD; refuses anything else."""
    branch = current_branch(ctx)
    if not ALLOWED_BRANCH.match(branch):
        raise ToolError(f"branch {branch} is not integration/*, ci/* or main")
    dirty = ctx.sh("git", "status", "--porcelain", "--untracked-files=no")
    if dirty:
        raise ToolError("uncommitted changes: commit them first; only committed source is tested")
    sha = ctx.sh("git", "rev-parse", "HEAD")
    ctx.sh("git", "fetch", "-q", ctx.remote, branch, ok=(0, 128))
    try:
        pushed = remote_head(ctx, branch)
    except ToolError:
        pushed = ""
    if pushed != sha:
        if pushed:
            code, _, _ = ctx.run(["git", "merge-base", "--is-ancestor", pushed, sha], ctx.cwd)
            if code != 0:
                raise ToolError(f"{branch} on {ctx.remote} has commits HEAD lacks; pull first")
        if not push:
            raise ToolError(f"HEAD {sha[:12]} is not pushed; rerun with --push")
        ctx.sh("git", "push", ctx.remote, f"HEAD:refs/heads/{branch}")
        if remote_head(ctx, branch) != sha:
            raise ToolError("push did not land")
        ctx.out(f"pushed {branch} at {sha}")
    return branch, sha


# --------------------------------------------------------------------------- GitHub


def new_request_id(sha: str) -> str:
    return f"ci-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}-{sha[:8]}-{secrets.token_hex(2)}"


def dispatch(ctx: Ctx, branch: str, sha: str, scope: str, request_id: str) -> None:
    ctx.sh(
        "gh",
        "workflow",
        "run",
        WORKFLOW,
        "--repo",
        ctx.repo,
        "--ref",
        branch,
        "-f",
        f"commit_sha={sha}",
        "-f",
        f"test_scope={scope}",
        "-f",
        f"request_id={request_id}",
    )


def find_run(ctx: Ctx, branch: str, request_id: str, timeout: float = FIND_TIMEOUT) -> dict:
    """The run whose name carries `[request_id]` (set by the workflow's run-name)."""
    marker = f"[{request_id}]"
    deadline = ctx.clock() + timeout
    while True:
        runs = ctx.gh_json(
            "run",
            "list",
            "--repo",
            ctx.repo,
            "--workflow",
            WORKFLOW,
            "--branch",
            branch,
            "--event",
            "workflow_dispatch",
            "--limit",
            "50",
            "--json",
            "databaseId,displayTitle,status,conclusion,url,createdAt",
        )
        matching = [r for r in runs or [] if marker in r.get("displayTitle", "")]
        if len(matching) > 1:
            raise ToolError(f"{len(matching)} runs carry request id {request_id}")
        if matching:
            return matching[0]
        if ctx.clock() >= deadline:
            raise ToolError(f"no run appeared for request {request_id} within {timeout:.0f}s")
        ctx.sleep(5)


def view_run(ctx: Ctx, run_id: int) -> dict:
    return ctx.gh_json(
        "run",
        "view",
        str(run_id),
        "--repo",
        ctx.repo,
        "--json",
        "status,conclusion,url,displayTitle,jobs",
    )


# --------------------------------------------------------------------------- commands


def cmd_submit(ctx: Ctx, scope: str, push: bool, request_id: str | None) -> dict[str, Any]:
    branch, sha = prepare_commit(ctx, push)
    request_id = request_id or new_request_id(sha)
    if not REQUEST_ID_RE.match(request_id):
        raise ToolError("request id may use letters, digits, . _ - (64 max)")
    record = {
        "request_id": request_id,
        "repo": ctx.repo,
        "branch": branch,
        "commit_sha": sha,
        "tree_sha": tree_of(ctx, sha),
        "scope": scope,
        "dispatched_at": now(),
        "run_id": None,
        "run_url": None,
        "status": "dispatching",
    }
    save(ctx, record)
    dispatch(ctx, branch, sha, scope, request_id)
    run = find_run(ctx, branch, request_id)
    record.update(run_id=run["databaseId"], run_url=run["url"], status=run["status"])
    save(ctx, record)
    ctx.out(f"request {request_id}: testing {sha} ({scope}) on {branch}")
    ctx.out(f"run {run['databaseId']}: {run['url']}")
    return record


def cmd_watch(ctx: Ctx, record: dict[str, Any], timeout: float = WATCH_TIMEOUT) -> dict[str, Any]:
    if not record.get("run_id"):
        run = find_run(ctx, record["branch"], record["request_id"])
        record.update(run_id=run["databaseId"], run_url=run["url"])
    deadline = ctx.clock() + timeout
    last = None
    while True:
        view = view_run(ctx, record["run_id"])
        status = view.get("status")
        if status != last:
            ctx.out(f"run {record['run_id']}: {status}")
            if status == "waiting":
                ctx.out("  waiting for an approval on the lai-ci environment")
            last = status
        if status == "completed":
            record.update(status="completed", conclusion=view.get("conclusion"))
            break
        if ctx.clock() >= deadline:
            record.update(status=status, conclusion="watch-timed-out")
            break
        ctx.sleep(30)
    save(ctx, record)
    ctx.out(f"run {record['run_id']}: {record.get('conclusion')}")
    return record


def cmd_fetch(ctx: Ctx, record: dict[str, Any]) -> Path:
    dest = record_dir(ctx, record["request_id"]) / "artifact"
    if dest.exists():
        shutil.rmtree(dest)
    ctx.sh(
        "gh",
        "run",
        "download",
        str(record["run_id"]),
        "--repo",
        ctx.repo,
        "--name",
        f"lai-ci-results-{record['request_id']}",
        "--dir",
        str(dest),
    )
    return dest


def decide(ctx: Ctx, record: dict[str, Any], artifact: Path | None) -> dict[str, Any]:
    """The merge decision for one record, with every reason."""
    sha = record["commit_sha"]
    reasons: list[str] = []
    decision = "MERGE-OK"
    doc: dict[str, Any] = {}
    verdict = "incomplete"
    if record.get("conclusion") != "success":
        reasons.append(
            f"workflow run conclusion: {record.get('conclusion') or record.get('status')}"
        )
    results = artifact / "results" / "results.json" if artifact else None
    try:
        if results is None:
            raise ci_results.ResultsError("no results artifact")
        doc = ci_results.load(results)
        verdict, why = ci_results.verify(
            doc, commit_sha=sha, scope=record.get("scope"), tree_sha=record.get("tree_sha")
        )
        reasons += why
    except ci_results.ResultsError as exc:
        reasons.append(str(exc))
        if artifact and (artifact / "rejected.txt").is_file():
            reasons.append((artifact / "rejected.txt").read_text().strip())
    if verdict == "fail":
        decision = "FAIL"
    elif verdict != "pass" or reasons:
        decision = "INCOMPLETE"

    head = remote_head(ctx, record["branch"])
    stale = head != sha
    if stale and record.get("tree_sha") and tree_of(ctx, head) == record["tree_sha"]:
        stale = False
        reasons.append(f"branch moved to {head[:12]} with an identical tree; result still applies")
    if stale:
        reasons.append(
            f"STALE: {record['branch']} is now {head[:12]}, tested {sha[:12]}; run the tests again"
        )
        if decision == "MERGE-OK":
            decision = "STALE"
    return {
        "decision": decision,
        "tested_commit": sha,
        "tested_tree": doc.get("tree_sha") or record.get("tree_sha"),
        "branch": record["branch"],
        "branch_head": head,
        "scope": record.get("scope"),
        "request_id": record["request_id"],
        "run_url": record.get("run_url"),
        "verdict": verdict,
        "reasons": reasons,
        "suites": [
            {k: s.get(k) for k in ("name", "status", "reason", "counts", "duration_s")}
            for s in doc.get("suites", [])
        ],
        "failures": failure_report(ctx, sha, doc),
        "decided_at": now(),
    }


def failure_report(ctx: Ctx, sha: str, doc: dict[str, Any]) -> list[dict[str, Any]]:
    """Failing tests with the last commit that touched each file: who to send the fix to."""
    report = []
    for suite in doc.get("suites", []):
        for failure in suite.get("failures", []):
            path = failure.get("file", "")
            if path.startswith("../"):
                path = path[3:]
            elif suite.get("cwd") in ("react", "game") and path and not path.startswith("lai/"):
                path = f"{suite['cwd']}/{path}"
            last = ""
            if path:
                code, out, _ = ctx.run(
                    ["git", "log", "-1", "--format=%h %an: %s", sha, "--", path], ctx.cwd
                )
                last = out.strip() if code == 0 else ""
            report.append(
                {
                    "suite": suite.get("name"),
                    "test": failure.get("id"),
                    "file": path,
                    "last_change": last,
                    "message": failure.get("message", ""),
                    "excerpt": "\n".join(failure.get("excerpt", "").splitlines()[:15]),
                }
            )
        if suite.get("status") in ("blocked", "error", "timed_out"):
            report.append(
                {
                    "suite": suite.get("name"),
                    "test": f"(suite {suite.get('status')})",
                    "file": "",
                    "last_change": "",
                    "message": suite.get("reason", ""),
                    "excerpt": "\n".join((suite.get("log_tail") or "").splitlines()[-15:]),
                }
            )
    return report


def render(decision: dict[str, Any]) -> str:
    lines = [
        f"EC2 unit tests: {decision['decision']}"
        + ("" if decision["decision"] == "MERGE-OK" else " (merge blocked)"),
        f"  tested commit {decision['tested_commit']} (tree {decision['tested_tree']})",
        f"  branch {decision['branch']} now at {decision['branch_head']}",
        f"  scope {decision['scope']}; request {decision['request_id']}; {decision['run_url']}",
    ]
    for suite in decision["suites"]:
        c = suite.get("counts") or {}
        lines.append(
            f"  - {suite['name']}: {suite['status']} "
            f"({c.get('passed', 0)} passed, {c.get('failed', 0)} failed, "
            f"{c.get('errors', 0)} errors, {c.get('skipped', 0)} skipped) "
            f"{suite.get('reason') or ''}"
        )
    for reason in decision["reasons"]:
        lines.append(f"  ! {reason}")
    for failure in decision["failures"][:30]:
        lines.append(f"  x [{failure['suite']}] {failure['test']}")
        if failure["file"]:
            lines.append(f"      file {failure['file']}; last change {failure['last_change']}")
        for text in failure["excerpt"].splitlines()[:8]:
            lines.append(f"      | {text}")
    return "\n".join(lines)


def cmd_gate(ctx: Ctx, record: dict[str, Any], artifact: Path | None = None) -> int:
    if artifact is None:
        candidate = record_dir(ctx, record["request_id"]) / "artifact"
        artifact = candidate if candidate.is_dir() else None
    decision = decide(ctx, record, artifact)
    path = record_dir(ctx, record["request_id"])
    (path / "decision.json").write_text(json.dumps(decision, indent=2) + "\n")
    text = render(decision)
    (path / "report.txt").write_text(text + "\n")
    ctx.out(text)
    ctx.out(f"report: {path / 'report.txt'}")
    return EXIT[decision["decision"]]


def cmd_run(ctx: Ctx, scope: str, push: bool, request_id: str | None) -> int:
    record = cmd_submit(ctx, scope, push, request_id)
    record = cmd_watch(ctx, record)
    artifact = None
    if record.get("conclusion") in ("success", "failure"):
        try:
            artifact = cmd_fetch(ctx, record)
        except ToolError as exc:
            ctx.out(f"could not download the results: {exc}")
    return cmd_gate(ctx, record, artifact)


def main(argv: list[str] | None = None, ctx: Ctx | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--remote", default="origin")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("run", "submit"):
        p = sub.add_parser(name)
        p.add_argument("--scope", choices=ci_results.SCOPES, default="affected")
        p.add_argument("--push", action="store_true", help="push an unpushed HEAD first")
        p.add_argument("--request-id")
    for name in ("watch", "fetch", "gate"):
        sub.add_parser(name).add_argument("request_id", nargs="?")
    sub.add_parser("list")
    args = parser.parse_args(argv)
    ctx = ctx or Ctx(repo=args.repo, remote=args.remote, cwd=Path.cwd(), run=default_runner)
    try:
        if args.command == "run":
            return cmd_run(ctx, args.scope, args.push, args.request_id)
        if args.command == "submit":
            cmd_submit(ctx, args.scope, args.push, args.request_id)
            return 0
        if args.command == "list":
            for r in all_records(ctx):
                ctx.out(
                    f"{r['request_id']}  {r['branch']}  {r['commit_sha'][:12]}  {r['scope']}  "
                    f"{r.get('conclusion') or r.get('status')}  {r.get('run_url') or ''}"
                )
            return 0
        record = load(ctx, args.request_id)
        if args.command == "watch":
            cmd_watch(ctx, record)
            return 0
        if args.command == "fetch":
            ctx.out(str(cmd_fetch(ctx, record)))
            return 0
        return cmd_gate(ctx, record)
    except ToolError as exc:
        ctx.out(f"error: {exc}")
        return EXIT["ERROR"]


if __name__ == "__main__":
    sys.exit(main())
