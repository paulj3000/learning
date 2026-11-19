"""Unit tests for scripts/dev/migration_audit.py (LAI-ENG-002), on a throwaway git repository."""

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location(
    "migration_audit", ROOT / "scripts" / "dev" / "migration_audit.py"
)
assert _SPEC and _SPEC.loader
audit_mod = importlib.util.module_from_spec(_SPEC)
sys.modules["migration_audit"] = audit_mod
_SPEC.loader.exec_module(audit_mod)

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")


def migration(app: str, name: str, deps: list[tuple[str, str]], body: str = "") -> str:
    listed = ", ".join(f'("{a}", "{n}")' for a, n in deps)
    return (
        "from django.db import migrations\n\n\nclass Migration(migrations.Migration):\n"
        f"    dependencies = [{listed}]\n    operations = []{body}\n"
    )


class Repo:
    def __init__(self, path: Path):
        self.path = path
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "test")

    def git(self, *args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(self.path), *args], capture_output=True, text=True, check=True
        ).stdout

    def write(self, rel: str, text: str) -> None:
        target = self.path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def commit(self, message: str) -> None:
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)

    def branch(self, name: str) -> None:
        self.git("checkout", "-q", "-b", name, "main")


def path(app: str, name: str) -> str:
    return f"lai/apps/{app}/migrations/{name}.py"


@pytest.fixture
def repo(tmp_path):
    r = Repo(tmp_path)
    r.write(path("assets", "0001_initial"), migration("assets", "0001_initial", []))
    r.write(
        path("assets", "0002_more"), migration("assets", "0002_more", [("assets", "0001_initial")])
    )
    r.write(path("regions", "0001_initial"), migration("regions", "0001_initial", []))
    r.commit("base")
    return r


def run(repo: Repo, *branches: str):
    return audit_mod.audit(str(repo.path), "main", list(branches))


def test_base_leaves(repo):
    assert audit_mod.base_leaves(str(repo.path), "main") == {
        "assets": {"0002_more"},
        "regions": {"0001_initial"},
    }


def test_clean_branches(repo):
    repo.branch("a")
    repo.write(path("assets", "0003_a"), migration("assets", "0003_a", [("assets", "0002_more")]))
    repo.commit("a")
    report = run(repo, "a")
    assert not report.failed
    assert report.collisions == []
    assert [m["name"] for m in report.added["a"]] == ["0003_a"]


def test_collision_between_branches(repo):
    for name in ("0003_collision_profiles", "0003_derived_artifact"):
        repo.branch(name)
        repo.write(path("assets", name), migration("assets", name, [("assets", "0002_more")]))
        repo.commit(name)
    report = run(repo, "0003_collision_profiles", "0003_derived_artifact")
    assert len(report.collisions) == 1
    assert "assets 0003" in report.collisions[0]
    assert not report.failed  # a collision is expected while branches are open


def test_identical_file_on_two_branches_is_not_a_collision(repo):
    text = migration("assets", "0003_shared", [("assets", "0002_more")])
    for b in ("x", "y"):
        repo.branch(b)
        repo.write(path("assets", "0003_shared"), text)
        repo.commit(b)
    report = run(repo, "x", "y")
    assert report.collisions == [] and report.divergent == []


def test_divergent_content_fails(repo):
    for b, body in (("x", ""), ("y", "\n# changed")):
        repo.branch(b)
        repo.write(
            path("assets", "0003_same"),
            migration("assets", "0003_same", [("assets", "0002_more")], body),
        )
        repo.commit(b)
    report = run(repo, "x", "y")
    assert report.failed
    assert "assets.0003_same" in report.divergent[0]


def test_rewrite_of_a_base_migration_fails(repo):
    repo.branch("bad")
    repo.write(
        path("assets", "0002_more"),
        migration("assets", "0002_more", [("assets", "0001_initial")], "\n# edit"),
    )
    repo.commit("edit applied migration")
    report = run(repo, "bad")
    assert report.failed
    assert "0002_more" in report.rewrites[0]


def test_stale_parent_fails(repo):
    repo.branch("old")
    repo.write(
        path("assets", "0002_other"),
        migration("assets", "0002_other", [("assets", "0001_initial")]),
    )
    repo.commit("built on an old leaf")
    report = run(repo, "old")
    assert report.failed
    assert "not the main leaf" in report.stale_parents[0]


def test_chain_inside_a_branch_and_cross_app_deps_are_fine(repo):
    repo.branch("chain")
    repo.write(
        path("regions", "0002_a"),
        migration("regions", "0002_a", [("regions", "0001_initial"), ("assets", "0001_initial")]),
    )
    repo.write(path("regions", "0003_b"), migration("regions", "0003_b", [("regions", "0002_a")]))
    repo.write(
        path("seasons", "0001_initial"),
        migration("seasons", "0001_initial", [("regions", "0001_initial")]),
    )
    repo.commit("chain")
    assert not run(repo, "chain").failed


def test_single_quoted_dependencies_are_read():
    source = "dependencies = [\n    ('ai', '0005_npc_hint_route'),\n    ('users', '0008_x'),\n]"
    assert audit_mod.dependencies_of(source) == [("ai", "0005_npc_hint_route"), ("users", "0008_x")]


def test_main_json_and_exit_code(repo, capsys):
    repo.branch("bad")
    repo.write(path("assets", "0002_more"), migration("assets", "0002_more", [], "\n# edit"))
    repo.commit("edit")
    code = audit_mod.main(["--repo", str(repo.path), "--base", "main", "--json", "bad"])
    assert code == 1
    assert json.loads(capsys.readouterr().out)["failed"] is True


def test_main_text_report(repo, capsys):
    assert audit_mod.main(["--repo", str(repo.path), "--base", "main", "main"]) == 0
    out = capsys.readouterr().out
    assert "COLLISION" in out and "REWRITE" in out
