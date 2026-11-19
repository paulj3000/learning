"""npm workspace package check (LAI-ENG-002; docs/infrastructure/game-engine-package.md).

Today the root declares one workspace, `react`. The engine package planned by LAI-2101 is
`game/`, published inside the repository as `@lai/game-engine` (ADR-020: Three.js only; no React,
Django client, Amplify or AWS SDK in engine code). This check is ready for it before it exists, so
the first commit that adds it is held to the rules instead of setting a precedent.

Fails when:
- a workspace listed in the root `package.json` has no `package.json`;
- a workspace package is not `private`, or a new one is not named `@lai/<name>`;
- a workspace's `engines.node` or `type` differs from the root;
- a dependency declared by more than one package (root included) has different version ranges;
- `package-lock.json` has no entry for a workspace (the lockfile was not regenerated);
- workspace packages depend on each other in a cycle;
- the engine package depends on, or its source imports, a forbidden module (React, routing,
  Phaser, Amplify, AWS SDKs, Colyseus, Django clients), contains a `.tsx` file, or imports a path
  outside its own directory;
- the engine package does not use TypeScript `strict`.

`--order` prints the workspace build order (dependencies first). Standard library only, no
network, no npm. `--root <dir>` points it at another tree (used by its test).
Run with `make workspace-check` or `python3 scripts/check_workspace_packages.py`.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ENGINE_NAME = "@lai/game-engine"
ENGINE_DIR = "game"
SCOPE = "@lai/"
# Workspaces that predate the @lai/ naming rule keep their names.
GRANDFATHERED_NAMES = {"react": "learning-adventure-island-react"}

# Modules engine code may never use (CLAUDE.md sections 7, 8, 19; ADR-020; LAI-2101 acceptance).
FORBIDDEN_ENGINE_MODULES = (
    "react",
    "react-dom",
    "react-router",
    "react-router-dom",
    "phaser",
    "aws-amplify",
    "@aws-amplify/",
    "@aws-sdk/",
    "aws-sdk",
    "aws-jwt-verify",
    "@colyseus/",
    "@testing-library/",
)
DEPENDENCY_SECTIONS = (
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
)
SOURCE_SUFFIXES = (".ts", ".mts", ".cts", ".js", ".mjs")
# `import ... from 'x'`, `export ... from 'x'`, `import('x')`, `require('x')`, `import 'x'`.
IMPORT_RE = re.compile(
    r"""(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([^'"]+)\1""",
    re.MULTILINE,
)


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_jsonc(path: Path) -> dict:
    """tsconfig files allow comments and trailing commas; strip them outside strings."""
    text = path.read_text(encoding="utf-8")
    out, i, n, in_str = [], 0, len(text), False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 1
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
            out.append(c)
        elif text.startswith("//", i):
            while i < n and text[i] != "\n":
                i += 1
            continue
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        else:
            out.append(c)
        i += 1
    return json.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))


def _forbidden(module: str) -> bool:
    return any(
        module == f.rstrip("/")
        or (f.endswith("/") and module.startswith(f))
        or module.startswith(f + "/")
        for f in FORBIDDEN_ENGINE_MODULES
    )


def _strict(tsconfig: Path, seen: set[Path] | None = None) -> bool | None:
    """`compilerOptions.strict` following relative `extends`; None when never set."""
    seen = seen or set()
    if tsconfig in seen or not tsconfig.exists():
        return None
    seen.add(tsconfig)
    data = _load_jsonc(tsconfig)
    value = data.get("compilerOptions", {}).get("strict")
    if value is not None:
        return bool(value)
    parent = data.get("extends")
    if isinstance(parent, str) and parent.startswith("."):
        target = (tsconfig.parent / parent).resolve()
        if target.suffix != ".json":
            target = target.with_suffix(".json")
        return _strict(target, seen)
    return None


def _engine_errors(root: Path, rel: str, pkg: dict) -> list[str]:
    errors = []
    pkg_dir = root / rel
    for section in DEPENDENCY_SECTIONS:
        for dep in pkg.get(section, {}):
            if _forbidden(dep):
                errors.append(f"{rel}: engine package must not depend on {dep} ({section})")
    if _strict(pkg_dir / "tsconfig.json") is not True:
        errors.append(f"{rel}: engine package tsconfig.json must enable strict")
    src = pkg_dir / "src"
    for path in sorted(src.rglob("*")) if src.exists() else []:
        if not path.is_file():
            continue
        shown = path.relative_to(root).as_posix()
        if path.suffix in (".tsx", ".jsx"):
            errors.append(f"{shown}: engine code has no React views (.tsx/.jsx belong in react/)")
            continue
        if path.suffix not in SOURCE_SUFFIXES:
            continue
        for match in IMPORT_RE.finditer(path.read_text(encoding="utf-8")):
            module = match.group(2)
            if module.startswith("."):
                target = (path.parent / module).resolve()
                if not target.is_relative_to(pkg_dir.resolve()):
                    errors.append(f"{shown}: imports {module}, outside {rel}/")
            elif _forbidden(module):
                errors.append(f"{shown}: engine code must not import {module}")
            elif module.startswith(SCOPE) or module.startswith("learning-adventure-island"):
                errors.append(f"{shown}: engine code must not import workspace package {module}")
    return errors


def build_order(graph: dict[str, set[str]]) -> tuple[list[str], list[str]]:
    """Topological order (dependencies first) and any packages left in a cycle."""
    order, remaining = [], {name: set(deps) for name, deps in graph.items()}
    while True:
        ready = sorted(name for name, deps in remaining.items() if not deps)
        if not ready:
            break
        for name in ready:
            order.append(name)
            del remaining[name]
        for deps in remaining.values():
            deps.difference_update(ready)
    return order, sorted(remaining)


def check(root: Path) -> tuple[list[str], list[str]]:
    """Errors and the build order for the tree at root."""
    errors: list[str] = []
    root_pkg = _load_json(root / "package.json")
    lock_path = root / "package-lock.json"
    lock_packages = _load_json(lock_path).get("packages", {}) if lock_path.exists() else {}
    workspaces = root_pkg.get("workspaces", [])
    if isinstance(workspaces, dict):
        workspaces = workspaces.get("packages", [])

    packages: dict[str, tuple[str, dict]] = {}
    for rel in workspaces:
        if any(ch in rel for ch in "*?["):
            errors.append(
                f"package.json: workspace glob {rel!r}: list workspace directories explicitly"
            )
            continue
        manifest = root / rel / "package.json"
        if not manifest.exists():
            errors.append(f"{rel}: listed in workspaces but has no package.json")
            continue
        pkg = _load_json(manifest)
        name = pkg.get("name", "")
        packages[name] = (rel, pkg)
        if pkg.get("private") is not True:
            errors.append(f"{rel}: workspace packages must be private (never published to npm)")
        if GRANDFATHERED_NAMES.get(rel) != name and not (
            name.startswith(SCOPE) and len(name) > len(SCOPE)
        ):
            errors.append(f"{rel}: package name {name!r} must be {SCOPE}<name>")
        if rel == ENGINE_DIR and name != ENGINE_NAME:
            errors.append(f"{rel}: the engine package is named {ENGINE_NAME}, not {name!r}")
        for field in ("type",):
            if pkg.get(field) != root_pkg.get(field):
                errors.append(
                    f"{rel}: {field} {pkg.get(field)!r} differs from the root "
                    f"{root_pkg.get(field)!r}"
                )
        root_node = root_pkg.get("engines", {}).get("node")
        if pkg.get("engines", {}).get("node") != root_node:
            errors.append(f"{rel}: engines.node must match the root ({root_node!r})")
        if lock_packages and rel not in lock_packages:
            errors.append(
                f"package-lock.json: no entry for workspace {rel} (regenerate with npm install)"
            )

    # One version range per dependency across the root and every workspace.
    ranges: dict[str, dict[str, str]] = {}
    for owner, pkg in [("package.json", root_pkg)] + [
        (f"{rel}/package.json", pkg) for rel, pkg in packages.values()
    ]:
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            for dep, spec in pkg.get(section, {}).items():
                ranges.setdefault(dep, {})[owner] = spec
    for dep, owners in sorted(ranges.items()):
        if len(set(owners.values())) > 1:
            listed = ", ".join(f"{o} {s}" for o, s in sorted(owners.items()))
            errors.append(f"{dep}: version ranges differ ({listed})")

    graph = {
        name: {
            dep
            for section in DEPENDENCY_SECTIONS
            for dep in pkg.get(section, {})
            if dep in packages
        }
        for name, (_rel, pkg) in packages.items()
    }
    order, cyclic = build_order(graph)
    if cyclic:
        errors.append(f"workspace dependency cycle among: {', '.join(cyclic)}")
    for name, (rel, pkg) in packages.items():
        if name == ENGINE_NAME or rel == ENGINE_DIR:
            errors.extend(_engine_errors(root, rel, pkg))
            for dep in graph[name]:
                errors.append(f"{rel}: engine package must not depend on workspace {dep}")
    return errors, order


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="npm workspace package check (LAI-ENG-002).")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--order", action="store_true", help="print the workspace build order")
    args = parser.parse_args(argv)
    errors, order = check(args.root)
    if args.order:
        print("\n".join(order))
    for error in errors:
        print(f"workspace-check: {error}", file=sys.stderr)
    if errors:
        return 1
    if not args.order:
        print(
            f"workspace-check: {len(order)} workspace package(s) OK; "
            f"build order: {', '.join(order)}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
