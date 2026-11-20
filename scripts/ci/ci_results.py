#!/usr/bin/env python3
"""LAI CI unit-test results: the schema, the verdict, and the merge-gate check.

One module is used by every side of the EC2 unit-test system
(docs/infrastructure/aws-ec2-unit-tests.md): the runner on the instance writes `results.json`
with `new_results` / `finish_results`, the GitHub workflow checks it with `verify`, and the
integration agent's `aws_ci.py` gates a merge on it.

The verdict is always recomputed from the suites; a stored `verdict` field is informational only.
Anything missing, malformed or ambiguous is `incomplete`, never `pass` (fail closed).

Standard library only: it runs on the GitHub runner, the EC2 instance and the development host.

    python3 scripts/ci/ci_results.py verify results.json --commit <sha> [--scope affected|full-unit]
        [--tree <tree sha>] [--summary out.md] [--json]
Exit codes: 0 pass, 1 fail (tests failed), 2 incomplete (results missing, blocked or invalid).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

SCHEMA = "lai-ci-results/1"
SCOPES = ("affected", "full-unit")
SUITE_STATUSES = ("passed", "failed", "error", "blocked", "timed_out")
VERDICTS = ("pass", "fail", "incomplete")
EXIT_CODES = {"pass": 0, "fail": 1, "incomplete": 2}
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
MAX_FAILURES_PER_SUITE = 50
EXCERPT_LINES = 40


class ResultsError(ValueError):
    """The results document is missing, malformed or does not match the request."""


# --------------------------------------------------------------------------- JUnit parsing


def parse_junit(path: Path) -> dict[str, Any]:
    """Counts and failure excerpts from a pytest or Vitest JUnit XML file.

    Raises ResultsError when the file is missing or not JUnit, so a suite whose report is absent is
    never counted as passed.
    """
    if not path.is_file():
        raise ResultsError(f"JUnit report missing: {path.name}")
    try:
        root = ET.parse(path).getroot()  # noqa: S314 - our own test report, not untrusted input
    except ET.ParseError as exc:
        raise ResultsError(f"JUnit report unreadable: {path.name}: {exc}") from exc
    if root.tag == "testsuites":
        suites = list(root.iter("testsuite"))
    elif root.tag == "testsuite":
        suites = [root]
    else:
        raise ResultsError(f"not a JUnit report: {path.name}")

    counts = {"total": 0, "passed": 0, "failed": 0, "errors": 0, "skipped": 0}
    failures: list[dict[str, str]] = []
    for suite in suites:
        for case in suite.iter("testcase"):
            counts["total"] += 1
            outcome = "passed"
            detail = None
            for child in case:
                if child.tag == "failure":
                    outcome, detail = "failed", child
                elif child.tag == "error":
                    outcome, detail = "errors", child
                elif child.tag == "skipped" and outcome == "passed":
                    outcome = "skipped"
            counts[outcome] += 1
            if detail is not None and len(failures) < MAX_FAILURES_PER_SUITE:
                name = case.get("name", "")
                classname = case.get("classname", "")
                text = (detail.text or "").strip().splitlines()
                failures.append(
                    {
                        "id": f"{classname}::{name}" if classname else name,
                        "file": case.get("file", "") or _file_from_classname(classname),
                        "kind": "failure" if detail.tag == "failure" else "error",
                        "message": (detail.get("message") or "").strip()[:500],
                        "excerpt": "\n".join(text[:EXCERPT_LINES]),
                    }
                )
    return {"counts": counts, "failures": failures}


def _file_from_classname(classname: str) -> str:
    # pytest: "lai.apps.scoring.tests.test_realms" -> "lai/apps/scoring/tests/test_realms.py"
    if classname and "/" not in classname and "." in classname:
        parts = classname.split(".")
        while parts and not parts[-1].startswith("test_"):
            parts.pop()
        if parts:
            return "/".join(parts) + ".py"
    return classname


# --------------------------------------------------------------------------- suite status


def suite_status(
    *,
    exit_code: int | None,
    junit: dict[str, Any] | None,
    allow_empty: bool = False,
    blocked_reason: str | None = None,
    timed_out: bool = False,
) -> tuple[str, str]:
    """(status, reason) for one executed suite. Fail closed on every ambiguity."""
    if blocked_reason:
        return "blocked", blocked_reason
    if timed_out:
        return "timed_out", "the suite exceeded its time budget"
    if junit is None:
        return "error", f"no JUnit report (exit code {exit_code})"
    counts = junit["counts"]
    if counts["failed"] or counts["errors"]:
        return "failed", f"{counts['failed']} failed, {counts['errors']} errors"
    if exit_code != 0:
        return "error", f"exit code {exit_code} with no failing test in the report"
    if counts["total"] == 0 and not allow_empty:
        return "error", "no tests ran"
    if counts["total"] == counts["skipped"] and counts["total"] and not allow_empty:
        return "error", "every test was skipped"
    return "passed", ""


# --------------------------------------------------------------------------- documents


def new_results(request: dict[str, Any]) -> dict[str, Any]:
    """A results document for a request; suites are added as they run."""
    return {
        "schema": SCHEMA,
        "request": request,
        "commit_sha": request["commit_sha"],
        "tree_sha": None,
        "base_sha": request.get("base_sha"),
        "scope": request["scope"],
        "preflight": {"ok": False, "checks": []},
        "plan": None,
        "suites": [],
        "harness_error": None,
        "started_at": None,
        "finished_at": None,
        "verdict": "incomplete",
        "complete": False,
    }


def compute_verdict(doc: dict[str, Any]) -> tuple[str, list[str]]:
    """(verdict, reasons). `pass` only when every planned suite ran and passed."""
    reasons: list[str] = []
    if doc.get("schema") != SCHEMA:
        return "incomplete", [f"unknown results schema: {doc.get('schema')!r}"]
    if doc.get("harness_error"):
        reasons.append(f"harness error: {doc['harness_error']}")
    preflight = doc.get("preflight") or {}
    if not preflight.get("ok"):
        failed = [c.get("name", "?") for c in preflight.get("checks", []) if not c.get("ok")]
        reasons.append("preflight failed: " + (", ".join(failed) or "not run"))
    plan = doc.get("plan")
    if not isinstance(plan, dict) or not isinstance(plan.get("suites"), list):
        reasons.append("no test plan")
        return "incomplete", reasons
    if not plan["suites"]:
        reasons.append("the test plan is empty")
    if not doc.get("tree_sha"):
        reasons.append("tested tree SHA not recorded")

    ran = {s.get("name"): s for s in doc.get("suites", []) if isinstance(s, dict)}
    failed = False
    for planned in plan["suites"]:
        name = planned.get("name")
        suite = ran.get(name)
        if suite is None:
            reasons.append(f"{name}: did not run")
            continue
        status = suite.get("status")
        if status == "failed":
            failed = True
            reasons.append(f"{name}: failed ({suite.get('reason', '')})")
        elif status != "passed":
            reasons.append(f"{name}: {status} ({suite.get('reason', '')})")
    if failed:
        return "fail", reasons
    return ("incomplete", reasons) if reasons else ("pass", [])


def finish_results(doc: dict[str, Any]) -> dict[str, Any]:
    verdict, reasons = compute_verdict(doc)
    doc["verdict"] = verdict
    doc["verdict_reasons"] = reasons
    doc["complete"] = is_complete(doc)
    return doc


def is_complete(doc: dict[str, Any]) -> bool:
    """Every planned suite reached a definite result (passed or failed) on a verified setup."""
    plan = doc.get("plan")
    if doc.get("harness_error") or not (doc.get("preflight") or {}).get("ok"):
        return False
    if not doc.get("tree_sha") or not isinstance(plan, dict) or not plan.get("suites"):
        return False
    ran = {s.get("name"): s.get("status") for s in doc.get("suites", [])}
    return all(ran.get(p.get("name")) in ("passed", "failed") for p in plan["suites"])


def load(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ResultsError(f"results file missing: {path}")
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ResultsError(f"results file unreadable: {exc}") from exc
    if not isinstance(doc, dict):
        raise ResultsError("results file is not a JSON object")
    return doc


def verify(
    doc: dict[str, Any], *, commit_sha: str, scope: str | None = None, tree_sha: str | None = None
) -> tuple[str, list[str]]:
    """The merge-gate check of one results document against the request it should answer."""
    if not SHA_RE.match(commit_sha or ""):
        raise ResultsError(f"expected commit SHA is not a full 40-character SHA: {commit_sha!r}")
    problems: list[str] = []
    if doc.get("commit_sha") != commit_sha:
        problems.append(
            f"results are for commit {doc.get('commit_sha')!r}, not the requested {commit_sha}"
        )
    request = doc.get("request") or {}
    if request.get("commit_sha") != commit_sha:
        problems.append("the recorded request does not name the requested commit")
    if tree_sha is not None and doc.get("tree_sha") != tree_sha:
        problems.append(f"tested tree {doc.get('tree_sha')!r} is not the commit's tree {tree_sha}")
    if scope is not None and doc.get("scope") != scope:
        problems.append(f"results are for scope {doc.get('scope')!r}, not {scope!r}")
    verdict, reasons = compute_verdict(doc)
    if problems:
        return "incomplete", problems + reasons
    return verdict, reasons


# --------------------------------------------------------------------------- reporting


def summary_markdown(doc: dict[str, Any], verdict: str, reasons: list[str]) -> str:
    request = doc.get("request") or {}
    lines = [
        f"## LAI EC2 unit tests: **{verdict.upper()}**",
        "",
        f"- Tested commit: `{doc.get('commit_sha')}` (tree `{doc.get('tree_sha')}`)",
        f"- Source branch: `{request.get('source_branch')}`; base `{doc.get('base_sha')}`",
        f"- Scope: `{doc.get('scope')}`; request `{request.get('request_id')}`",
        "",
        "| Suite | Status | Passed | Failed | Errors | Skipped | Seconds |",
        "|---|---|---|---|---|---|---|",
    ]
    for suite in doc.get("suites", []):
        c = suite.get("counts") or {}
        lines.append(
            f"| {suite.get('name')} | {suite.get('status')} | {c.get('passed', '-')} | "
            f"{c.get('failed', '-')} | {c.get('errors', '-')} | {c.get('skipped', '-')} | "
            f"{suite.get('duration_s', '-')} |"
        )
    plan = doc.get("plan") or {}
    for item in plan.get("not_planned", []):
        lines.append(f"| {item.get('name')} | not planned | | | | | |")
    if reasons:
        lines += ["", "**Why:**", ""] + [f"- {r}" for r in reasons]
    for suite in doc.get("suites", []):
        for failure in suite.get("failures", [])[:10]:
            lines += [
                "",
                f"<details><summary>{suite.get('name')}: {failure.get('id')}</summary>",
                "",
                "```",
                failure.get("excerpt", "") or failure.get("message", ""),
                "```",
                "</details>",
            ]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("verify", help="check a results.json against the requested commit")
    check.add_argument("results", type=Path)
    check.add_argument("--commit", required=True)
    check.add_argument("--scope", choices=SCOPES)
    check.add_argument("--tree", help="expected tree SHA of the commit")
    check.add_argument("--summary", type=Path, help="append a Markdown summary to this file")
    check.add_argument("--json", action="store_true", help="print the verdict as JSON")
    args = parser.parse_args(argv)

    try:
        doc = load(args.results)
        verdict, reasons = verify(doc, commit_sha=args.commit, scope=args.scope, tree_sha=args.tree)
    except ResultsError as exc:
        doc, verdict, reasons = {}, "incomplete", [str(exc)]
    if args.summary:
        with args.summary.open("a", encoding="utf-8") as out:
            out.write(summary_markdown(doc, verdict, reasons))
    if args.json:
        print(json.dumps({"verdict": verdict, "reasons": reasons, "commit_sha": args.commit}))
    else:
        print(f"verdict: {verdict}")
        for reason in reasons:
            print(f"  - {reason}")
    return EXIT_CODES[verdict]


if __name__ == "__main__":
    sys.exit(main())
