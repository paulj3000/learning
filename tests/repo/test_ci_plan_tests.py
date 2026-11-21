"""scripts/ci/plan_tests.py: which unit suites a change needs (affected) and the full-unit plan."""

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location("plan_tests", ROOT / "scripts/ci/plan_tests.py")
assert _SPEC and _SPEC.loader
planner = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(planner)


def touch(root: Path, path: str, text: str = "") -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)


@pytest.fixture
def src(tmp_path):
    """A small checkout: three apps (regions imports catalog; seasons depends on regions'
    migrations), React, the engine and the realm tests."""
    for app in ("catalog", "regions", "seasons", "users", "core"):
        touch(tmp_path, f"lai/apps/{app}/__init__.py")
    touch(tmp_path, "lai/apps/regions/views.py", "from apps.catalog.models import Item\n")
    touch(
        tmp_path,
        "lai/apps/seasons/migrations/0001_initial.py",
        "dependencies = [('regions', '0007_puzzle_kinds')]\n",
    )
    touch(tmp_path, "lai/apps/regions/tests/test_castle_catalog.py")
    touch(tmp_path, "lai/apps/regions/tests/test_other.py")
    touch(tmp_path, "react/src/features/island-map/StorykeeperCastleWorldView.test.tsx")
    touch(tmp_path, "react/src/features/discovery/discovery.test.ts")
    touch(tmp_path, "react/src/features/scoring/score.ts")
    touch(tmp_path, "game/src/movement/index.ts")
    touch(tmp_path, "game/src/sdk/contentCompatibility.test.ts")
    return tmp_path


def names(plan):
    return [s["name"] for s in plan["suites"]]


def suite(plan, name):
    return next(s for s in plan["suites"] if s["name"] == name)


def test_full_unit_plans_every_unit_suite(src):
    plan = planner.plan(src, "full-unit", None, "b" * 40)
    assert names(plan) == ["django-migrations", "django", "python-repo", "engine", "react"]
    assert suite(plan, "django")["args"] == ["lai"]
    assert suite(plan, "react")["args"] == ["run"]
    assert "Playwright, browser, end-to-end and acceptance tests" in plan["deferred"]


def test_no_suite_runs_deferred_checks(src):
    plan = planner.plan(src, "full-unit", None, None)
    text = json.dumps(plan["suites"]).lower()
    for banned in ("playwright", "e2e", "ruff", "prettier", "oxlint", "build", "lint"):
        assert banned not in text


def test_a_changed_app_runs_with_its_direct_dependents_and_the_safety_baseline(src):
    plan = planner.plan(src, "affected", ["lai/apps/catalog/models.py"], None)
    assert names(plan) == ["django-migrations", "django"]
    args = suite(plan, "django")["args"]
    assert "lai/apps/catalog" in args and "lai/apps/regions" in args
    assert "lai/apps/seasons" not in args  # depends on regions, not on catalog
    assert "lai/apps/core/tests/test_privacy_logging.py" in args
    assert "lai/apps/users/tests/test_tenant_isolation.py" in args


def test_migration_dependencies_count_as_dependents(src):
    args = suite(planner.plan(src, "affected", ["lai/apps/regions/models.py"], None), "django")[
        "args"
    ]
    assert "lai/apps/seasons" in args


def test_settings_or_requirements_make_django_full(src):
    for path in ("lai/config/settings/base.py", "requirements.txt"):
        plan = planner.plan(src, "affected", [path], None)
        assert suite(plan, "django")["args"] == ["lai"]


def test_a_removed_app_makes_django_full(src):
    plan = planner.plan(src, "affected", ["lai/apps/gone/models.py"], None)
    assert suite(plan, "django")["args"] == ["lai"]


def test_typescript_changes_use_vitest_related(src):
    plan = planner.plan(src, "affected", ["react/src/features/scoring/score.ts"], None)
    react = suite(plan, "react")
    assert react["args"] == ["related", "src/features/scoring/score.ts"]
    assert react["allow_empty"] is True
    assert "engine" not in names(plan)


def test_engine_changes_run_the_engine_and_the_realm_compatibility_tests(src):
    plan = planner.plan(src, "affected", ["game/src/movement/index.ts"], None)
    assert names(plan) == ["engine", "react", "realm-compat-react"]
    assert suite(plan, "react")["args"] == ["related", "../game/src/movement/index.ts"]
    compat = suite(plan, "realm-compat-react")["args"]
    assert "src/features/island-map/StorykeeperCastleWorldView.test.tsx" in compat
    assert "../game/src/sdk/contentCompatibility.test.ts" in compat
    assert "src/features/discovery/discovery.test.ts" not in compat  # "discover" is not "cove"


def test_region_changes_add_the_django_realm_tests(src):
    plan = planner.plan(src, "affected", ["lai/apps/regions/models.py"], None)
    assert suite(plan, "realm-compat-django")["args"] == [
        "lai/apps/regions/tests/test_castle_catalog.py"
    ]


def test_a_deleted_typescript_source_makes_react_full(src):
    plan = planner.plan(src, "affected", ["react/src/features/old/removed.ts"], None)
    assert suite(plan, "react")["args"] == ["run"]
    assert any("deleted" in r for r in plan["full_reasons"])


def test_lockfile_changes_make_engine_and_react_full(src):
    plan = planner.plan(src, "affected", ["package-lock.json"], None)
    assert suite(plan, "engine")["args"] == ["run"]
    assert suite(plan, "react")["args"] == ["run"]


def test_ci_and_script_changes_run_the_repository_tests(src):
    plan = planner.plan(src, "affected", [".github/workflows/x.yml", "scripts/ci/a.py"], None)
    assert names(plan) == ["python-repo"]


def test_content_changes_make_django_and_react_full(src):
    plan = planner.plan(src, "affected", ["content/exported/adventures.json"], None)
    assert suite(plan, "django")["args"] == ["lai"]
    assert suite(plan, "react")["args"] == ["run"]


def test_an_unclassified_path_makes_the_whole_plan_full(src):
    plan = planner.plan(src, "affected", ["somewhere/new/thing.bin"], None)
    assert names(plan) == ["django-migrations", "django", "python-repo", "engine", "react"]
    assert plan["scope"] == "affected"
    assert any("unclassified" in r for r in plan["full_reasons"])


def test_a_documentation_only_change_still_runs_something(src):
    plan = planner.plan(src, "affected", ["docs/x.md", "README.md"], None)
    assert names(plan) == ["python-repo"]
    assert all(n["name"] != "python-repo" for n in plan["not_planned"])


def test_affected_without_a_change_list_is_refused(src):
    with pytest.raises(ValueError):
        planner.plan(src, "affected", None, None)
    with pytest.raises(ValueError):
        planner.plan(src, "partial", [], None)
