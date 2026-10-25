"""Loader for the golden vectors (LAI-0303, ADR-019 sub-decision 8).

The TypeScript rules generate `tests/golden/*.json` (`npm run golden:generate`). A Python port
of a rule (Phase 6: LAI-0601, 0603, 0604, 0605, 0606) parametrises its test over `cases()` and
calls its function with each case's `input` as keyword arguments, mapped to snake_case:

    @pytest.mark.parametrize("case", cases("adventure-engine", "validateStepAnswer"), ids=case_id)
    def test_validate_step_answer(case):
        assert_case(case, lambda inputs: validate_step_answer(**inputs))

Nothing here implements a rule. Python has no rule implementations yet, so today only the
format is checked (`test_golden_vectors.py`).
"""

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
GOLDEN_DIR = ROOT / "tests" / "golden"
SCHEMA_VERSION = 1


def suite_names() -> list[str]:
    return sorted(path.stem for path in GOLDEN_DIR.glob("*.json"))


def load_suite(name: str) -> dict[str, Any]:
    return json.loads((GOLDEN_DIR / f"{name}.json").read_text(encoding="utf-8"))


def snake_case(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def cases(suite: str, function: str) -> list[dict[str, Any]]:
    """The cases for one TypeScript function, inputs keyed by snake_case argument name."""
    vectors = load_suite(suite)["functions"][function]
    return [
        {**case, "input": {snake_case(key): value for key, value in case["input"].items()}}
        for case in vectors["cases"]
    ]


def case_id(case: dict[str, Any]) -> str:
    return case["name"]


def assert_case(case: dict[str, Any], call: Callable[[dict[str, Any]], Any]) -> None:
    """Runs one case: the result must equal `expected`, or the call must raise."""
    if case.get("throws"):
        # Any error counts: messages and error classes are not part of the vector contract.
        with pytest.raises(Exception):  # noqa: B017
            call(case["input"])
    else:
        assert call(case["input"]) == case["expected"]
