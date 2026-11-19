"""Unit tests for scripts/dev/merge_forecast.py (LAI-ENG-002), on a throwaway git repository."""

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location(
    "merge_forecast", ROOT / "scripts" / "dev" / "merge_forecast.py"
)
assert _SPEC and _SPEC.loader
fc = importlib.util.module_from_spec(_SPEC)
sys.modules["merge_forecast"] = fc
_SPEC.loader.exec_module(fc)

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")


@pytest.fixture
def repo(tmp_path):
    def g(*args):
        return subprocess.run(
            ["git", "-C", str(tmp_path), *args], capture_output=True, text=True, check=True
        ).stdout.strip()

    g("init", "-q", "-b", "main")
    g("config", "user.email", "test@example.invalid")
    g("config", "user.name", "test")

    def commit(branch, files, base="main"):
        if branch != "main":  # the first commit creates main itself
            g("checkout", "-q", "-B", branch, base)
        for rel, text in files.items():
            p = tmp_path / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
        g("add", "-A")
        g("commit", "-q", "-m", branch)

    commit("main", {"lai/a.py": "a = 1\n", "docs/STATUS.md": "status\n"})
    commit("engine", {"game/src/index.ts": "export const x = 1;\n", "docs/STATUS.md": "engine\n"})
    commit("realm", {"lai/realm.py": "r = 1\n"}, base="engine")
    commit("castle", {"docs/STATUS.md": "castle\n", "lai/a.py": "a = 2\n"})
    g("checkout", "-q", "main")
    return tmp_path, g


def test_clean_chain(repo):
    path, _ = repo
    steps = fc.forecast(str(path), "main", ["engine", "realm"])
    assert [s.clean for s in steps] == [True, True]


def test_conflict_is_reported_and_classified(repo):
    path, _ = repo
    steps = fc.forecast(str(path), "main", ["engine", "castle"])
    assert steps[0].clean
    assert not steps[1].clean
    assert steps[1].conflicts == ["docs/STATUS.md"]
    assert steps[1].kinds["docs"] == ["docs/STATUS.md"]


def test_results_carry_forward(repo):
    path, _ = repo
    # castle alone onto main only changes lai/a.py and STATUS: clean
    assert fc.forecast(str(path), "main", ["castle"])[0].clean
    # after engine, STATUS conflicts: the second step saw the first step's tree
    assert not fc.forecast(str(path), "main", ["engine", "castle"])[1].clean


def test_no_refs_or_worktree_change(repo):
    path, g = repo
    before = (g("for-each-ref"), g("rev-parse", "HEAD"), g("status", "--porcelain"))
    fc.forecast(str(path), "main", ["engine", "castle", "realm"])
    assert (g("for-each-ref"), g("rev-parse", "HEAD"), g("status", "--porcelain")) == before


def test_main_exit_and_json(repo, capsys):
    path, _ = repo
    assert fc.main(["--repo", str(path), "--base", "main", "engine", "realm"]) == 0
    assert "clean" in capsys.readouterr().out
    assert fc.main(["--repo", str(path), "--base", "main", "--json", "engine", "castle"]) == 1
    data = json.loads(capsys.readouterr().out)
    assert data[1]["conflicts"] == ["docs/STATUS.md"]


def test_kinds():
    step = fc.Step(
        "x",
        "0",
        False,
        ["content/exported/manifest.json", "react/src/a.ts", "docs/DECISIONS.md", "lai/b.py"],
    )
    assert step.kinds == {
        "code": ["react/src/a.ts", "lai/b.py"],
        "generated": ["content/exported/manifest.json"],
        "docs": ["docs/DECISIONS.md"],
    }
