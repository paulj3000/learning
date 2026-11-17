"""Parity between Django's synchronous model validator and the GLB processor (LAI-LAMBDA-002).

Both validators run over one shared corpus of synthetic GLBs (`tests/processing/glb_builder.py`,
generated in code, no binary fixtures). For every case they must reach the same verdict and
report the same set of error codes, except for the cases the corpus marks as an intentional
difference, where the processor is stricter and the reason is recorded next to the case (and in
`docs/processing/GLB_VALIDATION.md`). No database is needed.
"""

import hashlib
import importlib.util
import io
import sys
from pathlib import Path

import pytest

from apps.assets.tests.helpers import glb_bytes, gltf_document
from apps.assets.validation import validate_model
from lai_processing.contracts import Severity
from lai_processing.processors.gltf import GlbSettings, validate_glb

BUILDER = Path(__file__).resolve().parents[4] / "tests/processing/glb_builder.py"


def _load_builder():
    spec = importlib.util.spec_from_file_location("lai_glb_builder", BUILDER)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses resolve annotations through sys.modules
    spec.loader.exec_module(module)
    return module


builder = _load_builder()


def django_errors(data: bytes) -> tuple[bool, set[str]]:
    result = validate_model(io.BytesIO(data), size=len(data))
    return result.passed, {f.code for f in result.errors}


def processor_errors(data: bytes) -> tuple[bool, set[str]]:
    outcome = validate_glb(io.BytesIO(data), len(data), GlbSettings(), lambda: None)
    errors = set(outcome.report.codes(Severity.ERROR))
    return not outcome.report.has_errors, errors


@pytest.mark.parametrize("case", builder.PARITY_CORPUS, ids=lambda c: c.name)
def test_same_verdict_and_error_codes(case):
    django_passed, django = django_errors(case.data)
    processor_passed, processor = processor_errors(case.data)
    assert django == set(case.django_errors)
    assert processor == set(case.processor_errors)
    if not case.difference:
        assert processor_passed is django_passed
        assert processor == django


def test_the_corpus_covers_pass_and_fail_on_both_sides():
    verdicts = {(not c.django_errors, not c.processor_errors) for c in builder.PARITY_CORPUS}
    assert (True, True) in verdicts
    assert (False, False) in verdicts


@pytest.mark.parametrize(
    "options",
    [
        {},
        {"clips": ("Idle", "Talk")},
        {"clips": ("Armature|mixamo.com|Layer0",)},
        {"clips": ()},
        {"half_size": (2.0, 0.1, 3.0)},
    ],
)
def test_django_helper_models_pass_both_validators(options):
    data = glb_bytes(**options)
    assert django_errors(data) == (True, set())
    assert processor_errors(data) == (True, set())


def test_dimensions_agree_with_django():
    data = glb_bytes(half_size=(0.3, 0.7, 0.25))
    django = validate_model(io.BytesIO(data), size=len(data)).dimensions
    outcome = validate_glb(io.BytesIO(data), len(data), GlbSettings(), lambda: None)
    low, high = outcome.facts.bounds_min, outcome.facts.bounds_max
    assert {axis: round(high[i] - low[i], 4) for i, axis in enumerate("xyz")} == django


def test_django_helper_document_with_external_uri_fails_both():
    document, binary = gltf_document(buffer_uri="https://example.invalid/model.bin")
    data = glb_bytes(document, binary)
    assert django_errors(data)[1] == processor_errors(data)[1] == {"external_resource"}


@pytest.mark.parametrize(
    "raw",
    [
        b'{"asset": {"version": "2.0"}}',
        b'{"a": [1, {"b": "x,y"}, [2, 3]], "c": {"d": null}}',
        b'{"a": "[[[[{{{{,,,,::::"}',
        b'{"a": "\\"[[[[,,,,"}',
        b'{"a": "\\\\", "b": 1}',
        b'{"a": "never closed}',
        b'{"a": "escaped at the end\\"}',
        b'{"x": ' + b"[" * 64 + b"]" * 64 + b"}",
        b'{"x": ' + b"[" * 63 + b"]" * 63 + b"}",
        b'{"x": [' + b"0," * 1_000_000 + b"0]}",
        b'{"x": [' + b"0," * 999_990 + b"0]}",
        b"]" * 3_000_100,
    ],
    ids=lambda raw: f"{len(raw)}-bytes-{hashlib.sha256(raw).hexdigest()[:8]}",
)
def test_django_json_prescan_mirrors_the_processor(raw):
    from apps.assets.validation import LIMITS, _scan_json
    from lai_processing.processors.gltf.document import COMPLEXITY_DEFAULTS
    from lai_processing.processors.gltf.jsonparse import scan_structure

    assert LIMITS["json_depth"] == COMPLEXITY_DEFAULTS["max_json_depth"]
    assert LIMITS["json_elements"] == COMPLEXITY_DEFAULTS["max_json_elements"]
    expected = scan_structure(
        raw, COMPLEXITY_DEFAULTS["max_json_depth"], COMPLEXITY_DEFAULTS["max_json_elements"]
    )
    assert _scan_json(raw) == expected


def test_django_refuses_a_full_chunk_of_tiny_values_before_parsing(monkeypatch):
    from apps.assets import validation

    def refuse(*_args, **_kwargs):
        raise AssertionError("json.loads ran on a document the pre-scan must refuse")

    monkeypatch.setattr(validation.json, "loads", refuse)
    head = b'{"asset": {"version": "2.0"}, "x": ['
    raw = head + b"{}," * ((validation.LIMITS["json_bytes"] - len(head) - 8) // 3) + b"{}]}"
    data = builder.glb(raw, b"")
    assert django_errors(data) == (False, {"too_complex"})
