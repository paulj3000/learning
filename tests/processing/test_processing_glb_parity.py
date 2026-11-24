"""Parity with Django's synchronous validator, checked without importing Django.

1. The shared policy constants (clip vocabulary, generic take names, supported and decoder
   extensions, count limits) are read from `lai/apps/assets/validation.py` with `ast` and must
   equal the processor's.
2. Every case of the shared corpus (`glb_builder.PARITY_CORPUS`) gives the processor error codes
   the corpus records. The Django side of the same corpus runs in
   `lai/apps/assets/tests/test_glb_processing_parity.py`.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

import pytest
from glb_builder import JSON_ELEMENTS, PARITY_CORPUS, ParityCase, validate

from lai_processing.contracts import Severity
from lai_processing.processors.gltf.document import (
    CLIP_VOCABULARY,
    COMPLEXITY_DEFAULTS,
    GENERIC_TAKE_NAME,
)

DJANGO_VALIDATION = Path(__file__).resolve().parents[2] / "lai/apps/assets/validation.py"


def _django_constants() -> dict[str, ast.expr]:
    tree = ast.parse(DJANGO_VALIDATION.read_text())
    out: dict[str, ast.expr] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name):
                out[target.id] = node.value
    return out


def _literal_set(node: ast.expr) -> frozenset[str]:
    """`frozenset({...})` or `frozenset("a b".split())` as written in validation.py."""
    assert isinstance(node, ast.Call)
    (argument,) = node.args
    if isinstance(argument, ast.Call):  # "...".split()
        assert isinstance(argument.func, ast.Attribute)
        source = argument.func.value
        assert isinstance(source, ast.Constant)
        return frozenset(str(source.value).split())
    return frozenset(ast.literal_eval(argument))


def _regex(node: ast.expr) -> tuple[str, Any]:
    assert isinstance(node, ast.Call)
    pattern = ast.literal_eval(node.args[0])
    flags = node.args[1]
    assert isinstance(flags, ast.Attribute)
    return pattern, flags.attr


CONSTANTS = _django_constants()


def test_clip_vocabulary_matches_django() -> None:
    assert _literal_set(CONSTANTS["CLIP_VOCABULARY"]) == CLIP_VOCABULARY


def test_generic_take_name_pattern_matches_django() -> None:
    pattern, flag = _regex(CONSTANTS["GENERIC_TAKE_NAME"])
    assert pattern == GENERIC_TAKE_NAME.pattern
    assert flag == "IGNORECASE"


def test_extension_policy_is_one_shared_table() -> None:
    """Django imports the policy from `lai_processing` (no second copy to drift)."""
    source = DJANGO_VALIDATION.read_text()
    assert "lai_processing.processors.gltf.extension_policy" in source
    assert "SUPPORTED_EXTENSIONS: " not in source and "NEEDS_DECODER: " not in source
    assert "SUPPORTED_EXTENSIONS =" not in source and "NEEDS_DECODER =" not in source
    from lai_processing.processors.gltf import document, extension_policy

    assert document.SUPPORTED_EXTENSIONS is extension_policy.SUPPORTED_EXTENSIONS
    assert document.NEEDS_DECODER is extension_policy.NEEDS_DECODER


def test_count_limits_match_django() -> None:
    limits = CONSTANTS["LIMITS"]
    assert isinstance(limits, ast.Dict)
    django: dict[str, int] = {}
    for key, value in zip(limits.keys, limits.values, strict=True):
        assert isinstance(key, ast.Constant)
        django[str(key.value)] = int(_product(value))
    pairs = {
        "json_bytes": "max_json_bytes",
        "nodes": "max_nodes",
        "meshes": "max_meshes",
        "accessors": "max_accessors",
        "accessor_count": "max_accessor_count",
        "animations": "max_animations",
        "materials": "max_materials",
        "images": "max_images",
        "depth": "max_node_depth",
        "json_depth": "max_json_depth",
        "json_elements": "max_json_elements",
    }
    assert set(django) == set(pairs)
    for name, ours in pairs.items():
        assert COMPLEXITY_DEFAULTS[ours] == django[name], name
    assert JSON_ELEMENTS == COMPLEXITY_DEFAULTS["max_json_elements"]


def _product(node: ast.expr) -> int:
    """Evaluate the integer arithmetic (`16 * 1024 * 1024`) used in LIMITS."""
    if isinstance(node, ast.Constant) and isinstance(node.value, int):
        return node.value
    assert isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult)
    return _product(node.left) * _product(node.right)


def test_every_difference_is_documented_and_stricter() -> None:
    for case in PARITY_CORPUS:
        if case.difference:
            assert case.processor_errors != case.django_errors, case.name
            assert len(case.difference) > 20, case.name
            # A processor that passes a file Django refuses would be a regression.
            if case.django_errors:
                assert case.processor_errors, case.name
        else:
            assert case.processor_errors == case.django_errors, case.name


@pytest.mark.parametrize("case", PARITY_CORPUS, ids=lambda c: c.name)
def test_processor_side_of_the_corpus(case: ParityCase) -> None:
    from lai_processing.processors.gltf import GlbSettings

    outcome = validate(case.data, GlbSettings(compression=case.enabled))
    errors = set(outcome.report.codes(Severity.ERROR))
    assert errors == set(case.processor_errors)
    assert outcome.report.has_errors is bool(case.processor_errors)
