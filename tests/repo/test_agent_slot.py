"""Unit tests for scripts/dev/agent_slot.py and the slot-aware test settings (LAI-ENG-002)."""

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location(
    "agent_slot", ROOT / "scripts" / "dev" / "agent_slot.py"
)
assert _SPEC and _SPEC.loader
slot = importlib.util.module_from_spec(_SPEC)
sys.modules["agent_slot"] = slot  # dataclasses resolve the module by name
_SPEC.loader.exec_module(slot)


def test_slot_zero_keeps_the_documented_defaults():
    v = slot.values_for(0, "learning")
    assert (v.postgres_port, v.django_port, v.vite_port) == (5442, 8010, 5183)
    assert (v.e2e_django_port, v.e2e_vite_port, v.mp_port) == (8765, 5175, 2567)
    assert v.postgres_db == "lai"
    assert v.test_database == "test_lai"


def test_every_slot_has_unique_ports_and_databases():
    seen_ports: dict[int, str] = {}
    seen_dbs = set()
    for n in range(slot.MAX_SLOT + 1):
        v = slot.values_for(n, f"worktree-{n}")
        for key, port in v.ports().items():
            assert port not in seen_ports, f"slot {n} {key} {port} reuses {seen_ports.get(port)}"
            seen_ports[port] = f"slot {n} {key}"
        assert v.test_database not in seen_dbs
        seen_dbs.add(v.test_database)


@pytest.mark.parametrize("bad", [-1, slot.MAX_SLOT + 1])
def test_slot_range(bad):
    with pytest.raises(ValueError):
        slot.values_for(bad, "x")


@pytest.mark.parametrize(
    "name, expected",
    [
        ("scoring", "scoring"),
        ("wt-feature-LAI-0805-layout-admin", "feature_lai_0805_layout_admin"),
        ("treasure-rush", "treasure_rush"),
        ("---", "worktree"),
    ],
)
def test_slug(name, expected):
    assert slot.slug_for(name) == expected


def test_database_names_fit_postgres_identifiers():
    v = slot.values_for(9, "x" * 200)
    assert len(v.test_database.encode()) <= 63


def test_merge_env_creates_block():
    text = slot.merge_env("", slot.values_for(2, "storybook"))
    lines = text.splitlines()
    assert lines[0] == slot.MANAGED_MARKER
    assert "POSTGRES_DB=lai_storybook" in lines
    assert slot.read_slot(text) == 2


def test_merge_env_keeps_unmanaged_lines_and_replaces_managed_ones():
    existing = "COGNITO_REGION=us-west-2\nPOSTGRES_PORT=5442\n# note\nDJANGO_SECRET_KEY=keep-me\n"
    once = slot.merge_env(existing, slot.values_for(3, "gameengine"))
    twice = slot.merge_env(once, slot.values_for(4, "gameengine"))
    assert "COGNITO_REGION=us-west-2" in twice
    assert "DJANGO_SECRET_KEY=keep-me" in twice
    assert "# note" in twice
    assert twice.count("POSTGRES_PORT=") == 1
    assert "POSTGRES_PORT=5454" in twice
    assert twice.count(slot.MANAGED_MARKER) == 1
    assert slot.read_slot(twice) == 4


def test_write_command_round_trip(tmp_path):
    (tmp_path / ".env").write_text("COGNITO_REGION=us-west-2\n")
    assert slot.main(["--root", str(tmp_path), "write", "--slot", "5"]) == 0
    text = (tmp_path / ".env").read_text()
    assert "COGNITO_REGION=us-west-2" in text
    assert f"POSTGRES_DB=lai_{slot.slug_for(tmp_path.name)}" in text


def test_write_refuses_bad_slot(tmp_path):
    assert slot.main(["--root", str(tmp_path), "write", "--slot", "42"]) == 2
    assert not (tmp_path / ".env").exists()


@pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")
def test_preflight_flags_main_and_missing_slot(tmp_path):
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    errors, warnings = slot.preflight(tmp_path, probe=lambda port: True)
    assert any("branch is main" in e for e in errors)
    assert any("no LAI_AGENT_SLOT" in w for w in warnings)


@pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")
def test_preflight_reports_busy_ports(tmp_path):
    subprocess.run(["git", "init", "-q", "-b", "feature/x", str(tmp_path)], check=True)
    (tmp_path / ".env").write_text(slot.merge_env("", slot.values_for(1, tmp_path.name)))
    (tmp_path / "node_modules").mkdir()
    (tmp_path / ".venv").mkdir()
    errors, warnings = slot.preflight(tmp_path, probe=lambda port: port != 8020)
    assert errors == []
    assert warnings == [w for w in warnings if "main checkout" in w or "8020" in w]
    assert any("DJANGO_DEV_PORT 8020 is in use" in w for w in warnings)


# --- slot-aware test settings (lai/config/settings/test.py) ---------------------------------


def test_settings_read_only_slotted_env(tmp_path):
    from config.settings import test as test_settings

    env = tmp_path / ".env"
    env.write_text("POSTGRES_PORT=5999\nPOSTGRES_DB=elsewhere\n")
    assert test_settings.slot_database_env(env) == {}

    env.write_text(
        slot.merge_env(
            "POSTGRES_USER=someone\nDATABASE_URL=postgresql://x\n", slot.values_for(2, "storybook")
        )
    )
    assert test_settings.slot_database_env(env) == {
        "POSTGRES_PORT": "5452",
        "POSTGRES_DB": "lai_storybook",
    }
    assert test_settings.slot_database_env(tmp_path / "missing.env") == {}


def test_settings_keep_loopback_host():
    from django.conf import settings

    assert settings.DATABASES["default"]["HOST"] == "127.0.0.1"
    # Whatever slot this worktree uses, the pytest database is test_<POSTGRES_DB>.
    assert settings.DATABASES["default"]["NAME"] == os.environ.get("POSTGRES_DB", "lai")


# --- borrowed node_modules -------------------------------------------------------------------


def _worktree(path: Path, lock: str) -> Path:
    path.mkdir(parents=True)
    (path / "package-lock.json").write_text(lock)
    return path


def test_own_node_modules_is_fine(tmp_path):
    root = _worktree(tmp_path / "mine", "a")
    (root / "node_modules" / "three").mkdir(parents=True)
    assert slot.borrowed_node_modules(root) == []


def test_symlinked_node_modules_dir_warns_and_compares_lockfiles(tmp_path):
    other = _worktree(tmp_path / "storybook", "lock-v1")
    (other / "node_modules").mkdir()
    root = _worktree(tmp_path / "sc-final-d", "lock-v2")
    (root / "node_modules").symlink_to(other / "node_modules")
    warnings = slot.borrowed_node_modules(root)
    assert any("is a symlink to" in w and "storybook" in w for w in warnings)
    assert any("package-lock.json differs" in w for w in warnings)


def test_symlink_farm_with_same_lockfile_warns_once(tmp_path):
    other = _worktree(tmp_path / "storybook", "same")
    root = _worktree(tmp_path / "firepeak", "same")
    (root / "node_modules").mkdir()
    for i in range(25):
        (other / "node_modules" / f"pkg{i}").mkdir(parents=True)
        (root / "node_modules" / f"pkg{i}").symlink_to(other / "node_modules" / f"pkg{i}")
    # A workspace link back into this worktree (for example @lai/game-engine -> ../../game) is fine.
    (root / "game").mkdir()
    (root / "node_modules" / "game-engine").symlink_to(root / "game")
    warnings = slot.borrowed_node_modules(root)
    assert len(warnings) == 1
    assert "links 25 packages into" in warnings[0]


def test_a_few_links_are_not_a_farm(tmp_path):
    other = _worktree(tmp_path / "other", "x")
    root = _worktree(tmp_path / "mine", "x")
    (root / "node_modules").mkdir()
    (other / "node_modules" / "one").mkdir(parents=True)
    (root / "node_modules" / "one").symlink_to(other / "node_modules" / "one")
    assert slot.borrowed_node_modules(root) == []
