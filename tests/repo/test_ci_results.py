"""scripts/ci/ci_results.py: JUnit parsing, suite status, the fail-closed verdict and SHA checks."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ci"))
_SPEC = importlib.util.spec_from_file_location("ci_results", ROOT / "scripts/ci/ci_results.py")
assert _SPEC and _SPEC.loader
results = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(results)

SHA = "a" * 40
OTHER = "b" * 40
TREE = "c" * 40

PYTEST_XML = """<?xml version="1.0" encoding="utf-8"?>
<testsuites><testsuite name="pytest" tests="4">
<testcase classname="lai.apps.scoring.tests.test_realms.TestMap" name="test_ok"/>
<testcase classname="lai.apps.scoring.tests.test_realms" name="test_bad">
  <failure message="assert 1 == 2">line one
line two</failure></testcase>
<testcase classname="lai.apps.core.tests.test_x" name="test_err">
  <error message="boom">trace</error></testcase>
<testcase classname="lai.apps.core.tests.test_x" name="test_skip"><skipped message="no"/></testcase>
</testsuite></testsuites>"""

VITEST_XML = """<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="2" failures="0" errors="0">
  <testsuite name="src/a.test.ts" tests="2">
    <testcase classname="src/a.test.ts" name="a &gt; works"/>
    <testcase classname="src/a.test.ts" name="a &gt; also works"/>
  </testsuite>
</testsuites>"""


def write(tmp_path: Path, text: str, name: str = "r.xml") -> Path:
    path = tmp_path / name
    path.write_text(text)
    return path


def request(**extra):
    return {"commit_sha": SHA, "scope": "affected", "base_sha": OTHER, "request_id": "r1", **extra}


def passing_doc(**overrides):
    doc = results.new_results(request())
    doc.update(
        tree_sha=TREE,
        preflight={"ok": True, "checks": []},
        plan={"suites": [{"name": "django"}, {"name": "react"}], "not_planned": []},
        suites=[
            {"name": "django", "status": "passed", "counts": {"total": 3}},
            {"name": "react", "status": "passed", "counts": {"total": 9}},
        ],
    )
    doc.update(overrides)
    return doc


# --------------------------------------------------------------------------- JUnit


def test_parse_pytest_junit_counts_and_failures(tmp_path):
    parsed = results.parse_junit(write(tmp_path, PYTEST_XML))
    assert parsed["counts"] == {"total": 4, "passed": 1, "failed": 1, "errors": 1, "skipped": 1}
    first = parsed["failures"][0]
    assert first["id"] == "lai.apps.scoring.tests.test_realms::test_bad"
    assert first["file"] == "lai/apps/scoring/tests/test_realms.py"
    assert first["message"] == "assert 1 == 2"
    assert first["excerpt"] == "line one\nline two"
    assert parsed["failures"][1]["kind"] == "error"


def test_parse_vitest_junit(tmp_path):
    parsed = results.parse_junit(write(tmp_path, VITEST_XML))
    assert parsed["counts"]["total"] == 2 and parsed["counts"]["passed"] == 2
    assert parsed["failures"] == []


def test_a_missing_or_broken_report_is_an_error_not_a_pass(tmp_path):
    with pytest.raises(results.ResultsError, match="missing"):
        results.parse_junit(tmp_path / "absent.xml")
    with pytest.raises(results.ResultsError, match="unreadable"):
        results.parse_junit(write(tmp_path, "<testsuites><testcase"))
    with pytest.raises(results.ResultsError, match="not a JUnit"):
        results.parse_junit(write(tmp_path, "<html/>"))


def test_failures_are_capped(tmp_path):
    cases = "".join(
        f'<testcase classname="t" name="n{i}"><failure message="m"/></testcase>' for i in range(80)
    )
    parsed = results.parse_junit(write(tmp_path, f"<testsuite>{cases}</testsuite>"))
    assert parsed["counts"]["failed"] == 80
    assert len(parsed["failures"]) == results.MAX_FAILURES_PER_SUITE


# --------------------------------------------------------------------------- suite status


def counts(**kw):
    base = {"total": 5, "passed": 5, "failed": 0, "errors": 0, "skipped": 0}
    return {"counts": {**base, **kw}, "failures": []}


@pytest.mark.parametrize(
    ("kwargs", "status"),
    [
        ({"exit_code": 0, "junit": counts()}, "passed"),
        ({"exit_code": 1, "junit": counts(passed=4, failed=1)}, "failed"),
        ({"exit_code": 1, "junit": counts(passed=4, errors=1)}, "failed"),
        ({"exit_code": 0, "junit": None}, "error"),
        ({"exit_code": 2, "junit": counts()}, "error"),
        ({"exit_code": 0, "junit": counts(total=0, passed=0)}, "error"),
        ({"exit_code": 0, "junit": counts(total=0, passed=0), "allow_empty": True}, "passed"),
        ({"exit_code": 0, "junit": counts(total=3, passed=0, skipped=3)}, "error"),
        ({"exit_code": None, "junit": None, "blocked_reason": "no node"}, "blocked"),
        ({"exit_code": -9, "junit": counts(), "timed_out": True}, "timed_out"),
    ],
)
def test_suite_status_fails_closed(kwargs, status):
    assert results.suite_status(**kwargs)[0] == status


# --------------------------------------------------------------------------- verdict


def test_pass_needs_every_planned_suite_to_pass():
    assert results.compute_verdict(passing_doc()) == ("pass", [])


@pytest.mark.parametrize(
    ("overrides", "verdict", "fragment"),
    [
        ({"suites": [{"name": "django", "status": "passed"}]}, "incomplete", "react: did not run"),
        (
            {
                "suites": [
                    {"name": "django", "status": "passed"},
                    {"name": "react", "status": "blocked", "reason": "npm ci failed"},
                ]
            },
            "incomplete",
            "react: blocked",
        ),
        (
            {
                "suites": [
                    {"name": "django", "status": "failed", "reason": "1 failed"},
                    {"name": "react", "status": "blocked"},
                ]
            },
            "fail",
            "django: failed",
        ),
        (
            {"preflight": {"ok": False, "checks": [{"name": "node", "ok": False}]}},
            "incomplete",
            "preflight failed: node",
        ),
        ({"harness_error": "RuntimeError: x"}, "incomplete", "harness error"),
        ({"plan": None}, "incomplete", "no test plan"),
        ({"plan": {"suites": []}}, "incomplete", "plan is empty"),
        ({"tree_sha": None}, "incomplete", "tree SHA"),
        ({"schema": "other/9"}, "incomplete", "unknown results schema"),
    ],
)
def test_verdict_is_never_pass_on_anything_missing(overrides, verdict, fragment):
    got, reasons = results.compute_verdict(passing_doc(**overrides))
    assert got == verdict
    assert any(fragment in r for r in reasons), reasons


def test_a_stored_pass_verdict_is_not_trusted():
    doc = passing_doc(suites=[{"name": "django", "status": "passed"}])
    doc["verdict"] = "pass"
    assert results.compute_verdict(doc)[0] == "incomplete"


def test_finish_marks_completeness():
    assert results.finish_results(passing_doc())["complete"] is True
    failed = passing_doc(
        suites=[{"name": "django", "status": "failed"}, {"name": "react", "status": "passed"}]
    )
    assert results.finish_results(failed)["complete"] is True
    blocked = passing_doc(
        suites=[{"name": "django", "status": "failed"}, {"name": "react", "status": "blocked"}]
    )
    assert results.finish_results(blocked)["complete"] is False


# --------------------------------------------------------------------------- verify (SHA match)


def test_verify_accepts_matching_sha_scope_and_tree():
    assert results.verify(passing_doc(), commit_sha=SHA, scope="affected", tree_sha=TREE) == (
        "pass",
        [],
    )


@pytest.mark.parametrize(
    ("kwargs", "fragment"),
    [
        ({"commit_sha": OTHER}, "not the requested"),
        ({"commit_sha": SHA, "scope": "full-unit"}, "scope"),
        ({"commit_sha": SHA, "tree_sha": OTHER}, "tested tree"),
    ],
)
def test_verify_rejects_results_for_anything_else(kwargs, fragment):
    verdict, reasons = results.verify(passing_doc(), **kwargs)
    assert verdict == "incomplete"
    assert any(fragment in r for r in reasons)


def test_verify_rejects_a_tampered_request_block():
    doc = passing_doc(request=request(commit_sha=OTHER))
    assert results.verify(doc, commit_sha=SHA)[0] == "incomplete"


def test_verify_needs_a_full_sha():
    with pytest.raises(results.ResultsError):
        results.verify(passing_doc(), commit_sha="abc123")


# --------------------------------------------------------------------------- CLI


def run_cli(tmp_path, doc, *extra):
    path = tmp_path / "results.json"
    if doc is not None:
        path.write_text(json.dumps(doc))
    summary = tmp_path / "summary.md"
    code = results.main(["verify", str(path), "--commit", SHA, "--summary", str(summary), *extra])
    return code, summary.read_text()


def test_cli_exit_codes(tmp_path):
    assert run_cli(tmp_path, passing_doc())[0] == 0
    failed = passing_doc(
        suites=[{"name": "django", "status": "failed"}, {"name": "react", "status": "passed"}]
    )
    assert run_cli(tmp_path, failed)[0] == 1
    assert run_cli(tmp_path, passing_doc(tree_sha=None))[0] == 2


def test_cli_missing_results_is_incomplete(tmp_path):
    code, summary = run_cli(tmp_path, None)
    assert code == 2
    assert "INCOMPLETE" in summary and "results file missing" in summary


def test_cli_corrupt_results_is_incomplete(tmp_path):
    (tmp_path / "results.json").write_text("{not json")
    assert results.main(["verify", str(tmp_path / "results.json"), "--commit", SHA]) == 2


def test_summary_names_the_tested_commit_and_failures(tmp_path):
    doc = passing_doc(
        suites=[
            {
                "name": "django",
                "status": "failed",
                "counts": {"passed": 1, "failed": 1},
                "failures": [{"id": "t::x", "excerpt": "AssertionError"}],
            },
            {"name": "react", "status": "passed"},
        ]
    )
    _, summary = run_cli(tmp_path, doc)
    assert SHA in summary and "AssertionError" in summary and "**FAIL**" in summary
