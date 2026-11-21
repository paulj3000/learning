#!/usr/bin/env python3
"""Plan the unit-test suites for one commit on the LAI CI EC2 instance.

See docs/infrastructure/aws-ec2-unit-tests.md.

Two scopes:

- `full-unit`: every unit suite: Django on PostgreSQL (all of `lai/`), the repository's Python
  tests (`tests/`), the migration check, the Game Engine, and all of React/Vitest.
- `affected`: only what the change can reach, derived from `git diff --name-only <base> <commit>`:
  changed Django apps plus the apps that import them directly or depend on their migrations, the
  privacy and authorization tests that always run when Django changes (testing-policy.md), Vitest
  `related` for changed TypeScript, the Game Engine when `game/` changes, and the Storykeeper and
  Treasure Rush compatibility tests when shared engine, realm or region code changes. A change the
  planner cannot classify, a dependency or configuration change, or a deleted TypeScript source
  widens that area to its full suite. Unknown paths make the whole plan full.

Never runs Playwright, browser, end-to-end, lint or format checks (testing-policy.md section 2).

    python3 scripts/ci/plan_tests.py --src <checkout> --scope affected --changed-from <file>
Prints the plan as JSON.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
from pathlib import Path
from typing import Any

# Run whenever Django is tested at all: authorization, authentication, privacy-safe logging
# (docs/engineering/testing-policy.md, "Always run").
DJANGO_SAFETY_BASELINE = (
    "lai/apps/users/tests/test_tenant_isolation.py",
    "lai/apps/users/tests/test_authentication.py",
    "lai/apps/users/tests/test_jwks.py",
    "lai/apps/core/tests/test_privacy_logging.py",
)

# Paths with no unit tests of their own.
NO_TEST_PATTERNS = (
    "docs/*",
    "*.md",
    ".claude/*",
    "tasks/*",
    ".gitignore",
    ".env.sample",
    ".prettierrc.json",
    ".prettierignore",
    ".oxlintrc.json",
    "LICENSE",
)

# A change here makes the Django suite full.
DJANGO_GLOBAL = ("lai/*", "requirements.txt", "requirements-dev.txt", "pyproject.toml")
# A change here makes the Engine and React suites full.
JS_GLOBAL = (
    "package.json",
    "package-lock.json",
    "tsconfig*.json",
    "react/package.json",
    "react/vite.config.ts",
    "react/tsconfig*.json",
    "react/index.html",
    "react/src/test/*",
    "game/package.json",
    "game/tsconfig*.json",
    "game/vitest.config.*",
)
# The repository's own Python tests (tests/) cover these.
PYTHON_REPO = (
    "tests/*",
    "scripts/*",
    "Makefile",
    "deploy/*",
    ".github/*",
    "docker-compose.yml",
    ".dockerignore",
    "lambda/*",
    "requirements.txt",
    "requirements-dev.txt",
    "pyproject.toml",
)
# TypeScript that Vitest (react/vite.config.ts) tests: React, the engine it consumes, server, infra.
VITEST_SOURCES = ("react/*", "game/*", "server/*", "infra/*")
TS_SOURCE_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css")
# Exported content is read by both React and Django tests.
CONTENT = ("content/*",)
# A change here can break the Storykeeper or Treasure Rush realms through shared code.
REALM_SENSITIVE = (
    "game/*",
    "react/src/features/game-engine/*",
    "react/src/features/island-map/three/*",
    "react/src/features/region-play/*",
    "react/src/features/great-storybook/*",
    "react/src/features/adventures/*",
    "lai/apps/regions/*",
    "lai/apps/scoring/*",
    "lai/apps/game_sessions/*",
)
REALM_TEST_RE = re.compile(r"(castle|storykeeper|treasure|pirate|cove(?!r))", re.IGNORECASE)
REALM_EXTRA_TESTS = (
    "game/src/sdk/contentCompatibility.test.ts",
    "react/src/features/game-engine/bridge/engineBridgePlatformParity.test.ts",
)

IMPORT_RE = re.compile(r"^\s*(?:from|import)\s+(?:lai\.)?apps\.([a-z_][a-z0-9_]*)", re.MULTILINE)
MIGRATION_DEP_RE = re.compile(r"\(\s*[\"']([a-z_][a-z0-9_]*)[\"']\s*,\s*[\"'](?:\d{4}|__first__)")


def matches(path: str, patterns: tuple[str, ...]) -> bool:
    return any(fnmatch.fnmatchcase(path, p) for p in patterns)


def django_apps(src: Path) -> list[str]:
    apps = src / "lai" / "apps"
    return sorted(p.name for p in apps.iterdir() if p.is_dir() and (p / "__init__.py").exists())


def reverse_dependencies(src: Path) -> dict[str, set[str]]:
    """app -> apps that import it or whose migrations depend on it."""
    apps = django_apps(src)
    known = set(apps)
    dependents: dict[str, set[str]] = {app: set() for app in apps}
    for app in apps:
        for path in (src / "lai" / "apps" / app).rglob("*.py"):
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            used = set(IMPORT_RE.findall(text))
            if "migrations" in path.parts:
                used |= set(MIGRATION_DEP_RE.findall(text))
            for dep in used & known - {app}:
                dependents[dep].add(app)
    return dependents


def with_direct_dependents(start: set[str], dependents: dict[str, set[str]]) -> set[str]:
    """The changed apps and the apps that import them directly.

    Not the transitive closure: the apps import each other in cycles, so the closure of almost any
    app is nearly every app. A dependent's tests exercise the changed app through its direct
    imports; anything wider is the full-unit scope's job.
    """
    seen = set(start)
    for app in start:
        seen |= dependents.get(app, set())
    return seen


def realm_tests(src: Path) -> tuple[list[str], list[str]]:
    """(vitest files relative to react/, pytest files relative to the root)."""
    vitest: list[str] = []
    for base in ("react/src",):
        for path in sorted((src / base).rglob("*.test.ts*")):
            rel = path.relative_to(src).as_posix()
            if REALM_TEST_RE.search(path.name):
                vitest.append(rel)
    for extra in REALM_EXTRA_TESTS:
        if (src / extra).is_file() and extra not in vitest:
            vitest.append(extra)
    pytest_files = [
        p.relative_to(src).as_posix()
        for p in sorted((src / "lai" / "apps").rglob("test_*.py"))
        if REALM_TEST_RE.search(p.name) or "storybook" in p.name
    ]
    return [_from_react(v) for v in vitest], pytest_files


def _from_react(path: str) -> str:
    return path[len("react/") :] if path.startswith("react/") else "../" + path


def _suite(name: str, kind: str, cwd: str, args: list[str], why: str, **extra: Any) -> dict:
    return {"name": name, "kind": kind, "cwd": cwd, "args": args, "why": why, **extra}


def full_plan(base_sha: str | None, reasons: list[str] | None = None) -> dict[str, Any]:
    suites = [
        _suite("django-migrations", "check", "lai", ["makemigrations"], "full-unit"),
        _suite("django", "pytest", ".", ["lai"], "full-unit"),
        _suite("python-repo", "pytest", ".", ["tests"], "full-unit"),
        _suite("engine", "vitest", "game", ["run"], "full-unit"),
        _suite("react", "vitest", "react", ["run"], "full-unit"),
    ]
    return {
        "scope": "full-unit",
        "base_sha": base_sha,
        "full_reasons": reasons or ["full-unit requested"],
        "suites": suites,
        "not_planned": [
            {
                "name": "realm-compat",
                "why": "covered: the full django, engine and react suites include every "
                "Storykeeper and Treasure Rush compatibility test",
            }
        ],
        "deferred": DEFERRED,
    }


DEFERRED = [
    "Playwright, browser, end-to-end and acceptance tests",
    "Ruff, Ruff format, Prettier, oxlint and the build",
    "live AWS checks",
]


def affected_plan(src: Path, changed: list[str], base_sha: str | None) -> dict[str, Any]:  # noqa: C901 - one table of rules, kept together
    changed = sorted({c.strip() for c in changed if c.strip()})
    reasons: list[str] = []
    unknown = []
    django_full = False
    apps_changed: set[str] = set()
    python_repo = False
    engine = False
    react_full = False
    react_files: list[str] = []
    realm = False
    all_apps = set(django_apps(src))

    for path in changed:
        exists = (src / path).exists()
        classified = False
        if matches(path, NO_TEST_PATTERNS):
            continue
        if path.startswith("lai/apps/"):
            parts = path.split("/")
            if len(parts) > 3 and parts[2] in all_apps:
                apps_changed.add(parts[2])
            elif len(parts) > 3:  # a removed or renamed app
                django_full = True
                reasons.append(f"django full: {path} is not in a current app")
            else:
                django_full = True
            classified = True
        elif matches(path, DJANGO_GLOBAL):
            django_full = True
            reasons.append(f"django full: {path}")
            classified = True
        if matches(path, PYTHON_REPO):
            python_repo = True
            classified = True
        if matches(path, JS_GLOBAL):
            engine = react_full = True
            reasons.append(f"engine and react full: {path}")
            classified = True
        elif matches(path, VITEST_SOURCES):
            classified = True
            if path.startswith("game/"):
                engine = True
            if not exists:
                react_full = True
                reasons.append(f"react full: {path} was deleted or renamed")
            elif path.endswith(TS_SOURCE_SUFFIXES):
                react_files.append(_from_react(path))
        if matches(path, CONTENT):
            django_full = react_full = True
            reasons.append(f"django and react full: content {path}")
            classified = True
        if matches(path, REALM_SENSITIVE):
            realm = True
        if not classified:
            unknown.append(path)

    if unknown:
        plan = full_plan(base_sha, [f"unclassified change: {p}" for p in unknown[:20]])
        plan["scope"] = "affected"
        plan["changed_files"] = len(changed)
        return plan

    suites: list[dict[str, Any]] = []
    not_planned: list[dict[str, str]] = []
    django_touched = django_full or bool(apps_changed)
    if django_touched:
        suites.append(_suite("django-migrations", "check", "lai", ["makemigrations"], "django"))
        if django_full:
            suites.append(_suite("django", "pytest", ".", ["lai"], "; ".join(reasons[:5])))
        else:
            apps = with_direct_dependents(apps_changed, reverse_dependencies(src))
            targets = [f"lai/apps/{a}" for a in sorted(apps)]
            covered = {t.split("/")[2] for t in targets}
            targets += [t for t in DJANGO_SAFETY_BASELINE if t.split("/")[2] not in covered]
            why = f"changed apps {sorted(apps_changed)} and their dependents"
            suites.append(_suite("django", "pytest", ".", targets, why))
    else:
        not_planned.append({"name": "django", "why": "no Django change"})
    if python_repo:
        suites.append(_suite("python-repo", "pytest", ".", ["tests"], "tests, scripts or CI"))
    else:
        not_planned.append({"name": "python-repo", "why": "no repository tooling change"})
    if engine:
        suites.append(_suite("engine", "vitest", "game", ["run"], "game/ or JS configuration"))
    else:
        not_planned.append({"name": "engine", "why": "no game/ change"})
    if react_full:
        suites.append(_suite("react", "vitest", "react", ["run"], "; ".join(reasons[:5])))
    elif react_files:
        suites.append(
            _suite(
                "react",
                "vitest",
                "react",
                ["related", *sorted(set(react_files))],
                f"vitest related to {len(set(react_files))} changed files",
                allow_empty=True,
            )
        )
    else:
        not_planned.append({"name": "react", "why": "no TypeScript change"})
    vitest_files, pytest_files = realm_tests(src) if realm else ([], [])
    why = "shared engine, realm or region code changed"
    if not realm:
        not_planned.append({"name": "realm-compat", "why": "no shared engine or realm change"})
    if realm and vitest_files and not react_full:
        suites.append(_suite("realm-compat-react", "vitest", "react", ["run", *vitest_files], why))
    elif realm:
        not_planned.append({"name": "realm-compat-react", "why": "covered by the full react suite"})
    if realm and pytest_files and django_touched and not django_full:
        suites.append(_suite("realm-compat-django", "pytest", ".", pytest_files, why))
    elif realm:
        not_planned.append(
            {"name": "realm-compat-django", "why": "no Django change, or covered by full django"}
        )
    if not suites:
        not_planned = [n for n in not_planned if n["name"] != "python-repo"]
        suites.append(
            _suite("python-repo", "pytest", ".", ["tests"], "minimum: documentation-only change")
        )
    return {
        "scope": "affected",
        "base_sha": base_sha,
        "changed_files": len(changed),
        "full_reasons": reasons,
        "suites": suites,
        "not_planned": not_planned,
        "deferred": DEFERRED,
    }


def plan(src: Path, scope: str, changed: list[str] | None, base_sha: str | None) -> dict:
    if scope == "full-unit":
        return full_plan(base_sha)
    if scope != "affected":
        raise ValueError(f"unknown scope {scope!r}")
    if changed is None:
        raise ValueError("affected scope needs the changed-file list")
    return affected_plan(src, changed, base_sha)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--src", type=Path, required=True)
    parser.add_argument("--scope", choices=("affected", "full-unit"), required=True)
    parser.add_argument("--changed-from", type=Path, help="file listing changed paths, one a line")
    parser.add_argument("--base-sha")
    args = parser.parse_args(argv)
    changed = None
    if args.changed_from:
        changed = args.changed_from.read_text(encoding="utf-8").splitlines()
    print(json.dumps(plan(args.src, args.scope, changed, args.base_sha), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
