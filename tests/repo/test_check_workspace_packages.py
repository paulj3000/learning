"""Unit tests for scripts/check_workspace_packages.py (LAI-ENG-002)."""

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location(
    "check_workspace_packages", ROOT / "scripts" / "check_workspace_packages.py"
)
assert _SPEC and _SPEC.loader
ws = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(ws)

BASE = {"private": True, "type": "module", "engines": {"node": ">=22.0.0"}}


def _json(root: Path, path: str, data: dict) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data), encoding="utf-8")


def _text(root: Path, path: str, text: str) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def _tree(tmp_path: Path, *, engine: dict | None = None, engine_src: dict | None = None) -> Path:
    """Root + react, and optionally the game/ engine package, all valid by default."""
    workspaces = ["react"] + (["game"] if engine is not None else [])
    _json(
        tmp_path,
        "package.json",
        {**BASE, "name": "root", "workspaces": workspaces, "dependencies": {"three": "^0.185.1"}},
    )
    react = {
        **BASE,
        "name": "learning-adventure-island-react",
        "dependencies": {"three": "^0.185.1"},
    }
    if engine is not None:
        react["dependencies"]["@lai/game-engine"] = "0.1.0"
    _json(tmp_path, "react/package.json", react)
    lock = {"packages": {"": {}, "react": {}}}
    if engine is not None:
        _json(tmp_path, "game/package.json", {**BASE, "name": "@lai/game-engine", **engine})
        _text(
            tmp_path,
            "game/tsconfig.json",
            '{\n  // engine\n  "compilerOptions": {"strict": true,},\n}\n',
        )
        for path, source in (engine_src or {"src/index.ts": "export const x = 1;\n"}).items():
            _text(tmp_path, f"game/{path}", source)
        lock["packages"]["game"] = {}
    _json(tmp_path, "package-lock.json", lock)
    return tmp_path


def _errors(root: Path) -> list[str]:
    return ws.check(root)[0]


def test_repository_passes():
    errors, order = ws.check(ROOT)
    assert errors == []
    assert "learning-adventure-island-react" in order


def test_valid_tree_with_engine_orders_engine_first(tmp_path):
    errors, order = ws.check(_tree(tmp_path, engine={"peerDependencies": {"three": "^0.185.1"}}))
    assert errors == []
    assert order == ["@lai/game-engine", "learning-adventure-island-react"]


def test_missing_workspace_manifest(tmp_path):
    root = _tree(tmp_path)
    _json(root, "package.json", {**BASE, "name": "root", "workspaces": ["react", "game"]})
    assert any("game: listed in workspaces but has no package.json" in e for e in _errors(root))


def test_workspace_globs_are_refused(tmp_path):
    root = _tree(tmp_path)
    _json(root, "package.json", {**BASE, "name": "root", "workspaces": ["packages/*"]})
    assert any("workspace glob" in e for e in _errors(root))


@pytest.mark.parametrize(
    "override, message",
    [
        ({"private": False}, "must be private"),
        ({"name": "game-engine"}, "must be @lai/<name>"),
        ({"type": "commonjs"}, "differs from the root"),
        ({"engines": {"node": ">=20"}}, "engines.node must match"),
    ],
)
def test_package_metadata_rules(tmp_path, override, message):
    root = _tree(tmp_path, engine={})
    pkg = json.loads((root / "game/package.json").read_text())
    _json(root, "game/package.json", {**pkg, **override})
    assert any(message in e for e in _errors(root))


def test_engine_directory_must_use_the_engine_name(tmp_path):
    root = _tree(tmp_path, engine={})
    _json(root, "game/package.json", {**BASE, "name": "@lai/engine"})
    assert any("is named @lai/game-engine" in e for e in _errors(root))


def test_differing_version_ranges(tmp_path):
    root = _tree(
        tmp_path,
        engine={
            "peerDependencies": {"three": "^0.185.1"},
            "devDependencies": {"three": "^0.180.0"},
        },
    )
    assert any("three: version ranges differ" in e for e in _errors(root))


def test_lockfile_must_list_every_workspace(tmp_path):
    root = _tree(tmp_path, engine={})
    _json(root, "package-lock.json", {"packages": {"": {}, "react": {}}})
    assert any("no entry for workspace game" in e for e in _errors(root))


@pytest.mark.parametrize(
    "dep", ["react", "phaser", "@aws-sdk/client-s3", "aws-amplify", "@colyseus/sdk"]
)
def test_engine_forbidden_dependencies(tmp_path, dep):
    root = _tree(tmp_path, engine={"dependencies": {dep: "1.0.0"}})
    assert any(f"must not depend on {dep}" in e for e in _errors(root))


@pytest.mark.parametrize(
    "source",
    [
        "import { useState } from 'react';",
        "import { Link } from 'react-router-dom';",
        "export { x } from '@aws-sdk/client-s3';",
        "const p = import('phaser');",
        "const a = require('aws-amplify');",
        "import 'react-dom';",
    ],
)
def test_engine_forbidden_imports(tmp_path, source):
    root = _tree(tmp_path, engine={}, engine_src={"src/world.ts": source + "\n"})
    assert any("game/src/world.ts: engine code must not import" in e for e in _errors(root))


def test_engine_may_import_three_and_itself(tmp_path):
    src = {
        "src/index.ts": "import * as THREE from 'three';\nexport * from './core/loop';\n",
        "src/core/loop.ts": (
            "import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';\n"
        ),
    }
    assert (
        _errors(_tree(tmp_path, engine={"peerDependencies": {"three": "^0.185.1"}}, engine_src=src))
        == []
    )


def test_engine_imports_must_stay_inside_the_package(tmp_path):
    src = {"src/index.ts": "import { api } from '../../react/src/api/client';\n"}
    assert any("outside game/" in e for e in _errors(_tree(tmp_path, engine={}, engine_src=src)))


def test_engine_must_not_import_other_workspaces(tmp_path):
    src = {"src/index.ts": "import x from 'learning-adventure-island-react';\n"}
    assert any(
        "workspace package" in e for e in _errors(_tree(tmp_path, engine={}, engine_src=src))
    )


def test_engine_has_no_react_views(tmp_path):
    src = {"src/Hud.tsx": "export const Hud = () => null;\n"}
    assert any("no React views" in e for e in _errors(_tree(tmp_path, engine={}, engine_src=src)))


def test_engine_must_be_strict(tmp_path):
    root = _tree(tmp_path, engine={})
    _text(root, "game/tsconfig.json", '{"compilerOptions": {"strict": false}}')
    assert any("must enable strict" in e for e in _errors(root))


def test_engine_strict_through_extends(tmp_path):
    root = _tree(tmp_path, engine={})
    _text(root, "tsconfig.base.json", '{"compilerOptions": {"strict": true}}')
    _text(root, "game/tsconfig.json", '{"extends": "../tsconfig.base.json"}')
    assert _errors(root) == []


def test_engine_must_not_depend_on_react_workspace(tmp_path):
    root = _tree(tmp_path, engine={"dependencies": {"learning-adventure-island-react": "0.1.0"}})
    errors = _errors(root)
    assert any("cycle" in e for e in errors)
    assert any("must not depend on workspace" in e for e in errors)


def test_build_order_reports_cycles():
    order, cyclic = ws.build_order({"a": {"b"}, "b": {"a"}, "c": set()})
    assert order == ["c"]
    assert cyclic == ["a", "b"]


def test_main_order_flag(capsys):
    assert ws.main(["--root", str(ROOT), "--order"]) == 0
    assert "learning-adventure-island-react" in capsys.readouterr().out
