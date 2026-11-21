"""scripts/ci/aws_ci.py, the integration agent's command, against scripted fake gh and git."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ci"))
_SPEC = importlib.util.spec_from_file_location("aws_ci", ROOT / "scripts/ci/aws_ci.py")
assert _SPEC and _SPEC.loader
aws_ci = importlib.util.module_from_spec(_SPEC)
sys.modules["aws_ci"] = aws_ci  # dataclasses look their module up here
_SPEC.loader.exec_module(aws_ci)

SHA = "1" * 40
NEWER = "2" * 40
TREE = "3" * 40
BRANCH = "integration/20261120-ci"


class Fake:
    """Answers gh and git calls from a small state machine and records every call."""

    def __init__(self, tmp_path: Path):
        self.calls: list[list[str]] = []
        self.common = tmp_path / "git-common"
        self.branch = BRANCH
        self.head = SHA
        self.remote = SHA
        self.dirty = ""
        self.trees = {SHA: TREE}
        self.runs: list[dict] = []
        self.run_views: list[dict] = []
        self.artifact: dict | None = None
        self.dispatch_ok = True
        self.pushed = False

    def __call__(self, cmd, cwd=None):
        self.calls.append(cmd)
        joined = " ".join(cmd)
        if cmd[:2] == ["git", "rev-parse"]:
            if "--git-common-dir" in cmd:
                return 0, str(self.common), ""
            if "--abbrev-ref" in cmd:
                return 0, self.branch, ""
            if cmd[2] == "HEAD":
                return 0, self.head, ""
            sha = cmd[2].split("^")[0]
            return (0, self.trees[sha], "") if sha in self.trees else (128, "", "bad")
        if cmd[:2] == ["git", "status"]:
            return 0, self.dirty, ""
        if cmd[:2] == ["git", "fetch"]:
            return 0, "", ""
        if cmd[:2] == ["git", "ls-remote"]:
            return 0, (f"{self.remote}\trefs/heads/{self.branch}" if self.remote else ""), ""
        if cmd[:2] == ["git", "merge-base"]:
            return 0, "", ""
        if cmd[:2] == ["git", "push"]:
            self.pushed = True
            self.remote = self.head
            return 0, "", ""
        if cmd[:2] == ["git", "log"]:
            return 0, "abc1234 Scoring lead: Add realm map", ""
        if cmd[:3] == ["gh", "workflow", "run"]:
            if not self.dispatch_ok:
                return 1, "", "HTTP 404: workflow not found on the default branch"
            request_id = joined.split("request_id=")[1].split()[0]
            self.runs.append(
                {
                    "databaseId": 77,
                    "displayTitle": f"EC2 unit tests affected {SHA} [{request_id}]",
                    "status": "queued",
                    "url": "https://github.com/o/r/actions/runs/77",
                }
            )
            return 0, "", ""
        if cmd[:3] == ["gh", "run", "list"]:
            return 0, json.dumps(self.runs), ""
        if cmd[:3] == ["gh", "run", "view"]:
            view = self.run_views.pop(0) if len(self.run_views) > 1 else self.run_views[0]
            return 0, json.dumps(view), ""
        if cmd[:3] == ["gh", "run", "download"]:
            if self.artifact is None:
                return 1, "", "no artifact"
            dest = Path(cmd[cmd.index("--dir") + 1]) / "results"
            dest.mkdir(parents=True)
            (dest / "results.json").write_text(json.dumps(self.artifact))
            return 0, "", ""
        raise AssertionError(f"unexpected call {cmd}")


@pytest.fixture
def fake(tmp_path):
    return Fake(tmp_path)


@pytest.fixture
def ctx(fake, tmp_path):
    output: list[str] = []
    clock = iter(range(0, 10**6, 5))
    return aws_ci.Ctx(
        repo="o/r",
        remote="origin",
        cwd=tmp_path,
        run=fake,
        sleep=lambda s: None,
        clock=lambda: next(clock),
        out=output.append,
    )


def passing_results(sha=SHA, tree=TREE, failed=False):
    status = "failed" if failed else "passed"
    return {
        "schema": "lai-ci-results/1",
        "request": {"commit_sha": sha, "request_id": "r"},
        "commit_sha": sha,
        "tree_sha": tree,
        "scope": "affected",
        "preflight": {"ok": True, "checks": []},
        "plan": {"suites": [{"name": "django"}]},
        "suites": [
            {
                "name": "django",
                "status": status,
                "cwd": ".",
                "counts": {"passed": 9, "failed": int(failed)},
                "failures": [
                    {
                        "id": "t::x",
                        "file": "lai/apps/scoring/tests/test_realms.py",
                        "excerpt": "AssertionError: 1 != 2",
                    }
                ]
                if failed
                else [],
            }
        ],
    }


def completed(fake, conclusion="success", artifact=None):
    fake.run_views = [{"status": "in_progress"}, {"status": "completed", "conclusion": conclusion}]
    fake.artifact = artifact


# --------------------------------------------------------------------------- submit


def test_submit_dispatches_the_exact_committed_sha(fake, ctx):
    record = aws_ci.cmd_submit(ctx, "affected", False, "req-1")
    dispatch = next(c for c in fake.calls if c[:3] == ["gh", "workflow", "run"])
    assert dispatch == [
        "gh",
        "workflow",
        "run",
        "aws-integration-tests.yml",
        "--repo",
        "o/r",
        "--ref",
        BRANCH,
        "-f",
        f"commit_sha={SHA}",
        "-f",
        "test_scope=affected",
        "-f",
        "request_id=req-1",
    ]
    assert record["run_id"] == 77 and record["commit_sha"] == SHA and record["tree_sha"] == TREE
    saved = json.loads((fake.common / "lai-ci/req-1/record.json").read_text())
    assert saved["commit_sha"] == SHA and saved["run_id"] == 77


def test_submit_refuses_uncommitted_changes(fake, ctx):
    fake.dirty = " M lai/apps/x.py"
    with pytest.raises(aws_ci.ToolError, match="uncommitted"):
        aws_ci.cmd_submit(ctx, "affected", True, None)
    assert not any(c[:2] == ["gh", "workflow"] for c in fake.calls)


def test_submit_refuses_an_unpushed_head_unless_asked_to_push(fake, ctx):
    fake.head, fake.trees[NEWER] = NEWER, TREE
    with pytest.raises(aws_ci.ToolError, match="not pushed"):
        aws_ci.cmd_submit(ctx, "affected", False, None)
    record = aws_ci.cmd_submit(ctx, "affected", True, "req-2")
    assert fake.pushed and record["commit_sha"] == NEWER


def test_submit_refuses_other_branches(fake, ctx):
    fake.branch = "feature/scoring"
    with pytest.raises(aws_ci.ToolError, match="not integration"):
        aws_ci.cmd_submit(ctx, "affected", False, None)


def test_dispatch_failure_is_reported(fake, ctx):
    fake.dispatch_ok = False
    with pytest.raises(aws_ci.ToolError, match="default branch"):
        aws_ci.cmd_submit(ctx, "affected", False, "req-3")


# --------------------------------------------------------------------------- run id


def test_find_run_matches_only_this_request(fake, ctx):
    fake.runs = [
        {"databaseId": 1, "displayTitle": "EC2 unit tests affected x [other]", "url": "u1"},
        {"databaseId": 2, "displayTitle": "EC2 unit tests affected x [mine]", "url": "u2"},
    ]
    assert aws_ci.find_run(ctx, BRANCH, "mine")["databaseId"] == 2


def test_find_run_times_out_rather_than_guessing(fake, ctx):
    fake.runs = [{"databaseId": 1, "displayTitle": "EC2 unit tests [someone-else]", "url": "u"}]
    with pytest.raises(aws_ci.ToolError, match="no run appeared"):
        aws_ci.find_run(ctx, BRANCH, "mine", timeout=20)


def test_find_run_refuses_ambiguity(fake, ctx):
    fake.runs = [{"databaseId": i, "displayTitle": "x [dup]", "url": "u"} for i in (1, 2)]
    with pytest.raises(aws_ci.ToolError, match="2 runs"):
        aws_ci.find_run(ctx, BRANCH, "dup")


# --------------------------------------------------------------------------- run and gate


def test_run_passes_and_records_the_tested_sha(fake, ctx):
    completed(fake, artifact=passing_results())
    assert aws_ci.cmd_run(ctx, "affected", False, "req-ok") == 0
    decision = json.loads((fake.common / "lai-ci/req-ok/decision.json").read_text())
    assert decision["decision"] == "MERGE-OK"
    assert decision["tested_commit"] == SHA and decision["tested_tree"] == TREE
    assert SHA in (fake.common / "lai-ci/req-ok/report.txt").read_text()


def test_test_failures_block_the_merge_and_name_the_file_and_last_change(fake, ctx):
    completed(fake, conclusion="failure", artifact=passing_results(failed=True))
    assert aws_ci.cmd_run(ctx, "affected", False, "req-fail") == 1
    decision = json.loads((fake.common / "lai-ci/req-fail/decision.json").read_text())
    assert decision["decision"] == "FAIL"
    failure = decision["failures"][0]
    assert failure["file"] == "lai/apps/scoring/tests/test_realms.py"
    assert failure["last_change"].startswith("abc1234 Scoring lead")
    assert "AssertionError" in failure["excerpt"]


@pytest.mark.parametrize("conclusion", ["cancelled", "timed_out", "startup_failure"])
def test_cancelled_or_timed_out_runs_are_incomplete(fake, ctx, conclusion):
    completed(fake, conclusion=conclusion, artifact=None)
    assert aws_ci.cmd_run(ctx, "affected", False, f"req-{conclusion}") == 2


def test_a_successful_run_without_results_is_still_blocked(fake, ctx):
    completed(fake, artifact=None)
    assert aws_ci.cmd_run(ctx, "affected", False, "req-nores") == 2


def test_results_for_another_commit_are_rejected(fake, ctx):
    completed(fake, artifact=passing_results(sha=NEWER))
    assert aws_ci.cmd_run(ctx, "affected", False, "req-wrong") == 2


def test_incomplete_results_block_even_when_the_run_succeeded(fake, ctx):
    results = passing_results()
    results["plan"]["suites"].append({"name": "react"})
    completed(fake, artifact=results)
    assert aws_ci.cmd_run(ctx, "affected", False, "req-inc") == 2


def test_a_new_commit_after_a_pass_invalidates_it(fake, ctx):
    completed(fake, artifact=passing_results())
    assert aws_ci.cmd_run(ctx, "affected", False, "req-stale") == 0
    fake.remote, fake.trees[NEWER] = NEWER, "9" * 40
    assert aws_ci.main(["gate", "req-stale"], ctx=ctx) == 3
    decision = json.loads((fake.common / "lai-ci/req-stale/decision.json").read_text())
    assert decision["decision"] == "STALE" and decision["tested_commit"] == SHA


def test_a_new_commit_with_the_identical_tree_keeps_the_result(fake, ctx):
    completed(fake, artifact=passing_results())
    aws_ci.cmd_run(ctx, "affected", False, "req-same")
    fake.remote, fake.trees[NEWER] = NEWER, TREE
    assert aws_ci.main(["gate", "req-same"], ctx=ctx) == 0


def test_gate_defaults_to_the_newest_record_for_the_branch(fake, ctx):
    completed(fake, artifact=passing_results())
    aws_ci.cmd_run(ctx, "affected", False, "req-a")
    assert aws_ci.main(["gate"], ctx=ctx) == 0


def test_missing_tools_are_an_error_not_a_pass(tmp_path):
    def broken(cmd, cwd=None):
        raise aws_ci.ToolError("gh is not installed")

    out: list[str] = []
    ctx = aws_ci.Ctx(repo="o/r", remote="origin", cwd=tmp_path, run=broken, out=out.append)
    assert aws_ci.main(["gate", "req-x"], ctx=ctx) == 4
    assert "not installed" in out[-1]


def test_invalid_request_ids_are_refused(fake, ctx):
    assert aws_ci.main(["gate", "../../etc"], ctx=ctx) == 4
